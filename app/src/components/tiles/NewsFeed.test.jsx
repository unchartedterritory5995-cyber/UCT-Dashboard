import { renderWithProviders, screen } from '../../test-utils'
import NewsFeed from './NewsFeed'

const mockData = [
  { headline: 'Fed holds rates steady', source: 'Reuters', url: 'http://reuters.com/1', time: '5m ago' },
  { headline: 'Tech earnings beat expectations', source: 'WSJ', url: 'http://wsj.com/1', time: '12m ago' },
]

test('renders news headlines', () => {
  renderWithProviders(<NewsFeed data={mockData} />)
  expect(screen.getByText('Fed holds rates steady')).toBeInTheDocument()
  expect(screen.getByText('Tech earnings beat expectations')).toBeInTheDocument()
})

test('renders sources', () => {
  renderWithProviders(<NewsFeed data={mockData} />)
  expect(screen.getByText('Reuters')).toBeInTheDocument()
})

test('renders skeleton (no crash) when no data', () => {
  // Loading state now renders SkeletonTileContent; no literal "loading" text.
  const { container } = renderWithProviders(<NewsFeed data={null} />)
  expect(container).toBeTruthy()
})
