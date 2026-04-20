import { describe, it, expect, vi, beforeEach } from 'vitest'

const uploadMock = vi.fn()
vi.mock('@vercel/blob/client', () => ({
  upload: (...args) => uploadMock(...args),
}))

let uploadFiles
beforeEach(async () => {
  uploadMock.mockReset()
  vi.resetModules()
  uploadFiles = (await import('./upload.js')).uploadFiles
})

function mkFile(name, size = 1, type = 'image/jpeg') {
  return { name, size, type }
}

function resolveWith(url) {
  return Promise.resolve({ url, pathname: url.replace('https://blob/', '') })
}

describe('uploadFiles', () => {
  it('calls upload() once per file with jobs/{jobId}/... pathname', async () => {
    uploadMock.mockImplementation((pathname) => resolveWith('https://blob/' + pathname))
    const files = [mkFile('a.jpg'), mkFile('b.png')]
    const result = await uploadFiles({ jobId: 'JOB', kind: 'images', files })
    expect(uploadMock).toHaveBeenCalledTimes(2)
    const pathnames = uploadMock.mock.calls.map((c) => c[0])
    expect(pathnames[0]).toMatch(/^jobs\/JOB\/images\/.+-a\.jpg$/)
    expect(pathnames[1]).toMatch(/^jobs\/JOB\/images\/.+-b\.png$/)
    expect(result).toHaveLength(2)
    expect(result[0].url).toContain('jobs/JOB/images/')
  })

  it('sanitizes filenames: strips "../" and collapses whitespace to "-"', async () => {
    uploadMock.mockImplementation((pathname) => resolveWith('https://blob/' + pathname))
    await uploadFiles({
      jobId: 'JOB',
      kind: 'images',
      files: [mkFile('../etc/passwd  bad name.jpg')],
    })
    const pathname = uploadMock.mock.calls[0][0]
    expect(pathname).not.toContain('..')
    expect(pathname).not.toContain(' ')
    expect(pathname).toMatch(/etc-passwd-bad-name\.jpg$/)
  })

  it('passes access: public and handleUploadUrl', async () => {
    uploadMock.mockImplementation((_p, _f, opts) => {
      expect(opts.access).toBe('public')
      expect(opts.handleUploadUrl).toBe('/api/upload-token')
      return resolveWith('https://blob/x')
    })
    await uploadFiles({ jobId: 'J', kind: 'images', files: [mkFile('a.jpg')] })
  })

  it('respects concurrency cap of 6 with 20 files', async () => {
    let inFlight = 0
    let max = 0
    uploadMock.mockImplementation(async (pathname) => {
      inFlight++
      max = Math.max(max, inFlight)
      await new Promise((r) => setTimeout(r, 10))
      inFlight--
      return { url: 'https://blob/' + pathname, pathname }
    })
    const files = Array.from({ length: 20 }, (_, i) => mkFile(`f${i}.jpg`))
    await uploadFiles({ jobId: 'J', kind: 'images', files })
    expect(max).toBeLessThanOrEqual(6)
    expect(uploadMock).toHaveBeenCalledTimes(20)
  })

  it('returns results in input order even if uploads resolve out of order', async () => {
    uploadMock.mockImplementation(async (pathname) => {
      const delay = pathname.includes('a.jpg') ? 30 : 1
      await new Promise((r) => setTimeout(r, delay))
      return { url: 'https://blob/' + pathname, pathname }
    })
    const files = [mkFile('a.jpg'), mkFile('b.jpg')]
    const result = await uploadFiles({ jobId: 'J', kind: 'images', files })
    expect(result[0].name).toBe('a.jpg')
    expect(result[1].name).toBe('b.jpg')
  })

  it('surfaces individual upload failures as { name, error }', async () => {
    uploadMock.mockImplementation(async (pathname) => {
      if (pathname.includes('fail')) throw new Error('nope')
      return { url: 'https://blob/' + pathname, pathname }
    })
    const files = [mkFile('ok.jpg'), mkFile('fail.jpg')]
    const result = await uploadFiles({ jobId: 'J', kind: 'images', files })
    expect(result[0].error).toBeUndefined()
    expect(result[0].url).toBeTruthy()
    expect(result[1].error).toBeInstanceOf(Error)
    expect(result[1].url).toBeUndefined()
  })

  it('uses kind="csvs" path when uploading CSVs', async () => {
    uploadMock.mockImplementation((pathname) => resolveWith('https://blob/' + pathname))
    await uploadFiles({ jobId: 'J', kind: 'csvs', files: [mkFile('orders.csv')] })
    expect(uploadMock.mock.calls[0][0]).toMatch(/^jobs\/J\/csvs\/.+-orders\.csv$/)
  })
})
