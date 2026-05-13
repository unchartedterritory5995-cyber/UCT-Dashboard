import { renderWithProviders, screen } from '../test-utils'
import { vi } from 'vitest'

vi.mock('swr', () => ({
  default: vi.fn(() => ({
    data: [
      { ticker: 'NVDA', rs_score: 95.5, vol_ratio: 2.3, momentum: 88.1, cap_tier: 'LARGE' },
      { ticker: 'META', rs_score: 92.0, vol_ratio: 1.8, momentum: 85.0, cap_tier: 'LARGE' }
    ],
    mutate: vi.fn()
  })),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

import Screener from './Screener'

test('renders scanner hub heading', () => {
  // Page was rebuilt as a 3-tab Scanner Hub; old "Screener" heading is gone.
  renderWithProviders(<Screener />)
  expect(screen.getByRole('heading', { name: /scanner hub/i })).toBeInTheDocument()
})
