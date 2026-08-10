import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Newest-first, exactly as /api/research/financials returns it.
const QUARTERLY = [
  { period: 'Q2 2026', revenue: 109.4e9, eps: 2.02 },
  { period: 'Q1 2026', revenue: 95.4e9, eps: 1.65 },
  { period: 'Q4 2025', revenue: 124.3e9, eps: 2.40 },
]

const captured = []
vi.mock('../../../components/research-kit', () => ({
  MetricTrendChart: (props) => {
    captured.push(props)
    return <div data-testid={`trend-${props.label}`} />
  },
  // The tab also draws margins through SeriesChart; the mock has to cover every
  // export it imports or the module resolves to undefined and the tab throws.
  SeriesChart: (props) => {
    captured.push(props)
    return <div data-testid={`series-${props.label}`} />
  },
}))

let finData = { quarterly: QUARTERLY, annual: [], balance: {}, metrics: {} }
vi.mock('../hooks/useFinancials', () => ({
  default: () => ({ data: finData, isLoading: false }),
}))

import FinancialsTab from './FinancialsTab'

beforeEach(() => { captured.length = 0 })

describe('financial trends read forwards in time', () => {
  it('plots OLDEST period first, not the API order', () => {
    // The rows arrive newest-first, which is correct for a table and wrong for
    // a chart: plotted as given, time runs backwards and a rising business
    // draws as a falling line. Nothing about the chart would look broken.
    render(<FinancialsTab sym="AAPL" />)
    const rev = captured.find(p => p.label === 'Revenue ($B)')
    expect(rev.periods).toEqual(['Q4 2025', 'Q1 2026', 'Q2 2026'])
  })

  it('values stay aligned to their periods through the reversal', () => {
    render(<FinancialsTab sym="AAPL" />)
    const rev = captured.find(p => p.label === 'Revenue ($B)')
    const eps = captured.find(p => p.label === 'EPS')
    // Q4 2025 revenue is 124.3B and its EPS is 2.40 — reversing the periods
    // without reversing the values would silently mismatch every point.
    expect(rev.values[0]).toBeCloseTo(124.3, 1)
    expect(eps.values[0]).toBeCloseTo(2.40, 2)
    expect(rev.values.at(-1)).toBeCloseTo(109.4, 1)
    expect(eps.values.at(-1)).toBeCloseTo(2.02, 2)
  })

  it('converts revenue to billions so the axis is readable', () => {
    render(<FinancialsTab sym="AAPL" />)
    const rev = captured.find(p => p.label === 'Revenue ($B)')
    expect(Math.max(...rev.values)).toBeLessThan(1000)
    expect(rev.valueFormatter(124.3)).toBe('$124.3B')
  })

  it('does NOT draw a trend from a single point', () => {
    finData = { quarterly: [QUARTERLY[0]], annual: [], balance: {}, metrics: {} }
    render(<FinancialsTab sym="AAPL" />)
    expect(captured).toEqual([])
    finData = { quarterly: QUARTERLY, annual: [], balance: {}, metrics: {} }
  })

  it('survives missing quarterly data entirely', () => {
    finData = { quarterly: null, annual: [], balance: {}, metrics: {} }
    expect(() => render(<FinancialsTab sym="AAPL" />)).not.toThrow()
    finData = { quarterly: QUARTERLY, annual: [], balance: {}, metrics: {} }
  })
})

describe('quarterly / annual basis toggle', () => {
  const ANNUAL = [
    { period: '2025', revenue: 400e9, eps: 7.1 },
    { period: '2024', revenue: 391e9, eps: 6.1 },
    { period: '2023', revenue: 383e9, eps: 5.9 },
  ]

  it('defaults to quarterly', () => {
    finData = { quarterly: QUARTERLY, annual: ANNUAL, balance: {}, metrics: {} }
    render(<FinancialsTab sym="AAPL" />)
    const rev = captured.find(p => p.label === 'Revenue ($B)')
    expect(rev.periods).toEqual(['Q4 2025', 'Q1 2026', 'Q2 2026'])
  })

  it('switching to annual charts the ANNUAL series, still oldest-first', () => {
    finData = { quarterly: QUARTERLY, annual: ANNUAL, balance: {}, metrics: {} }
    render(<FinancialsTab sym="AAPL" />)
    captured.length = 0
    fireEvent.click(screen.getByRole('button', { name: /^Annual$/i }))
    const rev = captured.find(p => p.label === 'Revenue ($B)')
    expect(rev.periods).toEqual(['2023', '2024', '2025'])
    expect(rev.values[0]).toBeCloseTo(383, 0)
  })

  it('hides the toggle when only ONE basis has data', () => {
    // Offering a switch to an empty chart is worse than not offering it.
    finData = { quarterly: QUARTERLY, annual: [], balance: {}, metrics: {} }
    render(<FinancialsTab sym="AAPL" />)
    expect(screen.queryByRole('button', { name: /^Annual$/i })).toBeNull()
  })
})
