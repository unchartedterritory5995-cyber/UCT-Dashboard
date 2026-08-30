import { renderWithProviders, screen } from '../test-utils'
import { vi } from 'vitest'

vi.mock('swr', () => ({
  default: vi.fn(() => ({
    data: [
      { sym: 'NVDA', rs_score: 95.5, cap_tier: 'LARGE', thesis: 'AI infrastructure leader, base breakout' },
      { sym: 'META', rs_score: 91.0, cap_tier: 'LARGE', thesis: 'Ad revenue acceleration, Stage 2 uptrend' },
    ],
    mutate: vi.fn()
  })),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

import useSWR from 'swr'
import UCT20 from './UCT20'

test('renders UCT 20 heading', () => {
  renderWithProviders(<UCT20 />)
  expect(screen.getByRole('heading', { name: /uct 20/i })).toBeInTheDocument()
})

// Keep this after the heading test — it replaces the module-level mock's
// implementation for the rest of the file.
test('held banner shows the list\'s verified date, not the push date', () => {
  useSWR.mockImplementation((key) => ({
    data: key === '/api/leadership'
      ? {
          stocks: [{ sym: 'NVDA', rs_score: 95.5, thesis: 'AI leader' }],
          status: 'held',
          last_updated: '2026-08-03',
          meta: { held_since: '2026-07-31' },
        }
      : undefined,
    mutate: vi.fn(),
  }))
  renderWithProviders(<UCT20 />)
  expect(screen.getByText(/didn.t pass its quality checks/i)).toBeInTheDocument()
  expect(screen.getByText(/verified 2026-07-31/)).toBeInTheDocument()
  expect(screen.queryByText(/verified 2026-08-03/)).not.toBeInTheDocument()
})

// The performance/backtest tile sits BELOW the list (owner call, twice asked
// for). Order is invisible to every other assertion here, so rail it directly:
// compare the two tiles' document positions rather than trusting render order.
test('the performance tile renders below the stock list', () => {
  useSWR.mockImplementation((key) => ({
    data: key === '/api/leadership'
      ? { stocks: [{ sym: 'NVDA', rs_score: 95.5, thesis: 'AI leader' }], status: 'ok', last_updated: '2026-08-29' }
      : undefined,
    mutate: vi.fn(),
  }))
  renderWithProviders(<UCT20 />)
  const list = screen.getByRole('region', { name: /current top stocks/i })
  const perf = screen.getByRole('region', { name: /^uct 20 performance$/i })
  // DOCUMENT_POSITION_FOLLOWING (4) = perf comes after list in the document.
  expect(list.compareDocumentPosition(perf) & 4).toBe(4)
})
