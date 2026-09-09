// app/src/components/chart/engine/ast/barstate.test.js
//
// ─── ⭐⭐ WHAT A BAR'S STATE IS DECIDED BY, AND WHAT IT MUST NOT BE ───────────
//
// The six shipped `barstate.*` columns are decided by TWO things and neither is
// the tape: the FETCH says which bar is newest and which is oldest, the CLOCK
// says whether the newest one's period has finished. This file asserts the
// properties that follow from that, and the two gaps that follow from the
// calendar we do not have.
//
// ⛔ THE STABILITY CLAIM IS THE LOAD-BEARING ONE. A member's saved definition is
// evaluated by a pane now and by a sweep in an hour, and a CLOSED bar must read
// identically in both — otherwise "the same script on the same symbol" is two
// answers, and the one a member acted on is unrecoverable. That is only true
// because `now` is an INPUT: a function reading the wall clock cannot promise
// it, and cannot even be asked the same question twice.

import { describe, it, expect } from 'vitest'
import { computeClock, CLOCK_COLUMNS } from '../../indicators.js'

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

const at = (bars, tf, now, holidays) => computeClock(bars, tf, now, holidays)
const plain = (col) => [...col].map((v) => (Number.isNaN(v) ? null : v))

describe('⛔⛔ STABILITY — a closed bar reads the same however late you ask', () => {
  it('the same fetch at two wall-clock times agrees on every CLOSED bar', () => {
    // ⭐ THE OWNER'S RULE, AS A TEST. Two evaluations an hour apart: the newest
    // bar legitimately changes state when its period ends, and NOTHING ELSE MAY.
    const bars = intraday(12)
    const newest = bars[bars.length - 1].t
    const early = at(bars, '5', newest + 10)        // the newest bar is forming
    const late = at(bars, '5', newest + FIVE + 3600) // long since closed
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
    const paneNow = bars[bars.length - 1].t + 60
    const sweepNow = bars[bars.length - 1].t + 20 * 3600
    const pane = at(bars, 'D', paneNow)
    const sweep = at(bars, 'D', sweepNow)
    for (const name of ['isconfirmed', 'ishistory', 'islast', 'isfirst']) {
      expect(plain(sweep[name]).slice(0, closedCount),
        `${name} disagreed between the pane binding and the sweep binding`)
        .toEqual(plain(pane[name]).slice(0, closedCount))
    }
  })

  it('⛔ NO `now` MEANS NO ANSWER — never a guessed instant', () => {
    const bars = intraday(4)
    const blind = at(bars, '5', undefined)
    for (const name of ['isrealtime', 'isconfirmed', 'ishistory',
      'islastconfirmedhistory']) {
      expect(plain(blind[name]).every((v) => v === null),
        `${name} answered with no evaluating instant`).toBe(true)
    }
    // ⭐ …WHILE THE EXTENT PAIR STILL ANSWERS. Refusing a column that is fully
    // determined is as wrong as fabricating one that is not: which bar is newest
    // needs no clock at all.
    expect(plain(blind.islast)).toEqual([0, 0, 0, 1])
    expect(plain(blind.isfirst)).toEqual([1, 0, 0, 0])
  })
})

describe('⭐ EXTENDED HOURS — checked, not assumed', () => {
  it('a pre-market bar ends span seconds after it starts, like any other', () => {
    // ⚠️ OUR FETCH CAN CONTAIN THESE. `bars_fetch` keeps extended-hours prints
    // deliberately and the yfinance fallback asks for them (`prepost=True`), so
    // "the session was open" is not a precondition this column may rely on.
    // 2026-09-08 08:00 ET = 12:00 UTC — an hour and a half before the open.
    const pre = Array.from({ length: 3 }, (_, i) => ({
      t: 1757325600 + i * FIVE, o: 10, h: 11, l: 9, c: 10, v: 1,
    }))
    const newest = pre[pre.length - 1].t
    expect(at(pre, '5', newest + 10).isrealtime[2]).toBe(1)
    expect(at(pre, '5', newest + FIVE + 1).isrealtime[2]).toBe(0)
  })

  it('⛔ and an INTRADAY bar needs no calendar at all — the control', () => {
    // If the intraday path ever started consulting a session or a holiday set,
    // this would start depending on the date rather than on the arithmetic.
    const onAHoliday = [{ t: 1766763000, o: 1, h: 1, l: 1, c: 1, v: 1 }]  // 2025-12-26
    expect(at(onAHoliday, '5', 1766763000 + 10).isrealtime[0]).toBe(1)
    expect(at(onAHoliday, '5', 1766763000 + FIVE + 1).isrealtime[0]).toBe(0)
  })
})

describe('⛔⛔ THE CALENDAR GAPS — named here so they are not discovered', () => {
  it('a DAILY bar is treated as ending at 16:00 New York', () => {
    const bars = daily(3)
    const newest = bars[bars.length - 1].t
    // 15:59 ET on the bar's own day: still forming.
    const beforeClose = newest + 15 * 3600 + 59 * 60
    // 16:01 ET: finished.
    const afterClose = newest + 16 * 3600 + 60
    expect(at(bars, 'D', beforeClose).isrealtime[2]).toBe(1)
    expect(at(bars, 'D', afterClose).isrealtime[2]).toBe(0)
  })

  it('⚠️ …WHICH IS WRONG ON AN EARLY-CLOSE SESSION, and that is the shipped gap', () => {
    // ⛔ THIS TEST ASSERTS THE DEFECT ON PURPOSE. NYSE half-days close at 13:00
    // ET, and `bars_fetch._NYSE_HOLIDAYS_YYYYMMDD` says in its own words that
    // they are "intentionally NOT" in the closure set — so this engine has no
    // way to know. On such a session the newest daily bar reads `isrealtime` for
    // three hours after trading stopped.
    //
    // ⭐ IT IS A TEST RATHER THAN A COMMENT BECAUSE A GAP NOBODY CAN SEE IS A GAP
    // NOBODY FIXES. The day a half-day calendar lands, this goes red BY NAME and
    // the correct edit is to invert it — which is exactly the notification the
    // pipeline backlog item is asking for.
    // 2025-11-28 (day after Thanksgiving, a 13:00 ET close), stamped ET midnight.
    const halfDay = [{ t: 1764306000, o: 1, h: 1, l: 1, c: 1, v: 1 }]
    const twoPM = 1764306000 + 14 * 3600     // 14:00 ET — an hour after the close
    expect(at(halfDay, 'D', twoPM).isrealtime[0],
      'an early-close calendar has landed — invert this and update docs/pine/barstate.md')
      .toBe(1)
  })

  it('⭐ a WEEK ends on its Friday, and a holiday walks it back', () => {
    // The bar is stamped at the week's START; the period ends on the last trading
    // day. ⛔ WITHOUT THE CLOSURE SET the walk-back cannot happen, which is the
    // second named gap — so both directions are driven here.
    const monday = [{ t: 1743480000, o: 1, h: 1, l: 1, c: 1, v: 1 }]   // 2025-04-01 ET
    const fridayAfternoon = 1743480000 + 3 * DAY + 15 * 3600           // Fri 15:00 ET
    // Good Friday 2025-04-18 is not in this week; use a week that ends on one.
    const goodFridayWeek = [{ t: 1744689600, o: 1, h: 1, l: 1, c: 1, v: 1 }] // 2025-04-15 ET
    const thursdayEvening = 1744689600 + 2 * DAY + 20 * 3600
    expect(at(monday, 'W', fridayAfternoon).isrealtime[0],
      'a week should still be forming on its Friday afternoon').toBe(1)
    // With no closure set the week is assumed to run to Friday…
    expect(at(goodFridayWeek, 'W', thursdayEvening).isrealtime[0]).toBe(1)
    // …and WITH it, the week ended on the Thursday.
    const holidays = new Set([20250418])
    expect(at(goodFridayWeek, 'W', thursdayEvening, holidays).isrealtime[0],
      'the closure set did not walk the week back off Good Friday').toBe(0)
  })
})

describe('⛔ ONLY THE NEWEST BAR CAN BE REALTIME', () => {
  it('every earlier bar is 0, however stale the fetch', () => {
    // A fetch whose newest bar is days old still has exactly one candidate. A
    // per-bar comparison against `now` would answer the same thing at ten times
    // the cost — and would answer it DIFFERENTLY here, which is the case a
    // member most needs told rather than smoothed over.
    const bars = daily(5)
    const long = bars[bars.length - 1].t + 30 * DAY
    const cols = at(bars, 'D', long)
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
    const cols = at(bars, '5', bars[bars.length - 1].t + 10)
    expect(plain(cols.islast)).toEqual([0, 0, 0, 0, 0, 1])
    expect(plain(cols.islastconfirmedhistory)).toEqual([0, 0, 0, 0, 1, 0])
  })
})
