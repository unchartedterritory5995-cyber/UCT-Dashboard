// D-9 (UC-1) on the Morning Wire: which Top picks cards the member already follows.
// End to end through the REAL AuthProvider: the gate arrives on /api/auth/me as
// `member_interest_wire_enabled`, exactly as the server sends it (present only when on).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderWithProviders, screen, cleanup } from '../test-utils'
import { topPickSyms } from './setupFeedback'

const RUNDOWN = '<div class="rd-top-picks-grid">'
  + '<div class="rd-pick" data-sym="NVDA"><div class="rd-pick-header"><span class="rd-pick-sym">NVDA</span></div></div>'
  + '<div class="rd-pick"><div class="rd-pick-header"><span class="rd-pick-sym">aaoi</span></div></div>'
  + '<div class="rd-pick" data-sym="MSFT"></div>'
  + '</div><p data-testid="rundown-content">Test rundown</p>'

const { interestHolder } = vi.hoisted(() => ({ interestHolder: { requested: 0, data: null } }))
vi.mock('swr', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    default: vi.fn((key) => {
      if (key === '/api/rundown') return { data: { html: RUNDOWN, date: '2026-10-09' } }
      if (key === '/api/member/interest') { interestHolder.requested += 1; return { data: interestHolder.data } }
      return { data: null }
    }),
    useSWRConfig: () => ({ mutate: vi.fn() }),
  }
})

import MorningWire from './MorningWire'

let mePayload
beforeEach(() => {
  interestHolder.requested = 0
  interestHolder.data = { entities: { AAOI: { because: ['positions'] }, MSFT: { because: ['watchlist', 'uct20'] } } }
  mePayload = { user: { id: 'u1', role: 'user', email: 'm@x.test' }, plan: 'pro' }
  global.fetch = vi.fn((url) => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve(String(url).startsWith('/api/auth/me') ? mePayload : {}),
  }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('topPickSyms', () => {
  it('reads the cards’ tickers in card order with the feedback reader, without touching the page', () => {
    expect(topPickSyms(RUNDOWN)).toEqual(['NVDA', 'AAOI', 'MSFT'])
    expect(topPickSyms('<p>no board</p>')).toEqual([])
    expect(topPickSyms(null)).toEqual([])
  })
})

describe('MorningWire: member interest (D-9)', () => {
  it('gate absent from the auth payload: no line, and /api/member/interest is never asked', async () => {
    renderWithProviders(<MorningWire />)
    await screen.findByTestId('rundown-content')
    await new Promise((r) => setTimeout(r, 25))
    expect(screen.queryByTestId('member-interest-wire')).not.toBeInTheDocument()
    expect(interestHolder.requested).toBe(0)
  })

  it('gate on: names the followed Top picks in card order, with reasons', async () => {
    mePayload = { ...mePayload, member_interest_wire_enabled: true }
    renderWithProviders(<MorningWire />)
    const line = await screen.findByTestId('member-interest-wire')
    expect(line.textContent).toContain(
      "You follow 2 names in today's Top picks: AAOI (in your open Journal positions); MSFT (on your watchlists · on the UCT 20).",
    )
  })

  it('gate on, no pick followed: nothing renders', async () => {
    mePayload = { ...mePayload, member_interest_wire_enabled: true }
    interestHolder.data = { entities: { TSLA: { because: ['flagged'] } } }
    renderWithProviders(<MorningWire />)
    await vi.waitFor(() => expect(interestHolder.requested).toBeGreaterThan(0))
    expect(screen.queryByTestId('member-interest-wire')).not.toBeInTheDocument()
  })
})
