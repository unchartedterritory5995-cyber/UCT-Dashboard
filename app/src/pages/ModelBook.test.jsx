import { render, screen } from '@testing-library/react'
import { vi, beforeEach, test, expect } from 'vitest'

// Stub the heavy chart so the page renders in jsdom without canvas/SSE.
vi.mock('../components/StockChart', () => ({
  default: ({ sym }) => <div data-testid="stock-chart">chart:{sym}</div>,
}))

// Controllable auth role per test.
let mockRole = null
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: mockRole ? { role: mockRole } : null }),
}))

// SWR keyed by URL so years / stocks / detail each return their own shape.
vi.mock('swr', () => ({
  default: (key) => {
    if (key === '/api/modelbook/years') {
      return { data: { years: [2025] }, mutate: vi.fn() }
    }
    if (typeof key === 'string' && key.startsWith('/api/modelbook/stocks')) {
      return {
        data: { year: 2025, stocks: [
          { id: 1, year: 2025, symbol: 'NVDA', company: 'NVIDIA Corp', sort_order: 1, gain_pct: 171, setup_count: 1 },
        ] },
        mutate: vi.fn(),
      }
    }
    if (typeof key === 'string' && key.startsWith('/api/modelbook/stock/')) {
      return {
        data: {
          id: 1, year: 2025, symbol: 'NVDA', company: 'NVIDIA Corp', gain_pct: 171,
          thesis: 'AI leader', setups: [
            { id: 10, setup_type: 'VCP', label_date: '2025-03-14', grade: 'A+',
              entry_price: 120, stop_price: 110, target_price: 150, notes: 'textbook',
              marker_side: 'belowBar', marker_shape: 'arrowUp' },
          ],
        },
        mutate: vi.fn(),
      }
    }
    return { data: null, mutate: vi.fn() }
  },
}))

import ModelBook from './ModelBook'

beforeEach(() => { mockRole = null })

test('renders model book heading', () => {
  render(<ModelBook />)
  expect(screen.getByText(/model book/i)).toBeInTheDocument()
})

test('renders the year tab and a stock card', () => {
  render(<ModelBook />)
  expect(screen.getByRole('button', { name: '2025' })).toBeInTheDocument()
  // NVDA shows in the gallery card (and, once auto-selected, the detail header)
  expect(screen.getAllByText('NVDA').length).toBeGreaterThan(0)
})

test('hides admin add-stock button for non-admins', () => {
  render(<ModelBook />)
  expect(screen.queryByRole('button', { name: /add stock/i })).toBeNull()
})

test('shows admin add-stock button for admins', () => {
  mockRole = 'admin'
  render(<ModelBook />)
  expect(screen.getByRole('button', { name: /add stock/i })).toBeInTheDocument()
})

test('auto-selects the first stock and renders its chart + labeled setup', () => {
  render(<ModelBook />)
  // No click needed — the top stock is shown automatically.
  expect(screen.getByTestId('stock-chart')).toHaveTextContent('chart:NVDA')
  // Setup shows compactly in the right panel as name + month (label_date 2025-03-14 → Mar).
  expect(screen.getByText('VCP')).toBeInTheDocument()
  expect(screen.getByText('Mar')).toBeInTheDocument()
})
