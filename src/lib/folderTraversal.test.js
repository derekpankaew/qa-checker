import { describe, it, expect } from 'vitest'
import { readEntry } from './folderTraversal.js'

function fakeFile(name, type = '') {
  return { name, type, size: 1 }
}

function fileEntry(name, type = '') {
  const file = fakeFile(name, type)
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (cb) => cb(file),
  }
}

function dirEntry(name, children) {
  let called = false
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (cb) => {
        if (!called) {
          called = true
          cb(children)
        } else {
          cb([])
        }
      },
    }),
  }
}

describe('readEntry', () => {
  it('returns a single file with no prefix for a flat file entry', async () => {
    const entry = fileEntry('a.jpg')
    const result = await readEntry(entry)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('a.jpg')
    expect(result[0].relativePath).toBeUndefined()
  })

  it('walks a flat directory with 3 images and prefixes relative paths', async () => {
    const entry = dirEntry('batch', [
      fileEntry('a.jpg'),
      fileEntry('b.png'),
      fileEntry('c.gif'),
    ])
    const result = await readEntry(entry)
    expect(result).toHaveLength(3)
    expect(result.map((f) => f.relativePath)).toEqual([
      'batch/a.jpg',
      'batch/b.png',
      'batch/c.gif',
    ])
  })

  it('recurses into nested directories (2 levels)', async () => {
    const entry = dirEntry('root', [
      fileEntry('top.jpg'),
      dirEntry('sub', [fileEntry('nested.png')]),
    ])
    const result = await readEntry(entry)
    expect(result).toHaveLength(2)
    expect(result.map((f) => f.relativePath).sort()).toEqual(
      ['root/sub/nested.png', 'root/top.jpg'].sort(),
    )
  })

  it('preserves non-image files (filtering happens downstream)', async () => {
    const entry = dirEntry('mix', [fileEntry('a.jpg'), fileEntry('notes.txt')])
    const result = await readEntry(entry)
    const names = result.map((f) => f.name).sort()
    expect(names).toEqual(['a.jpg', 'notes.txt'])
  })

  it('returns empty array for an empty directory', async () => {
    const entry = dirEntry('empty', [])
    const result = await readEntry(entry)
    expect(result).toEqual([])
  })

  it('calls readEntries in batches until empty (pagination contract)', async () => {
    let call = 0
    const entry = {
      isFile: false,
      isDirectory: true,
      name: 'paged',
      createReader: () => ({
        readEntries: (cb) => {
          call++
          if (call === 1) cb([fileEntry('a.jpg')])
          else if (call === 2) cb([fileEntry('b.jpg')])
          else cb([])
        },
      }),
    }
    const result = await readEntry(entry)
    expect(result).toHaveLength(2)
    expect(call).toBeGreaterThanOrEqual(3)
  })

  it('propagates rejection when file() errors', async () => {
    const entry = {
      isFile: true,
      isDirectory: false,
      name: 'broken.jpg',
      file: (_cb, errCb) => errCb(new Error('boom')),
    }
    await expect(readEntry(entry)).rejects.toThrow('boom')
  })
})
