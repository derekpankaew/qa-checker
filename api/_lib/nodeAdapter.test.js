import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { toNodeHandler } from './nodeAdapter.js'

function mockReq({ method = 'GET', url = '/api/x', headers = {}, body } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.url = url
  req.headers = { host: 'example.com', ...headers }
  // Emit body asynchronously so listeners attached synchronously still see it.
  setImmediate(() => {
    if (body !== undefined) req.emit('data', Buffer.from(body))
    req.emit('end')
  })
  return req
}

function mockRes() {
  const chunks = []
  const res = {
    statusCode: 200,
    headers: {},
    headersSent: false,
    setHeader: vi.fn((k, v) => {
      res.headers[k.toLowerCase()] = v
    }),
    write: vi.fn((c) => chunks.push(Buffer.from(c))),
    end: vi.fn((c) => {
      if (c) chunks.push(Buffer.from(c))
      res.ended = true
    }),
    getBody: () => Buffer.concat(chunks).toString('utf8'),
  }
  return res
}

describe('toNodeHandler', () => {
  it('converts a Node request into a Web Request and writes the Response', async () => {
    const webHandler = async (request) => {
      expect(request).toBeInstanceOf(Request)
      expect(request.method).toBe('POST')
      expect(request.headers.get('x-test')).toBe('yes')
      const body = await request.json()
      expect(body).toEqual({ hello: 'world' })
      return Response.json({ ok: true }, { status: 201 })
    }
    const node = toNodeHandler(webHandler)
    const req = mockReq({
      method: 'POST',
      url: '/api/x',
      headers: { 'x-test': 'yes', 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    })
    const res = mockRes()
    await node(req, res)
    expect(res.statusCode).toBe(201)
    expect(res.headers['content-type']).toMatch(/json/)
    expect(JSON.parse(res.getBody())).toEqual({ ok: true })
  })

  it('writes streamed response bodies chunk-by-chunk', async () => {
    const webHandler = async () => {
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('line1\n'))
          c.enqueue(new TextEncoder().encode('line2\n'))
          c.close()
        },
      })
      return new Response(stream, { status: 200 })
    }
    const node = toNodeHandler(webHandler)
    const req = mockReq({ method: 'GET' })
    const res = mockRes()
    await node(req, res)
    expect(res.getBody()).toBe('line1\nline2\n')
    expect(res.write.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('returns 500 when the web handler throws', async () => {
    const webHandler = async () => {
      throw new Error('boom')
    }
    const node = toNodeHandler(webHandler)
    const req = mockReq()
    const res = mockRes()
    await node(req, res)
    expect(res.statusCode).toBe(500)
  })

  it('does not read a body on GET/HEAD requests', async () => {
    const webHandler = async (request) => {
      expect(request.method).toBe('GET')
      return new Response('ok', { status: 200 })
    }
    const node = toNodeHandler(webHandler)
    const req = mockReq({ method: 'GET' })
    const res = mockRes()
    await node(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.getBody()).toBe('ok')
  })

  it('preserves Authorization header in the Web Request', async () => {
    const webHandler = async (request) => {
      expect(request.headers.get('authorization')).toBe('Bearer xyz')
      return new Response('ok', { status: 200 })
    }
    const node = toNodeHandler(webHandler)
    const req = mockReq({
      method: 'GET',
      headers: { authorization: 'Bearer xyz' },
    })
    const res = mockRes()
    await node(req, res)
    expect(res.statusCode).toBe(200)
  })
})
