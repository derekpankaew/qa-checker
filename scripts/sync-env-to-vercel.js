#!/usr/bin/env node
/**
 * Sync Environment Variables to Vercel
 *
 * Reads .env from the repo root, compares it against Vercel's current env vars
 * (pulled via `vercel env pull`), shows a diff, and on confirmation applies
 * new + changed values to production, preview, and development.
 *
 * Requirements:
 *   - Vercel CLI installed and authenticated: `npm i -g vercel && vercel login`
 *   - Project linked: `vercel link` once per machine
 *   - .env in repo root (gitignored)
 *
 * Run:
 *   node scripts/sync-env-to-vercel.js
 */

import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'

const ENVIRONMENTS = ['production', 'preview', 'development']

/* ------------------------------ pure helpers ------------------------------ */

export function parseEnvText(text) {
  const out = {}
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let value = m[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[m[1]] = value
  }
  return out
}

export function categorize(local, remote) {
  const unchanged = []
  const changed = []
  const added = []
  for (const key of Object.keys(local).sort()) {
    if (!(key in remote)) added.push(key)
    else if (local[key] !== remote[key]) changed.push(key)
    else unchanged.push(key)
  }
  return { unchanged, changed, new: added }
}

export function serializeForPreview(key, value) {
  return `  - ${key} (len=${String(value).length} chars)`
}

/* ---------------------------- filesystem helpers --------------------------- */

function repoRoot() {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '..')
}

function readLocalEnv() {
  const envPath = join(repoRoot(), '.env')
  if (!existsSync(envPath)) {
    console.error(`ERROR: no .env found at ${envPath}`)
    console.error(
      'Create one in the repo root with KEY=VALUE lines (gitignored).',
    )
    process.exit(1)
  }
  return { path: envPath, vars: parseEnvText(readFileSync(envPath, 'utf8')) }
}

/* ----------------------------- Vercel CLI calls --------------------------- */

function checkVercelCli() {
  const res = spawnSync('vercel', ['--version'], { stdio: 'ignore' })
  if (res.error || res.status !== 0) {
    console.error('ERROR: Vercel CLI not found.')
    console.error('Install: npm i -g vercel')
    console.error('Auth:    vercel login')
    console.error('Link:    vercel link   (once per machine, from repo root)')
    process.exit(1)
  }
}

function pullRemoteEnv() {
  const dir = mkdtempSync(join(tmpdir(), 'qa-check-env-'))
  const target = join(dir, '.env.vercel')
  try {
    const res = spawnSync(
      'vercel',
      ['env', 'pull', target, '--environment', 'production'],
      { stdio: ['ignore', 'pipe', 'pipe'], cwd: repoRoot() },
    )
    if (res.status !== 0) {
      const msg = res.stderr?.toString() || res.stdout?.toString() || ''
      throw new Error(`vercel env pull failed: ${msg.trim()}`)
    }
    if (!existsSync(target)) return {}
    return parseEnvText(readFileSync(target, 'utf8'))
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* noop */
    }
  }
}

function runVercelWithStdin(args, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('vercel', args, {
      cwd: repoRoot(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(stderr.trim() || `exit code ${code}`))
    })
    if (input !== undefined) child.stdin.write(input)
    child.stdin.end()
  })
}

async function addEnvVar(key, value) {
  for (const env of ENVIRONMENTS) {
    try {
      await runVercelWithStdin(['env', 'add', key, env], value)
    } catch (err) {
      throw new Error(`add ${key} to ${env}: ${err.message}`)
    }
  }
}

async function removeEnvVar(key) {
  for (const env of ENVIRONMENTS) {
    try {
      await runVercelWithStdin(['env', 'rm', key, env, '--yes'])
    } catch (err) {
      // rm on a non-existent env is non-fatal — log but continue.
      if (!/not found|does not exist/i.test(err.message)) {
        throw new Error(`rm ${key} from ${env}: ${err.message}`)
      }
    }
  }
}

async function updateEnvVar(key, value) {
  await removeEnvVar(key)
  await addEnvVar(key, value)
}

/* --------------------------------- UI ------------------------------------- */

function printDiff(local, diff) {
  console.log('')
  console.log('Environment Variable Sync Summary')
  console.log('='.repeat(48))

  console.log('\nUnchanged:')
  if (diff.unchanged.length === 0) console.log('  (none)')
  else for (const k of diff.unchanged) console.log(`  - ${k}`)

  console.log('\nWill update (value differs):')
  if (diff.changed.length === 0) console.log('  (none)')
  else for (const k of diff.changed) console.log(serializeForPreview(k, local[k]))

  console.log('\nWill create (new):')
  if (diff.new.length === 0) console.log('  (none)')
  else for (const k of diff.new) console.log(serializeForPreview(k, local[k]))
  console.log('')
}

function confirm(question) {
  return new Promise((resolvePromise) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    rl.question(question, (answer) => {
      rl.close()
      resolvePromise(/^y(es)?$/i.test(answer.trim()) || answer.trim() === '')
    })
  })
}

/* --------------------------------- main ----------------------------------- */

async function main() {
  console.log('Sync Environment Variables to Vercel')
  console.log('='.repeat(48))
  checkVercelCli()

  const { path, vars: localVars } = readLocalEnv()
  console.log(`Local .env:   ${path} (${Object.keys(localVars).length} vars)`)

  console.log('Pulling current Vercel env (production)…')
  const remoteVars = pullRemoteEnv()
  console.log(`Remote vars:  ${Object.keys(remoteVars).length}`)

  const diff = categorize(localVars, remoteVars)
  printDiff(localVars, diff)

  const total = diff.changed.length + diff.new.length
  if (total === 0) {
    console.log('Already in sync. Nothing to do.')
    return
  }

  const parts = []
  if (diff.new.length) parts.push(`${diff.new.length} new`)
  if (diff.changed.length) parts.push(`${diff.changed.length} to update`)
  const ok = await confirm(`Apply (${parts.join(', ')})? [Y/n]: `)
  if (!ok) {
    console.log('Aborted.')
    return
  }

  const stats = { added: 0, updated: 0, failed: 0 }
  for (const key of diff.new) {
    process.stdout.write(`  Adding ${key}… `)
    try {
      await addEnvVar(key, localVars[key])
      console.log('OK')
      stats.added++
    } catch (err) {
      console.log(`FAILED (${err.message})`)
      stats.failed++
    }
  }
  for (const key of diff.changed) {
    process.stdout.write(`  Updating ${key}… `)
    try {
      await updateEnvVar(key, localVars[key])
      console.log('OK')
      stats.updated++
    } catch (err) {
      console.log(`FAILED (${err.message})`)
      stats.failed++
    }
  }

  console.log('')
  console.log('Summary:')
  console.log(`  Added:   ${stats.added}`)
  console.log(`  Updated: ${stats.updated}`)
  console.log(`  Failed:  ${stats.failed}`)
  if (stats.failed > 0) process.exit(1)
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  main().catch((err) => {
    console.error('ERROR:', err.message)
    process.exit(1)
  })
}
