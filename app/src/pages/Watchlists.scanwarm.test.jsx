// W-L (2026-11-11) — a watchlist scan makes the rows AHEAD current on the chart's key.
// Before: the per-selection warm was IDB→mem promote only (zero network, five timeframes),
// so a row whose cache had aged past the chart's paint rule waited on the chart's own
// request on the switch; and all eight timeframes of EVERY row were warmed on every press.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

// ── Heavy leaves that never render in embedded mode but cost real import time ──
vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/chart/SymbolSearch', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
// Record every warm call's timeframe argument.
const calls = { toIDB: [], all: [], mem: [] }
vi.mock('../utils/prefetchBars', () => ({
  prefetchBarsToIDB: (syms, tf, opts) => { calls.toIDB.push({ syms: [...syms], tf, priority: !!opts?.priority }) },
  prefetchAllTimeframes: (sym) => { calls.all.push(sym) },
  prefetchListAllTimeframes: () => {},
  warmMemFromIDB: (syms, tfs) => { calls.mem.push({ syms: [...syms], tfs }) },
  prefetchBars: () => {}, prefetchBarOnIntent: () => {}, prewarmVisibleList: () => {},
}))
vi.mock('../lib/chartReadoutStore', () => ({
  subscribeChartReadouts: () => () => {}, getChartReadout: () => null, hasFreshReadouts: () => false,
}))

// The panel under test. Stub exposes exactly what the page passed it.
vi.mock('../components/chart/pane/ChartPane', () => ({
  default: ({ sym, tf, stored, onSymbolChange }) => (
    <div
      data-testid={`chart-pane-${sym}-${tf}`}
      data-stored={stored === null ? 'null' : String(stored)}
      data-has-symbol-change={onSymbolChange ? 'yes' : 'no'}
    >pane {sym} {tf}</div>
  ),
}))

// ── Data hooks (mirrors Watchlists.rowmenu.test.jsx's mock set) ──
const SYMS = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH', 'III', 'JJJ']
const WL = {
  id: 'wl1', name: 'Momentum Plays', description: '',
  items: SYMS.map((sym, i) => ({ id: `i${i}`, sym, notes: '' })),
}
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
vi.mock('../hooks/useBreakpoint', () => ({
  useIsTouch: () => false, useIsPhone: () => false, useIsTablet: () => false, useIsDesktop: () => true,
  useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))
// The sym hub, swapped per test: `hub.tf` stands in for the linked ChartWidget's
// live timeframe (in production it arrives via the workspace's groupTfs map).
const hub = { sym: null, setSym: () => {}, tf: undefined }
vi.mock('./charts/ChartsSymContext', () => ({
  ChartsSymContext: { Provider: ({ children }) => children },
  useChartsSym: () => hub,
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))



const Watchlists = (await import('./Watchlists')).default

beforeEach(() => {
  localStorage.clear()
  calls.toIDB = []; calls.all = []; calls.mem = []
  hub.tf = '5'; hub.sym = null
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

test('selecting a row network-warms the next rows (scan direction, nearest first) on the chart timeframe', async () => {
  hub.sym = 'CCC'
  render(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)
  await screen.findByText('CCC')
  await waitFor(() => expect(calls.toIDB.length).toBeGreaterThan(0))
  const scan = calls.toIDB.find(c => c.syms[0] === 'DDD')
  expect(scan).toBeTruthy()
  expect(scan.tf).toBe('5')
  expect(scan.priority).toBe(true)
  expect(scan.syms.slice(0, 6)).toEqual(['DDD', 'EEE', 'FFF', 'GGG', 'HHH', 'III'])
  expect(scan.syms).toContain('BBB')
  // The zero-network promote reads ONLY the chart's timeframe now (was D/5/60/30/15).
  const m = calls.mem.find(c => c.syms.includes('DDD'))
  expect(m.tfs).toEqual(['5'])
})

test("the selected row's other timeframes wait for the selection to REST (not every press)", async () => {
  hub.sym = 'CCC'
  render(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)
  await screen.findByText('CCC')
  expect(calls.all).toEqual([])
  await waitFor(() => expect(calls.all).toContain('CCC'), { timeout: 2000 })
})
