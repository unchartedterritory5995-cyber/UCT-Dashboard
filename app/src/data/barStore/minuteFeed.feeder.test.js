// ⭐ THE MINUTE FEED INTO THE REGISTRY: THE APPLIER AND ITS CONTIGUITY RULE (2026-11-23, minuteFeed.js).
// Real registry, real reducer, the real minute-frame consumer (its chain / INCOMPLETE / link check: `applyFrame`), real
// frame bytes (lib/minuteFrames/testing/frameWriter, decoded by the product decoder). No network: frames are handed in.
//
//   APPEND      F1 the minute that just closed lands on a held, answered key        F2 a forming bar is closed by the feed's bar
//   NEVER A HOLE F3 a forming bar with no feed bar is never stepped past            F4 a MISSED frame
//               F5 an INCOMPLETE frame      F6 a frame the publisher never wrote   F7 a symbol held only after its frame
//               F8 a minute a complete frame proved empty is not a hole            F9 minutes no longer kept
//               F10 a pre-market minute is not "proved empty"
//   RECORDS     F11 a LATE record in the same frame    F12 a LATE record a frame later    F13 a REPLACE record
//   SERVER WINS F14 a later answer replaces a fed bar   F15 a sealed span removes one    F16 a REPLACE never beats the server
//               F17 an answer built BEFORE the minute closed does not turn the closed bar back into a partial one
//   LEFT ALONE  F18 a key a chart is on     F19 a key with no answer / no entry     F20 a saved (local) copy
//   COST        F21 the appends give the thread back and still all land
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRegistry } from './registry'
import { createMinuteFeeder, RING_MINUTES } from './minuteFeed'
import { ACTION, keyOf } from './types'
import { createMinuteFrameConsumer } from '../../lib/minuteFrames/consumer'
import { decodeFrame, KIND_LATE, KIND_REPLACE } from '../../lib/minuteFrames/codec'
import { writeFrame, statusResponse } from '../../lib/minuteFrames/testing/frameWriter'

const OPEN_MIN = Date.UTC(2026, 10, 10, 14, 30) / 60000          // Tue 2026-11-10 09:30 ET, as a unix minute
const M = (n) => OPEN_MIN + n                                     // unix minute of 09:30 + n
const T = (n) => M(n) * 60                                        // ...its bar time (unix s)
const at = (n, sec = 0) => M(n) * 60_000 + sec * 1000             // ...ms
const seqOf = (n) => 330 + n                                      // minutes since 04:00 ET
/** One bar of minute n. `px` shifts the prices (a different observation of the same minute). */
const bar = (n, px = 0) => ({ t: T(n), o: 10 + n + px, h: 11 + n + px, l: 9 + n + px, c: 10.5 + n + px, v: 100 + n })
const rec = (sym, n, px = 0) => { const { t: _t, ...b } = bar(n, px); return { sym, ...b } }
const key = (sym) => keyOf({ sym, tf: '1' })

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(at(30, 20)) })
afterEach(() => { vi.useRealTimers() })

function world({ feederOpts = {} } = {}) {
  const clock = { ms: at(30, 20) }                                // 10:00:20
  const active = new Set()
  const registry = createRegistry({ ctx: () => ({ nowMs: clock.ms }) })
  const feeder = createMinuteFeeder({ registry, isActive: (k) => active.has(k), sliceMs: Infinity, ...feederOpts })
  const consumer = createMinuteFrameConsumer({
    sink: feeder.sink, tailOnly: true, rollup: { tfs: ['1'], accept: feeder.accept },
    now: () => clock.ms, fetchImpl: async () => statusResponse(404), setTimer: () => 0, clearTimer: () => {},
  })
  return {
    clock, active, registry, feeder,
    /** The SERVER's answer for `sym`, built at `builtAt`: closed rows `from`..`through` (minus `skip`), sealed through
     *  minute `seal` (default: all but the newest), an optional forming bar `dev`. */
    answer(sym, { through, from = 0, skip = [], dev = null, seal = through - 1, px = 0, builtAt = clock.ms } = {}) {
      const bars = []
      for (let n = from; n <= through; n++) if (!skip.includes(n)) bars.push(bar(n, px))
      return registry.dispatch(key(sym), {
        type: ACTION.REST_FULL,
        payload: {
          ticker: sym, tf: '1', contract: 1, grid: 'eth-clock', session: 'rth', cache_key: `b1:${sym}:1:eth-clock`,
          series_rev: builtAt, history_rev: 1, verified_through: Math.floor(builtAt / 1000), tail_status: 'verified',
          complete_through: seal == null ? null : T(seal) + 60, bars,
          // a forming bar is a PARTIAL observation: a narrower range and less volume than the minute ends with
          developing: dev == null ? null : { t: T(dev), o: 10 + dev, h: 10.2 + dev, l: 9.9 + dev, c: 10.1 + dev, v: 7, rev: builtAt },
        },
      })
    },
    /** One frame of minute n, applied through the consumer. `rows`: the ONTIME records; `blocks`: extra blocks. */
    frame(n, { rows = [rec('AAA', n), rec('BBB', n)], blocks = [], ...opts } = {}) {
      return consumer.applyFrame(decodeFrame(writeFrame({ minute: M(n), blocks: [{ rows }, ...blocks], ...opts })))
    },
    snap: (sym) => registry.peek(key(sym)),
    tail: (sym) => { const b = registry.peek(key(sym))?.bars; return b?.length ? b[b.length - 1] : null },
    row: (sym, n) => registry.peek(key(sym))?.bars.find((b) => b.t === T(n)) ?? null,
    times: (sym, from) => registry.peek(key(sym)).bars.filter((b) => b.t >= T(from)).map((b) => (b.t - T(0)) / 60),
  }
}

describe('minute feed · append', () => {
  it('F1 the minute that just closed lands on a held, answered key, as a push FINAL at the server grain', () => {
    const w = world()
    w.answer('AAA', { through: 29 })                              // 10:00:20: the server's rows end at 09:59
    w.frame(30)                                                   // the 10:00 frame
    expect(w.tail('AAA')).toMatchObject({ ...bar(30), src: 'final', fin: true, rev: (M(30) + 1) * 60_000 })
    w.frame(31)
    expect(w.times('AAA', 28)).toEqual([28, 29, 30, 31])
    expect(w.feeder.stats()).toMatchObject({ appended: 2, breaks: 0, chainFrom: M(30), chainTo: M(31) })
  })

  it('F1b a price the vendor sent at more than 4 decimals is stored as the server stores it', () => {
    const w = world()
    w.answer('AAA', { through: 29 })
    w.frame(30, { rows: [{ sym: 'AAA', o: 5.565822, h: 5.6000001, l: 5.5, c: 5.565849, v: 12 }] })
    expect(w.tail('AAA')).toMatchObject({ t: T(30), o: 5.5658, h: 5.6, l: 5.5, c: 5.5658, v: 12 })   // deviceStore/price.js
  })

  it('F2 a forming bar the copy holds is closed by the feed bar of its minute, with the feed values', () => {
    const w = world()
    w.answer('AAA', { through: 29, dev: 30 })
    expect(w.snap('AAA').developing).toMatchObject({ t: T(30), v: 7 })
    w.frame(30)
    expect(w.snap('AAA').developing).toBe(null)
    expect(w.tail('AAA')).toMatchObject({ ...bar(30), src: 'final' })
  })
})

describe('minute feed · contiguity: no hole is ever created, and the key stays behind until the server heals it', () => {
  it('F3 a forming bar the feed has no bar for is never stepped past (it would close as a stale partial bar)', () => {
    const w = world()
    w.answer('AAA', { through: 29, dev: 30 })
    w.frame(30, { rows: [rec('BBB', 30)] })                       // a complete frame without AAA
    w.frame(31)                                                   // AAA traded in 10:01
    expect(w.tail('AAA').t).toBe(T(29))
    expect(w.snap('AAA').developing).toMatchObject({ t: T(30), v: 7 })
  })

  it('F4 a MISSED frame: nothing is appended, the key stays behind; the server answer heals it and the feed carries on', () => {
    const w = world()
    w.answer('AAA', { through: 29 })
    w.frame(30)
    w.frame(32)                                                   // 10:01 never arrived here (prev_seq says it exists)
    expect(w.tail('AAA').t).toBe(T(30))
    w.frame(33)
    expect(w.tail('AAA').t).toBe(T(30))                           // still: the chain does not reach back to 10:01
    expect(w.feeder.stats().breaks).toBe(1)
    w.clock.ms = at(34, 20)
    w.answer('AAA', { through: 33 })                              // the switch asks; the server's rows land
    expect(w.tail('AAA')).toMatchObject({ t: T(33), src: 'rest' })
    w.frame(34)
    expect(w.tail('AAA')).toMatchObject({ t: T(34), src: 'final' })
    expect(w.times('AAA', 29)).toEqual([29, 30, 31, 32, 33, 34])
  })

  it('F5 an INCOMPLETE frame: nothing is appended, not even its own bar; healed by the server answer', () => {
    const w = world()
    w.answer('AAA', { through: 29 })
    w.frame(30)
    w.frame(31, { incomplete: true })
    expect(w.tail('AAA').t).toBe(T(30))
    w.frame(32)
    expect(w.tail('AAA').t).toBe(T(30))
    w.clock.ms = at(33, 20)
    w.answer('AAA', { through: 32 })
    w.frame(33)
    expect(w.times('AAA', 29)).toEqual([29, 30, 31, 32, 33])
    expect(w.row('AAA', 31).src).toBe('rest')
  })

  it('F6 a minute the PUBLISHER never wrote (its chain says so): the same', () => {
    const w = world()
    w.answer('AAA', { through: 29 })
    w.frame(30)
    w.frame(32, { prevSeq: seqOf(30) })                           // the publisher was down for 10:01
    w.frame(33)
    expect(w.tail('AAA').t).toBe(T(30))
  })

  it('F7 a symbol held only AFTER its frame was applied: that minute is unknown, not empty', () => {
    const w = world()
    w.frame(30); w.frame(31)                                      // AAA is not held: its bars are not kept
    w.clock.ms = at(32, 20)
    w.answer('AAA', { through: 30 })                              // a lagging answer: 10:01 is not in it
    w.frame(32)
    expect(w.tail('AAA').t).toBe(T(30))
  })

  it('F8 a minute a complete frame proved empty is not a hole: the next bar is appended across it', () => {
    const w = world()
    w.answer('AAA', { through: 29 })
    w.frame(30, { rows: [rec('BBB', 30)] })                       // AAA did not trade in 10:00
    expect(w.tail('AAA').t).toBe(T(29))                           // (still "behind": the quiet-name stamp is not in this slice)
    w.frame(31)
    expect(w.times('AAA', 28)).toEqual([28, 29, 31])
  })

  it('F9 a copy further behind than the minutes kept is left alone', () => {
    const w = world()
    w.answer('AAA', { through: 29 })
    w.active.add(key('AAA'))                                      // a chart is on it: not fed
    for (let n = 30; n <= 30 + RING_MINUTES + 5; n++) w.frame(n)
    w.active.delete(key('AAA'))
    w.frame(30 + RING_MINUTES + 6)
    expect(w.tail('AAA').t).toBe(T(29))
  })

  it('F10 a pre-market minute is not "proved empty": an extended copy ending before 09:29 is left alone', () => {
    const w = world()
    w.clock.ms = at(-1, 20)                                       // 09:29:20
    w.answer('EXT', { from: -6, through: -2 })                    // pre-market rows through 09:28
    w.answer('PRE', { from: -6, through: -1 })                    // ...and one through 09:29
    w.frame(-1, { rows: [rec('EXT', -1), rec('PRE', -1)] })
    w.frame(0, { rows: [rec('EXT', 0), rec('PRE', 0)] })
    expect(w.tail('EXT').t).toBe(T(-2))                           // 09:29 was not kept: 09:30 would leave a hole
    expect(w.tail('PRE').t).toBe(T(0))                            // this one meets the feed at 09:30
  })
})

describe('minute feed · LATE and REPLACE records', () => {
  it('F11 a LATE record riding the next frame fills its minute, in order', () => {
    const w = world()
    w.answer('AAA', { through: 29 })
    w.frame(30, { rows: [rec('BBB', 30)] })
    w.frame(31, { blocks: [{ minute: M(30), kind: KIND_LATE, rows: [rec('AAA', 30)] }] })
    expect(w.times('AAA', 28)).toEqual([28, 29, 30, 31])
    expect(w.row('AAA', 30)).toMatchObject({ ...bar(30), src: 'final', rev: M(31) * 60_000 })
  })

  it('F12 a LATE record for a minute already stepped over is inserted', () => {
    const w = world()
    w.answer('AAA', { through: 29 })
    w.frame(30, { rows: [rec('BBB', 30)] })
    w.frame(31)
    expect(w.times('AAA', 28)).toEqual([28, 29, 31])
    w.frame(32, { blocks: [{ minute: M(30), kind: KIND_LATE, rows: [rec('AAA', 30)] }] })
    expect(w.times('AAA', 28)).toEqual([28, 29, 30, 31, 32])
  })

  it('F13 a REPLACE record replaces the bar an earlier frame fed', () => {
    const w = world()
    w.answer('AAA', { through: 29 })
    w.frame(30)
    w.frame(31, { blocks: [{ minute: M(30), kind: KIND_REPLACE, rows: [rec('AAA', 30, 0.25)] }] })
    expect(w.row('AAA', 30)).toMatchObject({ ...bar(30, 0.25), src: 'final' })
    expect(w.tail('AAA').t).toBe(T(31))
    expect(w.feeder.stats().corrected).toBe(1)
  })
})

describe('minute feed · the server keeps the last word', () => {
  it('F14 a later server answer replaces a fed bar with its own row', () => {
    const w = world()
    w.answer('AAA', { through: 29 })
    w.frame(30)
    w.clock.ms = at(31, 30)
    w.answer('AAA', { through: 30, seal: 29, px: 0.5 })           // unsealed at 10:00, and different there
    expect(w.row('AAA', 30)).toMatchObject({ ...bar(30, 0.5), src: 'rest' })
  })

  it('F15 a sealed span decides: a fed bar the server does not have is removed, and nothing is fed into it', () => {
    const w = world()
    w.answer('AAA', { through: 29 })
    w.frame(30)
    expect(w.row('AAA', 30)).not.toBe(null)
    w.clock.ms = at(32, 20)
    w.answer('AAA', { through: 31, skip: [30], seal: 31 })        // the server: no bar at 10:00, sealed through 10:01
    expect(w.row('AAA', 30)).toBe(null)
    w.frame(31, { blocks: [{ minute: M(30), kind: KIND_REPLACE, rows: [rec('AAA', 30, 0.25)] }] })
    expect(w.row('AAA', 30)).toBe(null)
  })

  it('F16 a REPLACE record never beats the server row of that minute', () => {
    const w = world()
    w.clock.ms = at(31, 20)
    w.answer('AAA', { through: 30, seal: 29 })                    // built 10:01:20: its 10:00 row is unsealed
    w.frame(30)
    w.frame(31, { blocks: [{ minute: M(30), kind: KIND_REPLACE, rows: [rec('AAA', 30, 0.25)] }] })
    expect(w.row('AAA', 30)).toMatchObject({ ...bar(30), src: 'rest' })
    expect(w.tail('AAA')).toMatchObject({ t: T(31), src: 'final' })
  })

  it('F17 an answer built BEFORE the minute closed, landing after the fed bar, does not turn it back into a partial bar', () => {
    const w = world()
    w.answer('AAA', { through: 29 })
    w.clock.ms = at(31, 8)
    w.frame(30)
    w.answer('AAA', { through: 29, dev: 30, builtAt: at(30, 50) }) // built 10:00:50, in flight until 10:01:08
    expect(w.snap('AAA').developing).toBe(null)
    expect(w.tail('AAA')).toMatchObject({ ...bar(30), src: 'final' })
  })
})

describe('minute feed · what is left exactly as it is', () => {
  it('F18 a key a chart is on is not fed; once the chart leaves, the feed brings it forward from what it kept', () => {
    const w = world()
    w.answer('AAA', { through: 29 })
    w.active.add(key('AAA'))
    w.frame(30)
    expect(w.tail('AAA').t).toBe(T(29))
    w.active.delete(key('AAA'))
    w.frame(31)
    expect(w.times('AAA', 28)).toEqual([28, 29, 30, 31])
  })

  it('F19 a key with no answer stays empty, and a key nobody holds is never created', () => {
    const w = world()
    w.registry.acquire(key('AAA'))                                // a warm in flight: the entry exists, empty
    w.frame(30); w.frame(31)
    expect(w.snap('AAA')).toMatchObject({ depth: 0, developing: null, restSeen: false })
    expect(w.registry.has(key('BBB'))).toBe(false)
    expect(w.registry.keys()).toEqual([key('AAA')])
  })

  it('F20 a saved (local) copy the server has not answered in this page life is not fed', () => {
    const w = world()
    w.registry.dispatch(key('AAA'), { type: ACTION.MEM_HIT, payload: { bars: Array.from({ length: 30 }, (_, n) => bar(n)) } })
    expect(w.tail('AAA').t).toBe(T(29))
    w.frame(30); w.frame(31)
    expect(w.tail('AAA')).toMatchObject({ t: T(29), src: 'local' })
  })

  it('F20b only 1-minute keys: a 5m key of the same symbol is untouched', () => {
    const w = world()
    w.answer('AAA', { through: 29 })
    const k5 = keyOf({ sym: 'AAA', tf: '5' })
    w.registry.dispatch(k5, { type: ACTION.REST_FULL, payload: { bars: [0, 5, 10, 15, 20, 25].map((n) => bar(n)) } })
    const before = w.registry.peek(k5)
    w.frame(30); w.frame(31)
    expect(w.registry.peek(k5)).toBe(before)
  })
})

describe('minute feed · cost', () => {
  it('F21 the appends of one frame give the thread back between keys, and every key is still fed', async () => {
    let yields = 0
    let ms = 0
    const w = world({ feederOpts: { sliceMs: 1, elapsed: () => (ms += 1), yieldTo: () => { yields++; return Promise.resolve() } } })
    const syms = Array.from({ length: 12 }, (_, i) => `S${String(i).padStart(2, '0')}`)
    for (const s of syms) w.answer(s, { through: 29 })
    w.frame(30, { rows: syms.map((s) => rec(s, 30)) })
    await w.feeder.settled()
    expect(yields).toBeGreaterThan(3)
    for (const s of syms) expect(w.tail(s).t).toBe(T(30))
  })
})
