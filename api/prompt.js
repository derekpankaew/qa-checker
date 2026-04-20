import { put, head } from '@vercel/blob'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const CURRENT_PATH = 'prompts/current.md'

function computeEtag(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

let bundledDefault = null
function getBundledDefault() {
  if (bundledDefault !== null) return bundledDefault
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    bundledDefault = readFileSync(
      resolve(here, '../src/defaultPrompt.md'),
      'utf8',
    )
  } catch {
    bundledDefault = '# QA Prompt\n\nAdd your QA instructions here.\n'
  }
  return bundledDefault
}

async function readCurrent() {
  try {
    const meta = await head(CURRENT_PATH)
    const res = await fetch(meta.url)
    const content = await res.text()
    return { content, updatedAt: meta.uploadedAt }
  } catch (err) {
    if (err && (err.status === 404 || /not found/i.test(err.message))) {
      return null
    }
    throw err
  }
}

async function handleGet() {
  const current = await readCurrent()
  if (!current) {
    return Response.json({
      content: getBundledDefault(),
      etag: 'default',
      updatedAt: new Date(0).toISOString(),
    })
  }
  return Response.json({
    content: current.content,
    etag: computeEtag(current.content),
    updatedAt: new Date(current.updatedAt).toISOString(),
  })
}

async function handlePut(request) {
  const body = await request.json().catch(() => ({}))
  const content = typeof body.content === 'string' ? body.content : ''
  if (!content.trim()) {
    return Response.json({ error: 'content is required' }, { status: 400 })
  }

  if (body.ifMatch) {
    const current = await readCurrent()
    const currentEtag = current ? computeEtag(current.content) : 'default'
    if (body.ifMatch !== currentEtag) {
      return Response.json(
        { error: 'etag mismatch', currentEtag },
        { status: 409 },
      )
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const shortHash = computeEtag(content).slice(0, 8)
  const historyPath = `prompts/history/${timestamp}-${shortHash}.md`

  await put(CURRENT_PATH, content, {
    access: 'public',
    contentType: 'text/markdown',
    allowOverwrite: true,
  })
  await put(historyPath, content, {
    access: 'public',
    contentType: 'text/markdown',
  })

  return Response.json({
    etag: computeEtag(content),
    updatedAt: new Date().toISOString(),
  })
}

export default async function handler(request) {
  if (request.method === 'GET') return handleGet()
  if (request.method === 'PUT') return handlePut(request)
  return new Response('Method Not Allowed', { status: 405 })
}
