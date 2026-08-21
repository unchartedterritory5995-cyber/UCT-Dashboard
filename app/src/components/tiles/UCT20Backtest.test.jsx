import { renderWithProviders, screen, fireEvent } from '../../test-utils'
import { vi } from 'vitest'

// UCT20Backtest fetches /api/uct20/backtest via useSWR — mock it with a
// realistic payload so the component renders its full key-stats row.
//
// UCT20 has NO stop-loss mechanism: `_book_exit` in uct-intelligence's
// get_uct20_portfolio() hardcodes exit_reason="list_exit" for every trade.
// A "STOP-OUT RATE" stat is therefore structurally always 0% — it reads as
// "our stops never get hit" when the truth is "there are no stops." That
// stat was removed 2026-08-18; this file guards against it coming back.
const mockData = {
  equity_curve: [
    { date: '2026-01-02', value: 50000 },
    { date: '2026-02-02', value: 51200 },
    { date: '2026-03-02', value: 49800 },
    { date: '2026-04-02', value: 52600 },
  ],
  monthly_returns: [],
  drawdown_series: [],
  trade_distribution: [],
  rolling_alpha: [],
  max_drawdown: -12.4,
  profit_factor: 1.35,
  max_win_streak: 6,
  max_loss_streak: 4,
  best_trade: { symbol: 'NVDA', pct_return: 41.2, days_held: 38, entry_date: '2026-01-05', exit_date: '2026-02-12' },
  worst_trade: { symbol: 'RIVN', pct_return: -31.2, days_held: 22, entry_date: '2026-02-01', exit_date: '2026-02-23' },
  // The MEASURED backtest, carried alongside the live-tracker analytics.
  harness: {
    kind: 'backtest',
    window: { start: 20220103, end: 20260618, sessions: 1119 },
    variant: { label: 'Risk-managed (stops)', total_return_pct: 404.4844, max_drawdown: -12.9128, expectancy_pct: 2.4436, win_rate: 19.6672, trade_count: 661 },
    control: { label: 'List-follower (no stops)', total_return_pct: 263.9933, max_drawdown: -46.9196, expectancy_pct: 1.6271, win_rate: 43.279, trade_count: 982 },
  },
}

vi.mock('swr', () => ({
  default: vi.fn(() => ({ data: mockData, error: undefined, mutate: vi.fn() })),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

import useSWR from 'swr'
import UCT20Backtest from './UCT20Backtest'

function openPanel() {
  renderWithProviders(<UCT20Backtest />)
  fireEvent.click(screen.getByText('BACKTEST ANALYTICS'))
}

test('renders the key stats row with real metrics', () => {
  openPanel()
  expect(screen.getByText('PROFIT FACTOR')).toBeInTheDocument()
  expect(screen.getByText('1.35')).toBeInTheDocument()
  expect(screen.getByText('WIN STREAK')).toBeInTheDocument()
  expect(screen.getByText('LOSS STREAK')).toBeInTheDocument()
  // TWO of them now, and that is the point: the measured table and the live
  // tracker each report a max drawdown, and they are different numbers
  // (-12.9% measured vs -12.4% live). Each sits under its own header.
  expect(screen.getAllByText('MAX DRAWDOWN')).toHaveLength(2)
  expect(screen.getByText('LIVE TRACKER — NO STOPS')).toBeInTheDocument()
})

// The regression guard: UCT20 has no stop-loss, so a "stop-out rate" stat
// is structurally impossible to be anything but 0% and misleads in the
// opposite direction from reality (26.8% win rate, -3.68% expectancy,
// 33/142 trades worse than -8%, worst -31.2% — precisely because nothing
// stops anything out). It must never render again.
test('does NOT render a STOP-OUT RATE stat', () => {
  openPanel()
  expect(screen.queryByText(/stop-out rate/i)).not.toBeInTheDocument()
  expect(screen.queryByText('0%')).not.toBeInTheDocument()
})

// ── The measured A/B ──────────────────────────────────────────────────────
// This is the whole point of the tile: the tracker members see is the NO-STOPS
// arm, and its own backtest is +263.99% at -46.92% drawdown. Showing the
// stopped arm's +404.48% without that column beside it would be quoting a
// number against nothing.

test('renders the measured backtest with BOTH arms', () => {
  openPanel()
  expect(screen.getByText('MEASURED BACKTEST')).toBeInTheDocument()
  expect(screen.getByText('1119 sessions · 2022-01-03 → 2026-06-18')).toBeInTheDocument()
  // By role: 'NO STOPS' also appears in the note below the table, and an
  // ambiguous getByText would fail on the duplicate rather than on the bug.
  expect(screen.getByRole('columnheader', { name: 'WITH STOPS' })).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'NO STOPS' })).toBeInTheDocument()
  expect(screen.getByText('+404.5%')).toBeInTheDocument()
  expect(screen.getByText('+264.0%')).toBeInTheDocument()
})

test('shows the drawdown the no-stops arm actually took', () => {
  openPanel()
  // -46.9% is the number that justifies the whole risk system. If the tile
  // ever renders the stopped arm's -12.9% alone, it is selling a result the
  // live tracker does not produce.
  expect(screen.getByText('-46.9%')).toBeInTheDocument()
  expect(screen.getByText('-12.9%')).toBeInTheDocument()
})

test('names the no-stops column as the system the tracker implements', () => {
  openPanel()
  expect(screen.getByText(/is the system the tracker above/i)).toBeInTheDocument()
})

test('omits the measured section entirely when the manifest is unavailable', () => {
  useSWR.mockImplementation(() => ({ data: { ...mockData, harness: {} }, mutate: vi.fn() }))
  renderWithProviders(<UCT20Backtest />)
  fireEvent.click(screen.getByText('BACKTEST ANALYTICS'))
  expect(screen.queryByText('MEASURED BACKTEST')).not.toBeInTheDocument()
  // ...and the rest of the tile still renders.
  expect(screen.getByText('PROFIT FACTOR')).toBeInTheDocument()
})

// Keep this after the other tests — it replaces the module-level mock's
// implementation for the rest of the file (mirrors UCT20.test.jsx's pattern).
test('renders nothing (no crash) when there is no equity curve yet', () => {
  useSWR.mockImplementation(() => ({ data: undefined, mutate: vi.fn() }))
  const { container } = renderWithProviders(<UCT20Backtest />)
  expect(container).toBeTruthy()
  expect(screen.queryByText('BACKTEST ANALYTICS')).not.toBeInTheDocument()
})
