// The watchlist on a hidden LAYER keep-alive board (2026-11-27, review of #2901, H1). A kept board stays mounted, so its
// list's window key handler would still answer: ArrowDown on the board in front would move a list nobody sees and
// switch the front board's linked charts, and Shift+F would flag its hidden selection.
//   WK1 (red first) a hidden layer board's list answers no Shift+F, ArrowDown or Space; shown, it answers again
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

// ── The hook under observation. `flagged` starts EMPTY: the scanning case. ──
const flagSpy = { toggle: vi.fn(), remove: vi.fn(), flagged: [] }
vi.mock('../hooks/useFlagged', () => ({
  useFlagged: () => ({
    flagged: flagSpy.flagged, toggle: flagSpy.toggle, remove: flagSpy.remove,
    isFlagged: (s) => flagSpy.flagged.includes(s),
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
const symSpy = vi.hoisted(() => ({ set: null }))
vi.mock('./charts/ChartsSymContext', () => ({
  ChartsSymContext: { Provider: ({ children }) => children },
  useChartsSym: () => ({ sym: null, setSym: (...a) => symSpy.set?.(...a) }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))

const Watchlists = (await import('./Watchlists')).default

beforeEach(() => {
  localStorage.clear()
  flagSpy.toggle.mockClear(); flagSpy.remove.mockClear(); flagSpy.flagged = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

const { BoardVisibilityContext, createBoardVisibility } = await import('../components/chart/boardVisibility')

test('WK1 (red first) a hidden layer board list answers no key; shown, it does', async () => {
  const user = userEvent.setup()
  symSpy.set = vi.fn()
  const vis = createBoardVisibility({ layer: true })
  render(<BoardVisibilityContext.Provider value={vis}><Watchlists pickList="user:wl1" pickName="Momentum Plays" /></BoardVisibilityContext.Provider>)
  await user.click(screen.getByText('AAPL'))
  fireEvent.keyDown(window, { key: 'F', code: 'KeyF', shiftKey: true })
  expect(flagSpy.toggle, 'NON-VACUITY: a shown list flags its selection').toHaveBeenCalledTimes(1)
  act(() => { vis.set('hidden') })
  flagSpy.toggle.mockClear()
  symSpy.set.mockClear()
  fireEvent.keyDown(window, { key: 'F', code: 'KeyF', shiftKey: true })
  fireEvent.keyDown(window, { key: 'ArrowDown', code: 'ArrowDown' })
  fireEvent.keyDown(window, { key: 'ArrowUp', code: 'ArrowUp' })
  fireEvent.keyDown(window, { key: ' ', code: 'Space' })
  expect(flagSpy.toggle, 'a hidden board list flagged its selection').not.toHaveBeenCalled()
  expect(symSpy.set, 'a hidden board list switched the linked charts').not.toHaveBeenCalled()
  act(() => { vis.set('visible') })
  fireEvent.keyDown(window, { key: 'F', code: 'KeyF', shiftKey: true })
  expect(flagSpy.toggle).toHaveBeenCalledTimes(1)
})
