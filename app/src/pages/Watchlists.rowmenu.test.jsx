// Watchlists — the row menu must carry NOTES and PRICE ALERTS, not just remove.
//
// 75729b1a ("declutter") deleted the per-row hover buttons (note / alert / ×) and
// carried only × over to the new right-click row menu. Notes and alerts got no
// replacement surface anywhere in the app, so a PERSISTED, still-CSV-exported
// field became data a user could neither see nor edit. Owner decision 2026-08-01:
// restore both to that same row menu, keep the decluttered row.
//
// These tests drive the SCOPED (pickList) mode — per Watchlists.jsx's own header
// the unscoped mode ships nowhere, so testing this unscoped would exercise code no
// user can reach.
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
// AAPL carries a note the user WROTE — it is the field the declutter orphaned, so
// seeing it in the editor is half the point of this restore.
const WL = {
  id: 'wl1', name: 'Momentum Plays', description: '',
  items: [{ id: 'i1', sym: 'AAPL', notes: 'waiting on the 50d reclaim' }],
}
const COMMUNITY_WL = {
  id: 'cw1', name: "Ravi's Board", description: '', owner_name: 'Ravi',
  items: [{ id: 'ci1', sym: 'TSLA', notes: 'his note, not yours' }],
}
const mutateMine = vi.fn()
vi.mock('swr', () => ({
  default: (key) => {
    if (key === '/api/watchlists') return { data: [WL], mutate: mutateMine }
    if (key === '/api/watchlists/public') return { data: [COMMUNITY_WL], mutate: () => {} }
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

const Watchlists = (await import('./Watchlists')).default

let fetchMock
beforeEach(() => {
  mutateMine.mockClear()
  createAlert.mockClear()
  localStorage.clear()
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals() })

function renderOwned() {
  return render(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)
}

// Right-click a ticker row → the row menu. `onContextMenu` sits on the symbol cell
// that wraps this text, and React's synthetic contextmenu bubbles to it.
async function openRowMenu(user, sym) {
  await user.pointer({ keys: '[MouseRight]', target: screen.getByText(sym) })
}

test('the row menu offers notes and a price alert, not just remove', async () => {
  const user = userEvent.setup()
  renderOwned()

  await openRowMenu(user, 'AAPL')

  // All three per-symbol actions. Before this restore only "Remove from watchlist"
  // existed and the other two were unreachable from anywhere in the app.
  expect(screen.getByRole('button', { name: /^notes$/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /set price alert/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /remove from watchlist/i })).toBeInTheDocument()
})

test('a note opened from the row menu shows what was saved and persists an edit', async () => {
  const user = userEvent.setup()
  renderOwned()

  await openRowMenu(user, 'AAPL')
  await user.click(screen.getByRole('button', { name: /^notes$/i }))

  // The orphaned-but-persisted note is visible again.
  const box = await screen.findByPlaceholderText(/add a note/i)
  expect(box).toHaveValue('waiting on the 50d reclaim')

  await user.clear(box)
  await user.type(box, 'broke out, trailing the 20d')
  await user.tab()   // blur → save

  await waitFor(() => {
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(put).toBeTruthy()
    expect(String(put[0])).toBe('/api/watchlists/wl1/items/i1/notes')
    expect(JSON.parse(put[1].body)).toEqual({ notes: 'broke out, trailing the 20d' })
  })
})

test('the price alert entry opens the alert popover for that symbol', async () => {
  const user = userEvent.setup()
  renderOwned()

  await openRowMenu(user, 'AAPL')
  await user.click(screen.getByRole('button', { name: /set price alert/i }))

  expect(await screen.findByText(/alert for aapl/i)).toBeInTheDocument()
  await user.type(screen.getByPlaceholderText('$0.00'), '250')
  await user.click(screen.getByRole('button', { name: /^set$/i }))

  expect(createAlert).toHaveBeenCalledWith('AAPL', 250, 'above')
})

test("a community row opens no menu, so a shared list's notes stay read-only", async () => {
  const user = userEvent.setup()
  render(<Watchlists embedded pickList="community:cw1" pickName="Ravi's Board" />)

  await openRowMenu(user, 'TSLA')

  // No row menu at all on a list that isn't yours — no Notes entry to edit through,
  // and no remove either. This is the guard that keeps shared notes read-only.
  expect(screen.queryByRole('button', { name: /^notes$/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /remove from watchlist/i })).not.toBeInTheDocument()
})
