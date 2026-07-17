import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import EarningsMarkerPopover from './EarningsMarkerPopover'

// The click-popover for an earnings marker. Data comes straight off the marker
// (/api/chart/markers → FMP), so these assert the formatting + section logic.

const MU = {
  date: '2026-03-18',
  beat: true,
  eps_actual: 12.20,
  eps_estimate: 9.186,
  eps_surprise_pct: 32.8,
  revenue_actual: 23_860_000_000,
  revenue_estimate: 19_970_000_000,
  revenue_surprise_pct: 19.5,
}

describe('EarningsMarkerPopover', () => {
  it('shows EPS + revenue with formatted surprises (the MU example)', () => {
    render(<EarningsMarkerPopover data={MU} x={100} y={100} sym="MU" onClose={() => {}} />)

    expect(screen.getByText('MU · Earnings')).toBeTruthy()
    // EPS
    expect(screen.getByText('12.20')).toBeTruthy()
    expect(screen.getByText('9.186')).toBeTruthy()          // estimate keeps precision
    expect(screen.getByText('+3.01 (+32.8%)')).toBeTruthy() // abs beat + pct
    // Revenue (big-notional formatted)
    expect(screen.getByText('23.86B')).toBeTruthy()
    expect(screen.getByText('19.97B')).toBeTruthy()
    expect(screen.getByText('+3.89B (+19.5%)')).toBeTruthy()
    // Date reads as its own calendar day (no TZ shift)
    expect(screen.getByText(/Mar 18, 2026/)).toBeTruthy()
  })

  it('hides the Revenue section when revenue is absent (Finnhub fallback)', () => {
    const epsOnly = { ...MU, revenue_actual: null, revenue_estimate: null, revenue_surprise_pct: null }
    render(<EarningsMarkerPopover data={epsOnly} x={0} y={0} sym="AAPL" onClose={() => {}} />)
    expect(screen.getByText('EPS')).toBeTruthy()
    expect(screen.queryByText('Revenue')).toBeNull()
  })

  it('colors a POSITIVE surprise with the beat color (regression: was always red)', () => {
    render(<EarningsMarkerPopover data={MU} x={0} y={0} sym="MU" beatColor="#00ff00" missColor="#ff0000" onClose={() => {}} />)
    const surprise = screen.getByText('+3.01 (+32.8%)')
    expect(surprise.style.color).toBe('rgb(0, 255, 0)')   // beat color, not red
  })

  it('colors a NEGATIVE surprise with the miss color + formats it', () => {
    const miss = { date: '2026-01-10', beat: false, eps_actual: 1.0, eps_estimate: 1.5, eps_surprise_pct: -33.3, revenue_actual: null }
    render(<EarningsMarkerPopover data={miss} x={0} y={0} sym="XYZ" beatColor="#00ff00" missColor="#ff0000" onClose={() => {}} />)
    const surprise = screen.getByText('-0.50 (-33.3%)')
    expect(surprise.style.color).toBe('rgb(255, 0, 0)')   // miss color
  })

  it('Escape and the ✕ button both close it', () => {
    const onClose = vi.fn()
    render(<EarningsMarkerPopover data={MU} x={0} y={0} sym="MU" onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
