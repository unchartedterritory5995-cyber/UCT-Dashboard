import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

// ── mocks (mock-prefixed so vi.mock hoisting can reference them) ──────────────
let mockAccountId = null
const mockSetAccount = vi.fn()
let mockAccounts = []

vi.mock('../hooks/useJ2SelectedAccount', () => ({
  default: () => ({
    accountId: mockAccountId,
    account: null,
    accounts: mockAccounts,
    setAccount: mockSetAccount,
    isLoading: false,
  }),
}))

// Closed option strategies union — configurable per test.
let mockStrategies = []
vi.mock('../hooks/useJ2OptionStrategies', () => ({
  default: () => ({ strategies: mockStrategies, isLoading: false, error: null }),
}))

vi.mock('../hooks/useReviewedTradeIds', () => ({
  default: () => ({ reviewedIds: new Set() }),
}))
vi.mock('../hooks/useBrokerWarming', () => ({
  default: () => ({ warming: false, broker: null }),
}))
vi.mock('../hooks/useJ2ColumnPrefs', () => ({
  default: () => ({
    columns: [],
    visibleColumns: [],
    hiddenKeys: [],
    toggleColumn: vi.fn(),
    reorderColumns: vi.fn(),
    resetColumns: vi.fn(),
  }),
}))
vi.mock('react-hotkeys-hook', () => ({ useHotkeys: () => {} }))

// Heavy children stubbed to keep the test about the tab's own wiring.
vi.mock('../components/StatsGrid', () => ({ default: () => null }))
vi.mock('../components/ColumnsPicker', () => ({ default: () => null }))
vi.mock('../components/AddTradeModal', () => ({ default: () => null }))
vi.mock('../components/DeleteAllModal', () => ({ default: () => null }))
vi.mock('../components/ImportCsvModal', () => ({ default: () => null }))
vi.mock('../components/Toast', () => ({ default: () => null }))
vi.mock('../components/BrokerImportingBanner', () => ({ default: () => null }))
vi.mock('../components/TradeDrawer', () => ({ default: () => null }))

vi.mock('../components/TradesTable', () => ({
  default: ({ trades }) => (
    <div data-testid="trades-table">{trades.length} rows</div>
  ),
  buildTradesColumns: () => [],
}))

// ScopeBar stubbed — asserts the tab mounts it with the right props (the real
// ScopeBar has its own test). Rendering the counts lets us assert the "N of M"
// wiring (resultCount / totalCount).
vi.mock('../components/scope/ScopeBar', () => ({
  default: ({ surface, resultCount, totalCount }) => (
    <div
      data-testid="scope-bar"
      data-surface={surface}
      data-result={String(resultCount)}
      data-total={String(totalCount)}
    />
  ),
}))

import TradeJournalTab from './TradeJournalTab'

// Capture the SWR fetch URL + drive the envelope response.
let capturedUrl = null
let mockEnvelope = { trades: [], total: 0, limit: 500, offset: 0 }

beforeEach(() => {
  mockAccountId = null
  mockSetAccount.mockClear()
  mockAccounts = [{ id: 'acc1', name: 'Robinhood' }]
  mockStrategies = []
  capturedUrl = null
  mockEnvelope = { trades: [], total: 0, limit: 500, offset: 0 }
  global.fetch = vi.fn((url) => {
    capturedUrl = String(url)
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(mockEnvelope),
    })
  })
})

const SETTINGS = { tradingMode: 'both', setups: ['VCP', 'Breakout'] }

function renderTab({ route = '/journal', settings = SETTINGS } = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={[route]}>
        <TradeJournalTab settings={settings} />
      </MemoryRouter>
    </SWRConfig>,
  )
}

describe('TradeJournalTab — ScopeBar replaces the old filter chrome', () => {
  it('renders <ScopeBar surface="journal"> and NOT the old Period pills / Filters button', async () => {
    mockEnvelope = {
      trades: [{ id: 't1', symbol: 'AAPL', side: 'Long', entryDate: '2026-06-01' }],
      total: 1,
    }
    renderTab()
    const bar = await screen.findByTestId('scope-bar')
    expect(bar).toHaveAttribute('data-surface', 'journal')
    // old chrome gone
    expect(screen.queryByText('Period')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Filters/ })).not.toBeInTheDocument()
  })

  it('passes resultCount/totalCount to ScopeBar (the "N of M" span)', async () => {
    mockEnvelope = {
      trades: [
        { id: 't1', symbol: 'AAPL', side: 'Long', entryDate: '2026-06-01' },
        { id: 't2', symbol: 'MSFT', side: 'Long', entryDate: '2026-06-02' },
      ],
      total: 7,
    }
    renderTab()
    const bar = await screen.findByTestId('scope-bar')
    expect(bar).toHaveAttribute('data-result', '2')
    expect(bar).toHaveAttribute('data-total', '7')
  })
})

describe('TradeJournalTab — server-side FilterSpec fetch', () => {
  it('threads the scope apiParams into the fetch URL (encode ONCE, URLSearchParams)', async () => {
    mockEnvelope = {
      trades: [{ id: 't1', symbol: 'AAPL', side: 'Long', entryDate: '2026-06-01', setup: 'VCP' }],
      total: 1,
    }
    renderTab({ route: '/journal?sc_setup=VCP&sc_v=1' })
    await screen.findByTestId('trades-table')
    expect(capturedUrl).toContain('/api/j2/trades?')
    expect(capturedUrl).toContain('setups=VCP')
  })

  it('single-encodes a literal comma in a setup name (%2C survives as %252C on the wire)', async () => {
    // sc_setup=A%252CB → codec decodes to ONE setup "A,B" → apiParams.setups
    // "A%2CB" → URLSearchParams re-encodes the % once → "setups=A%252CB".
    renderTab({ route: '/journal?sc_setup=A%252CB&sc_v=1' })
    await screen.findByTestId('scope-bar')
    expect(capturedUrl).toContain('setups=A%252CB')
  })
})

describe('TradeJournalTab — scoped-empty trust state', () => {
  it('0 trades + active filter → designed "No trades match this scope" + Clear (NOT a bare table)', async () => {
    mockEnvelope = { trades: [], total: 0 }
    renderTab({ route: '/journal?sc_setup=ZZZ&sc_v=1' })
    expect(await screen.findByText(/No trades match this scope/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Clear/i })).toBeInTheDocument()
    expect(screen.queryByTestId('trades-table')).not.toBeInTheDocument()
  })

  it('clicking Clear in the scoped-empty state wipes the scope facets from the URL', async () => {
    mockEnvelope = { trades: [], total: 0 }
    const user = userEvent.setup()
    renderTab({ route: '/journal?sc_setup=ZZZ&sc_v=1' })
    await screen.findByText(/No trades match this scope/i)
    // Before clear: fetch carried the facet.
    expect(capturedUrl).toContain('setups=ZZZ')
    await user.click(screen.getByRole('button', { name: /Clear/i }))
    // After clear: a refetch drops the facet (scope wiped).
    expect(capturedUrl).not.toContain('setups=ZZZ')
  })

  it('0 trades + NO filter → the plain "No trades yet" empty state (not the scoped one)', async () => {
    mockEnvelope = { trades: [], total: 0 }
    renderTab({ route: '/journal' })
    expect(await screen.findByText(/No trades yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/No trades match this scope/i)).not.toBeInTheDocument()
  })
})

describe('TradeJournalTab — non-empty renders the table', () => {
  it('renders TradesTable when the scoped fetch returns rows', async () => {
    mockEnvelope = {
      trades: [{ id: 't1', symbol: 'AAPL', side: 'Long', entryDate: '2026-06-01' }],
      total: 1,
    }
    renderTab()
    const table = await screen.findByTestId('trades-table')
    expect(table).toHaveTextContent('1 rows')
  })
})

describe('TradeJournalTab — closed-option scope match (A4 parity: symbol + date only)', () => {
  // The closed-options union is client-scoped (shares are server-scoped). Per
  // the A4 LOCKED rule, option strategies filter by SYMBOL (underlying prefix)
  // ONLY — side has no strategy analog, and setups/tags are NOT applied. The
  // Calendar day P&L unions these same strategies WITHOUT side/setup/tag, so a
  // side/setup/tag scope must NOT make an option row vanish from the journal
  // (it would still count in the Calendar day total = trust violation). The
  // trades envelope is empty in every case, so a rendered table = the OPTION
  // survived; "No trades match this scope" = it was dropped.
  //
  // row.side = "Long Call", row.setup = "Breakout" (deliberately DIFFERENT from
  // the side/setup facets below) so the pre-fix code — which honored those
  // facets — WOULD have dropped the row; the fix keeps it.
  const OPTION = {
    id: 'opt1',
    strategyType: 'long_call',
    underlying: 'AAPL',
    result: 'win',
    entryDate: '2026-06-01',
    closedAt: '2026-06-15',
    pnlDollar: 250,
    pnlPercent: 0.25,
    rMultiple: 1.5,
    setup: 'Breakout',
    source: 'manual',
    legs: [{ strike: 150, qty: 1, entryPrice: 2, exitPrice: 4.5, expiration: '2026-07-18' }],
  }

  it('a MATCHING symbol scope keeps the option row', async () => {
    mockStrategies = [OPTION]
    renderTab({ route: '/journal?sc_sym=AAPL&sc_v=1' })
    const table = await screen.findByTestId('trades-table')
    expect(table).toHaveTextContent('1 rows')
  })

  it('a NON-matching symbol scope drops the option row', async () => {
    mockStrategies = [OPTION]
    renderTab({ route: '/journal?sc_sym=TSLA&sc_v=1' })
    expect(await screen.findByText(/No trades match this scope/i)).toBeInTheDocument()
    expect(screen.queryByTestId('trades-table')).not.toBeInTheDocument()
  })

  it('a SIDE scope does NOT drop the option row (strategies ignore side)', async () => {
    mockStrategies = [OPTION] // row.side = "Long Call"
    renderTab({ route: '/journal?sc_side=Short&sc_v=1' })
    const table = await screen.findByTestId('trades-table')
    expect(table).toHaveTextContent('1 rows')
  })

  it('a SETUP scope does NOT drop the option row (strategies ignore setup)', async () => {
    mockStrategies = [OPTION] // row.setup = "Breakout"
    renderTab({ route: '/journal?sc_setup=VCP&sc_v=1' })
    const table = await screen.findByTestId('trades-table')
    expect(table).toHaveTextContent('1 rows')
  })

  it('a TAG scope does NOT drop the option row (strategies carry no tags)', async () => {
    mockStrategies = [OPTION]
    renderTab({ route: '/journal?sc_tag=fomo&sc_v=1' })
    const table = await screen.findByTestId('trades-table')
    expect(table).toHaveTextContent('1 rows')
  })

  it('an out-of-range DATE scope drops the option row (exit-date spine IS honored)', async () => {
    mockStrategies = [OPTION] // closedAt = 2026-06-15
    renderTab({ route: '/journal?sc_from=2026-07-01&sc_v=1' })
    expect(await screen.findByText(/No trades match this scope/i)).toBeInTheDocument()
    expect(screen.queryByTestId('trades-table')).not.toBeInTheDocument()
  })
})
