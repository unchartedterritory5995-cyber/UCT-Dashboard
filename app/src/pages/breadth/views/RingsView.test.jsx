import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RingsView from './RingsView'

const metrics = [
  { key: 'breadth_score', label: 'Health', getTier: () => 'g2', getFmt: () => '75', drillKey: null },
  { key: 'up_4pct_today', label: 'Up 4%+', getTier: () => 'g3', getFmt: () => '383', drillKey: 'up_4pct_today_list' },
]
const row = { breadth_score: 75, up_4pct_today: 383 }

describe('RingsView', () => {
  it('renders a ring per metric with its formatted value + label', () => {
    render(<RingsView currentRow={row} prevRow={null} metrics={metrics}
                      normalize={() => 60} onDrill={() => {}} />)
    expect(screen.getByText('Health')).toBeInTheDocument()
    expect(screen.getByText('75')).toBeInTheDocument()
    expect(screen.getByText('Up 4%+')).toBeInTheDocument()
  })
  it('clicking a ring with a drillKey calls onDrill with the metric', () => {
    const onDrill = vi.fn()
    render(<RingsView currentRow={row} prevRow={null} metrics={metrics}
                      normalize={() => 60} onDrill={onDrill} />)
    fireEvent.click(screen.getByLabelText('Up 4%+ details'))
    expect(onDrill).toHaveBeenCalledWith(metrics[1])
  })
})
