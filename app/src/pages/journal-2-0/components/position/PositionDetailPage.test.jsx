import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PositionDetailPage, { combinePositions, idsBySide } from './PositionDetailPage'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigateMock }))

// The page now mounts ChartPane (the same chart /charts renders) instead of a
// bare StockChart. ChartPane is lazy + imports the very same StockChart module,
// so stubbing it here still covers the pane's inner chart.
vi.mock('../../../../components/StockChart', () => ({
  default: ({ sym, tf }) => <div data-testid="chart">{sym}:{tf}</div>,
}))
vi.mock('../../../../components/CompanyLogo', () => ({
  default: ({ sym }) => <span data-testid={`logo-${sym}`} />,
}))
// ChartPane calls useFlagged() (Shift+F flag toast, flag button state), which
// reads useAuth() — stub it logged-out so that call doesn't throw "useAuth
// must be used within AuthProvider" (this file renders without an AuthProvider).
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
// The canonical SymbolSearch component has its own dedicated coverage
// elsewhere; stub it here exactly as TickerPopup.test.jsx does so the Compare
// action can be exercised without its real dropdown/fetch machinery. The
// stub deliberately hands back a LOWERCASE comparator so these tests pin
// this page's own uppercasing, not SymbolSearch's.
vi.mock('../../../../components/chart/SymbolSearch', () => ({
  default: ({ sym, onSymbolChange, displayLabel }) => (
    <button onClick={() => onSymbolChange('msft')}>{displayLabel || sym || 'search'}</button>
  ),
}))
vi.mock('../../../../hooks/useFundamentalSnapshot', () => ({
  default: () => ({
    data: {
      name: 'Apple Inc.',
      sector: 'Technology',
      industry: 'Consumer Electronics',
      about: 'Apple designs consumer electronics.',
      composite: 92,
      metrics: { market_cap: '$3.30T', pe_forward: 28.5, div_yield_pct: 0.5, week52_high: 260, week52_low: 164 },
    },
    isLoading: false,
  }),
}))
vi.mock('../../../../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: { AAPL: { price: 110, change_pct: 2, prev_close: 107.84 } }, isStreaming: true }),
}))
vi.mock('../../../../hooks/useEarningsTable', () => ({
  default: () => ({
    data: {
      quarterly: [
        { label: 'Q1 26', eps_actual: 2.4, eps_estimate: 2.2, eps_surprise_pct: 9.1 },
      ],
    },
  }),
}))
vi.mock('../../hooks/useJ2Positions', () => ({
  default: () => ({
    positions: [
      { id: 1, symbol: 'AAPL', side: 'Long', shares: 10, entryPrice: 100, entryDate: '2026-06-01' },
      { id: 7, symbol: 'MSFT', side: 'Long', shares: 3, entryPrice: 400, entryDate: '2026-06-01' },
    ],
    isLoading: false, error: null, refresh: vi.fn(),
  }),
}))
vi.mock('../../hooks/useJ2Trades', () => ({
  default: () => ({
    trades: [
      {
        id: 't1', symbol: 'AAPL', side: 'Long', shares: 5, entryPrice: 90, exitPrice: 95,
        entryDate: '2026-05-01', exitDate: '2026-05-10', pnlDollar: 25, setup: 'VCP',
      },
      { id: 't2', symbol: 'MSFT', side: 'Long', shares: 1, entryPrice: 1, exitPrice: 2, pnlDollar: 1 },
    ],
    isLoading: false, error: null,
  }),
}))
vi.mock('../../hooks/useJ2SelectedAccount', () => ({
  default: () => ({
    accountId: 'a1',
    account: { id: 'a1', balanceSource: 'broker', brokerTotalEquity: 11000 },
    accounts: [{ id: 'a1', balanceSource: 'broker', brokerTotalEquity: 11000 }],
  }),
}))

// Attention Signal Propagation V1 — same hook PortfolioAttentionBanner uses,
// reused verbatim (no new endpoint). Defaults to an empty map so every
// pre-existing test in this file (none of which cares about Attention) sees
// no change; the dedicated describe block below overrides per test.
const mockUseAttention = vi.fn(() => ({ attention: {}, isLoading: false, error: null }))
vi.mock('../../hooks/useJ2PositionsAttention', () => ({
  default: () => mockUseAttention(),
}))

const swrData = {
  '/api/bars/AAPL?tf=D&bars=30': {
    bars: [
      { t: 1, o: 100, h: 105, l: 99, c: 104, v: 1_000_000 },
      { t: 2, o: 104, h: 111, l: 103, c: 110, v: 2_000_000 },
    ],
  },
  '/api/chart-news/AAPL?days=30': {
    news: [{ headline: 'Apple ships widget', source: 'CNBC', url: 'https://x.test/a', time_published: 1750000000 }],
  },
  '/api/earnings/analyst-grades/AAPL': {
    consensus: { strongBuy: 12, buy: 8, hold: 5, sell: 3, strongSell: 2, total: 30, label: 'Buy' },
    price_target: { consensus: 250 },
  },
  // P1-19 fix: LinkedNotesPanel's own useSWR call resolves through this same
  // mocked 'swr' module -- AAPL's fixture position id is 1 (see
  // useJ2Positions mock above), so this is the exact key it computes.
  '/api/j2/notes/by-trade-ref?tradeRef=1&tradeRefType=position': {
    notes: [{ id: 'n1', title: 'AAPL thesis' }],
  },
}
vi.mock('swr', () => ({
  default: (key) => ({ data: key ? swrData[key] ?? null : null }),
}))

function renderPage(sym = 'AAPL') {
  return render(
    <MemoryRouter initialEntries={[`/journal-2-0/position/${sym}`]}>
      <Routes>
        <Route path="/journal-2-0/position/:sym" element={<PositionDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('combinePositions', () => {
  it('merges same-side rows into total shares + weighted avg cost', () => {
    const rows = combinePositions([
      { id: 1, side: 'Long', shares: 10, entryPrice: 100, entryDate: '2026-06-05' },
      { id: 2, side: 'Long', shares: 10, entryPrice: 200, entryDate: '2026-06-01' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].shares).toBe(20)
    expect(rows[0].entryPrice).toBe(150)
    expect(rows[0].entryDate).toBe('2026-06-01')
  })

  it('keeps long and short separate', () => {
    const rows = combinePositions([
      { id: 1, side: 'Long', shares: 10, entryPrice: 100, entryDate: '2026-06-01' },
      { id: 2, side: 'Short', shares: 5, entryPrice: 200, entryDate: '2026-06-01' },
    ])
    expect(rows).toHaveLength(2)
  })
})

describe('PositionDetailPage — cross-link actions (Full Research / Ask AI / Compare)', () => {
  beforeEach(() => {
    navigateMock.mockClear()
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
  })

  it('Full Research navigates to the canonical /research/:sym route', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /full research/i }))
    expect(navigateMock).toHaveBeenCalledWith('/research/AAPL')
  })

  it('Ask AI navigates to the same route with ?section=ai', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /ask ai/i }))
    expect(navigateMock).toHaveBeenCalledWith('/research/AAPL?section=ai')
  })

  it('Compare reveals the "+ Compare" picker, and a comparator navigates to the exact canonical compare route (uppercased)', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /^compare$/i }))
    fireEvent.click(screen.getByRole('button', { name: '+ Compare' }))
    expect(navigateMock).toHaveBeenCalledWith('/research/AAPL/compare/MSFT')
  })
})

describe('PositionDetailPage', () => {
  it('renders header, chart, and every RH section for the symbol', async () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'AAPL' })).toBeInTheDocument()
    expect(screen.getByText('Apple Inc.')).toBeInTheDocument()
    expect(screen.getByText('$110.00')).toBeInTheDocument()
    // ChartPane is a lazy chunk, heavier than bare StockChart was — under
    // full-suite parallel load the Suspense fallback can still be up when the
    // default 1000ms findBy timeout fires, so give it real headroom.
    expect(await screen.findByTestId('chart', {}, { timeout: 8000 })).toHaveTextContent('AAPL:D')
    expect(screen.getByText('Your Position')).toBeInTheDocument()
    expect(screen.getByText('About')).toBeInTheDocument()
    expect(screen.getByText('Stats')).toBeInTheDocument()
    expect(screen.getByText('News')).toBeInTheDocument()
    expect(screen.getByText('Analyst Ratings')).toBeInTheDocument()
    expect(screen.getByText('Earnings')).toBeInTheDocument()
    expect(screen.getByText('History')).toBeInTheDocument()
  })

  it('Your Position shows the six figures from the open AAPL position only', () => {
    renderPage()
    expect(screen.getByText('Market value')).toBeInTheDocument()
    expect(screen.getByText('$1,100.00')).toBeInTheDocument()      // 10 × 110
    expect(screen.getByText('Average cost')).toBeInTheDocument()
    expect(screen.getByText('10.00%')).toBeInTheDocument()          // 1100 / 11000 diversity
  })

  it('History lists only this symbol: the open entry + the AAPL closed trade', () => {
    renderPage()
    expect(screen.getByText('OPEN')).toBeInTheDocument()
    expect(screen.getByText(/90\.00.*95\.00/)).toBeInTheDocument()
    expect(screen.queryByText(/1\.00.*2\.00/)).toBeNull()           // MSFT trade filtered out
  })

  it('analyst bar reflects RH bucketing', () => {
    renderPage()
    expect(screen.getByText(/of 30 analysts rate it Buy/)).toBeInTheDocument()
    expect(screen.getByText('UCT Rating 92')).toBeInTheDocument()
  })
})

describe('PositionDetailPage — History click-through (Journal / Trade Lifecycle Convergence V1)', () => {
  beforeEach(() => {
    navigateMock.mockClear()
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
  })

  it('clicking the closed AAPL trade row navigates to its real j2_trades.id detail page', () => {
    renderPage()
    fireEvent.click(screen.getByText(/90\.00.*95\.00/))
    expect(navigateMock).toHaveBeenCalledWith('/journal-2-0/trade/t1')
  })

  it('the OPEN position row is not clickable (no navigation on click)', () => {
    renderPage()
    fireEvent.click(screen.getByText('OPEN'))
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('keyboard Enter on the closed-trade row also navigates', () => {
    renderPage()
    const row = screen.getByText(/90\.00.*95\.00/).closest('li')
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(navigateMock).toHaveBeenCalledWith('/journal-2-0/trade/t1')
  })
})

describe('PositionDetailPage — Attention (Attention Signal Propagation V1)', () => {
  beforeEach(() => {
    mockUseAttention.mockReset()
    mockUseAttention.mockReturnValue({ attention: {}, isLoading: false, error: null })
  })

  it('renders nothing when the symbol has no open position (attention map has no entry)', () => {
    // AAPL IS an open position in this file's fixtures, but the batch
    // endpoint scopes to currently-held symbols — an empty map here models
    // "not yet loaded" / "no entry for this symbol", and the page's existing
    // null-safe convention hides the section rather than rendering a
    // false-empty card.
    renderPage()
    expect(screen.queryByTestId('position-attention')).not.toBeInTheDocument()
  })

  it('renders the same fact vocabulary as PortfolioAttentionBanner when the batch endpoint has an entry for this symbol', () => {
    mockUseAttention.mockReturnValue({
      isLoading: false,
      error: null,
      attention: {
        AAPL: {
          status: 'ok',
          notable: true,
          facts: [
            { kind: 'price_move', label: 'Moving +5.2% today', as_of: '2026-09-05', source: 'live price', freshness: 'fresh' },
          ],
          context: { composite_rating: 92, rs_rank: 88 },
        },
      },
    })
    renderPage()
    const card = screen.getByTestId('position-attention')
    expect(card).toHaveTextContent('Moving +5.2% today')
    expect(card).toHaveTextContent('2026-09-05')
    expect(screen.getByLabelText('AAPL notable')).toBeInTheDocument()
    // S8 / Attention Freshness Propagation V1 — source/freshness are fetched
    // by the hook already; this surface previously discarded them before
    // render even though Watchlists.jsx's identical popover already showed them.
    expect(card).toHaveTextContent('live price')
    expect(card).toHaveTextContent('fresh')
  })

  it('shows "Nothing notable" for a non-notable held symbol, never fabricating a fact', () => {
    mockUseAttention.mockReturnValue({
      isLoading: false,
      error: null,
      attention: { AAPL: { status: 'ok', notable: false, facts: [], context: {} } },
    })
    renderPage()
    const card = screen.getByTestId('position-attention')
    expect(card).toHaveTextContent('Nothing notable')
    expect(screen.queryByLabelText('AAPL notable')).not.toBeInTheDocument()
  })

  it('surfaces a degraded status pill rather than hiding it silently', () => {
    mockUseAttention.mockReturnValue({
      isLoading: false,
      error: null,
      attention: { AAPL: { status: 'partial', notable: false, facts: [], context: {} } },
    })
    renderPage()
    expect(screen.getByTitle('Data partial')).toBeInTheDocument()
  })

  // S8 / Attention Freshness Propagation V1 — a total fetch failure must NOT
  // collapse into the same "section hidden" state as "no open position": a
  // real outage previously read as reassuring silence, indistinguishable from
  // the symbol simply not being held.
  it('renders a distinct "could not check" state on a total fetch failure, never silence', () => {
    mockUseAttention.mockReturnValue({ attention: {}, isLoading: false, error: new Error('500') })
    renderPage()
    expect(screen.getByTestId('position-attention-unavailable')).toBeInTheDocument()
    expect(screen.getByText('Could not check for updates')).toBeInTheDocument()
    expect(screen.queryByTestId('position-attention')).not.toBeInTheDocument()
  })

  it('reads a different symbol\'s attention entry on symbol change (no stale prior-symbol card)', () => {
    mockUseAttention.mockReturnValue({
      isLoading: false,
      error: null,
      attention: {
        AAPL: { status: 'ok', notable: true, facts: [{ kind: 'price_move', label: 'AAPL moved', as_of: '2026-09-05' }], context: {} },
        MSFT: { status: 'ok', notable: false, facts: [], context: {} },
      },
    })
    renderPage('MSFT')
    const card = screen.getByTestId('position-attention')
    expect(card).toHaveTextContent('Nothing notable')
    expect(card).not.toHaveTextContent('AAPL moved')
  })
})

describe('idsBySide (P1-19 fix)', () => {
  it('groups raw ids by side for the given symbol only', () => {
    const map = idsBySide([
      { id: 1, symbol: 'AAPL', side: 'Long' },
      { id: 2, symbol: 'AAPL', side: 'Long' },
      { id: 3, symbol: 'AAPL', side: 'Short' },
      { id: 4, symbol: 'MSFT', side: 'Long' },
    ], 'AAPL')
    expect(map.get('Long')).toEqual([1, 2])
    expect(map.get('Short')).toEqual([3])
    expect(map.has('MSFT')).toBe(false)
  })

  it('never drops a second raw id on the same side (the exact regression this fixes)', () => {
    // Two separate "Add Position" calls on the same symbol+side -- combinePositions
    // would merge these into one display block and keep only id 1, which is
    // exactly why the linked-notes lookup must read this, not that merged model.
    const map = idsBySide([
      { id: 1, symbol: 'AAPL', side: 'Long' },
      { id: 2, symbol: 'AAPL', side: 'Long' },
    ], 'AAPL')
    expect(map.get('Long')).toHaveLength(2)
  })

  it('is empty for a symbol with no positions', () => {
    const map = idsBySide([{ id: 1, symbol: 'MSFT', side: 'Long' }], 'AAPL')
    expect(map.size).toBe(0)
  })

  it('ignores rows with no id', () => {
    const map = idsBySide([{ id: null, symbol: 'AAPL', side: 'Long' }], 'AAPL')
    expect(map.size).toBe(0)
  })
})

describe('PositionDetailPage — linked research on the open position (P1-19 fix)', () => {
  it('shows the existing LinkedNotesPanel, reused verbatim, keyed to the raw position id', async () => {
    renderPage()
    const panel = await screen.findByTestId('linked-notes-panel')
    expect(panel).toHaveTextContent('AAPL thesis')
  })

  it('renders nothing extra for a symbol with no linked research (no forced empty state)', () => {
    // MSFT's fixture position id is 7; no swrData entry exists for that
    // tradeRef, so LinkedNotesPanel's own "notes.length === 0 -> null"
    // behavior (already covered by LinkedNotesPanel.test.jsx) applies here too.
    renderPage('MSFT')
    expect(screen.queryByTestId('linked-notes-panel')).not.toBeInTheDocument()
  })
})
