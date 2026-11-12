// P3-S2b — the store's live input is whichever live source is ACTIVE (prod: push gated off by
// VITE_REALTIME_BARS=0); a live gap is judged against SERVER PROOF; rows a tick closed are a flag,
// not a status. Synthetic prices only.
//
// Contracts, stated generally:
//   L1  push gated off: the tick fallback drives the D/W/M period bar — price (H/L union, close)
//       AND volume. The SERVER's period bar defines the volume; the live day-volume feed only adds
//       what traded since the server's bar arrived (periodTickVolume, one owner) — never the feed's
//       own (differently defined) total; a non-RTH tick never moves the period bar.
//   S4v within a period the developing bar's volume never falls, over any interleaving of ticks and
//       non-final REST answers (seeded).
//   G1  a bucket is MISSING only if it starts at or after max(verifiedThrough, end of the newest
//       row) — the server never vouched for it. A thin name's proven-empty buckets: no gap, no
//       read, no status change, the candle paints. A true gap: ONE read; the candle still paints;
//       status is not touched; a server answer clears it. (seeded)
//   V1  rows the tick fallback CLOSED set `tailUnverified` until a REST answer replaces them; the
//       status never flaps across tick bucket rolls.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRegistry } from './registry'
import { createLiveFeed, periodTickVolume } from './liveFeed'
import { liveGapStart } from './reducer'
import { keyOf, STATUS } from './types'
import { etUnix, rng } from './__fixtures__/seededSeries'
import { fakeStream, fakeCandle } from './testing/fakeFeeds'
import { bucketStartUnix } from '../../components/chart/barTime'
import { viewDevelopingOf } from '../../components/chart/useBarSnapshotBars'

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

function dailyWorld(tf, base, clock, feedVolAtArrival) {
  const key = keyOf({ sym: 'DVX', tf })
  const registry = createRegistry({ ctx: () => ({ nowMs: clock.ms }) })
  const prices = pricesWithVolume()
  prices.set('DVX', base.c, feedVolAtArrival)    // the feed's day volume when the server's bar arrives
  const stream = fakeStream()
  createLiveFeed({ registry, pushEnabled: () => false, stream, candle: fakeCandle(), prices, now: () => clock.ms }).attach(key)
  const rest = (dev, rev) => registry.dispatch(key, { type: 'rest-full', key, payload: {
    bars: [{ t: '2026-11-03', o: 90, h: 95, l: 89, c: 94, v: 90000 }, { t: dev.t, ...dev }],
    contract: 1, grid: 'plain', cache_key: `b1:DVX:${tf}:plain`, series_rev: rev, history_rev: 1,
    complete_through: null, developing: { ...dev, rev },
  } }, { nowMs: clock.ms })
  rest(base, 1)
  return { key, registry, prices, stream, rest }
}

describe('L1 — push gated off: the tick fallback drives the D/W/M period bar (price AND volume)', () => {
  it('D: ticks fold price; volume = the SERVER bar + what the feed saw trade since it arrived; a post-market tick is ignored', () => {
    const clock = { ms: minute(600) * 1000 }
    vi.setSystemTime(clock.ms)
    // The server's daily aggregate (extended hours included) is LARGER than the feed's regular-
    // session day volume at the same instant: the two are different definitions.
    const w = dailyWorld('D', { t: DAY, o: 100, h: 102, l: 99, c: 101, v: 5000 }, clock, 3000)
    let hi = 102, lo = 99, feed = 3000, maxFeed = 3000
    const r = rng(17)
    for (let i = 0; i < 80; i++) {
      clock.ms += 1000 + r.int(0, 4000); vi.setSystemTime(clock.ms)
      const px = Math.round((101 + r.float(-4, 4)) * 100) / 100
      feed += r.int(0, 300)
      const reported = r.float(0, 1) < 0.15 ? feed - 200 : feed    // a lagging snapshot now and then
      w.prices.set('DVX', px, reported)
      maxFeed = Math.max(maxFeed, reported)
      hi = Math.max(hi, px); lo = Math.min(lo, px)
      const d = w.registry.getSnapshot(w.key).developing
      expect(d.c, `tick ${i}`).toBe(px)
      expect([d.o, d.h, d.l]).toEqual([100, hi, lo])
      // never the feed's own total (which would freeze at 5000 until it passed the server's)
      expect(d.v, `tick ${i} volume`).toBe(5000 + (maxFeed - 3000))
    }
    expect(w.stream.count()).toBe(0)   // push gated off ⇒ no stream subscription at all
    const before = w.registry.getSnapshot(w.key)
    clock.ms = minute(16 * 60 + 30) * 1000; vi.setSystemTime(clock.ms)       // 16:30 ET
    w.prices.set('DVX', 250, feed + 9999)
    expect(w.registry.getSnapshot(w.key)).toBe(before)
  })

  it('W: volume = base + the day volume added since the base arrived (never the base twice)', () => {
    const clock = { ms: minute(600) * 1000 }
    vi.setSystemTime(clock.ms)
    const w = dailyWorld('W', { t: '2026-11-13', o: 98, h: 102, l: 97, c: 101, v: 120000 }, clock, 3000)
    clock.ms += 5000; vi.setSystemTime(clock.ms)
    w.prices.set('DVX', 103, 3800)
    expect(w.registry.getSnapshot(w.key).developing).toMatchObject({ o: 98, h: 103, c: 103, v: 120800 })
  })

  it('periodTickVolume (pure): base + delta since arrival for D/W/M; nothing on another day / unknown arrival', () => {
    const base = { v: 1000 }
    for (const tf of ['D', 'W', 'M']) {
      expect(periodTickVolume({ base, dayVol0: 200, day0: DAY }, tf, 350, DAY)).toBe(1150)
      expect(periodTickVolume({ base, dayVol0: 200, day0: DAY }, tf, 150, DAY)).toBe(1000)
      expect(periodTickVolume({ base, dayVol0: 200, day0: '2026-11-09' }, tf, 350, DAY)).toBeNull()
      expect(periodTickVolume({ base, dayVol0: null, day0: DAY }, tf, 350, DAY)).toBeNull()
    }
    expect(periodTickVolume({ base: null }, 'D', 350, DAY)).toBeNull()
  })
})

describe('S4v — the developing period bar\'s volume never falls within its period (seeded)', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('seed %i: ticks and non-final REST answers in any order', (seed) => {
    const r = rng(seed * 7919)
    const clock = { ms: minute(600) * 1000 }
    vi.setSystemTime(clock.ms)
    let serverV = 5000 + r.int(0, 2000), feed = 2000 + r.int(0, 2000), rev = 1
    const w = dailyWorld('D', { t: DAY, o: 100, h: 102, l: 99, c: 101, v: serverV }, clock, feed)
    let prevV = w.registry.getSnapshot(w.key).developing.v
    for (let i = 0; i < 120; i++) {
      clock.ms += 500 + r.int(0, 3000); vi.setSystemTime(clock.ms)
      if (r.float(0, 1) < 0.25) {
        // a non-final server answer: its volume may LAG what the client already shows
        serverV += r.int(-400, 600)
        w.rest({ t: DAY, o: 100, h: 102 + r.float(0, 1), l: 99 - r.float(0, 1), c: 101, v: Math.max(1, serverV) }, ++rev)
      } else {
        feed += r.int(-50, 300)       // the feed can momentarily report less (a stale snapshot)
        w.prices.set('DVX', Math.round((101 + r.float(-3, 3)) * 100) / 100, Math.max(1, feed))
      }
      const v = w.registry.getSnapshot(w.key).developing.v
      expect(v, `step ${i}`).toBeGreaterThanOrEqual(prevV)
      prevV = v
    }
  })
})

describe('G1 — a bucket is missing only if the server never vouched for it', () => {
  const row = (t, c = 10) => ({ t, o: 10, h: 11, l: 9, c, v: 100 })

  it.each([['1', 'rth'], ['5', 'rth'], ['15', 'eth'], ['5', 'eth']].flatMap(([tf, s]) => [0, 1, 3].map((g) => [tf, s, g])))(
    'TRUE gap — tf %s %s, %i unvouched missing bucket(s): one read, candle painted, status untouched', (tf, session, gap) => {
      const nowMs = minute(13 * 60 + 7) * 1000
      vi.setSystemTime(nowMs)
      const registry = createRegistry({ ctx: () => ({ nowMs }) })
      const step = Number(tf) * 60
      const devT = bucketStartUnix(nowMs / 1000, Number(tf))
      const lastClosed = devT - (gap + 1) * step
      const key = keyOf({ sym: 'GPX', tf, session })
      const rows = []
      for (let t = minute(session === 'eth' ? 240 : 570); t <= lastClosed; t += step) rows.push(row(bucketStartUnix(t, Number(tf))))
      // the server vouched only for what it sent (through the end of the newest row)
      registry.dispatch(key, { type: 'rest-full', key, payload: { bars: rows, verified_through: lastClosed + step } }, { nowMs })
      registry.dispatch(key, { type: 'push-bar', key, event: { sym: 'GPX', bar: { t: devT * 1000, o: 10, h: 10.5, l: 9.8, c: 10.2, v: 9 }, rev: nowMs } }, { nowMs, streamLive: true })
      const s0 = registry.getSnapshot(key)
      expect(s0.liveGapFrom).toBe(gap === 0 ? null : lastClosed + step)
      expect(s0.status, 'a gap is not a status').not.toBe(STATUS.UPDATING)
      expect(viewDevelopingOf(s0, s0, {}), 'the forming candle still paints').toMatchObject({ t: devT })
      if (gap) {
        expect(s0.deltaFrom).toBeLessThanOrEqual(lastClosed + step)
        registry.dispatch(key, { type: 'rest-delta', key, payload: { bars: [row(lastClosed + step, 10.1)], since: lastClosed } }, { nowMs })
        expect(registry.getSnapshot(key).liveGapFrom).toBeNull()
      }
    })

  // INVARIANT (seeded): a thin name — random proven-empty buckets the server vouched for (its
  // verified_through reaches the live edge) — never raises a gap, a read, or a status change, and
  // its candle always paints, however long the quiet stretch before each new bucket.
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('thin name, seed %i: proven-empty buckets are never a gap', async (seed) => {
    const r = rng(seed * 104729)
    for (const tf of ['1', '5']) {
      const step = Number(tf) * 60
      let nowMs = minute(10 * 60) * 1000
      vi.setSystemTime(nowMs)
      const registry = createRegistry({ ctx: () => ({ nowMs }) })
      const key = keyOf({ sym: 'THN', tf })
      const rows = []
      for (let t = minute(570); t < nowMs / 1000 - step; t += step) if (r.float(0, 1) < 0.4) rows.push(row(t))
      if (!rows.length) rows.push(row(minute(570)))
      registry.dispatch(key, { type: 'rest-full', key, payload: { bars: rows, verified_through: bucketStartUnix(nowMs / 1000, Number(tf)) } }, { nowMs })
      for (let k = 0; k < 12; k++) {
        const status0 = registry.getSnapshot(key).status
        // a quiet stretch of 0..6 buckets, then a print — and the server vouches for the stretch
        nowMs += step * 1000 * r.int(1, 7); vi.setSystemTime(nowMs)
        const devT = bucketStartUnix(nowMs / 1000, Number(tf))
        registry.dispatch(key, { type: 'rest-delta', key, payload: { bars: [], since: devT - 1, verified_through: devT } }, { nowMs })
        const before = registry.getSnapshot(key).status
        registry.dispatch(key, { type: 'push-bar', key, event: { sym: 'THN', bar: { t: devT * 1000, o: 10, h: 10, l: 10, c: 10, v: 1 }, rev: nowMs } }, { nowMs, streamLive: true })
        const s = registry.getSnapshot(key)
        expect(s.liveGapFrom, `tf ${tf} step ${k}`).toBeNull()
        expect(s.status === before || s.status === status0 || s.status === STATUS.CURRENT || s.status === STATUS.CONTEXT).toBe(true)
        expect(s.status).not.toBe(STATUS.UPDATING)
        expect(viewDevelopingOf(s, s, {})).toMatchObject({ t: devT })
      }
    }
  })

  it('pure: vouched buckets are skipped; the overnight / weekend / holiday jump is not a gap', () => {
    const k5 = keyOf({ sym: 'GPX', tf: '5' })
    const st = { key: k5, tf: '5', sym: 'GPX', verifiedThrough: null }
    const fri = etUnix('2026-11-06', 15 * 60 + 55), mon930 = etUnix('2026-11-09', 570), mon935 = etUnix('2026-11-09', 575)
    expect(liveGapStart(st, fri, mon930)).toBeNull()
    expect(liveGapStart(st, fri, mon935)).toBe(mon930)
    expect(liveGapStart({ ...st, verifiedThrough: mon935 }, fri, mon935)).toBeNull()        // the server vouched for 09:30
    expect(liveGapStart({ ...st, verifiedThrough: mon935 }, fri, mon935 + 300)).toBe(mon935) // …not for 09:35
    expect(liveGapStart(st, etUnix('2026-11-25', 15 * 60 + 55), etUnix('2026-11-27', 570))).toBeNull()
  })

  it('the store kicks ONE read per gap (index.js)', async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
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

describe('V1 — tick-closed rows are a flag (tailUnverified), not a status', () => {
  it('N tick bucket rolls never flap the status; the flag holds until a REST answer replaces the rows', () => {
    let nowMs = minute(13 * 60 + 7) * 1000
    vi.setSystemTime(nowMs)
    const key = keyOf({ sym: 'TCX', tf: '5' })
    const registry = createRegistry({ ctx: () => ({ nowMs }) })
    const rows = []
    for (let t = minute(570); t <= minute(13 * 60); t += 300) rows.push({ t, o: 10, h: 11, l: 9, c: 10.5, v: 100 })
    registry.dispatch(key, { type: 'rest-full', key, payload: { bars: rows, verified_through: minute(13 * 60 + 5), tail_status: 'verified',
      developing: { t: minute(13 * 60 + 5), o: 10.5, h: 10.6, l: 10.4, c: 10.5, v: 10 } } }, { nowMs })
    expect(registry.getSnapshot(key).status).toBe(STATUS.CURRENT)
    expect(registry.getSnapshot(key).tailUnverified).toBe(false)
    const seen = new Set()
    for (let k = 0; k < 8; k++) {
      nowMs += 300_000; vi.setSystemTime(nowMs)
      registry.dispatch(key, { type: 'tick-fallback', key, event: { price: 10.5 + k * 0.01, ts: nowMs } }, { nowMs, streamLive: false })
      const s = registry.getSnapshot(key)
      seen.add(s.status)
      if (s.bars.at(-1).src === 'tick') expect(s.tailUnverified, `roll ${k}`).toBe(true)
    }
    expect([...seen], 'status across tick rolls').toEqual([STATUS.CURRENT])
    // REST replaces the tick rows (rest > tick): the flag clears.
    const last = registry.getSnapshot(key).bars.at(-1)
    registry.dispatch(key, { type: 'rest-delta', key, payload: { since: minute(13 * 60), verified_through: nowMs / 1000, tail_status: 'verified',
      bars: registry.getSnapshot(key).bars.filter((b) => b.src === 'tick').map((b) => ({ t: b.t, o: b.o, h: b.h + 0.1, l: b.l, c: b.c, v: 420 })) } }, { nowMs })
    const s = registry.getSnapshot(key)
    expect(s.bars.find((b) => b.t === last.t)).toMatchObject({ v: 420, src: 'rest' })
    expect(s.tailUnverified).toBe(false)
    expect(s.status).toBe(STATUS.CURRENT)
  })
})
