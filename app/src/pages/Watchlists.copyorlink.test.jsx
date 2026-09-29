// Watchlists — TERM-077 / FB-A12-03 wiring on the real page (mock set mirrors
// Watchlists.perfcols.test.jsx). The dialog and the provenance text are railed in
// watchlist/SaveListDialog.test.jsx; this file pins the DOOR:
//   * gate OFF => no Save control anywhere, no provenance line, a linked-shaped
//     list is as editable as any other (the server sends no `origin` while off,
//     but the page must not depend on that to stay unchanged);
//   * gate ON  => a community list offers "Save to My Lists", the dialog opens
//     with no mode chosen, and a LINKED list shows its provenance and loses its
//     add-symbol control (its source is authoritative).
import { render, screen, fireEvent, within } from '@testing-library/react'
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
const LINKED = {
  id: 'wl2', user_id: 'u1', name: 'Leaders (linked)', description: '', items: [{ id: 'i2', sym: 'NVDA', notes: '' }],
  origin: { mode: 'link', source_id: 'c1', source_name: 'Leaders', created_at: '2026-09-01T14:00:00+00:00', synced_at: '2026-09-01T14:00:00+00:00', state: 'source_unavailable' },
}
const COMMUNITY = { id: 'c1', user_id: 'u9', name: 'Leaders', owner_name: 'Ravi', is_public: 1, items: [{ id: 'c1i', sym: 'NVDA', notes: '' }] }
let mockMine = [PLAIN]
vi.mock('swr', () => ({
  default: (key) => {
    if (key === '/api/watchlists') return { data: mockMine, mutate: () => {} }
    if (key === '/api/watchlists/public') return { data: [COMMUNITY], mutate: () => {} }
    return { data: [], mutate: () => {} }
  },
}))
let mockFlag = false
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'user', display_name: 'Pat' }, watchlistCopyOrLinkEnabled: mockFlag }),
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

beforeEach(() => {
  localStorage.clear()
  mockFlag = false
  mockMine = [PLAIN]
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

const saveBtn = () => screen.queryByRole('button', { name: /save leaders to my lists/i })
const addBtn = (name) => screen.queryByRole('button', { name: `Add a symbol to ${name}` })

test('gate OFF: the community tab offers no Save control', () => {
  render(<Watchlists />)
  fireEvent.click(screen.getByText('Community'))
  expect(screen.getByText('Leaders')).toBeInTheDocument()   // non-vacuity: the list IS drawn
  expect(saveBtn()).toBeNull()
})

test('gate OFF: My Lists draws no provenance line and keeps every add control', () => {
  render(<Watchlists />)
  expect(addBtn('Momentum Plays')).not.toBeNull()
  expect(document.querySelector('[data-origin-mode]')).toBeNull()
})

test('gate ON: a community list offers Save, and the dialog opens with no mode chosen', () => {
  mockFlag = true
  render(<Watchlists />)
  fireEvent.click(screen.getByText('Community'))
  fireEvent.click(saveBtn())
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByRole('radio', { name: /copy/i }).checked).toBe(false)
  expect(within(dialog).getByRole('radio', { name: /link/i }).checked).toBe(false)
  expect(within(dialog).getByRole('button', { name: /^save$/i }).disabled).toBe(true)
})

test('gate ON: a LINKED list says where it comes from, says it is stale, and is read-only', () => {
  mockFlag = true
  mockMine = [PLAIN, LINKED]
  render(<Watchlists />)
  const line = document.querySelector('[data-origin-mode="link"]')
  expect(line).not.toBeNull()
  expect(line.textContent).toMatch(/linked to Leaders/i)
  expect(line.textContent).toMatch(/source unavailable/i)
  expect(addBtn('Leaders (linked)')).toBeNull()
  // Control: the plain list beside it is still editable.
  expect(addBtn('Momentum Plays')).not.toBeNull()
})
