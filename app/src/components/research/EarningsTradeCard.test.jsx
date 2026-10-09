// The earnings-trade card (wave 3 lane 13, product item #8): one plain sentence comparing the
// options-implied move with the stock's real past reactions. Its numbers must be the numbers it was
// handed (the table below it in ERX, the enrichment in the CAL/ERN modal), and with one side
// missing it must say so instead of inventing a comparison.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SWRConfig } from 'swr'
import EarningsTradeCard, { EarningsTradeCardForSym, earningsTradeRead } from './EarningsTradeCard'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

// NVDA: 8 reports, |moves| average 5.4, three of them above a 7.1% implied move.
const MOVES = [8.1, -3.2, 9.0, -2.1, 4.0, -7.5, 3.3, -6.0]

describe('earningsTradeRead', () => {
  it('states both sides and how often the stock beat today\'s implied move', () => {
    const r = earningsTradeRead({ sym: 'nvda', impliedPct: 7.1, moves: MOVES })
    expect(r.sentence).toBe(
      "Options price a ±7.1% move; NVDA has moved ±5.4% on average over its last 8 reports (more than today's implied move 3 of 8 times).")
    // the numbers are the inputs' own: avg of |moves|, count of |m| > implied
    expect(r.avg).toBeCloseTo(MOVES.reduce((a, m) => a + Math.abs(m), 0) / 8, 6)
    expect(r.bigger).toBe(MOVES.filter((m) => Math.abs(m) > 7.1).length)
    expect(r.lean).toBe('The options now price MORE than it has usually moved.')
  })

  it('skips gaps in the history rather than counting them as reports', () => {
    const r = earningsTradeRead({ sym: 'AMD', impliedPct: 5, moves: [6, null, -4, undefined, ''] })
    expect(r.n).toBe(2)
    expect(r.sentence).toContain('over its last 2 reports (more than today\'s implied move 1 of 2 times)')
  })

  it('no implied move: says "no options read yet", never a made-up comparison', () => {
    const r = earningsTradeRead({ sym: 'NVDA', impliedPct: null, moves: MOVES })
    expect(r.sentence).toBe("No options read yet for NVDA's next report; it has moved ±5.4% on average over its last 8 reports.")
    expect(r.bigger).toBeNull()
  })

  it('no history: says none are on file', () => {
    expect(earningsTradeRead({ sym: 'NVDA', impliedPct: 7.1, moves: [] }).sentence)
      .toBe("Options price a ±7.1% move for NVDA's next report; no past earnings reactions are on file to compare it with.")
  })

  it('nothing to compare: no card at all', () => {
    expect(earningsTradeRead({ sym: 'NVDA', impliedPct: null, moves: null })).toBeNull()
    render(<EarningsTradeCard sym="NVDA" />)
    expect(screen.queryByTestId('earnings-trade-card')).toBeNull()
  })

  it('one report reads in the singular', () => {
    expect(earningsTradeRead({ sym: 'X', impliedPct: 3, moves: [5] }).sentence)
      .toContain('over its last report (more than today\'s implied move 1 of 1 time)')
  })
})

describe('EarningsTradeCardForSym (EE)', () => {
  it('reads the implied move without the grade fan-out and the past reactions from ERX', async () => {
    const urls = []
    vi.stubGlobal('fetch', vi.fn((url) => {
      urls.push(String(url))
      const body = String(url).includes('/expected-move/') ? { live: { pct: 7.1 } }
        : { state: 'ok', quarters: MOVES.map((m) => ({ reaction_pct: m })) }
      return Promise.resolve({ ok: true, status: 200, json: async () => body, headers: new Headers() })
    }))
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <EarningsTradeCardForSym sym="nvda" />
      </SWRConfig>,
    )
    const card = await screen.findByText(/Options price a ±7\.1% move; NVDA has moved ±5\.4%/)
    expect(card).toBeInTheDocument()
    expect(urls).toContain('/api/research/expected-move/NVDA?grade=0')
    expect(urls).toContain('/api/research/earnings-reaction/NVDA')
  })

  it('a switched-off ERX read leaves the history side out, honestly', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (String(url).includes('/earnings-reaction/')) return Promise.resolve({ ok: false, status: 404, json: async () => ({}), headers: new Headers() })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ live: { pct: 4.2 } }), headers: new Headers() })
    }))
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <EarningsTradeCardForSym sym="AMD" />
      </SWRConfig>,
    )
    expect(await screen.findByText(/Options price a ±4\.2% move for AMD's next report; no past earnings reactions are on file/)).toBeInTheDocument()
  })
})

describe('mounted in ERX', () => {
  it('opens with the sentence, and its numbers match the table below it', async () => {
    const { default: EarningsReactionPanel } = await import('../../pages/research/depth/EarningsReactionPanel')
    const quarters = [
      { quarter: 'FY26 Q1', report_date: '2025-05-28', session: '2025-05-29', reaction_pct: 3.25, drift_state: 'measured' },
      { quarter: 'FY26 Q2', report_date: '2025-08-27', session: '2025-08-28', reaction_pct: -0.8, drift_state: 'pending' },
    ]
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({
      state: 'ok', ticker: 'NVDA', source: 'UCT daily bar store', quarters, summary: {},
      implied_move: { state: 'ok', pct: 6.8, dollar: 12.4, expiry: '2026-11-21', strike: 182.5, call_mark: 6.3, put_mark: 6.1, read_at: 1790000000 },
    }) })))
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <EarningsReactionPanel sym="nvda" />
      </SWRConfig>,
    )
    const card = await screen.findByTestId('earnings-trade-card')
    // (3.25 + 0.8) / 2 = 2.025 -> ±2.0%; neither past move beat 6.8%
    expect(card.textContent).toContain(
      "Options price a ±6.8% move; NVDA has moved ±2.0% on average over its last 2 reports (more than today's implied move 0 of 2 times).")
    expect(screen.getAllByTestId('earnings-reaction-row')[0].textContent).toContain('+3.25%')
  })
})
