// The wire stamp on the exposure tile.
//
// 🔴 THE MEASUREMENT THIS CLOSES. On 2026-08-14 the 06:35 wire run crashed
// before pushing. The dashboard served the prior day's UCT Exposure Rating all
// day, and a stale 55 rendered pixel-identically to a fresh 55 — nothing on the
// tile, and nothing in the payload behind it, carried a date. The owner spotted
// the number looked wrong; no surface could confirm or deny it.
//
// ⛔ The load-bearing case is the STALE one. A stamp that only ever renders the
// happy path is decoration, so the stale assertion below is the reason this file
// exists — and `unknown` must NOT masquerade as stale.

import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import MarketBreadth from './MarketBreadth'

// useLiveBreadth is a NAMED export; useMobileSWR is default. Mocking the wrong
// shape renders the real hook and the whole tile throws before any assertion.
// The tile reads `live.row?.…`, so the hook must return an OBJECT — returning
// null renders the real crash, not the tile.
vi.mock('../../hooks/useLiveBreadth', () => ({ useLiveBreadth: () => ({ row: null }) }))
vi.mock('../../hooks/useMobileSWR', () => ({ default: () => ({ data: undefined }) }))

const base = {
  exposure: { score: 55, score_delta: 0, note: '', bonus: 0 },
  market_phase: 'Confirmed Uptrend',
}

describe('exposure tile wire stamp', () => {
  it('renders the wire date when the run is fresh', () => {
    render(<MarketBreadth data={{ ...base, wire_date: '2026-08-14', wire_status: 'fresh' }} />)
    expect(screen.getByText(/Wire 2026-08-14/)).toBeInTheDocument()
    expect(screen.queryByText(/not today/i)).not.toBeInTheDocument()
  })

  it('SAYS SO when a run was missed — the case the whole change exists for', () => {
    render(<MarketBreadth data={{ ...base, wire_date: '2026-08-13', wire_status: 'stale' }} />)
    expect(screen.getByText(/Wire 2026-08-13/)).toBeInTheDocument()
    expect(screen.getByText(/not today/i)).toBeInTheDocument()
  })

  it('does not claim staleness it cannot support (unknown date)', () => {
    render(<MarketBreadth data={{ ...base, wire_date: null, wire_status: 'unknown' }} />)
    expect(screen.queryByText(/^Wire /)).not.toBeInTheDocument()
    expect(screen.queryByText(/not today/i)).not.toBeInTheDocument()
  })

  it('still renders the rating itself in every case (the stamp is additive)', () => {
    render(<MarketBreadth data={{ ...base, wire_date: '2026-08-13', wire_status: 'stale' }} />)
    expect(screen.getByText('55')).toBeInTheDocument()
  })
})
