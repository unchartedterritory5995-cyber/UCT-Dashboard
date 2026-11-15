// Watchlists on the /charts board (UCT frame, owner 11-13): the open list renders with the
// frame's header slots — its header row (‹ name · + ·) drawn in the widget's title row, its ⚙ in
// the window controls — and "+" opens the add-a-ticker box floating under that header row. A
// regression rail for exactly that path: an earlier draft read state before it was declared and
// took the whole widget down ("This Watchlist hit an error") with every other test still green.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
const WL = { id: 'wl1', name: 'Momentum Plays', description: '', items: [{ id: 'i1', sym: 'AAPL', notes: '' }] }
const mutateMine = vi.fn()
vi.mock('swr', () => ({
  default: (key) => (key === '/api/watchlists'
    ? { data: [WL], mutate: mutateMine }
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

const Watchlists = (await import('./Watchlists')).default

// The real TickerCombobox hits /api/ticker-search; serve a tiny universe and let
// the POST outcome be set per-test.
let postOk = true
beforeEach(() => {
  postOk = true
  mutateMine.mockClear()
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn((url, init) => {
    const u = String(url)
    if (u.includes('/api/ticker-search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [{ ticker: 'NVDA', name: 'NVIDIA Corp.' }] }) })
    }
    if (u.includes('/items') && init?.method === 'POST') {
      return postOk
        ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 'i2', sym: 'NVDA' }) })
        : Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  }))
})
afterEach(() => { vi.unstubAllGlobals() })


import { UctHeaderSlotContext } from './charts/uctHeaderSlot'

function renderOnBoard() {
  const row = document.createElement('div'); row.setAttribute('data-test-row', '')
  const controls = document.createElement('div'); controls.setAttribute('data-test-controls', '')
  document.body.append(row, controls)
  const utils = render(
    <UctHeaderSlotContext.Provider value={{ row, controls, claim: () => {} }}>
      <div className="uct-frame">
        <Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />
      </div>
    </UctHeaderSlotContext.Provider>,
  )
  return { ...utils, row, controls }
}

test('renders on the board: header in the title row, gear in the window controls', () => {
  const { row, controls } = renderOnBoard()
  expect(row.querySelector('[data-guide="watchlist.title"]')?.textContent).toBe('Momentum Plays')
  expect(controls.querySelector('[data-guide="widget.settings"]')).toBeTruthy()
  expect(screen.getByText('AAPL')).toBeInTheDocument()
})

test('"+" opens the add box floating under the header row, and adding still works', async () => {
  const user = userEvent.setup()
  renderOnBoard()
  await user.click(screen.getByRole('button', { name: /add a symbol/i }))
  const input = await screen.findByPlaceholderText(/add to momentum plays/i)
  // Floated at page level, inside a uct-frame wrapper (so the board styles still apply).
  const float = input.closest('.uct-frame[style*="position"], .uct-frame')
  expect(float).toBeTruthy()
  expect(input.closest('[data-test-row]')).toBeNull()
  await user.type(input, 'NVD')
  await user.click(await screen.findByText('NVDA'))
  await waitFor(() => expect(mutateMine).toHaveBeenCalled())
})
