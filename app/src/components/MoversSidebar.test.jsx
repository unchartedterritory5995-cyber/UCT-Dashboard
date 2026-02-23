import { render, screen } from '@testing-library/react'
import MoversSidebar from './MoversSidebar'

const mockData = {
  ripping: [
    { sym: 'RNG', pct: '+34.40%' },
    { sym: 'TNDM', pct: '+32.67%' },
  ],
  drilling: [
    { sym: 'GRND', pct: '-50.55%' },
    { sym: 'CCOI', pct: '-29.36%' },
  ]
}

test('renders ripping and drilling sections with data', () => {
  render(<MoversSidebar data={mockData} />)
  expect(screen.getByText('MOVERS AT THE OPEN')).toBeInTheDocument()
  expect(screen.getByText(/ripping/i)).toBeInTheDocument()
  expect(screen.getByText(/drilling/i)).toBeInTheDocument()
  expect(screen.getByText('RNG')).toBeInTheDocument()
  expect(screen.getByText('+34.40%')).toBeInTheDocument()
  expect(screen.getByText('GRND')).toBeInTheDocument()
  expect(screen.getByText('-50.55%')).toBeInTheDocument()
})

test('renders loading state when no data', () => {
  render(<MoversSidebar data={null} />)
  expect(screen.getByText(/loading/i)).toBeInTheDocument()
})

test('each ticker sym is wrapped in a TickerPopup trigger', () => {
  const mockData = {
    ripping:  [{ sym: 'NVDA', pct: '+5.20%' }, { sym: 'TSLA', pct: '+3.10%' }],
    drilling: [{ sym: 'META', pct: '-4.10%' }],
  }
  render(<MoversSidebar data={mockData} />)
  // TickerPopup renders data-testid="ticker-{sym}" on each trigger span
  expect(screen.getByTestId('ticker-NVDA')).toBeInTheDocument()
  expect(screen.getByTestId('ticker-TSLA')).toBeInTheDocument()
  expect(screen.getByTestId('ticker-META')).toBeInTheDocument()
})
