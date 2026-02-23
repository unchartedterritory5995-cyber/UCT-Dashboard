import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

vi.mock('swr', () => ({
  default: vi.fn(() => ({ data: undefined }))
}))

import ThemeTracker from './ThemeTracker'

const mockData = {
  leaders: [
    {
      name: 'Silver Miners', ticker: 'SIL', etf_name: 'Global X Silver Miners ETF',
      pct: '+11.47%', bar: 85, holdings: ['CDE', 'HL', 'BVN'], intl_count: 6,
    },
    {
      name: 'Junior Gold Miners', ticker: 'GDXJ', etf_name: 'VanEck Junior Gold Miners ETF',
      pct: '+9.82%', bar: 73, holdings: ['GDX', 'EGO', 'HL'], intl_count: 7,
    },
  ],
  laggards: [
    {
      name: 'Bitcoin Miners', ticker: 'WGMI', etf_name: 'Valkyrie Bitcoin Miners ETF',
      pct: '-3.13%', bar: 25, holdings: ['MARA', 'RIOT'], intl_count: 0,
    },
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

test('clicking theme row expands to show stock chips', async () => {
  const user = userEvent.setup()
  render(<ThemeTracker data={mockData} />)
  await user.click(screen.getByText('Silver Miners'))
  expect(screen.getByText('CDE')).toBeInTheDocument()
  expect(screen.getByText('HL')).toBeInTheDocument()
  expect(screen.getByText('BVN')).toBeInTheDocument()
})

test('shows intl badge when intl_count > 0', async () => {
  const user = userEvent.setup()
  render(<ThemeTracker data={mockData} />)
  await user.click(screen.getByText('Silver Miners'))
  expect(screen.getByText(/\+6 intl/)).toBeInTheDocument()
})

test('no intl badge when intl_count is 0', async () => {
  const user = userEvent.setup()
  render(<ThemeTracker data={mockData} />)
  await user.click(screen.getByText('Bitcoin Miners'))
  expect(screen.queryByText(/intl/)).not.toBeInTheDocument()
})
