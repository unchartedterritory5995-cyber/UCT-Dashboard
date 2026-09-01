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
  open_positions: [
    // HPE is the case the owner kept pointing at: the tracker rode it well
    // past the published stop, and the row printed that stop right beside it.
    { symbol: 'HPE',  entry_price: 55.75, stop_price: 53.40, pct_return: -6.17, days_held: 4 },
    { symbol: 'NET',  entry_price: 290.0, stop_price: 281.3, pct_return: 3.29,  days_held: 4 },
    { symbol: 'MRVL', entry_price: 253.4, stop_price: 245.2, pct_return: -14.5, days_held: 4 },
  ],
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

// The tile now makes TWO calls: the portfolio curve and the Book lane. A mock
// that answers both with the same payload would hand portfolio data to
// BookLane, which then renders nothing -- and every Book assertion below
// would pass vacuously. Dispatch on the URL.
const hoisted = vi.hoisted(() => ({ book: null }))

vi.mock('swr', () => ({
  default: vi.fn(url => ({
    data: url === '/api/uct20/book' ? hoisted.book : mockData,
    error: undefined,
    mutate: vi.fn(),
  })),
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


/* ── The risk-managed Book lane ────────────────────────────────────────────
   The curve this tile draws is the NO-STOPS arm. The Book is the same list
   with triggers and stops. While its sample is short it must render PROGRESS
   and never PERFORMANCE: on 2026-08-20 it held two closed trades and an
   expectancy of -11.56%, and showing that beside a 1,119-session backtest
   reporting +2.44% would misinform rather than inform. */

const recordingBook = {
  kind: 'live_book', record_status: 'recording', stats_published: false,
  sessions: 14, closed_trades_min_arm: 2, min_trades_for_stats: 30,
  variant: { total_return_pct: -1.216, expectancy_pct: -11.5607, trade_count: 2 },
}

test('renders nothing for the Book when it is off or has never run', () => {
  hoisted.book = null
  renderWithProviders(<UCT20Performance />)
  expect(screen.queryByText('RISK-MANAGED BOOK')).not.toBeInTheDocument()
})

test('a short Book shows progress, never performance', () => {
  hoisted.book = recordingBook
  renderWithProviders(<UCT20Performance />)
  expect(screen.getByText('RISK-MANAGED BOOK')).toBeInTheDocument()
  expect(screen.getByText('RECORDING')).toBeInTheDocument()
  // Progress IS shown.
  expect(screen.getByText('14')).toBeInTheDocument()
  expect(screen.getByText('30')).toBeInTheDocument()
  // The numbers are in the payload and must NOT reach the screen.
  expect(screen.queryByText(/-11\.56/)).not.toBeInTheDocument()
  expect(screen.queryByText(/-1\.22%/)).not.toBeInTheDocument()
  expect(screen.queryByText('EXPECTANCY / TRADE')).not.toBeInTheDocument()
})

test('a Book with a usable sample reports its numbers', () => {
  hoisted.book = {
    ...recordingBook, record_status: 'reporting', stats_published: true,
    sessions: 210, closed_trades_min_arm: 64,
    variant: { total_return_pct: 31.4, expectancy_pct: 2.41, trade_count: 64 },
  }
  renderWithProviders(<UCT20Performance />)
  expect(screen.getByText('LIVE')).toBeInTheDocument()
  expect(screen.getByText('+31.40%')).toBeInTheDocument()
  expect(screen.getByText('+2.41%')).toBeInTheDocument()
  expect(screen.getByText('EXPECTANCY / TRADE')).toBeInTheDocument()
  expect(screen.queryByText('RECORDING')).not.toBeInTheDocument()
})


/* ── Per-name Book verdicts on the open rows ───────────────────────────────
   The row draws the NO-STOPS tracker and used to print the published
   "stop $X" beside a return that ignored it. Owner, three times (8/26, 8/27,
   8/29): "I already see large negative losses that surpass those stops."
   Both numbers are true of different arms; the row now says which is which. */

const verdictBook = {
  ...recordingBook,
  positions_by_symbol: {
    HPE: { state: 'closed', pct_return: -4.3131, exit_reason: 'stop',
           entry_px: 55.75, exit_px: 53.40 },
    NET: { state: 'open', pct_return: 3.29, exit_reason: null,
           entry_px: 290.0, exit_px: null },
  },
}

test('a name the Book stopped says so, with the Book own exit', () => {
  hoisted.book = verdictBook
  renderWithProviders(<UCT20Performance />)
  expect(screen.getByText(/book: stopped -4\.3%/)).toBeInTheDocument()
})

test('the tracker percentage is still shown beside it, unchanged', () => {
  hoisted.book = verdictBook
  renderWithProviders(<UCT20Performance />)
  // -6.17% is the no-stops number. Both must be on screen or the row is a
  // half-truth in whichever direction it dropped.
  expect(screen.getByText('-6.2%')).toBeInTheDocument()
})

test('a name the Book still holds shows the Book mark, not the stop price', () => {
  hoisted.book = verdictBook
  renderWithProviders(<UCT20Performance />)
  expect(screen.getByText(/book: \+3\.3%/)).toBeInTheDocument()
  expect(screen.queryByText('stop $281.3')).not.toBeInTheDocument()
})

test('a name the Book never filled says no fill rather than inventing one', () => {
  // MRVL gapped 3.4% past its entry and rules.py refused the fill. The tracker
  // bought that open anyway and sits -14.5%.
  hoisted.book = verdictBook
  renderWithProviders(<UCT20Performance />)
  expect(screen.getByText('book: no fill')).toBeInTheDocument()
})

test('the header names both arms so the columns cannot be conflated', () => {
  hoisted.book = verdictBook
  renderWithProviders(<UCT20Performance />)
  expect(screen.getByText(/no-stops tracker/)).toBeInTheDocument()
})

test('an older payload without verdicts falls back to the stop price', () => {
  // /api/uct20/book is cached for an hour; a pod mid-deploy can still serve
  // the old shape. Claiming "no fill" for all 20 names would be a lie.
  hoisted.book = recordingBook
  renderWithProviders(<UCT20Performance />)
  expect(screen.getByText('stop $53.4')).toBeInTheDocument()
  expect(screen.queryByText('book: no fill')).not.toBeInTheDocument()
})
