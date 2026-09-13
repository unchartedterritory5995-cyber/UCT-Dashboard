// D-34 — `rAtStop`: the R locked in if the stop is hit at a candidate price.
//
// The joystick's scrub readout ("stop 178.10 → 1.6R") needs a number the calc module did not have.
// Both existing R functions take an EXIT price and answer "what R did this CLOSED trade make";
// neither answers "what R is this OPEN position risking at a proposed stop". Computing that in a
// gesture handler would be a second authority over what R means — invisible, because a wrong R
// still renders as a plausible number.
//
// ⭐ The three anchors below are the SIGN-CONVENTION RAIL the owner asked for, not examples: they
// pin `rAtStop` to `trade_pnl_dollar`'s conventions, so the hub's readout and the Journal's P&L can
// never drift into disagreeing about which direction is good.

import { describe, it, expect } from 'vitest'
import { rAtStop, positionRiskDollar } from './calculations'

describe('rAtStop — the sign-convention rail', () => {
  // A long risking $2/share over 100 shares: initialRisk = $200.
  const LONG = { entry: 100, orig: 98, side: 'Long', shares: 100 }
  // A short risking $2/share over 50 shares: initialRisk = $100.
  const SHORT = { entry: 100, orig: 102, side: 'Short', shares: 50 }

  it('⛔ at the ORIGINAL stop it is exactly −1, both sides', () => {
    expect(rAtStop(LONG.entry, LONG.orig, LONG.orig, LONG.side, LONG.shares)).toBe(-1)
    expect(rAtStop(SHORT.entry, SHORT.orig, SHORT.orig, SHORT.side, SHORT.shares)).toBe(-1)
  })

  it('⛔ at ENTRY it is exactly 0 — breakeven is zero R, both sides', () => {
    expect(rAtStop(LONG.entry, LONG.orig, LONG.entry, LONG.side, LONG.shares)).toBe(0)
    expect(rAtStop(SHORT.entry, SHORT.orig, SHORT.entry, SHORT.side, SHORT.shares)).toBe(0)
  })

  it('⛔ a LONG stop raised ABOVE entry gives POSITIVE R — risk removed, profit locked', () => {
    // +$2 above entry on a $2 risk = +1R.
    expect(rAtStop(LONG.entry, LONG.orig, 102, LONG.side, LONG.shares)).toBe(1)
    expect(rAtStop(LONG.entry, LONG.orig, 103, LONG.side, LONG.shares)).toBe(1.5)
  })

  it('a SHORT stop lowered BELOW entry gives positive R — the mirror', () => {
    expect(rAtStop(SHORT.entry, SHORT.orig, 98, SHORT.side, SHORT.shares)).toBe(1)
  })

  it('a stop moved the WRONG way is more negative than −1', () => {
    // Widening a long's stop past its original increases the loss it locks in.
    expect(rAtStop(LONG.entry, LONG.orig, 96, LONG.side, LONG.shares)).toBe(-2)
  })

  it('scales with the ORIGINAL risk, not with share count', () => {
    // Same prices, 10x the shares: R is a ratio, so it is unchanged.
    expect(rAtStop(100, 98, 102, 'Long', 100)).toBe(rAtStop(100, 98, 102, 'Long', 1000))
  })

  it('⛔ returns null when risk is UNDEFINED — entry === original stop', () => {
    // Mirrors the backend's hard 422 on a planned trade at stop === entry: a position that cannot
    // say what it risks cannot be expressed in R. Callers render "—" and never a number.
    expect(rAtStop(100, 100, 105, 'Long', 100)).toBeNull()
  })

  it('returns null on any missing or non-finite input, and on an unknown side', () => {
    expect(rAtStop(undefined, 98, 102, 'Long', 100)).toBeNull()
    expect(rAtStop(100, null, 102, 'Long', 100)).toBeNull()
    expect(rAtStop(100, 98, undefined, 'Long', 100)).toBeNull()
    expect(rAtStop(100, 98, 102, 'Long', undefined)).toBeNull()
    expect(rAtStop(100, 98, 102, 'Sideways', 100)).toBeNull()
    expect(rAtStop(100, 98, NaN, 'Long', 100)).toBeNull()
  })

  it('⭐ agrees with positionRiskDollar about what one R is worth', () => {
    // The denominator here must be the same money the rest of the Journal calls "the risk". If
    // these two ever disagree, one of them is lying to the member about the same position.
    const p = { side: 'Long', entryPrice: 100, stopPrice: 98, shares: 100 }
    const oneR = positionRiskDollar(p)
    expect(oneR).toBe(200)
    // Moving the stop up by exactly one R's worth of price should read as +1R.
    const perShareR = oneR / p.shares
    expect(rAtStop(p.entryPrice, p.stopPrice, p.entryPrice + perShareR, p.side, p.shares)).toBe(1)
  })
})
