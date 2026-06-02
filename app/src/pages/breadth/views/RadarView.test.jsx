import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RadarView from './RadarView'

const metrics = [
  { key: 'breadth_score', label: 'Health', getFmt: () => '75', drillKey: 'breadth_list' },
  { key: 'pct_above_50sma', label: '>50 SMA', getFmt: () => '58', drillKey: null },
  { key: 'vix', label: 'VIX', getFmt: () => '16', drillKey: null },
]
const row = { breadth_score: 75, pct_above_50sma: 58, vix: 16 }

describe('RadarView', () => {
  it('renders an axis label per metric', () => {
    render(<RadarView currentRow={row} metrics={metrics} normalize={() => 60} onDrill={() => {}} />)
    expect(screen.getByText('Health')).toBeInTheDocument()
    expect(screen.getByText('>50 SMA')).toBeInTheDocument()
    expect(screen.getByText('VIX')).toBeInTheDocument()
  })
  it('shows a fallback message with fewer than 3 metrics', () => {
    render(<RadarView currentRow={row} metrics={metrics.slice(0, 2)} normalize={() => 60} onDrill={() => {}} />)
    expect(screen.getByText(/at least 3/i)).toBeInTheDocument()
  })
  it('clicking a drillable axis label calls onDrill', () => {
    const onDrill = vi.fn()
    render(<RadarView currentRow={row} metrics={metrics} normalize={() => 60} onDrill={onDrill} />)
    fireEvent.click(screen.getByText('Health'))
    expect(onDrill).toHaveBeenCalledWith(metrics[0])
  })
  it('marks the signal axis with a ★', () => {
    render(<RadarView currentRow={row} metrics={metrics} normalize={() => 60} signalKey="breadth_score" onDrill={() => {}} />)
    expect(screen.getByText('★ Health')).toBeInTheDocument()
  })
})

const mk = (key) => ({ key, label: key, drillKey: `${key}_list`, polarity: 'bull' })
const bigMetrics = Array.from({ length: 16 }, (_, i) => mk(`m${i}`))
const currentRow = { date: '2026-06-01' }
const normalize = (m) => 50 + (Number(m.key.slice(1)) % 5) * 8  // deterministic spread

describe('RadarView spoke cap', () => {
  it('renders at most maxSpokes axis labels', () => {
    const { container } = render(
      <RadarView currentRow={currentRow} metrics={bigMetrics} normalize={normalize}
                 onDrill={() => {}} signalKey={null} notableKey={null} options={{ maxSpokes: 8, spokeSelect: 'auto' }} />,
    )
    // axis labels are <text> nodes
    expect(container.querySelectorAll('text').length).toBe(8)
  })

  it('as-listed pick keeps the first N metrics in order', () => {
    const { container } = render(
      <RadarView currentRow={currentRow} metrics={bigMetrics} normalize={normalize}
                 onDrill={() => {}} signalKey={null} notableKey={null} options={{ maxSpokes: 10, spokeSelect: 'listed' }} />,
    )
    const labels = [...container.querySelectorAll('text')].map(t => t.textContent.replace('★ ', ''))
    expect(labels).toEqual(['m0','m1','m2','m3','m4','m5','m6','m7','m8','m9'])
  })
})
