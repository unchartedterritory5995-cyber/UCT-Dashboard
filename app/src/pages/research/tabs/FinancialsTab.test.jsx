import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const fin = {
  sym: 'AAPL',
  quarterly: [
    { period: 'Q4 2024', revenue: 1.1e11, net_income: 3e10, eps: 2.2, gross_margin: 46.2, operating_margin: 31.5, net_margin: 27.3, revenue_yoy: 10.0, eps_yoy: -5.0 },
  ],
  annual: [
    { period: '2024', revenue: 3.9e11, net_income: 1e11, eps: 6.08, gross_margin: 46.0, operating_margin: 31.0, net_margin: 25.0, revenue_yoy: 2.0, eps_yoy: 30.0 },
  ],
  balance: { cash: '$50.0B', total_debt: '$100.0B', debt_to_equity: 150, current_ratio: 1.1, fcf: '$90.0B' },
  metrics: { roe: 120.0, roa: 25.0, gross_margin: 46.0, operating_margin: 31.0, net_margin: 25.0 },
}

vi.mock('../hooks/useFinancials', () => ({ default: () => ({ data: fin, isLoading: false }) }))

import FinancialsTab, { fmtDebtToEquity } from './FinancialsTab'

describe('FinancialsTab', () => {
  it('renders quarterly + annual grids with formatted values', () => {
    render(<FinancialsTab sym="AAPL" />)
    expect(screen.getByText('Q4 2024')).toBeInTheDocument()
    expect(screen.getByText('2024')).toBeInTheDocument()
    expect(screen.getByText('$110.00B')).toBeInTheDocument()  // quarterly revenue
    expect(screen.getByText('+10.0%')).toBeInTheDocument()    // rev YoY
    expect(screen.getByText('-5.0%')).toBeInTheDocument()     // eps YoY (negative)
  })

  it('renders balance sheet + profitability', () => {
    render(<FinancialsTab sym="AAPL" />)
    expect(screen.getByText('$90.0B')).toBeInTheDocument()    // FCF
    expect(screen.getByText('120%')).toBeInTheDocument()      // ROE
  })

  it('debt/equity arrives from yfinance as a percent and is shown as a ratio', () => {
    render(<FinancialsTab sym="AAPL" />)
    expect(screen.getByTestId('debt-to-equity').textContent).toBe('1.50×')
    expect(fmtDebtToEquity(null)).toBe('—')
    expect(fmtDebtToEquity(45.3)).toBe('0.45×')
  })

  it('shows no entity note when resolution already succeeded (the fixture default)', () => {
    render(<FinancialsTab sym="AAPL" />)
    expect(screen.queryByTestId('entity-unresolved-note')).not.toBeInTheDocument()
  })
})

describe('FinancialsTab -- S3 continuation (owner authorization, 2026-09-03)', () => {
  it('renders an honest note when the symbol has not resolved to a canonical entity', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useFinancials', () => ({
      default: () => ({ data: { ...fin, entity: { status: 'not_found', entityId: null } }, isLoading: false }),
    }))
    const { default: FreshFinancialsTab } = await import('./FinancialsTab')
    render(<FreshFinancialsTab sym="ZZZ" />)
    expect(screen.getByTestId('entity-unresolved-note')).toHaveTextContent('not_found')
  })

  it('never renders Provenance/FreshnessBadge on this tab -- no D1-sourced value exists here yet', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useFinancials', () => ({
      default: () => ({ data: { ...fin, entity: { status: 'resolved', entityId: 'e_aapl' } }, isLoading: false }),
    }))
    const { default: FreshFinancialsTab } = await import('./FinancialsTab')
    render(<FreshFinancialsTab sym="AAPL" />)
    expect(screen.queryByTestId('provenance-present')).not.toBeInTheDocument()
    expect(screen.queryByTestId('freshness-badge')).not.toBeInTheDocument()
  })
})

// TERM-088 -- a failed read must render as an error, never as the genuine
// "statement history is unavailable" empty state.
describe('FinancialsTab -- failed read vs genuine empty state', () => {
  async function renderWith(mockReturn) {
    vi.resetModules()
    vi.doMock('../hooks/useFinancials', () => ({ default: () => mockReturn }))
    const { default: FreshTab } = await import('./FinancialsTab')
    return render(<FreshTab sym="AAPL" />)
  }

  it('renders the error state on a failed read, not "Statement history is unavailable"', async () => {
    await renderWith({ data: null, isLoading: false, error: true, mutate: () => {} })
    expect(screen.getByTestId('financials-error')).toHaveTextContent("Couldn't load financials")
    expect(screen.queryByText('Statement history is unavailable for this ticker.')).not.toBeInTheDocument()
  })

  it('still renders the genuine empty state when the read succeeded with no statements', async () => {
    await renderWith({ data: {}, isLoading: false, error: false, mutate: () => {} })
    expect(screen.getByText('Statement history is unavailable for this ticker.')).toBeInTheDocument()
    expect(screen.queryByTestId('financials-error')).not.toBeInTheDocument()
  })

  it('Retry calls mutate', async () => {
    const mutate = vi.fn()
    await renderWith({ data: null, isLoading: false, error: true, mutate })
    screen.getByText('Retry').click()
    expect(mutate).toHaveBeenCalled()
  })
})
