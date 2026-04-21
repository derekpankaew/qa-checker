import { describe, it, expect, vi, beforeEach } from 'vitest'

const listMock = vi.fn()
const delMock = vi.fn()
vi.mock('@vercel/blob', () => ({
  list: (...args) => listMock(...args),
  del: (...args) => delMock(...args),
}))

let handler
beforeEach(async () => {
  listMock.mockReset()
  delMock.mockReset()
  vi.resetModules()
  process.env.CRON_SECRET = 'super-secret'
  handler = (await import('./cleanup-blobs.js')).handler
})

function authed(token = 'super-secret') {
  return new Request('http://localhost/api/cleanup-blobs', {
    method: 'GET',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000)
}

function blob(url, age) {
  return { url, pathname: url.replace('https://blob/', ''), uploadedAt: age }
}

describe('GET /api/cleanup-blobs', () => {
  it('returns 401 and does not call del() when Authorization is missing', async () => {
    listMock.mockResolvedValue({ blobs: [], hasMore: false })
    const res = await handler(authed(null))
    expect(res.status).toBe(401)
    expect(delMock).not.toHaveBeenCalled()
  })

  it('returns 401 with a wrong bearer token', async () => {
    const res = await handler(authed('wrong'))
    expect(res.status).toBe(401)
    expect(delMock).not.toHaveBeenCalled()
  })

  it('accepts a valid bearer token', async () => {
    listMock.mockResolvedValue({ blobs: [], hasMore: false })
    const res = await handler(authed())
    expect(res.status).toBe(200)
  })

  it('calls list() with prefix: "jobs/" always (never empty, never prompts/)', async () => {
    listMock.mockResolvedValue({ blobs: [], hasMore: false })
    await handler(authed())
    expect(listMock).toHaveBeenCalled()
    for (const call of listMock.mock.calls) {
      const opts = call[0]
      expect(opts.prefix).toBe('jobs/')
    }
  })

  it('paginates via cursor + hasMore until exhausted', async () => {
    listMock
      .mockResolvedValueOnce({ blobs: [], hasMore: true, cursor: 'c1' })
      .mockResolvedValueOnce({ blobs: [], hasMore: true, cursor: 'c2' })
      .mockResolvedValueOnce({ blobs: [], hasMore: false })
    await handler(authed())
    expect(listMock).toHaveBeenCalledTimes(3)
    expect(listMock.mock.calls[0][0].cursor).toBeUndefined()
    expect(listMock.mock.calls[1][0].cursor).toBe('c1')
    expect(listMock.mock.calls[2][0].cursor).toBe('c2')
  })

  it('deletes only blobs strictly older than 30 days', async () => {
    listMock.mockResolvedValue({
      blobs: [
        blob('https://blob/jobs/old1/img.jpg', daysAgo(45)),
        blob('https://blob/jobs/ok/img.jpg', daysAgo(10)),
        blob('https://blob/jobs/old2/img.jpg', daysAgo(31)),
      ],
      hasMore: false,
    })
    delMock.mockResolvedValue(undefined)
    const res = await handler(authed())
    expect(delMock).toHaveBeenCalledOnce()
    const deleted = delMock.mock.calls[0][0]
    expect(deleted.sort()).toEqual(
      [
        'https://blob/jobs/old1/img.jpg',
        'https://blob/jobs/old2/img.jpg',
      ].sort(),
    )
    const json = await res.json()
    expect(json.deleted).toBe(2)
  })

  it('does NOT delete a blob uploaded exactly 30 days ago (strict <)', async () => {
    const exactlyThirty = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    listMock.mockResolvedValue({
      blobs: [blob('https://blob/jobs/edge/x.jpg', exactlyThirty)],
      hasMore: false,
    })
    const res = await handler(authed())
    expect(delMock).not.toHaveBeenCalled()
    const json = await res.json()
    expect(json.deleted).toBe(0)
  })

  it('batches del() calls at ≤100 URLs per call', async () => {
    const blobs = Array.from({ length: 250 }, (_, i) =>
      blob(`https://blob/jobs/J${i}/x.jpg`, daysAgo(60)),
    )
    listMock.mockResolvedValue({ blobs, hasMore: false })
    delMock.mockResolvedValue(undefined)
    const res = await handler(authed())
    expect(delMock).toHaveBeenCalledTimes(3)
    expect(delMock.mock.calls[0][0]).toHaveLength(100)
    expect(delMock.mock.calls[1][0]).toHaveLength(100)
    expect(delMock.mock.calls[2][0]).toHaveLength(50)
    const json = await res.json()
    expect(json.deleted).toBe(250)
  })

  it('makes zero del() calls when nothing is expired', async () => {
    listMock.mockResolvedValue({
      blobs: [blob('https://blob/jobs/ok/x.jpg', daysAgo(5))],
      hasMore: false,
    })
    const res = await handler(authed())
    expect(delMock).not.toHaveBeenCalled()
    const json = await res.json()
    expect(json.deleted).toBe(0)
  })

  it('surfaces errors from del() (earlier batches already ran)', async () => {
    const blobs = Array.from({ length: 150 }, (_, i) =>
      blob(`https://blob/jobs/J${i}/x.jpg`, daysAgo(60)),
    )
    listMock.mockResolvedValue({ blobs, hasMore: false })
    delMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('blob 500'))
    const res = await handler(authed())
    expect(delMock).toHaveBeenCalledTimes(2)
    expect(res.status).toBe(500)
  })

  it('never sees prompts/ blobs (prefix filter enforced, sanity)', async () => {
    // If the handler mistakenly omitted the prefix, list() would return prompts.
    // Assert the single call always includes prefix: "jobs/".
    listMock.mockImplementation(async (opts) => {
      if (!opts || opts.prefix !== 'jobs/') {
        return {
          blobs: [blob('https://blob/prompts/current.md', daysAgo(400))],
          hasMore: false,
        }
      }
      return { blobs: [], hasMore: false }
    })
    await handler(authed())
    expect(delMock).not.toHaveBeenCalled()
  })

  it('rejects non-GET methods', async () => {
    const req = new Request('http://localhost/api/cleanup-blobs', {
      method: 'POST',
      headers: { authorization: 'Bearer super-secret' },
    })
    const res = await handler(req)
    expect(res.status).toBe(405)
  })
})
