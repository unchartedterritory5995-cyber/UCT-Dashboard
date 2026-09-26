// Watchlists — A12 CP2 (2026-09-25): the chosen performance columns are a per-member
// SERVER preference (`watchlist_perf_cols`), hydrated once after prefs load and written
// on every change. ⚰️ They were `useState(new Set())` — a preset click died with the tab
// — which A12 CP1's rail (tests/test_a12_s6_consistency_rail.py) pinned as gap 1 by that
// literal; this file is the behavioural half of the flip. Mock set mirrors
// Watchlists.keyboard.test.jsx; only usePreferences differs, because it is the subject.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

// ── the subject ────────────────────────────────────────────────────────────────
let mockPrefs = {}
let mockLoading = false
const setPref = vi.fn()
vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, loading: mockLoading }),
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
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
  setPref.mockClear()
  mockPrefs = {}
  mockLoading = false
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

const KEY = 'watchlist_perf_cols'
const openColumnsPopover = () => fireEvent.click(screen.getByTitle('Toggle columns'))
const checkbox = (label) => screen.getByLabelText(label)

test('the saved preference HYDRATES the chosen columns: 1D and 1W checked, the rest not', async () => {
  mockPrefs = { [KEY]: JSON.stringify(['1d', '1w', 'not-a-column']) }
  render(<Watchlists />)
  openColumnsPopover()
  await waitFor(() => expect(checkbox('1D')).toBeChecked())
  expect(checkbox('1W')).toBeChecked()
  expect(checkbox('1M')).not.toBeChecked()
  expect(checkbox('3M')).not.toBeChecked()
  expect(checkbox('YTD')).not.toBeChecked()
  // hydration writes nothing back when the stored value already matches (after the unknown key is dropped it differs — see below)
})

test('a preset click WRITES the preference: "Performance" -> all five keys, as JSON', async () => {
  mockPrefs = {}
  render(<Watchlists />)
  openColumnsPopover()
  fireEvent.click(screen.getByText('Performance'))
  await waitFor(() => expect(setPref).toHaveBeenCalledWith(KEY, JSON.stringify(['1d', '1w', '1m', '3m', 'ytd'])))
})

test('a single checkbox change WRITES the preference with exactly the new set', async () => {
  mockPrefs = { [KEY]: JSON.stringify(['1d']) }
  render(<Watchlists />)
  openColumnsPopover()
  await waitFor(() => expect(checkbox('1D')).toBeChecked())
  fireEvent.click(checkbox('YTD'))
  await waitFor(() => expect(setPref).toHaveBeenCalledWith(KEY, JSON.stringify(['1d', 'ytd'])))
})

test('⛔ CONTROL — while prefs are still LOADING nothing hydrates and nothing is written (an empty prefs object before load is not "no columns chosen")', async () => {
  mockLoading = true
  mockPrefs = {}
  render(<Watchlists />)
  openColumnsPopover()
  expect(checkbox('1D')).not.toBeChecked()
  await new Promise((r) => setTimeout(r, 30))
  expect(setPref).not.toHaveBeenCalled()
})

test('unknown keys in a stale blob are dropped on read and the cleaned set is what gets written back', async () => {
  mockPrefs = { [KEY]: JSON.stringify(['1m', 'ghost']) }
  render(<Watchlists />)
  openColumnsPopover()
  await waitFor(() => expect(checkbox('1M')).toBeChecked())
  await waitFor(() => expect(setPref).toHaveBeenCalledWith(KEY, JSON.stringify(['1m'])))
})
