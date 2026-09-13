import { renderWithProviders, screen } from '../../test-utils'
import { vi } from 'vitest'

// The tile fetches via useMobileSWR; mock it so we control the rendered data.
let mockReturn = { data: undefined, error: undefined, mutate: vi.fn() }
vi.mock('../../hooks/useMobileSWR', () => ({
  default: () => mockReturn,
}))

import OptionsFlowPreview from './OptionsFlowPreview'

const mockData = {
  date: '6/15/2026',
  count: 2,
  items: [
    {
      rank: 1, sym: 'SNDK', dir: 'BULL', netPremium: 34000000, bullPct: 75, er: false,
      topContract: { cp: 'C', strike: 2100, exp: '7/17', hits: 2, premium: 16700000, moneyness: 'ITM', otmPct: 0 },
    },
    {
      rank: 2, sym: 'MRVL', dir: 'BULL', netPremium: 19800000, bullPct: 75, er: false,
      topContract: { cp: 'C', strike: 350, exp: '7/2', hits: 21, premium: 6800000, moneyness: 'OTM', otmPct: 13 },
    },
  ],
}

test('renders ranked conviction cards with premium + contract', () => {
  mockReturn = { data: mockData, error: undefined, mutate: vi.fn() }
  renderWithProviders(<OptionsFlowPreview />)
  expect(screen.getByText('SNDK')).toBeInTheDocument()
  expect(screen.getByText('MRVL')).toBeInTheDocument()
  expect(screen.getByText('$34.0M')).toBeInTheDocument()
  // OTM contract shows its distance from spot.
  expect(screen.getByText('OTM +13%')).toBeInTheDocument()
})

test('cards link through to the full options flow page', () => {
  mockReturn = { data: mockData, error: undefined, mutate: vi.fn() }
  renderWithProviders(<OptionsFlowPreview />)
  const links = screen.getAllByRole('link').filter(a => a.getAttribute('href') === '/options-flow')
  expect(links.length).toBeGreaterThan(0)
})

test('renders without crashing while loading', () => {
  mockReturn = { data: undefined, error: undefined, mutate: vi.fn() }
  const { container } = renderWithProviders(<OptionsFlowPreview />)
  expect(container).toBeTruthy()
})
