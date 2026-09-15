// app/src/components/chart/__tests__/priceAxisPin.test.js
//
// ─── THE PINNED RANGE IS CAPTURED FROM PRICE'S PANE, NOT PANE 0 ─────────────
//
// ⚰️⚰️ THE PRODUCTION FAILURE, AND IT SURVIVED EVERY EARLIER FIX. NVDA around
// 212 with the Price scale reading 200 → 880 and the candles plus all four MAs
// crushed into the bottom ~8% of their pane — on a COLD LOAD, reproducing on
// every refresh, with only ONE own pane (QQQ) above Price.
//
// ⛔ IT WAS NOT GEOMETRY AND NOT SCALE CONTAMINATION. The axis-drag capture read
// `chart.panes()[0].getHeight()` and called it the Price pane. With QQQ above
// Price that is QQQ's pane — a fraction of Price's height — so the inset pixel
// rows land near the TOP of Price's pane and `coordinateToPrice` maps them to
// prices far above the candles. The wrong range is then PINNED by the candle
// series' `autoscaleInfoProvider` (it returns the pin INSTEAD of autoscale) and
// PERSISTED by the view-lock, which is why it outlived a refresh, a redeploy and
// two correct fixes to entirely different mechanisms.
//
// ⚠️ WHY THE EARLIER RAILS COULD NOT SEE IT. They asserted `computePaneLayout`'s
// margins — pure geometry, and still correct. Nothing about a persisted pin goes
// through that function, so a green margin suite said nothing at all about this.

import { describe, it, expect } from 'vitest'
import { capturedPriceRange } from '../chromeGeometry'

// A Price pane 470px tall showing 190..240, with the shipped 30% headroom.
const PRICE_PANE_H = 470
const MARGINS = { top: 0.30, bottom: 0 }
const LO = 190, HI = 240

/** The candle series' real mapping: pixel row → price, within PRICE's pane. */
const coordinateToPrice = (y) => {
  const top = MARGINS.top * PRICE_PANE_H
  const bot = PRICE_PANE_H - MARGINS.bottom * PRICE_PANE_H
  return HI - ((y - top) / (bot - top)) * (HI - LO)
}

describe('⚰️⚰️ an axis drag pins the range the candles actually occupy', () => {
  it('⭐ captured from PRICE’s own pane, the range round-trips', () => {
    const r = capturedPriceRange(PRICE_PANE_H, MARGINS, coordinateToPrice)
    expect(r).toBeTruthy()
    expect(r.minValue).toBeCloseTo(LO, 6)
    expect(r.maxValue).toBeCloseTo(HI, 6)
  })

  it('⛔⛔ THE REGRESSION: captured from a SMALLER pane, the range runs away', () => {
    // QQQ's pane above Price — the number `panes()[0]` used to return.
    const QQQ_PANE_H = 80
    const bad = capturedPriceRange(QQQ_PANE_H, MARGINS, coordinateToPrice)
    expect(bad).toBeTruthy()
    // The pin no longer describes the candles at all: it sits far above them.
    expect(bad.maxValue).toBeGreaterThan(HI)
    const span = bad.maxValue - bad.minValue
    expect(span, 'the wrong pane height produced a sane span — rail is vacuous')
      .toBeLessThan(HI - LO)
    // ⛔ AND THE CANDLES WOULD OCCUPY A SLIVER OF IT, which is the screenshot.
    // (A pin ABOVE the data pushes the candles off the bottom of the scale.)
    expect(bad.minValue).toBeGreaterThan(LO)
  })

  it('⛔ the two disagree — which is the whole defect', () => {
    const good = capturedPriceRange(PRICE_PANE_H, MARGINS, coordinateToPrice)
    const bad = capturedPriceRange(80, MARGINS, coordinateToPrice)
    expect(bad.maxValue).not.toBeCloseTo(good.maxValue, 3)
  })

  it('⛔ unusable inputs pin NOTHING rather than something wrong', () => {
    // A failed capture must leave the chart on autoscale. Pinning a bad range is
    // worse than not pinning, because the pin persists.
    for (const h of [0, -1, NaN, null, undefined]) {
      expect(capturedPriceRange(h, MARGINS, coordinateToPrice)).toBeNull()
    }
    expect(capturedPriceRange(PRICE_PANE_H, MARGINS, null)).toBeNull()
    expect(capturedPriceRange(PRICE_PANE_H, MARGINS, () => NaN)).toBeNull()
    // an inverted mapping is refused too
    expect(capturedPriceRange(PRICE_PANE_H, MARGINS, (y) => y)).toBeNull()
  })

  it('⛔ absent margins degrade to the full pane, not to a throw', () => {
    expect(capturedPriceRange(PRICE_PANE_H, null, coordinateToPrice)).toBeTruthy()
  })
})
