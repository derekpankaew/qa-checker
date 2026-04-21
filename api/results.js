import { head } from '@vercel/blob'
import { toNodeHandler } from './_lib/nodeAdapter.js'

function extractJobId(url) {
  const u = new URL(url)
  const qs = u.searchParams.get('jobId')
  if (qs) return qs
  const parts = u.pathname.split('/').filter(Boolean)
  const last = parts[parts.length - 1]
  return !last || last === 'results' ? '' : last
}

function isSafeJobId(id) {
  // Allow letters, digits, dashes, underscores. Reject any encoded path bits.
  return /^[A-Za-z0-9_-]+$/.test(id)
}

export async function handler(request) {
  const raw = extractJobId(request.url)
  if (!raw) {
    return Response.json({ error: 'jobId is required' }, { status: 400 })
  }
  const jobId = decodeURIComponent(raw)
  if (!isSafeJobId(jobId)) {
    return Response.json({ error: 'invalid jobId' }, { status: 400 })
  }

  const pathname = `jobs/${jobId}/results.json`
  try {
    const meta = await head(pathname)
    const res = await fetch(meta.url)
    const body = await res.text()
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=60',
      },
    })
  } catch (err) {
    if (err && (err.status === 404 || /not found/i.test(err.message || ''))) {
      return Response.json({ error: 'not found' }, { status: 404 })
    }
    return Response.json({ error: 'lookup failed' }, { status: 500 })
  }
}

export default toNodeHandler(handler)
