import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeResizedDimensions, resizeImageIfNeeded } from './resizeImage.js'

describe('computeResizedDimensions', () => {
  it('returns original dimensions when both are within the max', () => {
    expect(computeResizedDimensions(1000, 500, 2000)).toEqual({
      width: 1000,
      height: 500,
      scaled: false,
    })
  })

  it('returns original when exactly at the max', () => {
    expect(computeResizedDimensions(2000, 2000, 2000)).toEqual({
      width: 2000,
      height: 2000,
      scaled: false,
    })
  })

  it('scales proportionally when width exceeds the max', () => {
    const out = computeResizedDimensions(4000, 2000, 2000)
    expect(out.width).toBe(2000)
    expect(out.height).toBe(1000)
    expect(out.scaled).toBe(true)
  })

  it('scales proportionally when height exceeds the max', () => {
    const out = computeResizedDimensions(1500, 3000, 2000)
    expect(out.width).toBe(1000)
    expect(out.height).toBe(2000)
    expect(out.scaled).toBe(true)
  })

  it('rounds to integer pixels', () => {
    const out = computeResizedDimensions(3333, 2222, 2000)
    expect(Number.isInteger(out.width)).toBe(true)
    expect(Number.isInteger(out.height)).toBe(true)
  })

  it('handles very small images untouched', () => {
    expect(computeResizedDimensions(100, 50, 2000)).toEqual({
      width: 100,
      height: 50,
      scaled: false,
    })
  })
})

/* Tests for the File-in / File-out wrapper. Mock Image decode + canvas
   export since jsdom doesn't actually decode images or produce bitmaps. */
describe('resizeImageIfNeeded', () => {
  let mockImage

  beforeEach(() => {
    // Stub Image: tests set mockImage.width/height before triggering onload.
    mockImage = { width: 0, height: 0, onload: null, onerror: null }
    vi.stubGlobal(
      'Image',
      class {
        constructor() {
          Object.assign(this, mockImage)
          setTimeout(() => {
            mockImage = this
            this.onload?.()
          }, 0)
        }
        set src(_) {}
      },
    )
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:fake'),
      revokeObjectURL: vi.fn(),
    })
    // jsdom's canvas is a stub. Replace createElement('canvas') with a fake
    // that implements just enough of the 2D API + toBlob for the resizer.
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag !== 'canvas') return realCreate(tag)
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {} }),
        toBlob: (cb, type) =>
          cb(new Blob([new Uint8Array([9, 9, 9])], { type: type || 'image/jpeg' })),
      }
    })
  })

  function makeFile(name, type = 'image/jpeg', width = 3000, height = 1500) {
    mockImage = { width, height }
    const f = new File([new Uint8Array([1, 2, 3])], name, { type })
    return f
  }

  it('returns the file unchanged for non-image types (CSV)', async () => {
    const csv = new File(['a,b,c'], 'orders.csv', { type: 'text/csv' })
    const out = await resizeImageIfNeeded(csv)
    expect(out).toBe(csv)
  })

  it('returns SVG unchanged (vector, no pixel limits)', async () => {
    const svg = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })
    const out = await resizeImageIfNeeded(svg)
    expect(out).toBe(svg)
  })

  it('returns the file unchanged when both dimensions are within the limit', async () => {
    const f = makeFile('small.jpg', 'image/jpeg', 1000, 800)
    const out = await resizeImageIfNeeded(f)
    expect(out).toBe(f)
  })

  it('returns a new File when either dimension exceeds the limit', async () => {
    const f = makeFile('big.jpg', 'image/jpeg', 4000, 2000)
    const out = await resizeImageIfNeeded(f)
    expect(out).not.toBe(f)
    expect(out.name).toBe('big.jpg')
  })

  it('preserves the relativePath property on resized files', async () => {
    const f = makeFile('nested/big.jpg', 'image/jpeg', 4000, 2000)
    Object.defineProperty(f, 'relativePath', {
      value: 'batch/nested/big.jpg',
      enumerable: true,
    })
    const out = await resizeImageIfNeeded(f)
    expect(out.relativePath).toBe('batch/nested/big.jpg')
  })

  it('returns the original file when image decode fails (graceful degradation)', async () => {
    vi.stubGlobal(
      'Image',
      class {
        constructor() {
          setTimeout(() => this.onerror?.(new Error('decode')), 0)
        }
        set src(_) {}
      },
    )
    const f = new File([new Uint8Array([1])], 'weird.heic', {
      type: 'image/heic',
    })
    const out = await resizeImageIfNeeded(f)
    expect(out).toBe(f)
  })
})
