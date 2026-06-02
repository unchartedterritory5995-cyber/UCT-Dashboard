import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TugView from './TugView'

const metrics = [
  { key: 'up_4pct_today', label: 'Up 4%+', getFmt: () => '383', drillKey: 'up_4pct_today_list',
    pair: { partnerKey: 'down_4pct_today', side: 'up' } },
  { key: 'down_4pct_today', label: 'Dn 4%+', getFmt: () => '208', drillKey: 'down_4pct_today_list',
    pair: { partnerKey: 'up_4pct_today', side: 'down' } },
]
const row = { up_4pct_today: 383, down_4pct_today: 208 }

describe('TugView', () => {
  it('renders one tug row per pair with both formatted values', () => {
    render(<TugView currentRow={row} metrics={metrics} normalize={() => 50} onDrill={() => {}} />)
    expect(screen.getByText('383')).toBeInTheDocument()
    expect(screen.getByText('208')).toBeInTheDocument()
  })
  it('shows a net posture summary line', () => {
    render(<TugView currentRow={row} metrics={metrics} normalize={() => 50} onDrill={() => {}} />)
    expect(screen.getByText(/BULLISH/)).toBeInTheDocument()
  })
  it('clicking a side with a drillKey calls onDrill', () => {
    const onDrill = vi.fn()
    render(<TugView currentRow={row} metrics={metrics} normalize={() => 50} onDrill={onDrill} />)
    fireEvent.click(screen.getByLabelText('Up 4%+ details'))
    expect(onDrill).toHaveBeenCalledWith(metrics[0])
  })
})
