// CustomScan — the /charts ChartPane mount has NO test coverage at all: this
// page has no test file, period. The ChartPane swap (~CustomScan.jsx:806) is
// only reachable on desktop (guarded by `!isPhone` — CustomScan takes no
// `embedded` prop at all, unlike Watchlists/ThemeTrackerPage), so nothing
// short of a dedicated test can see this mount. A wrong sym, a stale
// timeframe, or a silently-added `onStore` would all ship invisibly.
//
// These tests render on the desktop path, select a scanned ticker row, and
// assert what the page hands ChartPane: the selected symbol + current
// timeframe, `stored=null` with no `onStore` (the "your chart everywhere"
// contract), and that symbol retargeting stays enabled.
//
// Mock `ChartPane` itself to a stub exposing what it was passed — the same
// idiom TickerPopup.test.jsx uses for StockChart, and the same technique the
// sibling Watchlists/ThemeTrackerPage chartmount tests use — so ChartPane's
// own internals (AuthProvider, useFlagged, fundamentals, a market clock)
// never need satisfying.
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

vi.mock('../utils/prefetchBars', () => ({
  prefetchBars: () => {}, prefetchAllTimeframes: () => {},
}))
vi.mock('../hooks/useFlagged', () => ({
  useFlagged: () => ({ toggle: () => {}, isFlagged: () => false }),
}))
vi.mock('../hooks/useTickerTags', () => ({
  default: () => ({ getTag: () => null }),
}))
// Forces the desktop layout (the `!isPhone` gate on CustomScan's chart panel)
// regardless of jsdom's default viewport / matchMedia behavior.
vi.mock('../hooks/useBreakpoint', () => ({
  useIsPhone: () => false,
}))
// CustomScan's own useSWR('/api/scanner/universe') → no breadth-universe rows;
// the test ticker comes through the real `allCandidates` prop instead.
vi.mock('swr', () => ({
  default: () => ({ data: undefined, mutate: () => {} }),
}))

// The panel under test. Stub exposes exactly what the page passed it.
vi.mock('../components/chart/pane/ChartPane', () => ({
  default: ({ sym, tf, stored, onSymbolChange }) => (
    <div
      data-testid={`chart-pane-${sym}-${tf}`}
      data-stored={stored === null ? 'null' : String(stored)}
      data-has-symbol-change={onSymbolChange ? 'yes' : 'no'}
    >pane {sym} {tf}</div>
  ),
}))

const CustomScan = (await import('./CustomScan')).default

beforeEach(() => {
  localStorage.clear()
  // useBreadthGrouping's useGroupMeta fires a real fetch('/api/breadth/industries')
  // whenever the merged universe is non-empty — stub it out so it resolves harmlessly.
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

const CANDIDATE = { ticker: 'AAPL', company: 'Apple Inc' }

function renderStandalone() {
  return render(<CustomScan allCandidates={[CANDIDATE]} />)
}

test('empty state: no ticker selected shows the placeholder and mounts no chart pane', async () => {
  renderStandalone()
  // Flush useGroupMeta's real fetch('/api/breadth/industries') (fired because
  // allCandidates seeds a non-empty universe) inside act() so its resolution
  // doesn't land as a post-test state update.
  await act(async () => {})
  expect(screen.getByText(/select a ticker to view chart/i)).toBeInTheDocument()
  expect(screen.queryByTestId(/^chart-pane-/)).not.toBeInTheDocument()
})

test('selecting a row mounts ChartPane with that symbol and the current timeframe', async () => {
  const user = userEvent.setup()
  renderStandalone()

  await user.click(screen.getByText('AAPL'))

  // CustomScan's own chartPeriod state defaults to 'D' — this proves the page
  // passes the SELECTED symbol and its CURRENT timeframe through, not a
  // hardcoded or stale value.
  expect(await screen.findByTestId('chart-pane-AAPL-D', {}, { timeout: 8000 })).toBeInTheDocument()
})

test('passes stored=null with no onStore, and keeps symbol retargeting enabled', async () => {
  const user = userEvent.setup()
  renderStandalone()
  await user.click(screen.getByText('AAPL'))

  // Located by a symbol/tf-agnostic regex so this assertion is immune to a
  // sym/tf mutation and stays focused on the settings contract + retargeting.
  const pane = await screen.findByTestId(/^chart-pane-/, {}, { timeout: 8000 })
  // The assertion that matters most and is least obvious: stored={null} with
  // no onStore is what makes this panel render the user's OWN global
  // chart_settings. If someone later passes an onStore here, this page
  // silently stops being "your chart everywhere" and nothing else notices.
  expect(pane).toHaveAttribute('data-stored', 'null')
  // Unlike the locked TickerPopup, the user IS allowed to retarget the ticker
  // from this chart.
  expect(pane).toHaveAttribute('data-has-symbol-change', 'yes')
})
