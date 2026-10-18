// Team history panel: renders the archive's calls and mentions for a ticker, and renders NOTHING
// (and fetches nothing) while the flag is off or for an unpaid viewer. Synthetic data only: the
// repo is public.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { AuthContext } from '../../../context/AuthContext'
import TeamHistoryPanel, { FIRST_ROWS, outcomeParts, teamHistoryKey } from './TeamHistoryPanel'

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
const fail = (status) => ({ ok: false, status, json: async () => ({ detail: 'x' }), text: async () => '{"detail":"x"}' })

const AGED = {
  kind: 'call', id: 't9301#0', record_id: 't9301', date: '2025-01-02', trader: 'TSDR',
  setup: 'flag_htf', setup_name: 'Flag / HTF', action: 'entry', direction: 'long',
  outcome_status: 'scored', outcome: { r5: 0.031, r20: -0.124 }, moment: { url: '/desk?video=7&t=754', label: 'Synthetic session' },
}
const RECENT = {
  kind: 'call', id: 't9302#0', record_id: 't9302', date: '2026-10-14', trader: 'Bracco',
  setup: 'pullback_ma', setup_name: null, action: 'idea', direction: 'long',
  outcome_status: 'pending', outcome: null, moment: null,
}
const MENTION = {
  kind: 'mention', id: 't9303', record_id: 't9303', date: '2025-06-10', trader: 'Manrav', record_type: 'MACRO',
  setup: null, setup_name: null, action: null, direction: null, outcome_status: null, outcome: null, moment: null,
}
const BODY = { ticker: 'ZZTH', age_sessions: 20, n_calls: 2, n_mentions: 1, n_scored: 1, n_pending: 1, rows: [RECENT, MENTION, AGED] }

const PAID_ON = { isPaid: true, wisdomTickerHistoryEnabled: true }

function mockFetch(respond) {
  globalThis.fetch = vi.fn((url) => Promise.resolve(respond(String(url))))
}

const fresh = (ui, auth = PAID_ON) => render(
  <AuthContext.Provider value={auth}>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>
  </AuthContext.Provider>,
)

afterEach(() => { vi.restoreAllMocks() })

describe('TeamHistoryPanel', () => {
  it('renders every row with trader, setup, action and the aged outcome as text', async () => {
    mockFetch(() => ok(BODY))
    fresh(<TeamHistoryPanel sym="zzth" />)
    expect(await screen.findByText('Team history')).toBeInTheDocument()
    expect(screen.getByTestId('team-history-summary').textContent).toBe('2 calls · 1 mention · 1 scored')
    const rows = screen.getAllByTestId('team-history-row').map((r) => r.textContent)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain('2026-10-14')
    expect(rows[0]).toContain('Bracco')
    expect(rows[0]).toContain('Pullback ma · idea · long')
    expect(rows[1]).toContain('Mentioned (macro post)')
    expect(rows[2]).toContain('Flag / HTF · entry · long')
    expect(rows[2]).toContain('5d +3.1%')
    expect(rows[2]).toContain('20d -12.4%')
    expect(String(globalThis.fetch.mock.calls[0][0])).toContain('/api/wisdom/archive/ticker/ZZTH/team-history')
  })

  it('shows "outcome pending" for a recent call and never a number the server withheld', async () => {
    mockFetch(() => ok(BODY))
    fresh(<TeamHistoryPanel sym="ZZTH" />)
    const recent = (await screen.findAllByTestId('team-history-row'))[0]
    expect(recent.textContent).toContain('Outcome pending: under 20 sessions old')
    expect(recent.textContent).not.toMatch(/[+-]\d+\.\d%/)
    expect(screen.getAllByTestId('team-history-outcome')).toHaveLength(1)   // only the aged call
    expect(screen.getByText(/more than 20 sessions old/)).toBeInTheDocument()
  })

  it('links the session moment only when the server sent one', async () => {
    mockFetch(() => ok(BODY))
    fresh(<TeamHistoryPanel sym="ZZTH" />)
    const links = await screen.findAllByTestId('team-history-moment')
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('/desk?video=7&t=754')
    expect(links[0].textContent).toBe('Watch the moment')
  })

  it.each([
    ['flag off', { isPaid: true, wisdomTickerHistoryEnabled: false }],
    ['unpaid', { isPaid: false, wisdomTickerHistoryEnabled: true }],
    ['no auth provider', null],
  ])('renders nothing and fetches nothing when %s', async (_label, auth) => {
    mockFetch(() => ok(BODY))
    const { container } = fresh(<TeamHistoryPanel sym="ZZTH" />, auth)
    await new Promise((r) => setTimeout(r, 20))
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(container.innerHTML).toBe('')
  })

  it.each([[404], [402], [500]])('renders nothing when the server answers %s', async (status) => {
    mockFetch(() => fail(status))
    const { container } = fresh(<TeamHistoryPanel sym="ZZTH" />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(container.innerHTML).toBe('')
  })

  it('says the team has no posts only from a real, empty answer', async () => {
    mockFetch(() => ok({ ticker: 'ZZNO', age_sessions: 20, n_calls: 0, n_mentions: 0, n_scored: 0, rows: [] }))
    fresh(<TeamHistoryPanel sym="ZZNO" />)
    expect((await screen.findByTestId('team-history-empty')).textContent).toBe('The team has no archived posts about ZZNO.')
  })

  it('caps the list and expands on request', async () => {
    const many = Array.from({ length: FIRST_ROWS + 3 }, (_, i) => ({ ...MENTION, id: `t95${String(i).padStart(2, '0')}` }))
    mockFetch(() => ok({ ...BODY, n_calls: 0, n_mentions: many.length, n_scored: 0, rows: many }))
    fresh(<TeamHistoryPanel sym="ZZTH" />)
    expect(await screen.findAllByTestId('team-history-row')).toHaveLength(FIRST_ROWS)
    fireEvent.click(screen.getByRole('button', { name: `Show all ${many.length}` }))
    expect(screen.getAllByTestId('team-history-row')).toHaveLength(many.length)
  })
})

describe('outcomeParts / teamHistoryKey', () => {
  it('reads only what the server decided', () => {
    expect(outcomeParts(MENTION)).toBeNull()
    expect(outcomeParts(RECENT)).toEqual({ pending: true, text: 'Outcome pending: under 20 sessions old' })
    expect(outcomeParts({ ...AGED, outcome_status: 'unscored', outcome: null }).text).toBe('Not scored')
    expect(outcomeParts(AGED).parts.map((p) => p.label)).toEqual(['5d', '20d'])
  })

  it('builds one key per upper-cased symbol and none for a blank one', () => {
    expect(teamHistoryKey(' zzth ')).toBe('/api/wisdom/archive/ticker/ZZTH/team-history')
    expect(teamHistoryKey('')).toBeNull()
  })
})
