import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MetersView from './MetersView'

const metrics = [
  { key: 'pct_above_50sma', label: '>50 SMA', getTier: () => 'g2', getFmt: () => '57.8%',
    drillKey: null },
  { key: 'vix', label: 'VIX', getTier: () => 'a', getFmt: () => '16.0', drillKey: null },
]
const row = { pct_above_50sma: 57.8, vix: 16 }

describe('MetersView', () => {
  it('renders a labeled meter per metric with its value', () => {
    render(<MetersView currentRow={row} metrics={metrics} normalize={() => 57.8} onDrill={() => {}} />)
    expect(screen.getByText('>50 SMA')).toBeInTheDocument()
    expect(screen.getByText('57.8%')).toBeInTheDocument()
  })
  it('positions the marker at the normalized value', () => {
    render(<MetersView currentRow={row} metrics={metrics} normalize={() => 58} onDrill={() => {}} />)
    const marker = screen.getByTestId('marker-pct_above_50sma')
    expect(marker).toHaveStyle({ left: '58%' })
  })
  it('clicking a meter with a drillKey calls onDrill', () => {
    const onDrill = vi.fn()
    const withDrill = [{ ...metrics[0], drillKey: 'x_list' }]
    render(<MetersView currentRow={row} metrics={withDrill} normalize={() => 58} onDrill={onDrill} />)
    fireEvent.click(screen.getByLabelText('>50 SMA details'))
    expect(onDrill).toHaveBeenCalledWith(withDrill[0])
  })
})
