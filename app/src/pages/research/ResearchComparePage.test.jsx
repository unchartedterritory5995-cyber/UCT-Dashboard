import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, fireEvent } from '../../test-utils'
import ResearchComparePage from './ResearchComparePage'

const auth = { user: { role: 'user' }, isPaid: true }
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => auth,
  AuthProvider: ({ children }) => children,
}))

const mockNavigate = vi.fn()
let mockParams = { sym: 'AAPL', comparator: 'MSFT' }
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mockNavigate, useParams: () => mockParams }
})

let mockComparisonReturn = { data: null, isLoading: true }
vi.mock('./hooks/useComparison', () => ({
  default: () => mockComparisonReturn,
}))

function fullData(overrides = {}) {
  return {
    a: {
      sym: 'AAPL', entity: { status: 'resolved', entityId: 'e_aapl' },
      fundamentals: { sector: 'Technology', industry: 'Consumer Electronics', market_cap: '$3.0T', pe_trailing: 30.1 },
      estimates: [], ratings: { composite: 88, components: {}, price_as_of: '2026-09-04' },
      analyst: { consensus: { label: 'Buy' }, price_target: { consensus: 260 } },
    },
    b: {
      sym: 'MSFT', entity: { status: 'resolved', entityId: 'e_msft' },
      fundamentals: { sector: 'Technology', industry: 'Software', market_cap: '$3.1T', pe_trailing: 33.4 },
      estimates: [], ratings: { composite: 82, components: {}, price_as_of: '2026-09-04' },
      analyst: { consensus: { label: 'Buy' }, price_target: { consensus: 480 } },
    },
    estimates_aligned: [{ period: 'Next Yr', a: { eps_avg: 8.0 }, b: { eps_avg: 15.0 } }],
    fundamentals_period_note: 'Fundamentals shown as currently reported.',
    ...overrides,
  }
}

describe('ResearchComparePage', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    mockParams = { sym: 'AAPL', comparator: 'MSFT' }
    mockComparisonReturn = { data: null, isLoading: true }
    auth.isPaid = true
  })

  it('shows a loading state while the comparison is in flight', () => {
    renderWithProviders(<ResearchComparePage />, { route: '/research/AAPL/compare/MSFT' })
    expect(screen.getByText(/Loading comparison/i)).toBeInTheDocument()
  })

  it('renders both securities and their sections once loaded', () => {
    mockComparisonReturn = { data: fullData(), isLoading: false }
    renderWithProviders(<ResearchComparePage />, { route: '/research/AAPL/compare/MSFT' })
    expect(screen.getByTestId('research-compare-page')).toBeInTheDocument()
    expect(screen.getByText('Summary')).toBeInTheDocument()
    expect(screen.getByText('Fundamentals / Valuation')).toBeInTheDocument()
    expect(screen.getByText('Ratings')).toBeInTheDocument()
    // both composite ratings visible, kept as distinct rows, never merged
    // (rendered in both Summary and Ratings sections, hence getAllByText)
    expect(screen.getAllByText('88').length).toBeGreaterThan(0)
    expect(screen.getAllByText('82').length).toBeGreaterThan(0)
  })

  it('shows the estimates section only when aligned estimate rows exist', () => {
    mockComparisonReturn = { data: fullData({ estimates_aligned: [] }), isLoading: false }
    renderWithProviders(<ResearchComparePage />, { route: '/research/AAPL/compare/MSFT' })
    expect(screen.queryByText('Estimates')).not.toBeInTheDocument()
  })

  it('surfaces a request-level error honestly instead of rendering empty sections', () => {
    mockComparisonReturn = { data: { error: 'choose two different securities to compare' }, isLoading: false }
    renderWithProviders(<ResearchComparePage />, { route: '/research/AAPL/compare/AAPL' })
    expect(screen.getByText('choose two different securities to compare')).toBeInTheDocument()
    expect(screen.queryByText('Summary')).not.toBeInTheDocument()
  })

  it('surfaces an unresolved comparator honestly rather than a blank section', () => {
    mockComparisonReturn = {
      data: fullData({
        b: { sym: 'NOTATICKERXYZ', entity: { status: 'not_found' }, fundamentals: { error: 'no fundamentals available' }, estimates: [], ratings: {}, analyst: {} },
      }),
      isLoading: false,
    }
    mockParams = { sym: 'AAPL', comparator: 'NOTATICKERXYZ' }
    renderWithProviders(<ResearchComparePage />, { route: '/research/AAPL/compare/NOTATICKERXYZ' })
    expect(screen.getByText(/No data found for NOTATICKERXYZ/i)).toBeInTheDocument()
  })

  it('opening either security in Full Research navigates to its canonical page', () => {
    mockComparisonReturn = { data: fullData(), isLoading: false }
    renderWithProviders(<ResearchComparePage />, { route: '/research/AAPL/compare/MSFT' })
    fireEvent.click(screen.getByText('Open AAPL Research'))
    expect(mockNavigate).toHaveBeenCalledWith('/research/AAPL')
    fireEvent.click(screen.getByText('Open MSFT Research'))
    expect(mockNavigate).toHaveBeenCalledWith('/research/MSFT')
  })

  it('swap navigates to the reversed A/B compare route', () => {
    mockComparisonReturn = { data: fullData(), isLoading: false }
    renderWithProviders(<ResearchComparePage />, { route: '/research/AAPL/compare/MSFT' })
    fireEvent.click(screen.getByText('Swap'))
    expect(mockNavigate).toHaveBeenCalledWith('/research/MSFT/compare/AAPL')
  })

  it('discloses the fundamentals period caveat rather than implying aligned periods', () => {
    mockComparisonReturn = { data: fullData(), isLoading: false }
    renderWithProviders(<ResearchComparePage />, { route: '/research/AAPL/compare/MSFT' })
    expect(screen.getByText('Fundamentals shown as currently reported.')).toBeInTheDocument()
  })
})
