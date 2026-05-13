import { renderWithProviders, screen } from '../../test-utils'
import MarketBreadth from './MarketBreadth'

// The Dashboard tile was redesigned (2026-02-23+) as the "UCT Exposure Rating"
// tile. It renders an exposure score from `data.exposure.score`, optional
// market phase, an optional note, and the MARelationship subpanel.
// Old assertions for distribution_days / advancing / declining / MA percentages
// no longer apply — those metrics live on the Breadth page, not this tile.

const mockData = {
  exposure: { score: 78, score_delta: 5, note: 'Healthy uptrend conditions', bonus: 0 },
  market_phase: 'Confirmed Uptrend',
  ma_data: null,
}

test('renders UCT Exposure Rating title', () => {
  renderWithProviders(<MarketBreadth data={mockData} />)
  // "UCT Exposure Rating" appears in both the TileCard title and the
  // ExposureBar label. Both are correct — use getAllByText.
  expect(screen.getAllByText(/uct exposure rating/i).length).toBeGreaterThan(0)
})

test('renders exposure score', () => {
  renderWithProviders(<MarketBreadth data={mockData} />)
  expect(screen.getByText('78')).toBeInTheDocument()
})

test('renders market phase label', () => {
  renderWithProviders(<MarketBreadth data={mockData} />)
  expect(screen.getByText('Confirmed Uptrend')).toBeInTheDocument()
})

test('renders skeleton (no crash) when no data', () => {
  // Loading state renders SkeletonTileContent, no literal "loading" text.
  // Just confirm component renders without throwing.
  const { container } = renderWithProviders(<MarketBreadth data={null} />)
  expect(container).toBeTruthy()
})
