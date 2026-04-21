import { describe, it, expect } from 'vitest'
import {
  normalizeName,
  parseCsvNames,
  reconcileMissing,
} from './reconcile.js'

describe('normalizeName', () => {
  it('lowercases', () => {
    expect(normalizeName('Sarah Johnson')).toBe(normalizeName('sarah johnson'))
  })

  it('collapses whitespace', () => {
    expect(normalizeName('Sarah  Johnson ')).toBe(normalizeName('Sarah Johnson'))
  })

  it('treats "&" and "and" as equivalent', () => {
    expect(normalizeName('Sarah & Tom')).toBe(normalizeName('Sarah and Tom'))
    expect(normalizeName('Sarah & Tom')).toBe(normalizeName('sarah AND tom'))
  })

  it('returns empty string for blank / null', () => {
    expect(normalizeName('')).toBe('')
    expect(normalizeName(null)).toBe('')
    expect(normalizeName(undefined)).toBe('')
  })
})

describe('parseCsvNames', () => {
  it('returns { customerName, rowIndex } for each data row', () => {
    const csv = 'Name,Size\nAlice,Small\nBob,Large\n'
    const rows = parseCsvNames(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ customerName: 'Alice', rowIndex: 2 })
    expect(rows[1]).toEqual({ customerName: 'Bob', rowIndex: 3 })
  })

  it('handles Name column in different positions', () => {
    const csv = 'Size,Name\nSmall,Alice\n'
    const rows = parseCsvNames(csv)
    expect(rows[0].customerName).toBe('Alice')
  })

  it('returns [] when there is no Name column', () => {
    const csv = 'Size,Material\nSmall,Paper\n'
    expect(parseCsvNames(csv)).toEqual([])
  })

  it('returns [] for empty csv', () => {
    expect(parseCsvNames('')).toEqual([])
    expect(parseCsvNames(null)).toEqual([])
  })

  it('skips rows with blank names', () => {
    const csv = 'Name\nAlice\n\nBob\n'
    const rows = parseCsvNames(csv)
    expect(rows.map((r) => r.customerName)).toEqual(['Alice', 'Bob'])
  })
})

describe('reconcileMissing', () => {
  it('emits no findings when every CSV row has a matching extracted label', () => {
    const rows = [
      { customerName: 'Alice', rowIndex: 2 },
      { customerName: 'Bob', rowIndex: 3 },
    ]
    const extracted = [
      { customerName: 'Alice' },
      { customerName: 'Bob' },
    ]
    expect(reconcileMissing(rows, extracted)).toEqual([])
  })

  it('emits one finding per unmatched row', () => {
    const rows = [
      { customerName: 'Alice', rowIndex: 2 },
      { customerName: 'Bob', rowIndex: 3 },
      { customerName: 'Carol', rowIndex: 4 },
    ]
    const extracted = [{ customerName: 'Alice' }]
    const missing = reconcileMissing(rows, extracted)
    expect(missing).toHaveLength(2)
    expect(missing.map((m) => m.customerName).sort()).toEqual(['Bob', 'Carol'])
    missing.forEach((m) => {
      expect(m.kind).toBe('missing')
      expect(m.issue).toMatch(/no matching design/i)
    })
  })

  it('tolerates case/whitespace differences', () => {
    const rows = [{ customerName: 'Sarah Johnson', rowIndex: 2 }]
    const extracted = [{ customerName: 'sarah  johnson' }]
    expect(reconcileMissing(rows, extracted)).toEqual([])
  })

  it('tolerates "&" vs "and"', () => {
    const rows = [{ customerName: 'Sarah & Tom', rowIndex: 2 }]
    const extracted = [{ customerName: 'Sarah and Tom' }]
    expect(reconcileMissing(rows, extracted)).toEqual([])
  })

  it('does NOT fuzzy-match one-letter differences (Mathews vs Middows)', () => {
    const rows = [{ customerName: 'Jeffrey Mathews', rowIndex: 2 }]
    const extracted = [{ customerName: 'Jeffrey Middows' }]
    expect(reconcileMissing(rows, extracted)).toHaveLength(1)
  })

  it('skips extracted entries with empty customerName', () => {
    const rows = [{ customerName: 'Alice', rowIndex: 2 }]
    const extracted = [{ customerName: '' }, { customerName: null }]
    const missing = reconcileMissing(rows, extracted)
    expect(missing).toHaveLength(1)
    expect(missing[0].customerName).toBe('Alice')
  })

  it('matches each CSV row at most once (no double-counting duplicates)', () => {
    const rows = [
      { customerName: 'Alice', rowIndex: 2 },
      { customerName: 'Alice', rowIndex: 3 },
    ]
    const extracted = [{ customerName: 'Alice' }]
    // Only one extracted label → one of the two CSV rows is still missing
    const missing = reconcileMissing(rows, extracted)
    expect(missing).toHaveLength(1)
  })
})
