// TERM-038 slice 2 — the `T:<id>` address door's last hop. ChartsWorkspace's
// ?openThemeSet= retargets an ALREADY-MOUNTED Themes widget by writing opts.themeSetId;
// ThemeTrackerPage seeds its set from opts once, so without following an outside change
// the door would point the widget's opts at a set while the widget kept showing Default.
// Asserted on what a member reads: the set picker's label, and the overlay request made.
//
// Harness mirrors ThemeTrackerPage.flagkey.test.jsx.
import { render, screen, waitFor } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { AuthContext } from '../context/AuthContext'

vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../components/chart/pane/ChartPane', () => ({ default: () => null }))
vi.mock('../utils/prefetchBars', () => ({
  prefetchBar: () => {}, prefetchBars: () => {}, prefetchBarsToIDB: () => {},
  prefetchAllTimeframes: () => {}, prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {},
  prewarmVisibleList: () => {}, warmMemFromIDB: () => {},
}))

const swrKeys = []
vi.mock('../hooks/useMobileSWR', () => ({
  default: (key) => {
    swrKeys.push(key)
    if (String(key).startsWith('/api/theme-performance')) return { data: { themes: [] }, isLoading: false, mutate: () => {} }
    return { data: undefined, isLoading: false }
  },
}))
vi.mock('../hooks/useThemeSets', () => ({
  useThemeSets: () => ({
    enabled: true,
    sets: [{ id: 'ts_abc', name: 'AI Infra Basket' }],
    createSet: vi.fn(), deleteSet: vi.fn(), renameSet: vi.fn(), refreshSets: vi.fn(),
  }),
  getSetDef: () => Promise.resolve(null),
  putSetDef: () => Promise.resolve(null),
}))
vi.mock('../hooks/useFlagged', () => ({
  useFlagged: () => ({ flagged: [], toggle: () => {}, isFlagged: () => false }),
}))
vi.mock('../hooks/useTickerTags', () => ({ default: () => ({ getTag: () => null }) }))
vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: () => {}, loading: false }),
  parsePref: (raw, fallback) => fallback,
}))
vi.mock('../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: {}, isLoading: false, isStreaming: false, staleSymbols: new Set() }),
}))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('./charts/ChartsSymContext', () => ({
  ChartsSymContext: { Provider: ({ children }) => children },
  useChartsSym: () => ({ sym: null, setSym: () => {} }),
}))

const ThemeTrackerPage = (await import('./ThemeTrackerPage')).default

beforeEach(() => {
  localStorage.clear()
  swrKeys.length = 0
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

function mount(addressSpaceEnabled) {
  const onOptsChange = vi.fn()
  const ui = (opts) => (
    <AuthContext.Provider value={{ addressSpaceEnabled }}>
      <ThemeTrackerPage embedded opts={opts} onOptsChange={onOptsChange} />
    </AuthContext.Provider>
  )
  const r = render(ui({}))
  return { retarget: (opts) => r.rerender(ui(opts)) }
}

const pickerLabel = () => screen.getByTitle('Choose a preset').textContent

test('an outside retarget of opts.themeSetId (the T: door) switches the widget to that set', async () => {
  const { retarget } = mount(true)
  expect(pickerLabel()).toMatch(/UCT Default/)
  retarget({ themeSetId: 'ts_abc' })
  await waitFor(() => expect(pickerLabel()).toMatch(/AI Infra Basket/))
  expect(swrKeys).toContain('/api/theme-performance?set=ts_abc')
})

test('⛔ CONTROL — while the address space is dark the widget keeps its own set (unchanged behaviour)', async () => {
  const { retarget } = mount(false)
  retarget({ themeSetId: 'ts_abc' })
  await new Promise((r) => setTimeout(r, 20))
  expect(pickerLabel()).toMatch(/UCT Default/)
  expect(swrKeys).not.toContain('/api/theme-performance?set=ts_abc')
})
