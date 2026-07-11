import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
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
// The tab now issues TWO reads: the PAGED table fetch (carries limit/offset) and
// a separate UNPAGED summary fetch (no limit/offset — feeds the full-book
// StatsGrid, the B5 pagination-leak fix). `capturedUrls` holds every URL;
// `lastPagedUrl` is the most recent paginated fetch (the only one with offset=)
// so paging assertions stay precise regardless of fetch ordering; `capturedUrl`
// stays the last-overall URL for the facet assertions that both reads share.
let capturedUrl = null
let capturedUrls = []
let lastPagedUrl = null
let mockEnvelope = { trades: [], total: 0, limit: 500, offset: 0 }

beforeEach(() => {
  mockAccountId = null
  mockSetAccount.mockClear()
  mockAccounts = [{ id: 'acc1', name: 'Robinhood' }]
  mockStrategies = []
  capturedUrl = null
  capturedUrls = []
  lastPagedUrl = null
  mockEnvelope = { trades: [], total: 0, limit: 500, offset: 0 }
  global.fetch = vi.fn((url) => {
    const u = String(url)
    capturedUrl = u
    capturedUrls.push(u)
    if (u.includes('offset=')) lastPagedUrl = u
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

// ── B5: server-side pagination ──────────────────────────────────────────────
// A full page of server (share) trades with `total` > page size (50). The mock
// returns the SAME envelope for every URL, so the "Showing X–Y" indicator is
// driven by the tab's local page state (not the envelope's echoed offset), and
// the fetch URL's `offset=` proves the page advanced/reset.
const PAGE = 50
const makePage = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`, symbol: 'AAA', side: 'Long', entryDate: '2026-06-01',
  }))

// A sibling that mutates the URL scope so we can prove offset resets on a filter
// change (ScopeBar is stubbed, so the tab can't change its own scope in-test).
function FilterButton() {
  const [, setSearchParams] = useSearchParams()
  return (
    <button type="button" onClick={() => setSearchParams({ sc_sym: 'ZZZ', sc_v: '1' })}>
      apply-filter
    </button>
  )
}

describe('TradeJournalTab — page controls', () => {
  it('renders "Showing X–Y of M" + Prev/Next when total exceeds the page size', async () => {
    mockEnvelope = { trades: makePage(PAGE), total: 120, limit: PAGE, offset: 0 }
    renderTab()
    expect(await screen.findByText(/of 120/)).toBeInTheDocument()
    // page 1: showing 1–50, Prev disabled, Next enabled
    expect(screen.getByText(/Showing 1/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
  })

  it('hides the pager when the whole result set fits on one page', async () => {
    mockEnvelope = { trades: makePage(3), total: 3, limit: PAGE, offset: 0 }
    renderTab()
    await screen.findByTestId('trades-table')
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
  })

  it('reads an UNPAGED summary set (full book) for the StatsGrid, distinct from the paged table fetch', async () => {
    // B5 pagination leak: the codec always emits limit=50&offset=0, correct for
    // the TABLE but wrong for the KPI summary. The tab issues a SEPARATE read
    // with paging stripped so the StatsGrid summarizes ALL 120 closed trades
    // (not just the 50-row page). Prove BOTH reads happen: one paged, one not.
    mockEnvelope = { trades: makePage(PAGE), total: 120, limit: PAGE, offset: 0 }
    renderTab()
    await screen.findByText(/of 120/)
    // the paged TABLE fetch carries limit + offset…
    expect(
      capturedUrls.some((u) => u.includes('limit=50') && u.includes('offset=')),
    ).toBe(true)
    // …and a distinct SUMMARY fetch carries neither (full match set → StatsGrid).
    expect(
      capturedUrls.some(
        (u) =>
          u.includes('/api/j2/trades') &&
          !u.includes('limit=') &&
          !u.includes('offset='),
      ),
    ).toBe(true)
  })

  it('clicking Next advances the offset and refetches', async () => {
    mockEnvelope = { trades: makePage(PAGE), total: 120, limit: PAGE, offset: 0 }
    const user = userEvent.setup()
    renderTab()
    await screen.findByText(/of 120/)
    expect(lastPagedUrl).toContain('offset=0')

    await user.click(screen.getByRole('button', { name: 'Next' }))
    // page 2: refetch carried offset=50 and the indicator advanced to 51–100
    expect(await screen.findByText(/Showing 51/)).toBeInTheDocument()
    expect(lastPagedUrl).toContain('offset=50')
    expect(screen.getByRole('button', { name: 'Prev' })).toBeEnabled()
  })

  it('disables Next on the last page', async () => {
    // total 60 → page 1 is rows 1–50, page 2 is rows 51–60 (last).
    mockEnvelope = { trades: makePage(PAGE), total: 60, limit: PAGE, offset: 0 }
    const user = userEvent.setup()
    renderTab()
    await screen.findByText(/of 60/)
    // Page 2 returns the tail (10 rows) → Next disabled (50 + 10 >= 60).
    mockEnvelope = { trades: makePage(10), total: 60, limit: PAGE, offset: 50 }
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText(/Showing 51/)
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('a scope/filter change resets paging back to page 0', async () => {
    mockEnvelope = { trades: makePage(PAGE), total: 120, limit: PAGE, offset: 0 }
    const user = userEvent.setup()
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter initialEntries={['/journal']}>
          <FilterButton />
          <TradeJournalTab settings={SETTINGS} />
        </MemoryRouter>
      </SWRConfig>,
    )
    await screen.findByText(/of 120/)
    // advance to page 2
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText(/Showing 51/)
    // change a filter → offset snaps back to page 0 (never strand on page 2). The
    // reset effect fires the render after apiParams changes, so wait for BOTH the
    // new facet AND the reset offset to settle on the final fetch URL.
    await user.click(screen.getByRole('button', { name: 'apply-filter' }))
    await waitFor(() => {
      expect(lastPagedUrl).toContain('symbol=ZZZ')
      expect(lastPagedUrl).toContain('offset=0')
    })
  })
})
