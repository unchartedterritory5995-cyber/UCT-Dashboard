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
const calls = { toIDB: [], all: [], mem: [], urgent: [] }
vi.mock('../utils/prefetchBars', () => ({
  prefetchBarsToIDB: (syms, tf, opts) => { calls.toIDB.push({ syms: [...syms], tf, priority: !!opts?.priority }) },
  prefetchAllTimeframes: (sym) => { calls.all.push(sym) },
  prefetchListAllTimeframes: () => {},
  warmMemFromIDB: (syms, tfs) => { calls.mem.push({ syms: [...syms], tfs }) },
  prefetchBars: (syms, tf, opts) => { if (opts?.urgent) calls.urgent.push({ syms: [...syms], tf }) },
  prefetchBarOnIntent: () => {}, prewarmVisibleList: () => {},
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
  calls.toIDB = []; calls.all = []; calls.mem = []; calls.urgent = []
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

test('the next two rows are warmed URGENTLY (not held behind the daily pack ingest), on the chart timeframe', async () => {
  hub.sym = 'CCC'
  render(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)
  await screen.findByText('CCC')
  await waitFor(() => expect(calls.urgent.length).toBeGreaterThan(0))
  const u = calls.urgent.find(c => c.syms[0] === 'DDD')
  expect(u).toBeTruthy()
  expect(u.tf).toBe('5')
  expect(u.syms).toEqual(['DDD', 'EEE'])
})

// ⭐ (2026-11-25 wide sweep) A member jumping through the list outran the urgent next-row warm: the jump's stride, in
// its direction, is warmed urgently too, and kept resident by the hold.
// ⛔ (review of #2739) URGENT ONLY INSIDE THE CAP: prefetchBars makes only the first URGENT_MAX_PER_CALL symbols of a call
// urgent (store facade and legacy alike); a third one leaves as a shed-able `warm=1` background warm that is never
// re-asked after a roll. A jump is [the next row, the jump target], read against the real cap.
test('a jump warms the row one stride further, urgently, inside the per-call urgent cap', async () => {
  const { URGENT_MAX_PER_CALL } = await vi.importActual('../utils/prefetchBars')
  expect(URGENT_MAX_PER_CALL).toBeGreaterThanOrEqual(2)
  hub.sym = 'CCC'
  const { rerender } = render(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)
  await screen.findByText('CCC')
  await waitFor(() => expect(calls.urgent.some(c => c.syms[0] === 'DDD')).toBe(true))
  calls.urgent = []
  hub.sym = 'FFF'                                            // a jump of 3 rows down
  rerender(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)
  await waitFor(() => expect(calls.urgent.some(c => c.syms[0] === 'GGG')).toBe(true))
  const u = calls.urgent.find(c => c.syms[0] === 'GGG')
  expect(u.tf).toBe('5')
  expect(u.syms.slice(0, URGENT_MAX_PER_CALL), 'the jump target was past the urgent cap').toContain('III')
  expect(u.syms).toEqual(['GGG', 'III'])                     // ⛔ CHANGED (review of #2739): the next row, then FFF + 3
  calls.urgent = []
  hub.sym = 'GGG'                                            // control: one row on is no jump
  rerender(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)
  await waitFor(() => expect(calls.urgent.some(c => c.syms[0] === 'HHH')).toBe(true))
  expect(calls.urgent.find(c => c.syms[0] === 'HHH').syms).toEqual(['HHH', 'III'])
})

// ⛔ (review of #2739) KEPT ONLY INSIDE THE SHARE: a hold pins `keep.slice(0, share)`, share = min(NEIGHBOR_KEEP_AHEAD,
// NEIGHBOR_KEEP_TOTAL / holds): 30 on a 1m + 15m board, 20 on three. A jump target appended after 30 rows ahead is cut.
test('a jump target is kept inside the hold share of a two- and a three-hold board', async () => {
  const { NEIGHBOR_KEEP_AHEAD, NEIGHBOR_KEEP_TOTAL } = await vi.importActual('../data/barStore/prefetch')
  const share = (holds) => Math.min(NEIGHBOR_KEEP_AHEAD, Math.floor(NEIGHBOR_KEEP_TOTAL / holds))
  const sets = []
  const items0 = WL.items
  WL.items = Array.from({ length: 80 }, (_, i) => ({ id: `j${i}`, sym: `S${String(i).padStart(3, '0')}`, notes: '' }))
  globalThis.__uctStoreWarmers = {
    prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {}, prefetchListAllTimeframes: () => {},
    warmMemFromIDB: () => {}, prefetchBars: () => {}, prefetchBarOnIntent: () => {}, prewarmVisibleList: () => {},
    createNeighborHold: () => ({ set: (syms, tf, opts) => sets.push({ tf, selected: opts?.selected, keep: opts?.keep ? [...opts.keep] : null }), clear: () => {} }),
  }
  try {
    hub.sym = 'S000'
    const { rerender } = render(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)
    await screen.findByText('S000')
    await waitFor(() => expect(sets.some(s => s.selected === 'S000')).toBe(true))
    hub.sym = 'S035'                                         // a jump of 35 rows: the next one lands on S070
    rerender(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)
    await waitFor(() => expect(sets.some(s => s.selected === 'S035')).toBe(true))
    const s = sets.filter(x => x.selected === 'S035').pop()
    expect(s.keep).toContain('S070')
    expect(s.keep.slice(0, share(2)), 'the jump target was cut by a two-hold share').toContain('S070')
    expect(s.keep.slice(0, share(3)), 'the jump target was cut by a three-hold share').toContain('S070')
  } finally {
    WL.items = items0
    delete globalThis.__uctStoreWarmers
  }
})

test('the store hold holds the rows around the selection and deepens the next two (scan direction)', async () => {
  const sets = []
  globalThis.__uctStoreWarmers = {
    prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {}, prefetchListAllTimeframes: () => {},
    warmMemFromIDB: () => {}, prefetchBars: () => {}, prefetchBarOnIntent: () => {}, prewarmVisibleList: () => {},
    createNeighborHold: () => ({ set: (syms, tf, opts) => sets.push({ syms: [...syms], tf, deep: opts?.deep ? [...opts.deep] : null }), clear: () => {} }),
  }
  try {
    hub.sym = 'CCC'
    render(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)
    await screen.findByText('CCC')
    await waitFor(() => expect(sets.length).toBeGreaterThan(0))
    const s = sets[sets.length - 1]
    expect(s.tf).toBe('5')
    expect(s.syms).toEqual(expect.arrayContaining(['DDD', 'EEE', 'BBB']))
    expect(s.deep).toEqual(['DDD', 'EEE'])
  } finally {
    delete globalThis.__uctStoreWarmers
  }
})

test('the hold keeps the next row, the one after and the previous row current across a boundary (tail)', async () => {
  const sets = []
  globalThis.__uctStoreWarmers = {
    prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {}, prefetchListAllTimeframes: () => {},
    warmMemFromIDB: () => {}, prefetchBars: () => {}, prefetchBarOnIntent: () => {}, prewarmVisibleList: () => {},
    createNeighborHold: () => ({ set: (syms, tf, opts) => sets.push({ tf, tail: opts?.tail ? [...opts.tail] : null, selected: opts?.selected }), clear: () => {} }),
  }
  try {
    hub.sym = 'CCC'
    render(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)
    await screen.findByText('CCC')
    await waitFor(() => expect(sets.length).toBeGreaterThan(0))
    const s = sets[sets.length - 1]
    expect(s.tf).toBe('5')
    expect(s.tail).toEqual(['DDD', 'EEE', 'BBB'])            // next, the one after (scan direction), previous
    expect(s.selected).toBe('CCC')                           // the selection: a CHANGE of it opens the hold's window
  } finally {
    delete globalThis.__uctStoreWarmers
  }
})

test('the hold keeps the rows AHEAD resident until the member reaches them (keep)', async () => {
  const sets = []
  globalThis.__uctStoreWarmers = {
    prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {}, prefetchListAllTimeframes: () => {},
    warmMemFromIDB: () => {}, prefetchBars: () => {}, prefetchBarOnIntent: () => {}, prewarmVisibleList: () => {},
    createNeighborHold: () => ({ set: (syms, tf, opts) => sets.push({ tf, keep: opts?.keep ? [...opts.keep] : null }), clear: () => {} }),
  }
  try {
    hub.sym = 'CCC'
    render(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)
    await screen.findByText('CCC')
    await waitFor(() => expect(sets.length).toBeGreaterThan(0))
    const s = sets[sets.length - 1]
    expect(s.keep?.slice(0, 2)).toEqual(['DDD', 'EEE'])     // the rows ahead, nearest first, in the scan direction
    expect(s.keep).not.toContain('CCC')                      // never the selected row (the hold's own window pins it)
  } finally {
    delete globalThis.__uctStoreWarmers
  }
})

test("the selected row's other timeframes wait for the selection to REST (not every press)", async () => {
  hub.sym = 'CCC'
  render(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)
  await screen.findByText('CCC')
  expect(calls.all).toEqual([])
  await waitFor(() => expect(calls.all).toContain('CCC'), { timeout: 2000 })
})
