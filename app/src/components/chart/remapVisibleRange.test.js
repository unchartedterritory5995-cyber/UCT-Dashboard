// ── MARKET DATA MAY NOT MOVE THE USER'S CAMERA ───────────────────────────────
//
// ⛔⛔ THE PRODUCTION REPORT. On a fast-moving name, after the member pans or
// zooms, the chart creeps back toward the right. Root-caused to `updateChart`'s
// count-change re-anchor, which preserved BARS-FROM-RIGHT — invariant under a
// prepend, wrong under a live append, and the branch fires on both.
//
// ⚠️⚠️ THE TRAP THESE RAILS EXIST TO CLOSE. A count change does not name the
// mutation: prepend(3) and append(3) are the same number, and a trim-front +
// append-back is the same LENGTH. Every case below is built from boundary
// timestamps, and the retired bars-from-right rule is restated inline so the
// regression is MEASURED rather than asserted — a rail that only says "the new
// code returns X" cannot tell you the old code returned something different.

import { describe, it, expect } from 'vitest'
import { remapVisibleRange, classifyMutation } from './remapVisibleRange'

const T0 = 1758034800                       // 2025-09-16 09:30 ET, arbitrary but real
const STEP = 300                            // 5m
const bars = (n, startIdx = 0) =>
  Array.from({ length: n }, (_, i) => ({ t: T0 + (startIdx + i) * STEP, c: 100 + startIdx + i }))

/** The rule that shipped, restated so its failure is visible as a measurement. */
const barsFromRight = (prev, next, pr) => {
  const to = next.length - (prev.length - pr.to)
  return { from: to - (pr.to - pr.from), to }
}
const timeAt = (arr, idx) => arr[Math.round(idx)]?.t

describe('classifyMutation reads BOUNDARIES, never lengths', () => {
  it('identity: same bars, no edit', () => {
    expect(classifyMutation(bars(100), bars(100))).toBe('identity')
  })

  it('append: newest bar advances', () => {
    expect(classifyMutation(bars(100), bars(101))).toBe('append')
  })

  it('prepend: older history arrives at the front, newest unchanged', () => {
    expect(classifyMutation(bars(100, 10), bars(110, 0))).toBe('prepend')
  })

  it('⛔ prepend(3) and append(3) are the SAME count change and DIFFERENT mutations', () => {
    const base = bars(100, 10)
    const prepended = bars(103, 7)
    const appended = bars(103, 10)
    expect(prepended.length).toBe(appended.length)          // identical counts…
    expect(classifyMutation(base, prepended)).toBe('prepend')
    expect(classifyMutation(base, appended)).toBe('append')  // …different verdicts
  })

  it('compound: a backfill and a new candle land in the same commit', () => {
    expect(classifyMutation(bars(100, 10), bars(115, 0))).toBe('compound')
  })

  it('same-span: contents rewritten, both edges unchanged (split self-heal)', () => {
    const a = bars(100)
    const b = a.map(x => ({ ...x, c: x.c * 4 }))
    expect(classifyMutation(a, b)).toBe('identity')
  })

  it('⛔ roll: a capped window drops its oldest bar while appending — SAME LENGTH', () => {
    // The count does not change at all, so a length-based classifier sees
    // "nothing happened" while every index has shifted left by one.
    expect(bars(100, 1).length).toBe(bars(100, 0).length)
    expect(classifyMutation(bars(100, 0), bars(100, 1))).toBe('roll')
  })

  it('⭐ a roll shifts every index, and the time anchor absorbs it', () => {
    const prev = bars(100, 0)
    const pr = { from: 20, to: 60 }
    const next = bars(100, 1)                // oldest dropped, newest appended
    const r = remapVisibleRange({ prevBars: prev, nextBars: next, prevRange: pr })
    expect(r.mutation).toBe('roll')
    expect(timeAt(next, r.from)).toBe(timeAt(prev, pr.from))
    expect(r.from).toBe(19)                  // index moved, the member did not
  })

  it('replacement: a different ticker shares no bars at all', () => {
    expect(classifyMutation(bars(100, 0), bars(100, 5000))).toBe('replacement')
  })

  it('unknown rather than a guess when a side is empty or untimed', () => {
    expect(classifyMutation([], bars(10))).toBe('unknown')
    expect(classifyMutation(bars(10), [{ c: 1 }])).toBe('unknown')
  })
})

describe('APPEND — the reported bug', () => {
  const prev = bars(3000)
  const pr = { from: 2600, to: 2680 }        // member panned back, 80 bars wide

  it('⛔ THE RETIRED RULE DRAGGED THE VIEW FORWARD ONE BAR PER APPENDED CANDLE', () => {
    const next = bars(3001)
    const old = barsFromRight(prev, next, pr)
    expect(old.from - pr.from).toBe(1)       // it really did move
    expect(timeAt(next, old.from) - timeAt(prev, pr.from)).toBe(STEP)
  })

  it('⭐ the time anchor holds the member on the same candle', () => {
    const next = bars(3001)
    const r = remapVisibleRange({ prevBars: prev, nextBars: next, prevRange: pr })
    expect(r.strategy).toBe('time-anchor')
    expect(r.mutation).toBe('append')
    expect(timeAt(next, r.from)).toBe(timeAt(prev, pr.from))
    expect(r.to - r.from).toBe(pr.to - pr.from)             // zoom preserved
  })

  it('⛔ FOUR CONSECUTIVE BOUNDARIES ACCUMULATE UNDER THE OLD RULE, NOT THE NEW', () => {
    // The owner's symptom is accumulation, not one jump — so test accumulation.
    let oldPrev = prev, oldRange = pr, newPrev = prev, newRange = pr
    for (let k = 1; k <= 4; k++) {
      const next = bars(3000 + k)
      oldRange = barsFromRight(oldPrev, next, oldRange); oldPrev = next
      const r = remapVisibleRange({ prevBars: newPrev, nextBars: next, prevRange: newRange })
      newRange = { from: r.from, to: r.to }; newPrev = next
    }
    expect(oldRange.from - pr.from).toBe(4)                  // +4 bars = +20 minutes
    expect(newRange.from - pr.from).toBe(0)
    expect(timeAt(newPrev, newRange.from)).toBe(timeAt(prev, pr.from))
    expect(newRange.to - newRange.from).toBe(pr.to - pr.from)
  })
})

describe('PREPEND — the case the branch was written for, not regressed', () => {
  const prev = bars(600, 400)                // shallow first paint
  const pr = { from: 300, to: 380 }

  it('a 400-bar backfill keeps the member on the same candle', () => {
    const next = bars(1000, 0)
    const r = remapVisibleRange({ prevBars: prev, nextBars: next, prevRange: pr })
    expect(r.mutation).toBe('prepend')
    expect(r.strategy).toBe('time-anchor')
    expect(timeAt(next, r.from)).toBe(timeAt(prev, pr.from))
    expect(r.from).toBe(700)                 // index shifted by exactly the prepend
  })

  it('⭐ the OLD rule was also correct here — the fix is a superset, not a swap', () => {
    const next = bars(1000, 0)
    const old = barsFromRight(prev, next, pr)
    const r = remapVisibleRange({ prevBars: prev, nextBars: next, prevRange: pr })
    expect(old.from).toBe(r.from)
    expect(old.to).toBe(r.to)
  })

  it('the deep 600→12025 depth jump does not snap to the default window', () => {
    const p = bars(600, 11425)
    const range = { from: 500, to: 580 }
    const next = bars(12025, 0)
    const r = remapVisibleRange({ prevBars: p, nextBars: next, prevRange: range })
    expect(timeAt(next, r.from)).toBe(timeAt(p, range.from))
  })
})

describe('COMPOUND — a backfill and a new candle in the same commit', () => {
  it('the prepend is absorbed and the append adds no drift', () => {
    const prev = bars(600, 400)
    const pr = { from: 300, to: 380 }
    const next = bars(1001, 0)               // +400 front, +1 back
    const r = remapVisibleRange({ prevBars: prev, nextBars: next, prevRange: pr })
    expect(r.mutation).toBe('compound')
    expect(timeAt(next, r.from)).toBe(timeAt(prev, pr.from))
    const old = barsFromRight(prev, next, pr)
    expect(old.from - r.from).toBe(1)        // the old rule's residual drift
  })
})

describe('REPLACEMENT — the anchor is gone', () => {
  it('a refetch that dropped the anchor falls back rather than inventing one', () => {
    const prev = bars(600, 0)
    const pr = { from: 10, to: 90 }
    const next = bars(600, 500)              // window slid past the anchor entirely
    const r = remapVisibleRange({ prevBars: prev, nextBars: next, prevRange: pr })
    expect(r.anchorIndex).toBeNull()
    expect(['bars-from-right', 'repin']).toContain(r.strategy)
  })

  it('⛔ A MAPPING THAT LANDS IN THE EMPTY RIGHT-PAD IS REFUSED, NOT APPLIED', () => {
    // The blank-chart-until-Reset-view failure: keep the newest candle reachable.
    // Deep history, member panned far BACK, then a short replace lands. The old
    // bars-from-right distance (510) now exceeds the whole dataset, so the
    // mapping computes a window entirely off the left of real data.
    const prev = bars(600, 0)
    const pr = { from: 10, to: 90 }
    const next = bars(400, 200)              // shorter, and slid past the anchor
    const r = remapVisibleRange({ prevBars: prev, nextBars: next, prevRange: pr, lastCandleFraction: 0.05 })
    expect(r.strategy).toBe('repin')
    expect(r.to).toBeGreaterThan(0)
    expect(r.from).toBeLessThan(next.length - 1)
    expect(r.to - r.from).toBe(pr.to - pr.from)             // zoom still preserved
  })
})

describe('NEGATIVE CONTROLS — these rails can fail', () => {
  it('a remap that ignored its input would not distinguish prepend from append', () => {
    const prev = bars(100, 10)
    const pr = { from: 20, to: 60 }
    const pre = remapVisibleRange({ prevBars: prev, nextBars: bars(103, 7), prevRange: pr })
    const app = remapVisibleRange({ prevBars: prev, nextBars: bars(103, 10), prevRange: pr })
    expect(pre.from).not.toBe(app.from)      // same count change, different answers
  })

  it('the restated old rule genuinely differs from the new one on append', () => {
    const prev = bars(100), pr = { from: 20, to: 60 }
    const next = bars(105)
    expect(barsFromRight(prev, next, pr).from).not.toBe(
      remapVisibleRange({ prevBars: prev, nextBars: next, prevRange: pr }).from)
  })

  it('zero width is refused rather than producing a degenerate range', () => {
    const r = remapVisibleRange({ prevBars: bars(100), nextBars: bars(101), prevRange: { from: 50, to: 50 } })
    expect(r.from).toBeNull()
  })
})

describe('THE ANCHOR IS A BAR PLUS AN OFFSET — both halves measured in the browser', () => {
  it('⛔ A FRACTIONAL LEFT EDGE IS PRESERVED, NOT ROUNDED TO A WHOLE BAR', () => {
    // Browser-measured: a zoomed-in member at from=186.756 was snapped to 187,
    // i.e. +300s of visible-window drift on EVERY data commit.
    const prev = bars(3000)
    const pr = { from: 186.756195242501, to: 1671 }
    const r = remapVisibleRange({ prevBars: prev, nextBars: bars(3001), prevRange: pr })
    expect(r.from).toBeCloseTo(pr.from, 6)
    expect(r.to - r.from).toBeCloseTo(pr.to - pr.from, 6)
  })

  it('⛔ A VIEW PANNED LEFT OF BAR 0 IS NOT SLAMMED TO BAR 0', () => {
    // Browser-measured: from=-405 became 0 (a 597-bar, ~2-day jump) and a deep
    // pan at from=-2100 became 0 (4308 bars). LWC lets the view sit in the void
    // before the first bar; that is a legitimate place for a member to be.
    for (const start of [-405, -1166.8195478450928, -2100]) {
      const pr = { from: start, to: start + 2391 }
      const r = remapVisibleRange({ prevBars: bars(3000), nextBars: bars(3001), prevRange: pr })
      expect(r.from).toBeCloseTo(start, 6)
      expect(r.to - r.from).toBeCloseTo(2391, 6)
    }
  })

  it('⭐ the offset rides a PREPEND too — the index moves, the member does not', () => {
    const prev = bars(600, 400)
    const pr = { from: 300.25, to: 380.25 }
    const r = remapVisibleRange({ prevBars: prev, nextBars: bars(1000, 0), prevRange: pr })
    expect(r.from).toBeCloseTo(700.25, 6)          // 300.25 + the 400-bar prepend
    expect(r.anchorOffset).toBeCloseTo(0.25, 6)
  })

  it('⛔ FOUR BOUNDARIES DO NOT ACCUMULATE THE FRACTION', () => {
    // §6: a STABLE fraction is a representation detail; a GROWING one is the bug.
    let prevB = bars(3000), range = { from: 2600.389, to: 2680.389 }
    const fracs = []
    for (let k = 1; k <= 4; k++) {
      const next = bars(3000 + k)
      const r = remapVisibleRange({ prevBars: prevB, nextBars: next, prevRange: range })
      range = { from: r.from, to: r.to }; prevB = next
      fracs.push(Number((((r.from % 1) + 1) % 1).toFixed(4)))
    }
    expect(fracs).toEqual([0.389, 0.389, 0.389, 0.389])
    expect(range.from).toBeCloseTo(2600.389, 6)
  })

  it('a negative offset survives a roll, which shifts every index left', () => {
    const r = remapVisibleRange({ prevBars: bars(100, 0), nextBars: bars(100, 1),
                                  prevRange: { from: -12.5, to: 27.5 } })
    // The anchor clamps to bar 0 for lookup, carrying -12.5; bar 0's time is now
    // at index -1 (it was dropped), so the member's edge lands 1 bar earlier.
    expect(r.to - r.from).toBeCloseTo(40, 6)
    expect(r.from % 1).toBeCloseTo(-0.5, 6)
  })
})

describe('OWNERSHIP SELECTS THE INVARIANT — an untouched chart still follows', () => {
  const prev = bars(3000)

  it('⛔ AN UNOWNED CHART KEEPS THE NEWEST CANDLE IN THE SAME SCREEN SLOT', () => {
    // Browser-measured regression: with one time-anchored rule for both, an
    // untouched chart's right pad walked 4.05 -> 3.05 -> 2.05 -> 0.05 across four
    // boundaries — the newest candle two boundaries from leaving the screen.
    let range = { from: 2922, to: 3003.0526315789475 }
    const pads = []
    let p = prev
    for (let k = 1; k <= 4; k++) {
      const next = bars(3000 + k)
      const r = remapVisibleRange({ prevBars: p, nextBars: next, prevRange: range, followRight: true })
      range = { from: r.from, to: r.to }; p = next
      pads.push(Number((range.to - (next.length - 1)).toFixed(4)))
    }
    expect(new Set(pads).size).toBe(1)                  // the pad never moves
    expect(pads[0]).toBeCloseTo(4.0526, 3)
  })

  it('⭐ and the SAME input, owned, holds the time window instead', () => {
    const range = { from: 2922, to: 3003.0526315789475 }
    const owned = remapVisibleRange({ prevBars: prev, nextBars: bars(3001), prevRange: range })
    const free = remapVisibleRange({ prevBars: prev, nextBars: bars(3001), prevRange: range, followRight: true })
    expect(owned.strategy).toBe('time-anchor')
    expect(free.strategy).toBe('bars-from-right')
    expect(owned.from).toBe(range.from)                 // the member did not move
    expect(free.from).toBe(range.from + 1)              // the tape advanced
  })

  it('an unowned chart still absorbs a PREPEND — following is not forgetting', () => {
    const p = bars(600, 400)
    const range = { from: 520, to: 599 }                // near the right edge
    const next = bars(1000, 0)                          // 400-bar backfill
    const r = remapVisibleRange({ prevBars: p, nextBars: next, prevRange: range, followRight: true })
    expect(r.to - (next.length - 1)).toBeCloseTo(range.to - (p.length - 1), 6)
    expect(timeAt(next, r.from)).toBe(timeAt(p, range.from))   // same candle, too
  })

  it('NEGATIVE CONTROL: the flag changes the answer on an append', () => {
    const range = { from: 2600, to: 2680 }
    expect(remapVisibleRange({ prevBars: prev, nextBars: bars(3001), prevRange: range }).from)
      .not.toBe(remapVisibleRange({ prevBars: prev, nextBars: bars(3001), prevRange: range, followRight: true }).from)
  })
})
