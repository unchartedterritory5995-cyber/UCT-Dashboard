// The Theme Tracker on a hidden LAYER keep-alive board (2026-11-27, review of #2901, H1): its window key handler
// answers first and stops the key, so a hidden board's tracker would steal the front board's arrows and flags.
//   TK1 (red first) a hidden layer board's tracker answers no Shift+F or arrow; shown, it answers again
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

// ── Heavy leaves ──
vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../components/chart/pane/ChartPane', () => ({ default: () => null }))
vi.mock('../utils/prefetchBars', () => ({
  prefetchBar: () => {}, prefetchBars: () => {}, prefetchBarsToIDB: () => {},
  prefetchAllTimeframes: () => {}, prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {},
  prewarmVisibleList: () => {}, warmMemFromIDB: () => {},
}))

// ── Data hooks — one theme, one holding, exactly as the chartmount harness ──
const THEME_DATA = {
  themes: [
    {
      ticker: 'TESTTHEME',
      name: 'Test Theme',
      etf_name: null,
      group_return: { '1d': 1.5 },
      holdings: [
        { sym: 'AAPL', name: 'Apple Inc', returns: { '1d': 1.5 }, ref_prices: { '1d': 100 } },
      ],
    },
  ],
}
vi.mock('../hooks/useMobileSWR', () => ({
  default: (key) => {
    if (key === '/api/theme-performance') return { data: THEME_DATA, isLoading: false }
    if (key === '/api/theme-rotation') return { data: { rankings: {} } }
    return { data: undefined, isLoading: false }
  },
}))

// ── The hook under observation ──
const flagSpy = { toggle: vi.fn(), flagged: [] }
vi.mock('../hooks/useFlagged', () => ({
  useFlagged: () => ({
    flagged: flagSpy.flagged,
    toggle: flagSpy.toggle,
    isFlagged: (s) => flagSpy.flagged.includes(s),
  }),
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
const { BoardVisibilityContext, createBoardVisibility } = await import('../components/chart/boardVisibility')

beforeEach(() => {
  localStorage.clear()
  flagSpy.toggle.mockClear()
  flagSpy.flagged = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve({}),
  })))
})
afterEach(() => { vi.unstubAllGlobals() })

/** Select the HOLDING row (not the theme's synthetic "$IDX:" index row). The page's
 *  handler only binds once a symbol is selected, so a test that skipped this would
 *  pass against a deleted handler.
 *
 *  ⚠️ The theme must be EXPANDED first. `ThemeTrackerPage.chartmount.test.jsx` says the
 *  page "auto-opens the FIRST theme on load"; measured 2026-09-14 it does not, and that
 *  harness is RED on this branch for exactly that reason — the row renders, the holding
 *  does not. Reverting this packet's guard change leaves those two failures identical,
 *  so the red is pre-existing and is reported, not inherited.
 *
 *  ⚰️ ATTRIBUTION CORRECTED 2026-09-14: this first named `0b7570df4`, which is merely
 *  the LAST commit to touch the page. `git log -S"firstThemeTicker"` names the one that
 *  actually removed the auto-open: **`453ecc3ec`** (2026-09-05, *"feat(theme-sets):
 *  rebuilt editor — watchlist-style, in-widget, optimistic"*, +253/-115). The behaviour
 *  was added by `3fe7b63e3` and is absent at HEAD. **Last-to-touch is not who changed
 *  it; the pickaxe is.** */
async function selectAAPL(vis) {
  const user = userEvent.setup()
  render(<BoardVisibilityContext.Provider value={vis}><ThemeTrackerPage /></BoardVisibilityContext.Provider>)
  await user.click(await screen.findByText('Test Theme', {}, { timeout: 8000 }))
  await user.click(await screen.findByText('AAPL', {}, { timeout: 8000 }))
}

test('TK1 (red first) a hidden layer board tracker answers no key; shown, it does', async () => {
  const vis = createBoardVisibility({ layer: true })
  await selectAAPL(vis)
  fireEvent.keyDown(window, { key: 'F', code: 'KeyF', shiftKey: true })
  expect(flagSpy.toggle, 'NON-VACUITY: a shown tracker flags its selection').toHaveBeenCalledTimes(1)
  act(() => { vis.set('hidden') })
  flagSpy.toggle.mockClear()
  const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
  window.dispatchEvent(ev)
  fireEvent.keyDown(window, { key: 'F', code: 'KeyF', shiftKey: true })
  expect(flagSpy.toggle, 'a hidden board tracker flagged its selection').not.toHaveBeenCalled()
  expect(ev.defaultPrevented, 'a hidden board tracker took the arrow').toBe(false)
  act(() => { vis.set('visible') })
  fireEvent.keyDown(window, { key: 'F', code: 'KeyF', shiftKey: true })
  expect(flagSpy.toggle).toHaveBeenCalledTimes(1)
})
