// Watchlists — COV-06 follow-up wiring on the real page (mock set copied from
// Watchlists.copyorlink.test.jsx): version history on a member's own list and
// "Recently deleted". The fetch stub answers like `api/routers/artifact_versions.py`
// (whose rows are railed on real stores in tests/test_artifact_versions_followups.py).
//   * dark (status 404) => no Recently deleted, no Version history menu entry;
//   * armed => a deleted list is offered BY NAME and "Bring back" posts the head
//     version compare-and-set, then says it is back;
//   * armed => the list-header menu opens that list's history.
import { render, screen, fireEvent, act } from '@testing-library/react'
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
const PLAIN = { id: 'wl1', user_id: 'u1', name: 'Momentum Plays', description: '', items: [{ id: 'i1', sym: 'AAPL', notes: '' }] }
let mockMine = [PLAIN]
vi.mock('swr', () => ({
  default: (key) => {
    if (key === '/api/watchlists') return { data: mockMine, mutate: () => {} }
    return { data: [], mutate: () => {} }
  },
}))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'user', display_name: 'Pat' }, watchlistCopyOrLinkEnabled: false }),
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

const res = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })
let armed = false
let deleted = []
let calls = []
beforeEach(() => {
  localStorage.clear()
  mockMine = [PLAIN]
  armed = false
  deleted = [{ artifact_id: 'wl9', label: 'Old swing', head: 3, deleted_at: 1_800_000_000 }]
  calls = []
  vi.stubGlobal('fetch', vi.fn((url, init) => {
    calls.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null })
    if (url === '/api/artifact-versions/status') return armed ? res(200, { enabled: true }) : res(404, { detail: 'Not Found' })
    if (url === '/api/artifact-versions/watchlist/deleted') return armed ? res(200, { kind: 'watchlist', deleted }) : res(404, {})
    if (url === '/api/artifact-versions/watchlist/wl9/undelete') {
      deleted = []
      return res(200, { kind: 'watchlist', artifact_id: 'wl9', version: 4, artifact: { id: 'wl9', name: 'Old swing' } })
    }
    if (url === '/api/artifact-versions/watchlist/wl1') {
      return res(200, { head: 2, versions: [
        { version: 2, source: 'save', label: 'Momentum Plays', created_at: 1_800_000_120 },
        { version: 1, source: 'baseline', label: 'Momentum Plays', created_at: 1_800_000_000 }] })
    }
    return res(200, {})
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

const settle = () => act(async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve() })

test('dark: no Recently deleted and no Version history entry', async () => {
  render(<Watchlists />)
  await settle()
  expect(screen.getByText('Momentum Plays')).toBeInTheDocument()     // non-vacuity: the list IS drawn
  expect(screen.queryByText(/Recently deleted/)).toBeNull()
  fireEvent.contextMenu(screen.getByText('Momentum Plays'))
  expect(screen.getByText('Copy list to clipboard')).toBeInTheDocument()   // the menu IS open
  expect(screen.queryByText('Version history')).toBeNull()
  expect(calls.some(c => c.url.endsWith('/deleted'))).toBe(false)
})

test('armed: a deleted list is offered by name and Bring back restores its head, compare-and-set', async () => {
  armed = true
  render(<Watchlists />)
  await settle()
  fireEvent.click(screen.getByRole('button', { name: 'Recently deleted (1)' }))
  expect(screen.getByText('Old swing')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Bring back Old swing' }))
  await settle()
  const post = calls.find(c => c.method === 'POST')
  expect(post).toEqual({ url: '/api/artifact-versions/watchlist/wl9/undelete', method: 'POST', body: { version: 3, base_version: 3 } })
  expect(screen.getByTestId('recently-deleted-watchlist').textContent).toContain('“Old swing” is back.')
  expect(screen.queryByRole('button', { name: 'Bring back Old swing' })).toBeNull()
})

test('armed: the list-header menu opens that list’s version history', async () => {
  armed = true
  render(<Watchlists />)
  await settle()
  fireEvent.contextMenu(screen.getByText('Momentum Plays'))
  fireEvent.click(screen.getByText('Version history'))
  await settle()
  expect(screen.getByText('Version history · Momentum Plays')).toBeInTheDocument()
  expect(screen.getByTestId('artifact-version-1').textContent).toContain('As it was before this history began')
  expect(screen.getByRole('button', { name: 'Restore version 1' })).toBeInTheDocument()
})
