import { renderWithProviders, screen } from '../../test-utils'
import EpisodicPivots from './EpisodicPivots'

const mockData = [
  { rank: 1, sym: 'NVDA', score: 95, price: '875.00', chg: '+2.77%', css: 'pos' },
  { rank: 2, sym: 'PLTR', score: 88, price: '24.50',  chg: '+1.19%', css: 'pos' },
]

test('renders stock symbols', () => {
  renderWithProviders(<EpisodicPivots data={mockData} />)
  expect(screen.getByText('NVDA')).toBeInTheDocument()
  expect(screen.getByText('PLTR')).toBeInTheDocument()
})

test('renders skeleton (no crash) when no data', () => {
  // Loading state now renders SkeletonTileContent; no literal "loading" text.
  const { container } = renderWithProviders(<EpisodicPivots data={null} />)
  expect(container).toBeTruthy()
})
