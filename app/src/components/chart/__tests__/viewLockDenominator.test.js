// app/src/components/chart/__tests__/viewLockDenominator.test.js
//
// ─── THE STORED LOCK IS MEASURED AGAINST PRICE'S PANE ───────────────────────
//
// ⚰️⚰️ THE DEFECT THAT POISONED A SAVED LAYOUT. `priceToCoordinate` answers in
// the CANDLES' pane; the caller divided by `chart.paneSize().height` — the FIRST
// pane. While Price was always first those were one number. With QQQ above Price
// they are not, `yHi / paneHeight` saturates, `top` lands on the 0.9 clamp, and
// the stored lock leaves the candles ~10% of their pane. `persistViewLock`
// writes it; `vertMarginsRef` re-applies it AHEAD of the computed margins; it
// survives refresh, reconstruction and redeploys.
//
// ⭐ THE ACCEPTANCE QUESTION, STATED AS ARITHMETIC: with Price at index 1+, does
// the captured `top` describe the gesture, or does it falsely saturate?

import { describe, it, expect } from 'vitest'
import { viewLockFractions } from '../chromeGeometry'

// A realistic stack: QQQ 80px on top, PRICE 470px, VOLUME below.
const QQQ_PANE_H = 80
const PRICE_PANE_H = 470

// The member drags so the candles occupy the middle ~60% of PRICE's pane.
// Those pixel rows are returned by `priceToCoordinate` in PRICE's frame.
const yHi = 0.20 * PRICE_PANE_H     //  94px
const yLo = 0.80 * PRICE_PANE_H     // 376px

describe('⚰️⚰️ the denominator is PRICE’s pane, whatever index Price sits at', () => {
  it('⭐ the captured lock describes the gesture', () => {
    const f = viewLockFractions(PRICE_PANE_H, yHi, yLo)
    expect(f).toBeTruthy()
    expect(f.top).toBeCloseTo(0.20, 3)
    expect(f.bottom).toBeCloseTo(0.20, 3)
    // …so the candles keep ~60% of their pane.
    expect(1 - f.top - f.bottom).toBeCloseTo(0.60, 3)
  })

  it('⛔⛔ THE REGRESSION: the FIRST pane’s height saturates the clamp', () => {
    // The number `chart.paneSize()` used to return when QQQ sat above Price.
    const bad = viewLockFractions(QQQ_PANE_H, yHi, yLo)
    expect(bad).toBeTruthy()
    // `yHi / 80` is 1.175 — over 1 — so `top` pins to the 0.9 ceiling, and
    // `(80 - 376) / 80` is negative so `bottom` floors at 0. The stored lock
    // therefore reads {top: 0.9, bottom: 0} for a gesture that asked for
    // {0.2, 0.2}: it describes the CLAMP, not anything the member did.
    expect(bad.top, 'the old denominator did not saturate — rail is vacuous').toBe(0.9)
    expect(bad.bottom).toBe(0)
    // ⛔ AND THE CANDLES ARE LEFT A SLIVER, which is the production screenshot:
    // 10% of the pane, against the ~8% measured live.
    expect(1 - bad.top - bad.bottom).toBeCloseTo(0.10, 6)
  })

  it('⛔ Price at index 0, 1 and 2 all capture the SAME lock', () => {
    // The fix must be semantic, not another index special case: the stored
    // fractions depend on the gesture and on Price's own height, and on nothing
    // about where Price sits in the stack.
    const atTop = viewLockFractions(PRICE_PANE_H, yHi, yLo)
    const atMiddle = viewLockFractions(PRICE_PANE_H, yHi, yLo)
    const atBottom = viewLockFractions(PRICE_PANE_H, yHi, yLo)
    expect(atMiddle).toEqual(atTop)
    expect(atBottom).toEqual(atTop)
  })

  it('⛔ a refresh restores the same lock — the value is height-relative', () => {
    // Stored as FRACTIONS, so re-applying after a resize must not drift. The
    // same gesture on a pane of a different height yields the same fractions.
    const tall = viewLockFractions(600, 0.20 * 600, 0.80 * 600)
    const short = viewLockFractions(300, 0.20 * 300, 0.80 * 300)
    expect(short).toEqual(tall)
  })

  it('⛔ the shipped clamps are intact', () => {
    // The clamp was never the bug. An extreme but LEGITIMATE gesture still
    // clamps, because a member may genuinely compress their chart.
    const extreme = viewLockFractions(PRICE_PANE_H, 0.99 * PRICE_PANE_H, PRICE_PANE_H)
    expect(extreme.top).toBeLessThanOrEqual(0.9)
    expect(extreme.top + extreme.bottom).toBeLessThanOrEqual(0.9500001)
  })

  it('⛔ unusable input stores NOTHING rather than something wrong', () => {
    for (const h of [0, 8, -1, NaN, null, undefined]) {
      expect(viewLockFractions(h, yHi, yLo)).toBeNull()
    }
    expect(viewLockFractions(PRICE_PANE_H, NaN, yLo)).toBeNull()
    expect(viewLockFractions(PRICE_PANE_H, yHi, null)).toBeNull()
  })
})
