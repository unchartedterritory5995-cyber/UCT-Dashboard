import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BreadthSignalStrip from './BreadthSignalStrip'

const signal = { key: 'breadth_score', label: 'Health', getFmt: () => '75', drillKey: null }
const notable = { key: 'pct_above_5sma', label: '>5 SMA', getFmt: () => '44.6%', drillKey: 'pct_above_5sma_list' }
const row = { breadth_score: 75, pct_above_5sma: 44.6 }

describe('BreadthSignalStrip', () => {
  it('renders the signal and notable chips with labels + values', () => {
    render(<BreadthSignalStrip signalMetric={signal} signalReason="biggest move"
                               notableMetric={notable} notableReason="lagging the board"
                               currentRow={row} onDrill={() => {}} />)
    expect(screen.getByText('Health')).toBeInTheDocument()
    expect(screen.getByText('75')).toBeInTheDocument()
    expect(screen.getByText('>5 SMA')).toBeInTheDocument()
    expect(screen.getByText('44.6%')).toBeInTheDocument()
  })

  it('renders null when neither signal is present', () => {
    const { container } = render(
      <BreadthSignalStrip signalMetric={null} notableMetric={null} currentRow={row} onDrill={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('clicking a drillable chip calls onDrill with the metric', () => {
    const onDrill = vi.fn()
    render(<BreadthSignalStrip signalMetric={signal} signalReason="x"
                               notableMetric={notable} notableReason="y"
                               currentRow={row} onDrill={onDrill} />)
    fireEvent.click(screen.getByLabelText('>5 SMA details'))
    expect(onDrill).toHaveBeenCalledWith(notable)
  })
})
