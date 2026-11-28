/**
 * A ROW OF A VIRTUALIZED LIST IS ScanRows' TO SCROLL (section 3.3 change 5, 2026-11-28).
 *
 * Watchlists' selection effect called `scrollIntoView({ block: 'nearest' })` on the selected row after ScanRows had
 * already placed it from the virtualizer's measurements (`rowPlacement`): for a row in view it scrolls nothing, and
 * asking forces a synchronous layout of the board in the switch's key task (6.3 ms of an arrow press, CPU profiles of a
 * local build of master mapped to source: scrollIntoView < Watchlists.jsx selection effect).
 *   V1 (red before the change) a selected row of a virtualized list is never scrollIntoView'd: ScanRows placed it
 *   V2 control: the same selection far down the list still moves it, through ScanRows (centred), so the list is not
 *      left un-scrolled
 *   V3 control: a row of a list rendered outright (no ScanRows) is still scrollIntoView'd, as before
 */
import { render, screen } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

// the virtualizer as a stand-in (jsdom lays nothing out): a 300 px view of 30 px rows at the top, the first 20 rows
// mounted, every scrollToIndex recorded (the scanRowsScroll rail's double)
const V = vi.hoisted(() => ({ calls: [] }))
vi.mock('@tanstack/react-virtual', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    useVirtualizer: (opts) => {
      const n = opts.count
      const m0 = opts.scrollMargin || 0
      const rows = Array.from({ length: n }, (_, i) => ({ index: i, key: i, start: m0 + i * 30, end: m0 + (i + 1) * 30, size: 30, lane: 0 }))
      return {
        scrollOffset: 0, scrollRect: { width: 200, height: 300 }, measurementsCache: rows,
        getVirtualItems: () => rows.slice(0, Math.min(n, 20)), getTotalSize: () => n * 30, measureElement: () => {},
        scrollToIndex: (index, o) => { V.calls.push({ index, align: o && o.align }) },
      }
    },
  }
})
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

// LONG = above VIRTUALIZE_MIN_ROWS (120): it renders through ScanRows. SHORT renders outright.
const LONG = { id: 'wl1', name: 'Long List', description: '', items: Array.from({ length: 200 }, (_, i) => ({ id: `i${i}`, sym: `S${i}`, notes: '' })) }
const SHORT = { id: 'wl2', name: 'Short List', description: '', items: ['AAPL', 'MSFT', 'NVDA', 'AMD', 'AVGO', 'MU'].map((s, i) => ({ id: `j${i}`, sym: s, notes: '' })) }
vi.mock('swr', () => ({
  default: (key) => {
    if (key === '/api/watchlists') return { data: [LONG, SHORT], mutate: () => {} }
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

// The hub symbol IS the return signal: on re-mount the chart's current review
// symbol arrives here, and the list must land on it.
let HUB = null
vi.mock('./charts/ChartsSymContext', () => ({
  ChartsSymContext: { Provider: ({ children }) => children },
  useChartsSym: () => ({ sym: HUB, setSym: () => {} }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))

const Watchlists = (await import('./Watchlists')).default

let scrolled
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  scrolled = []
  V.calls.length = 0
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoViewSpy() { scrolled.push(this.getAttribute('data-watch-sym')) }
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals(); HUB = null })

test("V1 a selected row of a virtualized list is not scrollIntoView'd (ScanRows placed it)", async () => {
  HUB = 'S5'
  render(<Watchlists embedded pickList="user:wl1" pickName="Long List" />)
  await screen.findAllByText('Long List')
  await new Promise((r) => setTimeout(r, 50))
  const row = document.querySelector('[data-watch-sym="S5"]')
  expect(row, 'the row never mounted').toBeTruthy()
  expect(row.closest('[data-index]'), 'the row is not in the virtualized window').toBeTruthy()
  expect(scrolled).toEqual([])
  expect(V.calls).toEqual([])                       // in view: ScanRows moved nothing either
})

test('V2 control: a selection far down the virtualized list is still brought into view, by ScanRows', async () => {
  HUB = 'S150'
  render(<Watchlists embedded pickList="user:wl1" pickName="Long List" />)
  await screen.findAllByText('Long List')
  await new Promise((r) => setTimeout(r, 50))
  expect(V.calls).toContainEqual({ index: 150, align: 'center' })
})

test("V3 control: a row of a list rendered outright is still scrollIntoView'd", async () => {
  HUB = 'AVGO'
  render(<Watchlists embedded pickList="user:wl2" pickName="Short List" />)
  await screen.findAllByText('Short List')
  await new Promise((r) => setTimeout(r, 50))
  expect(document.querySelector('[data-watch-sym="AVGO"]')?.closest('[data-index]')).toBeNull()
  expect(scrolled[scrolled.length - 1]).toBe('AVGO')
})
