/* Uses the project's existing test convention (global.fetch), matching
   AiSearchWidget.test.jsx and the rest of the widget suites. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import DockNews from './DockNews'
import {
  dayLabel, descLines, emptyMessage, feedQuery, groupByDay, isBreaking,
  mediaKind, mergePage, relTime, sourceLabel,
} from './newsFeedModel'

const NOW = Date.parse('2026-09-07T21:00:00Z')

function story(over = {}) {
  return {
    id: over.id ?? 1,
    headline: over.headline ?? 'Micron raises fiscal Q4 revenue guidance on HBM demand',
    description: over.description ?? 'Company now expects $12.1–12.5B versus $11.4B prior.',
    source: over.source ?? 'Reuters',
    source_class: over.source_class ?? 'journalism',
    url: over.url ?? 'https://reuters.com/a',
    published_at: over.published_at ?? '2026-09-07T20:48:00Z',
    category: over.category ?? 'guidance',
    sentiment: over.sentiment ?? '',
    sentiment_reason: over.sentiment_reason ?? '',
    image_url: over.image_url ?? '',
    media_type: over.media_type ?? '',
    embed_url: over.embed_url ?? '',
    form_type: over.form_type ?? '',
    author: over.author ?? '',
    event_key: over.event_key ?? '',
    ...over,
  }
}

function mockFeed(pages) {
  let call = 0
  return vi.fn(async (url) => {
    if (String(url).includes('/related/')) {
      return { ok: true, json: async () => ({ items: [] }) }
    }
    const p = pages[Math.min(call, pages.length - 1)]
    call += 1
    return { ok: true, json: async () => p }
  })
}

// ===========================================================================
describe('newsFeedModel', () => {
  it('formats relative time in wire style', () => {
    expect(relTime('2026-09-07T20:59:30Z', NOW)).toBe('now')
    expect(relTime('2026-09-07T20:48:00Z', NOW)).toBe('12m')
    expect(relTime('2026-09-07T16:00:00Z', NOW)).toBe('5h')
    expect(relTime('2026-09-05T21:00:00Z', NOW)).toBe('2d')
    expect(relTime('bad', NOW)).toBe('')
    expect(relTime('', NOW)).toBe('')
  })

  it('labels days as Today / Yesterday / a date', () => {
    expect(dayLabel('2026-09-07T20:00:00Z', NOW)).toBe('Today')
    expect(dayLabel('2026-09-06T20:00:00Z', NOW)).toBe('Yesterday')
    expect(dayLabel('2026-09-02T20:00:00Z', NOW)).toMatch(/Sep/)
  })

  it('groups chronologically without reordering', () => {
    const items = [
      story({ id: 1, published_at: '2026-09-07T20:00:00Z' }),
      story({ id: 2, published_at: '2026-09-07T10:00:00Z' }),
      story({ id: 3, published_at: '2026-09-06T10:00:00Z' }),
    ]
    const g = groupByDay(items, NOW)
    expect(g.map(x => x.label)).toEqual(['Today', 'Yesterday'])
    expect(g[0].items.map(i => i.id)).toEqual([1, 2])
    expect(g[1].items.map(i => i.id)).toEqual([3])
  })

  it('names SEC filings by form and everything else by publisher', () => {
    expect(sourceLabel(story({ source_class: 'primary', form_type: '8-K', source: 'SEC' })))
      .toBe('SEC · 8-K')
    expect(sourceLabel(story({ source: 'Reuters' }))).toBe('Reuters')
  })

  it('marks BREAKING only when recent AND high-trust AND material', () => {
    const recent = '2026-09-07T20:48:00Z'
    expect(isBreaking(story({ published_at: recent, source_class: 'wire', category: 'guidance' }), NOW)).toBe(true)
    // too old
    expect(isBreaking(story({ published_at: '2026-09-07T18:00:00Z', source_class: 'wire', category: 'guidance' }), NOW)).toBe(false)
    // low-trust source
    expect(isBreaking(story({ published_at: recent, source_class: 'social', category: 'guidance' }), NOW)).toBe(false)
    // immaterial category
    expect(isBreaking(story({ published_at: recent, source_class: 'wire', category: 'other' }), NOW)).toBe(false)
  })

  it('merges pages without duplicating a story', () => {
    const a = [story({ id: 1 }), story({ id: 2 })]
    const b = [story({ id: 2 }), story({ id: 3 })]
    expect(mergePage(a, b).map(i => i.id)).toEqual([1, 2, 3])
  })

  it('classifies media', () => {
    expect(mediaKind(story({ image_url: 'x.jpg' }))).toBe('image')
    expect(mediaKind(story({ media_type: 'video', embed_url: 'https://x.com/1' }))).toBe('video')
    expect(mediaKind(story())).toBe('')
  })

  it('clamps description by panel width', () => {
    expect(descLines(300)).toBe(1)
    expect(descLines(360)).toBe(2)
    expect(descLines(700)).toBe(3)
  })

  it('builds the feed query', () => {
    expect(feedQuery({ limit: 25 })).toBe('limit=25')
    const q = feedQuery({ limit: 25, sentiment: 'bullish', q: 'HBM', cursor: 'abc' })
    expect(q).toContain('sentiment=bullish')
    expect(q).toContain('q=HBM')
    expect(q).toContain('cursor=abc')
    // 'all' is the default and must not be sent
    expect(feedQuery({ sentiment: 'all' })).not.toContain('sentiment')
  })

  it('states sparse results plainly rather than apologising', () => {
    expect(emptyMessage({ sym: 'MU', sentiment: 'all', query: '' }))
      .toBe('No recent high-quality news for MU.')
    expect(emptyMessage({ sym: 'MU', sentiment: 'all', query: 'HBM' })).toContain('HBM')
  })
})

// ===========================================================================
describe('DockNews', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders a feed with source, time, headline and description', async () => {
    global.fetch = mockFeed([{ items: [story()], next_cursor: null, has_more: false }])
    render(<DockNews sym="MU" />)
    expect(await screen.findByText(/Micron raises fiscal Q4/)).toBeInTheDocument()
    expect(screen.getByText('Reuters')).toBeInTheDocument()
    expect(screen.getByText('12m')).toBeInTheDocument()
    expect(screen.getByText(/12.1/)).toBeInTheDocument()
    expect(screen.getByText('Today')).toBeInTheDocument()
  })

  it('never calls a provider — only the UCT company-news endpoint', async () => {
    const f = mockFeed([{ items: [story()], next_cursor: null, has_more: false }])
    global.fetch = f
    render(<DockNews sym="MU" />)
    await screen.findByText(/Micron raises/)
    for (const call of f.mock.calls) {
      expect(String(call[0])).toMatch(/^\/api\/company-news\//)
    }
  })

  it('labels an SEC filing by its form', async () => {
    global.fetch = mockFeed([{
      items: [story({ source_class: 'primary', source: 'SEC', form_type: '8-K',
        headline: 'Micron files 8-K — Results of operations' })],
      next_cursor: null, has_more: false,
    }])
    render(<DockNews sym="MU" />)
    expect(await screen.findByText('SEC · 8-K')).toBeInTheDocument()
  })

  it('expands a story inline without navigating away', async () => {
    global.fetch = mockFeed([{
      items: [story({ author: 'Jane Doe' })], next_cursor: null, has_more: false,
    }])
    render(<DockNews sym="MU" />)
    const row = (await screen.findByText(/Micron raises/)).closest('button')
    expect(screen.queryByText('Published')).not.toBeInTheDocument()
    fireEvent.click(row)
    await waitFor(() => expect(screen.getByText('Published')).toBeInTheDocument())
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Read source/ })).toHaveAttribute(
      'href', 'https://reuters.com/a')
    expect(row).toHaveAttribute('aria-expanded', 'true')
  })

  it('uses View filing / View post wording per source class', async () => {
    global.fetch = mockFeed([{
      items: [story({ source_class: 'primary', form_type: '8-K' })],
      next_cursor: null, has_more: false,
    }])
    render(<DockNews sym="MU" />)
    fireEvent.click((await screen.findByText(/Micron raises/)).closest('button'))
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /View filing/ })).toBeInTheDocument())
  })

  it('closes an open row when another is opened', async () => {
    global.fetch = mockFeed([{
      items: [story({ id: 1 }), story({ id: 2, headline: 'Second story headline' })],
      next_cursor: null, has_more: false,
    }])
    render(<DockNews sym="MU" />)
    fireEvent.click((await screen.findByText(/Micron raises/)).closest('button'))
    await waitFor(() => expect(screen.getByText('Published')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Second story headline').closest('button'))
    await waitFor(() => expect(screen.getAllByText('Published')).toHaveLength(1))
  })

  it('filters bullish / bearish through the API, not the client', async () => {
    const f = mockFeed([
      { items: [story({ id: 1 })], next_cursor: null, has_more: false },
      { items: [story({ id: 2, sentiment: 'bullish' })], next_cursor: null, has_more: false },
    ])
    global.fetch = f
    render(<DockNews sym="MU" />)
    await screen.findByText(/Micron raises/)
    fireEvent.click(screen.getByRole('button', { name: 'Bullish' }))
    await waitFor(() =>
      expect(f.mock.calls.some(c => String(c[0]).includes('sentiment=bullish'))).toBe(true))
  })

  it('searches stored history server-side after debounce', async () => {
    const f = mockFeed([
      { items: [story()], next_cursor: null, has_more: false },
      { items: [story({ id: 9, headline: 'HBM capacity sold out' })], next_cursor: null, has_more: false },
    ])
    global.fetch = f
    render(<DockNews sym="MU" />)
    await screen.findByText(/Micron raises/)
    fireEvent.change(screen.getByLabelText('Search MU news'), { target: { value: 'HBM' } })
    await waitFor(() =>
      expect(f.mock.calls.some(c => String(c[0]).includes('q=HBM'))).toBe(true),
      { timeout: 2000 })
    expect(await screen.findByText(/result.*HBM/)).toBeInTheDocument()
  })

  it('pages with Load more and does not duplicate stories', async () => {
    const f = mockFeed([
      { items: [story({ id: 1 })], next_cursor: 'c1', has_more: true },
      { items: [story({ id: 2, headline: 'Older story headline' })], next_cursor: null, has_more: false },
    ])
    global.fetch = f
    render(<DockNews sym="MU" />)
    const more = await screen.findByRole('button', { name: /Load older/ })
    fireEvent.click(more)
    expect(await screen.findByText('Older story headline')).toBeInTheDocument()
    expect(screen.getAllByText(/Micron raises fiscal Q4/)).toHaveLength(1)
    expect(f.mock.calls.some(c => String(c[0]).includes('cursor=c1'))).toBe(true)
  })

  it('does not auto-infinite-scroll', async () => {
    global.fetch = mockFeed([{ items: [story()], next_cursor: 'c1', has_more: true }])
    render(<DockNews sym="MU" />)
    await screen.findByText(/Micron raises/)
    // The only way to load more is the explicit control.
    expect(screen.getByRole('button', { name: /Load older/ })).toBeInTheDocument()
  })

  it('shows a professional sparse state rather than filler', async () => {
    global.fetch = mockFeed([{ items: [], next_cursor: null, has_more: false }])
    render(<DockNews sym="ONTO" />)
    expect(await screen.findByText('No recent high-quality news for ONTO.')).toBeInTheDocument()
    expect(screen.getByText(/Filings and company releases/)).toBeInTheDocument()
  })

  it('keeps serving on API failure with a retry, not a blank panel', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }))
    render(<DockNews sym="MU" />)
    expect(await screen.findByText(/temporarily unavailable/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shows a bullish marker without dominating the row', async () => {
    global.fetch = mockFeed([{
      items: [story({ sentiment: 'bullish', sentiment_reason: 'raised guidance' })],
      next_cursor: null, has_more: false,
    }])
    render(<DockNews sym="MU" />)
    const mark = await screen.findByTitle('raised guidance')
    expect(mark).toHaveTextContent('▲')
  })

  it('renders a thumbnail only when a real image is supplied', async () => {
    global.fetch = mockFeed([{
      items: [story({ id: 1, image_url: 'https://cdn/x.jpg' }),
              story({ id: 2, headline: 'No image story' })],
      next_cursor: null, has_more: false,
    }])
    const { container } = render(<DockNews sym="MU" />)
    await screen.findByText('No image story')
    expect(container.querySelectorAll('img')).toHaveLength(1)
  })

  it('offers an X embed for a video post, loaded only on expand', async () => {
    global.fetch = mockFeed([{
      items: [story({
        source_class: 'social', source: '@DanNystedt', media_type: 'video',
        embed_url: 'https://x.com/a/1', headline: 'Micron Taiwan fab at full utilisation',
      })],
      next_cursor: null, has_more: false,
    }])
    render(<DockNews sym="MU" />)
    const row = (await screen.findByText(/Taiwan fab/)).closest('button')
    expect(screen.queryByText('Play post on X')).not.toBeInTheDocument()
    fireEvent.click(row)
    await waitFor(() => expect(screen.getByText('Play post on X')).toBeInTheDocument())
  })

  it('shows a skeleton, not a spinner, on first load', () => {
    global.fetch = vi.fn(() => new Promise(() => {}))
    const { container } = render(<DockNews sym="MU" />)
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy()
  })

  it('handles a missing symbol', () => {
    global.fetch = vi.fn()
    render(<DockNews sym="" />)
    expect(screen.getByText('No symbol.')).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('reports end of history when there is no more to load', async () => {
    global.fetch = mockFeed([{ items: [story()], next_cursor: null, has_more: false }])
    render(<DockNews sym="MU" />)
    expect(await screen.findByText('End of stored history')).toBeInTheDocument()
  })
})

describe('DockNews membership gate', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('explains a 402 instead of showing a broken Retry', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 402, json: async () => ({}) }))
    render(<DockNews sym="MU" />)
    expect(await screen.findByText(/part of a UCT membership/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('still shows Retry for a real outage', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }))
    render(<DockNews sym="MU" />)
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
