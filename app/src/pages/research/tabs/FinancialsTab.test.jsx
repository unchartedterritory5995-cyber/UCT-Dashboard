import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

const fin = {
  sym: 'AAPL',
  currency: 'USD', // a US filer whose reporting currency is STATED -- known USD renders "$"
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
    expect(screen.getByTestId('entity-unresolved-note')).toHaveTextContent('not yet linked to a company record') // plain English, never the enum
  })

  it('a payload that names no source gets no source line -- a badge is never attached to an unattributed number', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useFinancials', () => ({
      default: () => ({ data: { ...fin, entity: { status: 'resolved', entityId: 'e_aapl' } }, isLoading: false }),
    }))
    const { default: FreshFinancialsTab } = await import('./FinancialsTab')
    render(<FreshFinancialsTab sym="AAPL" />)
    expect(screen.queryByTestId('provenance-present')).not.toBeInTheDocument()
    expect(screen.queryByTestId('freshness-badge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('depth-source')).toBeNull()
    expect(screen.queryByTestId('financials-summary-source')).toBeNull()
  })
})

// The route reads the FMP statements first and the Yahoo frames only for a
// ticker that feed returned nothing for; `sources.statements` says which, per
// ticker, and the line under the grids repeats exactly that.
describe('FinancialsTab -- the source that supplied the grids', () => {
  const FMP = { statements: 'FMP', summary: 'Yahoo Finance', statements_fetched_at: 1759500000 }
  const FALLBACK = { statements: 'Yahoo Finance', summary: 'Yahoo Finance' }

  async function renderWith(data, props = {}) {
    vi.resetModules()
    vi.doMock('../hooks/useFinancials', () => ({ default: () => ({ data, isLoading: false, error: false, mutate: () => {} }) }))
    const { default: FreshTab } = await import('./FinancialsTab')
    return render(<FreshTab sym="AAPL" {...props} />)
  }

  it('FMP grids: "Source: FMP", scoped to the grids, and the cards say whose they are', async () => {
    await renderWith({ ...fin, sources: FMP })
    const src = screen.getByTestId('depth-source')
    expect(src).toHaveAttribute('data-vendor', 'FMP')
    expect(src).toHaveAttribute('data-fallback', 'false')
    expect(src).toHaveTextContent('Source: FMP')
    expect(src).toHaveTextContent('Revenue, EPS and margin grids · fiscal periods')
    expect(src).not.toHaveTextContent(/Yahoo|Fallback/)
    const cards = screen.getByTestId('financials-summary-source')
    expect(cards).toHaveAttribute('data-vendor', 'Yahoo Finance')
    expect(cards).toHaveAttribute('data-fallback', 'false')
    expect(cards).toHaveTextContent('Balance sheet and profitability summary')
  })

  it('the source detail is member copy: no endpoint path, no library name', async () => {
    await renderWith({ ...fin, sources: FMP })
    const src = screen.getByTestId('depth-source')
    fireEvent.click(within(src).getByTestId('provenance-detail-toggle'))
    const panel = within(src).getByTestId('provenance-detail-panel')
    expect(panel).toHaveTextContent('Source: FMP quarterly and annual income statements')
    expect(panel).not.toHaveTextContent(/\/stable\/|yfinance|income_stmt/)
  })

  it('fallback grids: "Fallback: Yahoo Finance" with the reason, and one line covers the cards too', async () => {
    await renderWith({ ...fin, sources: FALLBACK })
    const src = screen.getByTestId('depth-source')
    expect(src).toHaveAttribute('data-vendor', 'Yahoo Finance')
    expect(src).toHaveAttribute('data-fallback', 'true')
    expect(src).toHaveTextContent('Fallback: Yahoo Finance')
    expect(src).toHaveTextContent('FMP holds no statement history for this ticker; showing Yahoo Finance')
    expect(src).toHaveTextContent('calendar-quarter labels')
    expect(src).not.toHaveTextContent('Source: FMP')
    expect(screen.queryByTestId('financials-summary-source')).toBeNull()
  })

  it('a fallback shown because the FMP read FAILED says so, never "holds no history"', async () => {
    await renderWith({ ...fin, sources: FALLBACK, fmp_unavailable: true })
    const src = screen.getByTestId('depth-source')
    expect(src).toHaveTextContent('FMP statement history could not be read right now; showing Yahoo Finance')
    expect(src).not.toHaveTextContent(/holds no statement history/)
  })

  it('the line follows the payload, per ticker, not the caller', async () => {
    const { unmount } = await renderWith({ ...fin, sym: 'NVDA', sources: FMP })
    expect(screen.getByTestId('depth-source')).toHaveAttribute('data-vendor', 'FMP')
    unmount()
    await renderWith({ ...fin, sym: 'ZZZQ', sources: FALLBACK })
    expect(screen.getByTestId('depth-source')).toHaveAttribute('data-vendor', 'Yahoo Finance')
  })

  it('a grid the source has no rows for says so in place, never a silent hole', async () => {
    await renderWith({ ...fin, annual: [], sources: FMP })
    const gap = screen.getByTestId('financials-gap-annual')
    expect(gap).toHaveTextContent('Annual statements are not available for this ticker.')
    expect(gap).toHaveAttribute('data-unread', 'false')
    expect(screen.queryByTestId('financials-gap-quarterly')).toBeNull()
    expect(screen.getByText('Q4 2024')).toBeInTheDocument()          // the grid that has rows is untouched
  })

  it('a grid whose read FAILED says "could not be read", never "not available"', async () => {
    await renderWith({ ...fin, quarterly: [], sources: FMP, fmp_unavailable: true, unread: ['quarterly'] })
    const gap = screen.getByTestId('financials-gap-quarterly')
    expect(gap).toHaveTextContent('Quarterly statements could not be read right now.')
    expect(gap).toHaveAttribute('data-unread', 'true')
    expect(gap).not.toHaveTextContent(/not available/)
  })

  it('on the fallback after a FAILED FMP read, an empty grid is "could not be read" too', async () => {
    await renderWith({ ...fin, quarterly: [], sources: FALLBACK, fmp_unavailable: true })
    expect(screen.getByTestId('financials-gap-quarterly')).toHaveTextContent('Quarterly statements could not be read right now.')
  })

  it('on a clean fallback, a grid Yahoo has no rows for is "not available"', async () => {
    await renderWith({ ...fin, quarterly: [], sources: FALLBACK })
    expect(screen.getByTestId('financials-gap-quarterly')).toHaveTextContent('Quarterly statements are not available for this ticker.')
  })

  it('a figure the source does not state is a dash, never 0', async () => {
    const row = { period: 'Q3 2026', revenue: 1.0e11, net_income: null, eps: null,
      gross_margin: null, operating_margin: 31.0, net_margin: null, revenue_yoy: null, eps_yoy: null }
    await renderWith({ ...fin, quarterly: [row], annual: [], sources: FMP })
    const cells = within(screen.getByRole('table', { name: /Quarterly/ })).getAllByRole('cell').map((c) => c.textContent)
    expect(cells).toEqual(['Q3 2026', '$100.00B', '—', '—', '—', '—', '31.0%', '—'])
  })

  it('no rows from either source and a failed read: "could not be read", not "unavailable for this ticker"', async () => {
    await renderWith({ sym: 'AAPL', quarterly: [], annual: [], balance: {}, metrics: {},
      sources: { statements: null, summary: null }, unread: ['quarterly', 'annual'] })
    expect(screen.getByTestId('financials-unread')).toHaveTextContent('Statement history could not be read right now.')
    expect(screen.queryByText('Statement history is unavailable for this ticker.')).toBeNull()
    expect(screen.queryByTestId('depth-source')).toBeNull()           // nobody supplied a grid: nobody is credited
  })

  it('no rows and clean reads keeps the genuine empty state', async () => {
    await renderWith({ sym: 'AAPL', quarterly: [], annual: [], balance: {}, metrics: {},
      sources: { statements: null, summary: null } })
    expect(screen.getByText('Statement history is unavailable for this ticker.')).toBeInTheDocument()
    expect(screen.queryByTestId('financials-unread')).toBeNull()
  })

  it('with the grids off (the earnings modal) there is no grid source line to show', async () => {
    await renderWith({ ...fin, sources: FMP }, { showGrids: false })
    expect(screen.queryByTestId('depth-source')).toBeNull()
    expect(screen.queryByTestId('financials-summary-source')).toBeNull()
    expect(screen.getByText('$90.0B')).toBeInTheDocument()            // the cards are still there
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

// tq-panels: the route marks a fund (e910f8ff6); the tab says so, not "unavailable".
describe('FinancialsTab -- a fund', () => {
  it('says not applicable to funds with the route reason', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useFinancials', () => ({
      default: () => ({ data: { sym: 'SPY', annual: [], quarterly: [], balance: {}, metrics: {}, not_applicable: 'fund',
        reason: 'SPY is a fund; funds report no company income statement, balance sheet or cash flow' }, isLoading: false }),
    }))
    const { default: Fresh } = await import('./FinancialsTab')
    render(<Fresh sym="SPY" />)
    expect(screen.getByTestId('financials-na').textContent)
      .toBe('Not applicable to funds: SPY is a fund; funds report no company income statement, balance sheet or cash flow.')
    expect(screen.queryByText('Statement history is unavailable for this ticker.')).toBeNull()
  })
})
