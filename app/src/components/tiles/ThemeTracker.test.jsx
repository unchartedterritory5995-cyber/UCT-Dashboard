import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ThemeTracker from './ThemeTracker'

const mockData = {
  leaders: [
    { name: 'Silver Miners', pct: '+11.47%', bar: 85 },
    { name: 'Junior Gold Miners', pct: '+9.82%', bar: 73 },
  ],
  laggards: [
    { name: 'Bitcoin Miners', pct: '-3.13%', bar: 25 },
    { name: 'Cannabis', pct: '-2.33%', bar: 20 },
  ],
  period: '1W'
}

test('renders leaders and laggards', () => {
  render(<ThemeTracker data={mockData} />)
  expect(screen.getByText('Silver Miners')).toBeInTheDocument()
  expect(screen.getByText('Bitcoin Miners')).toBeInTheDocument()
  expect(screen.getByText('+11.47%')).toBeInTheDocument()
  expect(screen.getByText('-3.13%')).toBeInTheDocument()
})

test('renders period tab buttons', () => {
  render(<ThemeTracker data={mockData} />)
  expect(screen.getByRole('button', { name: '1W' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '1M' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '3M' })).toBeInTheDocument()
})

test('renders loading when no data', () => {
  render(<ThemeTracker data={null} />)
  expect(screen.getByText(/loading/i)).toBeInTheDocument()
})
