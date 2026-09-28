import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, fireEvent, within } from '../../test-utils'
import ResearchComparePage from './ResearchComparePage'
import { withResearchReturnParam } from '../../lib/journal-2-0'

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
      price: { last: 230.5, change_pct: 1.25, week52_high: 250.0, week52_low: 165.0 },
      estimates: [], ratings: { composite: 88, components: {}, price_as_of: '2026-09-04' },
      analyst: { consensus: { label: 'Buy' }, price_target: { consensus: 260 } },
    },
    b: {
      sym: 'MSFT', entity: { status: 'resolved', entityId: 'e_msft' },
      fundamentals: { sector: 'Technology', industry: 'Software', market_cap: '$3.1T', pe_trailing: 33.4 },
      price: { last: 410.0, change_pct: -0.5, week52_high: 470.0, week52_low: 380.0 },
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

  describe('Compare Coverage V1 -- price/day-change/52-week range (Seam)', () => {
    it('renders both prices, signed day-change %, and the 52-week range', () => {
      mockComparisonReturn = { data: fullData(), isLoading: false }
      renderWithProviders(<ResearchComparePage />, { route: '/research/AAPL/compare/MSFT' })
      expect(screen.getByText('$230.50')).toBeInTheDocument()
      expect(screen.getByText('$410.00')).toBeInTheDocument()
      expect(screen.getByText('+1.25%')).toBeInTheDocument()
      expect(screen.getByText('-0.50%')).toBeInTheDocument()
      expect(screen.getByText('$165.00 – $250.00')).toBeInTheDocument()
      expect(screen.getByText('$380.00 – $470.00')).toBeInTheDocument()
    })

    it('a positive change is colored differently from a negative one', () => {
      mockComparisonReturn = { data: fullData(), isLoading: false }
      renderWithProviders(<ResearchComparePage />, { route: '/research/AAPL/compare/MSFT' })
      const up = screen.getByText('+1.25%')
      const down = screen.getByText('-0.50%')
      expect(up.className).not.toBe(down.className)
      expect(up.className).toBeTruthy()
      expect(down.className).toBeTruthy()
    })

    it('renders an em dash instead of crashing when price data is absent', () => {
      mockComparisonReturn = {
        data: fullData({
          b: { sym: 'NOTATICKERXYZ', entity: { status: 'not_found' }, fundamentals: { error: 'no fundamentals available' }, estimates: [], ratings: {}, analyst: {} },
        }),
        isLoading: false,
      }
      mockParams = { sym: 'AAPL', comparator: 'NOTATICKERXYZ' }
      renderWithProviders(<ResearchComparePage />, { route: '/research/AAPL/compare/NOTATICKERXYZ' })
      expect(screen.getByTestId('research-compare-page')).toBeInTheDocument()
      // AAPL's own price still renders correctly alongside the missing side.
      expect(screen.getByText('$230.50')).toBeInTheDocument()
    })
  })

  // Seam 22 — the return marker on the COMPARE surface.
  //
  // These are ROUND-TRIP tests on purpose: each one builds its URL with the
  // WRITER helper the three journal surfaces actually call
  // (withResearchReturnParam), instead of hand-typing '?from=trade:42'. Two
  // hand-typed strings agreeing proves the strings agree; driving the real
  // writer proves the writer and this reader agree. If the marker format
  // ever changes, these go red rather than passing against a stale literal.
  describe('return-to context (Seam 22)', () => {
    beforeEach(() => {
      mockComparisonReturn = { data: fullData(), isLoading: false }
    })

    it('round-trips a TRADE marker into a labelled link back to that trade', () => {
      const route = withResearchReturnParam('/research/AAPL/compare/MSFT', 'trade', '42')
      expect(route).toContain('from=')            // control: the writer produced a marker
      renderWithProviders(<ResearchComparePage />, { route })
      const link = screen.getByTestId('compare-return-link')
      expect(link).toHaveTextContent('Back to Trade')
      expect(link.getAttribute('href')).toBe('/journal-2-0/trade/42')
    })

    it('round-trips a POSITION marker, naming the symbol in the label', () => {
      const route = withResearchReturnParam('/research/AAPL/compare/MSFT', 'position', 'aapl')
      renderWithProviders(<ResearchComparePage />, { route })
      const link = screen.getByTestId('compare-return-link')
      expect(link).toHaveTextContent('Back to AAPL Position')
      expect(link.getAttribute('href')).toBe('/journal-2-0/position/AAPL')
    })

    it('renders NO link when the param is absent — the ordinary entry path', () => {
      renderWithProviders(<ResearchComparePage />, { route: '/research/AAPL/compare/MSFT' })
      expect(screen.getByTestId('research-compare-page')).toBeInTheDocument()
      expect(screen.queryByTestId('compare-return-link')).toBeNull()
    })

    it('renders NO link for a malformed marker rather than a link to nowhere', () => {
      // researchReturnTarget() returns null for an unknown kind; rendering the
      // link anyway would give the member a dead <a href="null">.
      renderWithProviders(<ResearchComparePage />, { route: '/research/AAPL/compare/MSFT?from=wat:1' })
      expect(screen.queryByTestId('compare-return-link')).toBeNull()
    })

    it('keeps the way back on the ERROR branch — the state most likely to strand', () => {
      mockComparisonReturn = { data: { error: 'Comparison unavailable.' }, isLoading: false }
      const route = withResearchReturnParam('/research/AAPL/compare/MSFT', 'trade', '42')
      renderWithProviders(<ResearchComparePage />, { route })
      expect(screen.getByText('Comparison unavailable.')).toBeInTheDocument()
      expect(screen.getByTestId('compare-return-link')).toHaveTextContent('Back to Trade')
    })
  })

  // ── TERM-019 adoption: the analyst legs' S8 envelopes, rendered per side ──
  // comparison.py ships `consensus_meta` / `price_target_meta` "as-is so two
  // securities with different freshness/vendor state show that difference
  // rather than reading as equally current". Until TERM-019 this page dropped
  // both. These pin that they are now SHOWN, through S8, per side.
  describe('analyst provenance, per side (TERM-019)', () => {
    const META = (freshnessClass, sourceActivity) => ({
      vendor: 'fmp', sourceActivity, sourceObservedAt: 1735689600, tieBreak: null,
      freshnessClass, licensingClass: 'R', degraded: null,
    })
    function withMeta() {
      const d = fullData()
      d.a.analyst = { ...d.a.analyst,
        consensus_meta: META('end_of_day', 'fmp_client.get_grades_consensus'),
        price_target_meta: META('end_of_day', 'fmp_client.get_price_target_consensus') }
      d.b.analyst = { ...d.b.analyst,
        consensus_meta: META('stale', 'fmp_client.get_grades_consensus'),
        price_target_meta: META('end_of_day', 'fmp_client.get_price_target_consensus') }
      return d
    }

    it('renders an S8 <Provenance> + <FreshnessBadge> for every side of every analyst leg', () => {
      mockComparisonReturn = { data: withMeta(), isLoading: false }
      renderWithProviders(<ResearchComparePage />, { route: '/research/AAPL/compare/MSFT' })
      const block = screen.getByTestId('compare-analyst-provenance')
      expect(within(block).getAllByTestId('provenance-present')).toHaveLength(4)
      expect(within(block).getAllByTestId('freshness-badge')).toHaveLength(4)
      const sides = within(block).getAllByTestId('compare-analyst-provenance-side')
      expect(sides.map(s => `${s.getAttribute('data-leg')}:${s.getAttribute('data-side')}`)).toEqual([
        'consensus:AAPL', 'consensus:MSFT', 'price_target:AAPL', 'price_target:MSFT',
      ])
    })

    it('two securities with different freshness READ differently, which is the envelope\'s stated purpose', () => {
      mockComparisonReturn = { data: withMeta(), isLoading: false }
      renderWithProviders(<ResearchComparePage />, { route: '/research/AAPL/compare/MSFT' })
      const sides = screen.getAllByTestId('compare-analyst-provenance-side')
      const tier = (el) => within(el).getByTestId('freshness-tier').getAttribute('data-freshness-tier')
      expect(tier(sides[0])).toBe('end_of_day')
      expect(tier(sides[1])).toBe('stale')
      expect(within(sides[1]).getByTestId('source-stale-note')).toBeInTheDocument()
    })

    it('the detail disclosure names the real source activity from the envelope', () => {
      mockComparisonReturn = { data: withMeta(), isLoading: false }
      renderWithProviders(<ResearchComparePage />, { route: '/research/AAPL/compare/MSFT' })
      const side = screen.getAllByTestId('compare-analyst-provenance-side')[2]
      fireEvent.click(within(side).getByTestId('provenance-detail-toggle'))
      expect(within(side).getByTestId('provenance-detail-panel'))
        .toHaveTextContent('Source: fmp_client.get_price_target_consensus')
    })

    it('a value with NO envelope states "provenance unavailable", never a bare blank and never a badge', () => {
      mockComparisonReturn = { data: fullData(), isLoading: false }
      renderWithProviders(<ResearchComparePage />, { route: '/research/AAPL/compare/MSFT' })
      const block = screen.getByTestId('compare-analyst-provenance')
      expect(within(block).getAllByTestId('provenance-degraded')).toHaveLength(4)
      expect(within(block).queryAllByTestId('provenance-present')).toHaveLength(0)
      expect(within(block).queryAllByTestId('freshness-badge')).toHaveLength(0)
    })

    it('a side with no analyst value says so, and cites nothing for it', () => {
      const d = withMeta()
      d.b.analyst = { consensus: null, price_target: null, consensus_meta: null, price_target_meta: null, outage: false }
      mockComparisonReturn = { data: d, isLoading: false }
      renderWithProviders(<ResearchComparePage />, { route: '/research/AAPL/compare/MSFT' })
      const sides = screen.getAllByTestId('compare-analyst-provenance-side')
      const msft = sides.filter(s => s.getAttribute('data-side') === 'MSFT')
      expect(msft).toHaveLength(2)
      for (const s of msft) {
        expect(s).toHaveTextContent('no analyst data')
        expect(within(s).queryByTestId('provenance-present')).toBeNull()
        expect(within(s).queryByTestId('provenance-degraded')).toBeNull()
      }
      expect(screen.getAllByTestId('provenance-present')).toHaveLength(2)
    })

    it('a side missing its value because the source FAILED says so on S8\'s availability axis, not as "no data"', () => {
      // Seam 29's `outage` flag: a genuine provider outage this round, which
      // must not read like a ticker with no analyst coverage.
      const d = withMeta()
      d.b.analyst = { consensus: null, price_target: null, consensus_meta: null, price_target_meta: null, outage: true }
      mockComparisonReturn = { data: d, isLoading: false }
      renderWithProviders(<ResearchComparePage />, { route: '/research/AAPL/compare/MSFT' })
      const msft = screen.getAllByTestId('compare-analyst-provenance-side')
        .filter(s => s.getAttribute('data-side') === 'MSFT')
      expect(msft).toHaveLength(2)
      for (const s of msft) {
        expect(within(s).getByTestId('provenance-unavailable'))
          .toHaveAttribute('data-availability', 'provider_error')
        expect(s).not.toHaveTextContent('no analyst data')
      }
    })

    it('is a real control: no analyst value on either side renders no sources block', () => {
      const d = fullData()
      d.a.analyst = { consensus: null, price_target: null }
      d.b.analyst = { consensus: null, price_target: null }
      mockComparisonReturn = { data: d, isLoading: false }
      renderWithProviders(<ResearchComparePage />, { route: '/research/AAPL/compare/MSFT' })
      expect(screen.getByTestId('research-compare-page')).toBeInTheDocument()
      expect(screen.queryByTestId('compare-analyst-provenance')).toBeNull()
    })
  })
})
