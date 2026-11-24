// ⭐ THE MINUTE FEED BRINGS 5m / 15m / 30m / 60m KEYS CURRENT TOO (2026-11-24, minuteFeed.js, second slice).
// Real registry, real reducer, the real minute-frame consumer AND ITS ROLLUP (lib/minuteFrames/rollup.js, the one the
// device store uses, configured as the page feed configures it: `feedRollup`), real frame bytes. No network.
//
// THE RULE: a CLOSED bucket is appended only when EVERY one of its minutes is kept for the symbol (each came through
// the 1m rule: a regular-session minute of a complete frame, received while the symbol was held), and it is the bucket
// right after the copy's newest closed one. Otherwise nothing is appended and the key stays behind exactly as today.
//
//   APPEND      H1 a 15m key across two bucket boundaries      H2 what a press at 10:16 finds, and what the switch rule says
//               H3 a 60m key on the SESSION grid: 09:30-10:30 (from the forming bar the server named at the open), 10:30-11:30
//               H4 a half day: the 12:30-13:00 half bar of 60m and the last 15m bucket; nothing after the 13:00 close
//               H8 a LATE record that completes a bucket after its end
//               H15 1m, 5m, 15m and 30m keys of one symbol, from the same frames
//   NOTHING     H3b a forming bar at the open the server did NOT name: no bridge over the night
//               H3d ...nor when the answer does not say the server was current at the open (verified_through: review N2)
//   APPENDED    H3c a named forming bar two buckets ahead INSIDE the session: no bridge (a quiet bucket is not proved)
//               H5 a minute with no bar inside the bucket (a complete frame without the symbol)
//               H6 an INCOMPLETE frame, a missed frame inside the bucket
//               H7 a symbol held only after its bucket began; fed again from the bucket after its next answer
//               H16 a 60m bucket whose first minutes are no longer kept
//   FORMING     H9 the forming bucket is never synthesized; the server's forming bar is left alone until its bucket closes whole
//               H9b a forming bar whose bucket is not whole is never stepped past (it would close as a stale partial bar)
//               H9c a forming bar stamped after the bucket's end is still closed with the FEED's values
//   SERVER WINS H10 a later answer replaces a fed bucket; a sealed span keeps the feed out
//               H17 an answer built BEFORE the bucket closed does not turn the closed bucket back into a forming one
//   CORRECTIONS H11 a REPLACE record inside a bucket, before and after it was appended
//               H11c a correction the rollup could NOT settle (it reports the bucket stale): the bucket is rebuilt from
//                    the kept minutes   H11d ...also after it was appended (a bad-print high removed: review B2)
//               H11e ...also when the rollup reports it without restating the bucket (a late minute two buckets back)
//               H12 ...one 29 minutes back inside a 60m bucket is still settled exactly
//   LEFT ALONE  H13 a key a chart is on (fed once the chart leaves)      H13b no answer, a saved copy, a pending full re-read
//               H14 the extended 60m key, a windowed key, a D key        H14b what makes the feed poll
//   COST        H18 a symbol no longer held is forgotten by the rollup too (its minutes and buckets are not kept all day)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRegistry } from './registry'
import * as feedModule from './minuteFeed'
import { ACTION, keyOf } from './types'
import { newestBarIsFormingOf } from './adapter'
import { createMinuteFrameConsumer } from '../../lib/minuteFrames/consumer'
import { decodeFrame, KIND_LATE, KIND_REPLACE } from '../../lib/minuteFrames/codec'
import { writeFrame, statusResponse } from '../../lib/minuteFrames/testing/frameWriter'
import { expectedBarsBehind } from '../../utils/marketSession'

const { createMinuteFeeder, RING_MINUTES } = feedModule
/** The rollup as THE PAGE FEED configures it (before this slice: 1m only). */
const rollupOf = (feeder) => (feedModule.feedRollup ? feedModule.feedRollup(feeder) : { tfs: ['1'], accept: feeder.accept })

const TUE = Date.UTC(2026, 10, 10, 14, 30) / 60000               // Tue 2026-11-10 09:30 ET, as a unix minute
const HALF = Date.UTC(2026, 10, 27, 14, 30) / 60000              // Fri 2026-11-27 09:30 ET: the regular session ends 13:00
const Y1430 = -19 * 60                                           // yesterday 14:30, in minutes from today's 09:30
const Y1530 = -18 * 60                                           // yesterday 15:30

afterEach(() => { vi.useRealTimers() })

/** One minute's true bar (n = minutes since 09:30). */
const bar1 = (n) => ({ o: 2000 + n, h: 2001 + n, l: 1999 + n, c: 2000.5 + n, v: 100 + n })
const rec = (sym, n, over = {}) => ({ sym, ...bar1(n), ...over })

function world({ open = TUE, start = [30, 20], feederOpts = {}, registryOpts = {} } = {}) {
  const M = (n) => open + n
  const T = (n) => M(n) * 60
  const at = (n, sec = 0) => M(n) * 60_000 + sec * 1000
  const clock = { ms: at(...start) }
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(clock.ms)
  const active = new Set()
  const registry = createRegistry({ ctx: () => ({ nowMs: clock.ms }), ...registryOpts })
  const feeder = createMinuteFeeder({ registry, isActive: (k) => active.has(k), sliceMs: Infinity, ...feederOpts })
  const consumer = createMinuteFrameConsumer({
    sink: feeder.sink, tailOnly: true, rollup: rollupOf(feeder),
    now: () => clock.ms, fetchImpl: async () => statusResponse(404), setTimer: () => 0, clearTimer: () => {},
  })
  const key = (sym, tf) => keyOf({ sym, tf })
  /** THE TRUE BUCKET of minutes a..b (what the server builds from the same minutes). `px` shifts its prices (another
   *  observation of it); `v` states its volume when a minute of it was corrected. */
  const agg = (a, b, { px = 0, v = null } = {}) => {
    let sum = 0
    for (let n = a; n <= b; n++) sum += 100 + n
    return { t: T(a), o: 2000 + a + px, h: 2001 + b + px, l: 1999 + a + px, c: 2000.5 + b + px, v: v ?? sum }
  }
  const w = {
    M, T, at, clock, active, registry, feeder, key, agg, consumer,
    /** A list warms the row: the key exists, no answer yet. */
    hold(sym, tf) { registry.acquire(key(sym, tf)) },
    /** The SERVER's answer for (sym, tf), built at `builtAt`: the closed buckets `closed` ([first minute, last minute]
     *  each), sealed up to minute `seal` (default: all but the newest), an optional forming bar starting at minute
     *  `dev`. `named`: as the route sends it, the forming bar is also the LAST of `bars` and `newest_bar_is_forming`. */
    answer(sym, tf, { closed, dev = null, named = false, builtAt = clock.ms, seal, px = 0, seriesRev = builtAt, verified } = {}) {
      const grid = tf === '60' ? 'rth-tv' : 'eth-clock'
      const bars = closed.map(([a, b]) => agg(a, b, { px }))
      // a forming bar is a PARTIAL observation: a narrower range and less volume than the bucket ends with
      const forming = dev == null ? null : { t: T(dev), o: 2000 + dev, h: 2000.2 + dev, l: 1999.9 + dev, c: 2000.1 + dev, v: 7 }
      if (named) bars.push(forming)
      const sealAt = seal === undefined ? (closed.length ? closed[closed.length - 1][0] : null) : seal
      return registry.dispatch(key(sym, tf), {
        type: ACTION.REST_FULL,
        payload: {
          ticker: sym, tf, contract: 1, grid, session: 'rth', cache_key: `b1:${sym}:${tf}:${grid}`,
          series_rev: seriesRev, history_rev: 1, tail_status: 'verified',
          // when the provider / stream last proved the series current: by default, as the answer was built
          verified_through: verified === undefined ? Math.floor(builtAt / 1000) : verified,
          complete_through: sealAt == null ? null : T(sealAt), bars, ...(named ? { newest_bar_is_forming: true } : {}),
          developing: forming ? { ...forming, rev: builtAt } : null,
        },
      })
    },
    /** One frame of minute n, applied through the consumer when it would land (8 s after the minute ends). */
    frame(n, { rows = [rec('AAA', n), rec('BBB', n)], blocks = [], ...opts } = {}) {
      clock.ms = Math.max(clock.ms, at(n + 1, 8))
      return consumer.applyFrame(decodeFrame(writeFrame({ minute: M(n), blocks: [{ rows }, ...blocks], ...opts })))
    },
    /** Frames a..b. `how(n)` may return that frame's options, or 'skip' (the frame never reaches this page). */
    frames(a, b, how = () => undefined) {
      for (let n = a; n <= b; n++) { const o = how(n); if (o !== 'skip') w.frame(n, o) }
    },
    snap: (sym, tf) => registry.peek(key(sym, tf)),
    tail: (sym, tf) => { const b = registry.peek(key(sym, tf))?.bars; return b?.length ? b[b.length - 1] : null },
    row: (sym, tf, n) => registry.peek(key(sym, tf))?.bars.find((b) => b.t === T(n)) ?? null,
    /** The start minutes of the closed rows from minute `from` on. */
    starts: (sym, tf, from) => registry.peek(key(sym, tf)).bars.filter((b) => b.t >= T(from)).map((b) => (b.t - T(0)) / 60),
  }
  return w
}
/** Minute n's frame without AAA (a complete frame: the name was quiet, or its bar is late). */
const withoutAAA = (...ns) => (n) => (ns.includes(n) ? { rows: [rec('BBB', n)] } : undefined)

describe('minute feed · 5m-60m: a closed bucket is appended when every one of its minutes was fed', () => {
  it('H1 a 15m key across two bucket boundaries: nothing until a bucket is whole, then that bucket, closed, at the server grain', () => {
    const w = world()                                             // 10:00:20
    w.answer('AAA', '15', { closed: [[0, 14], [15, 29]] })        // the server's rows end with the 09:45 bucket
    const before = w.snap('AAA', '15')
    w.frames(30, 43)                                              // 10:00 .. 10:13: the 10:00 bucket is forming
    expect(w.snap('AAA', '15')).toBe(before)                      // not touched at all: no forming bar is made up
    w.frame(44)                                                   // 10:14 closed: the bucket is whole
    expect(w.tail('AAA', '15')).toMatchObject({ ...w.agg(30, 44), src: 'final', fin: true, rev: w.M(45) * 60_000 })
    expect(w.snap('AAA', '15').developing).toBe(null)
    const mid = w.snap('AAA', '15')
    w.frames(45, 58)
    expect(w.snap('AAA', '15')).toBe(mid)
    w.frame(59)
    expect(w.tail('AAA', '15')).toMatchObject({ ...w.agg(45, 59), src: 'final' })
    expect(w.starts('AAA', '15', 0)).toEqual([0, 15, 30, 45])
    expect(w.feeder.stats()).toMatchObject({ appended: 2, rejected: 0, breaks: 0 })
  })

  it('H2 a press at 10:16: closed through the bucket that ended 10:15, no forming bar, and the switch rule calls it current', () => {
    const w = world()
    w.answer('AAA', '15', { closed: [[0, 14], [15, 29]] })
    w.answer('BBB', '15', { closed: [[0, 14], [15, 29]] })
    w.active.add(w.key('BBB', '15'))                              // BBB: the same copy, not fed (the control)
    w.frames(30, 45)                                              // the 10:15 frame landed at 10:16:08
    const s = w.snap('AAA', '15')
    expect(s.bars[s.bars.length - 1]).toMatchObject(w.agg(30, 44))
    expect(s.developing).toBe(null)                               // the 10:15 bucket: the chart's own stream / answer brings it
    expect(newestBarIsFormingOf(s)).not.toBe(true)
    // prefetch._behindClock: the newest bar against the clock's previous bucket
    const now = w.at(46, 10)                                      // 10:16:10
    expect(expectedBarsBehind(w.tail('AAA', '15').t, '15', now, { session: 'rth' })).toBe(0)
    expect(expectedBarsBehind(w.tail('BBB', '15').t, '15', now, { session: 'rth' })).toBe(1)   // unfed: behind, it asks
  })

  it('H3 a 60m key on the SESSION grid: 09:30-10:30 closes the forming bar the server named at the open, then 10:30-11:30', () => {
    const w = world({ start: [-2, 20] })                          // 09:28:20
    w.hold('AAA', '60')                                           // a list warmed the row before the open
    w.frames(0, 9)
    w.clock.ms = w.at(10, 20)                                     // 09:40:20: the answer. Its newest bar is today's first, forming
    w.answer('AAA', '60', { closed: [[Y1430, Y1430 + 59], [Y1530, Y1530 + 29]], dev: 0, named: true })
    const before = w.snap('AAA', '60')
    w.frames(10, 58)                                              // through 10:28, across the clock grid's 10:00
    expect(w.snap('AAA', '60')).toBe(before)
    expect(w.tail('AAA', '60').t).toBe(w.T(Y1530))
    w.frame(59)                                                   // 10:29 closed: 09:30-10:30 is whole
    expect(w.tail('AAA', '60')).toMatchObject({ ...w.agg(0, 59), src: 'final', fin: true, rev: w.M(60) * 60_000 })
    expect(w.snap('AAA', '60').developing).toBe(null)
    expect(newestBarIsFormingOf(w.snap('AAA', '60'))).toBe(false)
    expect(expectedBarsBehind(w.tail('AAA', '60').t, '60', w.at(61, 10), { session: 'rth' })).toBe(0)   // 10:31:10: current
    w.frames(60, 118)
    expect(w.tail('AAA', '60').t).toBe(w.T(0))
    w.frame(119)                                                  // 11:29
    expect(w.tail('AAA', '60')).toMatchObject({ ...w.agg(60, 119), src: 'final' })
    expect(w.starts('AAA', '60', Y1530)).toEqual([Y1530, 0, 60])
    expect(w.feeder.stats()).toMatchObject({ appended: 2, rejected: 0 })
  })

  it('H3b a forming bar at the open that the server did NOT name as its newest: no bridge over the night', () => {
    const w = world({ start: [-2, 20] })
    w.hold('AAA', '60')
    w.frames(0, 9)
    w.clock.ms = w.at(10, 20)
    w.answer('AAA', '60', { closed: [[Y1430, Y1430 + 59], [Y1530, Y1530 + 29]], dev: 0 })
    const before = w.snap('AAA', '60')
    w.frames(10, 59)
    expect(w.snap('AAA', '60')).toBe(before)                      // yesterday's 15:30 bar is still its newest closed row
    expect(before.developing).toMatchObject({ t: w.T(0), v: 7 })
  })

  it.each([
    ['proved current only up to 09:29 (its store lagged at the open)', (w) => w.T(-1)],
    ['that does not say when it was last proved current', () => null],
  ])('H3d a named forming bar at the open from an answer %s: no bridge (a bar before the open may be missing from it)', (_name, verified) => {
    const w = world({ start: [-2, 20] })
    w.hold('AAA', '60')
    w.frames(0, 9)
    w.clock.ms = w.at(10, 20)
    w.answer('AAA', '60', { closed: [[Y1430, Y1430 + 59], [Y1530, Y1530 + 29]], dev: 0, named: true, verified: verified(w) })
    const before = w.snap('AAA', '60')
    expect(before.developing).toMatchObject({ t: w.T(0), v: 7 })
    w.frames(10, 59)
    expect(w.snap('AAA', '60')).toBe(before)
    expect(w.feeder.stats()).toMatchObject({ appended: 0, rejected: 0 })
  })

  it('H3c a named forming bar two buckets ahead INSIDE the session: no bridge (the server having no bar there does not prove the bucket empty for good)', () => {
    const w = world({ start: [28, 20] })
    w.hold('AAA', '15')
    w.frames(29, 45, withoutAAA(30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44))   // AAA: no trade 10:00-10:15
    w.clock.ms = w.at(46, 20)                                     // 10:16:20: the answer has no 10:00 bucket
    w.answer('AAA', '15', { closed: [[0, 14], [15, 29]], dev: 45, named: true })
    const before = w.snap('AAA', '15')
    w.frames(46, 59)                                              // 10:15-10:30 is whole for AAA
    expect(w.snap('AAA', '15')).toBe(before)
    expect(w.feeder.stats()).toMatchObject({ appended: 0, rejected: 0 })
  })

  it('H4 a half day: the 12:30-13:00 half bar of 60m and the last 15m bucket; nothing after the 13:00 close', () => {
    const w = world({ open: HALF, start: [118, 20] })             // Fri 2026-11-27 11:28:20
    w.hold('AAA', '60'); w.hold('AAA', '15')
    w.frames(119, 169)
    w.clock.ms = w.at(170, 20)                                    // 12:20:20
    w.answer('AAA', '60', { closed: [[0, 59], [60, 119]], dev: 120, named: true })
    w.answer('AAA', '15', { closed: [[135, 149], [150, 164]], dev: 165, named: true })
    w.frames(170, 178)
    expect(w.tail('AAA', '60').t).toBe(w.T(60))
    expect(w.tail('AAA', '15').t).toBe(w.T(150))
    w.frame(179)                                                  // 12:29
    expect(w.tail('AAA', '60')).toMatchObject({ ...w.agg(120, 179), src: 'final' })
    expect(w.tail('AAA', '15')).toMatchObject({ ...w.agg(165, 179), src: 'final' })
    w.frames(180, 208)
    expect(w.tail('AAA', '60').t).toBe(w.T(120))
    expect(w.tail('AAA', '15')).toMatchObject(w.agg(180, 194))
    w.frame(209)                                                  // 12:59: the last regular minute of the half day
    expect(w.tail('AAA', '60')).toMatchObject({ ...w.agg(180, 209), src: 'final', fin: true, rev: w.M(210) * 60_000 })   // 30 minutes
    expect(w.tail('AAA', '15')).toMatchObject({ ...w.agg(195, 209), src: 'final' })
    const s60 = w.snap('AAA', '60')
    const s15 = w.snap('AAA', '15')
    w.frames(210, 240)                                            // 13:00-13:30: post-market today
    expect(w.snap('AAA', '60')).toBe(s60)
    expect(w.snap('AAA', '15')).toBe(s15)
    expect(s60.developing).toBe(null)
    expect(w.starts('AAA', '60', 0)).toEqual([0, 60, 120, 180])
    const now = w.at(215, 0)                                      // 13:05: the session is over
    expect(expectedBarsBehind(s60.bars[s60.bars.length - 1].t, '60', now, { session: 'rth' })).toBe(0)
    expect(expectedBarsBehind(s15.bars[s15.bars.length - 1].t, '15', now, { session: 'rth' })).toBe(0)
  })

  it('H8 a LATE record that completes a bucket after its end: the bucket is appended then, and the walk carries on', () => {
    const w = world()
    w.answer('AAA', '15', { closed: [[0, 14], [15, 29]] })
    w.frames(30, 44, withoutAAA(44))                              // AAA's 10:14 bar is late
    expect(w.tail('AAA', '15').t).toBe(w.T(15))
    w.frame(45, { blocks: [{ minute: w.M(44), kind: KIND_LATE, rows: [rec('AAA', 44)] }] })
    expect(w.tail('AAA', '15')).toMatchObject({ ...w.agg(30, 44), src: 'final', fin: true, rev: w.M(45) * 60_000 })
    w.frames(46, 59)
    expect(w.starts('AAA', '15', 15)).toEqual([15, 30, 45])
  })

  it('H15 1m, 5m, 15m and 30m keys of one symbol are fed from the same frames, each on its own grid', () => {
    const w = world()
    w.registry.dispatch(w.key('AAA', '1'), { type: ACTION.REST_FULL, payload: {
      ticker: 'AAA', tf: '1', contract: 1, grid: 'eth-clock', session: 'rth', cache_key: 'b1:AAA:1:eth-clock', series_rev: w.clock.ms,
      history_rev: 1, verified_through: Math.floor(w.clock.ms / 1000), tail_status: 'verified', complete_through: w.T(29), developing: null,
      bars: Array.from({ length: 30 }, (_, n) => ({ t: w.T(n), ...bar1(n) })),
    } })
    w.answer('AAA', '5', { closed: [[20, 24], [25, 29]] })
    w.answer('AAA', '15', { closed: [[0, 14], [15, 29]] })
    w.answer('AAA', '30', { closed: [[0, 29]] })
    w.frames(30, 34)
    expect(w.tail('AAA', '1')).toMatchObject({ t: w.T(34), ...bar1(34), src: 'final' })
    expect(w.tail('AAA', '5')).toMatchObject({ ...w.agg(30, 34), src: 'final' })
    expect(w.tail('AAA', '15').t).toBe(w.T(15))
    w.frames(35, 44)
    expect(w.tail('AAA', '15')).toMatchObject({ ...w.agg(30, 44), src: 'final' })
    expect(w.tail('AAA', '30').t).toBe(w.T(0))
    w.frames(45, 59)
    expect(w.tail('AAA', '30')).toMatchObject({ ...w.agg(30, 59), src: 'final' })
    expect(w.starts('AAA', '5', 25)).toEqual([25, 30, 35, 40, 45, 50, 55])
    expect(w.starts('AAA', '15', 15)).toEqual([15, 30, 45])
    expect(w.starts('AAA', '1', 28)).toEqual(Array.from({ length: 32 }, (_, i) => 28 + i))
    expect(w.feeder.stats()).toMatchObject({ appended: 30 + 6 + 2 + 1, rejected: 0 })
  })
})

describe('minute feed · 5m-60m: a bucket with a minute the feed cannot vouch for is never appended; the key stays behind', () => {
  it('H5 a minute with no bar inside the bucket: nothing at its end, and the whole bucket after it is not appended either', () => {
    const w = world()
    w.answer('AAA', '15', { closed: [[0, 14], [15, 29]] })
    const before = w.snap('AAA', '15')
    w.frames(30, 44, withoutAAA(37))                              // a complete frame WITHOUT AAA at 10:07
    expect(w.snap('AAA', '15')).toBe(before)
    w.frames(45, 59)                                              // 10:15-10:30 is whole, but not the bucket after its newest
    expect(w.snap('AAA', '15')).toBe(before)
    expect(expectedBarsBehind(w.tail('AAA', '15').t, '15', w.at(60, 20), { session: 'rth' })).toBeGreaterThanOrEqual(1)   // it asks, as today
    expect(w.feeder.stats()).toMatchObject({ appended: 0, rejected: 0 })
  })

  it.each([
    ['an INCOMPLETE frame', (n) => (n === 37 ? { incomplete: true } : undefined)],
    ['a frame that never reached this page', (n) => (n === 37 ? 'skip' : undefined)],
  ])('H6 %s inside the bucket: nothing appended', (_name, how) => {
    const w = world()
    w.answer('AAA', '15', { closed: [[0, 14], [15, 29]] })
    const before = w.snap('AAA', '15')
    w.frames(30, 59, how)
    expect(w.snap('AAA', '15')).toBe(before)
    expect(w.feeder.stats()).toMatchObject({ appended: 0, rejected: 0 })
  })

  it('H7 a symbol held only after its bucket began: that bucket is unknown, not fed; after its next answer the feed carries on', () => {
    const w = world({ start: [29, 20] })
    w.frames(30, 31)                                              // nobody holds AAA yet: its 10:00 and 10:01 bars are not kept
    w.clock.ms = w.at(32, 20)                                     // 10:02:20: a list warms the row
    w.answer('AAA', '15', { closed: [[0, 14], [15, 29]] })
    const before = w.snap('AAA', '15')
    w.frames(32, 59)
    expect(w.snap('AAA', '15')).toBe(before)                      // 10:00 is not whole; 10:15 is not the bucket after its newest
    w.clock.ms = w.at(60, 20)                                     // 10:30:20: a press asks, as today
    w.answer('AAA', '15', { closed: [[0, 14], [15, 29], [30, 44], [45, 59]] })
    w.frames(60, 74)
    expect(w.tail('AAA', '15')).toMatchObject({ ...w.agg(60, 74), src: 'final' })   // from here on it is fed
    expect(w.starts('AAA', '15', 30)).toEqual([30, 45, 60])
  })

  it('H16 a 60m bucket whose first minutes are no longer kept is left alone; one still kept is appended when the chart leaves', () => {
    for (const leaveAt of [125, 62 + RING_MINUTES]) {
      const w = world({ start: [60, 20] })                        // 10:30:20
      w.answer('AAA', '60', { closed: [[Y1530, Y1530 + 29], [0, 59]] })
      w.active.add(w.key('AAA', '60'))                            // a chart is on it: not fed
      w.frames(60, leaveAt - 1)
      w.active.delete(w.key('AAA', '60'))
      w.frame(leaveAt)
      if (leaveAt === 125) expect(w.tail('AAA', '60')).toMatchObject({ ...w.agg(60, 119), src: 'final' })
      else expect(w.tail('AAA', '60').t).toBe(w.T(0))             // 10:30 was dropped from what is kept
    }
  })
})

describe('minute feed · 5m-60m: the forming bucket is the chart\'s business', () => {
  it('H9 the server forming bar is left exactly as it is until its bucket closes whole, then closed with the FEED values; none is made for the next', () => {
    const w = world()
    w.answer('AAA', '15', { closed: [[0, 14], [15, 29]], dev: 30, named: true })
    const before = w.snap('AAA', '15')
    expect(before.developing).toMatchObject({ t: w.T(30), v: 7 })
    w.frames(30, 43)
    expect(w.snap('AAA', '15')).toBe(before)
    w.frame(44)
    expect(w.snap('AAA', '15').developing).toBe(null)
    expect(w.tail('AAA', '15')).toMatchObject({ ...w.agg(30, 44), src: 'final' })   // the bucket's bar, not the partial one (v 7)
    expect(newestBarIsFormingOf(w.snap('AAA', '15'))).toBe(false)
    const closed = w.snap('AAA', '15')
    w.frames(45, 50)
    expect(w.snap('AAA', '15')).toBe(closed)                      // 10:15 is forming: nothing is made up for it
  })

  it('H9b a forming bar whose bucket is not whole is never stepped past, even when the bucket after it is whole', () => {
    const w = world()
    w.answer('AAA', '15', { closed: [[0, 14], [15, 29]], dev: 30, named: true })
    const before = w.snap('AAA', '15')
    w.frames(30, 59, withoutAAA(37))
    expect(w.snap('AAA', '15')).toBe(before)                      // the partial 10:00 bar is still FORMING, never a closed row
    expect(w.row('AAA', '15', 30)).toBe(null)
    expect(w.row('AAA', '15', 45)).toBe(null)
  })

  it('H9c a forming bar stamped AFTER the bucket ended is still closed with the feed values, never the partial ones', () => {
    const w = world({ start: [28, 20] })
    w.hold('AAA', '15')
    w.frames(30, 43)
    w.clock.ms = w.at(45, 2)                                      // 10:15:02: the answer still shows 10:00 as forming (a late seal)
    w.answer('AAA', '15', { closed: [[0, 14], [15, 29]], dev: 30, named: true })
    expect(w.snap('AAA', '15').developing).toMatchObject({ t: w.T(30), v: 7, rev: w.at(45, 2) })
    w.frame(44)                                                   // the bucket's revision is 10:15:00.000, OLDER
    expect(w.snap('AAA', '15').developing).toBe(null)
    expect(w.tail('AAA', '15')).toMatchObject({ ...w.agg(30, 44), src: 'final' })
    expect(w.feeder.stats()).toMatchObject({ appended: 1, rejected: 0 })
  })
})

describe('minute feed · 5m-60m: the server keeps the last word', () => {
  it('H10 a later answer replaces a fed bucket with its own row; a sealed span keeps the feed out of it', () => {
    const w = world()
    w.answer('AAA', '15', { closed: [[0, 14], [15, 29]] })
    w.frames(30, 45)
    expect(w.row('AAA', '15', 30)).toMatchObject({ ...w.agg(30, 44), src: 'final' })
    w.clock.ms = w.at(46, 30)                                     // 10:16:30: the server's 10:00 bucket, unsealed, different
    w.answer('AAA', '15', { closed: [[0, 14], [15, 29], [30, 44]], px: 0.5 })
    expect(w.row('AAA', '15', 30)).toMatchObject({ ...w.agg(30, 44, { px: 0.5 }), src: 'rest' })
    w.frames(46, 59)                                              // the feed carries on from the server's row
    expect(w.tail('AAA', '15')).toMatchObject({ ...w.agg(45, 59), src: 'final' })
    w.clock.ms = w.at(61, 0)                                      // 10:31:00: sealed through 10:30
    w.answer('AAA', '15', { closed: [[0, 14], [15, 29], [30, 44], [45, 59]], px: 0.5, seal: 60 })
    expect(w.row('AAA', '15', 45)).toMatchObject({ ...w.agg(45, 59, { px: 0.5 }), src: 'rest' })
    // a correction of 10:20 restates the 10:15 bucket: it is inside the server's seal, the server's row stands
    w.frame(60, { blocks: [{ minute: w.M(50), kind: KIND_REPLACE, rows: [rec('AAA', 50, { v: 999 })] }] })
    expect(w.row('AAA', '15', 45)).toMatchObject({ ...w.agg(45, 59, { px: 0.5 }), src: 'rest' })
  })

  it('H17 an answer built BEFORE the bucket closed, landing after the fed bucket, does not turn it back into a forming bar', () => {
    const w = world()
    w.answer('AAA', '15', { closed: [[0, 14], [15, 29]] })
    w.frames(30, 44)                                              // fed at 10:15:08
    w.answer('AAA', '15', { closed: [[0, 14], [15, 29]], dev: 30, builtAt: w.at(44, 50) })   // built 10:14:50, in flight until now
    expect(w.snap('AAA', '15').developing).toBe(null)
    expect(w.tail('AAA', '15')).toMatchObject({ ...w.agg(30, 44), src: 'final' })
  })
})

describe('minute feed · 5m-60m: corrections', () => {
  const fix35 = (w, inFrame) => (n) => (n === inFrame ? { blocks: [{ minute: w.M(35), kind: KIND_REPLACE, rows: [rec('AAA', 35, { v: 999 })] }] } : undefined)
  const fixed = (sum) => sum - (100 + 35) + 999

  it('H11 a REPLACE record inside a bucket: before the bucket closes it is in the appended bar; after, the bar is corrected', () => {
    const early = world()
    early.answer('AAA', '15', { closed: [[0, 14], [15, 29]] })
    early.frames(30, 44, fix35(early, 36))
    expect(early.tail('AAA', '15')).toMatchObject(early.agg(30, 44, { v: fixed(early.agg(30, 44).v) }))

    const late = world()
    late.answer('AAA', '15', { closed: [[0, 14], [15, 29]] })
    late.frames(30, 45)
    expect(late.row('AAA', '15', 30)).toMatchObject(late.agg(30, 44))
    late.frames(46, 46, fix35(late, 46))
    expect(late.row('AAA', '15', 30)).toMatchObject({ ...late.agg(30, 44, { v: fixed(late.agg(30, 44).v) }), src: 'final', rev: late.M(46) * 60_000 })
    expect(late.feeder.stats()).toMatchObject({ appended: 1, corrected: 1 })
  })

  it('H11c a correction the rollup could not settle exactly (it reports the bucket STALE): the bucket is built from the kept minutes', () => {
    const w = world()
    w.answer('AAA', '15', { closed: [[0, 14], [15, 29]] })
    // 10:00 was the bucket's low; its correction has a HIGHER low: the bucket's low is now one of the other minutes',
    // and the rollup does not re-read them (lib/minuteFrames/rollup.js keeps the old low and says STALE)
    w.frames(30, 44, (n) => (n === 33 ? { blocks: [{ minute: w.M(30), kind: KIND_REPLACE, rows: [rec('AAA', 30, { l: 2029.5 })] }] } : undefined))
    expect(w.tail('AAA', '15')).toMatchObject({ ...w.agg(30, 44), l: 2029.5, src: 'final', rev: w.M(45) * 60_000 })
    expect(w.feeder.stats()).toMatchObject({ appended: 1, rejected: 0 })
    // a later correction the rollup CAN settle restates the bucket: still built from the kept minutes, at that frame's revision
    w.frames(45, 46, fix35(w, 46))
    expect(w.row('AAA', '15', 30)).toMatchObject({ ...w.agg(30, 44, { v: fixed(w.agg(30, 44).v) }), l: 2029.5, src: 'final', rev: w.M(46) * 60_000 })
  })

  it('H11d a bad-print high removed AFTER the bucket was appended (the rollup cannot settle it): the bucket is rebuilt and corrected', () => {
    const w = world()
    w.answer('AAA', '15', { closed: [[0, 14], [15, 29]] })
    w.frames(30, 45)
    expect(w.row('AAA', '15', 30)).toMatchObject(w.agg(30, 44))  // its high, 2045, is 10:14's
    // 10:14 corrected to a LOWER high: the bucket's high is now below the one the copy shows
    w.frame(46, { blocks: [{ minute: w.M(44), kind: KIND_REPLACE, rows: [rec('AAA', 44, { h: 2044.6 })] }] })
    expect(w.row('AAA', '15', 30)).toMatchObject({ ...w.agg(30, 44), h: 2044.6, src: 'final', rev: w.M(46) * 60_000 })
    expect(w.feeder.stats()).toMatchObject({ appended: 1, corrected: 1, rejected: 0 })
    // ...and the server still has the last word on it
    w.clock.ms = w.at(47, 30)
    w.answer('AAA', '15', { closed: [[0, 14], [15, 29], [30, 44]], px: 0.5 })
    expect(w.row('AAA', '15', 30)).toMatchObject({ ...w.agg(30, 44, { px: 0.5 }), src: 'rest' })
  })

  it('H11e a late minute two buckets back (the rollup reports the bucket stale and does not restate it): rebuilt and offered all the same', () => {
    const w = world({ start: [28, 20] })
    w.hold('AAA', '5')
    w.frames(29, 36, withoutAAA(31))                              // AAA's 10:01 bar is late
    w.clock.ms = w.at(37, 20)                                     // 10:07:20: the server's 10:00 bucket (unsealed) is in the answer
    w.answer('AAA', '5', { closed: [[20, 24], [25, 29], [30, 34]], px: 0.25 })
    w.frames(37, 39)
    expect(w.tail('AAA', '5')).toMatchObject({ ...w.agg(35, 39), src: 'final' })
    expect(w.row('AAA', '5', 30)).toMatchObject({ ...w.agg(30, 34, { px: 0.25 }), src: 'rest' })
    // the 10:01 bar arrives with the 10:10 frame: 10:00-10:05 is two 5m buckets back, too old for the rollup to merge
    w.frame(40, { blocks: [{ minute: w.M(31), kind: KIND_LATE, rows: [rec('AAA', 31)] }] })
    expect(w.row('AAA', '5', 30)).toMatchObject({ ...w.agg(30, 34), src: 'final', rev: w.M(40) * 60_000 })
    expect(w.feeder.stats()).toMatchObject({ corrected: 1, rejected: 0 })
  })

  it('H12 a correction 29 minutes back inside a 60m bucket is settled exactly (the rollup keeps a whole bucket of minutes)', () => {
    const w = world({ start: [60, 20] })                          // 10:30:20
    w.answer('AAA', '60', { closed: [[Y1530, Y1530 + 29], [0, 59]] })
    w.frames(60, 119, (n) => (n === 90 ? { blocks: [{ minute: w.M(61), kind: KIND_REPLACE, rows: [rec('AAA', 61, { v: 999 })] }] } : undefined))
    expect(w.tail('AAA', '60')).toMatchObject({ ...w.agg(60, 119, { v: w.agg(60, 119).v - 161 + 999 }), src: 'final' })
  })
})

describe('minute feed · 5m-60m: what is left exactly as it is', () => {
  it('H13 a key a chart is on is not fed; once the chart leaves, the feed brings it forward from what it kept', () => {
    const w = world()
    w.answer('AAA', '15', { closed: [[0, 14], [15, 29]] })
    w.active.add(w.key('AAA', '15'))
    const before = w.snap('AAA', '15')
    w.frames(30, 46)
    expect(w.snap('AAA', '15')).toBe(before)
    w.active.delete(w.key('AAA', '15'))
    w.frame(47)
    expect(w.tail('AAA', '15')).toMatchObject({ ...w.agg(30, 44), src: 'final' })
  })

  it('H13b no answer yet, a saved (local) copy, a copy held for a full re-read: none is fed', () => {
    const w = world()
    w.hold('NONE', '15')
    w.registry.dispatch(w.key('SAVED', '15'), { type: ACTION.MEM_HIT, payload: {
      bars: [w.agg(0, 14), w.agg(15, 29)], sealed_spans: [[w.T(0), w.T(15)]], complete_through: w.T(30),
      cache_key: 'b1:SAVED:15:eth-clock', history_rev: 1, series_rev: w.at(30, 5),
    } })
    w.answer('FULL', '15', { closed: [[0, 14], [15, 29]] })
    w.registry.dispatch(w.key('FULL', '15'), { type: ACTION.REST_DELTA, payload: {
      ticker: 'FULL', tf: '15', contract: 1, grid: 'eth-clock', cache_key: 'b1:FULL:15:eth-clock', series_rev: w.at(30, 25),
      history_rev: 2, complete_through: null, developing: null, bars: [], since: w.T(15),
    } })
    expect(w.snap('SAVED', '15')).toMatchObject({ restSeen: false, needsFull: false })
    expect(w.snap('FULL', '15')).toMatchObject({ restSeen: true, needsFull: true })
    const saved = w.snap('SAVED', '15')
    const full = w.snap('FULL', '15')
    w.frames(30, 59, (n) => ({ rows: ['NONE', 'SAVED', 'FULL'].map((s) => rec(s, n)) }))
    expect(w.snap('NONE', '15')).toMatchObject({ depth: 0, developing: null, restSeen: false })
    expect(w.snap('SAVED', '15')).toBe(saved)
    expect(w.snap('FULL', '15')).toBe(full)
    expect(w.feeder.stats()).toMatchObject({ appended: 0, rejected: 0 })
  })

  it('H14 the extended 60m key (the clock grid), a windowed (replay) key and a D key are never fed', () => {
    const w = world({ start: [60, 20] })                          // 10:30:20
    const ext = keyOf({ sym: 'AAA', tf: '60', session: 'eth' })
    const win = keyOf({ sym: 'AAA', tf: '15', window: { to: w.T(60) } })
    expect([ext, win]).toEqual(['AAA_60e', `AAA_15@to=${w.T(60)}`])
    w.registry.dispatch(ext, { type: ACTION.REST_FULL, payload: {
      ticker: 'AAA', tf: '60', contract: 1, grid: 'eth-clock', session: 'eth', cache_key: 'b1:AAA:60:eth-clock', series_rev: w.clock.ms,
      history_rev: 1, verified_through: Math.floor(w.clock.ms / 1000), tail_status: 'verified', complete_through: w.T(-30), developing: null,
      bars: [{ ...w.agg(-30, 29), t: w.T(-30) }],               // the 09:00-10:00 clock bucket
    } })
    w.registry.dispatch(win, { type: ACTION.REST_FULL, payload: {
      ticker: 'AAA', tf: '15', contract: 1, grid: 'eth-clock', session: 'rth', cache_key: 'b1:AAA:15:eth-clock', series_rev: w.clock.ms,
      history_rev: 1, verified_through: Math.floor(w.clock.ms / 1000), tail_status: 'verified', complete_through: w.T(30), developing: null,
      bars: [w.agg(30, 44), w.agg(45, 59)],
    } })
    w.registry.acquire(keyOf({ sym: 'AAA', tf: 'D' }))
    const before = [ext, win].map((k) => w.registry.peek(k))
    expect(before.map((s) => s.restSeen)).toEqual([true, true])
    w.frames(60, 119)
    expect(w.registry.peek(ext)).toBe(before[0])
    expect(w.registry.peek(win)).toBe(before[1])
    expect(w.feeder.stats()).toMatchObject({ appended: 0, rejected: 0, symbols: 0 })
    expect(w.feeder.wanted()).toBe(false)                         // ...and none of them makes the feed poll
  })

  it('H18 a symbol whose keys left the registry is forgotten by the rollup too; held again, it starts from nothing', () => {
    const w = world({ registryOpts: { maxKeys: 0 } })             // (maxKeys 0: a released key is evicted at once)
    w.hold('AAA', '15'); w.hold('BBB', '15')
    w.frames(30, 31)
    expect(w.consumer.status().rollup.symbols).toBe(2)
    w.registry.release(w.key('BBB', '15'))
    expect(w.registry.has(w.key('BBB', '15'))).toBe(false)
    w.frame(32)
    expect(w.consumer.status().rollup.symbols).toBe(1)            // BBB's minutes and buckets are gone, not kept until the day ends
    expect(w.feeder.stats().symbols).toBe(1)
    w.hold('BBB', '15')
    w.frames(33, 34)
    expect(w.consumer.status().rollup.symbols).toBe(2)
  })

  it('H14b the feed has something to feed while an idle regular 5m / 15m / 30m / 60m key is held', () => {
    for (const tf of ['5', '15', '30', '60']) {
      const w = world()
      expect(w.feeder.wanted()).toBe(false)
      w.hold('AAA', tf)
      expect(w.feeder.wanted(), `an idle ${tf}m key`).toBe(true)
      w.active.add(w.key('AAA', tf))                              // a chart is on it: its own stream keeps it current
      expect(w.feeder.wanted()).toBe(false)
    }
  })
})
