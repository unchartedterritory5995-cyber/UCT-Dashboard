// app/src/components/chart/__tests__/viewLockFeedbackLoop.test.js
//
// ─── WHY THE CHART GOT SMALLER WITH EVERY PAN, AS ARITHMETIC ────────────────
//
// ⭐ THE COMPOUNDING HAS A CLOSED FORM, and writing it down is what turns "it
// keeps pinching" into a rail. Let the candle pane be H px, the scale margins
// (t, b), and let the price range lightweight-charts is actually using be R.
// The visible bars span [lo, hi] ⊆ R. Write
//
//     c = (hi − lo) / (R.max − R.min)          — the bars' share of the RANGE
//     s = t + b                                 — the margins' share of the PANE
//
// `_measureViewLock` reads the bars' pixel rows and stores them as the next
// margins, so one measure→apply round is
//
//     1 − s(n+1) = c · (1 − s(n))               and the bars occupy c·(1 − s(n))
//
// ⛔ EVERYTHING FOLLOWS FROM `c`. Under AUTOSCALE the range IS the bars' extremes,
// so c = 1, the recurrence is the identity, and panning a never-dragged chart is
// exactly as stable as members report. A price-axis drag pins a WIDER range
// through `autoscaleInfoProvider`, so c < 1 and the occupancy decays GEOMETRICALLY
// — 70% → 23% → 7.8% → 2.6% at c = ⅓ — until the 0.95 combined clamp holds it at a
// sliver. A drag the other way gives c > 1 and the margins collapse to zero.
//
// ⚠️ THE RAIL IS ON THE LAW, NOT ON A SCREENSHOT. `StockChart.verticalViewLock
// .test.jsx` drives the real component and proves the product no longer runs this
// recurrence; this file proves the recurrence is what the helpers compute, at pane
// heights and margins no single fixture could cover, so a future edit that
// reintroduces a measure-on-navigation path is diagnosable in one read.

import { describe, it, expect } from 'vitest'
import { viewLockFractions, capturedPriceRange } from '../chromeGeometry'

/** lightweight-charts' own composition: the effective range fills the
 *  MARGIN-INSET plot area of the CANDLE pane. */
const scale = (H, m, R) => ({
  priceToCoordinate: (p) => m.top * H + ((R.max - p) / (R.max - R.min)) * H * (1 - m.top - m.bottom),
  coordinateToPrice: (y) => R.max - ((y - m.top * H) / (H * (1 - m.top - m.bottom))) * (R.max - R.min),
})

/** One measure→store→apply round, exactly as the product composed it. */
const round = (H, m, R, bars) => {
  const s = scale(H, m, R)
  const f = viewLockFractions(H, s.priceToCoordinate(bars.hi), s.priceToCoordinate(bars.lo))
  return f
}
const occupancy = (H, m, R, bars) => {
  const s = scale(H, m, R)
  return (s.priceToCoordinate(bars.lo) - s.priceToCoordinate(bars.hi)) / H
}

const BARS = { lo: 100, hi: 120 }

describe('⭐ AUTOSCALE IS A FIXED POINT — c = 1', () => {
  // The denominators the bug lived and died on: a tall lone Price pane, Price
  // squeezed under a volume + two oscillators, and the short pane a grid cell gets.
  for (const H of [180, 260, 400, 470, 720]) {
    for (const m of [{ top: 0.3, bottom: 0 }, { top: 0.1, bottom: 0.18 }, { top: 0.06, bottom: 0.32 }]) {
      it(`H=${H} margins ${m.top}/${m.bottom}: measuring an autoscaled chart returns its own margins`, () => {
        // Autoscale ⇒ the effective range IS the visible bars' extremes.
        const R = { min: BARS.lo, max: BARS.hi }
        const f = round(H, m, R, BARS)
        expect(f.top).toBeCloseTo(m.top, 3)
        expect(f.bottom).toBeCloseTo(m.bottom, 3)
        // …so twenty rounds change nothing at all.
        let cur = { ...m }
        for (let i = 0; i < 20; i++) cur = round(H, cur, R, BARS)
        expect(cur.top).toBeCloseTo(m.top, 3)
        expect(cur.bottom).toBeCloseTo(m.bottom, 3)
      })
    }
  }
})

describe('⛔⛔ A PINNED RANGE IS NOT — c < 1 decays geometrically', () => {
  const H = 400
  const M0 = { top: 0.1, bottom: 0.18 }

  it('the pin an axis drag captures is the range the member stretched to', () => {
    // The member drags the axis; lightweight-charts widens the range; on release
    // the capture reads the price at the margin-INSET boundaries.
    const stretched = { min: 60, max: 160 }
    const pinned = capturedPriceRange(H, M0, scale(H, M0, stretched).coordinateToPrice)
    expect(pinned.minValue).toBeCloseTo(stretched.min, 6)
    expect(pinned.maxValue).toBeCloseTo(stretched.max, 6)
  })

  it('⛔ each measure→apply round multiplies the free height by c', () => {
    const R = { min: 60, max: 160 }                    // c = 20/100 = 0.2
    const c = (BARS.hi - BARS.lo) / (R.max - R.min)
    let m = { ...M0 }
    let free = 1 - (m.top + m.bottom)
    for (let i = 0; i < 3; i++) {
      const next = round(H, m, R, BARS)
      const nextFree = 1 - (next.top + next.bottom)
      if (nextFree < 0.06) break                        // the 0.95 clamp has taken over
      expect(nextFree).toBeCloseTo(free * c, 3)
      m = next; free = nextFree
    }
  })

  it('⛔ THE MEMBER-VISIBLE NUMBER: 70% of the pane → a sliver in four pans', () => {
    const R = { min: 40, max: 180 }                     // a ×7 stretch
    let m = { top: 0.3, bottom: 0 }
    const trace = [occupancy(H, m, R, BARS)]
    for (let i = 0; i < 6; i++) { m = round(H, m, R, BARS); trace.push(occupancy(H, m, R, BARS)) }
    // strictly decreasing until the clamp, and an order of magnitude gone
    expect(trace[1]).toBeLessThan(trace[0] * 0.5)
    expect(trace[4]).toBeLessThan(trace[0] * 0.1)
    // …and it never recovers on its own.
    expect(trace[6]).toBeLessThanOrEqual(trace[4])
  })

  it('⛔ a COMPRESSING drag runs the other way — the margins collapse to zero', () => {
    const R = { min: 105, max: 115 }                    // c = 2
    let m = { top: 0.1, bottom: 0.18 }
    for (let i = 0; i < 6; i++) m = round(H, m, R, BARS)
    expect(m.top).toBe(0)
    expect(m.bottom).toBe(0)
  })
})

describe('⭐ THE DENOMINATOR IS PRICE’S PANE, AT EVERY STACK POSITION', () => {
  // A band read in PRICE's pane must be the same fraction whatever the panes
  // above it are — the invariant the 2026-09 pane-0 crush broke.
  const R = { min: 90, max: 130 }
  it('the same band reads identically for Price first, middle and last', () => {
    const cases = [
      { chartH: 400, priceTop: 0, priceH: 400 },     // PRICE alone
      { chartH: 400, priceTop: 0, priceH: 320 },     // PRICE · VOLUME
      { chartH: 400, priceTop: 90, priceH: 250 },    // QQQ · PRICE · VOLUME
      { chartH: 400, priceTop: 140, priceH: 260 },   // RSI · MACD · PRICE
    ]
    const ref = round(cases[0].priceH, { top: 0.2, bottom: 0.2 }, R, BARS)
    for (const c of cases) {
      const f = round(c.priceH, { top: 0.2, bottom: 0.2 }, R, BARS)
      // Fractions of Price's own pane — never of the chart, never of pane 0.
      expect(f.top).toBeCloseTo(ref.top, 6)
      expect(f.bottom).toBeCloseTo(ref.bottom, 6)
      // …and the chart height and the pane's TOP offset are not inputs at all.
      expect(c.chartH).toBeGreaterThan(0)
      expect(c.priceTop).toBeGreaterThanOrEqual(0)
    }
  })

  it('⛔ measuring PRICE’s pixels against ANOTHER pane’s height saturates the clamp', () => {
    // The shipped regression, restated: the numerator comes from Price, the
    // denominator from an 80px pane above it.
    const s = scale(320, { top: 0.2, bottom: 0.2 }, R)
    const bad = viewLockFractions(80, s.priceToCoordinate(BARS.hi), s.priceToCoordinate(BARS.lo))
    expect(bad.top).toBe(0.9)          // the clamp, reached from the wrong rectangle
    expect(bad.top + bad.bottom).toBeLessThanOrEqual(0.95)
  })
})
