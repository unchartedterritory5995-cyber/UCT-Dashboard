import { renderWithProviders, screen } from '../../test-utils'
import TapeFeed from './TapeFeed'

const mockTweets = [
  {
    id: '1',
    author_handle: 'DeItaone',
    author_name: 'Walter Bloomberg',
    text: '$NVDA raises guidance, shares up 6% after hours',
    url: 'https://x.com/DeItaone/status/1',
    created_at: new Date().toISOString(),
    is_retweet: false,
  },
  {
    id: '2',
    author_handle: 'Benzinga',
    author_name: 'Benzinga',
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

// PACKET-S CP3 (RG-21 §1c) — X's display requirements need author name/@handle
// rendered; this used to be the deliberate-omission control ("does NOT render
// the author handle"). That is now the wrong behavior on purpose: X's terms
// require exactly what this asserts.
test('renders the author display name AND @handle — X display requirement', () => {
  renderWithProviders(<TapeFeed data={mockTweets} />)
  expect(screen.getByText('Walter Bloomberg')).toBeInTheDocument()
  expect(screen.getByText('@DeItaone')).toBeInTheDocument()
  expect(screen.getAllByText('Benzinga').length).toBeGreaterThan(0)
  expect(screen.getByText('@Benzinga')).toBeInTheDocument()
})

test('falls back gracefully when a tweet carries no author fields', () => {
  const noAuthor = [{ ...mockTweets[0], author_handle: '', author_name: null }]
  const { container } = renderWithProviders(<TapeFeed data={noAuthor} />)
  // Control: proves the byline block is CONDITIONAL, not a crash-on-missing-field —
  // an unconditional render would throw or print "undefined"/"@" with nothing after it.
  expect(container.textContent).not.toMatch(/undefined/)
  expect(screen.queryByText(/^@$/)).not.toBeInTheDocument()
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

// PACKET-S CP3 — X's brand mark must appear alongside the permalink icon,
// via the UIcon registry (never a raw inline SVG or emoji).
test('renders the X wordmark glyph next to the permalink', () => {
  const { container } = renderWithProviders(<TapeFeed data={mockTweets} />)
  const marks = container.querySelectorAll('[class*="xMark"]')
  // One X wordmark per rendered tweet item, each an <svg> (the UIcon registry
  // shape) rather than an emoji character or a one-off inline SVG.
  expect(marks.length).toBe(mockTweets.length)
  marks.forEach((m) => expect(m.tagName.toLowerCase()).toBe('svg'))
  const permalinks = screen.getAllByTitle('open on X')
  expect(permalinks.length).toBe(mockTweets.length)
})
