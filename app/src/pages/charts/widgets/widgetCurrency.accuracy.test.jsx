// Accuracy follow-up 7 (audit 2026-10-06): FundamentalsWidget, BusinessTrend and
// CompanySearch printed "$" on a foreign filer's figures (TSM reports in TWD). They now use
// the shared currency helpers (currencyPrefix / reportingCurrencyNote) with the reporting
// currency the backend already returns, the way EE/FA/DES do: amounts in the reporting
// currency, EPS without a symbol, USD or unknown byte-for-byte unchanged.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fmtSales } from './FundamentalsWidget'
import BusinessTrend, { fmtMoney as btMoney, fmtEps as btEps } from './BusinessTrend'
import { fmtMoney as csMoney, fmtBy } from './CompanySearch'

describe('FundamentalsWidget.fmtSales', () => {
  it('labels TWD, and USD / unknown are unchanged', () => {
    expect(fmtSales(2.894e12, 'TWD')).toBe('TWD 2.89T')
    expect(fmtSales(-4.5e8, 'TWD')).toBe('-TWD 450M')
    expect(fmtSales(250_000, 'TWD')).toBe('TWD 250000')
    for (const v of [2.894e12, 6e9, 1.43e9, -4.5e8, 250_000]) {
      expect(fmtSales(v, 'USD')).toBe(fmtSales(v))
      expect(fmtSales(v, null)).toBe(fmtSales(v))
    }
    expect(fmtSales(6e9)).toBe('$6.0B')
  })
})

describe('BusinessTrend', () => {
  it('formatters: revenue in TWD, EPS with no symbol; USD unchanged', () => {
    expect(btMoney(2.894e12, 'TWD')).toBe('TWD 2.89T')
    expect(btMoney(2.894e12)).toBe('$2.89T')
    expect(btEps(15.42, 'TWD')).toBe('15.42')
    expect(btEps(-1.5, 'TWD')).toBe('-1.50')
    expect(btEps(6.11)).toBe('$6.11')
    expect(btEps(6.11, 'USD')).toBe('$6.11')
  })

  it('rendered: a TWD filer shows no "$" and names its currency on the strip', () => {
    const reported = [2022, 2023, 2024, 2025].map((y, i) => (
      { label: `FY${y}`, fiscal_year: y, revenue: (2.1 + i * 0.3) * 1e12, eps: 39 + i * 4 }))
    const { container } = render(<BusinessTrend annual={{ reported: reported.slice().reverse() }} currency="TWD" />)
    expect(screen.getByText('Revenue (TWD)')).toBeTruthy()
    expect(container.textContent).not.toContain('$')
  })
})

describe('CompanySearch', () => {
  it('statement money and EPS follow the reporting currency; USD unchanged', () => {
    expect(csMoney(1.23e12, 'TWD')).toBe('TWD 1.23T')
    expect(csMoney(-512, 'TWD')).toBe('-TWD 512')
    expect(csMoney(1.23e12)).toBe('$1.23T')
    expect(fmtBy(15.42, 'eps', 'TWD')).toBe('15.42')
    expect(fmtBy(15.42, 'eps', null)).toBe('$15.42')
    expect(fmtBy(4.4e12, 'money', 'TWD')).toBe('TWD 4.40T')
    expect(fmtBy(4.4e12, 'money', 'USD')).toBe('$4.40T')
  })
})
