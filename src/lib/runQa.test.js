import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

let runQa
beforeEach(async () => {
  fetchMock.mockReset()
  vi.resetModules()
  runQa = (await import('./runQa.js')).runQa
})

function streamOf(chunks) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
}

function ndjsonResponse(chunks) {
  return new Response(streamOf(chunks), {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  })
}

describe('runQa', () => {
  it('POSTs to /api/run-qa with jobId, prompt, imageUrls, csvUrls', async () => {
    fetchMock.mockResolvedValue(ndjsonResponse([]))
    await runQa({
      jobId: 'J1',
      prompt: '# p',
      imageUrls: ['https://blob/a.jpg'],
      csvUrls: ['https://blob/a.csv'],
      onEvent: () => {},
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/run-qa')
    expect(opts.method).toBe('POST')
    expect(opts.headers['content-type']).toMatch(/json/)
    const body = JSON.parse(opts.body)
    expect(body).toEqual({
      jobId: 'J1',
      prompt: '# p',
      imageUrls: ['https://blob/a.jpg'],
      csvUrls: ['https://blob/a.csv'],
    })
  })

  it('emits one onEvent callback per NDJSON line', async () => {
    fetchMock.mockResolvedValue(
      ndjsonResponse([
        '{"kind":"status","imagesReceived":1}\n',
        '{"kind":"image","imageUrl":"a.jpg"}\n',
        '{"kind":"done"}\n',
      ]),
    )
    const events = []
    await runQa({
      jobId: 'J',
      prompt: '',
      imageUrls: [],
      csvUrls: [],
      onEvent: (e) => events.push(e),
    })
    expect(events.map((e) => e.kind)).toEqual(['status', 'image', 'done'])
    expect(events[1].imageUrl).toBe('a.jpg')
  })

  it('handles chunks split mid-line (buffers until newline)', async () => {
    fetchMock.mockResolvedValue(
      ndjsonResponse([
        '{"kind":"status",',
        '"imagesReceived":2}\n{"kind":"im',
        'age","imageUrl":"b.jpg"}\n',
        '{"kind":"done"}\n',
      ]),
    )
    const events = []
    await runQa({
      jobId: 'J',
      prompt: '',
      imageUrls: [],
      csvUrls: [],
      onEvent: (e) => events.push(e),
    })
    expect(events.map((e) => e.kind)).toEqual(['status', 'image', 'done'])
    expect(events[0].imagesReceived).toBe(2)
    expect(events[1].imageUrl).toBe('b.jpg')
  })

  it('ignores blank lines', async () => {
    fetchMock.mockResolvedValue(
      ndjsonResponse([
        '\n{"kind":"status"}\n\n\n{"kind":"done"}\n',
      ]),
    )
    const events = []
    await runQa({
      jobId: 'J',
      prompt: '',
      imageUrls: [],
      csvUrls: [],
      onEvent: (e) => events.push(e),
    })
    expect(events.map((e) => e.kind)).toEqual(['status', 'done'])
  })

  it('surfaces malformed JSON via onError but continues the stream', async () => {
    fetchMock.mockResolvedValue(
      ndjsonResponse([
        '{"kind":"status"}\n',
        'not json at all\n',
        '{"kind":"done"}\n',
      ]),
    )
    const events = []
    const errors = []
    await runQa({
      jobId: 'J',
      prompt: '',
      imageUrls: [],
      csvUrls: [],
      onEvent: (e) => events.push(e),
      onError: (e) => errors.push(e),
    })
    expect(events.map((e) => e.kind)).toEqual(['status', 'done'])
    expect(errors).toHaveLength(1)
  })

  it('flushes a final trailing line with no newline', async () => {
    fetchMock.mockResolvedValue(
      ndjsonResponse(['{"kind":"status"}\n{"kind":"done"}']),
    )
    const events = []
    await runQa({
      jobId: 'J',
      prompt: '',
      imageUrls: [],
      csvUrls: [],
      onEvent: (e) => events.push(e),
    })
    expect(events.map((e) => e.kind)).toEqual(['status', 'done'])
  })

  it('aborts cleanly when caller signals abort', async () => {
    const controller = new AbortController()
    // Build a stream that stalls so the abort actually does something.
    fetchMock.mockImplementation(async (_url, opts) => {
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('{"kind":"status"}\n'))
          // Listen for abort — mimic real fetch semantics.
          opts.signal?.addEventListener('abort', () => {
            c.error(new DOMException('aborted', 'AbortError'))
          })
        },
      })
      return new Response(stream, { status: 200 })
    })
    const events = []
    const p = runQa({
      jobId: 'J',
      prompt: '',
      imageUrls: [],
      csvUrls: [],
      signal: controller.signal,
      onEvent: (e) => events.push(e),
    })
    // Wait one microtask for the first event to be emitted.
    await new Promise((r) => setTimeout(r, 10))
    controller.abort()
    await expect(p).rejects.toThrow(/abort/i)
    expect(events[0].kind).toBe('status')
  })

  it('throws when fetch returns a non-2xx status', async () => {
    fetchMock.mockResolvedValue(
      new Response('boom', { status: 500 }),
    )
    await expect(
      runQa({
        jobId: 'J',
        prompt: '',
        imageUrls: [],
        csvUrls: [],
        onEvent: () => {},
      }),
    ).rejects.toThrow()
  })
})
