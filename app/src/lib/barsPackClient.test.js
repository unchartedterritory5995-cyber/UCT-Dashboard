import { describe, it, expect } from 'vitest'
import { decodeShardPayload, _shardIdx } from './barsPackClient'

// The decode must round-trip the SERVER columnar encoding back to the exact
// [{t,o,h,l,c,v}] rows idbImportPack stores. This mirrors the Python builder's
// _columnar (tests/test_barspack.py) from the other side.
function columnar(bars) {
  return {
    t: bars.map(b => b.t), o: bars.map(b => b.o), h: bars.map(b => b.h),
    l: bars.map(b => b.l), c: bars.map(b => b.c), v: bars.map(b => b.v),
  }
}

describe('decodeShardPayload', () => {
  it('reconstructs rows byte-identical to the source bars', () => {
    const aaplD = [
      { t: '2026-08-12', o: 1.1, h: 2.2, l: 0.9, c: 1.8, v: 1000 },
      { t: '2026-08-13', o: 1.8, h: 2.4, l: 1.5, c: 2.0, v: 2000 },
    ]
    const aaplW = [{ t: '2026-08-14', o: 1.1, h: 2.4, l: 0.9, c: 2.0, v: 3000 }]
    const obj = { format: 1, tickers: { AAPL: { D: columnar(aaplD), W: columnar(aaplW) } } }

    const entries = decodeShardPayload(obj)
    expect(entries).toContainEqual({ sym: 'AAPL', tf: 'D', bars: aaplD })
    expect(entries).toContainEqual({ sym: 'AAPL', tf: 'W', bars: aaplW })
    expect(entries).toHaveLength(2)  // no M entry emitted when absent
  })

  it('is defensive against missing/empty structures', () => {
    expect(decodeShardPayload(null)).toEqual([])
    expect(decodeShardPayload({})).toEqual([])
    expect(decodeShardPayload({ tickers: { X: null } })).toEqual([])
    expect(decodeShardPayload({ tickers: { X: { D: { t: [] } } } })).toEqual([])
  })

  it('_shardIdx prefers idx but falls back to parsing the name', () => {
    expect(_shardIdx({ idx: 3, name: 'barspack/2026-08-14/003.json.gz' })).toBe(3)
    expect(_shardIdx({ idx: '5' })).toBe(5)
    // pre-idx manifest: derive from the R2 name (the 2026-08-14 ingest bug)
    expect(_shardIdx({ name: 'barspack/2026-08-14/007.json.gz' })).toBe(7)
    expect(_shardIdx({ name: 'garbage' })).toBeNaN()
    expect(_shardIdx({})).toBeNaN()
  })

  it('emits D, W, M independently per ticker', () => {
    const one = [{ t: '2026-08-13', o: 1, h: 1, l: 1, c: 1, v: 1 }]
    const obj = { tickers: { M1: { M: columnar(one) }, D1: { D: columnar(one) } } }
    const entries = decodeShardPayload(obj)
    expect(entries.map(e => `${e.sym}:${e.tf}`).sort()).toEqual(['D1:D', 'M1:M'])
  })
})
