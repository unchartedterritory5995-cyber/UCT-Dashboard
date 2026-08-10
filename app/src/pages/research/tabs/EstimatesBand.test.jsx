import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

// Exactly what /api/research/estimates returns: two quarterly rows and two
// ANNUAL rows in one array.
const FORWARD = [
  { period: 'Current Qtr', eps_low: 1.93, eps_avg: 1.98, eps_high: 2.04 },
  { period: 'Next Qtr', eps_low: 2.51, eps_avg: 2.91, eps_high: 3.42 },
  { period: 'Current Yr', eps_low: 8.28, eps_avg: 8.80, eps_high: 8.92 },
  { period: 'Next Yr', eps_low: 8.24, eps_avg: 9.55, eps_high: 10.67 },
]

const captured = []
vi.mock('../../../components/research-kit', () => ({
  SeriesChart: (props) => { captured.push(props); return <div /> },
  RevisionColumns: () => <div />,
}))
vi.mock('../hooks/useEstimates', () => ({
  default: () => ({ data: { forward: FORWARD, revisions: [], rating_changes: [] },
                    isLoading: false }),
}))

import EstimatesTab from './EstimatesTab'

describe('forward EPS never mixes quarterly and annual on one axis', () => {
  it('draws quarters and years as SEPARATE charts', () => {
    // One axis put 1.98 and 2.91 beside 8.80 and 9.55 — a steeply rising line
    // that reads as accelerating earnings when the jump is only quarterly EPS
    // becoming annual EPS. Observed on AAPL in production.
    captured.length = 0
    render(<EstimatesTab sym="AAPL" />)
    const bands = captured.filter(c => c.mode === 'band')
    expect(bands).toHaveLength(2)
    expect(bands.map(b => b.label).sort()).toEqual(['Quarters', 'Years'])
  })

  it('each chart contains only its own period type', () => {
    captured.length = 0
    render(<EstimatesTab sym="AAPL" />)
    const bands = captured.filter(c => c.mode === 'band')
    const q = bands.find(b => b.label === 'Quarters')
    const y = bands.find(b => b.label === 'Years')
    expect(q.periods).toEqual(['Current Qtr', 'Next Qtr'])
    expect(y.periods).toEqual(['Current Yr', 'Next Yr'])
    // and no annual value leaked into the quarterly axis
    expect(Math.max(...q.series[2].values)).toBeLessThan(5)
    expect(Math.min(...y.series[0].values)).toBeGreaterThan(5)
  })

  it('keeps low / consensus / high in the order band mode expects', () => {
    captured.length = 0
    render(<EstimatesTab sym="AAPL" />)
    const q = captured.find(c => c.mode === 'band' && c.label === 'Quarters')
    expect(q.series.map(s => s.name)).toEqual(['Low', 'Consensus', 'High'])
  })
})
