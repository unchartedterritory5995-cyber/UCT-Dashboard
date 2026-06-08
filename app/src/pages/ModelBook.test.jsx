import { render, screen, fireEvent } from '@testing-library/react'
import { vi, beforeEach, test, expect } from 'vitest'

// Stub the heavy chart so the page renders in jsdom without canvas/SSE.
vi.mock('../components/StockChart', () => ({
  default: ({ sym }) => <div data-testid="stock-chart">chart:{sym}</div>,
}))

// ModelBook lands on the 'hub' intro screen unless location.state preselects a
// view. The page is rendered without a Router here, so stub useLocation; the
// per-test mockMbView controls which view it opens on (defaults to the library
// so the existing library/detail tests render straight to it).
let mockMbView = null
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ key: 'test', state: mockMbView ? { mbView: mockMbView } : null }),
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
          catalysts: [
            { id: 20, catalyst_date: '2025-09-04', title: 'Q3 earnings beat',
              description: 'Crushed estimates on AI demand.', move_pct: 18.5,
              source: 'ai', sort_order: 0 },
          ],
        },
        mutate: vi.fn(),
      }
    }
    if (typeof key === 'string' && key.startsWith('/api/modelbook/year-earnings')) {
      return {
        data: { symbol: 'NVDA', year: 2025, rows: [
          { date: '2025-05-28', quarter: 2, year: 2025, eps_actual: 0.96, eps_estimate: 0.71,
            eps_surprise_pct: 35.2, revenue_actual: 44060000000, revenue_estimate: 43310000000,
            revenue_surprise_pct: 1.7 },
        ] },
        mutate: vi.fn(),
      }
    }
    return { data: null, mutate: vi.fn() }
  },
  preload: vi.fn(),
}))

import ModelBook from './ModelBook'

// Reset role + persisted panel/toggle prefs so tests don't bleed into each
// other. Default to the 'years' library view so the library/detail tests below
// render straight to it (the hub test opts out by setting mockMbView = null).
beforeEach(() => {
  mockRole = null
  mockMbView = 'years'
  try { localStorage.clear() } catch { /* ignore */ }
})

test('renders the library view with a Model Book back control', () => {
  render(<ModelBook />)
  // The big heading was dropped from the library view; the "‹ Model Book"
  // back button is the remaining Model Book affordance here.
  expect(screen.getByRole('button', { name: /model book/i })).toBeInTheDocument()
})

test('lands on the hub with section options; Throughout the Years opens the library', () => {
  mockMbView = null  // open on the intro/hub screen instead of the library
  render(<ModelBook />)
  // All the section options are present, and the unbuilt ones say "Coming soon".
  expect(screen.getByRole('button', { name: /throughout the years/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /corrections/i })).toBeInTheDocument()
  expect(screen.getAllByText(/coming soon/i).length).toBeGreaterThan(0)
  // The yearly library is NOT shown until a choice is made.
  expect(screen.queryByRole('button', { name: '2025' })).toBeNull()
  // Click Throughout the Years → the yearly library renders.
  fireEvent.click(screen.getByRole('button', { name: /throughout the years/i }))
  expect(screen.getByRole('button', { name: '2025' })).toBeInTheDocument()
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
  // Setup shows compactly in the right panel as name + date (label_date 2025-03-14 → March 14th).
  expect(screen.getByText('VCP')).toBeInTheDocument()
  expect(screen.getByText('March 14th')).toBeInTheDocument()
})

test('switches to the Catalysts tab and shows a catalyst', () => {
  render(<ModelBook />)
  // Setups tab is the default — the setup is visible, the catalyst is not.
  expect(screen.getByText('VCP')).toBeInTheDocument()
  expect(screen.queryByText('Q3 earnings beat')).toBeNull()
  // Flip to Catalysts → its row (title + move% + date) renders.
  fireEvent.click(screen.getByRole('button', { name: /catalysts/i }))
  expect(screen.getByText('Q3 earnings beat')).toBeInTheDocument()
  expect(screen.getByText('+19%')).toBeInTheDocument()  // 18.5 rounds to 19
  expect(screen.getByText('September 4th')).toBeInTheDocument()
})

test('catalyst details are collapsed until the row is clicked', () => {
  render(<ModelBook />)
  fireEvent.click(screen.getByRole('button', { name: /catalysts/i }))
  // Headline shows; the description is hidden until expanded.
  expect(screen.getByText('Q3 earnings beat')).toBeInTheDocument()
  expect(screen.queryByText('Crushed estimates on AI demand.')).toBeNull()
  // Click the headline → details drop down.
  fireEvent.click(screen.getByText('Q3 earnings beat'))
  expect(screen.getByText('Crushed estimates on AI demand.')).toBeInTheDocument()
})

test('renders the permanent earnings overlay table on the chart', () => {
  render(<ModelBook />)
  // No tab to click — the table is a permanent chart overlay for every stock.
  expect(screen.getByText('2025 Earnings')).toBeInTheDocument()
  expect(screen.getByText('Quarter')).toBeInTheDocument()
  expect(screen.getByText('Revenue')).toBeInTheDocument()
  expect(screen.getByText('Q2 2025')).toBeInTheDocument()    // fiscal quarter label
  expect(screen.getByText('0.96')).toBeInTheDocument()        // EPS actual
  expect(screen.getByText('+35%')).toBeInTheDocument()        // EPS surprise (35.2 → 35)
  expect(screen.getByText('44.06B')).toBeInTheDocument()      // revenue actual
})
