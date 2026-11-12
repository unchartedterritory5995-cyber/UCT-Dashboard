// liveFeed.js — tick-source arbitration and tick time (the 2026-11-12 BARSTORE stall: NVDA 1m froze
// 81 s while both feeds ticked; legacy kept moving). Synthetic prices only.
//
// Contracts, stated generally:
//   A1  (no stall) push gated off, the trade feed's trade time lagging the wall clock by ANY amount
//       (0–90 s, drifting) while it keeps ticking, and the live-price feed ticking at its own trade
//       time: every live-price tick whose trade time lies in the wall-clock bucket leaves the painted
//       developing bar IN that bucket, and the developing bar never goes longer than one hand-over
//       (CANDLE_ACTIVE_MS) plus the live-price cadence without moving while ticks arrive. (seeded,
//       every intraday tf, both sessions)
//   A2  within one bucket and between server answers: the open never changes, the high never falls,
//       the low never rises, the bucket never goes backwards. (same runs)
//   A3  exactly one source per tick: a FRESH trade feed in the current bucket owns the key (the
//       live-price feed is ignored); a trade feed that is stale by trade time, or behind the
//       bucket the chart must advance, does not — however recently its ticks ARRIVED.
//   A4  a tick is bucketed by its OWN time (liveTickTimeMs: trade_ts › updated_at › arrival) — a
//       stale live-price entry never fabricates the new bucket's open.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRegistry } from './registry'
import { createLiveFeed, tradeFeedOwns, liveTickTimeMs, CANDLE_ACTIVE_MS } from './liveFeed'
import { bucketOf } from './reducer'
import { keyOf, parseKey, expectedServerCacheKey } from './types'
import { forSeeds, etUnix, INTRADAY } from './__fixtures__/seededSeries'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'

const N = Number(globalThis.process?.env?.BARSTORE_SEEDS || 120)
afterEach(() => { vi.useRealTimers() })
function check(cond, msg) { if (!cond) throw new Error(typeof msg === 'function' ? msg() : msg) }

function world(tf, session, startMs) {
  const key = keyOf({ sym: 'SIM', tf, session })
  const p = parseKey(key)
  const clock = { ms: startMs }
  vi.setSystemTime(clock.ms)
  const registry = createRegistry({ ctx: () => ({ nowMs: clock.ms }), frame: (fn) => fn() })
  const stream = fakeStream(), candle = fakeCandle(), prices = fakePrices()
  stream.st.delivering = false
  createLiveFeed({ registry, pushEnabled: () => false, stream, candle, prices, now: () => clock.ms }).attach(key, { session })
  const bucket = (ms) => bucketOf(Math.floor(ms / 1000), registry.getSnapshot(key))
  /** A server answer: closed rows before the wall-clock bucket + the developing bar of it. */
  const rest = (rev, px) => {
    const devT = bucket(clock.ms)
    const step = (tf === '60' ? 60 : Number(tf)) * 60
    const rows = [3, 2, 1].map((k) => ({ t: devT - k * step, o: px, h: px + 0.05, l: px - 0.05, c: px, v: 100 }))
    registry.dispatch(key, { type: 'rest-full', key, payload: {
      bars: [...rows, { t: devT, o: px, h: px, l: px, c: px, v: 10 }],
      contract: 1, grid: p.serverGrid, cache_key: expectedServerCacheKey(key), series_rev: rev, history_rev: 1,
      complete_through: devT, developing: { t: devT, o: px, h: px, l: px, c: px, v: 10, rev },
    } }, { nowMs: clock.ms })
  }
  return { key, registry, candle, prices, clock, bucket, rest }
}

describe('A1/A2 — no stall while ticks arrive, whatever the trade feed lags (seeded)', () => {
  it(`the developing bar reaches the wall-clock bucket on the first live-price tick in it and never freezes (${N} seeds)`, () => {
    forSeeds(N, 911000, (r, seed) => {
      const tf = r.pick(INTRADAY), session = r.pick(['rth', 'eth'])
      // an RTH minute well inside the session, a random second into it
      const start = (etUnix('2026-11-12', 600 + r.int(0, 300)) + r.int(0, 59)) * 1000
      const w = world(tf, session, start)
      let seq = 0
      const px = () => Math.round((100 + (++seq) * 0.001) * 1000) / 1000   // every tick a NEW price
      w.rest(1, 100)
      let lag = r.int(0, 90) * 1000                       // the trade feed's lag behind the wall clock
      let nextPrice = w.clock.ms + r.int(0, 2000)
      let nextRest = w.clock.ms + 30_000
      let lastChange = w.clock.ms, prevDev = w.registry.getSnapshot(w.key).developing, rev = 1
      const ctx = () => `seed ${seed} tf ${tf} ${session} lag ${lag}ms t+${(w.clock.ms - start) / 1000}s`
      for (let step = 0; step < 150; step++) {
        w.clock.ms += 1000; vi.setSystemTime(w.clock.ms)
        if (r.chance(0.1)) lag = Math.max(0, Math.min(90_000, lag + r.int(-20, 20) * 1000))
        let restNow = false
        // the trade feed: a print every second, stamped `lag` behind the wall clock
        w.candle.tick('SIM', px(), w.clock.ms - lag, w.clock.ms)
        let priceTickInBucket = false
        if (w.clock.ms >= nextPrice) {
          const tradeMs = w.clock.ms - r.int(0, 800)
          w.prices.set('SIM', px(), { trade_ts: tradeMs })
          priceTickInBucket = w.bucket(tradeMs) === w.bucket(w.clock.ms)
          nextPrice = w.clock.ms + r.int(1, 2) * 1000
        }
        if (w.clock.ms >= nextRest) { rev++; w.rest(rev, 100 + seq * 0.001); nextRest += 30_000; restNow = true }
        const d = w.registry.getSnapshot(w.key).developing
        // A1 — the wall-clock bucket is reached on the first live-price tick in it
        if (priceTickInBucket) check(d && d.t === w.bucket(w.clock.ms), () => `A1 developing ${d?.t} not in the wall bucket ${w.bucket(w.clock.ms)} — ${ctx()}`)
        // A2 — monotone within a bucket between server answers
        if (d && prevDev && !restNow) {
          check(d.t >= prevDev.t, () => `A2 bucket went backwards — ${ctx()}`)
          if (d.t === prevDev.t) {
            check(d.o === prevDev.o, () => `A2 open changed — ${ctx()}`)
            check(d.h >= prevDev.h && d.l <= prevDev.l, () => `A2 H/L shrank — ${ctx()}`)
          }
        }
        // A1 — never frozen longer than one hand-over (a trade feed whose prints stop reaching the
        // current bucket owns for at most CANDLE_ACTIVE_MS) plus the live-price cadence
        const moved = !prevDev || !d || d.t !== prevDev.t || d.c !== prevDev.c
        if (moved) lastChange = w.clock.ms
        check(w.clock.ms - lastChange <= CANDLE_ACTIVE_MS + 2000, () => `A1 developing bar frozen ${(w.clock.ms - lastChange) / 1000}s — ${ctx()}`)
        prevDev = d
      }
    })
  })
})

describe('A3 — one source at a time, judged by the bucket its data reaches', () => {
  const key = keyOf({ sym: 'SIM', tf: '1' })
  const T = etUnix('2026-11-12', 611) * 1000             // 10:11:00 ET
  const st = (devT = null) => ({ key, tf: '1', grid: null, developing: devT == null ? null : { t: devT } })

  it('a fresh trade in the wall-clock bucket owns; a stale or lagging one does not, however recently it arrived', () => {
    expect(tradeFeedOwns({ tradeMs: T + 20_000, at: T + 20_000 }, st(), T + 21_000)).toBe(true)
    // stale by its OWN trade time though it arrived just now
    expect(tradeFeedOwns({ tradeMs: T + 20_000 - CANDLE_ACTIVE_MS, at: T + 20_000 }, st(), T + 20_000)).toBe(false)
    // fresh (1 s) but still in the previous minute while the wall clock is in this one
    expect(tradeFeedOwns({ tradeMs: T - 500, at: T + 500 }, st(), T + 500)).toBe(false)
    // in the wall bucket, but the developing bar is already on a later one
    expect(tradeFeedOwns({ tradeMs: T + 1000, at: T + 1000 }, st(T / 1000 + 60), T + 1500)).toBe(false)
    expect(tradeFeedOwns(null, st(), T)).toBe(false)
  })

  it('end to end: a lagging trade feed yields to the live-price feed; caught up, it owns again', () => {
    const w = world('1', 'rth', T + 5000)
    w.rest(1, 100)
    const d0 = w.registry.getSnapshot(w.key).developing
    expect(d0.t).toBe(T / 1000)
    // trade feed 40 s behind (its prints are the previous minute's) — arrived just now
    w.candle.tick('SIM', 100.2, w.clock.ms - 40_000, w.clock.ms)
    expect(w.registry.getSnapshot(w.key).developing).toBe(d0)
    w.prices.set('SIM', 100.3, { trade_ts: w.clock.ms - 200 })
    expect(w.registry.getSnapshot(w.key).developing.c).toBe(100.3)
    // caught up: the trade feed owns and the live-price feed stands down
    w.clock.ms += 1000
    w.candle.tick('SIM', 100.4, w.clock.ms - 300, w.clock.ms)
    expect(w.registry.getSnapshot(w.key).developing.c).toBe(100.4)
    w.prices.set('SIM', 100.5, { trade_ts: w.clock.ms - 100 })
    expect(w.registry.getSnapshot(w.key).developing.c).toBe(100.4)
  })
})

describe('A4 — a tick is bucketed by its own time', () => {
  it('liveTickTimeMs: trade_ts (ms) › updated_at (s) › arrival', () => {
    expect(liveTickTimeMs({ trade_ts: 1_700_000_000_123, updated_at: 1_700_000_999 }, 5)).toBe(1_700_000_000_123)
    expect(liveTickTimeMs({ updated_at: 1_700_000_001 }, 5)).toBe(1_700_000_001_000)
    expect(liveTickTimeMs({ price: 1 }, 5)).toBe(5)
    expect(liveTickTimeMs(null, 5)).toBe(5)
  })

  it('a stale live-price entry (an older minute) never opens the new bucket', () => {
    const T = etUnix('2026-11-12', 611) * 1000
    const w = world('1', 'rth', T - 2000)
    w.rest(1, 100)
    const d0 = w.registry.getSnapshot(w.key).developing
    w.clock.ms = T + 3000; vi.setSystemTime(w.clock.ms)
    w.prices.set('SIM', 100.7, { trade_ts: T - 1500 })      // the previous minute's print
    const d1 = w.registry.getSnapshot(w.key).developing
    expect(d1.t).toBe(d0.t)
    expect(d1.c).toBe(100.7)
    w.prices.set('SIM', 100.8, { trade_ts: T + 2500 })      // this minute's first print opens it
    const d2 = w.registry.getSnapshot(w.key).developing
    expect([d2.t, d2.o, d2.c]).toEqual([T / 1000, 100.8, 100.8])
  })
})
