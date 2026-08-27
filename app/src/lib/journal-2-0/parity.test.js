// Golden parity: Python (api/services/journal_two) is the authority; these
// fixtures were emitted by tools_emit_parity_fixtures.py. If this test fails,
// the JS mirror drifted — fix JS (or regenerate ONLY after changing Python).
import { describe, it, expect } from 'vitest'
import fixtures from './parity-fixtures.json'
import {
  tradePnlDollar, tradePnlPercent, tradeRMultiple, holdDays, tradeResult,
} from './calculations'
import {
  computeNetEntry, computeNetExit, computePnl, classifyDebitCredit,
  computeMaxRisk, computeDaysToExpiration,
} from '../../pages/journal-2-0/lib/optionCalcs'

const close = (a, b) => {
  if (a === null || b === null) {
    expect(a).toBe(b) // null must match null — a null-vs-number divergence FAILS
    return
  }
  expect(a).toBeCloseTo(b, 6)
}

describe('JS↔Python equity parity', () => {
  fixtures.equity.forEach((f, i) => {
    it(`equity case ${i}`, () => {
      const t = {
        side: f.inputs.side, entryPrice: f.inputs.entryPrice,
        exitPrice: f.inputs.exitPrice, shares: f.inputs.shares,
        originalStop: f.inputs.originalStop,
      }
      close(tradePnlDollar(t), f.expected.pnlDollar)
      close(tradePnlPercent(t), f.expected.pnlPercent)
      close(tradeRMultiple(t), f.expected.rMultiple)
      expect(holdDays(f.inputs.entryDate, f.inputs.exitDate)).toBe(f.expected.holdDays)
      expect(tradeResult(t, { breakevenRange: f.inputs.breakevenRange })).toBe(f.expected.result)
    })
  })
})

describe('JS↔Python options parity', () => {
  fixtures.options.forEach((f, i) => {
    it(`options case ${i}`, () => {
      const ne = computeNetEntry(f.inputs.legs)
      close(ne, f.expected.netEntry)
      const nx = computeNetExit(f.inputs.legs)
      close(nx, f.expected.netExit)
      close(computePnl(ne, nx, 0, 0), f.expected.pnl) // null-safe: open strategies expect null
      expect(classifyDebitCredit(ne)).toBe(f.expected.debitCredit)
      close(computeMaxRisk(f.inputs.strategyType, f.inputs.legs, ne), f.expected.maxRisk)
      // Whole-day DTE semantics: Python uses (date − as_of).days; anchoring the JS
      // asOf at noon UTC makes Math.round land on the same integer for any date pair.
      close(
        computeDaysToExpiration(f.inputs.legs, new Date(`${f.inputs.asOf}T12:00:00Z`)),
        f.expected.dte,
      )
    })
  })
})

// ── JS↔Python NET-LIQ COMPOSITION parity ────────────────────────────────────
// The number the Open Positions hero shows. Python authority:
// api/services/journal_two/broker/composition.py (the live sentinel composes
// with it); the JS mirror is brokerLiveSummary. On 2026-08-26 the display
// showed a figure the server could not reproduce — this block is the rail
// that keeps the two lanes one. Case 0 is that incident's book, pinned.
import { brokerLiveSummary } from './calculations'

describe('JS↔Python net-liq composition parity', () => {
  fixtures.composition.forEach((f, i) => {
    it(`composition case ${i}`, () => {
      const r = brokerLiveSummary(
        f.inputs.account, f.inputs.positions, f.inputs.strategies,
        f.inputs.prices, '2026-01-01', f.inputs.optionMarks,
      )
      // The Python authority rounds to cents; JS composes unrounded floats —
      // parity holds at money precision (2 dp), the unit members see.
      if (f.expected.marketValue === null) expect(r.marketValue).toBeNull()
      else expect(r.marketValue).toBeCloseTo(f.expected.marketValue, 2)
      if (f.expected.netLiq === null) expect(r.netLiq).toBeNull()
      else expect(r.netLiq).toBeCloseTo(f.expected.netLiq, 2)
    })
  })
})
