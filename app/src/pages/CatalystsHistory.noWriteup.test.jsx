// Live sweep 2026-10-05: CATH showed "Synthesis temporarily unavailable…" as a catalyst. The
// server now sends thesis_text null + thesis_status for those rows; the table must say so in
// words rather than leave the cell blank, and must still render a real thesis.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../components/TickerPopup', () => ({ default: ({ sym }) => <span>{sym}</span> }))

import CatalystsHistory from './CatalystsHistory'
import { FAILED_SYNTHESIS_NOTE } from '../utils/highlightThesis'

afterEach(() => vi.restoreAllMocks())

describe('CATH: a failed write-up', () => {
  it('reads as "no write-up", and a real thesis still renders', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        market_date: '2026-10-02',
        rows: [
          { ticker: 'CBNK', rank: 1, tag: 'Catalyst', thesis_text: null, thesis_status: 'failed', gap_pct: -1, price: 40 },
          { ticker: 'XP', rank: 2, tag: 'Catalyst', thesis_text: 'Beat and raised guidance.', thesis_status: 'ok', gap_pct: 31, price: 28 },
        ],
      }),
    })
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter><CatalystsHistory /></MemoryRouter>
      </SWRConfig>,
    )
    expect(await screen.findByTestId('cath-no-writeup')).toHaveTextContent(FAILED_SYNTHESIS_NOTE)
    expect(screen.getByText(/Beat and raised guidance/)).toBeInTheDocument()
  })
})
