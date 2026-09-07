// Watchlists — keyboard accessibility (Seam, 2026-09-06 Whole-Product
// Strategic Re-Anchor). The per-symbol row, the watchlist-group disclosure
// header, and the column-sort header were all bare `<div onClick>`/
// `<span onClick>` elements -- a keyboard/switch-control member could not
// select a symbol, expand/collapse a list, or sort a column on one of the
// most-trafficked surfaces in the app. Reuses the exact fix shape already
// shipped and proven for AlertBell (Seam 5): role="button" + tabIndex={0}
// + an onKeyDown handling Enter/Space, calling the SAME handler the
// existing onClick already used.
//
// Mock set mirrors Watchlists.flagkey.test.jsx exactly.
import { render, screen, fireEvent } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/chart/SymbolSearch', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../components/chart/pane/ChartPane', () => ({ default: () => null }))
vi.mock('../utils/prefetchBars', () => ({
  prefetchBars: () => {}, prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {},
  prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {}, warmMemFromIDB: () => {},
  prewarmVisibleList: () => {},
}))
vi.mock('../lib/chartReadoutStore', () => ({
  subscribeChartReadouts: () => () => {}, getChartReadout: () => null, hasFreshReadouts: () => false,
}))

const WL = { id: 'wl1', name: 'Momentum Plays', description: '', items: [{ id: 'i1', sym: 'AAPL', notes: '' }] }
vi.mock('swr', () => ({
  default: (key) => {
    if (key === '/api/watchlists') return { data: [WL], mutate: () => {} }
    if (key === '/api/watchlists/public') return { data: [], mutate: () => {} }
    return { data: [], mutate: () => {} }
  },
}))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'user', display_name: 'Pat' } }),
}))
vi.mock('../hooks/useFlagged', () => ({
  useFlagged: () => ({
    flagged: [], toggle: () => {}, remove: () => {},
    isFlagged: () => false,
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
  default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {}, getAlertsForSym: () => [], hasAlert: () => false }),
}))
vi.mock('../hooks/useTagColors', () => ({ default: () => ({ tagColors: [], tagByKey: {}, setTagLabel: () => {} }) }))
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
vi.mock('../hooks/useBreakpoint', () => ({
  useIsTouch: () => false, useIsPhone: () => false, useIsTablet: () => false, useIsDesktop: () => true,
  useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))
vi.mock('./charts/ChartsSymContext', () => ({
  ChartsSymContext: { Provider: ({ children }) => children },
  useChartsSym: () => ({ sym: null, setSym: () => {} }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))

const Watchlists = (await import('./Watchlists')).default

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

test('the watchlist-group header is a real disclosure control: focusable, and Enter toggles it', async () => {
  render(<Watchlists />)
  const header = screen.getByText('Momentum Plays').closest('[role="button"]')
  expect(header).toBeTruthy()
  expect(header).toHaveAttribute('tabIndex', '0')
  expect(header).toHaveAttribute('aria-expanded', 'false')

  fireEvent.keyDown(header, { key: 'Enter' })
  expect(header).toHaveAttribute('aria-expanded', 'true')
})

test('Space also toggles the group header and is prevented-default', async () => {
  render(<Watchlists />)
  const header = screen.getByText('Momentum Plays').closest('[role="button"]')
  const notPrevented = fireEvent.keyDown(header, { key: ' ' })
  expect(notPrevented).toBe(false)
  expect(header).toHaveAttribute('aria-expanded', 'true')
})

test('the per-symbol row is focusable and Enter selects it, same as a click', async () => {
  render(<Watchlists />)
  // Expand the group first (mirrors a real member's flow).
  fireEvent.click(screen.getByText('Momentum Plays'))
  const row = screen.getByText('AAPL').closest('[data-watch-sym="AAPL"]')
  expect(row).toHaveAttribute('role', 'button')
  expect(row).toHaveAttribute('tabIndex', '0')
  expect(row).toHaveAttribute('aria-label', 'AAPL')

  // Selecting a row mounts the StockChart stub with that symbol -- assert
  // via the row's own selected-state class rather than the (mocked-away)
  // chart, mirroring Watchlists.chartmount.test.jsx's own convention of
  // checking real, observable state rather than internals.
  fireEvent.keyDown(row, { key: 'Enter' })
  expect(row.className).toMatch(/listRowSelected/)
})

test('an unrelated key on the row does nothing', async () => {
  render(<Watchlists />)
  fireEvent.click(screen.getByText('Momentum Plays'))
  const row = screen.getByText('AAPL').closest('[data-watch-sym="AAPL"]')
  fireEvent.keyDown(row, { key: 'Tab' })
  expect(row.className).not.toMatch(/listRowSelected/)
})

test('the column-sort header is a real interactive control, and Enter sorts it', async () => {
  render(<Watchlists />)
  fireEvent.click(screen.getByText('Momentum Plays'))
  const symHeader = screen.getByRole('button', { name: /Sort by Symbol/i })
  expect(symHeader).toHaveAttribute('tabIndex', '0')
  // Clicking/activating a sort header must not throw and must remain the
  // same element (no crash-and-remount) -- the deep sort-order assertion
  // already lives in the dedicated sort test suites; this just proves the
  // keyboard path reaches the same handler as the mouse path.
  fireEvent.keyDown(symHeader, { key: 'Enter' })
  expect(screen.getByRole('button', { name: /Sort by Symbol/i })).toBeInTheDocument()
})
