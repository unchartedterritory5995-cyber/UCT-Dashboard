// ThemeTrackerPage — Shift+F flags the selected holding; the PLATFORM ACCELERATOR
// chord must not.
//
// ⚰️ F-S2-1, measured on `feb7ba1f8`. Five surfaces claimed Shift+F and disagreed about
// which modifiers they answered: `ChartPane.jsx` excluded ctrl/alt/meta, this page did
// not. So a member reaching for Ctrl+Shift+F / Cmd+Shift+F — the browser's find chord —
// got a SILENT write to their flag list here and nothing on the chart. That is HY-35's
// recorded class ("one chord flagged a ticker in two widgets at once") in the form the
// 2026-08-28 ownership fix did not cover.
//
// ⛔ BEHAVIOUR, NOT SHAPE. `pages/command/chordCollision.test.js` derives the guard set
// from SOURCE and is how the defect was found — but it reads text. It would stay green
// if the exclusions were present and the handler fired anyway, and it cannot see a page
// that flags through some other spelling. These cases mount the real page and assert
// the decision a member feels: did my flag list change?
//
// Harness mirrors ThemeTrackerPage.chartmount.test.jsx, with `useFlagged` observed.
import { render, screen, fireEvent } from '@testing-library/react'
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
 *  does not. The last commit to touch the page is `0b7570df4` (*"simpler customize —
 *  read-only Default + auto-saving presets"*), which postdates that test. Reverting this
 *  packet's guard change leaves those two failures identical, so the red is pre-existing
 *  and is reported, not inherited. */
async function selectAAPL() {
  const user = userEvent.setup()
  render(<ThemeTrackerPage />)
  await user.click(await screen.findByText('Test Theme', {}, { timeout: 8000 }))
  await user.click(await screen.findByText('AAPL', {}, { timeout: 8000 }))
}

test('POSITIVE CONTROL: bare Shift+F still flags the selected holding', async () => {
  await selectAAPL()
  fireEvent.keyDown(window, { key: 'F', code: 'KeyF', shiftKey: true })
  expect(flagSpy.toggle).toHaveBeenCalledWith('AAPL')
})

test.each([
  ['Ctrl', { ctrlKey: true }],
  ['Cmd', { metaKey: true }],
  ['Alt', { altKey: true }],
])('%s+Shift+F does NOT touch the flag list', async (_label, mods) => {
  await selectAAPL()
  fireEvent.keyDown(window, { key: 'F', code: 'KeyF', shiftKey: true, ...mods })
  expect(flagSpy.toggle).not.toHaveBeenCalled()
})

test('CapsLock + Ctrl+Shift+F is refused, and the same casing WITHOUT it still flags', async () => {
  // ⭐ Both halves in one case on purpose: the refusal has to be about the MODIFIER.
  // A guard that had simply stopped answering lowercase would pass the first assertion
  // and fail the member exactly as the original defect did.
  await selectAAPL()
  fireEvent.keyDown(window, { key: 'f', code: 'KeyF', shiftKey: true, ctrlKey: true })
  expect(flagSpy.toggle).not.toHaveBeenCalled()

  fireEvent.keyDown(window, { key: 'f', code: 'KeyF', shiftKey: true })
  expect(flagSpy.toggle).toHaveBeenCalledWith('AAPL')
})
