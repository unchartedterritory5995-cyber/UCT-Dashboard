import { render, screen, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { createRef } from 'react'
import PositioningRail from './PositioningRail'

// 200 weeks; commercials climb to a 3-year max long on the last week, large
// specs fall to a max short, so the latest read is strongly contrarian bullish.
function mkRows(n = 200) {
  const out = []
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2022, 0, 4 + i * 7))
    out.push({
      date: d.toISOString().slice(0, 10),
      commercial_net: -200_000 + i * 1_000,
      large_spec_net:  150_000 - i * 800,
      small_spec_net:  20_000 + (i % 7) * 1_000,
      open_interest:   1_800_000 + i * 1_500,
    })
  }
  return out
}

describe('PositioningRail', () => {
  it('shows the latest report by default with every group and open interest in the table', () => {
    const rows = mkRows()
    render(<PositioningRail rows={rows} symbol="ES" name="S&P 500 E-Mini" />)
    expect(screen.getByText('Latest report')).toBeInTheDocument()
    expect(rows[199].date).toBe('2025-10-28')
    expect(screen.getByText('10/28/2025')).toBeInTheDocument()
    expect(screen.getByText('Commercials')).toBeInTheDocument()
    expect(screen.getByText('Large Specs')).toBeInTheDocument()
    expect(screen.getByText('Small Specs')).toBeInTheDocument()
    expect(screen.getByText('Open Interest')).toBeInTheDocument()
    // latest commercial net = -200000 + 199*1000 = -1000 → "(1,000)"
    expect(screen.getByText('(1,000)')).toBeInTheDocument()
  })

  it('renders the bias and crowding read for the latest week', () => {
    render(<PositioningRail rows={mkRows()} symbol="ES" name="S&P 500 E-Mini" />)
    expect(screen.getByText('Contrarian Bullish')).toBeInTheDocument()
    expect(screen.getByText('Crowded Short')).toBeInTheDocument()
    expect(screen.getByText(/What to watch/i)).toBeInTheDocument()
  })

  it('follows an imperative setIndex and resets to latest on null', () => {
    const rows = mkRows()
    const ref = createRef()
    render(<PositioningRail ref={ref} rows={rows} symbol="ES" name="S&P 500 E-Mini" />)

    act(() => ref.current.setIndex(100))
    expect(screen.getByText('Week of')).toBeInTheDocument()
    expect(screen.getByText('12/5/2023')).toBeInTheDocument()    // rows[100].date
    // commercial net at 100 = -200000 + 100000 = -100000
    expect(screen.getByText('(100,000)')).toBeInTheDocument()

    act(() => ref.current.setIndex(null))
    expect(screen.getByText('Latest report')).toBeInTheDocument()
    expect(screen.getByText('(1,000)')).toBeInTheDocument()
  })

  it('snaps back to the latest week when the rows change', () => {
    const ref = createRef()
    const { rerender } = render(
      <PositioningRail ref={ref} rows={mkRows()} symbol="ES" name="S&P 500 E-Mini" />,
    )
    act(() => ref.current.setIndex(50))
    expect(screen.getByText('Week of')).toBeInTheDocument()
    rerender(<PositioningRail ref={ref} rows={mkRows(120)} symbol="NQ" name="Nasdaq-100 E-Mini" />)
    expect(screen.getByText('Latest report')).toBeInTheDocument()
  })

  it('shows the VIX caveat only for VI', () => {
    const { rerender } = render(<PositioningRail rows={mkRows()} symbol="ES" name="S&P 500 E-Mini" />)
    expect(screen.queryByText(/structurally short volatility/)).toBeNull()
    rerender(<PositioningRail rows={mkRows()} symbol="VI" name="VIX" />)
    expect(screen.getByText(/structurally short volatility/)).toBeInTheDocument()
  })

  it('renders nothing without rows', () => {
    const { container } = render(<PositioningRail rows={[]} symbol="ES" name="S&P 500 E-Mini" />)
    expect(container.firstChild).toBeNull()
  })
})
