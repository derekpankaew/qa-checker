import { describe, it, expect, vi, beforeEach } from 'vitest'

/* Mock the Anthropic SDK */
const createMock = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      constructor() {
        this.messages = { create: createMock }
      }
    },
  }
})

/* Mock @vercel/blob put for results.json persistence */
const blobStore = new Map()
const putMock = vi.fn(async (pathname, body) => {
  blobStore.set(pathname, body)
  return { url: `https://blob/${pathname}`, pathname }
})
vi.mock('@vercel/blob', () => ({
  put: (...args) => putMock(...args),
}))

/* Mock global fetch for CSV downloads */
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

let handler
beforeEach(async () => {
  createMock.mockReset()
  putMock.mockClear()
  blobStore.clear()
  fetchMock.mockReset()
  vi.resetModules()
  process.env.ANTHROPIC_API_KEY = 'test-key'
  handler = (await import('./run-qa.js')).handler
})

function mkReq(body) {
  return new Request('http://localhost/api/run-qa', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function collectStream(res) {
  const events = []
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      events.push(JSON.parse(line))
    }
  }
  if (buf.trim()) events.push(JSON.parse(buf))
  return events
}

async function collectBody(res) {
  const events = await collectStream(res)
  const out = {
    perImageResults: [],
    batchFindings: [],
    missingDesigns: [],
    statusCheck: null,
    events,
  }
  for (const e of events) {
    if (e.kind === 'image') out.perImageResults.push(e)
    else if (e.kind === 'batch') out.batchFindings = e.findings || []
    else if (e.kind === 'missing') out.missingDesigns.push(e)
    else if (e.kind === 'status') out.statusCheck = e
    else if (e.kind === 'done') out.done = true
  }
  return out
}

function mockAnthropicResponse(json) {
  createMock.mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify(json) }],
  })
}

function mockCsvFetch(text) {
  fetchMock.mockImplementation(() => Promise.resolve(new Response(text)))
}

const CSV_A = 'Name,Size,Material\nAlice,Small,Paper\nBob,Large,Cotton\n'
const CSV_B = 'Name,Size\nCarol,Small\n'

/* Canonical Anthropic response shape for the single-call architecture. */
function sampleResponse(overrides = {}) {
  return {
    statusCheck: {
      imagesReceived: 1,
      csvRowCount: 2,
      note: 'received all images',
    },
    perImage: [
      {
        imageIndex: 0,
        imageUrl: null,
        customerName: 'Alice',
        findings: [{ issue: 'typo on cuff links', severity: 'Critical' }],
      },
    ],
    batchFindings: [],
    missingDesigns: [],
    ...overrides,
  }
}

describe('Single-call architecture', () => {
  it('makes exactly one messages.create call for any number of images', async () => {
    mockCsvFetch(CSV_A)
    mockAnthropicResponse(sampleResponse())
    await handler(
      mkReq({
        jobId: 'J1',
        prompt: '# QA',
        imageUrls: ['https://blob/a.jpg', 'https://blob/b.jpg', 'https://blob/c.jpg'],
        csvUrls: ['https://blob/a.csv'],
      }),
    )
    expect(createMock).toHaveBeenCalledOnce()
  })

  it('attaches every image URL as an image content block in the single call', async () => {
    mockCsvFetch(CSV_A)
    mockAnthropicResponse(sampleResponse())
    await handler(
      mkReq({
        jobId: 'J',
        prompt: '# p',
        imageUrls: [
          'https://blob/1.jpg',
          'https://blob/2.jpg',
          'https://blob/3.jpg',
        ],
        csvUrls: [],
      }),
    )
    const args = createMock.mock.calls[0][0]
    const userContent = args.messages[0].content
    const imageBlocks = userContent.filter((b) => b.type === 'image')
    expect(imageBlocks).toHaveLength(3)
    expect(imageBlocks.map((b) => b.source.url)).toEqual([
      'https://blob/1.jpg',
      'https://blob/2.jpg',
      'https://blob/3.jpg',
    ])
    for (const b of imageBlocks) {
      expect(b.source.type).toBe('url')
    }
  })

  it('builds the shared prefix with prompt + full CSV + cache_control', async () => {
    mockCsvFetch(CSV_A)
    mockAnthropicResponse(sampleResponse())
    await handler(
      mkReq({
        jobId: 'J',
        prompt: '# MY QA PROMPT',
        imageUrls: ['https://blob/img.jpg'],
        csvUrls: ['https://blob/a.csv'],
      }),
    )
    const args = createMock.mock.calls[0][0]
    const systemText = Array.isArray(args.system)
      ? args.system.map((b) => b.text).join('\n')
      : args.system
    expect(systemText).toContain('# MY QA PROMPT')
    expect(systemText).toContain('Alice')
    expect(systemText).toContain('Material')
    const systemBlocks = Array.isArray(args.system) ? args.system : []
    expect(
      systemBlocks.some(
        (b) => b.cache_control && b.cache_control.type === 'ephemeral',
      ),
    ).toBe(true)
  })

  it('fetches each CSV URL exactly once', async () => {
    mockAnthropicResponse(sampleResponse())
    fetchMock
      .mockResolvedValueOnce(new Response(CSV_A))
      .mockResolvedValueOnce(new Response(CSV_B))
    await handler(
      mkReq({
        jobId: 'J',
        prompt: '# p',
        imageUrls: ['https://blob/img.jpg'],
        csvUrls: ['https://blob/a.csv', 'https://blob/b.csv'],
      }),
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('https://blob/a.csv')
    expect(fetchMock.mock.calls[1][0]).toBe('https://blob/b.csv')
  })

  it('concatenates multiple CSVs with a header divider', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(CSV_A))
      .mockResolvedValueOnce(new Response(CSV_B))
    mockAnthropicResponse(sampleResponse())
    await handler(
      mkReq({
        jobId: 'J',
        prompt: '# p',
        imageUrls: ['https://blob/img.jpg'],
        csvUrls: ['https://blob/a.csv', 'https://blob/b.csv'],
      }),
    )
    const args = createMock.mock.calls[0][0]
    const systemText = Array.isArray(args.system)
      ? args.system.map((b) => b.text).join('\n')
      : args.system
    expect(systemText).toContain('Alice')
    expect(systemText).toContain('Carol')
  })

  it('includes image count in the prompt/instruction', async () => {
    mockCsvFetch('')
    mockAnthropicResponse(sampleResponse())
    await handler(
      mkReq({
        jobId: 'J',
        prompt: 'x',
        imageUrls: ['https://blob/1.jpg', 'https://blob/2.jpg', 'https://blob/3.jpg'],
        csvUrls: [],
      }),
    )
    const args = createMock.mock.calls[0][0]
    const userText = args.messages[0].content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
    expect(userText).toContain('3')
  })
})

describe('Response parsing', () => {
  it('parses perImage findings into per-image result events keyed by imageUrl', async () => {
    mockCsvFetch(CSV_A)
    mockAnthropicResponse({
      statusCheck: { imagesReceived: 2, csvRowCount: 2 },
      perImage: [
        {
          imageIndex: 0,
          customerName: 'Alice',
          findings: [{ issue: 'typo', severity: 'Critical' }],
        },
        {
          imageIndex: 1,
          customerName: 'Bob',
          findings: [],
        },
      ],
      batchFindings: [],
      missingDesigns: [],
    })
    const res = await handler(
      mkReq({
        jobId: 'J',
        prompt: '# p',
        imageUrls: ['https://blob/a.jpg', 'https://blob/b.jpg'],
        csvUrls: ['https://blob/a.csv'],
      }),
    )
    const body = await collectBody(res)
    expect(body.perImageResults).toHaveLength(2)
    expect(body.perImageResults[0].imageUrl).toBe('https://blob/a.jpg')
    expect(body.perImageResults[1].imageUrl).toBe('https://blob/b.jpg')
    expect(body.perImageResults[0].findings).toEqual([
      { issue: 'typo', severity: 'Critical' },
    ])
  })

  it('parses batchFindings and missingDesigns from the single response', async () => {
    mockCsvFetch(CSV_A)
    mockAnthropicResponse({
      statusCheck: { imagesReceived: 1, csvRowCount: 2 },
      perImage: [{ imageIndex: 0, customerName: 'Alice', findings: [] }],
      batchFindings: [
        { scope: 'populating', issue: 'Bob size blank', severity: 'Critical' },
      ],
      missingDesigns: [
        { customerName: 'Bob', rowIndex: 3, issue: 'no matching design' },
      ],
    })
    const res = await handler(
      mkReq({
        jobId: 'J',
        prompt: '# p',
        imageUrls: ['https://blob/a.jpg'],
        csvUrls: ['https://blob/a.csv'],
      }),
    )
    const body = await collectBody(res)
    expect(body.batchFindings).toEqual([
      { scope: 'populating', issue: 'Bob size blank', severity: 'Critical' },
    ])
    expect(body.missingDesigns).toHaveLength(1)
    expect(body.missingDesigns[0].customerName).toBe('Bob')
  })

  it('surfaces malformed JSON as a single parse_error event', async () => {
    mockCsvFetch('')
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'not json at all' }],
    })
    const res = await handler(
      mkReq({
        jobId: 'J',
        prompt: 'x',
        imageUrls: ['https://blob/a.jpg'],
        csvUrls: [],
      }),
    )
    const body = await collectBody(res)
    const err = body.events.find((e) => e.kind === 'parse_error')
    expect(err).toBeTruthy()
  })

  it('handles Anthropic call failure by emitting an error event and still closing the stream', async () => {
    mockCsvFetch('')
    createMock.mockRejectedValue(new Error('model down'))
    const res = await handler(
      mkReq({
        jobId: 'J',
        prompt: 'x',
        imageUrls: ['https://blob/a.jpg'],
        csvUrls: [],
      }),
    )
    const body = await collectBody(res)
    const err = body.events.find((e) => e.kind === 'error')
    expect(err).toBeTruthy()
    expect(err.error).toMatch(/model down/)
    expect(body.events[body.events.length - 1].kind).toBe('done')
  })

  it('empty imageUrls still runs the single call with no image blocks', async () => {
    mockCsvFetch('')
    mockAnthropicResponse({
      statusCheck: { imagesReceived: 0, csvRowCount: 0 },
      perImage: [],
      batchFindings: [],
      missingDesigns: [],
    })
    const res = await handler(
      mkReq({ jobId: 'J', prompt: 'x', imageUrls: [], csvUrls: [] }),
    )
    const body = await collectBody(res)
    expect(body.perImageResults).toEqual([])
    const args = createMock.mock.calls[0][0]
    const imageBlocks = args.messages[0].content.filter(
      (b) => b.type === 'image',
    )
    expect(imageBlocks).toHaveLength(0)
  })
})

describe('Streaming event order', () => {
  it('emits status first, then per-image, batch, missing, persisted, done — in that order', async () => {
    mockCsvFetch(CSV_A)
    mockAnthropicResponse({
      statusCheck: { imagesReceived: 1, csvRowCount: 2 },
      perImage: [{ imageIndex: 0, customerName: 'Alice', findings: [] }],
      batchFindings: [{ scope: 'x', issue: 'batch', severity: 'Minor' }],
      missingDesigns: [{ customerName: 'Bob', rowIndex: 3, issue: 'missing' }],
    })
    const res = await handler(
      mkReq({
        jobId: 'J',
        prompt: 'x',
        imageUrls: ['https://blob/a.jpg'],
        csvUrls: ['https://blob/a.csv'],
      }),
    )
    const body = await collectBody(res)
    const kinds = body.events.map((e) => e.kind)
    expect(kinds[0]).toBe('status')
    expect(kinds[kinds.length - 1]).toBe('done')
    const imgIdx = kinds.indexOf('image')
    const batchIdx = kinds.indexOf('batch')
    const missingIdx = kinds.indexOf('missing')
    const persistIdx = kinds.indexOf('persisted')
    expect(imgIdx).toBeGreaterThan(0)
    expect(batchIdx).toBeGreaterThan(imgIdx)
    expect(missingIdx).toBeGreaterThan(batchIdx)
    expect(persistIdx).toBeGreaterThan(missingIdx)
  })

  it('statusCheck event reflects the requested image + CSV row counts', async () => {
    mockCsvFetch('Name\nAlice\nBob\nCarol\n')
    mockAnthropicResponse(sampleResponse())
    const res = await handler(
      mkReq({
        jobId: 'J',
        prompt: 'x',
        imageUrls: ['https://blob/a.jpg', 'https://blob/b.jpg'],
        csvUrls: ['https://blob/a.csv'],
      }),
    )
    const body = await collectBody(res)
    expect(body.statusCheck.imagesReceived).toBe(2)
    expect(body.statusCheck.csvRowCount).toBe(3)
  })
})

describe('Persistence', () => {
  it('writes results.json + manifest.json to Blob after the run', async () => {
    mockCsvFetch(CSV_A)
    mockAnthropicResponse(sampleResponse())
    const res = await handler(
      mkReq({
        jobId: 'JOB123',
        prompt: '# test prompt',
        imageUrls: ['https://blob/alice.jpg'],
        csvUrls: ['https://blob/a.csv'],
      }),
    )
    await collectBody(res)
    const resultsCall = putMock.mock.calls.find(
      (c) => c[0] === 'jobs/JOB123/results.json',
    )
    expect(resultsCall).toBeTruthy()
    expect(resultsCall[2]?.access).toBe('public')
    const snapshot = JSON.parse(resultsCall[1])
    expect(snapshot.jobId).toBe('JOB123')
    expect(snapshot.prompt).toBe('# test prompt')
    expect(snapshot.imageUrls).toEqual(['https://blob/alice.jpg'])
    expect(snapshot.perImageResults).toHaveLength(1)
    expect(snapshot.perImageResults[0].imageUrl).toBe('https://blob/alice.jpg')

    const manifestCall = putMock.mock.calls.find(
      (c) => c[0] === 'jobs/JOB123/manifest.json',
    )
    expect(manifestCall).toBeTruthy()
  })

  it('emits an error event and persists runError when stop_reason is max_tokens', async () => {
    mockCsvFetch(CSV_A)
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(sampleResponse()) }],
      stop_reason: 'max_tokens',
    })
    const res = await handler(
      mkReq({
        jobId: 'TRUNC',
        prompt: 'x',
        imageUrls: ['https://blob/a.jpg'],
        csvUrls: ['https://blob/a.csv'],
      }),
    )
    const body = await collectBody(res)
    const err = body.events.find((e) => e.kind === 'error')
    expect(err).toBeTruthy()
    expect(err.kind).toBe('error')
    expect(err.subkind).toBe('truncated')
    expect(err.message).toMatch(/max_tokens|truncat/i)

    const snap = JSON.parse(
      putMock.mock.calls.find((c) => c[0] === 'jobs/TRUNC/results.json')[1],
    )
    expect(snap.runError).toBeTruthy()
    expect(snap.runError.kind).toBe('truncated')
  })

  it('persists runError with raw snippet when JSON parse fails', async () => {
    mockCsvFetch('')
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'not json at all' }],
    })
    const res = await handler(
      mkReq({
        jobId: 'PARSEERR',
        prompt: 'x',
        imageUrls: ['https://blob/a.jpg'],
        csvUrls: [],
      }),
    )
    await collectBody(res)
    const snap = JSON.parse(
      putMock.mock.calls.find((c) => c[0] === 'jobs/PARSEERR/results.json')[1],
    )
    expect(snap.runError).toBeTruthy()
    expect(snap.runError.kind).toBe('parse_failed')
    expect(snap.runError.raw).toContain('not json at all')
  })

  it('emits persist_error (but still "done") when put() throws', async () => {
    mockCsvFetch('')
    mockAnthropicResponse(sampleResponse())
    putMock.mockImplementationOnce(async () => {
      throw new Error('blob down')
    })
    const res = await handler(
      mkReq({
        jobId: 'ERR',
        prompt: 'x',
        imageUrls: ['https://blob/a.jpg'],
        csvUrls: [],
      }),
    )
    const body = await collectBody(res)
    expect(body.events.find((e) => e.kind === 'persist_error')).toBeTruthy()
    expect(body.events[body.events.length - 1].kind).toBe('done')
  })
})
