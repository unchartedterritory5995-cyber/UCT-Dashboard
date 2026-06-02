import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ScoreboardView from './ScoreboardView'

const metrics = [
  { key: 'breadth_score', label: 'Health', getTier: () => 'g2', getFmt: () => '75', drillKey: null },
  { key: 'up_4pct_today', label: 'Up 4%+', getTier: () => 'g3', getFmt: () => '383', drillKey: 'up_4pct_today_list' },
]
const currentRow = { breadth_score: 75, up_4pct_today: 383 }
const recentRows = [
  { breadth_score: 75, up_4pct_today: 383 },
  { breadth_score: 70, up_4pct_today: 300 },
  { breadth_score: 68, up_4pct_today: 250 },
]

describe('ScoreboardView', () => {
  it('renders a card per metric with label + current value', () => {
    render(<ScoreboardView currentRow={currentRow} recentRows={recentRows} metrics={metrics} onDrill={() => {}} />)
    expect(screen.getByText('Health')).toBeInTheDocument()
    expect(screen.getByText('75')).toBeInTheDocument()
    expect(screen.getByText('383')).toBeInTheDocument()
  })
  it('marks the signal card with a ★', () => {
    render(<ScoreboardView currentRow={currentRow} recentRows={recentRows} metrics={metrics}
                           signalKey="up_4pct_today" onDrill={() => {}} />)
    expect(screen.getByText('★ Up 4%+')).toBeInTheDocument()
  })
  it('clicking a drillable card calls onDrill', () => {
    const onDrill = vi.fn()
    render(<ScoreboardView currentRow={currentRow} recentRows={recentRows} metrics={metrics} onDrill={onDrill} />)
    fireEvent.click(screen.getByLabelText('Up 4%+ details'))
    expect(onDrill).toHaveBeenCalledWith(metrics[1])
  })
})
