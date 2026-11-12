// liveFeed.js — tick-source arbitration and tick time (the 2026-11-12 BARSTORE stall: NVDA 1m froze
// 81 s while both feeds ticked; legacy kept moving). Synthetic prices only.
//
// Contracts, stated generally:
//   A1  (no stall) push gated off, the trade feed's trade time lagging the wall clock by ANY amount
//       (0–90 s, drifting) while it keeps ticking, and the live-price feed ticking at its own trade
//       time: every live-price tick whose trade time lies in the wall-clock bucket leaves the painted
//       developing bar IN that bucket, and the developing bar never goes longer than one hand-over
//       (SOURCE_QUIET_MS) plus the live-price cadence without moving while ticks arrive. (seeded,
//       every intraday tf, both sessions)
//   A2  within one bucket and between server answers: the open never changes, the high never falls,
//       the low never rises, the bucket never goes backwards. (same runs)
//   A3  one source per bucket (arbitrateTick): the Massive-stamped live price claims an unheld
//       bucket; the trade feed only while Massive is quiet by TRADE time; the holder is sticky; a
//       trade feed that is stale or lagging by its own trade time never holds the key — however
//       recently its ticks ARRIVED.
//   A4  a tick is bucketed by its OWN time (liveTickTimeMs: trade_ts › updated_at › arrival) — a
//       stale live-price entry never fabricates the new bucket's open.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRegistry } from './registry'
import { createLiveFeed, arbitrateTick, liveTickTime, liveTickTimeMs, SOURCE_QUIET_MS, TICK_SRC } from './liveFeed'
import { bucketOf } from './reducer'
import { keyOf, parseKey, expectedServerCacheKey, isDateTf, TFS } from './types'
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
    // date tfs: closed periods well before (any earlier bucket will do); intraday: the grid step
    const step = isDateTf(tf) ? 40 * 86400 : (tf === '60' ? 60 : Number(tf)) * 60
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
        // current bucket owns for at most SOURCE_QUIET_MS) plus the live-price cadence
        const moved = !prevDev || !d || d.t !== prevDev.t || d.c !== prevDev.c
        if (moved) lastChange = w.clock.ms
        check(w.clock.ms - lastChange <= SOURCE_QUIET_MS + 2000, () => `A1 developing bar frozen ${(w.clock.ms - lastChange) / 1000}s — ${ctx()}`)
        prevDev = d
      }
    })
  })
})

describe('A3 — one source per bucket, judged by trade time (arbitrateTick)', () => {
  const key = keyOf({ sym: 'SIM', tf: '1' })
  const T = etUnix('2026-11-12', 611) * 1000             // 10:11:00 ET
  const B = T / 1000
  const st = (devT = null) => ({ key, tf: '1', grid: null, bars: [], developing: devT == null ? null : { t: devT } })
  const { MASSIVE: M, TRADE: F, UNTIMED: U } = TICK_SRC

  it('Massive claims an unheld bucket; the trade feed only while Massive is quiet by TRADE time', () => {
    expect(arbitrateTick(null, { src: M, ms: T + 1000 }, {}, st(), T + 1200)).toEqual({ accept: true, arb: { bucket: B, src: M } })
    // the trade feed fresh, Massive printed 1 s earlier: not quiet → no
    expect(arbitrateTick(null, { src: F, ms: T + 2000 }, { massive: T + 1000 }, st(), T + 2000).accept).toBe(false)
    // Massive quiet for the bound by trade time → the trade feed claims
    expect(arbitrateTick(null, { src: F, ms: T + 1000 + SOURCE_QUIET_MS }, { massive: T + 1000 }, st(), T + 9000).arb).toEqual({ bucket: B, src: F })
    // a lagging trade feed (its trade OLDER than Massive's newest) never claims, however recently it arrived
    expect(arbitrateTick(null, { src: F, ms: T + 20_000 }, { massive: T + 50_000 }, st(), T + 50_100).accept).toBe(false)
    // never an older bucket than the developing one
    expect(arbitrateTick(null, { src: M, ms: T - 500 }, {}, st(B), T + 500).accept).toBe(false)
  })

  it('sticky: the holder keeps its bucket; the other source takes it over only once the holder is quiet', () => {
    const held = { bucket: B, src: F }
    // Massive prints in a bucket the trade feed holds, the holder printed 1 s earlier → no
    expect(arbitrateTick(held, { src: M, ms: T + 3000 }, { trade: T + 2000, massive: T + 3000 }, st(B), T + 3000)).toEqual({ accept: false, arb: held })
    // holder quiet for the bound (by the challenger's trade time) → taken over
    expect(arbitrateTick(held, { src: M, ms: T + 2000 + SOURCE_QUIET_MS }, { trade: T + 2000 }, st(B), T + 9000).arb).toEqual({ bucket: B, src: M })
    // the holder itself is always accepted in its bucket
    expect(arbitrateTick(held, { src: F, ms: T + 4000 }, { trade: T + 4000, massive: T + 3900 }, st(B), T + 4000)).toEqual({ accept: true, arb: held })
    // the NEXT bucket is re-chosen: Massive (primary) claims it although the trade feed held this one
    expect(arbitrateTick(held, { src: M, ms: T + 60_100 }, { trade: T + 59_900 }, st(B), T + 60_200).arb).toEqual({ bucket: B + 60, src: M })
  })

  it('an untimed entry (send-time updated_at) never decides a boundary and never holds a bucket', () => {
    expect(arbitrateTick(null, { src: U, ms: T + 60_500 }, {}, st(B), T + 60_500).accept).toBe(false)   // would open the next bucket
    expect(arbitrateTick(null, { src: U, ms: T + 1000 }, {}, st(null), T + 1000).accept).toBe(false)    // no bar to fold into
    expect(arbitrateTick(null, { src: U, ms: T + 5000 }, { massive: T + 4000 }, st(B), T + 5000).accept).toBe(false)  // a trusted source is live
    expect(arbitrateTick(null, { src: U, ms: T + 9000 }, { massive: T + 4000 }, st(B), T + 9000)).toEqual({ accept: true, arb: null })
  })

  it('end to end: a lagging trade feed never displaces the live-price tape; Massive quiet, it takes over', () => {
    const w = world('1', 'rth', T + 5000)
    w.rest(1, 100)
    const d0 = w.registry.getSnapshot(w.key).developing
    expect(d0.t).toBe(B)
    // trade feed 40 s behind (its prints are the previous minute's) — arrived just now
    w.candle.tick('SIM', 100.2, w.clock.ms - 40_000, w.clock.ms)
    expect(w.registry.getSnapshot(w.key).developing).toBe(d0)
    w.prices.set('SIM', 100.3, { trade_ts: w.clock.ms - 200 })
    expect(w.registry.getSnapshot(w.key).developing.c).toBe(100.3)
    // caught up, but Massive is live in this bucket: the trade feed stands down
    w.clock.ms += 1000
    w.candle.tick('SIM', 100.4, w.clock.ms - 300, w.clock.ms)
    expect(w.registry.getSnapshot(w.key).developing.c).toBe(100.3)
    w.prices.set('SIM', 100.5, { trade_ts: w.clock.ms - 100 })
    expect(w.registry.getSnapshot(w.key).developing.c).toBe(100.5)
    // Massive goes quiet: the trade feed's print ≥ the bound past Massive's newest takes the bucket…
    w.clock.ms += SOURCE_QUIET_MS + 500
    w.candle.tick('SIM', 100.6, w.clock.ms - 200, w.clock.ms)
    expect(w.registry.getSnapshot(w.key).developing.c).toBe(100.6)
    // …and keeps it while it prints, though Massive's (re-sent, older) entry arrives again
    w.prices.set('SIM', 100.5, { trade_ts: w.clock.ms - 100 - SOURCE_QUIET_MS - 500 })
    expect(w.registry.getSnapshot(w.key).developing.c).toBe(100.6)
  })
})

describe('A4 — a tick is bucketed by its own time', () => {
  it('liveTickTime: only trade_ts is a TRUSTED trade time (updated_at without it is the send time)', () => {
    expect(liveTickTime({ trade_ts: 1_700_000_000_123, updated_at: 1_700_000_000 }, 5)).toEqual({ ms: 1_700_000_000_123, trusted: true })
    expect(liveTickTime({ updated_at: 1_700_000_001 }, 5)).toEqual({ ms: 1_700_000_001_000, trusted: false })
    expect(liveTickTime({ price: 1 }, 5)).toEqual({ ms: 5, trusted: false })
  })

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

// ── D2: one quality-ranked source per bucket, under realistic interleaving (seeded) ──────────────
//   P1  Massive-stamped live prices (sub-second, 50–500 ms trade lag) interleaved with a trickling
//       trade feed (0.5–5 s apart, 0–2 s lag), each feed on its OWN price track: within every bucket
//       only ONE feed's prices ever reach the developing bar's open/high/low/close, the close never
//       alternates between feeds, and while Massive is live that feed is Massive.
//   P2  Massive goes quiet for a while: the trade feed takes the bucket within the bound (plus its own
//       cadence and lag) — the bar never freezes while a source prints — and within a bucket the
//       source changes only when the holder went quiet (at most Massive → trade feed → Massive for
//       one quiet stretch, never back and forth); a bucket opened after Massive resumed is Massive's.
//   P3  an untimed live-price entry (send-time updated_at, no trade_ts) never opens or closes a bucket.
// Every tf the store keys (intraday on both sessions, D/W/M on the RTH day; custom tfs aggregate a
// base key, so they inherit it). Prices carry their feed in the last digit (units of 1e-4, mod 3):
// server ≡ 0, Massive ≡ 1, trade feed ≡ 2.
const FEED_OF = ['server', 'massive', 'trade']
const feedOf = (px) => FEED_OF[((Math.round(px * 1e4) % 3) + 3) % 3]
const priceOn = (base, feed) => (Math.round(base * 1e4 / 3) * 3 + FEED_OF.indexOf(feed)) / 1e4

function interleaved(r, { quietFrom = Infinity, quietFor = 0, steps = 900 } = {}) {
  const tf = r.pick(TFS), session = isDateTf(tf) ? 'rth' : r.pick(['rth', 'eth'])
  const start = (etUnix('2026-11-12', 600 + r.int(0, 280)) + r.int(0, 59)) * 1000
  const w = world(tf, session, start)
  w.rest(1, priceOn(100, 'server'))
  let base = 100
  let nextM = w.clock.ms + r.int(100, 600), nextF = w.clock.ms + r.int(500, 5000)
  let mTs = -Infinity, fTs = -Infinity
  const quietA = start + quietFrom, quietB = quietA + quietFor
  const frames = []
  for (let step = 0; step < steps; step++) {           // 100 ms steps
    w.clock.ms += 100; vi.setSystemTime(w.clock.ms)
    base += r.float(-0.002, 0.002)
    const ev = []
    if (w.clock.ms >= nextM) {
      nextM = w.clock.ms + r.int(100, 600)
      if (w.clock.ms < quietA || w.clock.ms >= quietB) {
        mTs = Math.max(mTs, w.clock.ms - r.int(50, 500))
        const px = priceOn(base, 'massive')
        ev.push(() => w.prices.set('SIM', px, { trade_ts: mTs, updated_at: Math.floor(mTs / 1000) }))
      }
    }
    if (w.clock.ms >= nextF) {
      nextF = w.clock.ms + r.int(500, 5000)
      fTs = Math.max(fTs, w.clock.ms - r.int(0, 2000))
      const px = priceOn(base + r.float(-0.01, 0.01), 'trade')
      ev.push(() => w.candle.tick('SIM', px, fTs, w.clock.ms))
    }
    if (r.chance(0.5)) ev.reverse()
    for (const f of ev) f()
    frames.push({ ms: w.clock.ms, dev: w.registry.getSnapshot(w.key).developing })
  }
  return { w, tf, session, frames, start }
}

/** The feeds whose prices reached each bucket's bar (server values excluded), and the close's feed sequence. */
function perBucket(frames) {
  const m = new Map()
  for (const { dev: d } of frames) {
    if (!d) continue
    let e = m.get(d.t)
    if (!e) m.set(d.t, (e = { feeds: new Set(), closes: [] }))
    for (const x of [d.o, d.h, d.l, d.c]) { const f = feedOf(x); if (f !== 'server') e.feeds.add(f) }
    const cf = feedOf(d.c)
    if (cf !== 'server' && e.closes[e.closes.length - 1] !== cf) e.closes.push(cf)
  }
  return m
}

describe('D2 — one quality-ranked source per bucket (seeded, every tf)', () => {
  it(`P1 interleaved Massive + trickling trade feed: one feed per bucket, and it is Massive (${N} seeds)`, () => {
    forSeeds(N, 1154000, (r, seed) => {
      const { tf, session, frames } = interleaved(r)
      for (const [t, e] of perBucket(frames)) {
        const ctx = `seed ${seed} tf ${tf} ${session} bucket ${t}`
        check(e.closes.length <= 1, () => `P1 close alternated between feeds: ${e.closes.join('→')} — ${ctx}`)
        check(e.feeds.size <= 1, () => `P1 two feeds reached one bucket: ${[...e.feeds]} — ${ctx}`)
        check(!e.feeds.has('trade'), () => `P1 the trade feed fed a bucket while Massive was live — ${ctx}`)
      }
    })
  })

  it(`P2 Massive goes quiet: the trade feed takes over within the bound, nothing freezes, no back-and-forth (${N} seeds)`, () => {
    forSeeds(N, 1155000, (r, seed) => {
      const quietFrom = r.int(5, 30) * 1000, quietFor = r.int(10, 40) * 1000
      const { tf, session, frames, start } = interleaved(r, { quietFrom, quietFor, steps: 900 })
      const ctx = () => `seed ${seed} tf ${tf} ${session} quiet ${quietFrom / 1000}+${quietFor / 1000}s`
      // the trade feed's worst gap (5 s) + lag (2 s) + the bound + Massive's last lag and cadence
      const bound = SOURCE_QUIET_MS + 5000 + 2000 + 1100
      let last = frames[0].dev, lastChange = frames[0].ms
      for (const f of frames) {
        const d = f.dev
        if (!last || !d || d.t !== last.t || d.c !== last.c) lastChange = f.ms
        last = d
        check(f.ms - lastChange <= bound, () => `P2 developing bar frozen ${(f.ms - lastChange) / 1000}s at t+${(f.ms - start) / 1000}s — ${ctx()}`)
      }
      const buckets = perBucket(frames)
      let tookOver = false
      for (const [t, e] of buckets) {
        if (e.feeds.has('trade')) tookOver = true
        // one quiet stretch ⇒ at most Massive → trade feed (Massive quiet) → Massive (the trade feed
        // then quiet in its turn): a change needs the holder silent for the bound, never tick by tick
        const seq = e.closes.join('→')
        check(['', 'massive', 'trade', 'massive→trade', 'trade→massive', 'massive→trade→massive'].includes(seq),
          () => `P2 close alternated ${seq} in bucket ${t} — ${ctx()}`)
      }
      check(tookOver, () => `P2 the trade feed never took over while Massive was quiet — ${ctx()}`)
      // a bucket that OPENED after Massive came back is Massive's alone
      const back = start + quietFrom + quietFor
      for (const [t, e] of buckets) {
        const opened = frames.find((f) => f.dev?.t === t)?.ms
        if (opened == null || opened < back + 1000 || t * 1000 < back + 1000) continue
        check(!e.feeds.has('trade'), () => `P2 the trade feed held bucket ${t}, opened after Massive resumed — ${ctx()}`)
      }
    })
  })

  it(`P3 an untimed entry (send-time updated_at) never opens or closes a bucket (${N} seeds)`, () => {
    forSeeds(N, 1156000, (r, seed) => {
      const tf = r.pick(TFS), session = isDateTf(tf) ? 'rth' : r.pick(['rth', 'eth'])
      const start = (etUnix('2026-11-12', 600 + r.int(0, 280)) + r.int(0, 59)) * 1000
      const w = world(tf, session, start)
      w.rest(1, 100)
      let px = 100
      for (let step = 0; step < 300; step++) {
        w.clock.ms += r.int(200, 4000); vi.setSystemTime(w.clock.ms)
        px = Math.round((px + r.float(-0.01, 0.01)) * 1e4) / 1e4
        if (r.chance(0.2)) w.prices.set('SIM', px, { trade_ts: w.clock.ms - r.int(0, 500) })
        if (r.chance(0.1)) w.candle.tick('SIM', px, w.clock.ms - r.int(0, 1500), w.clock.ms)
        const before = w.registry.getSnapshot(w.key)
        // the untimed entry: `updated_at` = the SEND time (this second), never a trade time
        const upx = Math.round((px + r.float(-0.02, 0.02)) * 1e4) / 1e4
        w.prices.set('SIM', upx, r.chance(0.5) ? { updated_at: Math.floor(w.clock.ms / 1000) } : {})
        const after = w.registry.getSnapshot(w.key)
        const ctx = `seed ${seed} tf ${tf} ${session} step ${step}`
        check(after.developing?.t === before.developing?.t, () => `P3 an untimed entry moved the bucket ${before.developing?.t}→${after.developing?.t} — ${ctx}`)
        check(after.bars.length === before.bars.length, () => `P3 an untimed entry closed a bucket — ${ctx}`)
      }
    })
  })

  it('D/W/M: an extended-hours print never claims the RTH period bar (the day is chosen at the open)', () => {
    for (const tf of ['D', 'W', 'M']) {
      const open = etUnix('2026-11-12', 570) * 1000
      const w = world(tf, 'rth', open - 10_000)
      w.rest(1, priceOn(100, 'server'))
      for (let k = -10; k <= 10; k++) {                  // 09:29:50 … 09:30:10, the trade feed first each second
        w.clock.ms = open + k * 1000; vi.setSystemTime(w.clock.ms)
        w.candle.tick('SIM', priceOn(100 + k * 0.003, 'trade'), w.clock.ms - 100, w.clock.ms)
        w.prices.set('SIM', priceOn(100 + k * 0.003, 'massive'), { trade_ts: w.clock.ms - 200 })
      }
      expect(feedOf(w.registry.getSnapshot(w.key).developing.c), tf).toBe('massive')
    }
  })
})
