// REPRO (2026-11-17, prod BARSTORE + VITE_REALTIME_BARS=1): a freshly typed 1m chart shows the
// PREVIOUS minute as its newest candle for seconds after paint; the current minute appears late.
//
// Mechanism: on subscribe the server snapshot sends the closed FINALS of the last 15 minutes at
// once, but HOLDS the developing bucket of a newly subscribed symbol until its first seed
// (api/services/ingest_runtime.py client_updated, SEED_HOLD_S = 3 s). The first final flips
// barsStreamManager's per-key `everDelivered` -> getStatus().delivering = true, and liveFeed's
// S6 gate (isStreamLive) then DROPS every tick: "push owns the developing bar" — but push has
// not delivered a developing bar at all. Nothing opens the wall-clock minute until the held
// developing frame arrives (seed landed / hold expired + the next trade).
//
// Contract: a past bucket's FINAL proves nothing about the developing bar. Until the push feed
// has delivered a DEVELOPING frame for this key, a trusted (trade-time) tick may open the
// wall-clock bucket. Synthetic prices only.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as bars from '../../lib/barsStreamManager'
import { createRegistry } from './registry'
import { createLiveFeed } from './liveFeed'
import { keyOf, parseKey, expectedServerCacheKey } from './types'
import { etUnix } from './__fixtures__/seededSeries'
import { fakeCandle, fakePrices } from './testing/fakeFeeds'

class MockES {
  static instances = []
  constructor(url) { this.url = url; this.listeners = {}; this.onopen = null; this.onerror = null; MockES.instances.push(this) }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
  close() { this.closed = true }
  _open() { this.onopen?.() }
  _emit(type, data) { (this.listeners[type] || []).forEach((fn) => fn({ data: JSON.stringify(data) })) }
}

beforeEach(() => { MockES.instances = []; global.EventSource = MockES; bars._resetForTests() })
afterEach(() => { bars._resetForTests(); vi.useRealTimers() })

function world() {
  const key = keyOf({ sym: 'SIM', tf: '1', session: 'rth' })
  const p = parseKey(key)
  const T = etUnix('2026-11-17', 925)            // the wall-clock minute (15:25 ET)
  const clock = { ms: (T + 30) * 1000 }          // 30 s into it
  vi.useFakeTimers(); vi.setSystemTime(clock.ms)
  const registry = createRegistry({ ctx: () => ({ nowMs: clock.ms }), frame: (fn) => fn() })
  const prices = fakePrices()
  createLiveFeed({ registry, pushEnabled: () => true, stream: bars, candle: fakeCandle(), prices, now: () => clock.ms })
    .attach(key, { session: 'rth' })
  // The first paint: the served tail ends at the newest CLOSED minute (T-1); no developing.
  const rows = [4, 3, 2, 1].map((k) => ({ t: T - k * 60, o: 100, h: 100.05, l: 99.95, c: 100, v: 100 }))
  registry.dispatch(key, { type: 'rest-full', key, payload: {
    bars: rows, contract: 1, grid: p.serverGrid, cache_key: expectedServerCacheKey(key), series_rev: 1, history_rev: 1,
    complete_through: T, developing: null,
  } }, { nowMs: clock.ms })
  bars._flushRebuild()                           // REBUILD_DEBOUNCE_MS elapsed: the EventSource opens
  const es = MockES.instances.at(-1)
  return { key, registry, prices, clock, T, es }
}

describe('1m live edge: a snapshot of past FINALS must not silence the tick fallback', () => {
  it('control: no stream frame yet — a trade-time tick opens the wall-clock minute', () => {
    const w = world()
    w.es._open()
    w.clock.ms += 1000; vi.setSystemTime(w.clock.ms)
    w.prices.set('SIM', 100.1, { trade_ts: w.clock.ms - 200 })
    expect(w.registry.getSnapshot(w.key).developing?.t).toBe(w.T)
  })

  it('DEFECT: the subscribe snapshot sent only closed finals (developing held for the seed) — the tick still opens the wall-clock minute', () => {
    const w = world()
    w.es._open()
    // the server snapshot: closed finals T-15..T-1 (ms `t`, as the wire sends), developing HELD
    for (let k = 15; k >= 1; k--) {
      const t = (w.T - k * 60) * 1000
      w.es._emit('bar', { sym: 'SIM', tf: '1', rev: 1000 + k, bar: { t, o: 100, h: 100.05, l: 99.95, c: 100, v: 100, final: true } })
    }
    w.clock.ms += 1000; vi.setSystemTime(w.clock.ms)
    w.prices.set('SIM', 100.1, { trade_ts: w.clock.ms - 200 })
    const s = w.registry.getSnapshot(w.key)
    // the finals filled the closed tail (they are authoritative and are kept) ...
    expect(s.bars.at(-1)?.t).toBe(w.T - 60)
    // ... and the current minute is open at the live price (master: null — the tick was dropped)
    expect(s.developing?.t).toBe(w.T)
    expect(s.developing?.c).toBe(100.1)
  })
})
