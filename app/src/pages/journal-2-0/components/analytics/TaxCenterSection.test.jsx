/** Tax Center — CSV builder + honest coverage/disclaimer rendering. */
import { describe, it, expect } from 'vitest'
import { buildTaxCsv } from './TaxCenterSection'

const REPORT = {
  lines: [
    { description: '100 sh NVDA', acquired: '2026-03-01', sold: '2026-03-10',
      proceeds: 9000, basis: 10000, gain: -1000, term: 'short', fees: 1.2,
      washSale: { disallowedEstimate: 1000, replacements: [{ date: '2026-03-25', shares: 100 }] } },
    { description: '50 sh AMD', acquired: '2026-01-05', sold: '2026-02-01',
      proceeds: 5500, basis: 5000, gain: 500, term: 'short', fees: 0, washSale: null },
  ],
  totals: { shortTermGain: -500, longTermGain: 0, washDisallowedEstimate: 1000, feesTotal: 1.2 },
  disclaimer: 'Estimate for review — not tax advice.',
}

describe('buildTaxCsv', () => {
  it('one row per line with the 8949 columns + wash amount', () => {
    const csv = buildTaxCsv(REPORT)
    const rows = csv.split('\n')
    expect(rows[0]).toContain('Proceeds,Cost Basis,Gain/Loss,Term')
    expect(rows[1]).toContain('100 sh NVDA,2026-03-01,2026-03-10,9000,10000,-1000,short,1.2,1000')
    expect(rows[2]).toContain('50 sh AMD')
    expect(rows[2].endsWith(',')).toBe(true)  // no wash => empty last cell
  })

  it('carries the totals + the disclaimer verbatim', () => {
    const csv = buildTaxCsv(REPORT)
    expect(csv).toContain('Wash-sale disallowed (estimate),1000')
    expect(csv).toContain('Estimate for review — not tax advice.')
  })

  it('null/empty report yields just the header + footer, never a throw', () => {
    const csv = buildTaxCsv(null)
    expect(csv).toContain('Description,Acquired')
  })
})
