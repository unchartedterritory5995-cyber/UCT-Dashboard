// TERM-041 (FB-A11-02) — Portfolio Risk renders the regime's PUBLISHED words.
//
// The server sends `regime` (the closed-enum id) and `regime_label` (the
// authority's display for it, `voice_regime_classifier.label_of`). The page
// must render the words, asserted as RENDERED TEXT — never the raw id a member
// cannot read ("bull_trend"). The id is shown only when talking to a server
// that predates `regime_label`, so a rollout skew degrades to today's page
// rather than to a blank stat.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

let payload = null
vi.mock('../hooks/useMobileSWR', () => ({
  default: () => ({ data: payload, error: undefined }),
}))

import PortfolioHeat from './PortfolioHeat'

const base = {
  ok: true, risk_heat_pct: 2, notional_exposure_pct: 40, per_position: [],
  by_sector: [], concentration_flags: [], caps: { aggregate_pct: 10 },
  room_to_add_pct: 8, account_size_is_default: false,
}

describe('Portfolio Risk regime stat', () => {
  beforeEach(() => { payload = null })

  it('renders the published words, not the raw id', () => {
    payload = { ...base, regime: 'bull_trend', regime_label: 'Bull trend' }
    render(<PortfolioHeat />)
    expect(screen.getByText('Bull trend')).toBeTruthy()
    expect(screen.queryByText('bull_trend')).toBeNull()
  })

  it('falls back to the id only for a server that sends no regime_label', () => {
    payload = { ...base, regime: 'chop' }
    render(<PortfolioHeat />)
    expect(screen.getByText('chop')).toBeTruthy()
  })

  it('renders no regime stat when there is no regime (control)', () => {
    payload = { ...base, regime: null, regime_label: null }
    render(<PortfolioHeat />)
    expect(screen.queryByText('Regime')).toBeNull()
  })
})
