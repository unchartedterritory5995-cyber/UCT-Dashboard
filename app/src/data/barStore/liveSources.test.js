// P3-S2b — the store's live input is whichever live source is ACTIVE (prod: push gated off by
// VITE_REALTIME_BARS=0), a developing bar detached from the series is a status, and rows a tick
// closed are unverified until REST. Synthetic prices only.
//
// Contracts, stated generally:
//   L1  push gated off: the tick fallback drives the D/W/M period bar — price (H/L union, close)
//       AND volume from the live day-volume source (periodTickVolume, one owner); the period
//       bar's volume never falls; W/M never count the base's volume twice (v ≤ truth); a non-RTH
//       tick never moves the period bar.
//   G1  a live bucket opened past MISSING expected buckets marks the entry (liveGapFrom = the
//       first missing bucket): status `updating`, the delta starts at it, the store kicks a read;
//       a server answer clears it. A contiguous bucket, the overnight / weekend jump and a
//       server-sourced developing bar never mark it. (seeded over tf × session × gap sizes)
//   V1  rows the tick fallback CLOSED keep status below `current` (verified) until a REST answer
//       replaces them; the REST rows win (closed-row precedence) and status returns to current.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRegistry } from './registry'
import { createLiveFeed, periodTickVolume } from './liveFeed'
import { liveGapStart } from './reducer'
import { tickClosedTail } from './status'
import { keyOf, STATUS } from './types'
import { etUnix, rng } from './__fixtures__/seededSeries'
import { fakeStream, fakeCandle } from './testing/fakeFeeds'
import { bucketStartUnix } from '../../components/chart/barTime'

afterEach(() => { vi.useRealTimers() })

/** The live-price feed double, with the cumulative DAY volume the real feed carries. */
function pricesWithVolume() {
  const subs = new Set()
  let snap = { prices: {} }
  return {
    subscribe(_t, cb) { subs.add(cb); return () => subs.delete(cb) },
    getSnapshot: () => snap,
    set(sym, price, volume) { snap = { prices: { ...snap.prices, [sym]: { price, volume } } }; for (const cb of subs) cb() },
  }
}

const DAY = '2026-11-10'                       // a Tuesday
const minute = (m) => etUnix(DAY, m)

describe('L1 — push gated off: the tick fallback drives the D/W/M period bar (price AND volume)', () => {
  function world(tf, base, clock) {
    const key = keyOf({ sym: 'DVX', tf })
    const registry = createRegistry({ ctx: () => ({ nowMs: clock.ms }) })
    const prices = pricesWithVolume()
    const stream = fakeStream()
    const live = createLiveFeed({ registry, pushEnabled: () => false, stream, candle: fakeCandle(), prices, now: () => clock.ms })
    live.attach(key)
    registry.dispatch(key, { type: 'rest-full', key, payload: {
      bars: [{ t: '2026-11-03', o: 90, h: 95, l: 89, c: 94, v: 90000 }, { t: base.t, ...base }],
      contract: 1, grid: 'plain', cache_key: `b1:DVX:${tf}:plain`, series_rev: 1, history_rev: 1,
      complete_through: null, developing: { ...base, rev: 1 },
    } }, { nowMs: clock.ms })
    return { key, registry, prices, stream }
  }

  it('D: every tick folds price into the bar; volume = the day volume, never down; a post-market tick is ignored', () => {
    const clock = { ms: minute(600) * 1000 }
    vi.setSystemTime(clock.ms)
    const w = world('D', { t: DAY, o: 100, h: 102, l: 99, c: 101, v: 5000 }, clock)
    expect(w.registry.getSnapshot(w.key).developing).toMatchObject({ c: 101, v: 5000 })
    let hi = 102, lo = 99, vol = 5000, maxSeen = 5000
    const r = rng(17)
    for (let i = 0; i < 80; i++) {
      clock.ms += 1000 + r.int(0, 4000); vi.setSystemTime(clock.ms)
      const px = Math.round((101 + r.float(-4, 4)) * 100) / 100
      vol += r.int(0, 300)
      const reported = r.float(0, 1) < 0.15 ? vol - 200 : vol    // a lagging snapshot now and then
      w.prices.set('DVX', px, reported)
      maxSeen = Math.max(maxSeen, reported)
      hi = Math.max(hi, px); lo = Math.min(lo, px)
      const d = w.registry.getSnapshot(w.key).developing
      expect(d.c, `tick ${i}`).toBe(px)
      expect([d.o, d.h, d.l]).toEqual([100, hi, lo])
      expect(d.v, `tick ${i} volume (the day volume, never down)`).toBe(maxSeen)
    }
    // non-vacuity: the stream never delivered (push gated off ⇒ no subscription at all)
    expect(w.stream.count()).toBe(0)
    const before = w.registry.getSnapshot(w.key)
    clock.ms = minute(16 * 60 + 30) * 1000; vi.setSystemTime(clock.ms)       // 16:30 ET
    w.prices.set('DVX', 250, vol + 9999)
    expect(w.registry.getSnapshot(w.key)).toBe(before)
  })

  it('W: volume = base + the day volume added since the base arrived (never the base twice)', () => {
    const clock = { ms: minute(600) * 1000 }
    vi.setSystemTime(clock.ms)
    const wk = '2026-11-13'                                     // the week's Friday label
    const key = keyOf({ sym: 'DVX', tf: 'W' })
    const registry = createRegistry({ ctx: () => ({ nowMs: clock.ms }) })
    const prices = pricesWithVolume()
    prices.set('DVX', 101, 3000)                               // day volume when the base arrives
    createLiveFeed({ registry, pushEnabled: () => false, stream: fakeStream(), candle: fakeCandle(), prices, now: () => clock.ms }).attach(key)
    registry.dispatch(key, { type: 'rest-full', key, payload: {
      bars: [{ t: '2026-11-06', o: 90, h: 95, l: 89, c: 94, v: 400000 }, { t: wk, o: 98, h: 102, l: 97, c: 101, v: 120000 }],
      contract: 1, grid: 'plain', cache_key: 'b1:DVX:W:plain', series_rev: 1, history_rev: 1, complete_through: null,
      developing: { t: wk, o: 98, h: 102, l: 97, c: 101, v: 120000, rev: 1 },
    } }, { nowMs: clock.ms })
    clock.ms += 5000; vi.setSystemTime(clock.ms)
    prices.set('DVX', 103, 3800)
    expect(registry.getSnapshot(key).developing).toMatchObject({ o: 98, h: 103, c: 103, v: 120800 })
  })

  it('periodTickVolume (pure): D max; W/M base + delta since arrival, nothing on another day / unknown arrival', () => {
    const base = { v: 1000 }
    expect(periodTickVolume({ base }, 'D', 900, DAY)).toBe(1000)
    expect(periodTickVolume({ base }, 'D', 1500, DAY)).toBe(1500)
    expect(periodTickVolume({ base, dayVol0: 200, day0: DAY }, 'W', 350, DAY)).toBe(1150)
    expect(periodTickVolume({ base, dayVol0: 200, day0: DAY }, 'M', 150, DAY)).toBe(1000)
    expect(periodTickVolume({ base, dayVol0: 200, day0: '2026-11-09' }, 'W', 350, DAY)).toBeNull()
    expect(periodTickVolume({ base, dayVol0: null, day0: DAY }, 'W', 350, DAY)).toBeNull()
    expect(periodTickVolume({ base: null }, 'D', 350, DAY)).toBeNull()
  })
})

describe('G1 — a developing bar past missing buckets is a live gap (status, delta, read, cleared by REST)', () => {
  const row = (t, c = 10) => ({ t, o: 10, h: 11, l: 9, c, v: 100 })
  function seeded(tf, session, upTo) {
    const key = keyOf({ sym: 'GPX', tf, session })
    const step = Number(tf) * 60
    const out = []
    for (let t = minute(session === 'eth' ? 240 : 570); t + step <= upTo; t += step) out.push(row(bucketStartUnix(t, Number(tf))))
    return { key, rows: out }
  }

  it.each([['1', 'rth'], ['5', 'rth'], ['15', 'eth'], ['5', 'eth']].flatMap(([tf, s]) => [0, 1, 3].map((g) => [tf, s, g])))(
    'tf %s %s, %i missing bucket(s)', (tf, session, gap) => {
      const nowMs = minute(13 * 60 + 7) * 1000
      vi.setSystemTime(nowMs)
      const registry = createRegistry({ ctx: () => ({ nowMs }) })
      const step = Number(tf) * 60
      const devT = bucketStartUnix(nowMs / 1000, Number(tf))
      const lastClosed = devT - (gap + 1) * step
      const { key, rows } = seeded(tf, session, lastClosed + step)
      registry.dispatch(key, { type: 'rest-full', key, payload: { bars: rows, verified_through: lastClosed + step } }, { nowMs })
      expect(registry.getSnapshot(key).liveGapFrom).toBeNull()
      registry.dispatch(key, { type: 'push-bar', key, event: { sym: 'GPX', bar: { t: devT * 1000, o: 10, h: 10.5, l: 9.8, c: 10.2, v: 9 }, rev: nowMs } }, { nowMs, streamLive: true })
      const s = registry.getSnapshot(key)
      if (gap === 0) {
        expect(s.liveGapFrom).toBeNull()
        expect(s.status).not.toBe(STATUS.UPDATING)
        return
      }
      expect(s.liveGapFrom, 'the first missing bucket').toBe(lastClosed + step)
      expect(s.status).toBe(STATUS.UPDATING)
      expect(s.deltaFrom).toBeLessThanOrEqual(lastClosed + step)
      // The server answers (whatever it still lacks is its truth): the gap clears.
      registry.dispatch(key, { type: 'rest-delta', key, payload: { bars: [row(lastClosed + step, 10.1)], since: lastClosed } }, { nowMs })
      expect(registry.getSnapshot(key).liveGapFrom).toBeNull()
    })

  it('the overnight / weekend jump is not a gap; a missing first bucket of the session is', () => {
    const k5 = keyOf({ sym: 'GPX', tf: '5' })
    const st = { key: k5, tf: '5', sym: 'GPX' }
    const fri = etUnix('2026-11-06', 15 * 60 + 55), mon930 = etUnix('2026-11-09', 570), mon935 = etUnix('2026-11-09', 575)
    expect(liveGapStart(st, fri, mon930)).toBeNull()
    expect(liveGapStart(st, fri, mon935)).toBe(mon930)
    // a holiday (2026-11-26 Thanksgiving) between two sessions is no gap either
    expect(liveGapStart(st, etUnix('2026-11-25', 15 * 60 + 55), etUnix('2026-11-27', 570))).toBeNull()
  })

  it('the store kicks ONE read per gap (index.js)', async () => {
    vi.resetModules()
    const calls = []
    vi.stubGlobal('fetch', vi.fn((url) => { calls.push(String(url)); return new Promise(() => {}) }))
    const { createBarStore } = await import('./index')
    const nowMs = minute(13 * 60 + 7) * 1000
    vi.setSystemTime(nowMs)
    const store = createBarStore({ live: { stream: fakeStream(), candle: fakeCandle(), prices: pricesWithVolume(), pushEnabled: () => true } })
    const key = keyOf({ sym: 'GPX', tf: '5' })
    const off = store.subscribe(key, () => {})
    const kick = vi.spyOn(store.network, 'kick')
    store.registry.dispatch(key, { type: 'rest-full', key, gen: store.getSnapshot(key).gen, payload: { bars: [row(minute(600)), row(minute(605))] } }, { nowMs })
    store.registry.dispatch(key, { type: 'push-bar', key, event: { sym: 'GPX', bar: { t: minute(13 * 60 + 5) * 1000, o: 10, h: 10, l: 10, c: 10, v: 1 }, rev: nowMs } }, { nowMs, streamLive: true })
    store.registry.dispatch(key, { type: 'push-bar', key, event: { sym: 'GPX', bar: { t: minute(13 * 60 + 5) * 1000, o: 10, h: 10.2, l: 10, c: 10.1, v: 2 }, rev: nowMs + 1 } }, { nowMs, streamLive: true })
    expect(kick).toHaveBeenCalledTimes(1)
    off(); store.dispose?.()
  })
})

describe('V1 — rows a tick closed are unverified until REST replaces them', () => {
  it('status stays below current while a tick-closed row is the tail; a REST answer replaces it and restores current', () => {
    const nowMs = minute(13 * 60 + 7) * 1000
    vi.setSystemTime(nowMs)
    const key = keyOf({ sym: 'TCX', tf: '5' })
    const registry = createRegistry({ ctx: () => ({ nowMs }) })
    const rows = []
    for (let t = minute(570); t <= minute(13 * 60); t += 300) rows.push({ t, o: 10, h: 11, l: 9, c: 10.5, v: 100 })
    registry.dispatch(key, { type: 'rest-full', key, payload: { bars: rows, verified_through: minute(13 * 60 + 5), tail_status: 'verified',
      developing: { t: minute(13 * 60 + 5), o: 10.5, h: 10.6, l: 10.4, c: 10.5, v: 10 } } }, { nowMs })
    expect(registry.getSnapshot(key).status).toBe(STATUS.CURRENT)
    // the fallback ticks into the NEXT bucket: the developing bar closes as a tick row
    const later = minute(13 * 60 + 11) * 1000
    vi.setSystemTime(later)
    registry.dispatch(key, { type: 'tick-fallback', key, event: { price: 10.55, ts: minute(13 * 60 + 5) * 1000 + 30_000 } }, { nowMs: later, streamLive: false })
    registry.dispatch(key, { type: 'tick-fallback', key, event: { price: 10.7, ts: later } }, { nowMs: later, streamLive: false })
    let s = registry.getSnapshot(key)
    expect(s.bars.at(-1)).toMatchObject({ t: minute(13 * 60 + 5), src: 'tick' })
    expect(tickClosedTail(s)).toBe(true)
    expect(s.status, 'a tick-closed tail is not server-verified').not.toBe(STATUS.CURRENT)
    // REST replaces the tick row (rest > tick) and re-verifies the tail.
    registry.dispatch(key, { type: 'rest-delta', key, payload: { since: minute(13 * 60), verified_through: minute(13 * 60 + 10), tail_status: 'verified',
      bars: [{ t: minute(13 * 60 + 5), o: 10.5, h: 10.9, l: 10.3, c: 10.6, v: 420 }] } }, { nowMs: later })
    s = registry.getSnapshot(key)
    expect(s.bars.at(-1)).toMatchObject({ t: minute(13 * 60 + 5), o: 10.5, h: 10.9, l: 10.3, c: 10.6, v: 420, src: 'rest' })
    expect(tickClosedTail(s)).toBe(false)
    expect(s.status).toBe(STATUS.CURRENT)
  })
})
