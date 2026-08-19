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
  expect(screen.getByText('MAX DRAWDOWN')).toBeInTheDocument()
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

// Keep this after the other tests — it replaces the module-level mock's
// implementation for the rest of the file (mirrors UCT20.test.jsx's pattern).
test('renders nothing (no crash) when there is no equity curve yet', () => {
  useSWR.mockImplementation(() => ({ data: undefined, mutate: vi.fn() }))
  const { container } = renderWithProviders(<UCT20Backtest />)
  expect(container).toBeTruthy()
  expect(screen.queryByText('BACKTEST ANALYTICS')).not.toBeInTheDocument()
})
