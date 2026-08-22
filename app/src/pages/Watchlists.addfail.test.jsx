// Watchlists — the inline add-symbol row must SAY SO when the add fails.
//
// `handleAddItem` throws on a non-ok POST. Until 75729b1a that throw had a
// catcher: the pinned AddSymbolBar wrapped every add in try/catch and announced
// "Could not add NVDA" in a role="status" aria-live region. That commit deleted
// AddSymbolBar and left the inline `onPick={sym => handleAddItem(...)}` arrows as
// the ONLY add surface — no catch, so a 500 became an unhandled rejection with
// zero user feedback: the combobox clears and the ticker never appears.
//
// These tests drive the SCOPED (pickList) mode — per this file's own header the
// unscoped mode ships nowhere, so testing the add path unscoped would exercise
// code no user can reach.
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

function renderScoped() {
  return render(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)
}

// Open the header "+" and pick NVDA out of the predictive combobox.
async function addNvda(user) {
  await user.click(screen.getByRole('button', { name: /add a symbol/i }))
  const input = await screen.findByPlaceholderText(/add to momentum plays/i)
  await user.type(input, 'NVD')
  await user.click(await screen.findByText('NVDA'))
}

test('a failed add tells the user instead of failing silently', async () => {
  const user = userEvent.setup()
  postOk = false
  renderScoped()

  await addNvda(user)

  // The symbol did NOT land — the user has to be told, exactly as the deleted
  // AddSymbolBar did ("Could not add NVDA") in an aria-live region. The page
  // now mounts a second permanent status region (the Send-to-Journal toast,
  // empty here), so assert on the one CARRYING the error, not "the" region.
  const statuses = await screen.findAllByRole('status')
  const status = statuses.find((el) => /could not add nvda/i.test(el.textContent))
  expect(status).toBeTruthy()
})

test('a successful add surfaces no error and refreshes the list', async () => {
  const user = userEvent.setup()
  renderScoped()

  await addNvda(user)

  await waitFor(() => expect(mutateMine).toHaveBeenCalled())
  expect(screen.queryByText(/could not add/i)).not.toBeInTheDocument()
})
