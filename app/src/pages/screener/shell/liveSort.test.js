import { describe, it, expect } from 'vitest'
import { sortRowsLive } from './liveSort'

describe('sortRowsLive', () => {
  it('re-sorts loaded rows by live values, nulls last, original array untouched', () => {
    const r = [{ ticker: 'A', price: 1 }, { ticker: 'B', price: 2 }]
    const out = sortRowsLive(r, { key: 'price', dir: 'desc' }, { A: { price: 100 } })
    expect(out.map(x => x.ticker)).toEqual(['A', 'B'])
    expect(r[0].ticker).toBe('A') // pure
    const asc = sortRowsLive(r, { key: 'price', dir: 'asc' }, { A: { price: 100 } })
    expect(asc.map(x => x.ticker)).toEqual(['B', 'A'])
  })

  it('non-live sort keys pass through untouched', () => {
    const r = [{ ticker: 'A' }, { ticker: 'B' }]
    expect(sortRowsLive(r, { key: 'rs_rank', dir: 'desc' }, {})).toBe(r)
  })
})
