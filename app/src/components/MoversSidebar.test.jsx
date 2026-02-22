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
