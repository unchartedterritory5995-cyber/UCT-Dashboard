import { render, screen } from '@testing-library/react'
import EpisodicPivots from './EpisodicPivots'

const mockData = [
  { rank: 1, sym: 'NVDA', score: 95, price: '875.00', chg: '+2.77%', css: 'pos' },
  { rank: 2, sym: 'PLTR', score: 88, price: '24.50',  chg: '+1.19%', css: 'pos' },
]

test('renders stock symbols', () => {
  render(<EpisodicPivots data={mockData} />)
  expect(screen.getByText('NVDA')).toBeInTheDocument()
  expect(screen.getByText('PLTR')).toBeInTheDocument()
})

test('renders loading when no data', () => {
  render(<EpisodicPivots data={null} />)
  expect(screen.getByText(/loading/i)).toBeInTheDocument()
})
