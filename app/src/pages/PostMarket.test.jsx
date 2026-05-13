import { renderWithProviders, screen } from '../test-utils'
import { vi } from 'vitest'

vi.mock('swr', () => ({
  default: vi.fn(() => ({ data: null })),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

import PostMarket from './PostMarket'

// Page was renamed/rebuilt — heading is now "Extended Hours Movers", and the
// empty-state copy is now "No movers" rather than "Check back after the
// session ends".

test('renders extended hours movers heading', () => {
  renderWithProviders(<PostMarket />)
  expect(screen.getByRole('heading', { name: /extended hours movers/i })).toBeInTheDocument()
})

test('renders empty-state copy when no data', () => {
  renderWithProviders(<PostMarket />)
  expect(screen.getAllByText(/no movers/i).length).toBeGreaterThan(0)
})
