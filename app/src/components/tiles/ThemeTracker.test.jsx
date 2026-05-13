import { renderWithProviders, screen } from '../../test-utils'
import { vi } from 'vitest'

vi.mock('swr', () => ({
  default: vi.fn(() => ({ data: undefined })),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

import ThemeTracker from './ThemeTracker'

// ThemeTracker now expects `{ themes: [...] }` (taxonomy redesign, 2026-04-14).
// Each theme has `holdings: [{sym, returns}]` and an optional `group_return`.
// The component builds leaders/laggards internally based on the selected
// period's return value.
const mockData = {
  themes: [
    {
      name: 'Silver Miners', ticker: 'SIL', etf_name: 'Global X Silver Miners ETF',
      holdings: [{ sym: 'CDE', returns: { '1d': 11.47 } }],
      group_return: { '1d': 11.47 },
    },
    {
      name: 'Bitcoin Miners', ticker: 'WGMI', etf_name: 'Valkyrie Bitcoin Miners ETF',
      holdings: [{ sym: 'MARA', returns: { '1d': -3.13 } }],
      group_return: { '1d': -3.13 },
    },
  ],
}

test('renders leader and laggard theme names', () => {
  renderWithProviders(<ThemeTracker data={mockData} />)
  expect(screen.getByText('Silver Miners')).toBeInTheDocument()
  expect(screen.getByText('Bitcoin Miners')).toBeInTheDocument()
})

test('renders skeleton (no crash) when no data', () => {
  // Loading state renders SkeletonTileContent (no literal "loading" text).
  const { container } = renderWithProviders(<ThemeTracker data={null} />)
  expect(container).toBeTruthy()
})
