import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

let mockDayDetail = {
  metrics: {
    basis: 'account', accountBalanceChange: 500, realizedPnl: 200,
    unrealizedChange: 300, netPnlDollar: 200, pnlPercent: 0.005,
    rSum: 1, tradeCount: 1, winners: 1, losers: 0, winRate: 1,
  },
  trades: [], strategies: { closed: [], expiring: [] }, notes: null,
  isLoading: false, error: null, refresh: () => {},
}
// Data hooks — account-mode metrics with the balance breakdown.
vi.mock('../../hooks/useJ2DayDetail', () => ({
  default: () => mockDayDetail,
}))
vi.mock('../../hooks/useJ2SelectedAccount', () => ({
  default: () => ({ accountId: 'a1', account: { balanceSource: 'snaptrade' } }),
}))
vi.mock('../../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: { j2_calendar_pnl_basis: 'account' }, setPref: () => {} }),
  parsePref: (raw, fallback) => raw ?? fallback,
}))
vi.mock('../../hooks/useJ2DayNotesMutation', () => ({
  default: () => ({ save: () => {}, saving: false, error: null }),
}))
// Presentational children that fetch/own state — stub to no-ops.
vi.mock('./MiniMonthNav', () => ({ default: () => null }))
vi.mock('./DayReflection', () => ({ default: () => null }))
vi.mock('./DayAttachments', () => ({ default: () => null }))
vi.mock('./DayRulesChecklist', () => ({ default: () => null }))
// TradeDrawer renders only when `trade` is truthy — capture what it was
// given so tests can assert the exact row that reached it.
vi.mock('../TradeDrawer', () => ({
  default: ({ trade }) => (trade ? <div data-testid="trade-drawer">{trade.symbol}</div> : null),
}))
// OptionStrategiesSection (real, not mocked, so onSelect wiring is genuinely
// exercised) reads live marks via this leaf hook — stub it so tests never
// touch the network.
vi.mock('../../hooks/useJ2OptionMarks', () => ({
  default: () => ({ marks: null, isLoading: false, isError: false }),
}))

import DayDetailPage from './DayDetailPage'

function renderAt(date) {
  return render(
    <MemoryRouter initialEntries={[`/journal-2-0/calendar/${date}`]}>
      <Routes>
        <Route path="/journal-2-0/calendar/:date" element={<DayDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('DayDetailPage account-mode breakdown', () => {
  it('renders the balance-change breakdown when metrics.basis is account', () => {
    mockDayDetail = {
      metrics: {
        basis: 'account', accountBalanceChange: 500, realizedPnl: 200,
        unrealizedChange: 300, netPnlDollar: 200, pnlPercent: 0.005,
        rSum: 1, tradeCount: 1, winners: 1, losers: 0, winRate: 1,
      },
      trades: [], strategies: { closed: [], expiring: [] }, notes: null,
      isLoading: false, error: null, refresh: () => {},
    }
    renderAt('2026-06-02')
    expect(screen.getByText(/account balance/i)).toBeInTheDocument()
    expect(screen.getByText(/realized/i)).toBeInTheDocument()
    expect(screen.getByText(/open positions/i)).toBeInTheDocument()
  })
})

// Journal / Trade Lifecycle Convergence V1 — closes the DayTradesTable and
// OptionStrategiesSection dead ends (rows previously rendered with no click
// handler at all).
describe('DayDetailPage closed-trade click-through (Journal / Trade Lifecycle Convergence V1)', () => {
  beforeEach(() => { mockNavigate.mockClear() })

  const EQUITY_TRADE = {
    id: 'trade-123', symbol: 'NVDA', side: 'Long', setup: null, shares: 10,
    entryPrice: 100, exitPrice: 110, pnlDollar: 100, pnlPercent: 0.1,
    rMultiple: 1, result: 'Win',
  }
  const CLOSED_STRATEGY = {
    id: 'strat-456', underlying: 'SPY', strategyType: 'long_call',
    legs: [{ expiration: '2026-06-20', strike: 500, qty: 1, entryPrice: 2, exitPrice: 3 }],
    entryDate: '2026-06-01', closedAt: '2026-06-02', pnlDollar: 100, pnlPercent: 0.5,
    result: 'Win', fees: 0, exitFees: 0, source: 'manual', tradeRef: null,
  }

  it('clicking an equity trade row navigates to the trade detail page (real j2_trades.id — this endpoint never returns option rows in `trades`)', () => {
    mockDayDetail = {
      metrics: null,
      trades: [EQUITY_TRADE],
      strategies: { closed: [], expiring: [] },
      notes: null, isLoading: false, error: null, refresh: () => {},
    }
    const { container } = renderAt('2026-06-02')
    // TradesOnDay (sidebar) ALSO renders the symbol text, so scope the query
    // to the main table's clickable row specifically.
    const row = container.querySelector('tbody tr[role="button"]')
    fireEvent.click(row)
    expect(mockNavigate).toHaveBeenCalledWith('/journal-2-0/trade/trade-123')
  })

  it('clicking a keyboard-focused equity trade row (Enter) also navigates', () => {
    mockDayDetail = {
      metrics: null,
      trades: [EQUITY_TRADE],
      strategies: { closed: [], expiring: [] },
      notes: null, isLoading: false, error: null, refresh: () => {},
    }
    const { container } = renderAt('2026-06-02')
    const row = container.querySelector('tbody tr[role="button"]')
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(mockNavigate).toHaveBeenCalledWith('/journal-2-0/trade/trade-123')
  })

  it('clicking a CLOSED option-strategy row opens the TradeDrawer via optionClosedToRow, not raw navigation', () => {
    mockDayDetail = {
      metrics: null,
      trades: [],
      strategies: { closed: [CLOSED_STRATEGY], expiring: [] },
      notes: null, isLoading: false, error: null, refresh: () => {},
    }
    renderAt('2026-06-02')
    // OptionStrategiesSection renders the real component (not mocked) —
    // click its row via the strategy's underlying symbol text.
    fireEvent.click(screen.getByText(/SPY/))
    expect(screen.getByTestId('trade-drawer')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('an EXPIRING (still-open) option strategy stays inert — TradeDrawer is documented for closed trades only', () => {
    mockDayDetail = {
      metrics: null,
      trades: [],
      strategies: { closed: [], expiring: [{ ...CLOSED_STRATEGY, id: 'strat-789', closedAt: null }] },
      notes: null, isLoading: false, error: null, refresh: () => {},
    }
    renderAt('2026-06-02')
    fireEvent.click(screen.getByText(/SPY/))
    expect(screen.queryByTestId('trade-drawer')).not.toBeInTheDocument()
  })

  it('no click handler is wired when the day has no trades (empty state renders, no crash)', () => {
    mockDayDetail = {
      metrics: null,
      trades: [],
      strategies: { closed: [], expiring: [] },
      notes: null, isLoading: false, error: null, refresh: () => {},
    }
    renderAt('2026-06-02')
    expect(screen.getByText(/no trades on this day/i)).toBeInTheDocument()
  })
})
