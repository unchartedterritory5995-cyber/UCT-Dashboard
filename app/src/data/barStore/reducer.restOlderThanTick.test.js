// ⛔ (2026-11-28, review of #2956, F2) A REST ANSWER OLDER THAN THE LAST TICK NEVER MOVES THE CLOSE BACK.
// The edge now caches the entitled /api/bars tail for up to 5 s (D/W/M) / 3 s (intraday). A re-read mid-stream can
// therefore carry the developing bar as it was seconds ago. The answer for the bucket the stream is drawing was merged
// with no time (mergePushBar `tradeTs` absent, so `older` was false) and its close REPLACED the live close: the
// visible price stepped back by up to the cache's age until the next tick, which on a thin name can be a while.
// The answer now carries the time its data is as of (utils/prefetchBars `_chartLaneFetch`: the server clock at the
// send, minus the edge's `X-Tail-Age-Ms` on a cache hit), and an answer older than the last tick keeps the ticked
// close (its range and volume still merge: H/L union, volume max).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { reduce, initialState } from './reducer'
import { keyOf } from './types'
import { etUnix } from './__fixtures__/seededSeries'

const DAY = '2026-11-10'
const T = (min) => etUnix(DAY, min)
const bar = (t, o = 100, h = 101, l = 99, c = 100.5, v = 10) => ({ t, o, h, l, c, v })
const NOW = T(10 * 60 + 12) * 1000              // 10:12 ET, inside the 10:10 5m bucket
const ctx = { nowMs: NOW, streamLive: true }
const K5 = keyOf({ sym: 'SIM', tf: '5' })
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

const answer = (dev, extra = {}) => ({
  bars: [bar(T(600)), bar(T(605))], contract: 1, grid: 'eth-clock', session: 'rth', cache_key: 'b1:SIM:5:eth-clock',
  series_rev: 1000, history_rev: 5, verified_through: T(612) - 5, tail_status: 'verified', complete_through: T(605),
  developing: dev, ...extra,
})

function ticked() {
  const s1 = reduce(initialState(K5, ctx), { type: 'rest-full', payload: answer({ ...bar(T(610), 100, 100.8, 99.9, 100.5, 40), rev: 1000 }) }, ctx)
  // a live tick for the same bucket: a new high and close, traded at NOW
  const s2 = reduce(s1, { type: 'push-bar', event: { t: T(610), o: 100, h: 101.2, l: 99.9, c: 101.2, v: 55, rev: 1001, trade_ts: NOW } }, ctx)
  expect(s2.developing.c).toBe(101.2)
  return s2
}

describe('a REST answer older than the last tick never moves the close back (F2)', () => {
  it('an edge-cached answer 4 s old (rev newer, data older): the ticked close and high stand; volume and low merge', () => {
    const s2 = ticked()
    const stale = answer({ ...bar(T(610), 100, 100.9, 99.7, 100.6, 60), rev: 1002 }, { _asOfMs: NOW - 4000 })
    const s3 = reduce(s2, { type: 'rest-full', payload: stale }, ctx)
    expect(s3.developing.c).toBe(101.2)
    expect(s3.developing.h).toBe(101.2)
    expect(s3.developing.l).toBe(99.7)
    expect(s3.developing.v).toBe(60)
  })
  it('CONTROL: an answer as of AFTER the last tick is the truth: its close replaces the ticked one', () => {
    const s2 = ticked()
    const fresh = answer({ ...bar(T(610), 100, 101.3, 99.7, 100.6, 60), rev: 1002 }, { _asOfMs: NOW + 1000 })
    const s3 = reduce(s2, { type: 'rest-full', payload: fresh }, ctx)
    expect(s3.developing.c).toBe(100.6)
  })
})

describe('the answer says when its data is as of (_chartLaneFetch)', () => {
  const fake = (headers) => vi.fn(async () => ({ ok: true, status: 200, headers: { get: (h) => headers[h.toLowerCase()] ?? null }, json: async () => ({ bars: [] }) }))
  it('an edge tail-cache hit is as of its age before now; an origin answer is as of the send', async () => {
    const { _chartLaneFetch } = await import('../../utils/prefetchBars')
    const { serverNow } = await import('../../lib/serverClock')
    const real = globalThis.fetch
    try {
      globalThis.fetch = fake({ 'x-bars-edge': 'tail-cache', 'x-tail-age-ms': '4000' })
      const hit = await _chartLaneFetch('/api/bars/SIM?tf=5&bars=30')
      expect(Math.abs(hit._asOfMs - (serverNow() - 4000))).toBeLessThan(50)
      globalThis.fetch = fake({})
      const fresh = await _chartLaneFetch('/api/bars/SIM?tf=5&bars=30')
      expect(Math.abs(fresh._asOfMs - serverNow())).toBeLessThan(50)
    } finally { globalThis.fetch = real }
  })
})
