import Anthropic from '@anthropic-ai/sdk'
import { put } from '@vercel/blob'
import { parseCsvNames } from './_lib/reconcile.js'
import { toNodeHandler } from './_lib/nodeAdapter.js'

const MODEL = 'claude-opus-4-7'
// Opus 4.7 supports up to 32k output tokens. Needed for batches of 30+
// images — at ~150-300 output tokens per image's findings, 8k was hitting
// the cap and truncating JSON mid-stream, producing empty results.
const MAX_TOKENS = 32000

function buildInstruction(imageCount) {
  return `You are performing a full QA review of a design batch. You have:

- The QA SOP in the system prompt above.
- The full order CSV in the system prompt above (every column, every row).
- ${imageCount} design image(s) attached below, in the same order as the "imageIndex" numbering you should use in the response.

Run ALL of these checks in a single pass:

1. **Per-image checks (SOP sections 4.1–4.16)** for every image. Find the matching row in the CSV by customer name on the artboard label.
2. **Batch-level checks** across the whole set:
   - Section 4.17 — similar customer names across the batch (e.g. "Jeffrey Mathews" vs "Jeffrey Middows").
   - Section 4.21 — populating errors (Full Customization must match populated columns).
   - Opening status check — compare image count (${imageCount}) vs. CSV row count; flag mismatches.
3. **Missing designs (section 4.19)** — any CSV row with no matching image in the batch. You can see every image, so this is a direct set-difference.

Return ONLY valid JSON in this exact shape, with no prose before or after:

{
  "statusCheck": {
    "imagesReceived": ${imageCount},
    "csvRowCount": <integer>,
    "note": "<one-sentence summary, e.g. 'image count matches CSV'>"
  },
  "perImage": [
    {
      "imageIndex": <0-based>,
      "customerName": "<name on the artboard, or empty string if unreadable>",
      "findings": [
        { "issue": "<description>", "severity": "Critical" | "Minor", "location": "<optional>" }
      ]
    }
  ],
  "batchFindings": [
    { "scope": "status" | "similar_names" | "populating", "customerName": "<optional>", "issue": "<description>", "severity": "Critical" | "Minor" }
  ],
  "missingDesigns": [
    { "customerName": "<name from CSV>", "rowIndex": <int>, "issue": "Order in spreadsheet but no matching design found" }
  ]
}

If a section has no findings, return it as an empty array. Every image MUST have a corresponding entry in perImage (even if findings is empty).`
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
  return texts.map((t, i) => `--- CSV ${i + 1} ---\n${t}`).join('\n\n')
}

function buildSystemBlocks(prompt, csvText) {
  const blocks = [{ type: 'text', text: prompt }]
  if (csvText) {
    blocks.push({
      type: 'text',
      text: `\n\n# Order Spreadsheet (CSV, full raw data)\n\n${csvText}`,
    })
  }
  blocks[blocks.length - 1].cache_control = { type: 'ephemeral' }
  return blocks
}

function extractJson(text) {
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

export async function handler(request) {
  const body = await request.json().catch(() => ({}))
  const { jobId, prompt, imageUrls = [], csvUrls = [] } = body

  const csvText = await downloadCsvs(csvUrls)
  const systemBlocks = buildSystemBlocks(prompt, csvText)
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
        imagesReceived: imageUrls.length,
        csvRowCount: csvRows.length,
      }
      emit({ kind: 'status', jobId, ...statusCheck })

      // One call, all images, the full CSV + prompt cached in the system prefix.
      const userContent = [
        ...imageUrls.map((url) => ({
          type: 'image',
          source: { type: 'url', url },
        })),
        { type: 'text', text: buildInstruction(imageUrls.length) },
      ]

      let perImageResults = []
      let batchFindings = []
      let missingDesigns = []
      let runError = null

      try {
        const res = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: systemBlocks,
          messages: [{ role: 'user', content: userContent }],
        })
        if (res.stop_reason === 'max_tokens') {
          runError = {
            kind: 'truncated',
            message: `Response hit max_tokens (${MAX_TOKENS}). JSON was cut off — findings below may be incomplete or missing entirely. Consider splitting the batch.`,
          }
          emit({
            kind: 'error',
            subkind: 'truncated',
            message: runError.message,
          })
        }
        let parsed
        try {
          parsed = extractJson(responseText(res))
        } catch (err) {
          const rawSnippet = responseText(res).slice(0, 4000)
          runError = runError || {
            kind: 'parse_failed',
            message: err.message || 'parse_failed',
            raw: rawSnippet,
          }
          emit({
            kind: 'parse_error',
            error: err.message || 'parse_failed',
            raw: rawSnippet,
          })
          parsed = {}
        }

        // Map perImage entries back to their imageUrl so the client can render.
        const perImage = Array.isArray(parsed.perImage) ? parsed.perImage : []
        perImageResults = imageUrls.map((url, idx) => {
          const match =
            perImage.find((p) => p.imageIndex === idx) ||
            perImage[idx] ||
            null
          if (!match) {
            return {
              kind: 'image',
              imageUrl: url,
              findings: [],
              extractedLabel: {},
            }
          }
          return {
            kind: 'image',
            imageUrl: url,
            findings: Array.isArray(match.findings) ? match.findings : [],
            extractedLabel: {
              customerName: match.customerName || '',
            },
          }
        })
        for (const r of perImageResults) emit(r)

        batchFindings = Array.isArray(parsed.batchFindings)
          ? parsed.batchFindings
          : []
        emit({ kind: 'batch', findings: batchFindings })

        missingDesigns = Array.isArray(parsed.missingDesigns)
          ? parsed.missingDesigns.map((m) => ({ kind: 'missing', ...m }))
          : []
        for (const m of missingDesigns) emit(m)
      } catch (err) {
        runError = { kind: 'call_failed', message: err.message || String(err) }
        emit({ kind: 'error', error: runError.message })
      }

      // Persist snapshot for share links.
      const snapshot = {
        jobId,
        prompt,
        imageUrls,
        csvUrls,
        createdAt,
        statusCheck,
        perImageResults,
        batchFindings,
        missingDesigns,
        runError,
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
          JSON.stringify({ jobId, imageUrls, csvUrls, createdAt }),
          {
            access: 'public',
            contentType: 'application/json',
            allowOverwrite: true,
          },
        )
        emit({ kind: 'persisted', jobId, resultsUrl: resultsBlob.url })
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

export default toNodeHandler(handler)
