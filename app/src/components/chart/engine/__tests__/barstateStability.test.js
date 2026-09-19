// app/src/components/chart/engine/__tests__/barstateStability.test.js
//
// ─── ⭐⭐ THE PROPERTY THE VENDOR DOES NOT HAVE ──────────────────────────────
//
// TradingView's `barstate` flags on a CLOSED bar depend on WHEN THE VIEWER
// ARRIVED. Measured on a live chart across the 2026-09-09 US open —
// `tests/fixtures/vendor/barstate-realtime-spy-2026-09-09.json`:
//
//   · 09:32:01 — the 09:31 bar had just closed and read isconfirmed=1, islast=1,
//     ishistory=0, because it had formed under that session.
//   · the 09:30 bar, which arrived as server-side HISTORY, read 1, 0, 1.
//   · 46 seconds later the 09:31 bar STILL read 1, 1, 0.
//
// Same bar, same symbol, same timeframe, two different answers depending on
// whether your session watched it form. Two members opening the same script
// minutes apart get different columns for the same historical bar.
//
// ⛔ SO "WE DIVERGE FROM THE VENDOR" IS NOT AN EXCUSE UNLESS THIS FILE PASSES.
// Anyone can be different. These two tests are the claim that we are BETTER: our
// flags on a closed bar are a function of the bar, and of nothing else.
//
// ⚠️ AND THE CLAIM IS DELIBERATELY NARROW. Only the NEWEST bar may differ between
// two evaluations, because only the newest bar can be forming. Every assertion
// below is about bars `0 .. n-2` and the newest bar is excluded BY NAME rather
// than by a loose comparison that would also pass if nothing ever changed.

import { describe, it, expect } from 'vitest'
import { computeClock, CLOCK_BARSTATE } from '../../indicators.js'

const BARS = Array.from({ length: 12 }, (_, i) => {
  const c = 100 + i
  return { t: 1757424600 + i * 86400, o: c - 1, h: c + 1, l: c - 2, c, v: 1000 + i }
})

/** ⭐⭐ THE FIVE FLAGS THAT ARE PROPERTIES OF THE BAR ITSELF — and the one that is
 *  not.
 *
 *  `islastconfirmedhistory` is excluded from the invariance below, and the reason
 *  is a distinction worth stating rather than a convenience: the other five ask
 *  "what is true OF THIS BAR", while `islastconfirmedhistory` asks "IS THIS THE
 *  BAR AT a position defined by the end of the series". It is a POINTER, not a
 *  state. When the newest bar starts forming, the newest CONFIRMED bar really is a
 *  different bar, so the pointer really must move — and the bar it moves off has
 *  not changed in any way.
 *
 *  ⛔ THAT IS NOT THE VENDOR'S DEFECT WEARING A DEFENCE. The vendor moves
 *  `ishistory` and `islast` — bar-local state — according to who was watching. We
 *  move only a pointer, and only when the thing it points AT has genuinely
 *  changed. The distinction is asserted below rather than asserted away: a
 *  dedicated test pins exactly where the pointer sits in both situations. */
const BAR_LOCAL = CLOCK_BARSTATE.filter((k) => k !== 'islastconfirmedhistory')

/** The bar-local flags on one bar, as a comparable string. */
const flagsAt = (cols, i) => BAR_LOCAL.map((k) => `${k}=${cols[k][i]}`).join(' ')

describe('⭐⭐ stability — a closed bar answers the same way twice', () => {
  it('⛔ TIME-INVARIANCE: the same closed bar, evaluated at two different wall-clock times', () => {
    // "A different wall-clock time" reaches this function as a different
    // `newestBarIsForming`: mid-session the newest bar is forming, after the
    // close it is not. Nothing else about the fetch has moved.
    const midSession = computeClock(BARS, 'D', true)
    const afterClose = computeClock(BARS, 'D', false)

    for (let i = 0; i < BARS.length - 1; i++) {
      expect(flagsAt(midSession, i), `bar ${i} changed between two evaluations`)
        .toBe(flagsAt(afterClose, i))
    }
  })

  it('⭐ …and the NEWEST bar is allowed to differ — the control', () => {
    // ⛔ WITHOUT THIS, the test above passes on an implementation that returns
    // the same thing for everything, which is not stability, it is inertness.
    const last = BARS.length - 1
    expect(flagsAt(computeClock(BARS, 'D', true), last))
      .not.toBe(flagsAt(computeClock(BARS, 'D', false), last))
  })

  it('⛔⛔ ARRIVAL-INVARIANCE: two bindings of the SAME fetch agree on every closed bar', () => {
    // ⭐ THIS IS THE VENDOR'S DEFECT, ASKED OF US DIRECTLY — and the fetch has to
    // be the SAME one, or the test proves nothing. Two viewers holding different
    // amounts of history are entitled to different answers; two viewers holding
    // the SAME twelve bars are not.
    //   · `arrivedEarly` was here while bar 11 was still forming.
    //   · `arrivedLate` opened the chart after bar 11 closed.
    // Bars 0..10 are closed for both. On TradingView the early session would
    // still be carrying realtime flags on the bar it watched form.
    const arrivedEarly = computeClock(BARS, 'D', true)
    const arrivedLate = computeClock(BARS, 'D', false)

    for (let i = 0; i < BARS.length - 1; i++) {
      expect(flagsAt(arrivedEarly, i),
        `bar ${i} reads differently for a viewer who watched it form — that is `
        + 'the vendor repaint, and it must not happen here')
        .toBe(flagsAt(arrivedLate, i))
    }
  })
})

describe('⛔⛔ the repaint, asked of us directly', () => {
  it('a bar that was newest and then closed reads EXACTLY as a bar that was always history', () => {
    // ⭐ THE TWO WAYS TO ARRIVE AT THE SAME BAR:
    //   (a) you were watching when bar 10 was the newest and forming, and then
    //       bar 11 arrived — so you now hold a 12-bar fetch;
    //   (b) you opened the chart after bar 11 existed — the same 12-bar fetch.
    // Both are `computeClock(BARS, 'D', …)`, and bar 10 is closed in both. The
    // vendor gives these two viewers DIFFERENT answers for bar 10; we must not.
    const watchedItForm = computeClock(BARS, 'D', true)   // bar 11 now forming
    const arrivedLater = computeClock(BARS, 'D', false)   // bar 11 already closed

    expect(flagsAt(watchedItForm, 10), 'bar 10 repainted').toBe(flagsAt(arrivedLater, 10))

    // …and it is the CLOSED-bar reading in both, not merely equal-to-each-other.
    expect(watchedItForm.isconfirmed[10]).toBe(1)
    expect(watchedItForm.ishistory[10]).toBe(1)
    expect(watchedItForm.isrealtime[10]).toBe(0)
    expect(watchedItForm.islast[10]).toBe(0)
  })

  it('⭐ islastconfirmedhistory moves with the forming bar, and ONLY it does', () => {
    // The one flag that legitimately differs on a closed bar between the two
    // situations — because "the newest CONFIRMED bar" is a different bar when the
    // newest bar is forming. Asserted explicitly so its movement is a decision
    // rather than a leak in the invariance above.
    const forming = computeClock(BARS, 'D', true)
    const closed = computeClock(BARS, 'D', false)
    expect(forming.islastconfirmedhistory[10]).toBe(1)
    expect(closed.islastconfirmedhistory[10]).toBe(0)
    expect(closed.islastconfirmedhistory[11]).toBe(1)
  })

  it('⛔ a one-bar fetch that is still forming has NO confirmed history, and says so', () => {
    // The edge the arithmetic has to survive: `lastConfirmed = last - 1` is -1.
    const one = computeClock([BARS[0]], 'D', true)
    expect([...one.islastconfirmedhistory]).toEqual([0])
    expect([...one.isrealtime]).toEqual([1])
    expect([...one.islast]).toEqual([1])
    expect([...one.isfirst]).toEqual([1])
  })
})
