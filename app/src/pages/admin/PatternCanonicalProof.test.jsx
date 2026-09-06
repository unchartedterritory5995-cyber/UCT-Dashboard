import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, fireEvent } from '../../test-utils'
import PatternCanonicalProof from './PatternCanonicalProof'

vi.mock('../../components/StockChart', () => ({
  default: (props) => (
    <div data-testid="stock-chart"
      data-sym={props.sym}
      data-forced-show={String(!!props.forcedShowPatterns)}
      data-forced-count={(props.forcedDetections || []).length}
      data-forced-id={props.forcedDetections?.[0]?.id || ''}
    >
      chart:{props.sym}
    </div>
  ),
}))

const RECENT = {
  detections: [
    { id: 'peg-1', sym: 'NVDA', pattern_id: 'power_earnings_gap', detected_at: 1700000000, confidence: 82, status: 'triggered' },
    { id: 'htf-1', sym: 'TSLA', pattern_id: 'high_tight_flag', detected_at: 1700000000, confidence: 70, status: 'forming' },
  ],
}

const DETAIL = {
  detection_id: 'peg-1',
  sym: 'NVDA',
  tf: 'D',
  pattern_id: 'power_earnings_gap',
  pattern_name: 'Power Earnings Gap',
  direction: 'bullish',
  status: 'triggered',
  confidence: 82,
  detected_at: 1700000000,
  last_seen_at: 1700000000,
  geometry: { shape: 'candle_mark', anchors: [{ t: 1, price: 1 }], anchor_roles: ['prior_close'], semantic_subtype: 'gap_event' },
  levels: {},
  context: {},
  quality_components: {},
  eligibility: { eligible: true },
  event: { event_type: 'earnings', verification_status: 'verified' },
  gate_trace_available: true,
  explanation: {
    sections: [
      { section: 'why_it_matched', facts: [
        { fact_id: 'peg_gap_pct', category: 'geometry', claim_type: 'direct', label: 'Gap size', supporting_evidence: 'gapped up 9.0%', polarity: 'supports', priority: 1 },
      ] },
    ],
  },
  source: 'canonical_db_read',
  contract_version: 'phase8.8f.1',
}

vi.mock('swr', () => ({
  default: (key) => {
    if (!key) return { data: undefined, error: undefined, isLoading: false }
    if (key.includes('/api/admin/patterns/recent')) return { data: RECENT, error: undefined, isLoading: false }
    if (key.includes('/api/patterns/admin/canonical-detail/peg-1')) return { data: DETAIL, error: undefined, isLoading: false }
    if (key.includes('/api/patterns/admin/canonical-detail/')) return { data: undefined, error: new Error('404'), isLoading: false }
    return { data: undefined, error: undefined, isLoading: false }
  },
}))

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})

describe('PatternCanonicalProof', () => {
  it('shows the admin-only / read-only banner', () => {
    renderWithProviders(<PatternCanonicalProof />)
    expect(screen.getByText(/Admin-only, read-only proof surface/)).toBeInTheDocument()
  })

  it('lists only power_earnings_gap rows from /api/admin/patterns/recent, never other families', () => {
    renderWithProviders(<PatternCanonicalProof />)
    expect(screen.getByText('NVDA')).toBeInTheDocument()
    expect(screen.queryByText('TSLA')).not.toBeInTheDocument()
  })

  it('loading a detection renders the canonical detail + forces the exact geometry onto StockChart', () => {
    renderWithProviders(<PatternCanonicalProof />)
    fireEvent.click(screen.getByText('View proof'))

    const chart = screen.getByTestId('stock-chart')
    expect(chart).toHaveAttribute('data-sym', 'NVDA')
    expect(chart).toHaveAttribute('data-forced-show', 'true')
    expect(chart).toHaveAttribute('data-forced-count', '1')
    expect(chart).toHaveAttribute('data-forced-id', 'peg-1')

    expect(screen.getByText('why it matched')).toBeInTheDocument()
    expect(screen.getByText('Gap size')).toBeInTheDocument()
    expect(screen.getByText(/gapped up 9.0%/)).toBeInTheDocument()
  })

  it('the manual detection-id box loads by id directly', () => {
    renderWithProviders(<PatternCanonicalProof />)
    fireEvent.change(screen.getByPlaceholderText('detection id'), { target: { value: 'peg-1' } })
    fireEvent.click(screen.getByText('Load'))
    expect(screen.getByTestId('stock-chart')).toHaveAttribute('data-forced-id', 'peg-1')
  })

  it('a load failure (e.g. non-admin session) shows an error, not a crash', () => {
    renderWithProviders(<PatternCanonicalProof />)
    fireEvent.change(screen.getByPlaceholderText('detection id'), { target: { value: 'does-not-exist' } })
    fireEvent.click(screen.getByText('Load'))
    expect(screen.getByText(/Could not load canonical detail/)).toBeInTheDocument()
  })
})
