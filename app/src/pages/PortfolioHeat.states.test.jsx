// RISK: no false "Retrying…", a real Retry; null percentages read "—", never a bare "%";
// sides read as words (quality pass 2026-10-05).
import { describe, it, expect, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

let state
const mutate = vi.fn()
vi.mock('../hooks/useMobileSWR', () => ({ default: () => ({ ...state, mutate }) }))
import PortfolioHeat from './PortfolioHeat'

describe('Portfolio Risk states', () => {
  it('a failed read offers Retry and promises nothing', () => {
    state = { data: undefined, error: Object.assign(new Error('x'), { status: 503 }) }
    render(<PortfolioHeat />)
    expect(screen.getByRole('status').textContent).toMatch(/could not be read right now/)
    expect(screen.queryByText(/Retrying/)).toBeNull()
    screen.getByRole('button', { name: 'Retry' }).click()
    expect(mutate).toHaveBeenCalled()
    cleanup()
  })

  it('null percentages render a dash, and a long reads "Long"', () => {
    state = { data: { ok: true, risk_heat_pct: null, notional_exposure_pct: null, room_to_add_pct: null,
      per_position: [{ symbol: 'NVDA', side: 'long', dist_to_stop_pct: 4, risk_pct: 1, placeholder_stop: false }],
      by_sector: [], concentration_flags: [], caps: { aggregate_pct: 10 }, account_size_is_default: false }, error: undefined }
    render(<PortfolioHeat />)
    const t = document.body.textContent
    for (const label of ['Risk heat', 'Notional exposure', 'Room to add']) expect(t).toContain(`${label}—`)
    expect(t).not.toMatch(/—%|undefined%|NaN/)
    expect(screen.getByText('Long')).toBeInTheDocument()
  })
})
