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
