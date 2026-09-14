// Watchlists — Shift+F must FLAG the selected ticker, not only unflag it.
//
// ⚰️ REPORTED BY THE OWNER 2026-08-28, scanning lists: "I keep clicking Shift+F
// to try to flag stocks... it's just not working properly." Two independent
// causes. The first was `ChartDrawingOverlay` arming the Fibonacci extension off
// the same chord (see keyboardShortcuts.test.js). The second is here: this
// page's handler was gated on `flagged.includes(selectedSym)` and called
// `removeFlagged`, so Shift+F could only ever REMOVE a flag. Pressing it on an
// unflagged row — the whole point, while scanning — did nothing at all.
//
// The row star has always advertised the opposite ('Add to Flagged (Shift+F)',
// Watchlists.jsx), and the toast already had a 'Flagged' branch that nothing
// could reach: `flagToast === 'added'` was dead the day it was written.
//
// Mock set mirrors Watchlists.chartmount.test.jsx.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

const WL = { id: 'wl1', name: 'Momentum Plays', description: '', items: [{ id: 'i1', sym: 'AAPL', notes: '' }] }
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

// ── The hook under observation. `flagged` starts EMPTY: the scanning case. ──
const flagSpy = { toggle: vi.fn(), remove: vi.fn(), flagged: [] }
vi.mock('../hooks/useFlagged', () => ({
  useFlagged: () => ({
    flagged: flagSpy.flagged, toggle: flagSpy.toggle, remove: flagSpy.remove,
    isFlagged: (s) => flagSpy.flagged.includes(s),
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
vi.mock('./charts/ChartsSymContext', () => ({
  ChartsSymContext: { Provider: ({ children }) => children },
  useChartsSym: () => ({ sym: null, setSym: () => {} }),
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))

const Watchlists = (await import('./Watchlists')).default

beforeEach(() => {
  localStorage.clear()
  flagSpy.toggle.mockClear(); flagSpy.remove.mockClear(); flagSpy.flagged = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

test('Shift+F on an UNflagged selected ticker flags it', async () => {
  const user = userEvent.setup()
  render(<Watchlists pickList="user:wl1" pickName="Momentum Plays" />)

  await user.click(screen.getByText('AAPL'))
  await user.keyboard('{Shift>}F{/Shift}')

  expect(flagSpy.toggle).toHaveBeenCalledWith('AAPL')
})

test('Shift+F on an ALREADY-flagged ticker still unflags it (no regression)', async () => {
  const user = userEvent.setup()
  flagSpy.flagged = ['AAPL']
  render(<Watchlists pickList="user:wl1" pickName="Momentum Plays" />)

  await user.click(screen.getByText('AAPL'))
  await user.keyboard('{Shift>}F{/Shift}')

  expect(flagSpy.toggle).toHaveBeenCalledWith('AAPL')
})

// ── The timing/casing vectors, on a real mount of the page ──
// `userEvent.keyboard` always emits the tidy uppercase, un-repeated event; these
// two go through `fireEvent` because the whole point is the events a real
// keyboard produces that a tidy synthetic one never will.
import { fireEvent } from '@testing-library/react'

test('CapsLock on: Shift+F still flags (the event carries lowercase "f")', async () => {
  const user = userEvent.setup()
  render(<Watchlists pickList="user:wl1" pickName="Momentum Plays" />)
  await user.click(screen.getByText('AAPL'))

  // CapsLock + Shift inverts the case: shiftKey is true but key is 'f'.
  fireEvent.keyDown(window, { key: 'f', code: 'KeyF', shiftKey: true })

  expect(flagSpy.toggle).toHaveBeenCalledWith('AAPL')
})

test('holding Shift+F flags ONCE, not once per auto-repeat', async () => {
  const user = userEvent.setup()
  render(<Watchlists pickList="user:wl1" pickName="Momentum Plays" />)
  await user.click(screen.getByText('AAPL'))

  fireEvent.keyDown(window, { key: 'F', code: 'KeyF', shiftKey: true })
  for (let i = 0; i < 20; i++) {
    fireEvent.keyDown(window, { key: 'F', code: 'KeyF', shiftKey: true, repeat: true })
  }

  // A toggle fired 21 times lands wherever the release parity falls — the flag
  // would appear not to "stick". Exactly one call is the whole contract.
  expect(flagSpy.toggle).toHaveBeenCalledTimes(1)
})


// ── F-S2-1 — the PLATFORM ACCELERATOR chord must not write to the flag list ──
//
// ⚰️ Measured on `feb7ba1f8`: five surfaces claimed Shift+F and disagreed about which
// modifiers they answered. ChartPane and GridChartCell excluded ctrl/alt/meta; this
// page, TickerPopup and ThemeTrackerPage did not — so a member reaching for
// Ctrl+Shift+F / Cmd+Shift+F got a SILENT write to their flag list on three screens
// and nothing on two. HY-35's class in the form the 2026-08-28 ownership fix missed.
//
// ⛔ BEHAVIOUR, NOT SHAPE. `pages/command/chordCollision.test.js` derives the guard set
// from SOURCE and is how the defect was found — but it reads text, so it would stay
// green if the exclusions were present and the handler fired anyway. These cases fire
// the real events and assert the decision a member feels: did my flag list change?

test.each([
  ['Ctrl', { ctrlKey: true }],
  ['Cmd', { metaKey: true }],
  ['Alt', { altKey: true }],
])('%s+Shift+F does NOT touch the flag list', async (_label, mods) => {
  const user = userEvent.setup()
  render(<Watchlists pickList="user:wl1" pickName="Momentum Plays" />)
  await user.click(screen.getByText('AAPL'))

  fireEvent.keyDown(window, { key: 'F', code: 'KeyF', shiftKey: true, ...mods })

  expect(flagSpy.toggle).not.toHaveBeenCalled()
  expect(flagSpy.remove).not.toHaveBeenCalled()
})

test('CapsLock + Ctrl+Shift+F is refused, and the same casing WITHOUT it still flags', async () => {
  // ⭐ Both halves in one case on purpose: the refusal has to be about the MODIFIER.
  // A guard that had simply stopped answering lowercase would pass the first
  // assertion and fail the member exactly as the original defect did.
  const user = userEvent.setup()
  render(<Watchlists pickList="user:wl1" pickName="Momentum Plays" />)
  await user.click(screen.getByText('AAPL'))

  fireEvent.keyDown(window, { key: 'f', code: 'KeyF', shiftKey: true, ctrlKey: true })
  expect(flagSpy.toggle).not.toHaveBeenCalled()

  fireEvent.keyDown(window, { key: 'f', code: 'KeyF', shiftKey: true })
  expect(flagSpy.toggle).toHaveBeenCalledWith('AAPL')
})
