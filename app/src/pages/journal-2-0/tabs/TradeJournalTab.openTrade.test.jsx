import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Wave 3 (Thesis-Trade Link) regression: a note's "linked trade" chip
// navigates an option strategy here via ?j2tab=journal&openTrade=<id>.
// j2_trades.id and j2_option_strategies.id are independent uuid4
// namespaces (note_trade_links.py), so allClosedForSummary -- which merges
// BOTH tables' rows into one array -- can contain two DIFFERENT rows
// sharing the same literal id. A real-browser E2E caught this: matching
// openTrade by id ALONE opened the wrong object (an equity trade instead
// of the option strategy actually linked). This file pins the fix: the
// match must also require `isOption`.
//
// useJ2Trades is mocked directly (no SWR/fetch) -- this test is only
// about the id+type matching logic, not the data-fetching layer.

let mockTrades = []
vi.mock('../hooks/useJ2Trades', () => ({
  default: () => ({
    trades: mockTrades, total: mockTrades.length, isLoading: false, error: null,
    refresh: vi.fn(), mutate: vi.fn(),
  }),
}))

vi.mock('../hooks/useJ2SelectedAccount', () => ({
  default: () => ({
    accountId: null, account: null, accounts: [{ id: 'acc1', name: 'Robinhood' }],
    setAccount: vi.fn(), isLoading: false,
  }),
}))

let mockStrategies = []
vi.mock('../hooks/useJ2OptionStrategies', () => ({
  default: () => ({ strategies: mockStrategies, isLoading: false, error: null }),
}))

vi.mock('../hooks/useReviewedTradeIds', () => ({ default: () => ({ reviewedIds: new Set() }) }))
vi.mock('../hooks/useBrokerWarming', () => ({ default: () => ({ warming: false, broker: null }) }))
vi.mock('../hooks/useJ2ColumnPrefs', () => ({
  default: () => ({
    columns: [], visibleColumns: [], hiddenKeys: [],
    toggleColumn: vi.fn(), reorderColumns: vi.fn(), resetColumns: vi.fn(),
  }),
}))
vi.mock('react-hotkeys-hook', () => ({ useHotkeys: () => {} }))

vi.mock('../components/StatsGrid', () => ({ default: () => null }))
vi.mock('../components/ColumnsPicker', () => ({ default: () => null }))
vi.mock('../components/AddTradeModal', () => ({ default: () => null }))
vi.mock('../components/DeleteAllModal', () => ({ default: () => null }))
vi.mock('../components/ImportCsvModal', () => ({ default: () => null }))
vi.mock('../components/Toast', () => ({ default: () => null }))
vi.mock('../components/BrokerImportingBanner', () => ({ default: () => null }))
vi.mock('../components/TradesTable', () => ({
  default: ({ trades }) => <div data-testid="trades-table">{trades.length} rows</div>,
  buildTradesColumns: () => [],
}))
vi.mock('../components/scope/ScopeBar', () => ({ default: () => <div data-testid="scope-bar" /> }))

// The one mock this file cares about: capture exactly which trade the
// drawer was told to open.
let openedTrade = null
vi.mock('../components/TradeDrawer', () => ({
  default: ({ trade }) => { openedTrade = trade; return trade ? <div data-testid="drawer-open">{trade.symbol}</div> : null },
}))

import TradeJournalTab from './TradeJournalTab'

beforeEach(() => {
  mockTrades = []
  mockStrategies = []
  openedTrade = null
})

const SETTINGS = { tradingMode: 'both', setups: [] }

function renderTab(route) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <TradeJournalTab settings={SETTINGS} />
    </MemoryRouter>,
  )
}

describe('TradeJournalTab — ?openTrade= id-collision regression (Wave 3)', () => {
  it('opens the OPTION STRATEGY, never the equity trade sharing the same id', async () => {
    mockTrades = [{ id: '123', symbol: 'NVDA', side: 'Long', entryDate: '2026-01-01', closedAt: '2026-01-05' }]
    mockStrategies = [{
      id: '123', underlying: 'TSLA', strategyType: 'long_call', result: 'Win',
      entryDate: '2026-01-01', closedAt: '2026-01-05',
      legs: [{ expiration: '2026-06-19', strike: 200, qty: 1, entryPrice: 5, exitPrice: 8 }],
    }]

    renderTab('/journal?j2tab=journal&openTrade=123')

    const drawer = await screen.findByTestId('drawer-open')
    expect(drawer).toHaveTextContent(/TSLA/)
    expect(openedTrade.isOption).toBe(true)
    expect(openedTrade.symbol).not.toMatch(/^NVDA/)
  }, 8000)

  it('never opens a drawer when the id names only an equity trade (isOption required)', async () => {
    mockTrades = [{ id: 't1', symbol: 'AAPL', side: 'Long', entryDate: '2026-01-01', closedAt: '2026-01-05' }]
    mockStrategies = []

    renderTab('/journal?j2tab=journal&openTrade=t1')
    await screen.findByTestId('trades-table')
    expect(screen.queryByTestId('drawer-open')).not.toBeInTheDocument()
  }, 8000)
})
