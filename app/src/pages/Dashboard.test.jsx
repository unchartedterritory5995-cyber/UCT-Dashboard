import { renderWithProviders } from '../test-utils'
import { vi } from 'vitest'
import Dashboard from './Dashboard'

// Mock SWR to avoid fetch errors in tests
vi.mock('swr', () => ({
  default: () => ({ data: null, error: null }),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

test('renders dashboard page without crashing', () => {
  renderWithProviders(<Dashboard />)
  expect(document.body).toBeTruthy()
})
