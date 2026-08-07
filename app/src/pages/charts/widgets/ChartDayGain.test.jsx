import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../hooks/useRealtimePrices', () => ({ default: vi.fn() }))
vi.mock('../../../hooks/useRealtimeBarPrices', () => ({
  default: vi.fn(() => ({})),
  pickFreshPrice: (a, b) => a?.price ?? b?.price ?? null,
}))
vi.mock('../WorkspaceContext', () => ({ useWorkspace: () => ({ chartsTheme: 'dark' }) }))

import useRealtimePrices from '../../../hooks/useRealtimePrices'
import ChartDayGain from './ChartDayGain'

describe('ChartDayGain', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the feed change_pct, not (live − prevClose) which reads 0.00% on weekends', () => {
    // Weekend: the streamed live price sits AT the prev close → (live − prevClose)
    // would be 0.00%. The feed's server-computed change_pct is the real move.
    useRealtimePrices.mockReturnValue({
      prices: { ORKA: { price: 83.04, prev_close: 83.04, change_pct: 11.75, change: 9.66 } },
    })
    render(<ChartDayGain sym="ORKA" />)
    expect(screen.getByText(/\+9\.66 \(\+11\.75%\)/)).toBeInTheDocument()
  })

  it('falls back to (live − prevClose) when the feed has no change_pct', () => {
    useRealtimePrices.mockReturnValue({
      prices: { ORKA: { price: 92.70, prev_close: 83.04 } },
    })
    render(<ChartDayGain sym="ORKA" />)
    expect(screen.getByText(/\+9\.66 \(\+11\.63%\)/)).toBeInTheDocument()
  })

  it('pre-market: regular number FREEZES at the last session change, ignoring the live pre-market move', () => {
    // change_pct here is the LIVE pre-market move (Massive's day aggregate has rolled
    // to the new date) — the regular readout must IGNORE it and show prev_change_pct,
    // the last completed regular session's change. Ext box = ext_price (250) vs
    // prev_close (200) = +25%.
    useRealtimePrices.mockReturnValue({
      prices: { DDOG: {
        price: 200, prev_close: 200, ext_price: 250, ext_session: 'pre_market',
        change_pct: 5.0, prev_change: -4.5, prev_change_pct: -2.2,
      } },
    })
    render(<ChartDayGain sym="DDOG" />)
    expect(screen.getByText(/-4\.50 \(-2\.20%\)/)).toBeInTheDocument()   // last session, NOT +5%
    expect(screen.getByText('Pre')).toBeInTheDocument()
    expect(screen.getByText(/\+50\.00 \(\+25\.00%\)/)).toBeInTheDocument() // ext box
  })

  it('after-hours: regular number is today\'s frozen change; a Post box shows the after-hours move vs the 4pm close', () => {
    useRealtimePrices.mockReturnValue({
      prices: { DDOG: {
        price: 220, prev_close: 200, day_close: 220, ext_price: 209,
        ext_session: 'post_market', change_pct: 10, change: 20,
      } },
    })
    render(<ChartDayGain sym="DDOG" />)
    expect(screen.getByText(/\+20\.00 \(\+10\.00%\)/)).toBeInTheDocument()  // regular (frozen)
    expect(screen.getByText('Post')).toBeInTheDocument()
    expect(screen.getByText(/-11\.00 \(-5\.00%\)/)).toBeInTheDocument()     // ext box: 209 vs 220
  })

  it('regular hours: no extended-hours box', () => {
    useRealtimePrices.mockReturnValue({
      prices: { DDOG: { price: 210, prev_close: 200, change_pct: 5, change: 10, ext_session: null } },
    })
    render(<ChartDayGain sym="DDOG" />)
    expect(screen.getByText(/\+10\.00 \(\+5\.00%\)/)).toBeInTheDocument()
    expect(screen.queryByText('Pre')).toBeNull()
    expect(screen.queryByText('AH')).toBeNull()
  })
})
