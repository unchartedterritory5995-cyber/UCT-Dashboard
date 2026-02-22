import { render, screen } from '@testing-library/react'
import NewsFeed from './NewsFeed'

const mockData = [
  { headline: 'Fed holds rates steady', source: 'Reuters', url: 'http://reuters.com/1', time: '5m ago' },
  { headline: 'Tech earnings beat expectations', source: 'WSJ', url: 'http://wsj.com/1', time: '12m ago' },
]

test('renders news headlines', () => {
  render(<NewsFeed data={mockData} />)
  expect(screen.getByText('Fed holds rates steady')).toBeInTheDocument()
  expect(screen.getByText('Tech earnings beat expectations')).toBeInTheDocument()
})

test('renders sources', () => {
  render(<NewsFeed data={mockData} />)
  expect(screen.getByText('Reuters')).toBeInTheDocument()
})

test('renders loading when no data', () => {
  render(<NewsFeed data={null} />)
  expect(screen.getByText(/loading/i)).toBeInTheDocument()
})
