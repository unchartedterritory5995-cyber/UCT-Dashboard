// Quality pass 2026-10-05 — small copy defects on ATTN, ERX, ANR and POS, asserted on
// rendered text.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import MentionSeriesPanel from './MentionSeriesPanel'
import EarningsReactionPanel from './EarningsReactionPanel'
import PositioningPanel from '../../optionsAnalytics/PositioningPanel'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const wrap = (el) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{el}</SWRConfig>)
const serve = (body) => vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => body })))

describe('small copy defects', () => {
  it('ATTN: nothing measured says so instead of "Last 0 measured days: — mentions a day"', async () => {
    serve({ state: 'ok', summary: { days_measured: 0 }, points: [], window: { from: '2026-09-01', store_from: '2026-09-01' }, source: 's' })
    wrap(<MentionSeriesPanel sym="zzz" />)
    expect((await screen.findByTestId('mentions-none-measured')).textContent).toMatch(/No days of #main-chat have been measured for ZZZ/)
    expect(document.body.textContent).not.toMatch(/Last 0 measured days/)
  })

  it('ERX: EPS reads as dollars to two places', async () => {
    serve({ state: 'ok', ticker: 'NVDA', bars_through: '2026-10-01', source: 'UCT daily bar store',
      quarters: [{ quarter: 'FY26 Q1', report_date: '2025-05-28', session: '2025-05-29', run_in_pct: 1, gap_pct: 1,
        reaction_pct: 1, drift_pct: 1, drift_state: 'measured', eps_actual: 0.9612, eps_estimate: 0.9 }],
      summary: {}, implied_move: { state: 'none', reason: 'x' } })
    wrap(<EarningsReactionPanel sym="nvda" />)
    expect((await screen.findByTestId('earnings-reaction-row')).textContent).toContain('$0.96 vs $0.90')
  })

  it('POS: a 30-day interpolated ATM IV has no blank "on  (vendor)"', async () => {
    serve({ label: 'computed', method: 'Levels method.', vocabulary_version: 1, notes: [], levels: [],
      atm_iv: { value: 0.452, expiration: null } })
    wrap(<PositioningPanel sym="nvda" />)
    const t = (await screen.findByTestId('levels-atm-iv')).textContent
    expect(t).toBe('ATM IV 45.2% (30-day interpolated).')
    expect(document.body.textContent).not.toMatch(/Vocabulary v/)
  })
})
