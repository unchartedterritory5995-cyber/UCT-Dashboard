// AUDIT #1027 point 2: the MEMBER's own drag path over the real Watchlists component — a header dragged onto another reorders
// the columns, a gridline dragged resizes one — read back from the column storage the widget persists. Written to pass
// UNCHANGED on master b2300e547d (inline moveColumn / startColResize) and on this branch (the extracted rules), so the
// refactor is shown not to change what a member's drag does. Setup copied from Watchlists.listout.test.jsx. LOCAL, jsdom.
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, afterEach, test, expect, describe } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// the export quota and the server export, as the menu's Export Excel reaches them (lib/dataExport)
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

describe('the member\'s column drag (unchanged by the extraction)', () => {
  test('a header dropped on another takes its place', async () => {
    renderList()
    await waitFor(() => expect(head('chg')).toBeTruthy())
    fireEvent.dragStart(head('chg'), { dataTransfer: dt() })
    fireEvent.dragOver(head('price'), { dataTransfer: dt() })
    fireEvent.drop(head('price'), { dataTransfer: dt() })
    expect(cols().order).toEqual(['flag', 'sym', 'chg', 'price', 'vol'])
    fireEvent.dragStart(head('sym'), { dataTransfer: dt() })
    fireEvent.drop(head('vol'), { dataTransfer: dt() })
    expect(cols().order).toEqual(['flag', 'chg', 'price', 'vol', 'sym'])
  })
  test('a header dropped on itself writes nothing', async () => {
    renderList()
    await waitFor(() => expect(head('price')).toBeTruthy())
    fireEvent.dragStart(head('price'), { dataTransfer: dt() })
    fireEvent.drop(head('price'), { dataTransfer: dt() })
    expect(cols()).toBe(null)
  })
  test('a gridline dragged right widens the column to its left; dragged far left it stops at the minimum', async () => {
    renderList()
    await waitFor(() => expect(head('price')).toBeTruthy())
    const divider = () => [...document.querySelectorAll('[title="Drag to resize column"]')]
    expect(divider().length).toBeGreaterThan(2)
    const sym = divider()[1]                                   // flag, sym, price…: the second divider is Symbol's right edge
    fireEvent.mouseDown(sym, { clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 130 })
    fireEvent.mouseUp(window, { clientX: 130.6 })
    expect(cols().widths.sym).toBeGreaterThan(96)              // wider than Symbol's default, a whole pixel
    expect(Number.isInteger(cols().widths.sym)).toBe(true)
    fireEvent.mouseDown(divider()[2], { clientX: 300 })
    fireEvent.mouseUp(window, { clientX: 0 })
    expect(cols().widths.price).toBe(44)                       // never under Price's minimum
  })
})
void act; void userEvent; void readFileSync; void resolve
