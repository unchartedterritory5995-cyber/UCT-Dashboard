import { describe, it, expect } from 'vitest'
import { encodeSpec, decodeSpec, DEFAULT_SORT } from './specUrl'

describe('specUrl codec', () => {
  it('round-trips a working screen', () => {
    const spec = {
      filters: { rs_rank: { op: 'gte', min: 80 }, sector: { op: 'eq', value: 'Technology' } },
      sort: { key: 'candle_score', dir: 'desc' },
      view: 'momentum',
      columns: ['ticker', 'price', 'candle_score'],
    }
    const out = decodeSpec(encodeSpec(spec))
    expect(out.filters).toEqual(spec.filters)
    expect(out.sort).toEqual(spec.sort)
    expect(out.view).toBe('momentum')
    expect(out.columns).toEqual(spec.columns)
  })

  it('a default screen encodes to null (clean URL)', () => {
    expect(encodeSpec({ filters: {}, sort: { ...DEFAULT_SORT }, view: 'overview', columns: null })).toBeNull()
  })

  it('malformed input never throws', () => {
    expect(decodeSpec('%%%not-base64%%%')).toBeNull()
    expect(decodeSpec(btoa('[1,2,3]'))).toBeNull()
    expect(decodeSpec('')).toBeNull()
  })

  it('decode fills honest defaults for missing halves', () => {
    const only = decodeSpec(encodeSpec({ filters: { price: { op: 'gte', min: 10 } } }))
    expect(only.sort).toEqual(DEFAULT_SORT)
    expect(only.view).toBe('overview')
    expect(only.columns).toBeNull()
  })
})
