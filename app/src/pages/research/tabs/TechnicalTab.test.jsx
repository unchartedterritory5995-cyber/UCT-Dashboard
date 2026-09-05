import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, fireEvent } from '../../../test-utils'

// Chart/Technical Intelligence Convergence Phase B (owner authorization,
// 2026-09-05). Deterministic only. Source is the EXISTING confirmed-only
// /api/patterns/{sym} endpoint (never the raw scanner firehose the owner
// already ruled untrustworthy) via useTechnical.js.

vi.mock('../../../components/StockChart', () => ({
  default: (props) => (
    <div
      data-testid="stock-chart"
      data-price-lines={JSON.stringify(props.priceLines || [])}
      data-callouts={JSON.stringify(props.callouts || [])}
      data-highlight={props.highlightBarTime || ''}
    />
  ),
}))

let mockReturn = { data: null, isLoading: true }
vi.mock('../hooks/useTechnical', () => ({ default: () => mockReturn }))

const bullFlag = {
  setup: 'bull_flag', tf: 'D', asof_date: '2026-09-04', confirmed: 1,
  vision_confidence: 82, rationale: 'Clean flag on declining volume.',
  key_level: 191.5, checks: [{ criterion: 'Prior uptrend visible', passed: true }],
}
const vcp = {
  setup: 'vcp', tf: 'D', asof_date: '2026-09-02', confirmed: 1,
  vision_confidence: 71, rationale: 'Three contractions into the highs.',
  key_level: 205.0, checks: [{ criterion: 'Tightening ranges', passed: true }, { criterion: 'Volume dry-up', passed: false }],
}

import TechnicalTab from './TechnicalTab'

describe('TechnicalTab', () => {
  it('shows an honest empty state when no setups are confirmed', () => {
    mockReturn = { data: { verdicts: [] }, isLoading: false }
    renderWithProviders(<TechnicalTab sym="AAPL" />, { route: '/research/AAPL' })
    expect(screen.getByTestId('technical-empty-state')).toHaveTextContent('No confirmed technical setups on AAPL right now.')
    expect(screen.queryByTestId('technical-chart')).not.toBeInTheDocument()
  })

  it('renders a confirmed setup with its narrative, confidence, and checklist', () => {
    mockReturn = { data: { verdicts: [bullFlag] }, isLoading: false }
    renderWithProviders(<TechnicalTab sym="AAPL" />, { route: '/research/AAPL' })
    expect(screen.getByText('Bull Flag')).toBeInTheDocument()
    expect(screen.getByText(/82% confidence/)).toBeInTheDocument()
    expect(screen.getByText('Clean flag on declining volume.')).toBeInTheDocument()
    expect(screen.getByText(/Prior uptrend visible/)).toBeInTheDocument()
  })

  it('drives the embedded chart with the selected setup\'s key level and callout', () => {
    mockReturn = { data: { verdicts: [bullFlag] }, isLoading: false }
    renderWithProviders(<TechnicalTab sym="AAPL" />, { route: '/research/AAPL' })
    const chart = screen.getByTestId('stock-chart')
    const lines = JSON.parse(chart.dataset.priceLines)
    expect(lines[0].price).toBe(191.5)
    const callouts = JSON.parse(chart.dataset.callouts)
    expect(callouts[0].time).toBe('2026-09-04')
    expect(chart.dataset.highlight).toBe('2026-09-04')
  })

  it('switches the chart context when a different verdict card is clicked', () => {
    mockReturn = { data: { verdicts: [bullFlag, vcp] }, isLoading: false }
    renderWithProviders(<TechnicalTab sym="AAPL" />, { route: '/research/AAPL' })
    fireEvent.click(screen.getByText('Vcp'))
    const chart = screen.getByTestId('stock-chart')
    expect(JSON.parse(chart.dataset.priceLines)[0].price).toBe(205.0)
  })

  it('emphasizes and confirms a scanner-origin hint that is still currently confirmed', () => {
    mockReturn = { data: { verdicts: [bullFlag] }, isLoading: false }
    renderWithProviders(<TechnicalTab sym="AAPL" />, { route: '/research/AAPL?setup=bull_flag' })
    expect(screen.getByTestId('scanner-hint-current')).toHaveTextContent('Detected from Scanner: Bull Flag')
    expect(screen.queryByTestId('scanner-hint-stale')).not.toBeInTheDocument()
  })

  it('reports honestly when a scanner-origin hint is no longer confirmed active', () => {
    mockReturn = { data: { verdicts: [bullFlag] }, isLoading: false }
    renderWithProviders(<TechnicalTab sym="AAPL" />, { route: '/research/AAPL?setup=vcp' })
    expect(screen.getByTestId('scanner-hint-stale')).toHaveTextContent(
      'Detected from Scanner: Vcp — this setup is no longer confirmed as active for AAPL.',
    )
  })

  it('shows a loading state before data resolves', () => {
    mockReturn = { data: null, isLoading: true }
    renderWithProviders(<TechnicalTab sym="AAPL" />, { route: '/research/AAPL' })
    expect(screen.getByText('Loading technical evidence…')).toBeInTheDocument()
  })
})
