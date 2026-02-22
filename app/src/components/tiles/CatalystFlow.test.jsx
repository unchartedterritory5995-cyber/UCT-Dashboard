import { render, screen } from '@testing-library/react'
import CatalystFlow from './CatalystFlow'

const mockData = {
  bmo: [
    { sym: 'CRH', expected_eps: 0.85, reported_eps: 0.47, surprise_pct: '+1.43%', verdict: 'Beat' },
    { sym: 'AMH', expected_eps: 0.18, reported_eps: 0.66, surprise_pct: '+0.65%', verdict: 'Beat' },
  ],
  amc: []
}

test('renders earnings table', () => {
  render(<CatalystFlow data={mockData} />)
  expect(screen.getByText('CRH')).toBeInTheDocument()
  expect(screen.getByText('+1.43%')).toBeInTheDocument()
  expect(screen.getAllByText('Beat').length).toBeGreaterThan(0)
})

test('renders loading when no data', () => {
  render(<CatalystFlow data={null} />)
  expect(screen.getByText(/loading/i)).toBeInTheDocument()
})
