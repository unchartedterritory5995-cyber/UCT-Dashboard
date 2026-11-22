// Watchlists (the /charts Watchlist widget's only mode, SCOPED): Entity Master UC-2 rendering.
//
// With WATCHLIST_ENTITY_KEYS_ENABLED armed, member rows arrive carrying entity_id / display_sym /
// entity_marker. A renamed row shows its CURRENT symbol plus "renamed from X"; a delisted row says
// "delisted". With the fields absent (flag off), or present but saying nothing changed, the widget
// must render byte for byte what it rendered before this feature existed.
//
// The flag-off pin is RELATIVE: the fields-absent render is compared with the same widget, in the
// same run, with the entity helper answering "nothing to say" for every row (`ent.bypass`), which
// is the widget without this feature deciding anything.
// ⚰️ (retired 2026-11-17) It was an ABSOLUTE pin: GOLDEN_SHA, the sha256 of the whole widget's
// innerHTML, recorded once against the pre-feature Watchlists.jsx (55b12fe1d). That proved the
// feature's own commit (99a8b57bc4) left the flag-off render alone, and it did. After that it
// hashed every column, menu and class of the widget, so deliberate Watchlist work (first moved
// by the 2026-11-08..10 changes, per the master red sweep of 2026-11-17) changed it while the
// entity feature stood still: on the day it was retired, the flag-off render was byte-identical
// to the widget with the feature taken out (the pin below). An absolute hash cannot tell a
// feature regression from a redesign. What it meant to pin is pinned below against the current
// widget, and the helper's own contract (fields absent => null) in watchlist/entityDisplay.test.js.
import { render, screen, cleanup } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

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
const state = vi.hoisted(() => ({ items: [] }))
const mutateMine = vi.fn()
vi.mock('swr', () => ({
  default: (key) => (key === '/api/watchlists'
    ? { data: [{ id: 'wl1', name: 'Momentum Plays', description: '', items: state.items }], mutate: mutateMine }
    : { data: [], mutate: () => {} }),
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
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
// The real helper, with a switch that takes the feature out: bypassed, every row is told there
// is nothing to say about its entity, which is how the widget rendered before the feature.
const ent = vi.hoisted(() => ({ bypass: false }))
vi.mock('./watchlist/entityDisplay', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, entityDisplay: (item) => (ent.bypass ? null : real.entityDisplay(item)) }
})

const Watchlists = (await import('./Watchlists')).default

beforeEach(() => {
  mutateMine.mockClear()
  localStorage.clear()
  ent.bypass = false
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); ent.bypass = false })

const PLAIN = [
  { id: 'i1', sym: 'FB', notes: '', sort_order: 0 },
  { id: 'i2', sym: 'TWTR', notes: '', sort_order: 1 },
  { id: 'i3', sym: 'AAPL', notes: '', sort_order: 2 },
]
const renderScoped = () => render(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)

function html(items) {
  state.items = items
  const { container } = renderScoped()
  // UIcon numbers its gradient ids from a module counter, so they depend on render ORDER, not on
  // what was rendered; normalise them so the comparison is about the markup.
  const out = container.innerHTML.replace(/uig\d+/g, 'uig#')
  cleanup()
  return out
}
const withoutTheFeature = (items) => {
  ent.bypass = true
  try { return html(items) } finally { ent.bypass = false }
}

test('fields absent (flag off): byte-identical to the widget without the feature, and no marker', () => {
  const without = withoutTheFeature(PLAIN)
  const out = html(PLAIN)
  expect(out).toContain('TWTR')
  expect(out).not.toContain('wl-entity-marker')
  expect(out).toBe(without)
})

test('the comparison above can tell: taking the feature out changes a renamed row (the control)', () => {
  // Without this, a bypass that bypassed nothing would make the pin above compare a render
  // with itself and pass whatever the feature did to a flag-off row.
  const renamed = [{ ...PLAIN[0], entity_id: 'e1', display_sym: 'META', entity_marker: 'renamed' }, PLAIN[1], PLAIN[2]]
  const without = withoutTheFeature(renamed)
  expect(without).not.toContain('wl-entity-marker')
  expect(html(renamed)).not.toBe(without)
})

test('fields present but saying nothing changed: the same bytes as fields absent', () => {
  const plain = html(PLAIN)
  expect(html(PLAIN.map((it) => ({ ...it, entity_id: 'e-' + it.sym, display_sym: it.sym, entity_marker: null })))).toBe(plain)
  expect(html(PLAIN.map((it) => ({ ...it, entity_id: null, display_sym: it.sym, entity_marker: null })))).toBe(plain)
})

test('a renamed row shows the current symbol and "renamed from"; a delisted row says delisted', () => {
  state.items = [
    { ...PLAIN[0], entity_id: 'e1', display_sym: 'META', entity_marker: 'renamed' },
    { ...PLAIN[1], entity_id: 'e2', display_sym: 'TWTR', entity_marker: 'delisted' },
    PLAIN[2],
  ]
  renderScoped()
  const marks = screen.getAllByTestId('wl-entity-marker')
  expect(marks.map((m) => m.textContent)).toEqual(['renamed from FB', 'delisted'])
  expect(screen.getByText('META')).toBeTruthy()
  expect(marks[0].getAttribute('title')).toBe('This company now trades as META. You added it as FB.')
  // only the delisted marker takes the danger class; the rename inherits the row ink
  expect(marks[1].className).toMatch(/entityMarkDanger/)
  expect(marks[0].className).not.toMatch(/entityMarkDanger/)
  // plain text, never a new (sub-44px) control
  for (const m of marks) expect(m.closest('button')).toBeNull()
})
