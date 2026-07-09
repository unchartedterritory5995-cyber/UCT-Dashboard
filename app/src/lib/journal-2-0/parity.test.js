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
} from '../../pages/journal-2-0/lib/optionCalcs'

const close = (a, b) => {
  if (a === null || b === null) return a === b
  expect(a).toBeCloseTo(b, 6)
  return true
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
      if (f.expected.pnl !== null) close(computePnl(ne, nx, 0, 0), f.expected.pnl)
      expect(classifyDebitCredit(ne)).toBe(f.expected.debitCredit)
    })
  })
})
