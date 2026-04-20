import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = new Map()
const putMock = vi.fn(async (pathname, body) => {
  const content = typeof body === 'string' ? body : body
  store.set(pathname, { content, uploadedAt: new Date() })
  return { url: `https://blob/${pathname}`, pathname }
})
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
    size: entry.content.length,
  }
})

vi.mock('@vercel/blob', () => ({
  put: (...args) => putMock(...args),
  head: (...args) => headMock(...args),
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

let handler
beforeEach(async () => {
  store.clear()
  putMock.mockClear()
  headMock.mockClear()
  fetchMock.mockReset()
  vi.resetModules()
  handler = (await import('./prompt.js')).default
})

function req(method, body, headers = {}) {
  return new Request('http://localhost/api/prompt', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('GET /api/prompt', () => {
  it('returns bundled default content + etag "default" when blob missing', async () => {
    const res = await handler(req('GET'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.content).toMatch(/Paper Anniversary|QA Prompt/i)
    expect(json.etag).toBe('default')
    expect(json.updatedAt).toBeTruthy()
  })

  it('returns stored content + computed etag when blob exists', async () => {
    store.set('prompts/current.md', {
      content: '# hello',
      uploadedAt: new Date('2026-04-20T15:00:00Z'),
    })
    fetchMock.mockResolvedValue(new Response('# hello'))
    const res = await handler(req('GET'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.content).toBe('# hello')
    expect(json.etag).toBeTruthy()
    expect(json.etag).not.toBe('default')
    expect(json.updatedAt).toBe(new Date('2026-04-20T15:00:00Z').toISOString())
  })

  it('returns the same etag on repeated reads of the same content', async () => {
    store.set('prompts/current.md', {
      content: '# stable',
      uploadedAt: new Date('2026-01-01'),
    })
    fetchMock.mockResolvedValue(new Response('# stable'))
    const a = await (await handler(req('GET'))).json()
    fetchMock.mockResolvedValue(new Response('# stable'))
    const b = await (await handler(req('GET'))).json()
    expect(a.etag).toBe(b.etag)
  })
})

describe('PUT /api/prompt', () => {
  it('writes prompts/current.md and archives a history entry', async () => {
    const res = await handler(req('PUT', { content: '# new prompt' }))
    expect(res.status).toBe(200)
    const written = [...store.keys()]
    expect(written).toContain('prompts/current.md')
    expect(written.some((k) => k.startsWith('prompts/history/'))).toBe(true)
    const json = await res.json()
    expect(json.etag).toBeTruthy()
  })

  it('returns 400 when content is empty or missing', async () => {
    const emptyRes = await handler(req('PUT', { content: '' }))
    expect(emptyRes.status).toBe(400)
    const missingRes = await handler(req('PUT', {}))
    expect(missingRes.status).toBe(400)
    expect(store.size).toBe(0)
  })

  it('returns 409 when ifMatch does not match current etag', async () => {
    // Seed current
    store.set('prompts/current.md', {
      content: '# original',
      uploadedAt: new Date(),
    })
    fetchMock.mockResolvedValue(new Response('# original'))
    const res = await handler(
      req('PUT', { content: '# new', ifMatch: 'WRONG-ETAG' }),
    )
    expect(res.status).toBe(409)
    // No new writes
    expect(putMock).not.toHaveBeenCalled()
  })

  it('accepts a write when ifMatch matches current etag', async () => {
    store.set('prompts/current.md', {
      content: '# original',
      uploadedAt: new Date(),
    })
    fetchMock.mockResolvedValue(new Response('# original'))
    const getRes = await handler(req('GET'))
    const etag = (await getRes.json()).etag

    fetchMock.mockResolvedValue(new Response('# original'))
    const res = await handler(req('PUT', { content: '# new', ifMatch: etag }))
    expect(res.status).toBe(200)
    expect(store.get('prompts/current.md').content).toBe('# new')
  })

  it('returns a new etag different from the previous one', async () => {
    store.set('prompts/current.md', {
      content: '# A',
      uploadedAt: new Date(),
    })
    fetchMock.mockImplementation(() => Promise.resolve(new Response('# A')))
    const before = await (await handler(req('GET'))).json()

    const put1 = await handler(req('PUT', { content: '# B', ifMatch: before.etag }))
    const after = await put1.json()
    expect(after.etag).not.toBe(before.etag)
  })
})
