import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import EqualizerView from './EqualizerView'

const metrics = [
  { key: 'breadth_score', label: 'Health', getTier: () => 'g2', getFmt: () => '75', drillKey: null },
  { key: 'up_4pct_today', label: 'Up 4%+', getTier: () => 'g3', getFmt: () => '383', drillKey: 'up_4pct_today_list' },
]
const currentRow = { breadth_score: 75, up_4pct_today: 383 }

describe('EqualizerView', () => {
  it('renders a column per metric with its value', () => {
    render(<EqualizerView currentRow={currentRow} metrics={metrics} normalize={() => 60} onDrill={() => {}} />)
    expect(screen.getByText('75')).toBeInTheDocument()
    expect(screen.getByText('383')).toBeInTheDocument()
    expect(screen.getByText('Health')).toBeInTheDocument()
  })
  it('marks the signal column with a ★', () => {
    render(<EqualizerView currentRow={currentRow} metrics={metrics} normalize={() => 60}
                          signalKey="breadth_score" onDrill={() => {}} />)
    expect(screen.getByText('★Health')).toBeInTheDocument()
  })
  it('clicking a drillable column calls onDrill', () => {
    const onDrill = vi.fn()
    render(<EqualizerView currentRow={currentRow} metrics={metrics} normalize={() => 60} onDrill={onDrill} />)
    fireEvent.click(screen.getByLabelText('Up 4%+ details'))
    expect(onDrill).toHaveBeenCalledWith(metrics[1])
  })
})
