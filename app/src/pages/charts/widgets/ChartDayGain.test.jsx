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
})
