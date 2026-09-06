// Watchlist Intelligence V1 (owner authorization) — the deterministic "why is
// this active" layer + the Compare exit this program adds to the row menu.
//
// Drives the SCOPED (pickList) mode only — per Watchlists.jsx's own header the
// unscoped mode ships nowhere.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

// ── Heavy leaves that never render in embedded mode but cost real import time ──
vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../utils/prefetchBars', () => ({
  prefetchBars: () => {}, prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {},
  prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {}, warmMemFromIDB: () => {},
  prewarmVisibleList: () => {},
}))
vi.mock('../lib/chartReadoutStore', () => ({
  subscribeChartReadouts: () => () => {}, getChartReadout: () => null, hasFreshReadouts: () => false,
}))

// A minimal SymbolSearch stub: renders a button that, when clicked, "picks"
// MSFT — enough to drive the Compare flow without a real predictive dropdown.
// `openWith` on the ref is a no-op (CompareSearch calls it optionally via `?.`).
vi.mock('../components/chart/SymbolSearch', () => ({
  default: ({ onSymbolChange }) => (
    <button type="button" onClick={() => onSymbolChange('MSFT')}>pick MSFT</button>
  ),
}))

const WL = {
  id: 'wl1', name: 'Momentum Plays', description: '',
  items: [{ id: 'i1', sym: 'AAPL', notes: '' }, { id: 'i2', sym: 'TSLA', notes: '' }],
}
const mutateMine = vi.fn()
vi.mock('swr', () => ({
  default: (key) => {
    if (key === '/api/watchlists') return { data: [WL], mutate: mutateMine }
    if (key === '/api/watchlists/public') return { data: [], mutate: () => {} }
    if (key === '/api/watchlists/prebuilt') return { data: [], mutate: () => {} }
    return { data: [], mutate: () => {} }
  },
}))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'user', display_name: 'Pat' } }),
}))
vi.mock('../hooks/useFlagged', () => ({
  useFlagged: () => ({
    flagged: [], toggle: () => {}, remove: () => {}, isFlagged: () => false,
    isShared: false, toggleShare: () => {}, flaggedName: 'Flagged', renameFlagged: () => {},
  }),
}))
vi.mock('../hooks/useTickerTags', () => ({
  default: () => ({
    tags: {}, setTag: () => {}, removeTag: () => {}, getTag: () => null,
    shared: [], isColorShared: () => false, toggleShareColor: () => {}, communityTags: [],
  }),
}))
vi.mock('../hooks/useWatchlistAlerts', () => ({
  default: () => ({
    alerts: [], createAlert: () => {}, deleteAlert: () => {}, getAlertsForSym: () => [], hasAlert: () => false,
  }),
}))
vi.mock('../hooks/useTagColors', () => ({
  default: () => ({ tagColors: [], tagByKey: {}, setTagLabel: () => {} }),
}))
vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: () => {}, loading: false }),
  parsePref: (raw, fallback) => fallback,
}))
vi.mock('../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: {}, isLoading: false, isStreaming: false, staleSymbols: new Set() }),
}))
vi.mock('../hooks/useWatchlistPerformance', () => ({ default: () => ({ perfData: {}, isLoading: false }) }))
vi.mock('../hooks/useWatchlistMeta', () => ({ default: () => ({ metaData: {}, isLoading: false }) }))
vi.mock('../hooks/useWatchlistThemes', () => ({ default: () => ({ themeData: {}, isLoading: false }) }))
// AAPL is notable (a fact fired); TSLA is not — this is the fixture the sort
// test depends on. Deliberately alphabetically "backwards" from what a
// notable-first sort should produce, so the test can't pass by accident of
// the original list order.
vi.mock('../hooks/useWatchlistIntelligence', () => ({
  default: () => ({
    intelData: {
      AAPL: { status: 'ok', notable: true, facts: [
        { kind: 'analyst_action', label: 'Piper Sandler: Upgrade', as_of: '2026-09-01', source: 'FMP', freshness: 'fresh' },
      ] },
      TSLA: { status: 'ok', notable: false, facts: [] },
    },
    isLoading: false,
  }),
}))
vi.mock('../hooks/useBreakpoint', () => ({
  useIsTouch: () => false, useIsPhone: () => false, useIsTablet: () => false, useIsDesktop: () => true,
  useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))
vi.mock('./charts/ChartsSymContext', () => ({
  ChartsSymContext: { Provider: ({ children }) => children },
  useChartsSym: () => ({ sym: null, setSym: () => {} }),
}))
const navigateMock = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }))

const Watchlists = (await import('./Watchlists')).default

beforeEach(() => {
  mutateMine.mockClear()
  navigateMock.mockClear()
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

// The Attention column is opt-in via the same "+"-configurable column system as
// RVOL/DCR/etc — passing it pre-included in defaultColCfg exercises the exact
// same orderedKeys path a user's saved column layout would, without needing to
// drive the "+" menu UI (already covered by the pre-existing column tests).
function renderWithAttentionColumn() {
  return render(
    <Watchlists embedded pickList="user:wl1" pickName="Momentum Plays"
      defaultColCfg={{ order: ['flag', 'sym', 'price', 'vol', 'chg', 'attention'] }} />
  )
}

test('a notable row shows the Attention badge; a non-notable row does not', async () => {
  renderWithAttentionColumn()
  expect(await screen.findByText('AAPL')).toBeInTheDocument()
  const aaplRow = screen.getByText('AAPL').closest('[data-watch-sym="AAPL"]')
  const tslaRow = screen.getByText('TSLA').closest('[data-watch-sym="TSLA"]')
  expect(within(aaplRow).getByRole('button', { name: /thing.*to know/i })).toBeInTheDocument()
  expect(within(tslaRow).queryByRole('button', { name: /thing.*to know/i })).not.toBeInTheDocument()
})

test('clicking the Attention badge opens a popover listing the fired fact with its evidence date and source', async () => {
  const user = userEvent.setup()
  renderWithAttentionColumn()
  await screen.findByText('AAPL')
  const aaplRow = screen.getByText('AAPL').closest('[data-watch-sym="AAPL"]')

  await user.click(within(aaplRow).getByRole('button', { name: /thing.*to know/i }))

  expect(await screen.findByText(/piper sandler: upgrade/i)).toBeInTheDocument()
  expect(screen.getByText(/as of 2026-09-01/i)).toBeInTheDocument()
  expect(screen.getByText(/fmp/i)).toBeInTheDocument()
})

test('sorting by Attention puts the notable row first, deterministically', async () => {
  const user = userEvent.setup()
  renderWithAttentionColumn()
  await screen.findByText('AAPL')

  await user.click(screen.getByText('Attention'))

  const rows = screen.getAllByText(/^(AAPL|TSLA)$/).map(el => el.textContent)
  expect(rows.indexOf('AAPL')).toBeLessThan(rows.indexOf('TSLA'))
})

test('the row menu offers Compare, and picking a comparator routes to the canonical Comparison V1 route', async () => {
  const user = userEvent.setup()
  renderWithAttentionColumn()
  await screen.findByText('AAPL')

  await user.pointer({ keys: '[MouseRight]', target: screen.getByText('AAPL') })
  await user.click(screen.getByRole('button', { name: /compare aapl with/i }))
  await user.click(await screen.findByText('pick MSFT'))

  expect(navigateMock).toHaveBeenCalledWith('/research/AAPL/compare/MSFT')
})
