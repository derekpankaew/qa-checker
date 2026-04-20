import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

let getPrompt, savePrompt

beforeEach(async () => {
  fetchMock.mockReset()
  vi.resetModules()
  const mod = await import('./promptApi.js')
  getPrompt = mod.getPrompt
  savePrompt = mod.savePrompt
})

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('getPrompt', () => {
  it('GETs /api/prompt and returns parsed JSON', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ content: '# hi', etag: 'abc', updatedAt: 'now' }),
    )
    const out = await getPrompt()
    expect(fetchMock).toHaveBeenCalledWith('/api/prompt')
    expect(out).toEqual({ content: '# hi', etag: 'abc', updatedAt: 'now' })
  })

  it('falls back to bundled default content when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network'))
    const out = await getPrompt()
    expect(out.content).toMatch(/Paper Anniversary|QA Prompt/i)
    expect(out.etag).toBe('default')
  })
})

describe('savePrompt', () => {
  it('PUTs /api/prompt with content + ifMatch', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ etag: 'new' }))
    const out = await savePrompt({ content: '# new', ifMatch: 'prev' })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/prompt')
    expect(opts.method).toBe('PUT')
    expect(JSON.parse(opts.body)).toEqual({ content: '# new', ifMatch: 'prev' })
    expect(out).toEqual({ etag: 'new' })
  })

  it('throws a conflict error with code "conflict" on 409', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'stale' }, 409))
    await expect(savePrompt({ content: '# x' })).rejects.toMatchObject({
      code: 'conflict',
    })
  })

  it('throws a generic error on other non-2xx responses', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'bad' }, 500))
    await expect(savePrompt({ content: '# x' })).rejects.toThrow()
  })
})
