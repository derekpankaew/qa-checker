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

/* Mock @vercel/blob put for results.json persistence (later steps) */
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
  handler = (await import('./run-qa.js')).default
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
  // Prefer NDJSON streaming. If the body is JSON (non-streamed), fall back.
  const cloned = res.clone()
  try {
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
  } catch {
    return cloned.json()
  }
}

function mockAnthropicReturns(json) {
  createMock.mockImplementation(async () => ({
    content: [{ type: 'text', text: JSON.stringify(json) }],
  }))
}

function mockCsvFetch(text) {
  fetchMock.mockImplementation(() => Promise.resolve(new Response(text)))
}

const CSV_A = 'Name,Size,Material\nAlice,Small,Paper\nBob,Large,Cotton\n'
const CSV_B = 'Name,Size\nCarol,Small\n'

describe('Step 3: shared prefix + single per-image call', () => {
  it('fetches each CSV URL exactly once', async () => {
    mockAnthropicReturns({ findings: [], extractedLabel: { customerName: 'Alice' } })
    fetchMock
      .mockResolvedValueOnce(new Response(CSV_A))
      .mockResolvedValueOnce(new Response(CSV_B))
    await handler(
      mkReq({
        jobId: 'J1',
        prompt: '# QA',
        imageUrls: ['https://blob/img1.jpg'],
        csvUrls: ['https://blob/a.csv', 'https://blob/b.csv'],
      }),
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('https://blob/a.csv')
    expect(fetchMock.mock.calls[1][0]).toBe('https://blob/b.csv')
  })

  it('constructs the shared prefix with prompt + full raw CSV + cache_control', async () => {
    mockAnthropicReturns({ findings: [], extractedLabel: {} })
    mockCsvFetch(CSV_A)

    await handler(
      mkReq({
        jobId: 'J1',
        prompt: '# MY QA PROMPT',
        imageUrls: ['https://blob/img1.jpg'],
        csvUrls: ['https://blob/a.csv'],
      }),
    )

    expect(createMock).toHaveBeenCalled()
    const args = createMock.mock.calls[0][0]

    // system should contain the prompt
    const systemText = Array.isArray(args.system)
      ? args.system.map((b) => b.text).join('\n')
      : args.system
    expect(systemText).toContain('# MY QA PROMPT')
    expect(systemText).toContain('Alice')
    expect(systemText).toContain('Material')

    // at least one system block must carry cache_control ephemeral
    const systemBlocks = Array.isArray(args.system) ? args.system : []
    const hasCacheControl = systemBlocks.some(
      (b) => b.cache_control && b.cache_control.type === 'ephemeral',
    )
    expect(hasCacheControl).toBe(true)
  })

  it('concatenates multiple CSVs with a header divider', async () => {
    mockAnthropicReturns({ findings: [], extractedLabel: {} })
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
    const args = createMock.mock.calls[0][0]
    const systemText = Array.isArray(args.system)
      ? args.system.map((b) => b.text).join('\n')
      : args.system
    expect(systemText).toContain('Alice')
    expect(systemText).toContain('Carol')
    expect(systemText).toMatch(/csv|CSV|---/i)
  })

  it('attaches an image URL content block for the per-image call', async () => {
    mockAnthropicReturns({ findings: [], extractedLabel: {} })
    mockCsvFetch(CSV_A)

    await handler(
      mkReq({
        jobId: 'J',
        prompt: '# p',
        imageUrls: ['https://blob/img42.jpg'],
        csvUrls: [],
      }),
    )

    // The first call is Pass A (per-image); it may or may not be call #0 depending
    // on batch-overview ordering. Find the call whose messages contain an image block.
    const imageCalls = createMock.mock.calls.filter((c) => {
      const msgs = c[0].messages || []
      return msgs.some(
        (m) =>
          Array.isArray(m.content) &&
          m.content.some((b) => b.type === 'image'),
      )
    })
    expect(imageCalls.length).toBe(1)
    const msg = imageCalls[0][0].messages[0]
    const imageBlock = msg.content.find((b) => b.type === 'image')
    expect(imageBlock.source.type).toBe('url')
    expect(imageBlock.source.url).toBe('https://blob/img42.jpg')
  })

  it('parses JSON findings + extractedLabel from model response', async () => {
    const modelOut = {
      findings: [{ issue: 'typo', severity: 'Critical' }],
      extractedLabel: { customerName: 'Alice', size: 'Small' },
    }
    mockAnthropicReturns(modelOut)
    mockCsvFetch(CSV_A)

    const res = await handler(
      mkReq({
        jobId: 'J',
        prompt: '# p',
        imageUrls: ['https://blob/img.jpg'],
        csvUrls: ['https://blob/a.csv'],
      }),
    )
    const json = await collectBody(res)
    const per = json.perImageResults.find(
      (r) => r.imageUrl === 'https://blob/img.jpg',
    )
    expect(per).toBeTruthy()
    expect(per.findings).toEqual(modelOut.findings)
    expect(per.extractedLabel.customerName).toBe('Alice')
  })

  it('with no images, still runs batch-overview but no per-image calls', async () => {
    mockAnthropicReturns({ findings: [] })
    mockCsvFetch('')
    const res = await handler(
      mkReq({ jobId: 'J', prompt: 'x', imageUrls: [], csvUrls: [] }),
    )
    const json = await collectBody(res)
    expect(json.perImageResults).toEqual([])
    const imageCalls = createMock.mock.calls.filter((c) =>
      (c[0].messages || []).some(
        (m) =>
          Array.isArray(m.content) &&
          m.content.some((b) => b.type === 'image'),
      ),
    )
    expect(imageCalls).toHaveLength(0)
  })
})

describe('Step 4: Pass A parallel fan-out', () => {
  it('calls messages.create once per image URL', async () => {
    mockAnthropicReturns({ findings: [], extractedLabel: {} })
    mockCsvFetch('')
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
    const imageCalls = createMock.mock.calls.filter((c) =>
      (c[0].messages || []).some(
        (m) =>
          Array.isArray(m.content) &&
          m.content.some((b) => b.type === 'image'),
      ),
    )
    expect(imageCalls).toHaveLength(3)
  })

  it('respects concurrency cap of 10 on image calls with 25 images', async () => {
    mockCsvFetch('')
    let imageInFlight = 0
    let maxImage = 0
    createMock.mockImplementation(async ({ messages }) => {
      const isImage = messages[0].content.some((b) => b.type === 'image')
      if (isImage) {
        imageInFlight++
        maxImage = Math.max(maxImage, imageInFlight)
      }
      await new Promise((r) => setTimeout(r, 5))
      if (isImage) imageInFlight--
      return { content: [{ type: 'text', text: '{"findings":[],"extractedLabel":{}}' }] }
    })
    const imageUrls = Array.from(
      { length: 25 },
      (_, i) => `https://blob/img${i}.jpg`,
    )
    await handler(
      mkReq({ jobId: 'J', prompt: 'x', imageUrls, csvUrls: [] }),
    )
    expect(maxImage).toBeLessThanOrEqual(10)
  })

  it('returns per-image results for every image even if order differs', async () => {
    mockCsvFetch('')
    createMock.mockImplementation(async ({ messages }) => {
      const imgBlock = messages[0].content.find((b) => b.type === 'image')
      const delay = imgBlock.source.url.includes('slow') ? 30 : 1
      await new Promise((r) => setTimeout(r, delay))
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              findings: [],
              extractedLabel: { customerName: imgBlock.source.url },
            }),
          },
        ],
      }
    })
    const res = await handler(
      mkReq({
        jobId: 'J',
        prompt: 'x',
        imageUrls: [
          'https://blob/slow.jpg',
          'https://blob/fast1.jpg',
          'https://blob/fast2.jpg',
        ],
        csvUrls: [],
      }),
    )
    const json = await collectBody(res)
    const urls = json.perImageResults.map((r) => r.imageUrl).sort()
    expect(urls).toEqual([
      'https://blob/fast1.jpg',
      'https://blob/fast2.jpg',
      'https://blob/slow.jpg',
    ])
  })

  it('isolates per-image failures: other images still succeed', async () => {
    mockCsvFetch('')
    createMock.mockImplementation(async ({ messages }) => {
      const imgBlock = messages[0].content.find((b) => b.type === 'image')
      if (imgBlock.source.url.includes('fail')) throw new Error('boom')
      return {
        content: [
          { type: 'text', text: '{"findings":[],"extractedLabel":{}}' },
        ],
      }
    })
    const res = await handler(
      mkReq({
        jobId: 'J',
        prompt: 'x',
        imageUrls: ['https://blob/ok.jpg', 'https://blob/fail.jpg'],
        csvUrls: [],
      }),
    )
    const json = await collectBody(res)
    expect(json.perImageResults).toHaveLength(2)
    const failed = json.perImageResults.find((r) =>
      r.imageUrl.includes('fail'),
    )
    const ok = json.perImageResults.find((r) => r.imageUrl.includes('ok'))
    expect(failed.error).toBeTruthy()
    expect(ok.findings).toEqual([])
  })

  it('surfaces malformed JSON responses as parse_failed', async () => {
    mockCsvFetch('')
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'not json at all' }],
    })
    const res = await handler(
      mkReq({
        jobId: 'J',
        prompt: 'x',
        imageUrls: ['https://blob/x.jpg'],
        csvUrls: [],
      }),
    )
    const json = await collectBody(res)
    expect(json.perImageResults[0].error).toMatch(/parse|json/i)
  })
})

describe('Step 5: Pass B batch-overview call', () => {
  it('makes exactly one no-image call with the shared prefix', async () => {
    mockCsvFetch(CSV_A)
    createMock.mockImplementation(async ({ messages }) => {
      const hasImage = messages[0].content.some((b) => b.type === 'image')
      const text = hasImage
        ? '{"findings":[],"extractedLabel":{"customerName":"Alice"}}'
        : '{"findings":[{"issue":"populating error on Bob","severity":"Critical"}]}'
      return { content: [{ type: 'text', text }] }
    })
    await handler(
      mkReq({
        jobId: 'J',
        prompt: '# p',
        imageUrls: ['https://blob/img.jpg'],
        csvUrls: ['https://blob/a.csv'],
      }),
    )
    const noImageCalls = createMock.mock.calls.filter((c) => {
      const msgs = c[0].messages || []
      return !msgs.some(
        (m) =>
          Array.isArray(m.content) &&
          m.content.some((b) => b.type === 'image'),
      )
    })
    expect(noImageCalls).toHaveLength(1)
  })

  it('batch instruction references sections 4.17, 4.21, and status check', async () => {
    mockCsvFetch('')
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"findings":[]}' }],
    })
    await handler(
      mkReq({ jobId: 'J', prompt: 'x', imageUrls: [], csvUrls: [] }),
    )
    const batchCall = createMock.mock.calls.find((c) => {
      const msgs = c[0].messages || []
      return !msgs.some(
        (m) =>
          Array.isArray(m.content) &&
          m.content.some((b) => b.type === 'image'),
      )
    })
    expect(batchCall).toBeTruthy()
    const userText = batchCall[0].messages[0].content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
    expect(userText).toMatch(/4\.17|similar names/i)
    expect(userText).toMatch(/4\.21|populating/i)
    expect(userText).toMatch(/status|image count/i)
  })

  it('includes image count in the batch instruction', async () => {
    mockCsvFetch('')
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"findings":[]}' }],
    })
    await handler(
      mkReq({
        jobId: 'J',
        prompt: 'x',
        imageUrls: ['https://blob/1.jpg', 'https://blob/2.jpg', 'https://blob/3.jpg'],
        csvUrls: [],
      }),
    )
    const batchCall = createMock.mock.calls.find((c) => {
      const msgs = c[0].messages || []
      return !msgs.some(
        (m) =>
          Array.isArray(m.content) &&
          m.content.some((b) => b.type === 'image'),
      )
    })
    const userText = batchCall[0].messages[0].content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
    expect(userText).toContain('3')
  })

  it('returns batchFindings in the response body', async () => {
    mockCsvFetch(CSV_A)
    createMock.mockImplementation(async ({ messages }) => {
      const hasImage = messages[0].content.some((b) => b.type === 'image')
      const text = hasImage
        ? '{"findings":[],"extractedLabel":{"customerName":"Alice"}}'
        : '{"findings":[{"scope":"batch","issue":"similar names","severity":"Critical"}]}'
      return { content: [{ type: 'text', text }] }
    })
    const res = await handler(
      mkReq({
        jobId: 'J',
        prompt: '# p',
        imageUrls: ['https://blob/img.jpg'],
        csvUrls: ['https://blob/a.csv'],
      }),
    )
    const json = await collectBody(res)
    expect(json.batchFindings).toBeTruthy()
    expect(Array.isArray(json.batchFindings)).toBe(true)
    expect(json.batchFindings.some((f) => /similar/i.test(f.issue))).toBe(true)
  })

  it('returns missingDesigns for CSV rows with no matching extractedLabel', async () => {
    mockCsvFetch('Name,Size\nAlice,Small\nBob,Large\nCarol,Small\n')
    createMock.mockImplementation(async ({ messages }) => {
      const hasImage = messages[0].content.some((b) => b.type === 'image')
      const text = hasImage
        ? '{"findings":[],"extractedLabel":{"customerName":"Alice"}}'
        : '{"findings":[]}'
      return { content: [{ type: 'text', text }] }
    })
    const res = await handler(
      mkReq({
        jobId: 'J',
        prompt: 'x',
        imageUrls: ['https://blob/alice.jpg'],
        csvUrls: ['https://blob/a.csv'],
      }),
    )
    const json = await collectBody(res)
    expect(json.missingDesigns).toBeTruthy()
    const missingNames = json.missingDesigns.map((m) => m.customerName).sort()
    expect(missingNames).toEqual(['Bob', 'Carol'])
  })

  it('statusCheck event is the first line in the stream', async () => {
    mockCsvFetch('Name\nAlice\n')
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"findings":[],"extractedLabel":{"customerName":"Alice"}}' }],
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
    expect(body.events[0].kind).toBe('status')
    expect(body.events[0].imagesReceived).toBe(1)
    expect(body.events[0].csvRowCount).toBe(1)
  })

  it('emits per-image events as each image finishes (not all at once)', async () => {
    mockCsvFetch('')
    // a.jpg takes much longer than b.jpg; b.jpg should appear first.
    createMock.mockImplementation(async ({ messages }) => {
      const hasImage = messages[0].content.some((b) => b.type === 'image')
      if (!hasImage) {
        return { content: [{ type: 'text', text: '{"findings":[]}' }] }
      }
      const img = messages[0].content.find((b) => b.type === 'image')
      const url = img.source.url
      const delay = url.includes('a.jpg') ? 50 : 1
      await new Promise((r) => setTimeout(r, delay))
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              findings: [{ issue: url }],
              extractedLabel: {},
            }),
          },
        ],
      }
    })
    const res = await handler(
      mkReq({
        jobId: 'J',
        prompt: 'x',
        imageUrls: ['https://blob/a.jpg', 'https://blob/b.jpg'],
        csvUrls: [],
      }),
    )
    const body = await collectBody(res)
    const imageEvents = body.events.filter((e) => e.kind === 'image')
    expect(imageEvents).toHaveLength(2)
    expect(imageEvents[0].imageUrl).toBe('https://blob/b.jpg')
    expect(imageEvents[1].imageUrl).toBe('https://blob/a.jpg')
  })

  it('ends the stream with a done sentinel', async () => {
    mockCsvFetch('')
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"findings":[],"extractedLabel":{}}' }],
    })
    const res = await handler(
      mkReq({ jobId: 'J', prompt: 'x', imageUrls: [], csvUrls: [] }),
    )
    const body = await collectBody(res)
    expect(body.events[body.events.length - 1].kind).toBe('done')
  })

  it('runs Pass A and Pass B in parallel (total time ≈ max single, not sum)', async () => {
    mockCsvFetch('')
    createMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50))
      return { content: [{ type: 'text', text: '{"findings":[],"extractedLabel":{}}' }] }
    })
    const start = Date.now()
    await handler(
      mkReq({
        jobId: 'J',
        prompt: 'x',
        imageUrls: ['https://blob/1.jpg', 'https://blob/2.jpg'],
        csvUrls: [],
      }),
    )
    const elapsed = Date.now() - start
    // 3 parallel calls (2 image + 1 batch) at 50ms each should finish well
    // under the sum (150ms). Cap at ~130ms to allow test runner overhead.
    expect(elapsed).toBeLessThan(130)
  })
})

describe('Step 8: persistence of results.json + manifest.json', () => {
  it('writes jobs/{jobId}/results.json to Blob with access: public', async () => {
    mockCsvFetch('Name\nAlice\n')
    createMock.mockImplementation(async ({ messages }) => {
      const hasImage = messages[0].content.some((b) => b.type === 'image')
      const text = hasImage
        ? '{"findings":[],"extractedLabel":{"customerName":"Alice"}}'
        : '{"findings":[]}'
      return { content: [{ type: 'text', text }] }
    })
    const res = await handler(
      mkReq({
        jobId: 'JOB123',
        prompt: '# test prompt',
        imageUrls: ['https://blob/alice.jpg'],
        csvUrls: ['https://blob/a.csv'],
      }),
    )
    await collectBody(res)
    expect(putMock).toHaveBeenCalled()
    const resultsCall = putMock.mock.calls.find(
      (c) => c[0] === 'jobs/JOB123/results.json',
    )
    expect(resultsCall).toBeTruthy()
    const opts = resultsCall[2] || {}
    expect(opts.access).toBe('public')
  })

  it('results.json snapshots prompt, inputs, per-image, batch, missing, status, createdAt', async () => {
    mockCsvFetch('Name\nAlice\nBob\n')
    createMock.mockImplementation(async ({ messages }) => {
      const hasImage = messages[0].content.some((b) => b.type === 'image')
      const text = hasImage
        ? '{"findings":[{"issue":"typo"}],"extractedLabel":{"customerName":"Alice"}}'
        : '{"findings":[{"scope":"populating","issue":"Bob missing size"}]}'
      return { content: [{ type: 'text', text }] }
    })
    const res = await handler(
      mkReq({
        jobId: 'JOB',
        prompt: '# snapshot me',
        imageUrls: ['https://blob/alice.jpg'],
        csvUrls: ['https://blob/a.csv'],
      }),
    )
    await collectBody(res)
    const resultsCall = putMock.mock.calls.find(
      (c) => c[0] === 'jobs/JOB/results.json',
    )
    expect(resultsCall).toBeTruthy()
    const snapshot = JSON.parse(resultsCall[1])
    expect(snapshot.jobId).toBe('JOB')
    expect(snapshot.prompt).toBe('# snapshot me')
    expect(snapshot.imageUrls).toEqual(['https://blob/alice.jpg'])
    expect(snapshot.csvUrls).toEqual(['https://blob/a.csv'])
    expect(snapshot.createdAt).toBeTruthy()
    expect(() => new Date(snapshot.createdAt)).not.toThrow()
    expect(snapshot.statusCheck).toBeTruthy()
    expect(snapshot.statusCheck.imagesReceived).toBe(1)
    expect(snapshot.statusCheck.csvRowCount).toBe(2)
    expect(snapshot.perImageResults).toHaveLength(1)
    expect(snapshot.perImageResults[0].imageUrl).toBe(
      'https://blob/alice.jpg',
    )
    expect(snapshot.batchFindings.length).toBeGreaterThan(0)
    expect(snapshot.missingDesigns.map((m) => m.customerName)).toEqual(['Bob'])
  })

  it('also writes jobs/{jobId}/manifest.json with inputs + timestamp', async () => {
    mockCsvFetch('')
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"findings":[],"extractedLabel":{}}' }],
    })
    const res = await handler(
      mkReq({
        jobId: 'JOBM',
        prompt: '# p',
        imageUrls: ['https://blob/x.jpg'],
        csvUrls: ['https://blob/x.csv'],
      }),
    )
    await collectBody(res)
    const manifestCall = putMock.mock.calls.find(
      (c) => c[0] === 'jobs/JOBM/manifest.json',
    )
    expect(manifestCall).toBeTruthy()
    const manifest = JSON.parse(manifestCall[1])
    expect(manifest.jobId).toBe('JOBM')
    expect(manifest.imageUrls).toEqual(['https://blob/x.jpg'])
    expect(manifest.csvUrls).toEqual(['https://blob/x.csv'])
    expect(manifest.createdAt).toBeTruthy()
  })

  it('persists even when all images fail', async () => {
    mockCsvFetch('')
    createMock.mockRejectedValue(new Error('model down'))
    const res = await handler(
      mkReq({
        jobId: 'FAILJ',
        prompt: '# p',
        imageUrls: ['https://blob/a.jpg'],
        csvUrls: [],
      }),
    )
    await collectBody(res)
    const call = putMock.mock.calls.find(
      (c) => c[0] === 'jobs/FAILJ/results.json',
    )
    expect(call).toBeTruthy()
    const snapshot = JSON.parse(call[1])
    expect(snapshot.perImageResults[0].error).toBeTruthy()
  })

  it('emits a persisted event after writes succeed', async () => {
    mockCsvFetch('')
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"findings":[],"extractedLabel":{}}' }],
    })
    const res = await handler(
      mkReq({
        jobId: 'P',
        prompt: 'x',
        imageUrls: ['https://blob/a.jpg'],
        csvUrls: [],
      }),
    )
    const body = await collectBody(res)
    const persistedEvent = body.events.find((e) => e.kind === 'persisted')
    expect(persistedEvent).toBeTruthy()
    expect(persistedEvent.jobId).toBe('P')
    expect(persistedEvent.resultsUrl).toBeTruthy()
  })

  it('does not abort the stream if persistence throws — surfaces persist_error', async () => {
    mockCsvFetch('')
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"findings":[],"extractedLabel":{}}' }],
    })
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
    const err = body.events.find((e) => e.kind === 'persist_error')
    expect(err).toBeTruthy()
    // done event still emitted — stream closes cleanly
    expect(body.events[body.events.length - 1].kind).toBe('done')
  })
})
