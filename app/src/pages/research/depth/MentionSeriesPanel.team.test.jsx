// ATTN's trader-archive overlay: the trading team's own posts per day beside the room's.
// Drawn only when the archive answers; a day past the archive's reach is a dash, never 0.
// Synthetic data only: the repo is public.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

import DepthTab from './DepthTab'
import { teamPostsOn } from './MentionSeriesPanel'

const ROOM = {
  ticker: 'ZZTA', state: 'ok', source: '#main-chat ticker-mention store (buzz.db)',
  polarity: { state: 'unavailable', reason: 'not switched on' },
  window: { from: '2026-09-19', through: '2026-09-27', store_from: '2026-09-19', timezone: 'America/New_York' },
  points: [
    { date: '2026-09-21', state: 'ok', mentions: 2, people: 2, room_mentions: 10, share_pct: 20 },
    { date: '2026-09-22', state: 'ok', mentions: 3, people: 2, room_mentions: 10, share_pct: 30 },
    { date: '2026-09-23', state: 'ok', mentions: 1, people: 1, room_mentions: 10, share_pct: 10 },
  ],
  summary: { days_measured: 3, mentions_total: 6, last7_avg_mentions: 2, prior30_avg_mentions: null,
    last7_avg_share_pct: 20, prior30_avg_share_pct: null, last7_days: 3, prior30_days: 0 },
}
const TEAM = { ticker: 'ZZTA', archive_through: '2026-09-22', days: [{ date: '2026-09-22', posts: 4, calls: 1 }] }

const ok = (body) => ({ ok: true, status: 200, json: () => Promise.resolve(body) })
const fail = (status) => ({ ok: false, status, json: () => Promise.resolve({}), text: () => Promise.resolve('{}') })

function mockFetch(team) {
  global.fetch = vi.fn((url) => Promise.resolve(String(url).includes('/api/wisdom/archive/') ? team : ok(ROOM)))
}
const renderTab = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <DepthTab sym="zzta" flags={{ mention_series_enabled: true }} />
  </SWRConfig>,
)

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('teamPostsOn', () => {
  it('is the day\'s posts, 0 on a quiet archived day, and null past the archive\'s reach', () => {
    expect(teamPostsOn(TEAM, '2026-09-22')).toBe(4)
    expect(teamPostsOn(TEAM, '2026-09-21')).toBe(0)
    expect(teamPostsOn(TEAM, '2026-09-23')).toBeNull()
    expect(teamPostsOn(null, '2026-09-22')).toBeNull()
  })
})

describe('MentionSeriesPanel — the team overlay', () => {
  it('adds a Team posts column with counts, zeros and dashes in the right places', async () => {
    mockFetch(ok(TEAM))
    renderTab()
    expect(await screen.findByText('Team posts')).toBeInTheDocument()
    const cells = (await screen.findAllByTestId('mentions-team')).map((c) => c.textContent)
    expect(cells).toEqual(['—', '4', '0'])                                    // newest first: 23rd, 22nd, 21st
    expect(screen.getByTestId('mentions-team-note').textContent).toMatch(/on 1 of these 3 days/)
    expect(screen.getByTestId('mentions-team-note').textContent).toMatch(/runs through 2026-09-22/)
  })

  it.each([[fail(404)], [fail(500)], [ok({ paywalled: true })]])('leaves the room table untouched when the archive does not answer (%#)', async (team) => {
    mockFetch(team)
    renderTab()
    await screen.findAllByTestId('mentions-row')
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText('Team posts')).toBeNull()
    expect(screen.queryByTestId('mentions-team')).toBeNull()
  })
})
