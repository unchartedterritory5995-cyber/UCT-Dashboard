// Audit 2026-10-08 (lane A): a bad ticker (the routes' 400) is said in the server's sentence, never
// as "undefined" fields or "not available right now"; ERX's implied-move read time is ET, not UTC.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import DepthTab from './DepthTab'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const renderTab = (flags) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <DepthTab sym="$$" flags={flags} />
  </SWRConfig>,
)

const answer400 = () => {
  global.fetch = vi.fn(() => Promise.resolve({
    ok: false, status: 400, json: () => Promise.resolve({ detail: "'$$' is not a ticker symbol" }),
  }))
}

describe('Depth panels: a request that names no ticker', () => {
  for (const [flag, panelId] of [
    ['events_timeline_enabled', 'events-panel'],
    ['broker_estimates_enabled', 'broker-panel'],
    ['mention_series_enabled', 'mentions-panel'],
    ['earnings_reaction_panel_enabled', 'earnings-reaction-panel'],
  ]) {
    it(`${panelId} says the server's sentence and nothing reads "undefined"`, async () => {
      answer400()
      renderTab({ [flag]: true })
      const note = await screen.findByTestId('depth-bad-request')
      expect(note.textContent).toBe("'$$' is not a ticker symbol.")
      const panel = screen.getByTestId(panelId)
      expect(panel.textContent).not.toMatch(/undefined/)
      expect(panel.textContent).not.toMatch(/not available right now/)
      expect(panel.textContent).not.toMatch(/Offsets are counted in/)
    })
  }
})

describe('ERX implied move', () => {
  it('names its read time in ET, never UTC', async () => {
    const body = {
      state: 'ok', ticker: 'NVDA', bars_through: '2026-10-01', source: 'UCT daily bar store', next_report_date: '2026-11-19',
      quarters: [{ quarter: 'FY26 Q1', report_date: '2025-05-28', session: '2025-05-29', run_in_pct: 1, gap_pct: 1, reaction_pct: 1, drift_pct: 1, drift_state: 'measured' }],
      summary: {},
      implied_move: { state: 'ok', pct: 6.8, dollar: 12.4, expiry: '2026-11-21', strike: 182.5, call_mark: 6.3, put_mark: 6.1, read_at: 1790000000 },
    }
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }))
    renderTab({ earnings_reaction_panel_enabled: true })
    const t = (await screen.findByTestId('implied-move')).textContent
    // 1790000000 = 2026-09-21 14:13:20 UTC = 10:13:20 AM ET
    expect(t).toContain('9/21/2026, 10:13:20 AM ET')
    expect(t).not.toContain('UTC')
  })
})
