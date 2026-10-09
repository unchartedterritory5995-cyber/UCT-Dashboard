// FT-080 — the room attention panel, asserted on rendered text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import DepthTab from './DepthTab'

const OK = {
  ticker: 'AAPL', state: 'ok', source: '#main-chat ticker-mention store (buzz.db)',
  polarity: { state: 'unavailable', reason: 'the mention store keeps no message text by design, so a positive/negative ratio cannot be computed from it' },
  window: { from: '2026-09-19', through: '2026-09-27', store_from: '2026-09-21', timezone: 'America/New_York' },
  points: [
    { date: '2026-09-21', state: 'ok', mentions: 0, people: 0, room_mentions: 1, share_pct: 0 },
    { date: '2026-09-22', state: 'ok', mentions: 3, people: 2, room_mentions: 10, share_pct: 30 },
    { date: '2026-09-26', state: 'room_silent', mentions: null, people: null, room_mentions: 0, share_pct: null },
  ],
  summary: { days_measured: 2, mentions_total: 3, last7_avg_mentions: 1.5, prior30_avg_mentions: null,
    last7_avg_share_pct: 15, prior30_avg_share_pct: null, last7_days: 2, prior30_days: 0 },
}
let body
beforeEach(() => {
  body = OK
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const renderTab = (flags = { mention_series_enabled: true }) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <DepthTab sym="aapl" flags={flags} />
  </SWRConfig>,
)

describe('MentionSeriesPanel', () => {
  it('is not rendered when its flag is off', () => {
    renderTab({})
    expect(screen.queryByTestId('mentions-panel')).not.toBeInTheDocument()
  })

  it('a silent room is a dash with its reason, never 0; a real zero is 0', async () => {
    renderTab()
    const rows = await screen.findAllByTestId('mentions-row')
    expect(rows[0].textContent).toContain('room silent')
    expect(rows[0].textContent).not.toMatch(/\b0%/)
    expect(rows[2].textContent).toContain('0%')
  })

  it('states the share of the room and refuses polarity with the reason', async () => {
    renderTab()
    expect((await screen.findByTestId('mentions-summary')).textContent).toContain('(15% of the room)')
    expect(screen.getByTestId('mentions-polarity').textContent).toMatch(/keeps no message text/)
  })
})

// 2026-10-07 completeness audit: a failed read is drawn as an error with a working Retry, never as
// an empty or "nothing reported" state.
describe('MentionSeriesPanel — a failed read', () => {
  it('a 503 reads as unavailable with Retry, and Retry reads again', async () => {
    const good = body
    let calls = 0
    global.fetch = vi.fn(() => {
      calls += 1
      return calls === 1
        ? Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ detail: 'down' }) })
        : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(good) })
    })
    renderTab()
    const err = await screen.findByTestId('mentions-unavailable')
    expect(err.textContent).toMatch(/unavailable right now/)
    expect(screen.queryByTestId('mentions-state')).toBeNull()
    expect(screen.queryByTestId('mentions-none-measured')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findAllByTestId('mentions-summary')).not.toHaveLength(0)
    expect(screen.queryByTestId('mentions-unavailable')).toBeNull()
  })

  it('a non-ok state with no reason still reads as a sentence, never a blank note', async () => {
    body = { state: 'unavailable' }
    renderTab()
    expect((await screen.findByTestId('mentions-state')).textContent).toMatch(/not available right now/)
  })
})

// Audit 2026-10-08 (lane A): with no earlier measured day the summary says so in words.
describe('MentionSeriesPanel with no earlier window', () => {
  it('never reads "the 0 before: — a day"', async () => {
    renderTab()
    const t = (await screen.findByTestId('mentions-summary')).textContent
    expect(t).not.toMatch(/the 0 before/)
    expect(t).toContain('Last 2 measured days: 1.5 mentions a day (15% of the room); no earlier measured day to compare with yet.')
  })
})

describe('MentionSeriesPanel in a terminal panel (wave 3 #3)', () => {
  it('a day with mentions opens the name\'s news (CN) beside the panel; a zero or silent day does not', async () => {
    const { PanelListContext } = await import('../../../components/terminal')
    const { default: MentionSeriesPanel } = await import('./MentionSeriesPanel')
    const api = { open: vi.fn() }
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <PanelListContext.Provider value={api}><MentionSeriesPanel sym="aapl" /></PanelListContext.Provider>
      </SWRConfig>,
    )
    const day = await screen.findByRole('button', { name: /AAPL company news for the 2026-09-22 spike/ })
    fireEvent.click(day)
    expect(api.open).toHaveBeenCalledWith('AAPL CN')
    expect(screen.getAllByRole('button', { name: /company news/ })).toHaveLength(1)
  })
})
