import { describe, it, expect } from 'vitest'
import {
  parseEnvText,
  categorize,
  serializeForPreview,
} from './sync-env-to-vercel.js'

describe('parseEnvText', () => {
  it('parses KEY=VALUE lines', () => {
    expect(parseEnvText('A=1\nB=two\n')).toEqual({ A: '1', B: 'two' })
  })

  it('strips matching double and single quotes', () => {
    expect(parseEnvText('A="hi there"\nB=\'bye\'\n')).toEqual({
      A: 'hi there',
      B: 'bye',
    })
  })

  it('tolerates whitespace around the equals sign', () => {
    expect(parseEnvText('A = "1"\nB =2\n')).toEqual({ A: '1', B: '2' })
  })

  it('skips blank lines and # comments', () => {
    expect(parseEnvText('\n# comment\nA=1\n\n# another\nB=2\n')).toEqual({
      A: '1',
      B: '2',
    })
  })

  it('preserves = and quotes inside an unquoted value', () => {
    expect(parseEnvText('URL=postgres://u:p@h/db?x=1\n')).toEqual({
      URL: 'postgres://u:p@h/db?x=1',
    })
  })

  it('ignores malformed lines', () => {
    expect(parseEnvText('=nope\n???\nA=1\n')).toEqual({ A: '1' })
  })

  it('returns {} for empty input', () => {
    expect(parseEnvText('')).toEqual({})
  })
})

describe('categorize', () => {
  it('splits into unchanged / changed / new', () => {
    const local = { A: '1', B: '2', C: '3' }
    const remote = { A: '1', B: 'different' }
    expect(categorize(local, remote)).toEqual({
      unchanged: ['A'],
      changed: ['B'],
      new: ['C'],
    })
  })

  it('returns empty arrays when perfectly in sync', () => {
    expect(categorize({ A: '1' }, { A: '1' })).toEqual({
      unchanged: ['A'],
      changed: [],
      new: [],
    })
  })

  it('ignores remote-only vars (does not remove them)', () => {
    const out = categorize({ A: '1' }, { A: '1', OLD: 'x' })
    expect(out.unchanged).toEqual(['A'])
    expect(out.changed).toEqual([])
    expect(out.new).toEqual([])
  })

  it('sorts keys alphabetically in each bucket', () => {
    const local = { C: 'c', A: 'a', B: 'b' }
    const out = categorize(local, {})
    expect(out.new).toEqual(['A', 'B', 'C'])
  })
})

describe('serializeForPreview', () => {
  it('masks values in the printed summary', () => {
    const line = serializeForPreview('MY_SECRET', 'super-secret-123')
    expect(line).toContain('MY_SECRET')
    expect(line).not.toContain('super-secret-123')
    // Shows a hint of length so a sanity check is possible
    expect(line).toMatch(/16 chars|len=/i)
  })

  it('never prints the raw value, even for short values', () => {
    const line = serializeForPreview('X', 'hi')
    expect(line).not.toContain('hi')
  })
})
