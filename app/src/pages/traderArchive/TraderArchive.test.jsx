// The Desk → Archive over /api/wisdom/archive/*: Today, Playbooks, Traders and one search box.
// A 404 (flag off) and a 402 (unpaid) are said as such, never as "nothing found".
// Synthetic data only: the repo is public.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { SWRConfig } from 'swr'

import TraderArchive from './TraderArchive'
import TraderArchiveRedirect from './TraderArchiveRedirect'

const API = '/api/wisdom/archive'
const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
const fail = (status) => ({ ok: false, status, json: async () => ({ detail: 'x' }), text: async () => '{"detail":"x"}' })

const STATS = {
  records: 2, calls: 3,
  records_by_author: { tsdr: 1, bracco: 1 }, records_by_type: { CALL: 1, LESSON: 1 },
  calls_by_author: { tsdr: 2, bracco: 1 }, calls_by_setup: { synthetic_setup: 3 },
  traders: { bracco: 'Bracco', tsdr: 'TSDR' },
}
const CALL = (id, r20, extra = {}) => ({ call_id: id, record_id: 't1', author_id: 'tsdr', trader: 'TSDR', ticker: 'ZZTA',
  direction: 'long', setup: 'synthetic_setup', posted: '2025-01-02', entry: 10, stop: 9, outcome: { r5: 0.02, r20, r60: 0.3 }, ...extra })
const POST = (id, note, extra = {}) => ({ record_id: id, author_id: 'tsdr', trader: 'TSDR', stated_date: '2025-01-02',
  record_type: 'CALL', tickers: ['ZZTA'], note, ...extra })

function serve(routes) {
  globalThis.fetch = vi.fn((url) => {
    const u = String(url)
    const hit = Object.keys(routes).find((k) => u === k || u.startsWith(`${k}?`))
    return Promise.resolve(hit ? routes[hit] : fail(599))
  })
}

function Where() {
  const l = useLocation()
  return <span data-testid="where">{l.pathname + l.search}</span>
}

const mount = (path = '/desk?section=archive') => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/desk" element={<><TraderArchive /><Where /></>} />
        <Route path="/trader-archive" element={<TraderArchiveRedirect />} />
      </Routes>
    </MemoryRouter>
  </SWRConfig>,
)

const search = (text) => {
  fireEvent.change(screen.getByLabelText('Search the archive'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
}

afterEach(() => { vi.restoreAllMocks() })

describe('Trader Archive in The Desk', () => {
  it('opens on Playbooks with the archive size in plain words, and starts Today warming behind it', async () => {
    serve({ [`${API}/stats`]: ok(STATS), [`${API}/playbooks`]: ok({ setups: [{ setup_id: 'kicker', name: 'Kicker', n: 9 }] }),
      [`${API}/rhymes`]: ok({ hits: [] }) })
    mount()
    expect(await screen.findByText(/3 calls and 2 posts/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Playbooks/ })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('button', { name: /Kicker/ })).toBeInTheDocument()
    const urls = () => globalThis.fetch.mock.calls.map(([u]) => String(u))
    await waitFor(() => expect(urls().some((u) => u.startsWith(`${API}/rhymes`))).toBe(true))
    expect(screen.queryByTestId('rhymes-view')).toBeNull()                      // warmed, not shown
  })

  it('an archive that is off or unpaid does not warm Today', async () => {
    serve({ [`${API}/stats`]: fail(404) })
    mount()
    await screen.findByTestId('archive-off')
    expect(globalThis.fetch.mock.calls.map(([u]) => String(u)).some((u) => u.includes('/rhymes'))).toBe(false)
  })

  it('a ticker search shows its calls as cards and its posts, newest first', async () => {
    serve({
      [`${API}/stats`]: ok(STATS),
      [`${API}/rhymes`]: ok({ hits: [] }),
      [`${API}/ticker/ZZTA`]: ok({ ticker: 'ZZTA', n_calls: 2, n_scored: 2, mean_r20: 0.1,
        records: [POST('t1', 'older synthetic note', { stated_date: '2024-01-02' }), POST('t2', 'newer synthetic note')],
        calls: [CALL('t1#0', 0.1, { posted: '2024-01-02' }), CALL('t2#0', -0.05, { record_note: 'synthetic call words' }),
          CALL('t3#0', null, { posted: '2026-01-02', direction: 'neutral', prices_status: 'pending_age', outcome: null, entry: null, stop: null })] }),
      [`${API}/search`]: ok({ hits: [] }),
    })
    mount()
    await screen.findByText(/3 calls and 2 posts/)
    search('zzta')
    // The calls tile is the server's total (n_calls), not the length of the page it sent.
    expect(await screen.findByTestId('ta-ticker-summary')).toHaveTextContent('2calls')
    expect(screen.getByTestId('ta-ticker-summary')).toHaveTextContent('+10.0%avg 20-day result')
    const cards = screen.getAllByTestId('ta-call')
    expect(cards).toHaveLength(3)
    // Newest first: a call too young to be priced says so, never a bare dash.
    expect(cards[0]).toHaveTextContent('Too early20-day result')
    expect(within(cards[0]).getByText('neutral').className).toMatch(/dirNeutral/)
    expect(within(cards[0]).queryByText('Details')).toBeNull()                 // nothing to show yet
    expect(cards[1]).toHaveTextContent('-5.0%20-day result')
    expect(cards[1]).toHaveTextContent('“synthetic call words”')
    expect(cards[1]).toHaveTextContent('TSDR · Jan 2, 2025')
    expect(within(cards[2]).getByText('Synthetic setup')).toBeInTheDocument()  // the setup id, as words
    // The numbers sit behind Details, not on the face of the card.
    expect(within(cards[1]).getByText('Details')).toBeInTheDocument()
    expect(within(cards[1]).getByText('60-day result')).not.toBeVisible()
    const notes = screen.getAllByText(/synthetic note/).map((n) => n.textContent)
    expect(notes).toEqual(['newer synthetic note', 'older synthetic note'])
    expect(screen.getByTestId('where').textContent).toContain('q=zzta')
  })

  it('a word search lists matching posts; a ticker-shaped word with no ticker history still searches words', async () => {
    serve({
      [`${API}/stats`]: ok(STATS),
      [`${API}/rhymes`]: ok({ hits: [] }),
      [`${API}/ticker/FLAG`]: ok({ ticker: 'FLAG', records: [], calls: [] }),
      [`${API}/search`]: ok({ hits: [POST('t3', 'synthetic flag lesson', { record_type: 'LESSON', tickers: [] })] }),
    })
    mount()
    await screen.findByText(/3 calls and 2 posts/)
    search('flag')
    expect(await screen.findByText('synthetic flag lesson')).toBeInTheDocument()
    expect(screen.getByText('Lesson')).toBeInTheDocument()
    expect(screen.queryByTestId('ta-ticker-summary')).toBeNull()
  })

  it('a ticker chip on a post opens that ticker', async () => {
    serve({
      [`${API}/stats`]: ok(STATS),
      [`${API}/search`]: ok({ hits: [POST('t3', 'synthetic multi-ticker post', { tickers: ['ZZTB'] })] }),
      [`${API}/ticker/ZZTB`]: ok({ ticker: 'ZZTB', records: [POST('t4', 'synthetic zztb post')], calls: [] }),
    })
    mount('/desk?section=archive&view=search&q=synthetic%20words')
    fireEvent.click(await screen.findByRole('button', { name: 'ZZTB' }))
    expect(await screen.findByText('synthetic zztb post')).toBeInTheDocument()
    expect(screen.getByTestId('where').textContent).toContain('q=ZZTB')
  })

  it('Traders: a card per trader from /stats, then that trader’s calls and posts', async () => {
    serve({
      [`${API}/stats`]: ok(STATS),
      [`${API}/trader/tsdr`]: ok({ author: 'tsdr', trader: 'TSDR', n_records: 1, n_calls: 2, n_scored: 2, mean_r20: 0.04,
        records: [POST('t1', 'synthetic trader note')], calls: [CALL('t1#0', 0.1)] }),
    })
    mount('/desk?section=archive&view=traders')
    const card = await screen.findByRole('button', { name: /TSDR/ })
    expect(card).toHaveTextContent('2 calls · 1 posts')
    fireEvent.click(card)
    expect(await screen.findByText('synthetic trader note')).toBeInTheDocument()
    expect(screen.getByTestId('ta-trader-summary')).toHaveTextContent('+4.0%avg 20-day result')
    fireEvent.click(screen.getByRole('button', { name: '← All traders' }))
    expect(await screen.findByRole('button', { name: /Bracco/ })).toBeInTheDocument()
  })

  it('Playbooks: pick a setup, read its plain-words verdict, where it worked, best calls and teachings', async () => {
    const st = (n, edge, z, win = 0.55) => ({ n, n_scored: n, win20: win, med_r20: 0.01, med_edge20: 0.02, mean_edgeR: edge, edgeR_z: z })
    serve({
      [`${API}/stats`]: ok(STATS),
      [`${API}/playbooks`]: ok({ setups: [{ setup_id: 'synthetic_setup', name: 'Synthetic setup', n: 140 }] }),
      [`${API}/playbook/synthetic_setup`]: ok({
        setup_id: 'synthetic_setup', name: 'Synthetic setup', aliases: ['SYN'],
        used_by: [{ author: 'tsdr', trader: 'TSDR' }],
        stats: { all: st(140, 0.25, 1.4), trades: st(60, 0.3, 1.1) },
        context: { market: { downtrend: st(40, 0.9, null, 0.62), uptrend: st(90, -0.1) }, trader: { TSDR: st(12, 1.5) } },
        teachings: [{ record_id: 't2', author_id: 'bracco', trader: 'Bracco', date: '2025-03-04', note: 'synthetic teaching note' }],
        winners: [{ call_id: 't1#0', record_id: 't1', ticker: 'ZZTA', author_id: 'tsdr', trader: 'TSDR', posted: '2025-01-02',
          direction: 'long', evidence: 'synthetic winner evidence', r20: 0.1, sim_R: 3, regime: 'uptrend' }],
        failures: [],
      }),
    })
    mount('/desk?section=archive&view=playbooks')
    fireEvent.click(await screen.findByRole('button', { name: /Synthetic setup/ }))
    expect(await screen.findByTestId('ta-playbook-verdict')).toHaveTextContent('Not proven yet')
    expect(screen.getByTestId('ta-playbook-verdict')).toHaveAttribute('title', 'z 1.4')
    // On the face as a bar, and again in the folded "full numbers" table.
    expect(screen.getAllByText('market: downtrend').filter((n) => n.tagName === 'SPAN')).toHaveLength(1)
    expect(screen.getByText('62% worked')).toBeInTheDocument()
    expect(screen.queryByText('trader: TSDR')).toBeNull()                       // n 12 < 30
    expect(screen.getByText('synthetic teaching note')).toBeInTheDocument()
    expect(screen.getByText('“synthetic winner evidence”')).toBeInTheDocument()
    // Best calls are ranked by the trade's result, so the card shows it beside the 20-day move.
    expect(screen.getByText('trade +3.00R')).toBeInTheDocument()
    expect(screen.getByText('None recorded.')).toBeInTheDocument()              // no failures
    expect(screen.getByTestId('where').textContent).toContain('setup=synthetic_setup')
  })

  it('a proven edge says so', async () => {
    serve({
      [`${API}/stats`]: ok(STATS),
      [`${API}/playbooks`]: ok({ setups: [] }),
      [`${API}/playbook/kicker`]: ok({ setup_id: 'kicker', name: 'Kicker', stats: { all: { n_scored: 140, edgeR_z: 3.4, win20: 0.6 } },
        context: {}, teachings: [], winners: [], failures: [] }),
    })
    mount('/desk?section=archive&view=playbooks&setup=kicker')
    expect(await screen.findByTestId('ta-playbook-verdict')).toHaveTextContent('Proven edge')
  })

  it.each([
    ['/trader-archive?sym=zztb', 'q=ZZTB'],                                     // the research block link
    ['/trader-archive?view=playbooks&setup=kicker', 'setup=kicker'],            // the pattern side panel link
  ])('the old address %s lands in The Desk with its context', async (from, carried) => {
    serve({
      [`${API}/stats`]: ok(STATS),
      [`${API}/ticker/ZZTB`]: ok({ ticker: 'ZZTB', records: [POST('t4', 'synthetic zztb post')], calls: [] }),
      [`${API}/playbooks`]: ok({ setups: [] }),
      [`${API}/playbook/kicker`]: ok({ setup_id: 'kicker', name: 'Kicker', stats: {}, context: {}, teachings: [], winners: [], failures: [] }),
    })
    mount(from)
    const where = await screen.findByTestId('where')
    expect(where.textContent.startsWith('/desk?section=archive')).toBe(true)
    expect(where.textContent.replace('sym=', 'q=')).toContain(carried)
  })

  it('shows a post’s stored charts as lazy thumbnails from the paid image route, and enlarges one', async () => {
    const id = 'a'.repeat(64)
    serve({
      [`${API}/stats`]: ok(STATS),
      [`${API}/search`]: ok({ hits: [
        POST('t3', 'synthetic post with a chart', { images: [id] }),
        POST('t4', 'synthetic post without one', { tickers: ['ZZTB'] }),
      ] }),
    })
    mount('/desk?section=archive&view=search&q=chart%20words')
    await screen.findByText('synthetic post with a chart')
    const imgs = screen.getAllByRole('img', { name: 'Chart 1' })
    expect(imgs).toHaveLength(1)                                                 // control: t4 has none
    expect(imgs[0]).toHaveAttribute('src', `${API}/image/${id}`)
    expect(imgs[0]).toHaveAttribute('loading', 'lazy')
    fireEvent.click(screen.getByRole('button', { name: /Open chart 1 of 1/ }))
    const box = screen.getByTestId('archive-lightbox')
    expect(box.querySelector('img')).toHaveAttribute('src', `${API}/image/${id}`)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('archive-lightbox')).toBeNull()
  })

  it('a 404 says the archive is not available, not that nothing was found', async () => {
    serve({ [`${API}/stats`]: fail(404) })
    mount()
    expect(await screen.findByTestId('archive-off')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('a 402 says it is part of the paid plan', async () => {
    serve({ [`${API}/stats`]: fail(402) })
    mount()
    expect(await screen.findByTestId('archive-paywall')).toBeInTheDocument()
  })
})

it('a ticker with a full page of posts says "500+", not a count it cannot know', async () => {
  const many = Array.from({ length: 500 }, (_, i) => POST(`p${i}`, `synthetic note ${i}`))
  serve({
    [`${API}/stats`]: ok(STATS),
    [`${API}/ticker/ZZTC`]: ok({ ticker: 'ZZTC', n_calls: 0, records: many, calls: [] }),
    [`${API}/search`]: ok({ hits: [] }),
  })
  mount('/desk?section=archive&view=search&q=ZZTC')
  expect(await screen.findByTestId('ta-ticker-summary')).toHaveTextContent('500+posts')
})

it('Playbooks: short titles with the detail beneath, catch-all categories grouped under "Other kinds of calls"', async () => {
  serve({
    [`${API}/stats`]: ok(STATS),
    [`${API}/rhymes`]: ok({ hits: [] }),
    [`${API}/playbooks`]: ok({ setups: [
      { setup_id: 'pullback_ma', name: 'Moving-average pullback (8/10/20/21 EMA, 50 SMA)', n: 900 },
      { setup_id: 'watchlist', name: 'Watchlist mention (no specific setup or trigger)', n: 4800 },
    ] }),
  })
  mount('/desk?section=archive&view=playbooks')
  const named = await screen.findByRole('list', { name: 'Playbooks' })
  expect(within(named).getByText('Moving-average pullback')).toBeInTheDocument()
  expect(within(named).getByText('8/10/20/21 EMA, 50 SMA')).toBeInTheDocument()
  expect(within(named).queryByText(/Watchlist mention/)).toBeNull()            // most calls, still not a setup
  const other = screen.getByRole('list', { name: 'Other kinds of calls' })
  expect(within(other).getByText('Watchlist mention')).toBeInTheDocument()
})
