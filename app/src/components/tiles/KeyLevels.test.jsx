import { renderWithProviders, screen } from '../../test-utils'
import KeyLevels from './KeyLevels'

// KeyLevels has been deferred — currently renders a "Coming Soon" placeholder.
// Old assertions for ticker label / chart embed don't apply.

test('renders Key Levels title', () => {
  renderWithProviders(<KeyLevels />)
  expect(screen.getByText(/key levels/i)).toBeInTheDocument()
})

test('renders Coming Soon placeholder', () => {
  renderWithProviders(<KeyLevels />)
  expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
})
