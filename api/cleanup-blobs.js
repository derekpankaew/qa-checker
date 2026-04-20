import { list, del } from '@vercel/blob'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const BATCH_SIZE = 100

function isAuthorized(request) {
  const header = request.headers.get('authorization') || ''
  const expected = `Bearer ${process.env.CRON_SECRET}`
  return header === expected
}

export default async function handler(request) {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }
  if (!isAuthorized(request)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const cutoff = Date.now() - THIRTY_DAYS_MS
  const toDelete = []
  let cursor

  do {
    const page = await list({ prefix: 'jobs/', cursor, limit: 1000 })
    for (const blob of page.blobs || []) {
      const uploadedAt = new Date(blob.uploadedAt).getTime()
      if (uploadedAt < cutoff) toDelete.push(blob.url)
    }
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)

  let deletedCount = 0
  try {
    for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
      const batch = toDelete.slice(i, i + BATCH_SIZE)
      await del(batch)
      deletedCount += batch.length
    }
  } catch (err) {
    return Response.json(
      { deleted: deletedCount, error: err.message || String(err) },
      { status: 500 },
    )
  }

  return Response.json({ deleted: deletedCount })
}
