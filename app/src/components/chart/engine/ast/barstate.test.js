// app/src/components/chart/engine/ast/barstate.test.js
//
// ─── ⭐⭐ WHAT A BAR'S STATE IS DECIDED BY, AND WHAT IT MUST NOT BE ───────────
//
// The six shipped `barstate.*` columns are decided by TWO things and neither is
// the tape: the FETCH says which bar is newest and which is oldest, and ONE
// TRI-STATE handed in per fetch says whether the newest bar's period has
// finished. This file asserts the properties that follow from that.
//
// ⛔⛔ THIS FILE TESTS RENDERING, NOT THE CALENDAR. `newestBarIsForming` is
// `true | false | null` and arrives already decided; deciding it is
// `indicator_compute.py::bar_close_state`, on the Python side, because that is
// where the NYSE sets live. The clock-and-calendar half of what this file used
// to cover now lives in `tests/test_bar_close_state.py`, and the two halves are
// deliberately in different languages: a JS copy of the trading calendar is the
// second-authority defect this whole seam exists to prevent.
//
// ⚰️ IT USED TO CALL `computeClock(bars, tf, now, holidays)` AND WALK THE NYSE
// CALENDAR IN JAVASCRIPT. That seam was retired by owner ruling (2026-09-09) in
// favour of the tri-state. Converted rather than deleted — every property it
// asserted still holds and is still asserted, just on the side that owns it.
//
// ⛔ THE STABILITY CLAIM IS THE LOAD-BEARING ONE. A member's saved definition is
// evaluated by a pane now and by a sweep in an hour, and a CLOSED bar must read
// identically in both — otherwise "the same script on the same symbol" is two
// answers, and the one a member acted on is unrecoverable. That is only true
// because the state is an INPUT: a function reading the wall clock could not
// promise it, and could not even be asked the same question twice.

import { describe, it, expect } from 'vitest'
import { computeClock, CLOCK_COLUMNS, CLOCK_REALTIME } from '../../indicators.js'

const DAY = 86400
const FIVE = 300

/** A 5-minute series starting 2026-09-08 09:30 ET (13:30 UTC). */
const intraday = (n) => Array.from({ length: n }, (_, i) => ({
  t: 1757331000 + i * FIVE, o: 10, h: 11, l: 9, c: 10 + i, v: 100,
}))

/** A daily series. Bars are stamped at ET midnight. */
const daily = (n, from = 1757304000) => Array.from({ length: n }, (_, i) => ({
  t: from + i * DAY, o: 10, h: 11, l: 9, c: 10 + i, v: 100,
}))

/** `forming` is the tri-state: true, false, or null/undefined for "unknown". */
const at = (bars, tf, forming) => computeClock(bars, tf, forming)
const plain = (col) => [...col].map((v) => (Number.isNaN(v) ? null : v))

describe('⛔⛔ STABILITY — a closed bar reads the same however late you ask', () => {
  it('the same fetch, newest-forming then newest-closed, agrees on every CLOSED bar', () => {
    // ⭐ THE OWNER'S RULE, AS A TEST. Two evaluations either side of the newest
    // bar's close: that bar legitimately changes state, and NOTHING ELSE MAY.
    const bars = intraday(12)
    const early = at(bars, '5', true)   // the newest bar is still forming
    const late = at(bars, '5', false)   // long since closed
    // ⛔⛔ `islastconfirmedhistory` IS EXCLUDED, AND THE EXCLUSION IS A FINDING
    // RATHER THAN A CONVENIENCE — this rail caught it on its first run. It does
    // not name a property of a bar; it names the RIGHT EDGE of the confirmed
    // region, and that edge moves the instant the newest bar closes. Bar n-2
    // stops being the newest confirmed bar and bar n-1 becomes it, with neither
    // bar having changed. Pine's own column moves for the same reason.
    // ⚠️ SO A CONSUMER MUST NOT TREAT IT AS A STABLE PER-BAR FACT. Everything
    // else here is one: `isconfirmed` on a closed bar is a property of that bar
    // and can never move again.
    const stable = CLOCK_COLUMNS.filter((n) => n !== 'islastconfirmedhistory')
    for (const name of stable) {
      const a = plain(early[name]).slice(0, -1)
      const b = plain(late[name]).slice(0, -1)
      expect(b, `${name} moved on a CLOSED bar between two readings`).toEqual(a)
    }
    // ⭐ AND THE EXCLUDED ONE REALLY DOES MOVE, so the exclusion is a measured
    // property rather than a way of making the loop pass.
    expect(plain(early.islastconfirmedhistory))
      .not.toEqual(plain(late.islastconfirmedhistory))
    // ⛔ AND THE NEWEST BAR REALLY DID MOVE, or the loop above proved nothing:
    // a lane that answered a flat 0 everywhere would satisfy it perfectly.
    expect(early.isrealtime[11]).toBe(1)
    expect(late.isrealtime[11]).toBe(0)
  })

  it('⭐ two bindings of one fetch — "arrived early" vs "arrived late" — agree', () => {
    // The pane opens at 09:31 and the sweep reads the same fetch at 16:05. Every
    // bar the sweep can see closed is a bar the pane saw closed, and both must
    // say so identically. This is the same claim one level out: it is about two
    // CONSUMERS rather than two readings.
    const bars = daily(6)
    const closedCount = bars.length - 1
    const pane = at(bars, 'D', true)
    const sweep = at(bars, 'D', false)
    for (const name of ['isconfirmed', 'ishistory', 'islast', 'isfirst']) {
      expect(plain(sweep[name]).slice(0, closedCount),
        `${name} disagreed between the pane binding and the sweep binding`)
        .toEqual(plain(pane[name]).slice(0, closedCount))
    }
  })
})

describe('⛔⛔ THE TRI-STATE — `null` is UNKNOWN and never "not forming"', () => {
  it('⛔ NO STATE MEANS NO ANSWER — never a guessed one', () => {
    const bars = intraday(4)
    const blind = at(bars, '5', null)
    for (const name of CLOCK_REALTIME) {
      expect(plain(blind[name]).every((v) => v === null),
        `${name} answered with no bar-close state`).toBe(true)
    }
    // ⭐ …WHILE THE EXTENT PAIR STILL ANSWERS. Refusing a column that is fully
    // determined is as wrong as fabricating one that is not: which bar is newest
    // needs no clock at all.
    expect(plain(blind.islast)).toEqual([0, 0, 0, 1])
    expect(plain(blind.isfirst)).toEqual([1, 0, 0, 0])
  })

  it('⛔⛔ `null` IS NOT `false` — the whole point of the third state', () => {
    // ⚰️ THE PREDECESSOR DEFAULTED TO `false`, so a caller that knew nothing got
    // a CONFIDENT `isconfirmed = 1` on a bar that might still be open. That is
    // the one wrong answer these columns exist to prevent, and it is invisible:
    // it looks exactly like a correctly-closed bar.
    const bars = intraday(4)
    const unknown = at(bars, '5', null)
    const closed = at(bars, '5', false)
    expect(plain(closed.isconfirmed)).toEqual([1, 1, 1, 1])
    expect(plain(unknown.isconfirmed)).toEqual([null, null, null, null])
    expect(plain(unknown.isconfirmed)).not.toEqual(plain(closed.isconfirmed))
  })

  it('⛔ AND ANYTHING THAT IS NOT A BOOLEAN IS UNKNOWN — including a number', () => {
    // ⚰️ THE OLD SEAM PASSED AN INSTANT HERE. A caller still handing one over
    // must fail closed rather than have a unix timestamp read as truthy and
    // silently mean "forming".
    const bars = intraday(4)
    for (const bad of [1757331000, 0, 'true', {}, undefined]) {
      const cols = at(bars, '5', bad)
      expect(plain(cols.isrealtime).every((v) => v === null),
        `a ${typeof bad} was accepted as a bar-close state`).toBe(true)
    }
    // ⭐ CONTROL: the two real states are not swallowed by the same guard.
    expect(at(bars, '5', true).isrealtime[3]).toBe(1)
    expect(at(bars, '5', false).isrealtime[3]).toBe(0)
  })
})

describe('⛔ ONLY THE NEWEST BAR CAN BE REALTIME', () => {
  it('every earlier bar is 0, however stale the fetch', () => {
    // A fetch whose newest bar is days old still has exactly one candidate.
    const bars = daily(5)
    const cols = at(bars, 'D', false)
    expect(plain(cols.isrealtime)).toEqual([0, 0, 0, 0, 0])
    expect(plain(cols.isconfirmed)).toEqual([1, 1, 1, 1, 1])
    expect(plain(cols.islastconfirmedhistory)).toEqual([0, 0, 0, 0, 1])
    // ⭐ AND `islast` IS STILL THE NEWEST BAR — staleness is not absence.
    expect(plain(cols.islast)).toEqual([0, 0, 0, 0, 1])
  })

  it('⭐ with a FORMING newest bar, islast and islastconfirmedhistory DIFFER', () => {
    // ⛔ THE ONLY SHAPE THAT CAN TELL THE TWO APART. On a closed newest bar they
    // coincide, and a lane that had confused them would stay green forever.
    const bars = intraday(6)
    const cols = at(bars, '5', true)
    expect(plain(cols.islast)).toEqual([0, 0, 0, 0, 0, 1])
    expect(plain(cols.islastconfirmedhistory)).toEqual([0, 0, 0, 0, 1, 0])
  })

  it('⭐ a ONE-BAR series that is still forming has NO confirmed bar', () => {
    const cols = at(intraday(1), '5', true)
    expect(plain(cols.islast)).toEqual([1])
    expect(plain(cols.islastconfirmedhistory)).toEqual([0])
  })
})

describe('⛔⛔ NO CALENDAR REACHES THIS LANE', () => {
  it('the same bars and the same state answer identically on a holiday', () => {
    // ⭐ THE STRUCTURAL CONTROL. If this module ever started consulting a session
    // or a date set, the answer would begin depending on WHEN the bars are
    // stamped rather than on the handed-in state. 2025-12-26 is an NYSE closure;
    // 2026-09-08 is an ordinary Tuesday. Same shape, same state, same answer.
    const onAHoliday = daily(3, 1766718000)   // 2025-12-26 ET
    const ordinary = daily(3, 1757304000)     // 2026-09-08 ET
    for (const state of [true, false, null]) {
      expect(plain(at(onAHoliday, 'D', state).isrealtime),
        `a holiday changed the answer with state=${state}`)
        .toEqual(plain(at(ordinary, 'D', state).isrealtime))
    }
  })

  it('⛔ computeClock takes THREE arguments — a fourth is not a calendar slot', () => {
    // ⚰️ IT USED TO TAKE `(bars, tf, now, holidays)`. Pinning the arity keeps the
    // retired seam from being quietly restored: the next person who reaches for
    // a holiday set here has to change this line and read why first.
    expect(computeClock.length).toBe(2)   // two required; the tri-state defaults
    const src = computeClock.toString()
    expect(src.includes('holidays'), 'a holidays parameter came back').toBe(false)
  })
})
