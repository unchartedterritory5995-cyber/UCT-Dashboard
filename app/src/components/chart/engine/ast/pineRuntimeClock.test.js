// app/src/components/chart/engine/ast/pineRuntimeClock.test.js
//
// ─── ⭐⭐ T4 — THE PRODUCER, AND THE REFUSAL IT LIFTS ────────────────────────
//
// Three questions, in the owner's words: on a closed daily series it is false on
// every historical bar; on a series whose last bar is the current session before
// close it is true on exactly that bar; and the 3.3 refusal lifts ONLY when the
// producer is present.
//
// ⛔ THE FOURTH TEST IS THE ONE NOBODY ASKED FOR AND IT IS THE IMPORTANT ONE.
// `buildRuntimeIr` lifts the refusal on EITHER key and evaluates the columns from
// ONE of them, so a hand-written caller can pass the gate and still render blanks.
// That is ruling 3.3's own failure mode coming back through the door the ruling
// installed, so the producer is the only sanctioned way to build the options and
// the shape it produces is pinned here.
import { describe, it, expect } from 'vitest'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import {
  newestBarIsFormingFrom, runtimeClockOpts, runtimeClockOptsFrom, formingByBar,
} from './pineRuntimeClock.js'
import { computeClock, CLOCK_REALTIME } from '../../indicators.js'

/** Four real daily instants (2025-10-27 … 2025-10-30, 13:30 UTC = 09:30 ET), so
 *  the unit gate in the clock layer passes rather than blanking for a reason
 *  that has nothing to do with what these cases are asking. */
const BARS = [
  { t: 1761570600, o: 1, h: 2, l: 1, c: 2, v: 10 },
  { t: 1761657000, o: 2, h: 3, l: 2, c: 3, v: 11 },
  { t: 1761743400, o: 3, h: 4, l: 3, c: 4, v: 12 },
  { t: 1761829800, o: 4, h: 5, l: 4, c: 5, v: 13 },
]

const SCRIPT = `//@version=6
indicator("clock probe", overlay = false)
plot(barstate.isconfirmed ? 1 : 0)
`

describe('⭐ the producer reads the seam and never computes it', () => {
  it('takes the tri-state from a bars payload, under either spelling', () => {
    expect(newestBarIsFormingFrom({ newest_bar_is_forming: true })).toBe(true)
    expect(newestBarIsFormingFrom({ newestBarIsForming: false })).toBe(false)
    expect(newestBarIsFormingFrom({ interpretOpts: { newestBarIsForming: true } })).toBe(true)
  })

  it('⛔ an absent, null or non-boolean value is UNKNOWN — never `false`', () => {
    // ⚰️ `false` would assert the newest bar has settled and hand the column layer
    // a confident `isconfirmed = 1` on a bar that may still be open. A server that
    // has not shipped the field yet sends `undefined`, and `"false"` is TRUTHY in
    // JavaScript — both must land on the same answer as "nobody told me".
    for (const p of [null, undefined, {}, { newest_bar_is_forming: null },
      { newest_bar_is_forming: 'false' }, { newest_bar_is_forming: 0 }, 'nonsense']) {
      expect(newestBarIsFormingFrom(p)).toBe(null)
    }
  })

  it('⛔⛔ it fills BOTH keys from one value, so the gate and the columns cannot disagree', () => {
    // The gate reads either key; `interpret` reads only `interpretOpts`. A caller
    // that set the top-level key alone would lift the refusal and still blank the
    // four columns — 3.3's failure arriving through 3.3's own door.
    const o = runtimeClockOpts(true)
    expect(o.newestBarIsForming).toBe(true)
    expect(o.interpretOpts.newestBarIsForming).toBe(true)
    const off = runtimeClockOptsFrom({ newest_bar_is_forming: false })
    expect(off.newestBarIsForming).toBe(false)
    expect(off.interpretOpts.newestBarIsForming).toBe(false)
    const unknown = runtimeClockOptsFrom({})
    expect(unknown.newestBarIsForming).toBe(null)
    expect(unknown.interpretOpts.newestBarIsForming).toBe(null)
    // …and it does not throw away what the caller was already passing
    expect(runtimeClockOpts(true, { basePeriod: 'D' }).interpretOpts.basePeriod).toBe('D')
  })
})

describe('⭐ what the tri-state says about each bar', () => {
  it('a CLOSED daily series is not forming on any bar, the newest included', () => {
    expect(formingByBar(BARS, false)).toEqual([false, false, false, false])
  })

  it('a series whose last bar is the current session before close is forming on EXACTLY that bar', () => {
    expect(formingByBar(BARS, true)).toEqual([false, false, false, true])
  })

  it('⛔ unknown propagates to every bar rather than making history confidently closed', () => {
    expect(formingByBar(BARS, null)).toEqual([null, null, null, null])
    expect(formingByBar([], true)).toEqual([])
  })

  it('⭐ and the shipped column layer agrees, bar for bar — derived, not restated', () => {
    // ⛔ THE PRODUCER IS NOT A SECOND AUTHORITY. `computeClock` owns what the four
    // realtime columns hold; this asserts the producer's per-bar answer against
    // `isrealtime` from that function rather than against a literal written here.
    const closed = computeClock(BARS, 'D', false)
    const live = computeClock(BARS, 'D', true)
    const unknown = computeClock(BARS, 'D', null)
    expect([...closed.isrealtime]).toEqual(formingByBar(BARS, false).map(Number))
    expect([...live.isrealtime]).toEqual(formingByBar(BARS, true).map(Number))
    // NA is the blank; the producer says null and the column says NaN — the same
    // answer in each layer's own vocabulary, which is why this is asserted as a
    // predicate rather than as an equality.
    expect([...unknown.isrealtime].every((x) => Number.isNaN(x))).toBe(true)
    expect(formingByBar(BARS, null).every((x) => x === null)).toBe(true)
    expect(CLOCK_REALTIME).toContain('isrealtime')
  })
})

describe('⛔⛔ ruling 3.3 — the refusal lifts ONLY when the producer is present', () => {
  it('without it, a realtime column refuses by name', () => {
    const r = buildRuntimeIr(SCRIPT, { bars: BARS, inputs: {} })
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:realtime-untold')
    expect(r.refusal.line).toBe(3)
  })

  it('⭐ with the producer, the same script builds', () => {
    const r = buildRuntimeIr(SCRIPT, {
      bars: BARS, inputs: {}, ...runtimeClockOptsFrom({ newest_bar_is_forming: false }),
    })
    expect(r.ok).toBe(true)
    expect(r.ir).toBeTruthy()
  })

  it('⭐ `false` is an ANSWER and lifts it; only unknown refuses', () => {
    // The distinction the tri-state exists for: "the newest bar has finished" is
    // a real reading, not an absence.
    const told = buildRuntimeIr(SCRIPT, { bars: BARS, inputs: {}, ...runtimeClockOpts(false) })
    expect(told.ok).toBe(true)
    const untold = buildRuntimeIr(SCRIPT, { bars: BARS, inputs: {}, ...runtimeClockOpts(null) })
    expect(untold.ok).toBe(false)
    expect(untold.refusal.guard).toBe('runtime:realtime-untold')
  })

  it('⛔ CONTROL: a script with no realtime column never needed the producer', () => {
    // Without this, "the producer lifts the refusal" would also be satisfied by a
    // producer that lifted every refusal, and by a lane that had stopped checking.
    const plain = '//@version=6\nindicator("plain")\nplot(close)\n'
    expect(buildRuntimeIr(plain, { bars: BARS, inputs: {} }).ok).toBe(true)
  })
})
