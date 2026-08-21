import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the prefetch queue + IDB import so the eager hot-set warm / hot-pack ingest
// can be asserted without a network or IndexedDB. vi.hoisted lets the mock factories
// (hoisted to top) reference the spies safely.
const { prefetchBarsToIDB, idbImportPack, idbApplyDelta } = vi.hoisted(() => ({
  prefetchBarsToIDB: vi.fn(), idbImportPack: vi.fn(), idbApplyDelta: vi.fn(),
}))
vi.mock('../utils/prefetchBars', () => ({ prefetchBarsToIDB }))
vi.mock('../utils/barsIDB', () => ({ idbImportPack, idbApplyDelta }))

import {
  decodeShardPayload, _shardIdx, _warmHotSetForNewUser, _ingestHotPack, HOT_TICKERS,
} from './barsPackClient'

const HOT_CFG = { base: '/api/barspack', hotVersionKey: 'barspack.hotVersion', ingestBatchSize: 60, ingestYield: true }

// Minimal fetch stub: manifest → given object; /{v}/hot → given shard payload.
function stubFetch({ manifest, hotShard }) {
  return vi.fn(async (url) => {
    if (url.endsWith('/manifest')) return { ok: true, json: async () => manifest }
    if (url.endsWith('/hot')) return { ok: true, json: async () => hotShard }
    return { ok: false, json: async () => ({}) }
  })
}

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

describe('_warmHotSetForNewUser (cold-start bridge)', () => {
  beforeEach(() => {
    prefetchBarsToIDB.mockClear()
    try { localStorage.clear() } catch { /* ignore */ }
  })

  it('warms the hot set (daily first, then 5m/60m) when no pack is stamped', () => {
    _warmHotSetForNewUser()
    // Daily, at the front of the queue, is the first call.
    expect(prefetchBarsToIDB).toHaveBeenCalledWith(HOT_TICKERS, 'D', { priority: true })
    expect(prefetchBarsToIDB).toHaveBeenCalledWith(HOT_TICKERS, '5')
    expect(prefetchBarsToIDB).toHaveBeenCalledWith(HOT_TICKERS, '60')
    expect(prefetchBarsToIDB.mock.calls[0]).toEqual([HOT_TICKERS, 'D', { priority: true }])
  })

  it('is a NO-OP for a returning user who already ingested a pack', () => {
    localStorage.setItem('barspack.version', '2026-08-21')
    _warmHotSetForNewUser()
    expect(prefetchBarsToIDB).not.toHaveBeenCalled()
  })

  it('is a NO-OP once the hot pack alone is stamped (no redundant origin warm)', () => {
    localStorage.setItem('barspack.hotVersion', '2026-08-21')
    _warmHotSetForNewUser()
    expect(prefetchBarsToIDB).not.toHaveBeenCalled()
  })

  it('hot set is a lean, unique, non-empty first-open list', () => {
    expect(HOT_TICKERS.length).toBeGreaterThan(10)
    expect(HOT_TICKERS.length).toBeLessThanOrEqual(60)          // stays a cheap warm, not the universe
    expect(new Set(HOT_TICKERS).size).toBe(HOT_TICKERS.length)  // no dupes → no wasted jobs
    expect(HOT_TICKERS).toContain('SPY')
  })
})

describe('_ingestHotPack (server hot shard)', () => {
  const cols = t => ({ t: [t], o: [1], h: [1], l: [1], c: [1], v: [1] })
  const manifest = { version: '2026-08-21', hot: { name: 'barspack/2026-08-21/hot.json.gz' } }
  const hotShard = { format: 1, tickers: { SPY: { D: cols('2026-08-21') } } }

  beforeEach(() => {
    idbImportPack.mockClear().mockResolvedValue({ aborted: false })
    try { localStorage.clear() } catch { /* ignore */ }
  })

  it('ingests the hot shard and stamps hotVersion on first visit', async () => {
    globalThis.fetch = stubFetch({ manifest, hotShard })
    await _ingestHotPack(HOT_CFG)
    expect(idbImportPack).toHaveBeenCalledTimes(1)
    const entries = idbImportPack.mock.calls[0][0]
    expect(entries).toContainEqual({ sym: 'SPY', tf: 'D', bars: [{ t: '2026-08-21', o: 1, h: 1, l: 1, c: 1, v: 1 }] })
    expect(localStorage.getItem('barspack.hotVersion')).toBe('2026-08-21')
  })

  it('is a NO-OP when this version is already stamped', async () => {
    localStorage.setItem('barspack.hotVersion', '2026-08-21')
    globalThis.fetch = stubFetch({ manifest, hotShard })
    await _ingestHotPack(HOT_CFG)
    expect(idbImportPack).not.toHaveBeenCalled()
  })

  it('does nothing (no throw) when the manifest carries no hot shard', async () => {
    globalThis.fetch = stubFetch({ manifest: { version: '2026-08-21' }, hotShard })
    await _ingestHotPack(HOT_CFG)
    expect(idbImportPack).not.toHaveBeenCalled()
    expect(localStorage.getItem('barspack.hotVersion')).toBeNull()
  })

  it('does NOT stamp when the ingest aborts (quota) so it retries next load', async () => {
    idbImportPack.mockResolvedValue({ aborted: true })
    globalThis.fetch = stubFetch({ manifest, hotShard })
    await _ingestHotPack(HOT_CFG)
    expect(idbImportPack).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('barspack.hotVersion')).toBeNull()
  })
})
