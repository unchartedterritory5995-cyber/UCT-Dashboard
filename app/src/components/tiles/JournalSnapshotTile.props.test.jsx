// app/src/components/tiles/JournalSnapshotTile.props.test.jsx
//
// ─── THE TWO REVERSIBLE SWITCHES, MEASURED RATHER THAN CLAIMED ──────────────
//
// The dashboard cockpit moved the 3-month equity curve off the paid home: it
// was the first number a member saw every morning (−46.85% at the time) and it
// is not a decision input. The spec calls that call REVERSIBLE, and a comment
// saying "it is a prop" is not reversibility — this file is.
//
// ⭐ IT ASSERTS BOTH DIRECTIONS. Default-off is one half; the other is that
// `showEquityCurve period="3M"` restores exactly what the tile did before, so
// whoever wants the curve back has a one-line change and a passing test
// proving it works, not an archaeology exercise.
//
// ⛔ THE PERIOD PROP REACHES THE ENDPOINT — ASSERTED ON THE SWR KEY, not on a
// rendered label. A label test would pass for a tile that renders `period`
// while still requesting `3M`, which is the exact "computed but never applied"
// shape this repo keeps rediscovering (`lesson_a_guard_that_tests_the_adjacent_thing`).
import { renderWithProviders, screen, cleanup } from '../../test-utils'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  positions: null, options: null, prices: {}, broker: null, accounts: null,
  perf: null, keys: [],
}))

vi.mock('swr', () => ({
  default: (key) => {
    const k = String(key)
    h.keys.push(k)
    if (k.includes('/broker/performance')) return { data: h.perf, isLoading: false }
    if (k.includes('/broker')) return { data: h.broker, isLoading: false }
    if (k.includes('/accounts')) return { data: h.accounts, isLoading: false }
    if (k.includes('/positions')) return { data: h.positions, isLoading: false }
    if (k.includes('/options')) return { data: h.options, isLoading: false }
    return { data: undefined, isLoading: false, mutate: () => {} }
  },
  useSWRConfig: () => ({ mutate: () => {} }),
}))

vi.mock('../../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: h.prices, isLoading: false, isStreaming: true, staleSymbols: new Set() }),
}))

import JournalSnapshotTile from './JournalSnapshotTile'

/** A broker-backed book with a real equity series — the only shape that draws
 *  a curve at all, so the assertions below are about the PROP and not about a
 *  series too short for `sparkPaths` to return anything. */
function brokerBook() {
  h.positions = {
    positions: [
      { id: 'p1', symbol: 'SPY', side: 'Long', shares: 1, entryPrice: 740, stopPrice: 700 },
    ],
  }
  h.options = { strategies: [] }
  h.accounts = { accounts: [{ id: 'a1', balanceSource: 'broker', brokerTotalEquity: 14632.18 }] }
  h.perf = {
    endEquity: 14632.18,
    dollarPnl: 120.5,
    timeWeighted: 0.008,
    brokerCount: 1,
    equitySeries: [
      { date: '2026-06-17', value: 14400.0, estimated: false },
      { date: '2026-06-18', value: 14511.68, estimated: false },
      { date: '2026-06-19', value: 14632.18, estimated: false },
    ],
  }
  h.prices = {}
}

/** The curve is a `<path>` inside the spark <svg>; Sparkline itself returns
 *  null for a series shorter than two finite points, so presence of the svg is
 *  the honest signal. */
const curve = () => document.querySelector('[class*="spark"]')

beforeEach(() => {
  h.positions = null; h.options = null; h.prices = {}
  h.broker = null; h.accounts = null; h.perf = null; h.keys = []
})
afterEach(cleanup)

describe('showEquityCurve', () => {
  test('is OFF by default — the paid home draws no equity curve', () => {
    brokerBook()
    renderWithProviders(<JournalSnapshotTile />)
    // The hero itself still renders: this is a removed curve, not a removed tile.
    expect(screen.getByText('$14,632.18')).toBeInTheDocument()
    expect(curve(), 'the 3M equity curve is back on the dashboard hero').toBeNull()
  })

  test('and ON restores it — the pre-cockpit behaviour is one prop away', () => {
    // ⭐ THE CONTROL FOR THE TEST ABOVE. Without it, "no curve" would be
    // satisfied by a tile that can no longer draw one at all, which is a
    // deletion wearing a prop's clothes.
    brokerBook()
    renderWithProviders(<JournalSnapshotTile showEquityCurve />)
    expect(curve(), 'showEquityCurve no longer draws anything — the switch is '
      + 'one-way, so the spec\'s "reversible" is false').not.toBeNull()
  })
})

describe('period', () => {
  test('defaults to a window the performance endpoint actually knows', () => {
    // ⛔ NOT '1D'. api/services/journal_two/broker/performance_service.py's
    // `_period_start` maps only ALL / YTD / 1W / 1M / 3M / 1Y and returns None
    // — ALL TIME — for anything else, so a '1D' default would have captioned
    // the all-time P&L "1D". This asserts the DEFAULT is inside that set.
    const KNOWN = ['ALL', 'YTD', '1W', '1M', '3M', '1Y']
    brokerBook()
    renderWithProviders(<JournalSnapshotTile />)
    const perfKey = h.keys.find((k) => k.includes('/broker/performance'))
    expect(perfKey, 'the tile stopped asking for broker performance').toBeTruthy()
    const asked = new URL(perfKey, 'http://x').searchParams.get('period')
    expect(KNOWN,
      `the tile asks the performance endpoint for period="${asked}", which `
      + '_period_start does not know — it silently answers ALL TIME and the '
      + 'tile captions it with the unknown name').toContain(asked)
  })

  test('reaches the performance endpoint, not just the label', () => {
    brokerBook()
    renderWithProviders(<JournalSnapshotTile showEquityCurve period="3M" />)
    const perfKey = h.keys.find((k) => k.includes('/broker/performance'))
    expect(perfKey).toContain('period=3M')
    // …and the caption agrees with what was asked for, so the two cannot drift.
    expect(screen.getByText('3M')).toBeInTheDocument()
  })

  test('CONTROL: a different period changes BOTH the request and the caption', () => {
    // Without this, `period=3M` above could pass against a hardcoded '3M'.
    brokerBook()
    renderWithProviders(<JournalSnapshotTile period="1Y" />)
    const perfKey = h.keys.find((k) => k.includes('/broker/performance'))
    expect(perfKey).toContain('period=1Y')
    expect(screen.getByText('1Y')).toBeInTheDocument()
    expect(screen.queryByText('3M')).toBeNull()
  })
})
