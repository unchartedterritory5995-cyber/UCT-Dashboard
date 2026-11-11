// Watchlists — the list menu's Copy / Export, and the widget door that reaches them for UCT Agent (watchlist group D).
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, afterEach, test, expect, describe } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { WidgetDoorContext, mountedWidgetDoor } from './charts/widgetDoors'

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

// ⭐ watchlist group D (pl-exec; Lead 2026-11-09): the Watchlist widget's door gains listOut / copyList / exportList for UCT Agent —
// the list menu's OWN Copy list to clipboard / Export CSV / Export Excel handlers under the menu's own conditions. This rail proves
// (1) the MENU path is unchanged (the same clipboard text, the same CSV, the same server export) and (2) the door reaches exactly
// what the menu reaches. LOCAL / SIMULATED (jsdom).
const renderDoor = (pickList = 'user:wl1', pickName = 'Momentum Plays') => render(
  <WidgetDoorContext.Provider value="wa">
    <Watchlists embedded pickList={pickList} pickName={pickName} listView={{ type: 'watchlist', color: 'N', key: pickList }} />
  </WidgetDoorContext.Provider>)
const menu = () => document.querySelector('[data-guide="watchlist.rowMenu"]')
const inMenu = (name) => [...(menu()?.querySelectorAll('button') || [])].find(b => b.textContent.trim() === name)
const titleEl = () => document.querySelector('[data-guide="watchlist.title"]')
let clip, blobs
beforeEach(() => {
  exp.quota = null; exp.downloads = []
  clip = vi.fn(() => Promise.resolve())
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: clip }, configurable: true })
  blobs = []
  vi.stubGlobal('URL', { ...URL, createObjectURL: (b) => { blobs.push(b); return 'blob:x' }, revokeObjectURL: () => {} })
})
afterEach(() => { cleanup() })
const csvText = async (b) => (b && typeof b.text === 'function' ? b.text() : String(b))

describe('the list menu: Copy and Export are unchanged', () => {
  test('menu Copy list to clipboard writes the list\'s tickers and closes the menu', async () => {
    renderDoor()
    fireEvent.contextMenu(titleEl(), { clientX: 40, clientY: 20 })
    fireEvent.click(inMenu('Copy list to clipboard'))
    expect(clip).toHaveBeenCalledTimes(1)
    expect(clip.mock.calls[0][0]).toBe('AAPL, MSFT')
    expect(menu()).toBeNull()
  })
  test('menu Export CSV downloads the list as its CSV', async () => {
    renderDoor()
    fireEvent.contextMenu(titleEl(), { clientX: 40, clientY: 20 })
    fireEvent.click(inMenu('Export CSV'))
    expect(blobs).toHaveLength(1)
    expect(await csvText(blobs[0])).toBe('"Symbol","Notes"\n"AAPL","waiting on the 50d reclaim"\n"MSFT",""')
  })
})

describe('the door reaches exactly what the menu reaches', () => {
  test('copyList: the same clipboard text, and it hands back the write (resolved = copied)', async () => {
    renderDoor()
    const d = mountedWidgetDoor('wa')
    expect(d.listOut()).toMatchObject({ name: 'Momentum Plays', own: true, csv: true, xlsx: false })
    const r = d.copyList()
    expect(clip.mock.calls.at(-1)[0]).toBe('AAPL, MSFT')
    await expect(r).resolves.toBeUndefined()
  })
  test('copyList: a refused write is handed back refused (never "copied")', async () => {
    clip.mockImplementationOnce(() => Promise.reject(new Error('NotAllowedError')))
    renderDoor()
    await expect(mountedWidgetDoor('wa').copyList()).rejects.toThrow()
  })
  test('exportList csv: the same CSV the menu downloads', async () => {
    renderDoor()
    expect(mountedWidgetDoor('wa').exportList('csv')).toBe(true)
    expect(await csvText(blobs.at(-1))).toBe('"Symbol","Notes"\n"AAPL","waiting on the 50d reclaim"\n"MSFT",""')
  })
  test('exportList xlsx: only with the export quota, through the same server export the menu calls', async () => {
    renderDoor()
    expect(mountedWidgetDoor('wa').exportList('xlsx')).toBeNull()                 // no quota: not offered, as the menu hides it
    cleanup()
    exp.quota = { remaining: 3 }
    renderDoor()
    await waitFor(() => expect(mountedWidgetDoor('wa').listOut().xlsx).toBe(true))
    await mountedWidgetDoor('wa').exportList('xlsx')
    expect(exp.downloads).toEqual([['/api/exports/watchlists/wl1', { format: 'xlsx' }]])
  })
  test('a community list: Copy yes, Export no (the menu\'s own conditions)', async () => {
    renderDoor('community:cw1', "Ravi's Board")
    const d = mountedWidgetDoor('wa')
    expect(d.listOut()).toMatchObject({ own: false, csv: false, xlsx: false })
    expect(d.exportList('csv')).toBeNull()
    d.copyList()
    expect(clip.mock.calls.at(-1)[0]).toBe('TSLA')
  })
})
