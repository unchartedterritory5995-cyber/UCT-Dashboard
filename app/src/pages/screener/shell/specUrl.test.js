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
    expect(only.rank).toBeNull()
  })

  it('round-trips a ranked scan (e.g. UCT 50) and its top_n cap', () => {
    const rank = { criteria: [{ key: 'uct_composite' }], top_n: 50 }
    const out = decodeSpec(encodeSpec({ filters: {}, view: 'uct_ratings', rank }))
    expect(out.rank).toEqual(rank)
    expect(out.view).toBe('uct_ratings')
  })

  it('carries grouped logic, so a link never opens a broader screen', () => {
    const logic = { any: [
      { key: 'price', op: 'gte', min: 200 },
      { not: { key: 'sector', op: 'in', values: ['Utilities'] } },
      { all: [{ key: 'rsi14', op: 'lt', max: 30 }, { key: 'eps_growth', op: 'gt', min: 25 }] },
    ] }
    const enc = encodeSpec({ filters: {}, logic })
    expect(enc).not.toBeNull()
    expect(decodeSpec(enc).logic).toEqual(logic)
  })

  it('a malformed logic node decodes to null, never to a partial tree', () => {
    const bad = [{ any: [] }, { all: 'x' }, { any: [{ nope: 1 }] }, { all: [1], any: [2] }, [1]]
    for (const lg of bad) {
      const raw = btoa(JSON.stringify({ lg, f: { price: { op: 'gte', min: 1 } } }))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      expect(decodeSpec(raw).logic).toBeNull()
    }
    expect(decodeSpec(encodeSpec({ filters: { p: { op: 'gte', min: 1 } } })).logic).toBeNull()
  })
})
