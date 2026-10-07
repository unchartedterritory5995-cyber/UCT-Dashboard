// FT-005 — the earnings reaction panel, asserted on rendered text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import DepthTab from './DepthTab'

const stat = (n, avg, avgAbs, up) => ({ n, avg, avg_abs: avgAbs, median: avg, pct_up: up })
const OK = {
  state: 'ok', ticker: 'NVDA', bars_through: '2026-10-01', source: 'UCT daily bar store',
  next_report_date: '2026-11-19',
  quarters: [
    { quarter: 'FY26 Q1', report_date: '2025-05-28', session: '2025-05-29', run_in_pct: 2.1, gap_pct: 5.4,
      reaction_pct: 3.25, drift_pct: -1.2, drift_state: 'measured', eps_actual: 0.96, eps_estimate: 0.93 },
    { quarter: 'FY26 Q2', report_date: '2025-08-27', session: '2025-08-28', run_in_pct: -0.4, gap_pct: -2.0,
      reaction_pct: -0.8, drift_pct: null, drift_state: 'pending', eps_actual: 1.05, eps_estimate: 1.01 },
  ],
  summary: { run_in: stat(2, 0.85, 1.25, 50), gap: stat(2, 1.7, 3.7, 50), reaction: stat(2, 1.23, 2.03, 50), drift: stat(1, -1.2, 1.2, 0) },
  realized_vol: { annualized_pct: 41.3, sessions: 20, through: '2026-10-01' },
  implied_move: { state: 'ok', pct: 6.8, dollar: 12.4, expiry: '2026-11-21', strike: 182.5, call_mark: 6.3, put_mark: 6.1, read_at: 1790000000 },
}
let body
beforeEach(() => {
  body = OK
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const renderTab = (flags = { earnings_reaction_panel_enabled: true }) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <DepthTab sym="nvda" flags={flags} />
  </SWRConfig>,
)

describe('EarningsReactionPanel', () => {
  it('is not rendered when its flag is off', () => {
    renderTab({ filing_search_enabled: true })
    expect(screen.queryByTestId('earnings-reaction-panel')).not.toBeInTheDocument()
  })

  it('shows each quarter, and a drift that has not traded yet as pending, never 0', async () => {
    renderTab()
    const rows = await screen.findAllByTestId('earnings-reaction-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('+3.25%')
    expect(rows[1].textContent).toContain('pending')
    expect(rows[1].textContent).not.toContain('+0.00%')
  })

  it('every summary carries its n', async () => {
    renderTab()
    const s = (await screen.findByTestId('earnings-reaction-summary')).textContent
    expect(s).toContain('Reaction: avg +1.23%')
    expect(s).toContain('(n=1)')
  })

  it('the implied move names its straddle', async () => {
    renderTab()
    const t = (await screen.findByTestId('implied-move')).textContent
    expect(t).toContain('±6.8%')
    expect(t).toContain('2026-11-21 182.5 straddle')
    expect(t).toContain('call 6.30 + put 6.10')
  })

  it('a pending earnings history says so', async () => {
    body = { state: 'pending', reason: 'the earnings history is being read; this panel fills in by itself' }
    renderTab()
    expect((await screen.findByTestId('earnings-reaction-state')).textContent).toMatch(/being read/)
  })
})
