import { describe, it, expect } from 'vitest'
import { isImageFile } from './isImageFile.js'

describe('isImageFile', () => {
  it('returns true for image/jpeg MIME type', () => {
    expect(isImageFile({ name: 'x.jpg', type: 'image/jpeg' })).toBe(true)
  })

  it('returns true for various MIME types starting with image/', () => {
    expect(isImageFile({ name: 'a', type: 'image/png' })).toBe(true)
    expect(isImageFile({ name: 'a', type: 'image/webp' })).toBe(true)
    expect(isImageFile({ name: 'a', type: 'image/gif' })).toBe(true)
  })

  it('returns true by extension when MIME type is empty', () => {
    expect(isImageFile({ name: 'a.JPG', type: '' })).toBe(true)
    expect(isImageFile({ name: 'a.jpeg', type: '' })).toBe(true)
    expect(isImageFile({ name: 'a.png', type: '' })).toBe(true)
    expect(isImageFile({ name: 'a.heic', type: '' })).toBe(true)
    expect(isImageFile({ name: 'a.svg', type: '' })).toBe(true)
    expect(isImageFile({ name: 'a.webp', type: '' })).toBe(true)
    expect(isImageFile({ name: 'a.bmp', type: '' })).toBe(true)
    expect(isImageFile({ name: 'a.tiff', type: '' })).toBe(true)
  })

  it('returns false for non-image extensions', () => {
    expect(isImageFile({ name: 'a.pdf', type: '' })).toBe(false)
    expect(isImageFile({ name: 'a.txt', type: '' })).toBe(false)
    expect(isImageFile({ name: 'a.csv', type: 'text/csv' })).toBe(false)
    expect(isImageFile({ name: 'a.docx', type: '' })).toBe(false)
  })

  it('returns false for null or undefined', () => {
    expect(isImageFile(null)).toBe(false)
    expect(isImageFile(undefined)).toBe(false)
  })

  it('returns false when both name and type are missing/unrecognized', () => {
    expect(isImageFile({ name: 'noext', type: '' })).toBe(false)
  })
})
