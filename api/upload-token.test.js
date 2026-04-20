import { describe, it, expect, vi, beforeEach } from 'vitest'

const handleUploadMock = vi.fn()
vi.mock('@vercel/blob/client', () => ({
  handleUpload: (...args) => handleUploadMock(...args),
}))

let handler
beforeEach(async () => {
  handleUploadMock.mockReset()
  vi.resetModules()
  handler = (await import('./upload-token.js')).default
})

function mkReq(body) {
  return new Request('http://localhost/api/upload-token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/upload-token', () => {
  it('delegates to handleUpload and returns its response body', async () => {
    handleUploadMock.mockResolvedValue({ ok: true, fake: 'token' })
    const res = await handler(
      mkReq({ type: 'blob.generate-client-token', payload: { pathname: 'jobs/J/images/x.jpg' } }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true, fake: 'token' })
    expect(handleUploadMock).toHaveBeenCalledOnce()
  })

  it('passes an onBeforeGenerateToken callback that restricts pathnames to jobs/{jobId}/...', async () => {
    handleUploadMock.mockImplementation(async ({ onBeforeGenerateToken }) => {
      // Legit path
      const ok = await onBeforeGenerateToken('jobs/J/images/abc-x.jpg', null)
      expect(ok.allowedContentTypes).toContain('image/jpeg')

      // Bad: escaping prefix
      await expect(
        onBeforeGenerateToken('prompts/current.md', null),
      ).rejects.toThrow(/jobs\//)

      // Bad: path traversal
      await expect(
        onBeforeGenerateToken('jobs/../etc/passwd', null),
      ).rejects.toThrow()

      return { ok: true }
    })
    const res = await handler(mkReq({ type: 'blob.generate-client-token' }))
    expect(res.status).toBe(200)
  })

  it('allows image/* and text/csv content types', async () => {
    handleUploadMock.mockImplementation(async ({ onBeforeGenerateToken }) => {
      const res = await onBeforeGenerateToken('jobs/J/images/a.jpg', null)
      const types = res.allowedContentTypes
      expect(types.some((t) => t.startsWith('image/'))).toBe(true)
      expect(types).toContain('text/csv')
      return { ok: true }
    })
    await handler(mkReq({ type: 'blob.generate-client-token' }))
  })

  it('enforces a max file size (e.g. 20 MB)', async () => {
    handleUploadMock.mockImplementation(async ({ onBeforeGenerateToken }) => {
      const res = await onBeforeGenerateToken('jobs/J/images/a.jpg', null)
      expect(res.maximumSizeInBytes).toBeGreaterThan(0)
      expect(res.maximumSizeInBytes).toBeLessThanOrEqual(50 * 1024 * 1024)
      return { ok: true }
    })
    await handler(mkReq({ type: 'blob.generate-client-token' }))
  })

  it('returns 400 when handleUpload throws', async () => {
    handleUploadMock.mockRejectedValue(new Error('bad body'))
    const res = await handler(mkReq({ garbage: true }))
    expect(res.status).toBe(400)
  })
})
