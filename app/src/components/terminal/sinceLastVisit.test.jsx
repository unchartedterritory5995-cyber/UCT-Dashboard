// "New since your last visit" on CN, FEED, CF and CATS (wave 3 lane 13, product item #7).
// The server half is tests/test_terminal_seen.py; this pins what a member SEES: a NEW tag on exactly
// the items the server says are new, the one line ("1 new story since Tue 3:12 PM ET" / "First
// visit"), nothing at all outside a terminal panel or when the route is switched off.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { PanelListContext, TerminalPanelContext } from '.'
import { etVisitLabel, seenKey } from './useSinceLastVisit'

const hooks = vi.hoisted(() => ({ news: null, filings: null, cats: null }))
vi.mock('../../pages/research/hooks/useCompanyNews', () => ({ default: () => hooks.news }))
vi.mock('../../hooks/useFilings', () => ({ default: () => hooks.filings }))
vi.mock('../../pages/research/hooks/useCatalystHistory', () => ({ default: () => hooks.cats }))
vi.mock('../provenance/AbsenceReceipt', () => ({ default: () => null }))

import NewsTab from '../../pages/research/tabs/NewsTab'
import FilingsTab from '../../pages/research/tabs/FilingsTab'
import CatalystsTab from '../../pages/research/tabs/CatalystsTab'
import FilingsFeedTab from '../../pages/research/tabs/FilingsFeedTab'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

// Tue 2026-10-06 3:12 PM ET
const LAST = Date.parse('2026-10-06T19:12:00Z') / 1000
const STORY_OLD = { id: 'old', kind: 'news', headline: 'Old story', publisher: 'Reuters', url: 'https://x/old', published_at: '2026-10-06 09:00:00' }
const STORY_NEW = { id: 'new', kind: 'news', headline: 'Injected story', publisher: 'AP', url: 'https://x/new', published_at: '2026-10-07 10:00:00' }

function serve(seenAnswer, extra = {}) {
  const posts = []
  vi.stubGlobal('fetch', vi.fn((url, init) => {
    const u = String(url)
    if (u.startsWith('/api/terminal/seen/')) {
      posts.push({ url: u, body: JSON.parse(init.body) })
      if (seenAnswer === 404) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
      return Promise.resolve({ ok: true, status: 200, json: async () => seenAnswer(JSON.parse(init.body)) })
    }
    const body = Object.entries(extra).find(([k]) => u.startsWith(k))?.[1] ?? {}
    return Promise.resolve({ ok: true, status: 200, json: async () => body, headers: new Headers() })
  }))
  return posts
}
function mount(el, { inPanel = true } = {}) {
  const api = { publishRows: vi.fn(), publish: vi.fn(), openBoard: vi.fn(), codes: [], pageSize: 4, run: vi.fn(), rerun: vi.fn() }
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      {inPanel
        ? <PanelListContext.Provider value={api}><TerminalPanelContext.Provider value={{ code: 'X', density: 'comfortable', inset: true }}>{el}</TerminalPanelContext.Provider></PanelListContext.Provider>
        : el}
    </SWRConfig>,
  )
}
const newOnly = (keys) => (body) => ({ first_visit: false, last_visit_at: LAST, new: body.keys.filter((k) => keys.includes(k)) })

describe('the pieces', () => {
  it('seenKey dates every key and caps its length', () => {
    expect(seenKey('2026-10-07 10:00:00', 'abc')).toBe('2026-10-07|abc')
    expect(seenKey(null, 'abc')).toBe('undated|abc')
    expect(seenKey('2026-10-07', 'x'.repeat(400))).toHaveLength(160)
  })
  it('the visit time is said in ET', () => {
    expect(etVisitLabel(LAST)).toBe('Tue 3:12 PM ET')
    expect(etVisitLabel(null)).toBeNull()
  })
})

describe('CN', () => {
  it('marks EXACTLY the story the server says is new, and says how many since when', async () => {
    hooks.news = { data: { items: [STORY_NEW, STORY_OLD] }, isLoading: false, error: false, paywalled: false, mutate: vi.fn() }
    const posts = serve(newOnly([seenKey(STORY_NEW.published_at, 'new')]))
    mount(<NewsTab sym="NVDA" />)
    const line = await screen.findByTestId('since-line')
    expect(line.textContent).toBe('1 new story since Tue 3:12 PM ET.')
    const tags = screen.getAllByTestId('since-new')
    expect(tags).toHaveLength(1)
    expect(tags[0].closest('li').textContent).toContain('Injected story')
    expect(posts[0].url).toBe('/api/terminal/seen/CN')
    expect(posts[0].body).toEqual({ sym: 'NVDA', keys: ['2026-10-07|new', '2026-10-06|old'] })
  })

  it('a first visit marks nothing and says so', async () => {
    hooks.news = { data: { items: [STORY_NEW, STORY_OLD] }, isLoading: false, error: false, paywalled: false, mutate: vi.fn() }
    serve(() => ({ first_visit: true, last_visit_at: null, new: [] }))
    mount(<NewsTab sym="NVDA" />)
    expect((await screen.findByTestId('since-line')).textContent).toMatch(/^First visit/)
    expect(screen.queryByTestId('since-new')).toBeNull()
  })

  it('the research page (no panel) never asks, and a switched-off route shows nothing', async () => {
    hooks.news = { data: { items: [STORY_NEW] }, isLoading: false, error: false, paywalled: false, mutate: vi.fn() }
    const posts = serve(newOnly([]))
    mount(<NewsTab sym="NVDA" />, { inPanel: false })
    await screen.findByText('Injected story')
    expect(posts).toEqual([])
    cleanup()
    const posts404 = serve(404)
    mount(<NewsTab sym="NVDA" />)
    await waitFor(() => expect(posts404).toHaveLength(1))
    expect(screen.queryByTestId('since-line')).toBeNull()
    expect(screen.queryByTestId('since-new')).toBeNull()
  })
})

describe('CF, CATS and FEED', () => {
  it('CF tags the new filing', async () => {
    hooks.filings = { data: { filings: [
      { form: '8-K', filed: '2026-10-07', accession: 'a-new', url: 'https://sec/1' },
      { form: '10-Q', filed: '2026-08-01', accession: 'a-old', url: 'https://sec/2' },
    ] }, error: null, isLoading: false, mutate: vi.fn() }
    const posts = serve(newOnly(['2026-10-07|a-new']))
    mount(<FilingsTab sym="NVDA" />)
    expect((await screen.findByTestId('since-line')).textContent).toBe('1 new filing since Tue 3:12 PM ET.')
    expect(screen.getByTestId('since-new').parentElement.textContent).toContain('8-K')
    expect(posts[0].url).toBe('/api/terminal/seen/CF')
  })

  it('CATS tags the new catalyst', async () => {
    hooks.cats = { data: { entries: [
      { market_date: '2026-10-07', tag: 'Earnings', thesis_text: 'Beat.' },
      { market_date: '2026-09-01', tag: 'News', thesis_text: 'Old.' },
    ] }, isLoading: false, error: false, paywalled: false, mutate: vi.fn() }
    serve(newOnly(['2026-10-07|cat|Earnings']))
    mount(<CatalystsTab sym="NVDA" />)
    expect((await screen.findByTestId('since-line')).textContent).toBe('1 new catalyst since Tue 3:12 PM ET.')
    expect(screen.getAllByTestId('since-new')).toHaveLength(1)
  })

  it('FEED tags the new filing in the ticker scope', async () => {
    serve(newOnly(['2026-10-07|acc-new']), {
      '/api/research/filings-feed/NVDA': { state: 'ok', source: 'SEC EDGAR', rows: [
        { accession: 'acc-new', form: '8-K', ticker: 'NVDA', accepted: '2026-10-07T09:00:00', url: 'https://sec/1', source: 'feed' },
        { accession: 'acc-old', form: '4', ticker: 'NVDA', accepted: '2026-09-07T09:00:00', url: 'https://sec/2', source: 'feed' },
      ] },
    })
    mount(<FilingsFeedTab sym="NVDA" />)
    expect((await screen.findByTestId('since-line')).textContent).toBe('1 new filing since Tue 3:12 PM ET.')
    expect(within(screen.getByTestId('filing-acc-new')).getByTestId('since-new')).toBeInTheDocument()
    expect(within(screen.getByTestId('filing-acc-old')).queryByTestId('since-new')).toBeNull()
  })
})
