// @vitest-environment node
// ⭐ TAIL ONLY (2026-11-23: the bar store's page-side minute feed, data/barStore/minuteFeed.js). The device store's
// consumer wants the whole day: head.json, then today.bin (11-19 MB), then a backlog of minute files. A reader that only
// keeps the copies it already holds current must never pay that: with `tailOnly` the SAME consumer (one decoder, one
// chain / epoch / INCOMPLETE check) asks for one minute file a minute and nothing else.
//   T1 a mid-session open asks for ONE minute file, the one now due: never head.json, never today.bin
//   T2 the control: without tailOnly the same open reads head.json first (so T1 can fail)
//   T3 steady state: one request a minute, each the next minute's file, no gap
//   T4 a step in a minute's first seconds does not skip the minute that just ended (a gap of its own making)
//   T5 back after a pause: ONE request, for the minute now due; the minutes skipped are a gap, never a backlog
//   T6 a minute file that is not there is asked again `tailRetries` times, then given up; the next minute is a new run
//   T7 a failing edge (503) is bounded the same way
//   T8 an INCOMPLETE frame reaches the sink as a gap of its own minute (the shared check)
//   T9 wake(): the next step now; no request when nothing is due; nothing when stopped
import { describe, it, expect } from 'vitest'
import { createMinuteFrameConsumer, DEFAULT_BASE } from './consumer'
import { createMemorySink } from './memorySink'
import { writeFrame, framePath, frameResponse, statusResponse } from './testing/frameWriter'

const OPEN_MIN = Date.UTC(2026, 10, 10, 14, 30) / 60000          // Tue 2026-11-10 09:30 ET, as a unix minute
/** unix minute of 09:30 + n minutes, and ms of that minute + sec. */
const M = (n) => OPEN_MIN + n
const at = (n, sec = 0) => M(n) * 60_000 + sec * 1000
const row = (sym, n) => ({ sym, o: 10 + n, h: 11 + n, l: 9 + n, c: 10.5 + n, v: 100 + n })

/** An edge holding one frame per minute 09:30+from .. 09:30+to (minus `missing`), that records every path asked. */
function edge({ from = 0, to = 60, missing = [], failing = [], incomplete = [] } = {}) {
  const files = new Map()
  for (let n = from; n <= to; n++) {
    if (missing.includes(n)) continue
    files.set(framePath(M(n)), writeFrame({ minute: M(n), incomplete: incomplete.includes(n), blocks: [{ rows: [row('AAA', n), row('BBB', n)] }] }))
  }
  const fails = new Set(failing.map((n) => framePath(M(n))))
  const asked = []
  const fetchImpl = async (url) => {
    const path = url.slice(DEFAULT_BASE.length + 1)
    asked.push(path)
    if (fails.has(path)) return statusResponse(503)
    return files.has(path) ? frameResponse(files.get(path)) : statusResponse(404)
  }
  return { fetchImpl, asked }
}

/** A consumer on a hand-driven clock and timer: `run()` lets the pending timer fire after its delay. */
function device(e, nowMs, extra = {}) {
  const sink = createMemorySink()
  const clock = { ms: nowMs }
  let pending = null
  const c = createMinuteFrameConsumer({
    sink, fetchImpl: e.fetchImpl, now: () => clock.ms, isVisible: () => true, random: () => 0,
    setTimer: (fn, ms) => { pending = { fn, ms }; return pending }, clearTimer: (t) => { if (pending === t) pending = null },
    tailOnly: true, rollup: { tfs: ['1'] }, ...extra,
  })
  return {
    sink, c, clock,
    delay: () => pending?.ms ?? null,
    /** Fire the pending timer (the clock moves by its delay first). Resolves when that step is done. */
    async run() { const t = pending; pending = null; clock.ms += t.ms; await t.fn() },
  }
}
const name = (n) => framePath(M(n))

describe('tailOnly: one minute file a minute, never the day', () => {
  it('T1 a mid-session open asks for ONE minute file, the one now due: never head.json, never today.bin', async () => {
    const e = edge()
    const d = device(e, at(32, 20))                     // 10:02:20: the 10:01 minute ended 20 s ago
    d.c.start()
    expect(d.delay()).toBe(0)
    await d.run()
    expect(e.asked).toEqual([name(31)])
    expect(d.sink.series('AAA', '1').map((b) => b.t)).toEqual([M(31) * 60])
    // everything before it is a gap the sink hears, not a download
    expect(d.sink.gaps).toHaveLength(1)
    expect(d.sink.gaps[0].toMinute).toBe(M(30))
    expect(d.c.status().todayLoads).toBe(0)
    // the next file is due 7 s after 10:03:00
    expect(d.delay()).toBe(47_000)
  })

  it('T2 the control: without tailOnly the same open reads head.json first', async () => {
    const e = edge()
    const d = device(e, at(32, 20), { tailOnly: false })
    d.c.start()
    await d.run()
    expect(e.asked[0]).toBe('2026-11-10/head.json')
  })

  it('T3 steady state: one request a minute, each the next minute, no gap', async () => {
    const e = edge()
    const d = device(e, at(32, 20))
    d.c.start()
    await d.run()
    for (let i = 0; i < 5; i++) await d.run()
    expect(e.asked).toEqual([31, 32, 33, 34, 35, 36].map(name))
    expect(d.sink.gaps).toHaveLength(1)                 // only the one before the first frame
    expect(d.sink.series('BBB', '1').map((b) => b.t)).toEqual([31, 32, 33, 34, 35, 36].map((n) => M(n) * 60))
    expect(d.clock.ms).toBe(at(37, 7))                  // each step at its minute's end + 7 s
  })

  it('T4 a step in a minute first seconds does not skip the minute that just ended', async () => {
    const e = edge()
    const d = device(e, at(32, 3))                      // 10:02:03: 10:01 ended 3 s ago, its frame is not due yet
    d.c.start()
    await d.run()
    expect(e.asked).toEqual([name(30)])
    expect(d.delay()).toBe(4_000)                       // ...and 10:01's is due at 10:02:07, not at 10:03:07
    await d.run()
    await d.run()
    expect(e.asked).toEqual([30, 31, 32].map(name))
    expect(d.sink.gaps).toHaveLength(1)
  })

  it('T5 back after a pause: ONE request for the minute now due; the minutes skipped are a gap, never a backlog', async () => {
    const e = edge()
    const d = device(e, at(32, 20))
    d.c.start()
    await d.run()
    d.clock.ms = at(40, 20) - d.delay()                 // the timer fires eight minutes late (a hidden tab)
    await d.run()
    expect(e.asked).toEqual([name(31), name(39)])
    expect(d.sink.gaps).toHaveLength(2)
    expect(d.sink.gaps[1]).toMatchObject({ fromMinute: M(32), toMinute: M(38), reason: 'not-received' })
    expect(d.c.status().todayLoads).toBe(0)
  })

  it('T6 a minute file that is not there is asked again tailRetries times, then given up; the next minute is a new run', async () => {
    const e = edge({ missing: [32] })
    const d = device(e, at(32, 20))
    d.c.start()
    await d.run()                                       // 10:01
    await d.run()                                       // 10:02 is not there
    expect(d.delay()).toBe(2_000)
    await d.run(); await d.run(); await d.run()         // three more asks
    expect(e.asked.filter((p) => p === name(32))).toHaveLength(4)
    expect(d.delay()).toBeGreaterThan(40_000)           // given up: nothing more until the next minute is due
    await d.run()
    expect(e.asked[e.asked.length - 1]).toBe(name(33))
    expect(e.asked).toHaveLength(6)
    expect(d.sink.gaps[1]).toMatchObject({ fromMinute: M(32), toMinute: M(32) })
    expect(e.asked.some((p) => p.endsWith('head.json') || p.endsWith('today.bin'))).toBe(false)
  })

  it('T7 a failing edge (503) is bounded the same way', async () => {
    const e = edge({ failing: [32] })
    const d = device(e, at(32, 20))
    d.c.start()
    await d.run()
    for (let i = 0; i < 4; i++) await d.run()
    expect(e.asked.filter((p) => p === name(32))).toHaveLength(4)
    expect(d.delay()).toBeGreaterThan(40_000)
    expect(d.c.status().errors).toBe(3)                 // the fourth failure gives the minute up instead
  })

  it('T8 an INCOMPLETE frame reaches the sink as a gap of its own minute', async () => {
    const e = edge({ incomplete: [32] })
    const d = device(e, at(32, 20))
    d.c.start()
    await d.run()
    await d.run()
    expect(d.sink.gaps[1]).toMatchObject({ fromMinute: M(32), toMinute: M(32), reason: 'incomplete' })
  })

  it('T9 wake(): the next step now; no request when nothing is due; nothing when stopped', async () => {
    const e = edge()
    const d = device(e, at(32, 20))
    d.c.wake()
    expect(d.delay()).toBe(null)                        // not started: nothing
    d.c.start()
    await d.run()
    expect(d.delay()).toBe(47_000)
    d.c.wake()
    expect(d.delay()).toBe(0)
    await d.run()
    expect(e.asked).toEqual([name(31)])                 // nothing new is due
    d.c.stop()
    d.c.wake()
    expect(d.delay()).toBe(null)
  })
})
