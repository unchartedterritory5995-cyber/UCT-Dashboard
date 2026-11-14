// The Watchlist's RS Exit column over the real Watchlists component: the batch is asked ONLY while the
// column is shown, and a row with a recent warning renders the coloured dot, the words and the tooltip.
// Scaffold copied from Watchlists.columnDrag.test.jsx. LOCAL, jsdom.
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect, describe } from 'vitest'

const exp = vi.hoisted(() => ({ quota: null, downloads: [] }))
vi.mock('../lib/dataExport', () => ({ exportQuota: async () => exp.quota, downloadExport: async (path, opts) => { exp.downloads.push([path, opts]); return true } }))

// ── Heavy leaves that never render in embedded mode but cost real import time ──
vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/chart/SymbolSearch', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../utils/prefetchBars', () => ({
  prefetchBars: () => {}, prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {},
  prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {}, warmMemFromIDB: () => {},
  prewarmVisibleList: () => {},
}))
vi.mock('../lib/chartReadoutStore', () => ({
  subscribeChartReadouts: () => () => {}, getChartReadout: () => null, hasFreshReadouts: () => false,
}))

// ── Data hooks ──
// AAPL carries a note the user WROTE — it is the field the declutter orphaned, so
// seeing it in the editor is half the point of this restore.
const WL = {
  id: 'wl1', name: 'Momentum Plays', description: '',
  items: [{ id: 'i1', sym: 'AAPL', notes: 'waiting on the 50d reclaim' }, { id: 'i2', sym: 'MSFT', notes: '' }],
}
const COMMUNITY_WL = {
  id: 'cw1', name: "Ravi's Board", description: '', owner_name: 'Ravi',
  items: [{ id: 'ci1', sym: 'TSLA', notes: 'his note, not yours' }],
}
const mutateMine = vi.fn()
// Prebuilt rows are swapped per test (an alias pick needs one carrying `alias`).
const hoisted = vi.hoisted(() => ({ prebuilt: [], role: 'user', copyOrLink: false, toggleShare: null, flagged: ['NVDA'] }))
// Keys are matched on the PATH: the prebuilt catalogue is now requested as the
// slim directory (`?include_items=0`), and a prebuilt list's MEMBERSHIP arrives
// through a separate array-keyed fetch. Matching whole URL strings made this mock
// silently answer `[]` the moment a flag was added — which is how the page under
// test lost its rows without any production code being wrong.
const _key = (k) => (typeof k === 'string' ? k.split('?')[0] : null)
vi.mock('swr', () => ({
  default: (key) => {
    if (_key(key) === '/api/watchlists') return { data: [WL], mutate: mutateMine }
    if (_key(key) === '/api/watchlists/public') return { data: [COMMUNITY_WL], mutate: () => {} }
    if (_key(key) === '/api/watchlists/prebuilt') return { data: hoisted.prebuilt, mutate: () => {} }
    return { data: undefined, mutate: () => {} }
  },
}))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: hoisted.role, display_name: 'Pat' }, watchlistCopyOrLinkEnabled: hoisted.copyOrLink }),
}))
vi.mock('../hooks/useFlagged', () => ({
  useFlagged: () => ({
    flagged: hoisted.flagged, toggle: () => {}, remove: () => {}, isFlagged: () => false,
    isShared: false, toggleShare: (...a) => hoisted.toggleShare?.(...a), flaggedName: 'Flagged', renameFlagged: () => {},
  }),
}))
vi.mock('../hooks/useTickerTags', () => ({
  default: () => ({
    tags: {}, setTag: () => {}, removeTag: () => {}, getTag: () => null,
    shared: [], isColorShared: () => false, toggleShareColor: () => {}, communityTags: [],
  }),
}))
const createAlert = vi.fn()
vi.mock('../hooks/useWatchlistAlerts', () => ({
  default: () => ({
    alerts: [], createAlert, deleteAlert: () => {}, getAlertsForSym: () => [], hasAlert: () => false,
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
// The RS Exit batch, as the server answers it: AAPL flashed a Quicksand 3 sessions ago, MSFT is clean.
const rsx = vi.hoisted(() => ({ asked: [] }))
vi.mock('../hooks/useWatchlistRsExit', () => ({
  default: (tickers) => {
    rsx.asked.push(tickers)
    return { rsExitData: tickers.length ? { AAPL: { last: 'Quicksand', bars_ago: 3 }, MSFT: { last: null, bars_ago: null } } : {}, isLoading: false }
  },
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

let fetchMock
beforeEach(() => {
  hoisted.prebuilt = []
  mutateMine.mockClear()
  createAlert.mockClear()
  navigateMock.mockClear()
  localStorage.clear()
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals() })

const { COL_LABELS } = await import('./watchlist/watchlistColumns')
const COLS = 'uct.watchlist.cols'
const cols = () => JSON.parse(localStorage.getItem(COLS) || 'null')
// a header by its column: its full label, or the abbreviation it shows when narrow (COL_LABELS), never a retyped string
const head = (key) => screen.getByRole('button', { name: new RegExp(`^Sort by (?:${COL_LABELS[key].join('|')})$`) })   // sym / price / vol / chg: no regex characters
const renderList = () => render(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" listView={{ type: 'watchlist', color: 'N', key: 'user:wl1' }} />)
afterEach(() => { cleanup() })
const dt = () => ({ effectAllowed: '', setData: () => {}, getData: () => '' })


describe('the RS Exit column', () => {
  test('hidden, the batch is asked for nothing', async () => {
    rsx.asked = []
    renderList()
    await waitFor(() => expect(screen.getAllByText('AAPL').length).toBeGreaterThan(0))
    expect(rsx.asked.every(t => t.length === 0)).toBe(true)
    expect(document.querySelector('[data-rs-exit]')).toBe(null)
  })

  test('shown, AAPL carries an orange Quicksand dot with its age and MSFT a muted dash', async () => {
    rsx.asked = []
    localStorage.setItem(COLS, JSON.stringify({ order: ['flag', 'sym', 'price', 'vol', 'chg', 'rsexit'] }))
    renderList()
    await waitFor(() => expect(document.querySelector('[data-rs-exit]')).toBeTruthy())
    expect(rsx.asked.some(t => t.includes('AAPL') && t.includes('MSFT'))).toBe(true)
    const cell = document.querySelector('[data-rs-exit]')
    expect(cell.getAttribute('data-rs-exit')).toBe('sand')
    expect(cell.textContent).toBe('Quicksand · 3d')
    expect(cell.getAttribute('title')).toMatch(/^Quicksand, 3 sessions ago\. .*not an order to sell/)
    expect(document.querySelectorAll('[data-rs-exit]').length).toBe(1)
    expect(screen.getByRole('button', { name: /^Sort by (RS Exit Warning|RS Exit)$/ })).toBeTruthy()
  })
})
