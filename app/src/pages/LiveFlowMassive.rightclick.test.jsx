// LiveFlowMassive — right-click (contextmenu) on a ticker cell must open the
// full chart via TickerPopup in controlled mode, WITHOUT disturbing the
// existing left-click "filter to this ticker" behavior.
//
// Mocking follows the proven TickerPopup.test.jsx idiom: stub the deep leaf
// (StockChart, which ChartPane itself renders) and prefetchBars' side
// effects, then exercise the REAL TickerPopup + the REAL AlertRow wiring.
// global.fetch is stubbed to special-case the live poll endpoint
// (/api/live/massive/recent) with two distinct tickers so the left-click
// filter assertion has a second row that must disappear; every other
// endpoint this page polls on mount (thresholds/day-stats/worker-history/
// current-quotes/flow-dates) gets a benign empty-JSON response — each of
// those call sites already soft-fails on a missing field (verified by
// reading them), so this doesn't need per-endpoint shaping.
import { renderWithProviders, screen, fireEvent, waitFor, act } from '../test-utils'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

vi.mock('../utils/prefetchBars', () => ({
  prefetchAllTimeframes: vi.fn(),
  prefetchBars: vi.fn(),
  prefetchBar: vi.fn(),
  default: vi.fn(),
}))
vi.mock('../components/StockChart', () => ({
  default: ({ sym, tf }) => <div data-testid={`stock-chart-${sym}-${tf}`}>chart {sym} {tf}</div>,
}))

import LiveFlowMassive from './LiveFlowMassive'

const NOW = Math.floor(Date.now() / 1000)
// `_tierKey` must be one of TIER_ORDER (alpha/size/bullish/bearish/leaps/
// unusual) — "algo" has no filter chip in this file (removed 2026-07-21,
// see TIER_ORDER's comment) so an alert without a recognized `_tierKey`
// silently auto-hides. Setting it explicitly is what makes these rows show.
const ALERTS = [
  { id: 'a1', ticker: 'AAPL', cp: 'C', strike: 150, exp: '2026-09-19',
    alertPremium: 500000, alertName: 'UCT Bullish', _tierKey: 'bullish', _direction: 'Bull', timestamp: NOW },
  { id: 'a2', ticker: 'MSFT', cp: 'P', strike: 400, exp: '2026-10-17',
    alertPremium: 300000, alertName: 'UCT Bearish', _tierKey: 'bearish', _direction: 'Bear', timestamp: NOW - 5 },
]

function mockFetch() {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    if (u.includes('/api/live/massive/recent')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ alerts: ALERTS, status: { connected: true } }),
      })
    }
    // MarketReadCard (always mounted above the tape) reads
    // stats.total_classified.toLocaleString() unguarded — a bare `{}` throws.
    // Give it just enough shape to render its non-loading branch safely.
    if (u.includes('/api/live/massive/day-stats')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          total_classified: 0, query_date: '2026-08-05',
          bull_premium: 0, bear_premium: 0,
          last_hour: { bull_premium: 0, bear_premium: 0, count: 0, is_today_target: false },
          top_bull: [], top_bear: [], by_dte: [],
        }),
      })
    }
    // Every other endpoint (thresholds, worker-history, current-quotes,
    // flow/dates, ...) — benign empty response.
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  }))
}

beforeEach(() => {
  localStorage.clear()
  mockFetch()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// The ticker `<span>` carries `title="Filter to {ticker}"` — unambiguous
// even once a same-text active-filter pill could otherwise collide.
test('right-click on a ticker cell opens the chart popup', async () => {
  renderWithProviders(<LiveFlowMassive />)
  const tickerCell = await screen.findByTitle('Filter to AAPL')

  fireEvent.contextMenu(tickerCell)

  // TickerPopup mounts ChartPane as a lazy chunk (a heavier one than bare
  // StockChart) — under full-suite parallel load the Suspense fallback can
  // still be up when the default findBy timeout elapses (same flakiness
  // class TickerPopup.test.jsx documents). Generous explicit timeout, same
  // idiom as Watchlists.chartmount.test.jsx.
  expect(await screen.findByTestId('chart-modal', {}, { timeout: 8000 })).toBeInTheDocument()
  // The popup opened for the RIGHT-CLICKED symbol, not a hardcoded one.
  expect(await screen.findByTestId('stock-chart-AAPL-D', {}, { timeout: 8000 })).toBeInTheDocument()
})

// iOS Safari doesn't reliably fire `contextmenu` on touch-hold — the chart
// open must also work via the useLongPress touch path (pointerdown held past
// the 450ms threshold), independent of the contextmenu event tested above.
test('touch long-press on a ticker cell opens the chart popup', async () => {
  renderWithProviders(<LiveFlowMassive />)
  const tickerCell = await screen.findByTitle('Filter to AAPL')

  vi.useFakeTimers()
  fireEvent.pointerDown(tickerCell, { pointerType: 'touch', clientX: 10, clientY: 10 })
  act(() => { vi.advanceTimersByTime(460) })
  vi.useRealTimers()

  expect(await screen.findByTestId('chart-modal', {}, { timeout: 8000 })).toBeInTheDocument()
  expect(await screen.findByTestId('stock-chart-AAPL-D', {}, { timeout: 8000 })).toBeInTheDocument()
})

test('plain left-click on a ticker cell filters the tape and does NOT open the chart popup', async () => {
  renderWithProviders(<LiveFlowMassive />)
  const tickerCell = await screen.findByTitle('Filter to AAPL')
  // Sanity: both rows present before the click.
  expect(await screen.findByTitle('Filter to MSFT')).toBeInTheDocument()

  fireEvent.click(tickerCell)

  // Filter behavior preserved exactly: clicking AAPL's ticker cell narrows
  // the tape to AAPL only, so MSFT's row drops out.
  await waitFor(() => expect(screen.queryByTitle('Filter to MSFT')).not.toBeInTheDocument())
  expect(screen.getByTitle('Filter to AAPL')).toBeInTheDocument()
  // And the chart popup must NOT have opened from a plain left-click.
  expect(screen.queryByTestId('chart-modal')).not.toBeInTheDocument()
})
