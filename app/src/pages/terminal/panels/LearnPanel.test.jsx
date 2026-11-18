// LEARN: the teaching UCT already has about one stock. Rails:
//   * the pure half (learnModel.js): the three URLs, the link each lesson opens, the rows of each
//     answer, and the one-line count;
//   * the trader archive is never shown: a team call or an archive row riding the video moments
//     answer is dropped before anything is drawn or counted;
//   * the three reads fail apart: one failing keeps the other two and says what is missing, with
//     its own Retry; all three failing is the panel's error; 402 and 404 are locked;
//   * "nothing on record" is an honest empty state, worded differently from a failed read;
//   * each lesson is a link to where it lives: the Desk reader, the video at that moment, the
//     Model Book.
// Fixtures are the shapes the three handlers answer (api/routers/desk.py articles_for_ticker over
// desk_store.posts_for_ticker, api/services/ticker_mentions.py and its desk_markers adapter,
// api/routers/modelbook.py get_appearances). Every title, name and note here is made up.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import LearnPanel, {
  ARTICLES_LIMIT, LEARN_CODE, MODEL_BOOK_HREF, MOMENTS_SHOWN, articleHref, articleSearchHref, articlesRead, deskArticlesUrl,
  deskMomentsUrl, isDeskVideoMoment, learnCommand, learnCommandArgs, lessonsSentence, modelBookRead, modelBookUrl, momentHref,
  momentsRead,
} from './LearnPanel'
import * as model from './learnModel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const secs = (iso) => Date.parse(iso) / 1000
const article = (slug, title, at, extra = {}) => ({
  id: `https://letter.example.test/p/${slug}`, publication_id: 1, title: 'A FEED TITLE', display_title: title, slug, excerpt: '',
  url: `https://letter.example.test/p/${slug}`, hero_image: null, author: 'Made-up Author', published_at: secs(at),
  ingested_at: secs(at) + 60, word_count: 2100, reading_minutes: 9, image_count: 12, tickers_json: '["NVDA","AAA"]',
  publication_name: 'Made-up Letter', ...extra,
})
const ARTICLES = {
  ticker: 'NVDA', total: 3,
  articles: [
    article('leaders-hold-the-line', 'Leaders hold the line', '2026-11-08T22:30:00Z'),
    // 10:30 PM Eastern on Nov 1 is already Nov 2 in UTC: the date shown is the Eastern one
    article('a-quiet-week', 'A quiet week', '2026-11-02T03:30:00Z', { reading_minutes: null, publication_name: null }),
    article('bases-everywhere', '', '2026-10-25T21:00:00Z', { title: 'Bases everywhere', display_title: null }),
  ],
}
const VIDEO = { video_id: 41, youtube_id: 'abc123XYZ_-', title: 'Made-up weekly review', anchor_date: '2026-11-12' }
const MOMENTS = {
  as_of: '2026-11-16T15:31:00+00:00',
  mentions: [
    { ...VIDEO, t: 725, note: 'A base forming under the high' },
    { ...VIDEO, t: 3725, note: '' },
    { video_id: 37, youtube_id: 'zzz999', title: 'Made-up earnings session', anchor_date: '2026-10-29', t: 0, note: 'The earnings gap' },
    // What the route ALSO carries while the trader archive hooks are on: a team call tied to a
    // video, and an archive row with no video. Neither may reach a member here.
    { ...VIDEO, t: 800, note: 'Trader One (open): long over the pivot', kind: 'call', status: 'open', speaker: 'Trader One',
      locator: 'desk:41@800', source: 'wisdom', wisdom_marker: '[wisdom consumer=desk_markers]' },
    { video_id: null, youtube_id: null, title: 'Trader archive', anchor_date: '2026-11-01', t: 0, note: 'Trader Two: breakout long',
      kind: 'call', status: 'archive', speaker: 'Trader Two', locator: 'archive:9', source_detail: 'archive', archive_ticker: 'NVDA',
      call: { trader: 'Trader Two' }, source: 'wisdom' },
  ],
}
const MODEL_BOOK = {
  symbol: 'NVDA', as_of: '2026-10-01T12:00:00+00:00',
  appearances: [
    { id: 7, year: 2025, symbol: 'NVDA', gain_pct: 171.2, thesis: 'A made-up thesis.', setup_count: 3, created_at: 1.75e9, updated_at: 1.76e9, stats_at: 1.76e9 },
    { id: 3, year: 2023, symbol: 'NVDA', gain_pct: -4.5, thesis: null, setup_count: 0, created_at: 1.7e9, updated_at: null, stats_at: null },
  ],
}
const NO_ARTICLES = { ticker: 'AAA', total: 0, articles: [] }
const NO_MOMENTS = { mentions: [], as_of: '2026-11-16T15:31:00+00:00' }
const NO_MODEL_BOOK = { symbol: 'AAA', appearances: [], as_of: null }

const A = deskArticlesUrl('NVDA')
const V = deskMomentsUrl('NVDA')
const M = modelBookUrl('NVDA')
const ALL = { [A]: ARTICLES, [V]: MOMENTS, [M]: MODEL_BOOK }
const fail = (status) => Object.assign(new Error(`http ${status}`), { status })
const PENDING = Symbol('pending')
/** Serves each URL its body (an Error is thrown, PENDING never answers); anything else is a 500. */
function serve(routes) {
  jsonFetcher.mockImplementation((url) => {
    if (!(url in routes)) return Promise.reject(fail(500))
    const hit = routes[url]
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}

function Harness({ sym, freshness, code, open }) {
  const tree = (
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <PanelFreshnessContext.Provider value={freshness}>
          <PanelListContext.Provider value={{ open, run: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
            <LearnPanel sym={sym} />
          </PanelListContext.Provider>
        </PanelFreshnessContext.Provider>
      </SWRConfig>
    </MemoryRouter>
  )
  return code ? <TerminalPanelContext.Provider value={{ code, density: 'compact', inset: true }}>{tree}</TerminalPanelContext.Provider> : tree
}
function renderPanel(sym = 'NVDA', { freshness = vi.fn(), code = null, open = vi.fn() } = {}) {
  const view = render(<Harness sym={sym} freshness={freshness} code={code} open={open} />)
  return { ...view, freshness, open }
}
const links = (testId) => within(screen.getByTestId(testId)).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])
const HERE = path.dirname(fileURLToPath(import.meta.url))

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('LEARN pure helpers (learnModel)', () => {
  it('the panel re-exports the model, so a caller can import either', () => {
    expect(articlesRead).toBe(model.articlesRead)
    expect(momentsRead).toBe(model.momentsRead)
    expect(LEARN_CODE).toBe('LEARN')
    expect(MOMENTS_SHOWN).toBe(12)
  })

  it('the three URLs carry the ticker, upper-cased and encoded', () => {
    expect(A).toBe(`/api/desk/articles/for-ticker/NVDA?limit=${ARTICLES_LIMIT}`)
    expect(V).toBe('/api/education/tickers/NVDA/mentions')
    expect(M).toBe('/api/modelbook/appearances/NVDA')
    expect(deskArticlesUrl(' brk.b ')).toBe(`/api/desk/articles/for-ticker/BRK.B?limit=${ARTICLES_LIMIT}`)
    expect(deskMomentsUrl('A/B')).toBe('/api/education/tickers/A%2FB/mentions')
    expect(ARTICLES_LIMIT).toBeLessThanOrEqual(50)   // the route's own ceiling
  })

  it('each lesson opens where the Desk and the Model Book open it', () => {
    expect(articleHref('leaders-hold-the-line')).toBe('/desk/article/leaders-hold-the-line')
    expect(momentHref('abc123XYZ_-', 725)).toBe('/desk?section=videos&v=abc123XYZ_-&t=725')
    expect(momentHref('a b', 0)).toBe('/desk?section=videos&v=a%20b&t=0')
    expect(momentHref('zzz999', NaN)).toBe('/desk?section=videos&v=zzz999')
    expect(MODEL_BOOK_HREF).toBe('/model-book')
    expect(articleSearchHref('nvda')).toBe('/desk?section=articles&q=NVDA')
    expect(learnCommandArgs()).toEqual([])
    expect(learnCommand('nvda')).toBe('NVDA LEARN')
    expect(learnCommand('AAA', 'LSN')).toBe('AAA LSN')
  })

  it('articlesRead: title, Eastern date, minutes and the link; `total` is the whole count', () => {
    const got = articlesRead(ARTICLES)
    expect(got.state).toBe('ok')
    expect(got.total).toBe(3)
    expect(got.rows).toEqual([
      { key: 'article-leaders-hold-the-line', title: 'Leaders hold the line', date: '2026-11-08', minutes: 9, publication: 'Made-up Letter', href: '/desk/article/leaders-hold-the-line' },
      { key: 'article-a-quiet-week', title: 'A quiet week', date: '2026-11-01', minutes: null, publication: null, href: '/desk/article/a-quiet-week' },
      { key: 'article-bases-everywhere', title: 'Bases everywhere', date: '2026-10-25', minutes: 9, publication: 'Made-up Letter', href: '/desk/article/bases-everywhere' },
    ])
    // the list is capped, the count is not
    expect(articlesRead({ ...ARTICLES, total: 30 }).total).toBe(30)
    // an article that cannot be opened (no slug) or named, and a repeat, are dropped
    expect(articlesRead({ total: 1, articles: [{ title: 'No slug' }, { slug: 'x' }, ARTICLES.articles[0], ARTICLES.articles[0], null] }).rows).toHaveLength(1)
    expect(articlesRead(NO_ARTICLES)).toEqual({ state: 'ok', rows: [], total: 0 })
    for (const body of [null, undefined, [], 'x', {}, { detail: 'x' }, { articles: 'no' }]) expect(articlesRead(body).state).toBe('failed')
  })

  it('momentsRead keeps only plain Desk video moments: nothing from the trader archive', () => {
    const got = momentsRead(MOMENTS)
    expect(got.state).toBe('ok')
    expect(got.rows).toEqual([
      { key: 'moment-abc123XYZ_--725', title: 'Made-up weekly review', date: '2026-11-12', seconds: 725, at: '12:05', note: 'A base forming under the high', href: '/desk?section=videos&v=abc123XYZ_-&t=725' },
      { key: 'moment-abc123XYZ_--3725', title: 'Made-up weekly review', date: '2026-11-12', seconds: 3725, at: '1:02:05', note: null, href: '/desk?section=videos&v=abc123XYZ_-&t=3725' },
      { key: 'moment-zzz999-0', title: 'Made-up earnings session', date: '2026-10-29', seconds: 0, at: '0:00', note: 'The earnings gap', href: '/desk?section=videos&v=zzz999&t=0' },
    ])
    expect(JSON.stringify(got)).not.toMatch(/Trader|archive|wisdom/i)
    // the rule, one mark at a time: any of these and the row is not a Desk video moment
    const plain = MOMENTS.mentions[0]
    expect(isDeskVideoMoment(plain)).toBe(true)
    for (const mark of [{ source: 'wisdom' }, { source_detail: 'archive' }, { kind: 'mention' }, { speaker: 'Trader One' }, { status: 'open' },
      { locator: 'x' }, { call: {} }, { archive_ticker: 'NVDA' }, { youtube_id: null }, { youtube_id: '' }, { video_id: null }]) {
      expect(isDeskVideoMoment({ ...plain, ...mark }), JSON.stringify(mark)).toBe(false)
    }
    for (const junk of [null, 'x', [], {}]) expect(isDeskVideoMoment(junk)).toBe(false)
    // the same moment sent twice is one row; a missing time opens the video at its start
    expect(momentsRead({ mentions: [plain, plain, { ...plain, t: null }] }).rows.map((r) => r.seconds)).toEqual([725, 0])
    expect(momentsRead(NO_MOMENTS)).toEqual({ state: 'ok', rows: [] })
    for (const body of [null, undefined, [], 'x', {}, { detail: 'x' }, { mentions: 'no' }]) expect(momentsRead(body).state).toBe('failed')
  })

  it('modelBookRead: one row per year, newest first, with the gain and the setups marked', () => {
    expect(modelBookRead(MODEL_BOOK)).toEqual({ state: 'ok', rows: [
      { key: 'modelbook-2025', year: 2025, gainPct: 171.2, setupCount: 3, href: '/model-book' },
      { key: 'modelbook-2023', year: 2023, gainPct: -4.5, setupCount: 0, href: '/model-book' },
    ] })
    expect(modelBookRead({ appearances: [{ year: 2021 }, { year: 2024, gain_pct: null }, { year: 'x' }, null, { year: 2024 }] }).rows.map((r) => [r.year, r.gainPct]))
      .toEqual([[2024, null], [2021, null]])   // a gain that is not known is "not known", never 0
    expect(modelBookRead(NO_MODEL_BOOK)).toEqual({ state: 'ok', rows: [] })
    for (const body of [null, undefined, [], 'x', {}, { detail: 'x' }, { appearances: 'no' }]) expect(modelBookRead(body).state).toBe('failed')
  })

  it('the count sentence leaves out a section that did not answer, and never counts it as 0', () => {
    expect(lessonsSentence('NVDA', { articles: 3, moments: 1, modelBook: 2 })).toBe('On record for NVDA: 3 Desk articles, 1 Desk video moment and 2 Model Book years.')
    expect(lessonsSentence('NVDA', { articles: 1, moments: null, modelBook: 0 })).toBe('On record for NVDA: 1 Desk article and 0 Model Book years.')
    expect(lessonsSentence('NVDA', { moments: 4 })).toBe('On record for NVDA: 4 Desk video moments.')
    expect(lessonsSentence('NVDA')).toBe('')
  })
})

describe('LEARN panel states', () => {
  it('asks for a ticker when there is none, naming the code it runs under', () => {
    renderPanel('', { code: 'LSN' })
    expect(screen.getByText('LSN needs a ticker.')).toBeTruthy()
    expect(screen.getByText('NVDA LSN')).toBeTruthy()
    expect(jsonFetcher).not.toHaveBeenCalled()
  })

  it('shows a skeleton while all three reads are out', () => {
    jsonFetcher.mockReturnValue(new Promise(() => {}))
    renderPanel()
    expect(screen.getByTestId('terminal-learn-loading').textContent).toContain('Finding the lessons on NVDA')
    expect(jsonFetcher.mock.calls.map(([url]) => url).sort()).toEqual([A, V, M].sort())
  })

  it('all three reads failing (500) is an error with Retry, never "no lessons"', async () => {
    serve({})
    renderPanel('NVDA', { code: 'LSN' })
    const err = await screen.findByTestId('terminal-learn-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The lessons on NVDA could not be read just now.')
    expect(err.textContent).toContain('That is not the same as none on record. Retry, or run NVDA LSN again.')
    expect(screen.queryByTestId('terminal-learn-empty')).toBeNull()
    serve(ALL)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-learn-articles-list')).toBeTruthy()
  })

  it('a 402 says paid plan and a 404 says not switched on: both locked, neither offers Retry', async () => {
    jsonFetcher.mockRejectedValue(fail(402))
    renderPanel()
    const paid = await screen.findByTestId('terminal-learn-error')
    expect(paid.getAttribute('data-kind')).toBe('locked')
    expect(paid.textContent).toContain('Lessons needs a paid plan.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    cleanup()
    jsonFetcher.mockReset()
    jsonFetcher.mockRejectedValue(fail(404))
    renderPanel()
    const off = await screen.findByTestId('terminal-learn-error')
    expect(off.getAttribute('data-kind')).toBe('locked')
    expect(off.textContent).toContain('Lessons is not switched on for this server yet.')
  })

  it('nothing on record is an honest empty state, worded as what was read: not a failure', async () => {
    serve({ [deskArticlesUrl('AAA')]: NO_ARTICLES, [deskMomentsUrl('AAA')]: NO_MOMENTS, [modelBookUrl('AAA')]: NO_MODEL_BOOK })
    const { freshness } = renderPanel('AAA')
    const empty = await screen.findByTestId('terminal-learn-empty')
    expect(empty.getAttribute('data-kind')).toBe('empty')
    expect(empty.textContent).toContain('No lessons on record for AAA yet.')
    expect(empty.textContent).toContain('All three were read, so this is what is on record, not a failed read.')
    expect(screen.queryByTestId('terminal-learn-error')).toBeNull()
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull()
    // an empty answer is still a read: the header names the source and when
    await waitFor(() => expect(freshness.mock.calls.map((c) => c[0]).filter(Boolean).pop().source).toBe('The Desk and the Model Book (UCT lessons)'))
  })

  it('a stock with only team calls on record has NO video moments here', async () => {
    serve({ [A]: NO_ARTICLES, [V]: { ...MOMENTS, mentions: MOMENTS.mentions.slice(3) }, [M]: NO_MODEL_BOOK })
    renderPanel()
    expect(await screen.findByTestId('terminal-learn-empty')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Trader One|Trader Two|Trader archive/)
  })
})

describe('LEARN panel, the three reads fail apart', () => {
  it('one read failing keeps the other two and says what is missing, with its own Retry', async () => {
    serve({ [A]: ARTICLES, [M]: MODEL_BOOK })   // the video moments answer 500
    renderPanel()
    await screen.findByTestId('terminal-learn-articles-list')
    const note = screen.getByTestId('terminal-learn-moments-error')
    expect(note.textContent).toContain('The Desk video moments could not be read just now. That is not the same as none on record.')
    expect(screen.queryByTestId('terminal-learn-moments-none')).toBeNull()
    expect(screen.getByTestId('terminal-learn-modelbook-list')).toBeTruthy()
    // the count sentence leaves the missing section out instead of calling it 0
    expect(screen.getByTestId('terminal-learn-summary').textContent).toBe('On record for NVDA: 3 Desk articles and 2 Model Book years.')
    expect(screen.queryByTestId('terminal-learn-empty')).toBeNull()
    serve(ALL)
    fireEvent.click(screen.getByRole('button', { name: 'Retry the Desk video moments' }))
    expect(await screen.findByTestId('terminal-learn-moments-list')).toBeTruthy()
    expect(screen.queryByTestId('terminal-learn-moments-error')).toBeNull()
  })

  it('a section behind a paywall says so and offers no Retry; the others are still listed', async () => {
    serve({ [A]: fail(402), [V]: MOMENTS, [M]: NO_MODEL_BOOK })
    renderPanel()
    await screen.findByTestId('terminal-learn-moments-list')
    const note = screen.getByTestId('terminal-learn-articles-error')
    expect(note.textContent).toContain('The Desk articles needs a paid plan.')
    expect(within(note).queryByRole('button')).toBeNull()
    expect(screen.getByTestId('terminal-learn-modelbook-none').textContent).toContain('NVDA is in no Model Book year.')
  })

  it('a 200 answer that is not the expected shape is a failed read, not "none on record"', async () => {
    serve({ [A]: { detail: 'unexpected' }, [V]: MOMENTS, [M]: MODEL_BOOK })
    renderPanel()
    await screen.findByTestId('terminal-learn-moments-list')
    expect(screen.getByTestId('terminal-learn-articles-error').textContent).toContain('The Desk articles could not be read just now.')
    expect(screen.queryByTestId('terminal-learn-articles-none')).toBeNull()
  })

  it('a section still loading says so while the others are already listed', async () => {
    serve({ [A]: PENDING, [V]: MOMENTS, [M]: MODEL_BOOK })
    renderPanel()
    await screen.findByTestId('terminal-learn-moments-list')
    expect(screen.getByTestId('terminal-learn-articles-loading').textContent).toBe('Reading the Desk articles.')
    expect(screen.getByTestId('terminal-learn-articles').getAttribute('data-state')).toBe('loading')
  })

  it('an empty section beside full ones says nothing is on record for that section only', async () => {
    serve({ [A]: ARTICLES, [V]: NO_MOMENTS, [M]: MODEL_BOOK })
    renderPanel()
    await screen.findByTestId('terminal-learn-articles-list')
    expect(screen.getByTestId('terminal-learn-moments-none').textContent).toBe('No Desk video mentions NVDA.')
    expect(screen.queryByTestId('terminal-learn-empty')).toBeNull()
  })
})

describe('LEARN panel, populated', () => {
  it('lists the three sections as links to each lesson, with the read time in the header', async () => {
    serve(ALL)
    const { freshness, open } = renderPanel()
    await screen.findByTestId('terminal-learn-articles-list')
    expect(screen.getByTestId('terminal-learn-summary').textContent)
      .toBe('On record for NVDA: 3 Desk articles, 3 Desk video moments and 2 Model Book years.')
    expect(links('terminal-learn-articles-list')).toEqual([
      ['Leaders hold the line', '/desk/article/leaders-hold-the-line'],
      ['A quiet week', '/desk/article/a-quiet-week'],
      ['Bases everywhere', '/desk/article/bases-everywhere'],
    ])
    const firstArticle = within(screen.getByTestId('terminal-learn-articles-list')).getAllByRole('listitem')[0].textContent
    for (const s of ['2026-11-08', 'Made-up Letter', '9 min read']) expect(firstArticle).toContain(s)
    expect(screen.queryByTestId('terminal-learn-articles-more')).toBeNull()
    // each video link carries its time into the video
    expect(links('terminal-learn-moments-list')).toEqual([
      ['Made-up weekly review, at 12:05', '/desk?section=videos&v=abc123XYZ_-&t=725'],
      ['Made-up weekly review, at 1:02:05', '/desk?section=videos&v=abc123XYZ_-&t=3725'],
      ['Made-up earnings session, at 0:00', '/desk?section=videos&v=zzz999&t=0'],
    ])
    expect(within(screen.getByTestId('terminal-learn-moments-list')).getAllByRole('listitem')[0].textContent).toContain('A base forming under the high')
    expect(links('terminal-learn-modelbook-list')).toEqual([['2025 Model Book', '/model-book'], ['2023 Model Book', '/model-book']])
    const rows = within(screen.getByTestId('terminal-learn-modelbook-list')).getAllByRole('listitem').map((li) => li.textContent)
    expect(rows[0]).toContain('+171.2% that year')
    expect(rows[0]).toContain('3 setups marked')
    expect(rows[1]).toContain('-4.5% that year')
    expect(rows[1]).not.toContain('setup')
    // the three sections are named regions, each with its count
    expect(screen.getByRole('region', { name: 'Desk articles that cover NVDA' }).textContent).toContain('Desk articles (3)')
    expect(screen.getByRole('region', { name: 'Desk video moments that mention NVDA' }).textContent).toContain('Desk video moments (3)')
    expect(screen.getByRole('region', { name: 'Model Book years NVDA is in' }).textContent).toContain('Model Book (2)')
    // the trader archive is not here
    expect(document.body.textContent).not.toMatch(/Trader One|Trader Two|Trader archive/)
    fireEvent.click(screen.getByRole('button', { name: 'Model Book entries for NVDA (NVDA MB)' }))
    expect(open).toHaveBeenCalledWith('NVDA MB')
    const report = freshness.mock.calls.map((c) => c[0]).filter(Boolean).pop()
    expect(report.source).toBe('The Desk and the Model Book (UCT lessons)')
    expect(report.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(report.age.asOfDate).toContain('ET')
    expect(screen.getByTestId('terminal-learn-method').textContent).toContain('each link opens the video at that time')
    expect(document.body.textContent).not.toMatch(/[—–]/)
  })

  it('a capped article list says how many there are and links the Desk search for the rest', async () => {
    serve({ ...ALL, [A]: { ...ARTICLES, total: 30 } })
    renderPanel()
    await screen.findByTestId('terminal-learn-articles-list')
    expect(screen.getByRole('region', { name: 'Desk articles that cover NVDA' }).textContent).toContain('Desk articles (30)')
    const more = screen.getByTestId('terminal-learn-articles-more')
    expect(more.textContent).toContain('Showing the newest 3 of 30.')
    expect(within(more).getByRole('link', { name: 'Search the Desk articles for NVDA' }).getAttribute('href')).toBe('/desk?section=articles&q=NVDA')
  })

  it('a long list of video moments draws the newest 12 and offers the rest', async () => {
    const mentions = Array.from({ length: 15 }, (_, i) => ({ ...VIDEO, t: 60 * (i + 1), note: `Made-up note ${i + 1}` }))
    serve({ ...ALL, [V]: { mentions, as_of: MOMENTS.as_of } })
    renderPanel()
    await screen.findByTestId('terminal-learn-moments-list')
    expect(within(screen.getByTestId('terminal-learn-moments-list')).getAllByRole('listitem')).toHaveLength(12)
    expect(screen.getByRole('region', { name: 'Desk video moments that mention NVDA' }).textContent).toContain('Desk video moments (15)')
    fireEvent.click(screen.getByTestId('terminal-learn-moments-all'))
    expect(within(screen.getByTestId('terminal-learn-moments-list')).getAllByRole('listitem')).toHaveLength(15)
    expect(screen.getByTestId('terminal-learn-moments-all').textContent).toBe('Show the newest 12')
  })

  it('a new ticker is three new reads, and one stock\'s lessons are never drawn under another\'s name', async () => {
    serve({ ...ALL, [deskArticlesUrl('AAA')]: NO_ARTICLES, [deskMomentsUrl('AAA')]: NO_MOMENTS, [modelBookUrl('AAA')]: NO_MODEL_BOOK })
    const freshness = vi.fn()
    const open = vi.fn()
    const view = renderPanel('NVDA', { freshness, open })
    await screen.findByTestId('terminal-learn-articles-list')
    view.rerender(<Harness sym="aaa" freshness={freshness} code={null} open={open} />)
    expect(await screen.findByTestId('terminal-learn-empty')).toBeTruthy()
    expect(screen.queryByText('Leaders hold the line')).toBeNull()
    expect(jsonFetcher).toHaveBeenCalledWith(deskArticlesUrl('AAA'))
  })
})

describe('LEARN follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const file of ['LearnPanel.jsx', 'learnModel.js']) {
      const text = fs.readFileSync(path.join(HERE, file), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${file}`, text).map((h) => h.lit), file).toEqual([])
    }
  })
})

describe('LEARN accessibility', () => {
  it('the three sections, a failed section and the empty state pass axe (WCAG A and AA)', async () => {
    serve(ALL)
    renderPanel()
    await screen.findByTestId('terminal-learn-articles-list')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    jsonFetcher.mockReset()
    serve({ [A]: ARTICLES, [M]: NO_MODEL_BOOK })
    renderPanel()
    await screen.findByTestId('terminal-learn-moments-error')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    jsonFetcher.mockReset()
    serve({ [A]: NO_ARTICLES, [V]: NO_MOMENTS, [M]: NO_MODEL_BOOK })
    renderPanel()
    await screen.findByTestId('terminal-learn-empty')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 20_000)
})
