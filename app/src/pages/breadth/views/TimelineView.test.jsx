import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TimelineView from './TimelineView'

const metrics = [
  { key: 'breadth_score', label: 'Health', getTier: () => 'g2', getFmt: () => '75', drillKey: null },
  { key: 'up_4pct_today', label: 'Up 4%+', getTier: () => 'g3', getFmt: () => '383', drillKey: 'up_4pct_today_list' },
]
const recentRows = [
  { date: '2026-06-01', breadth_score: 75, up_4pct_today: 383 },
  { date: '2026-05-31', breadth_score: 70, up_4pct_today: 300 },
]

describe('TimelineView', () => {
  it('renders a labeled row per metric', () => {
    render(<TimelineView recentRows={recentRows} metrics={metrics} onDrill={() => {}} />)
    expect(screen.getByText('Health')).toBeInTheDocument()
    expect(screen.getByText('Up 4%+')).toBeInTheDocument()
  })
  it('marks the signal row with a ★', () => {
    render(<TimelineView recentRows={recentRows} metrics={metrics} signalKey="breadth_score" onDrill={() => {}} />)
    const label = screen.getByText('Health')
    expect(label).toBeInTheDocument()
    expect(label.querySelector('svg')).toBeTruthy() // star-fill signal marker
  })
  it('clicking a drillable row label calls onDrill', () => {
    const onDrill = vi.fn()
    render(<TimelineView recentRows={recentRows} metrics={metrics} onDrill={onDrill} />)
    fireEvent.click(screen.getByLabelText('Up 4%+ details'))
    expect(onDrill).toHaveBeenCalledWith(metrics[1])
  })
  it('renders nothing without rows', () => {
    const { container } = render(<TimelineView recentRows={[]} metrics={metrics} onDrill={() => {}} />)
    expect(container.firstChild).toBeNull()
  })
})

// Task 9: windowDays option
const singleMetric = [{ key: 'a', label: 'a', drillKey: null, getFmt: () => 'x', getTier: () => 'g1' }]
const manyRows = Array.from({ length: 25 }, (_, i) => ({ date: `d${i}` }))

describe('TimelineView windowDays', () => {
  it('renders windowDays day-cells (plus the label cell)', () => {
    const { container } = render(
      <TimelineView recentRows={manyRows} metrics={singleMetric} onDrill={() => {}}
                    signalKey={null} notableKey={null} options={{ windowDays: 10 }} />,
    )
    // grid children = 1 label + N day cells for the single metric row
    const grid = container.querySelector('div[style*="grid-template-columns"]')
    expect(grid.children.length).toBe(1 + 10)
  })

  it('defaults to 20 when no option given', () => {
    const { container } = render(
      <TimelineView recentRows={manyRows} metrics={singleMetric} onDrill={() => {}}
                    signalKey={null} notableKey={null} />,
    )
    const grid = container.querySelector('div[style*="grid-template-columns"]')
    expect(grid.children.length).toBe(1 + 20)
  })
})
