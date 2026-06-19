import { renderWithProviders, screen } from '../../test-utils'
import TapeFeed from './TapeFeed'

const mockTweets = [
  {
    id: '1',
    author_handle: 'DeItaone',
    text: '$NVDA raises guidance, shares up 6% after hours',
    url: 'https://x.com/DeItaone/status/1',
    created_at: new Date().toISOString(),
    is_retweet: false,
  },
  {
    id: '2',
    author_handle: 'Benzinga',
    text: 'Fed minutes signal hawkish tone on inflation',
    url: 'https://x.com/Benzinga/status/2',
    created_at: new Date().toISOString(),
    is_retweet: false,
  },
]

test('renders tweet content', () => {
  renderWithProviders(<TapeFeed data={mockTweets} />)
  expect(screen.getByText(/raises guidance/)).toBeInTheDocument()
  expect(screen.getByText(/hawkish tone on inflation/)).toBeInTheDocument()
})

test('does NOT render the author handle — content only', () => {
  renderWithProviders(<TapeFeed data={mockTweets} />)
  expect(screen.queryByText(/@DeItaone/)).not.toBeInTheDocument()
  expect(screen.queryByText(/@Benzinga/)).not.toBeInTheDocument()
})

test('highlights cashtags', () => {
  renderWithProviders(<TapeFeed data={mockTweets} />)
  expect(screen.getByText('$NVDA')).toBeInTheDocument()
})

test('renders empty state', () => {
  renderWithProviders(<TapeFeed data={[]} />)
  expect(screen.getByText(/Nothing on the tape yet/)).toBeInTheDocument()
})

test('renders skeleton (no crash) when no data', () => {
  const { container } = renderWithProviders(<TapeFeed data={null} />)
  expect(container).toBeTruthy()
})
