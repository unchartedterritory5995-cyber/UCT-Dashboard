import { renderWithProviders, screen } from '../../test-utils'
import { vi } from 'vitest'
import { positionTodayDollar } from './JournalSnapshotTile'

// Shared mutable state the mocks read from. vi.hoisted so it exists before the
// vi.mock factories run.
const h = vi.hoisted(() => ({ positions: null, options: null, prices: {} }))

// useSWR is keyed by URL — return positions vs options responses accordingly.
vi.mock('swr', () => ({
  default: (key) => {
    const k = String(key)
    if (k.includes('/positions')) return { data: h.positions, isLoading: false }
    if (k.includes('/options')) return { data: h.options, isLoading: false }
    return { data: undefined, isLoading: false, mutate: () => {} }
  },
  useSWRConfig: () => ({ mutate: () => {} }),
}))

vi.mock('../../hooks/useLivePrices', () => ({
  default: () => ({ prices: h.prices, isLoading: false, error: null, refresh: () => {} }),
}))

import JournalSnapshotTile from './JournalSnapshotTile'

beforeEach(() => {
  h.positions = null
  h.options = null
  h.prices = {}
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

test('empty state nudges to open the journal', () => {
  h.positions = { positions: [] }
  h.options = { strategies: [] }
  renderWithProviders(<JournalSnapshotTile />)
  expect(screen.getByText('No open positions yet')).toBeInTheDocument()
  expect(screen.getByText(/open your journal/i)).toBeInTheDocument()
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

test('includes open option strategies with broker value', () => {
  h.positions = { positions: [] }
  h.options = {
    strategies: [
      {
        id: 's1',
        underlying: 'CRWV',
        strategyType: 'long_call',
        netEntry: 500,
        broker_current_value: 650,
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

test('whole tile links into the journal positions tab', () => {
  h.positions = { positions: [] }
  h.options = { strategies: [] }
  renderWithProviders(<JournalSnapshotTile />)
  const link = screen.getByRole('link', { name: /open your trading journal/i })
  expect(link).toHaveAttribute('href', '/journal?j2tab=positions')
})
