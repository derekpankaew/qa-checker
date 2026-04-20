import Anthropic from '@anthropic-ai/sdk'
import { put } from '@vercel/blob'
import pLimit from 'p-limit'
import { parseCsvNames, reconcileMissing } from './lib/reconcile.js'

const MODEL = 'claude-opus-4-7'
const MAX_TOKENS = 4096
const PASS_A_CONCURRENCY = 10

const PER_IMAGE_INSTRUCTION = `Analyze this design against the QA SOP above. Find the matching order row in the CSV (match by customer name on the artboard label). Run the per-image checks in sections 4.1 through 4.16 of the SOP.

Return ONLY valid JSON in this shape, with no extra prose:
{
  "findings": [
    { "issue": "...", "severity": "Critical" | "Minor", "location": "..." }
  ],
  "extractedLabel": {
    "customerName": "...",
    "size": "...",
    "material": "...",
    "mapType": "...",
    "pinType": "...",
    "dueDate": "..."
  }
}`

function buildBatchInstruction(imageCount) {
  return `You are running batch-level QA checks. You have the full order CSV in the system prompt above. Do NOT analyze individual designs — that is handled separately.

Run these checks:
(a) Status check: you received ${imageCount} design image(s). Compare against the CSV row count and call out any mismatches.
(b) Section 4.17 — flag similar customer names across the batch (e.g., "Jeffrey Mathews" vs "Jeffrey Middows").
(c) Section 4.21 — populating errors. Every detail in Full Customization must match the populated columns.

Return ONLY valid JSON:
{
  "findings": [
    { "scope": "status" | "similar_names" | "populating", "customerName": "...", "issue": "...", "severity": "Critical" | "Minor" }
  ]
}`
}

async function downloadCsvs(urls) {
  if (!urls || urls.length === 0) return ''
  const texts = []
  for (const url of urls) {
    const res = await fetch(url)
    const text = await res.text()
    texts.push(text)
  }
  if (texts.length === 1) return texts[0]
  return texts
    .map((t, i) => `--- CSV ${i + 1} ---\n${t}`)
    .join('\n\n')
}

function buildSharedPrefix(prompt, csvText) {
  const systemBlocks = [
    { type: 'text', text: prompt },
  ]
  if (csvText) {
    systemBlocks.push({
      type: 'text',
      text: `\n\n# Order Spreadsheet (CSV, full raw data)\n\n${csvText}`,
    })
  }
  // Mark the last block with cache_control so the whole prefix (prompt + CSV)
  // is cached. Anthropic caches everything up to and including the marked block.
  systemBlocks[systemBlocks.length - 1].cache_control = { type: 'ephemeral' }
  return systemBlocks
}

function extractJson(text) {
  // Try direct parse first, then fall back to finding a {...} block.
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        return JSON.parse(match[0])
      } catch {
        /* fall through */
      }
    }
    throw new Error('parse_failed')
  }
}

function responseText(response) {
  return (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

async function analyzeImage(client, systemBlocks, imageUrl) {
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemBlocks,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: imageUrl } },
            { type: 'text', text: PER_IMAGE_INSTRUCTION },
          ],
        },
      ],
    })
    const parsed = extractJson(responseText(res))
    return {
      kind: 'image',
      imageUrl,
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
      extractedLabel: parsed.extractedLabel || {},
    }
  } catch (err) {
    return { kind: 'image', imageUrl, error: err.message || String(err) }
  }
}

async function analyzeBatch(client, systemBlocks, imageCount) {
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemBlocks,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: buildBatchInstruction(imageCount) }],
        },
      ],
    })
    const parsed = extractJson(responseText(res))
    return Array.isArray(parsed.findings) ? parsed.findings : []
  } catch (err) {
    return [{ scope: 'error', issue: err.message || String(err), severity: 'Minor' }]
  }
}

export default async function handler(request) {
  const body = await request.json().catch(() => ({}))
  const { jobId, prompt, imageUrls = [], csvUrls = [] } = body

  const csvText = await downloadCsvs(csvUrls)
  const systemBlocks = buildSharedPrefix(prompt, csvText)
  const csvRows = parseCsvNames(csvText)

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      }

      const createdAt = new Date().toISOString()
      const statusCheck = {
        kind: 'status',
        jobId,
        imagesReceived: imageUrls.length,
        csvRowCount: csvRows.length,
      }

      // Status event first.
      emit(statusCheck)

      // Fan out Pass A, capturing each result as it arrives.
      const limit = pLimit(PASS_A_CONCURRENCY)
      const perImageResults = []
      const perImagePromises = imageUrls.map((url) =>
        limit(async () => {
          const result = await analyzeImage(client, systemBlocks, url)
          perImageResults.push(result)
          emit(result)
          return result
        }),
      )

      // Pass B in parallel.
      let batchFindings = []
      const batchPromise = analyzeBatch(
        client,
        systemBlocks,
        imageUrls.length,
      ).then((findings) => {
        batchFindings = findings
        emit({ kind: 'batch', findings })
        return findings
      })

      await Promise.all([...perImagePromises, batchPromise])

      // Reconciliation after all images processed.
      const extractedLabels = perImageResults
        .map((r) => r.extractedLabel)
        .filter(Boolean)
      const missing = reconcileMissing(csvRows, extractedLabels)
      for (const m of missing) emit(m)

      // Persist full snapshot for share links.
      const snapshot = {
        jobId,
        prompt,
        imageUrls,
        csvUrls,
        createdAt,
        statusCheck: {
          imagesReceived: statusCheck.imagesReceived,
          csvRowCount: statusCheck.csvRowCount,
        },
        perImageResults,
        batchFindings,
        missingDesigns: missing,
      }
      try {
        const resultsBlob = await put(
          `jobs/${jobId}/results.json`,
          JSON.stringify(snapshot),
          {
            access: 'public',
            contentType: 'application/json',
            allowOverwrite: true,
          },
        )
        await put(
          `jobs/${jobId}/manifest.json`,
          JSON.stringify({
            jobId,
            imageUrls,
            csvUrls,
            createdAt,
          }),
          {
            access: 'public',
            contentType: 'application/json',
            allowOverwrite: true,
          },
        )
        emit({
          kind: 'persisted',
          jobId,
          resultsUrl: resultsBlob.url,
        })
      } catch (err) {
        emit({
          kind: 'persist_error',
          jobId,
          error: err.message || String(err),
        })
      }

      emit({ kind: 'done' })
      controller.close()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-cache',
    },
  })
}
