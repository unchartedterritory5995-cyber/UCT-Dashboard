import { describe, it, expect } from 'vitest'
import {
  EPSILON,
  safeDivide,
  clampNonNegative,
  roundShares,
  activeStop,
  longPnlDollar,
  longPnlPercent,
  longRiskDollar,
  longHeatDollar,
  longStopDistancePercent,
  longBeSellShares,
  shortPnlDollar,
  shortPnlPercent,
  shortRiskDollar,
  shortHeatDollar,
  shortStopDistancePercent,
  shortBeSellShares,
  positionPnlDollar,
  positionRiskDollar,
  positionInvestedPercent,
  positionRiskAccountPercent,
  positionHeatAccountPercent,
  portfolioAggregates,
  tradePnlDollar,
  tradePnlPercent,
  tradeRMultiple,
  holdDays,
  tradeResult,
  summaryStats,
  brokerLiveEquity,
  currentPriceFor,
  brokerLiveSummary,
} from './calculations.js'

// ───────────────────────────────────────────────────────────────────────────
// §14.1 Helpers
// ───────────────────────────────────────────────────────────────────────────

describe('safeDivide', () => {
  it('returns a/b for non-zero b', () => {
    expect(safeDivide(10, 2)).toBe(5)
  })
  it('returns null for zero b', () => {
    expect(safeDivide(10, 0)).toBeNull()
  })
  it('returns null for near-zero b (within EPSILON)', () => {
    expect(safeDivide(10, EPSILON / 2)).toBeNull()
  })
  it('handles negative numerator', () => {
    expect(safeDivide(-10, 2)).toBe(-5)
  })
})

describe('clampNonNegative', () => {
  it('clamps negatives to 0', () => {
    expect(clampNonNegative(-5)).toBe(0)
  })
  it('passes positives through', () => {
    expect(clampNonNegative(5)).toBe(5)
  })
  it('passes zero through', () => {
    expect(clampNonNegative(0)).toBe(0)
  })
})

describe('roundShares', () => {
  it('rounds to 4 dp when fractional allowed', () => {
    expect(roundShares(0.123456789, true)).toBe(0.1235)
  })
  it('rounds to integer when fractional not allowed', () => {
    expect(roundShares(54.72, false)).toBe(55)
  })
  it('handles the YSS B/E Sell reference case (54.72 → 55)', () => {
    expect(roundShares(54.72, false)).toBe(55)
  })
  it('rounds .5 to nearest (half-to-even semantics not required)', () => {
    // JS Math.round: .5 rounds UP, not half-to-even. This is our contract.
    expect(roundShares(0.5, false)).toBe(1)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// activeStop
// ───────────────────────────────────────────────────────────────────────────

describe('activeStop', () => {
  it('returns stopPrice when raiseToBreakeven is false', () => {
    const p = { stopPrice: 27.9, breakevenStop: 29.57, raiseToBreakeven: false }
    expect(activeStop(p)).toBe(27.9)
  })
  it('returns breakevenStop when raiseToBreakeven is true', () => {
    const p = { stopPrice: 27.9, breakevenStop: 29.57, raiseToBreakeven: true }
    expect(activeStop(p)).toBe(29.57)
  })
  it('falls back to stopPrice when raiseToBreakeven is true but breakevenStop is null', () => {
    const p = { stopPrice: 27.9, breakevenStop: null, raiseToBreakeven: true }
    expect(activeStop(p)).toBe(27.9)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// §14.7 MANDATORY VERIFICATION — YSS Long reference
//
// Open Position: YSS, Long, 250 shares @ $29.57, stop $27.90, current
// $35.53, accountSize $100,000, raiseToBreakeven = false.
//
// Expected:
//   Value (row): $8,882.50
//   Invested %: 8.88% → display 8.9%
//   Risk $: $417.50
//   Risk/Acct: 0.4175%
//   Heat $: $1,907.50
//   Heat %: 1.9075%
//   Unrealized $: $1,490.00
//   P&L %: 20.1556%
//   Stop Dist %: 21.4748%
//   B/E Sell: 54.72 → round → 55 shares (22%)
// ───────────────────────────────────────────────────────────────────────────

describe('YSS Long reference position (§14.7)', () => {
  const yss = {
    id: 'yss-1',
    userId: 'u1',
    symbol: 'YSS',
    side: /** @type {'Long'} */ ('Long'),
    entryDate: '2026-04-09T00:00:00Z',
    shares: 250,
    originalShares: 250,
    entryPrice: 29.57,
    stopPrice: 27.9,
    breakevenStop: null,
    raiseToBreakeven: false,
    setup: null,
    notes: null,
    contextAtEntry: /** @type {any} */ ({}),
    createdAt: '2026-04-09T00:00:00Z',
    updatedAt: '2026-04-09T00:00:00Z',
    closedAt: null,
  }
  const current = 35.53
  const accountSize = 100_000

  it('P&L $ = $1,490.00', () => {
    expect(longPnlDollar(yss, current)).toBeCloseTo(1490.0, 2)
  })

  it('P&L % = 20.1556%', () => {
    expect(longPnlPercent(yss, current) * 100).toBeCloseTo(20.1556, 3)
  })

  it('Risk $ = $417.50', () => {
    expect(longRiskDollar(yss)).toBeCloseTo(417.5, 2)
  })

  it('Heat $ = $1,907.50', () => {
    expect(longHeatDollar(yss, current)).toBeCloseTo(1907.5, 2)
  })

  it('Stop Dist % = 21.4748%', () => {
    expect(longStopDistancePercent(yss, current) * 100).toBeCloseTo(21.4748, 3)
  })

  it('row Value = $8,882.50', () => {
    expect(current * yss.shares).toBeCloseTo(8882.5, 2)
  })

  it('Invested % = 8.8825%', () => {
    expect(positionInvestedPercent(yss, current, accountSize) * 100).toBeCloseTo(
      8.8825,
      3,
    )
  })

  it('Risk/Acct = 0.4175%', () => {
    expect(positionRiskAccountPercent(yss, accountSize) * 100).toBeCloseTo(
      0.4175,
      4,
    )
  })

  it('Heat/Acct = 1.9075%', () => {
    expect(positionHeatAccountPercent(yss, current, accountSize) * 100).toBeCloseTo(
      1.9075,
      3,
    )
  })

  it('B/E Sell raw = 54.72', () => {
    // raw float before rounding
    const denom = current - yss.stopPrice // 35.53 - 27.90 = 7.63
    const raw = longRiskDollar(yss) / denom
    expect(raw).toBeCloseTo(54.7182, 3)
  })

  it('B/E Sell rounded (non-fractional) = 55 shares', () => {
    expect(longBeSellShares(yss, current, false)).toBe(55)
  })

  it('B/E Sell rounds with round(), not ceil() — reference is 54.72 → 55 not 55 (both agree here, but confirm intent)', () => {
    // Mutate to a case where round ≠ ceil: raw 54.2 → round=54, ceil=55
    const denom = 10
    const wrapper = {
      ...yss,
      stopPrice: 25,
      shares: 10, // risk = (30-25)*10 = 50 → raw = 50/10 = 5
    }
    // Set entry/current so raw lands at exactly 54.2
    // risk = (30-24.58)*10 = 54.2; denom = (35.53 - 24.58) = 10.95
    wrapper.entryPrice = 30
    wrapper.stopPrice = 24.58
    wrapper.shares = 10 // risk = 54.2
    const raw = longRiskDollar(wrapper) / (current - wrapper.stopPrice)
    // We just need a raw that round() and ceil() disagree on.
    // Simpler: test roundShares directly with a known case where they'd differ.
    expect(roundShares(54.2, false)).toBe(54) // round
    expect(Math.ceil(54.2)).toBe(55) // ceil differs — confirms our choice
    // Keep the wrapper variable referenced to avoid unused lint error
    expect(raw).toBeGreaterThan(0)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// YSS Long — raise-to-breakeven scenario
// ───────────────────────────────────────────────────────────────────────────

describe('YSS Long with raise-to-breakeven (live risk uses breakevenStop, trade R-multiple uses originalStop)', () => {
  const yss = {
    id: 'yss-be',
    userId: 'u1',
    symbol: 'YSS',
    side: /** @type {'Long'} */ ('Long'),
    entryDate: '2026-04-09T00:00:00Z',
    shares: 250,
    originalShares: 250,
    entryPrice: 29.57,
    stopPrice: 27.9, // original stop — frozen
    breakevenStop: 29.57, // raised to entry
    raiseToBreakeven: true,
    setup: null,
    notes: null,
    contextAtEntry: /** @type {any} */ ({}),
    createdAt: '2026-04-09T00:00:00Z',
    updatedAt: '2026-04-09T00:00:00Z',
    closedAt: null,
  }

  it('activeStop returns breakevenStop, not stopPrice', () => {
    expect(activeStop(yss)).toBe(29.57)
  })

  it('live Risk $ uses breakevenStop (risk is 0 when stop raised to entry)', () => {
    expect(longRiskDollar(yss)).toBe(0)
  })

  it('live Heat $ uses breakevenStop', () => {
    expect(longHeatDollar(yss, 35.53)).toBeCloseTo((35.53 - 29.57) * 250, 2)
  })

  it('R-multiple on a closed Trade still uses originalStop — not breakevenStop', () => {
    // Mirrors §14.7 partial-close with partial at $34.50; originalStop $27.90
    const trade = {
      id: 't1',
      userId: 'u1',
      positionId: 'yss-be',
      symbol: 'YSS',
      side: /** @type {'Long'} */ ('Long'),
      shares: 100,
      entryPrice: 29.57,
      entryDate: '2026-04-09T00:00:00Z',
      exitPrice: 34.5,
      exitDate: '2026-04-10T00:00:00Z',
      originalStop: 27.9, // ← frozen at position creation
      setup: null,
      notes: null,
      pnlDollar: 0, // filled in by caller; tested elsewhere
      pnlPercent: 0,
      rMultiple: null,
      holdDays: 0,
      result: /** @type {'Win'} */ ('Win'),
      contextAtEntry: /** @type {any} */ ({}),
      createdAt: '2026-04-10T00:00:00Z',
    }
    expect(tradeRMultiple(trade)).toBeCloseTo(2.9521, 3)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Long position dispatcher sanity
// ───────────────────────────────────────────────────────────────────────────

describe('positionPnlDollar dispatches by side', () => {
  const p = {
    id: 'x',
    userId: 'u',
    symbol: 'X',
    side: /** @type {'Long'} */ ('Long'),
    entryDate: '2026-01-01',
    shares: 10,
    originalShares: 10,
    entryPrice: 100,
    stopPrice: 95,
    breakevenStop: null,
    raiseToBreakeven: false,
    setup: null,
    notes: null,
    contextAtEntry: /** @type {any} */ ({}),
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    closedAt: null,
  }

  it('long: +$100 when up $10', () => {
    expect(positionPnlDollar(p, 110)).toBe(100)
  })
  it('short: +$100 when down $10', () => {
    const short = { ...p, side: /** @type {'Short'} */ ('Short'), stopPrice: 105 }
    expect(positionPnlDollar(short, 90)).toBe(100)
  })
  it('long risk: $50 when stop 5 below entry on 10 shares', () => {
    expect(positionRiskDollar(p)).toBe(50)
  })
  it('short risk: $50 when stop 5 above entry on 10 shares', () => {
    const short = { ...p, side: /** @type {'Short'} */ ('Short'), stopPrice: 105 }
    expect(positionRiskDollar(short)).toBe(50)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Short-side mirrored YSS test
// ───────────────────────────────────────────────────────────────────────────

describe('Short-side YSS-mirror: 250 short @ $29.57, stop $31.24 (1.67 above), current $23.61', () => {
  // Mirror: long had entry 29.57, stop 27.90 (1.67 below), current 35.53 (5.96 above)
  // Short: entry 29.57, stop 29.57 + 1.67 = 31.24, current 29.57 - 5.96 = 23.61
  const p = {
    id: 'yss-s',
    userId: 'u',
    symbol: 'YSS',
    side: /** @type {'Short'} */ ('Short'),
    entryDate: '2026-04-09T00:00:00Z',
    shares: 250,
    originalShares: 250,
    entryPrice: 29.57,
    stopPrice: 31.24,
    breakevenStop: null,
    raiseToBreakeven: false,
    setup: null,
    notes: null,
    contextAtEntry: /** @type {any} */ ({}),
    createdAt: '2026-04-09T00:00:00Z',
    updatedAt: '2026-04-09T00:00:00Z',
    closedAt: null,
  }
  const current = 23.61

  it('P&L $ = $1,490.00 (price fell $5.96 × 250)', () => {
    expect(shortPnlDollar(p, current)).toBeCloseTo(1490.0, 2)
  })

  it('Risk $ = $417.50 (stop 1.67 above × 250)', () => {
    expect(shortRiskDollar(p)).toBeCloseTo(417.5, 2)
  })

  it('Heat $ = $1,907.50 (distance stop→current × 250)', () => {
    expect(shortHeatDollar(p, current)).toBeCloseTo(1907.5, 2)
  })

  it('Stop Dist % uses (stop − current) / current', () => {
    expect(shortStopDistancePercent(p, current) * 100).toBeCloseTo(
      ((31.24 - 23.61) / 23.61) * 100,
      4,
    )
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Edge cases from §14.5
// ───────────────────────────────────────────────────────────────────────────

describe('edge case: activeStop ≥ currentPrice (long)', () => {
  const p = {
    id: 'u',
    userId: 'u',
    symbol: 'U',
    side: /** @type {'Long'} */ ('Long'),
    entryDate: '2026-01-01',
    shares: 10,
    originalShares: 10,
    entryPrice: 100,
    stopPrice: 100, // stop = current
    breakevenStop: null,
    raiseToBreakeven: false,
    setup: null,
    notes: null,
    contextAtEntry: /** @type {any} */ ({}),
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    closedAt: null,
  }

  it('heat clamped to 0 when stop ≥ current', () => {
    expect(longHeatDollar(p, 100)).toBe(0)
  })

  it('B/E Sell returns null when denom ≤ EPSILON', () => {
    expect(longBeSellShares(p, 100, false)).toBeNull()
  })
})

describe('edge case: entryPrice == originalStop → R-multiple null', () => {
  /** @type {import('./types.js').Trade} */
  const t = {
    id: 't',
    userId: 'u',
    positionId: 'p',
    symbol: 'X',
    side: 'Long',
    shares: 10,
    entryPrice: 100,
    entryDate: '2026-01-01',
    exitPrice: 110,
    exitDate: '2026-01-02',
    originalStop: 100, // equal to entry
    setup: null,
    notes: null,
    pnlDollar: 100,
    pnlPercent: 0.1,
    rMultiple: null,
    holdDays: 1,
    result: 'Win',
    contextAtEntry: /** @type {any} */ ({}),
    createdAt: '2026-01-02',
  }

  it('rMultiple returns null', () => {
    expect(tradeRMultiple(t)).toBeNull()
  })
})

describe('edge case: negative computed Risk clamps to 0', () => {
  // Long with stop ABOVE entry (bad data — shouldn't happen, but must clamp)
  const bad = {
    id: 'bad',
    userId: 'u',
    symbol: 'X',
    side: /** @type {'Long'} */ ('Long'),
    entryDate: '2026-01-01',
    shares: 10,
    originalShares: 10,
    entryPrice: 100,
    stopPrice: 110, // bad — stop above entry for a long
    breakevenStop: null,
    raiseToBreakeven: false,
    setup: null,
    notes: null,
    contextAtEntry: /** @type {any} */ ({}),
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    closedAt: null,
  }
  it('risk clamps to 0', () => {
    expect(longRiskDollar(bad)).toBe(0)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Trade-level: §14.7 partial close
// ───────────────────────────────────────────────────────────────────────────

describe('YSS partial close (§14.7): 100 shares at $34.50 on 04/10/26, entry 04/09/26', () => {
  /** @type {import('./types.js').Trade} */
  const t = {
    id: 'yss-p',
    userId: 'u',
    positionId: 'yss-1',
    symbol: 'YSS',
    side: 'Long',
    shares: 100,
    entryPrice: 29.57,
    entryDate: '2026-04-09T00:00:00Z',
    exitPrice: 34.5,
    exitDate: '2026-04-10T00:00:00Z',
    originalStop: 27.9,
    setup: null,
    notes: null,
    pnlDollar: 0,
    pnlPercent: 0,
    rMultiple: null,
    holdDays: 0,
    result: 'Win',
    contextAtEntry: /** @type {any} */ ({}),
    createdAt: '2026-04-10T00:00:00Z',
  }
  const settings = {
    id: 's',
    userId: 'u',
    accountSize: 100_000,
    defaultStop: /** @type {any} */ ({ mode: 'custom' }),
    positionClosing: /** @type {'FIFO'} */ ('FIFO'),
    breakevenRange: { enabled: true, unit: /** @type {'$'} */ ('$'), value: 20 },
    setups: [],
    journalColumns: { marketNavIndex: 'NYA', breadthMetric: 'NASI RSI' },
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  }

  it('pnlDollar = $493.00', () => {
    expect(tradePnlDollar(t)).toBeCloseTo(493.0, 2)
  })
  it('pnlPercent = +16.6723%', () => {
    expect(tradePnlPercent(t) * 100).toBeCloseTo(16.6723, 3)
  })
  it('rMultiple = 2.9521 (display → 3.0R)', () => {
    expect(tradeRMultiple(t)).toBeCloseTo(2.9521, 3)
  })
  it('holdDays = 1', () => {
    expect(holdDays(t.entryDate, t.exitDate)).toBe(1)
  })
  it('result (BE threshold $20) = Win', () => {
    expect(tradeResult(t, settings)).toBe('Win')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// §14.5 result(): Win/Loss/BE boundaries
// ───────────────────────────────────────────────────────────────────────────

describe('tradeResult — BE boundary semantics', () => {
  const makeTrade = (pnlDollar) => ({
    id: 't',
    userId: 'u',
    positionId: 'p',
    symbol: 'X',
    side: /** @type {'Long'} */ ('Long'),
    shares: 10,
    entryPrice: 100,
    entryDate: '2026-01-01',
    exitPrice: 100 + pnlDollar / 10, // so (exit-entry)*shares = pnlDollar
    exitDate: '2026-01-02',
    originalStop: 95,
    setup: null,
    notes: null,
    pnlDollar,
    pnlPercent: 0,
    rMultiple: null,
    holdDays: 1,
    result: /** @type {'Win'} */ ('Win'),
    contextAtEntry: /** @type {any} */ ({}),
    createdAt: '2026-01-02',
  })

  const disabled = {
    id: 's',
    userId: 'u',
    accountSize: 100_000,
    defaultStop: /** @type {any} */ ({ mode: 'custom' }),
    positionClosing: /** @type {'FIFO'} */ ('FIFO'),
    breakevenRange: { enabled: false, unit: /** @type {'$'} */ ('$'), value: 0 },
    setups: [],
    journalColumns: { marketNavIndex: 'NYA', breadthMetric: 'NASI RSI' },
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  }
  const enabled$ = {
    ...disabled,
    breakevenRange: { enabled: true, unit: /** @type {'$'} */ ('$'), value: 20 },
  }
  const enabledPct = {
    ...disabled,
    // 0.1% of (100 * 10) = $1 threshold
    breakevenRange: { enabled: true, unit: /** @type {'%'} */ ('%'), value: 0.1 },
  }

  it('disabled: P&L > 0 → Win', () =>
    expect(tradeResult(makeTrade(1), disabled)).toBe('Win'))
  it('disabled: P&L < 0 → Loss', () =>
    expect(tradeResult(makeTrade(-1), disabled)).toBe('Loss'))
  it('disabled: P&L exactly 0 → BE (inclusive of zero)', () =>
    expect(tradeResult(makeTrade(0), disabled)).toBe('BE'))

  it('enabled $20: within ±$20 → BE', () =>
    expect(tradeResult(makeTrade(15), enabled$)).toBe('BE'))
  it('enabled $20: at exactly ±$20 → BE (inclusive)', () =>
    expect(tradeResult(makeTrade(20), enabled$)).toBe('BE'))
  it('enabled $20: at $20.01 → Win', () =>
    expect(tradeResult(makeTrade(20.01), enabled$)).toBe('Win'))
  it('enabled $20: at -$20.01 → Loss', () =>
    expect(tradeResult(makeTrade(-20.01), enabled$)).toBe('Loss'))

  it('enabled % (0.1% of notional = $1): ±$1 → BE', () =>
    expect(tradeResult(makeTrade(0.5), enabledPct)).toBe('BE'))
  it('enabled %: $2 → Win', () =>
    expect(tradeResult(makeTrade(2), enabledPct)).toBe('Win'))
})

// ───────────────────────────────────────────────────────────────────────────
// holdDays — UTC / calendar days
// ───────────────────────────────────────────────────────────────────────────

describe('holdDays', () => {
  it('same day → 0', () => {
    expect(holdDays('2026-04-09T09:30:00Z', '2026-04-09T15:30:00Z')).toBe(0)
  })
  it('next day → 1', () => {
    expect(holdDays('2026-04-09T00:00:00Z', '2026-04-10T00:00:00Z')).toBe(1)
  })
  it('uses UTC (no DST drift)', () => {
    // Spring-forward: 2026-03-08 is US DST start
    expect(holdDays('2026-03-07T00:00:00Z', '2026-03-09T00:00:00Z')).toBe(2)
  })
  it('floors partial days', () => {
    expect(holdDays('2026-04-09T00:00:00Z', '2026-04-10T23:59:00Z')).toBe(1)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Portfolio aggregates
// ───────────────────────────────────────────────────────────────────────────

describe('portfolioAggregates', () => {
  const mkP = (overrides) => ({
    id: overrides.id || '1',
    userId: 'u',
    symbol: overrides.symbol || 'X',
    side: overrides.side || /** @type {'Long'} */ ('Long'),
    entryDate: '2026-01-01',
    shares: overrides.shares ?? 10,
    originalShares: overrides.shares ?? 10,
    entryPrice: overrides.entryPrice ?? 100,
    stopPrice: overrides.stopPrice ?? 95,
    breakevenStop: null,
    raiseToBreakeven: false,
    setup: null,
    notes: null,
    contextAtEntry: /** @type {any} */ ({}),
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    closedAt: null,
  })

  it('empty portfolio', () => {
    const agg = portfolioAggregates([], {}, 100_000)
    expect(agg.count).toBe(0)
    expect(agg.value).toBe(0)
    expect(agg.unrealized).toBe(0)
    expect(agg.risk).toBe(0)
    expect(agg.heat).toBe(0)
  })

  it('single long at profit', () => {
    const positions = [mkP({ symbol: 'A', shares: 10, entryPrice: 100, stopPrice: 95 })]
    const prices = { A: 110 }
    const agg = portfolioAggregates(positions, prices, 100_000)
    expect(agg.value).toBe(1100)
    expect(agg.unrealized).toBe(100)
    expect(agg.risk).toBe(50)
    expect(agg.heat).toBe(150)
    expect(agg.invested * 100).toBeCloseTo(1.1, 4)
  })

  it('skips positions with missing price (contributes 0 to sums)', () => {
    const positions = [
      mkP({ symbol: 'A', shares: 10, entryPrice: 100, stopPrice: 95 }),
      mkP({ symbol: 'B', shares: 5, entryPrice: 50, stopPrice: 48 }),
    ]
    const prices = { A: 110 } // B has no price
    const agg = portfolioAggregates(positions, prices, 100_000)
    expect(agg.count).toBe(2) // count still reflects both
    expect(agg.value).toBe(1100) // but sums only include A
    expect(agg.risk).toBe(50)
  })

  it('long + short mix', () => {
    const positions = [
      mkP({ symbol: 'L', side: 'Long', shares: 10, entryPrice: 100, stopPrice: 95 }),
      mkP({ symbol: 'S', side: 'Short', shares: 10, entryPrice: 50, stopPrice: 52 }),
    ]
    const prices = { L: 110, S: 48 }
    const agg = portfolioAggregates(positions, prices, 100_000)
    expect(agg.unrealized).toBe(100 + 20) // long +100, short +20
    expect(agg.risk).toBe(50 + 20) // long 50, short 20
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Summary stats
// ───────────────────────────────────────────────────────────────────────────

describe('summaryStats', () => {
  const mkT = (result, pnlDollar, pnlPercent = 0, holdDaysN = 1) => ({
    id: Math.random().toString(),
    userId: 'u',
    positionId: 'p',
    symbol: 'X',
    side: /** @type {'Long'} */ ('Long'),
    shares: 10,
    entryPrice: 100,
    entryDate: '2026-01-01',
    exitPrice: 100 + pnlDollar / 10,
    exitDate: '2026-01-02',
    originalStop: 95,
    setup: null,
    notes: null,
    pnlDollar,
    pnlPercent,
    rMultiple: null,
    holdDays: holdDaysN,
    result,
    contextAtEntry: /** @type {any} */ ({}),
    createdAt: '2026-01-02',
  })

  it('empty trade list', () => {
    const s = summaryStats([])
    expect(s.totalTrades).toBe(0)
    expect(s.winRate).toBeNull()
    expect(s.profitFactor).toBe(0)
  })

  it('Profit Factor = 0 when no wins and no losses', () => {
    const s = summaryStats([mkT('BE', 5)])
    expect(s.profitFactor).toBe(0)
  })

  it('Profit Factor = ∞ when wins > 0 and losses = 0', () => {
    const s = summaryStats([mkT('Win', 100), mkT('Win', 50)])
    expect(s.profitFactor).toBe(Infinity)
  })

  it('Profit Factor = Σ|wins| / Σ|losses|', () => {
    // wins: 100 + 50 = 150; losses: -60 → PF = 150 / 60 = 2.5
    const s = summaryStats([mkT('Win', 100), mkT('Win', 50), mkT('Loss', -60)])
    expect(s.profitFactor).toBeCloseTo(2.5, 4)
  })

  it('BE trades excluded from winRate denominator', () => {
    const s = summaryStats([
      mkT('Win', 10),
      mkT('Win', 10),
      mkT('Loss', -10),
      mkT('BE', 0),
      mkT('BE', 0),
    ])
    // Wins: 2, Losses: 1, BE: 2 → winRate = 2/3
    expect(s.winRate).toBeCloseTo(66.6667, 3)
  })

  it('BE trades excluded from avgWinPercent and avgLossPercent', () => {
    const s = summaryStats([
      mkT('Win', 10, 0.05),
      mkT('Loss', -10, -0.05),
      mkT('BE', 0, 0.001), // noise — must not pull avgs
    ])
    expect(s.avgWinPercent).toBeCloseTo(0.05, 5)
    expect(s.avgLossPercent).toBeCloseTo(-0.05, 5)
  })

  it('avgPnlPerTrade includes BE trades', () => {
    const s = summaryStats([mkT('Win', 100), mkT('Loss', -60), mkT('BE', 0)])
    // (100 + -60 + 0) / 3 = 13.333
    expect(s.avgPnlPerTrade).toBeCloseTo(13.3333, 3)
  })

  it('BE does NOT break a Win streak', () => {
    // W W BE W → maxConsecWins = 3 (BE skipped)
    const s = summaryStats([
      mkT('Win', 10),
      mkT('Win', 10),
      mkT('BE', 0),
      mkT('Win', 10),
    ])
    expect(s.maxConsecWins).toBe(3)
    expect(s.maxConsecLosses).toBe(0)
  })

  it('BE does NOT break a Loss streak', () => {
    const s = summaryStats([
      mkT('Loss', -10),
      mkT('Loss', -10),
      mkT('BE', 0),
      mkT('Loss', -10),
    ])
    expect(s.maxConsecLosses).toBe(3)
  })

  it('Win resets the Loss run and vice versa', () => {
    const s = summaryStats([
      mkT('Win', 10),
      mkT('Win', 10),
      mkT('Loss', -10),
      mkT('Loss', -10),
      mkT('Loss', -10),
      mkT('Win', 10),
    ])
    expect(s.maxConsecWins).toBe(2)
    expect(s.maxConsecLosses).toBe(3)
  })

  it('largestWin and largestLoss', () => {
    const s = summaryStats([mkT('Win', 100), mkT('Win', 250), mkT('Loss', -80)])
    expect(s.largestWin).toBe(250)
    expect(s.largestLoss).toBe(-80)
  })
})

describe('brokerLiveEquity', () => {
  const acct = { brokerTotalEquity: 10000 }

  it('reconciles to brokerTotalEquity when live === broker mark', () => {
    const positions = [{ symbol: 'AAPL', shares: 10, side: 'Long', brokerPrice: 100 }]
    expect(brokerLiveEquity(acct, positions, { AAPL: 100 }))
      .toEqual({ liveValue: 10000, liveDelta: 0 })
  })

  it('adds signed drift for a long position', () => {
    const positions = [{ symbol: 'AAPL', shares: 10, side: 'Long', brokerPrice: 100 }]
    const r = brokerLiveEquity(acct, positions, { AAPL: 102 })
    expect(r.liveDelta).toBe(20)        // (102 - 100) * 10
    expect(r.liveValue).toBe(10020)
  })

  it('flips sign for a short position', () => {
    const positions = [{ symbol: 'TSLA', shares: 5, side: 'Short', brokerPrice: 200 }]
    const r = brokerLiveEquity(acct, positions, { TSLA: 210 })
    expect(r.liveDelta).toBe(-50)       // (210 - 200) * -5
    expect(r.liveValue).toBe(9950)
  })

  it('ignores options and missing-price positions', () => {
    const positions = [
      { symbol: 'NVDA Oct $5C', shares: 2, side: 'Long', brokerPrice: 3, isOption: true },
      { symbol: 'MSFT', shares: 4, side: 'Long' },                 // no brokerPrice
      { symbol: 'AMD', shares: 1, side: 'Long', brokerPrice: 50 }, // no live price
    ]
    expect(brokerLiveEquity(acct, positions, { MSFT: 400 }))
      .toEqual({ liveValue: 10000, liveDelta: 0 })
  })

  it('returns null liveValue when brokerTotalEquity is missing', () => {
    expect(brokerLiveEquity({ brokerTotalEquity: null }, [], {}))
      .toEqual({ liveValue: null, liveDelta: 0 })
  })
})

describe('currentPriceFor', () => {
  it('returns the live tick price when present', () => {
    const p = { symbol: 'AAPL', brokerPrice: 100 }
    expect(currentPriceFor(p, { AAPL: { price: 105 } })).toBe(105)
  })

  it('falls back to the broker mark when there is no live price', () => {
    const p = { symbol: 'AAPL', brokerPrice: 100 }
    expect(currentPriceFor(p, {})).toBe(100)
    expect(currentPriceFor(p, { AAPL: {} })).toBe(100)
    expect(currentPriceFor(p, { AAPL: { price: null } })).toBe(100)
  })

  it('returns undefined when neither a live price nor a broker mark exists', () => {
    expect(currentPriceFor({ symbol: 'AAPL' }, {})).toBeUndefined()
    expect(currentPriceFor({ symbol: 'AAPL' }, { AAPL: {} })).toBeUndefined()
  })

  it('ignores a non-finite live price and uses the broker mark', () => {
    const p = { symbol: 'AAPL', brokerPrice: 100 }
    expect(currentPriceFor(p, { AAPL: { price: Number.NaN } })).toBe(100)
  })
})

describe('brokerLiveSummary', () => {
  it('net-liq = cash + live market value of holdings (matches the broker number)', () => {
    // cash −18,000; DELL 10 @ 434.75 = 4347.50; RXT 800 @ 6.85 = 5480; CRMG 1000 @ 4.49 = 4490
    // option value 990 → MV = 15307.50; netLiq = −2692.50... use simpler numbers:
    const acct = { brokerCash: 2000 }
    const positions = [
      { symbol: 'AAPL', side: 'Long', shares: 10, brokerPrice: 90 },
      { symbol: 'TSLA', side: 'Short', shares: 5, brokerPrice: 200 },
    ]
    const opts = [{ brokerCurrentValue: 300 }]
    const prices = { AAPL: { price: 100, prev_close: 100 }, TSLA: { price: 210, prev_close: 210 } }
    const r = brokerLiveSummary(acct, positions, opts, prices, '2026-07-01')
    // MV = 100*10 + (-5)*210 + 300 = 1000 − 1050 + 300 = 250; netLiq = 2000 + 250 = 2250
    expect(r.marketValue).toBe(250)
    expect(r.netLiq).toBe(2250)
  })

  it('Today = Σ signedShares × (live − prevClose), % vs previous-close equity', () => {
    const acct = { brokerCash: 0 }
    // one long: 10 sh, prevClose 100, live 90 → today = 10*(90−100) = −100
    const positions = [{ symbol: 'AAPL', side: 'Long', shares: 10, brokerPrice: 90 }]
    const prices = { AAPL: { price: 90, prev_close: 100 } }
    const r = brokerLiveSummary(acct, positions, [], prices, '2026-07-01')
    expect(r.netLiq).toBe(900)          // 0 + 90*10
    expect(r.today).toBe(-100)
    // todayPct = -100 / (900 − (−100)) = -100/1000 = -0.10
    expect(r.todayPct).toBeCloseTo(-0.1, 6)
  })

  it('derives prevClose from change_pct when prev_close is absent from the feed', () => {
    const acct = { brokerCash: 0 }
    // live 90, change_pct −10 → derived prevClose = 90/(1−0.10) = 100 → today = 10*(90−100) = −100
    const positions = [{ symbol: 'AAPL', side: 'Long', shares: 10, brokerPrice: 90 }]
    const prices = { AAPL: { price: 90, change_pct: -10 } }   // NO prev_close
    const r = brokerLiveSummary(acct, positions, [], prices, '2026-07-01')
    expect(r.today).toBeCloseTo(-100, 4)
  })

  it('a position opened TODAY measures Today from entry (fill), not prev close', () => {
    const acct = { brokerCash: 0 }
    // bought today at 95, now 98 → today = 3*... use shares 4: 4*(98−95)=12 (NOT 4*(98−prevClose))
    const positions = [
      { symbol: 'NVDA', side: 'Long', shares: 4, brokerPrice: 95, entryPrice: 95, entryDate: '2026-07-01' },
    ]
    const prices = { NVDA: { price: 98, prev_close: 80 } }
    const r = brokerLiveSummary(acct, positions, [], prices, '2026-07-01')
    expect(r.today).toBe(12)            // 4*(98−95), NOT 4*(98−80)=72
  })

  it('short position flips today sign; options contribute 0 to Today', () => {
    const acct = { brokerCash: 0 }
    const positions = [{ symbol: 'TSLA', side: 'Short', shares: 5, brokerPrice: 200 }]
    const prices = { TSLA: { price: 210, prev_close: 200 } }
    const opts = [{ brokerCurrentValue: 500 }]
    const r = brokerLiveSummary(acct, positions, opts, prices, '2026-07-01')
    expect(r.today).toBe(-50)           // short up 10 → −5*(210−200)
    expect(r.marketValue).toBe(-5 * 210 + 500) // −550
  })

  it('missing live price → uses broker mark for value, contributes 0 to Today', () => {
    const acct = { brokerCash: 1000 }
    const positions = [{ symbol: 'BE', side: 'Long', shares: 5, brokerPrice: 100 }]
    const r = brokerLiveSummary(acct, positions, [], {}, '2026-07-01')
    expect(r.marketValue).toBe(500)     // 100*5 via broker mark
    expect(r.today).toBe(0)             // no live tick → no Today
    expect(r.netLiq).toBe(1500)
  })

  it('null netLiq when cash is missing (caller falls back to broker total)', () => {
    const r = brokerLiveSummary({ brokerCash: null }, [{ symbol: 'X', side: 'Long', shares: 1, brokerPrice: 10 }], [], { X: { price: 10 } }, '2026-07-01')
    expect(r.netLiq).toBeNull()
    expect(r.marketValue).toBe(10)
  })
})

// ── extendedSessionSplit (RH After-Hours/Overnight hero row) ────────────────
import { extendedSessionSplit } from './calculations.js'

describe('extendedSessionSplit', () => {
  const TODAY = '2026-07-02'
  const long = { symbol: 'AAPL', side: 'Long', shares: 10, entryPrice: 100, entryDate: '2026-06-01' }
  const short = { symbol: 'TSLA', side: 'Short', shares: 5, entryPrice: 200, entryDate: '2026-06-01' }

  it('returns null during regular session / closed (no ext_session)', () => {
    expect(extendedSessionSplit([long], {
      AAPL: { price: 110, prev_close: 108, day_close: 110 },
    })).toBeNull()
    expect(extendedSessionSplit([], {})).toBeNull()
  })

  it('pre-market returns session only (caller relabels the line)', () => {
    expect(extendedSessionSplit([long], {
      AAPL: { price: 111, ext_price: 111, ext_session: 'pre_market', prev_close: 108 },
    })).toEqual({ session: 'pre_market' })
  })

  it('post-market splits Today (frozen at close) from After-Hours', () => {
    const prices = {
      AAPL: { price: 112, ext_price: 112, ext_session: 'post_market', day_close: 110, prev_close: 108 },
      TSLA: { price: 188, ext_price: 188, ext_session: 'post_market', day_close: 190, prev_close: 195 },
    }
    const out = extendedSessionSplit([long, short], prices, { cash: 1000, todayIso: TODAY })
    // regular: 10×(110−108) + (−5)×(190−195) = 20 + 25 = 45
    expect(out.regularDollar).toBeCloseTo(45)
    // ext: 10×(112−110) + (−5)×(188−190) = 20 + 10 = 30
    expect(out.extDollar).toBeCloseTo(30)
    // netLiqAtClose = 1000 + 10×110 − 5×190 = 1150
    expect(out.extPct).toBeCloseTo(30 / 1150)
    expect(out.regularPct).toBeCloseTo(45 / (1150 - 45))
    expect(out.session).toBe('post_market')
  })

  it('same-day fills measure the regular leg from the fill price', () => {
    const openedToday = { symbol: 'NVDA', side: 'Long', shares: 2, entryPrice: 150, entryDate: TODAY }
    const out = extendedSessionSplit([openedToday], {
      NVDA: { price: 158, ext_price: 158, ext_session: 'post_market', day_close: 155, prev_close: 149 },
    }, { todayIso: TODAY })
    expect(out.regularDollar).toBeCloseTo(2 * (155 - 150))   // from the fill, not prev close
    expect(out.extDollar).toBeCloseTo(2 * (158 - 155))
  })

  it('positions without day_close contribute to neither leg', () => {
    const out = extendedSessionSplit([long, { ...short, symbol: 'XX' }], {
      AAPL: { price: 112, ext_price: 112, ext_session: 'post_market', day_close: 110, prev_close: 108 },
      XX: { price: 50, ext_price: 50, ext_session: 'post_market', prev_close: 49 },  // no day_close
    }, { todayIso: TODAY })
    expect(out.regularDollar).toBeCloseTo(20)
    expect(out.extDollar).toBeCloseTo(20)
  })
})
