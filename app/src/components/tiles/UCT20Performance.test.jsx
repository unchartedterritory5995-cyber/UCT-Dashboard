import { renderWithProviders, screen, fireEvent } from '../../test-utils'
import { vi } from 'vitest'

// UCT20Performance fetches /api/uct20/portfolio via useMobileSWR (which
// wraps useSWR from 'swr') — mock 'swr' so the component renders a
// realistic trades table without a real fetch.
//
// UCT20 has NO stop-loss mechanism: `_book_exit` in uct-intelligence's
// get_uct20_portfolio() hardcodes exit_reason="list_exit" for every one of
// its 142 trades. A STOP/LIST badge on each trade row is therefore
// permanently "LIST" — the REASON column carries zero information, and
// reads as if stops exist and simply never trigger. The column (header +
// per-row badge) was removed 2026-08-18; this file guards against it
// coming back.
const mockData = {
  equity_curve: [
    { date: '2026-06-01', value: 50000 },
    { date: '2026-07-01', value: 47800 },
    { date: '2026-08-01', value: 46100 },
  ],
  qqq_curve: [
    { date: '2026-06-01', pct: 0 },
    { date: '2026-07-01', pct: 2.1 },
    { date: '2026-08-01', pct: 3.4 },
  ],
  current_value: 46100,
  total_pnl: -3900,
  alpha_vs_qqq: -12.3,
  win_rate: 26.8,
  avg_win_pct: 9.4,
  avg_loss_pct: -8.1,
  open_count: 14,
  avg_hold_days: 18,
  open_positions: [],
  tracking_since: '2026-06-22',
  as_of: '2026-08-17',
  trades: [
    {
      symbol: 'RIVN', entry_date: '2026-06-05', exit_date: '2026-06-27',
      entry_price: 12.4, exit_price: 8.53, pct_return: -31.2, days_held: 22,
      exit_reason: 'list_exit', win: false,
    },
    {
      symbol: 'NVDA', entry_date: '2026-06-08', exit_date: '2026-07-15',
      entry_price: 118.2, exit_price: 141.6, pct_return: 19.8, days_held: 37,
      exit_reason: 'list_exit', win: true,
    },
  ],
}

vi.mock('swr', () => ({
  default: vi.fn(() => ({ data: mockData, error: undefined, mutate: vi.fn() })),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

import UCT20Performance from './UCT20Performance'

function openTrades() {
  renderWithProviders(<UCT20Performance />)
  fireEvent.click(screen.getByText(/ALL TRADES/i))
}

test('renders the trades table with real trade data', () => {
  openTrades()
  expect(screen.getByText('RIVN')).toBeInTheDocument()
  expect(screen.getByText('NVDA')).toBeInTheDocument()
  expect(screen.getByText('SYM')).toBeInTheDocument()
  expect(screen.getByText('DAYS')).toBeInTheDocument()
})

test('the "no stops" subtitle survives and still reads correctly', () => {
  renderWithProviders(<UCT20Performance />)
  expect(screen.getByText(/no stops/i)).toBeInTheDocument()
})

// The regression guard: exit_reason is hardcoded to "list_exit" for every
// UCT20 trade (no stop-loss exists), so a STOP/LIST badge column always
// reads LIST and communicates nothing — worse, it implies a stop mechanism
// that isn't there. Neither the REASON header nor any STOP/LIST badge text
// should render again.
test('does NOT render a REASON column or STOP/LIST badges', () => {
  openTrades()
  expect(screen.queryByText('REASON')).not.toBeInTheDocument()
  expect(screen.queryByText('STOP')).not.toBeInTheDocument()
  expect(screen.queryByText('LIST')).not.toBeInTheDocument()
})

test('renders skeleton (no crash) when no data', () => {
  const { container } = renderWithProviders(<UCT20Performance />)
  expect(container).toBeTruthy()
})
