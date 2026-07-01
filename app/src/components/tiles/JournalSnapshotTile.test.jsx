import { renderWithProviders, screen } from '../../test-utils'
import { vi } from 'vitest'
import { positionTodayDollar } from './JournalSnapshotTile'

// Shared mutable state the mocks read from. vi.hoisted so it exists before the
// vi.mock factories run.
const h = vi.hoisted(() => ({
  positions: null, options: null, prices: {}, broker: null, accounts: null, perf: null,
}))

// useSWR is keyed by URL — return the matching slice. Order matters:
// /broker/performance before the generic /broker (status) check.
vi.mock('swr', () => ({
  default: (key) => {
    const k = String(key)
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

beforeEach(() => {
  h.positions = null
  h.options = null
  h.prices = {}
  h.broker = null
  h.accounts = null
  h.perf = null
})

test('positionTodayDollar derives today $ from live snapshot', () => {
  // price 88, +10% → prevClose 80 → today = (88-80)*100 = 800 for a long.
  const long = { side: 'Long', shares: 100 }
  expect(positionTodayDollar(long, { price: 88, change_pct: 10 })).toBeCloseTo(800, 5)
  // short flips the sign.
  const short = { side: 'Short', shares: 100 }
  expect(positionTodayDollar(short, { price: 88, change_pct: 10 })).toBeCloseTo(-800, 5)
  // missing snapshot → null (never a fabricated number).
  expect(positionTodayDollar(long, null)).toBeNull()
  expect(positionTodayDollar(long, { price: 88 })).toBeNull()
})

test('empty state (no broker) is a connect call-to-action (no fake data)', () => {
  h.positions = { positions: [] }
  h.options = { strategies: [] }
  h.broker = { connected: false }
  renderWithProviders(<JournalSnapshotTile />)
  expect(screen.getByText(/see your whole portfolio, live/i)).toBeInTheDocument()
  // UCT Intelligence brand — eyebrow + locked tagline.
  expect(screen.getByText('UCT Intelligence')).toBeInTheDocument()
  expect(screen.getByText(/navigate the market, effectively/i)).toBeInTheDocument()
  // Connect CTA → Settings; secondary "log trades manually" → journal.
  const connect = screen.getByRole('link', { name: /connect your brokerage/i })
  expect(connect).toHaveAttribute('href', '/settings')
  const manual = screen.getByRole('link', { name: /log trades manually/i })
  expect(manual).toHaveAttribute('href', '/journal?j2tab=positions')
  // No fake portfolio numbers in the CTA.
  expect(screen.queryByText('$14,632.18')).toBeNull()
})

test('empty state (broker connected) shows the synced/flat message', () => {
  h.positions = { positions: [] }
  h.options = { strategies: [] }
  h.broker = { connected: true, accounts: [] }
  renderWithProviders(<JournalSnapshotTile />)
  expect(screen.getByText(/all synced/i)).toBeInTheDocument()
  // No "connect a brokerage" CTA for an already-connected user.
  expect(screen.queryByText(/connect a brokerage/i)).toBeNull()
  expect(screen.getByRole('link', { name: /open the journal/i }))
    .toHaveAttribute('href', '/journal?j2tab=positions')
})

test('renders portfolio value + Today + Open P&L from open positions', () => {
  h.positions = {
    positions: [
      { id: 'p1', symbol: 'NVDA', side: 'Long', shares: 100, entryPrice: 80, stopPrice: 70 },
    ],
  }
  h.options = { strategies: [] }
  h.prices = { NVDA: { price: 88, change_pct: 10 } }

  renderWithProviders(<JournalSnapshotTile />)

  // Hero value = 88 × 100 = $8,800.00
  expect(screen.getByText('$8,800.00')).toBeInTheDocument()
  expect(screen.getByText('NVDA')).toBeInTheDocument()
  // Today and Open P&L both = +$800.00 (appear in hero + row).
  expect(screen.getAllByText(/\+\$800\.00/).length).toBeGreaterThan(0)
  expect(screen.getByText('1 position')).toBeInTheDocument()
})

test('broker account: hero uses real net-liq balance, never $0.00 when live feed is empty', () => {
  // A broker-synced account with positions but NO live prices (after-hours):
  // the old live-recompute collapsed to $0.00 — the broker net-liq must win.
  h.positions = {
    positions: [
      { id: 'p1', symbol: 'SPY', side: 'Long', shares: 1.0165, entryPrice: 740, stopPrice: 700 },
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
  h.prices = {} // live feed empty

  renderWithProviders(<JournalSnapshotTile />)

  expect(screen.getByText('$14,632.18')).toBeInTheDocument()
  expect(screen.queryByText('$0.00')).toBeNull()
  // Today = 14632.18 − 14511.68 = +$120.50 (last two real snapshots).
  expect(screen.getAllByText(/\+\$120\.50/).length).toBeGreaterThan(0)
  expect(screen.getByText(/synced/)).toBeInTheDocument()
})

test('broker account with no equity basis yet shows the placeholder, never $0.00', () => {
  // Freshly-connected broker: perf has no equity-snapshot history yet
  // (endEquity null) and no account has synced a brokerTotalEquity yet
  // (pre-first-sync) — but BrokerHero still renders because perf.brokerCount
  // signals a connected broker. The old unguarded `reduce()` over an empty
  // brokerAccounts array yielded 0 (not null), which brokerLiveEquity treated
  // as a real basis (Number.isFinite(0) === true) and rendered $0.00.
  h.positions = {
    positions: [
      { id: 'p1', symbol: 'AAPL', side: 'Long', shares: 10, entryPrice: 100, stopPrice: 90 },
    ],
  }
  h.options = { strategies: [] }
  h.accounts = { accounts: [{ id: 'a1', balanceSource: 'broker', brokerTotalEquity: null }] }
  h.perf = { endEquity: null, brokerCount: 1, equitySeries: [] }
  h.prices = {}

  renderWithProviders(<JournalSnapshotTile />)

  expect(screen.getByText('AAPL')).toBeInTheDocument()
  expect(screen.queryByText('$0.00')).toBeNull()
  expect(screen.queryByText(/\$NaN/)).toBeNull()
  const hero = document.querySelector('[class*="heroValue"]')
  expect(hero).toHaveTextContent('—')
})

test('includes open option strategies with broker value', () => {
  h.positions = { positions: [] }
  h.options = {
    strategies: [
      {
        id: 's1',
        underlying: 'CRWV',
        strategyType: 'long_call',
        netEntry: 500,
        brokerCurrentValue: 650,
        legs: [
          { strike: 110, optionType: 'call', side: 'long', qty: 1, entryPrice: 5, expiration: '2026-12-19' },
        ],
      },
    ],
  }
  renderWithProviders(<JournalSnapshotTile />)
  expect(screen.getByText(/1 option/)).toBeInTheDocument()
  expect(screen.getByText('$650.00')).toBeInTheDocument()
})

test('broker headline = cash + live market value (Robinhood-accurate, beats stale broker total)', () => {
  // Broker reports a STALE total equity of 9999; the true live net-liq is
  // cash 2000 + SPY 10 @ live 100 = 3000. The headline must show the computed
  // $3,000, not the stale $9,999, and Today = 10×(100−95 prevClose) = +$50.
  h.positions = {
    positions: [
      { id: 'p1', symbol: 'SPY', side: 'Long', shares: 10, entryPrice: 80, stopPrice: 70, brokerPrice: 90, entryDate: '2020-01-01' },
    ],
  }
  h.options = { strategies: [] }
  h.accounts = { accounts: [{ id: 'a1', balanceSource: 'broker', brokerTotalEquity: 9999, brokerCash: 2000 }] }
  h.perf = { endEquity: 9999, brokerCount: 1, equitySeries: [] }
  h.prices = { SPY: { price: 100, prev_close: 95 } }

  renderWithProviders(<JournalSnapshotTile />)
  const hero = document.querySelector('[class*="heroValue"]')
  expect(hero).toHaveTextContent('$3,000.00')    // cash + live MV, NOT the stale $9,999
  expect(hero).toHaveTextContent('LIVE')
  expect(document.body).toHaveTextContent('+$50.00')  // Today = 10×(100−95)
})

test('broker headline counts option market value in the net-liq', () => {
  // cash 1000 + SPY 5 @ 100 = 500 + option brokerCurrentValue 300 = 1800.
  h.positions = {
    positions: [
      { id: 'p1', symbol: 'SPY', side: 'Long', shares: 5, entryPrice: 80, stopPrice: 70, brokerPrice: 100, entryDate: '2020-01-01' },
    ],
  }
  h.options = { strategies: [{ id: 's1', underlying: 'SPY', strategyType: 'long_call', netEntry: 200, brokerCurrentValue: 300, legs: [{ strike: 110, optionType: 'call', side: 'long', qty: 1, entryPrice: 2, expiration: '2026-12-19' }] }] }
  h.accounts = { accounts: [{ id: 'a1', balanceSource: 'broker', brokerTotalEquity: 5000, brokerCash: 1000 }] }
  h.perf = { endEquity: 5000, brokerCount: 1, equitySeries: [] }
  h.prices = { SPY: { price: 100, prev_close: 100 } }

  renderWithProviders(<JournalSnapshotTile />)
  const hero = document.querySelector('[class*="heroValue"]')
  expect(hero).toHaveTextContent('$1,800.00')    // 1000 + 500 + 300
})

test('populated tile links into the journal positions tab', () => {
  h.positions = {
    positions: [
      { id: 'p1', symbol: 'NVDA', side: 'Long', shares: 100, entryPrice: 80, stopPrice: 70 },
    ],
  }
  h.options = { strategies: [] }
  h.prices = { NVDA: { price: 88, change_pct: 10 } }
  renderWithProviders(<JournalSnapshotTile />)
  const link = screen.getByRole('link', { name: /open your trading journal/i })
  expect(link).toHaveAttribute('href', '/journal?j2tab=positions')
})
