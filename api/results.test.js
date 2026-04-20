import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = new Map()
const headMock = vi.fn(async (pathname) => {
  if (!store.has(pathname)) {
    const err = new Error('Not found')
    err.status = 404
    throw err
  }
  const entry = store.get(pathname)
  return {
    url: `https://blob/${pathname}`,
    pathname,
    uploadedAt: entry.uploadedAt,
    size: entry.body.length,
  }
})
vi.mock('@vercel/blob', () => ({
  head: (...args) => headMock(...args),
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

let handler
beforeEach(async () => {
  store.clear()
  headMock.mockClear()
  fetchMock.mockReset()
  vi.resetModules()
  handler = (await import('./results.js')).default
})

function mkReq(url) {
  return new Request(url, { method: 'GET' })
}

describe('GET /api/results/:jobId', () => {
  it('proxies the results.json blob content for a known jobId', async () => {
    const snapshot = { jobId: 'J1', perImageResults: [] }
    store.set('jobs/J1/results.json', {
      body: JSON.stringify(snapshot),
      uploadedAt: new Date(),
    })
    fetchMock.mockResolvedValue(new Response(JSON.stringify(snapshot)))

    const res = await handler(mkReq('http://localhost/api/results/J1'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.jobId).toBe('J1')
    expect(headMock).toHaveBeenCalledWith('jobs/J1/results.json')
  })

  it('returns 404 when the blob does not exist', async () => {
    const res = await handler(mkReq('http://localhost/api/results/MISSING'))
    expect(res.status).toBe(404)
  })

  it('returns 400 when jobId is missing from the path', async () => {
    const res = await handler(mkReq('http://localhost/api/results/'))
    expect(res.status).toBe(400)
  })

  it('rejects jobIds containing path traversal characters', async () => {
    const res = await handler(
      mkReq('http://localhost/api/results/..%2Fprompts'),
    )
    expect(res.status).toBe(400)
    expect(headMock).not.toHaveBeenCalled()
  })
})
