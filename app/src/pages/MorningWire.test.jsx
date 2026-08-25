import { renderWithProviders, screen } from '../test-utils'
import { vi } from 'vitest'

vi.mock('swr', () => ({
  default: vi.fn((key) => {
    if (key === '/api/rundown') return { data: { html: '<p data-testid="rundown-content">Test rundown</p>' } }
    if (key === '/api/breadth') return { data: { pct_above_50ma: 62.4, pct_above_200ma: 55.1, distribution_days: 3, market_phase: 'Confirmed Uptrend' } }
    if (key === '/api/earnings') return { data: { bmo: [{ sym: 'AAPL', eps_est: 2.50, eps_act: 2.60, surprise_pct: 4.0 }], amc: [] } }
    if (key === '/api/leadership') return { data: [{ sym: 'NVDA', thesis: 'AI infrastructure leader' }] }
    return { data: null }
  }),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

import MorningWire from './MorningWire'

test('renders morning wire heading', () => {
  renderWithProviders(<MorningWire />)
  // The page now shows the standard PageHeader title AND the slim masthead
  // nameplate, so "Morning Wire" appears more than once — assert at least one.
  expect(screen.getAllByText(/morning wire/i).length).toBeGreaterThan(0)
})

test('renders rundown HTML content', () => {
  renderWithProviders(<MorningWire />)
  expect(screen.getByTestId('rundown-content')).toBeInTheDocument()
})
