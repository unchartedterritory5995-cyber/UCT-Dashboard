// FT-080 polarity (owner ruling 2026-10-11) — the window selector, the bull/bear split and the
// sortable post list on the Room attention panel, asserted on rendered text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import MentionSeriesPanel from './MentionSeriesPanel'

const ROUTE = '/api/research/mention-series/NVDA/polarity'
const SERIES = {
  ticker: 'NVDA', state: 'ok', source: '#main-chat ticker-mention store',
  polarity: { state: 'available', auto_labelled: true, route: ROUTE, windows: ['1w', '1m', '3m'], method: 'm' },
  window: { from: '2026-10-04', through: '2026-10-10', store_from: '2026-09-01', timezone: 'America/New_York' },
  points: [{ date: '2026-10-09', state: 'ok', mentions: 4, people: 3, room_mentions: 40, share_pct: 10 }],
  summary: { days_measured: 1, mentions_total: 4, last7_avg_mentions: 4, prior30_avg_mentions: null,
    last7_avg_share_pct: 10, prior30_avg_share_pct: null, last7_days: 1, prior30_days: 0 },
}
const view = (over = {}) => ({
  ticker: 'NVDA', state: 'ok', auto_labelled: true, window_key: '1m', sort: 'newest', label_filter: 'all',
  retention_days: 90, method: 'auto-labelled by a word-and-emoji rule; treat any single label as a guess',
  window: { from: '2026-09-11', through: '2026-10-10', covered_from: '2026-09-20', timezone: 'America/New_York' },
  days: [
    { date: '2026-09-19', state: 'not_covered', bullish: null, bearish: null, neutral: null },
    { date: '2026-10-08', state: 'ok', bullish: 0, bearish: 1, neutral: 0 },
    { date: '2026-10-09', state: 'ok', bullish: 2, bearish: 1, neutral: 0 },
  ],
  totals: { bullish: 2, bearish: 2, neutral: 0, posts: 4, bull_share_pct: 50, by_source: { room: 3, x: 1 } },
  posts: [
    { source: 'room', id: 'r1', ts: 1, date: '2026-10-09', label: 'bullish', score: 0.8, text: '$NVDA calls loaded', text_state: 'kept', link: 'https://discord.com/channels/1/2/r1', author: null },
    { source: 'x', id: 't1', ts: 2, date: '2026-10-09', label: 'bearish', score: -0.6, text: null, text_state: 'x_window_passed', link: null, author: 'Benzinga' },
  ],
  posts_matching: 4,
  ...over,
})

let urls
let polarityBody
beforeEach(() => {
  urls = []
  polarityBody = view()
  global.fetch = vi.fn((u) => {
    urls.push(u)
    const body = String(u).includes('/polarity') ? polarityBody : SERIES
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const renderPanel = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <MentionSeriesPanel sym="nvda" />
  </SWRConfig>,
)

describe('SocialPolarity on the Room attention panel', () => {
  it('shows the split, labels it auto-labelled, and replaces the unavailable sentence', async () => {
    renderPanel()
    const sum = await screen.findByTestId('polarity-summary')
    expect(sum.textContent).toBe('Last month: 2 bullish, 2 bearish, 0 neutral of 4 posts (50% of the directional ones bullish).')
    expect(screen.getByTestId('polarity-method').textContent).toMatch(/^Auto-labelled: /)
    expect(screen.getByText('Bullish/bearish split (auto-labelled)')).toBeInTheDocument()
    expect(screen.getByTestId('polarity-split')).toHaveAttribute('aria-label', '2 bullish, 2 bearish')
    expect(screen.queryByTestId('mentions-polarity')).toBeNull()
  })

  it('a day before coverage is a dash with its reason, never 0, and the window says where it starts', async () => {
    renderPanel()
    const rows = await screen.findAllByTestId('polarity-day')
    expect(rows[0].textContent).toBe('2026-10-09210')
    expect(rows[2].textContent).toContain('— (not covered)')
    expect(screen.getByTestId('polarity-covered').textContent).toContain('kept 90 days, so this window covers 2026-09-20 onward')
  })

  it('the window buttons ask for 1W / 1M / 3M and mark the chosen one', async () => {
    renderPanel()
    await screen.findByTestId('polarity-summary')
    expect(urls.some((u) => u.startsWith(`${ROUTE}?window=1m&`))).toBe(true)
    const w = screen.getByRole('button', { name: '1W' })
    expect(w).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(w)
    await waitFor(() => expect(urls.some((u) => u.startsWith(`${ROUTE}?window=1w&`))).toBe(true))
    expect(screen.getByRole('button', { name: '1W' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '3M' }))
    await waitFor(() => expect(urls.some((u) => u.startsWith(`${ROUTE}?window=3m&`))).toBe(true))
  })

  it('sort and label filter go to the server', async () => {
    renderPanel()
    await screen.findByTestId('polarity-summary')
    fireEvent.change(screen.getByLabelText('Sort posts'), { target: { value: 'most_bearish' } })
    await waitFor(() => expect(urls.some((u) => u.includes('sort=most_bearish'))).toBe(true))
    fireEvent.change(screen.getByLabelText('Filter posts by label'), { target: { value: 'bullish' } })
    await waitFor(() => expect(urls.some((u) => u.includes('label=bullish'))).toBe(true))
  })

  it('a room post shows its text and link; an X post past the feed window says why it has no text', async () => {
    renderPanel()
    const posts = await screen.findAllByTestId('polarity-post')
    expect(posts[0].textContent).toContain('Bullish · 2026-10-09 · #main-chat$NVDA calls loaded')
    expect(posts[0].querySelector('a')).toHaveAttribute('href', 'https://discord.com/channels/1/2/r1')
    expect(posts[1].textContent).toContain('Bearish · 2026-10-09 · X @Benzinga')
    expect(posts[1].textContent).toContain('Text no longer held')
    expect(screen.getByTestId('polarity-count').textContent).toBe('2 of 4 shown')
  })

  it('no labelled posts yet reads as a sentence; a failed read offers Retry', async () => {
    polarityBody = { state: 'no_store', reason: 'no posts have been labelled yet' }
    renderPanel()
    expect((await screen.findByTestId('polarity-state')).textContent).toMatch(/No posts have been labelled yet/i)
    cleanup()
    global.fetch = vi.fn((u) => String(u).includes('/polarity')
      ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
      : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SERIES) }))
    renderPanel()
    expect((await screen.findByTestId('polarity-unavailable')).textContent).toMatch(/unavailable right now/)
  })

  it('an empty window says so instead of "0 bullish, 0 bearish"', async () => {
    polarityBody = view({ totals: { bullish: 0, bearish: 0, neutral: 0, posts: 0, bull_share_pct: null }, posts: [], posts_matching: 0, days: [] })
    renderPanel()
    expect((await screen.findByTestId('polarity-summary')).textContent).toBe('No labelled posts named NVDA in the last month.')
    expect(screen.queryByTestId('polarity-split')).toBeNull()
    expect(screen.getByTestId('polarity-no-posts')).toBeInTheDocument()
  })
})
