// FED: Fed watch. Rails:
//   * loading, a failed read (error with Retry), signed out, not on a paid plan, a switched-off route
//     and an answer that is not the route's shape: none of them is an empty panel;
//   * a block still being read says so and the panel fills in on its own;
//   * the statement's redline: added words underlined and struck words through, each with hidden
//     words a screen reader reads ("added:", "removed:"), with the statement it is compared with;
//   * every block fails apart, in words: a switched-off wire, a refused Board page, an unreadable
//     survey, a calendar not held, rates while the economics feature is off (never 0);
//   * headlines with their time and their tickers as PanelSymbol; the survey labelled as its
//     respondents' answers with the New York Fed credit; the projections as the officials' own;
//   * the footer cites the Board; the header gets the answer's time; tokens only; axe.
// Every value is invented in the route's real shape (api/services/fed_watch.py).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import FedWatchPanel, { FED_CODE, FED_SOURCE, FED_URL } from './FedWatchPanel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const B = 'https://www.federalreserve.gov'
const NY = 'https://www.newyorkfed.org'
const SEGMENTS = [
  { op: 'same', text: 'The Committee voted' }, { op: 'removed', text: '9-1' }, { op: 'added', text: '10-0' },
  { op: 'same', text: 'on this invented statement.' }, { op: 'break', text: '' },
  { op: 'same', text: 'Orchard output grew at a' }, { op: 'removed', text: 'calm' }, { op: 'added', text: 'brisk' }, { op: 'same', text: 'pace.' },
]
const STATEMENT = {
  state: 'ok', source: 'Federal Reserve Board', date: '2031-03-04', url: `${B}/newsevents/pressreleases/monetary20310304a.htm`,
  implementation_note_url: `${B}/newsevents/pressreleases/monetary20310304a1.htm`,
  minutes: { meeting: 'January 27-28, 2031', url: `${B}/newsevents/pressreleases/monetary20310218a.htm`, date: '2031-02-18' },
  paragraphs: ['The Committee voted 10-0 on this invented statement.', 'Orchard output grew at a brisk pace.'],
  redline: { state: 'ok', added: 2, removed: 2, segments: SEGMENTS,
    previous: { date: '2031-01-28', url: `${B}/newsevents/pressreleases/monetary20310128a.htm` } },
}
const answer = (over = {}) => ({
  status: 'ok',
  statement: STATEMENT,
  speeches: { state: 'ok', source: 'Federal Reserve Board', total: 2, missing: [], items: [
    { kind: 'speech', speaker: 'Quillfeather', title: 'Notes on Orchard Credit', where: 'the Invented Lending Forum, Lakeview',
      published: '2031-03-20T15:00:00+00:00', url: `${B}/newsevents/speech/quillfeather20310320a.htm` },
    { kind: 'testimony', speaker: 'Brindlewood', title: 'Semiannual Invented Report', where: 'the Committee on Invented Affairs',
      published: '2031-03-19T14:00:00+00:00', url: `${B}/newsevents/testimony/brindlewood20310319a.htm` },
  ] },
  headlines: { state: 'ok', source: 'TradeXchange', matched: 2, scanned: 3000, limit: 30, items: [
    { seq: 12, text: "Fed's Quillfeather says the invented outlook is balanced", received_at_ms: Date.parse('2031-03-20T14:31:00Z'), tickers: [] },
    { seq: 9, text: 'FOMC invented minutes lift ZZZQ shares', received_at_ms: Date.parse('2031-03-19T18:05:00Z'), tickers: ['ZZZQ'] },
  ] },
  calendar: { source: 'the economic calendar', today: '2031-03-20', week_start: '2031-03-17', week_end: '2031-03-21',
    next_meeting: { state: 'ok', date: '2031-04-29', time: '2:00 PM', event: 'FOMC Statement', source: 'the economic calendar', days_to_go: 40 },
    this_week: { state: 'ok', total: 1, items: [{ date: '2031-03-19', time: '9:00 AM', event: 'Fed Brindlewood Speech' }] } },
  rates: { state: 'ok', source: 'Federal Reserve Bank of New York', notice: 'The invented notice names newyorkfed.org.',
    effective: { value: 9.12, date: '2031-03-18', reason: null }, upper: { value: 9.25, date: '2031-03-18', reason: null },
    lower: { value: 9.0, date: '2031-03-18', reason: null } },
  projections: { state: 'ok', source: 'Federal Reserve Board', date: '2031-03-04', meeting: 'March 3-4',
    page_url: `${B}/monetarypolicy/fomcprojtabl20310304.htm`, release_url: `${B}/newsevents/pressreleases/monetary20310304b.htm`,
    medians: [{ label: '2031', value: 7.4 }, { label: '2032', value: 6.9 }, { label: 'Longer run', value: 5.9 }] },
  survey: { state: 'ok', source: 'Federal Reserve Bank of New York', survey: 'March 2031', questions_sent: '2031-02-17',
    responses_due: '2031-02-21', before_meeting: { label: 'Mar. 3-4 2031', date: '2031-03-04' },
    page_url: `${NY}/markets/market-intelligence/survey-of-market-expectations`,
    file_url: `${NY}/medialibrary/media/markets/survey/2031/mar-2031-data.xlsx`,
    path: [{ label: 'Apr. 28-29 2031', date: '2031-04-29', median: 9.13, p25: 8.88, p75: 9.13, respondents: 41 }],
    distributions: [{ label: 'Year-end 2031', date: '2031-12-31', respondents: 40, buckets: [
      { range: '8.76 - 9.00%', low: 8.76, high: 9.0, probability: 0 },
      { range: '9.01 - 9.25%', low: 9.01, high: 9.25, probability: 55 },
      { range: '>= 9.26%', low: 9.26, high: null, probability: 45 },
    ] }],
    passed: 1, more: 0, credit: '© 2031 Federal Reserve Bank of New York. Content from the New York Fed subject to the Terms of Use at newyorkfed.org.' },
  board_cite: 'Source: Board of Governors of the Federal Reserve System.',
  built_at: '2031-03-20T15:00:00+00:00',
  ...over,
})

const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
function serve(routes) {
  jsonFetcher.mockImplementation((u) => {
    const hit = routes[u]
    if (hit === undefined) return Promise.reject(fail(500))
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([u]) => u))]

function renderPanel({ setFreshness = vi.fn(), code = null } = {}) {
  const body = <FedWatchPanel />
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run: vi.fn(), rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { setFreshness, container: view.container }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const root = () => screen.getByTestId('terminal-fed')
const block = (id) => screen.getByTestId(id)

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('FED states', () => {
  it('shows a loading skeleton and asks the one route', () => {
    serve({ [FED_URL]: PENDING })
    renderPanel()
    expect(FED_CODE).toBe('FED')
    expect(screen.getByTestId('terminal-fed-loading')).toBeTruthy()
    expect(root().getAttribute('data-state')).toBe('loading')
    expect(asked()).toEqual(['/api/research/fed-watch'])
  })

  it('a failed read is an error with Retry, and Retry reads again', async () => {
    serve({})
    const { setFreshness } = renderPanel({ code: 'FED' })
    const err = await screen.findByTestId('terminal-fed-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('Fed watch could not be read just now.')
    expect(err.textContent).toContain('Retry, or run FED again.')
    expect(setFreshness.mock.calls.every(([r]) => r == null)).toBe(true)
    serve({ [FED_URL]: answer() })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-fed-redline')).toBeTruthy()
  })

  it('signed out, a timeout, no paid plan and a switched-off route each say so; only an error can be retried', async () => {
    for (const [err, kind, words] of [
      [fail(401), 'error', 'You are signed out, so fed watch cannot be read. Sign in again.'],
      [fail(0, { timedOut: true }), 'error', 'Fed watch did not answer within 30 seconds.'],
      [fail(402), 'locked', 'Fed watch needs a paid plan.'],
      [fail(404), 'locked', 'Fed watch is not switched on for this server yet.'],
    ]) {
      serve({ [FED_URL]: err })
      renderPanel()
      const state = await screen.findByTestId('terminal-fed-error')
      expect(state.getAttribute('data-kind')).toBe(kind)
      expect(state.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' })).toBe(kind === 'error')
      cleanup()
    }
  })

  it('an answer that is not the route\'s shape is a failed read with Retry', async () => {
    for (const b of [{ items: [] }, { status: 'computing' }, []]) {
      serve({ [FED_URL]: b })
      renderPanel()
      const err = await screen.findByTestId('terminal-fed-error')
      expect(err.textContent).toContain('Fed watch could not be read just now.')
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
      cleanup()
    }
  })

  it('a block still being read says so, and the panel asks again by itself and fills in', async () => {
    let n = 0
    jsonFetcher.mockImplementation(async () => {
      n += 1
      return n === 1 ? answer({ statement: { state: 'computing', source: 'Federal Reserve Board' }, survey: { state: 'computing' } }) : answer()
    })
    renderPanel()
    const working = await screen.findByTestId('terminal-fed-computing')
    expect(working.textContent).toContain('Some blocks are still being read; they fill in on their own.')
    expect(block('terminal-fed-statement-missing').textContent).toContain("Reading the statement from the Board's website.")
    expect(block('terminal-fed-survey-missing').textContent).toContain("Reading the survey from the New York Fed's website.")
    expect(screen.getAllByTestId('terminal-fed-headline')).toHaveLength(2)      // what is held shows at once
    await screen.findByTestId('terminal-fed-redline', {}, { timeout: 6000 })
    expect(n).toBeGreaterThanOrEqual(2)
  })
})

describe('FED with every block', () => {
  it('the glance: the target range, the effective rate and the next decision, each dated, with the notice', async () => {
    serve({ [FED_URL]: answer() })
    const { setFreshness } = renderPanel()
    expect((await screen.findByTestId('terminal-fed-range')).textContent).toBe('9.00% to 9.25% (Mar 18, 2031)')
    expect(block('terminal-fed-effr').textContent).toBe('9.12% (Mar 18, 2031)')
    expect(block('terminal-fed-next').textContent).toBe('Apr 29, 2031, 2:00 PM ET (in 40 days)')
    expect(block('terminal-fed-glance-source').textContent).toContain('Federal Reserve Bank of New York')
    expect(block('terminal-fed-glance-source').textContent).toContain('The invented notice names newyorkfed.org.')
    expect(setFreshness).toHaveBeenCalledWith(expect.objectContaining({ source: FED_SOURCE, observedAt: '2031-03-20T15:00:00.000Z' }))
  })

  it('the redline marks added and removed words, screen readers hear which, and the links are there', async () => {
    serve({ [FED_URL]: answer() })
    renderPanel()
    const red = await screen.findByTestId('terminal-fed-redline')
    expect(block('terminal-fed-statement').querySelector('h3').textContent).toBe('Latest statement: Mar 4, 2031')
    expect(block('terminal-fed-redline-summary').textContent).toBe('Against the statement of Jan 28, 2031: 2 words added, 2 words removed.')
    const ins = [...red.querySelectorAll('ins')].map((e) => e.textContent)
    const del = [...red.querySelectorAll('del')].map((e) => e.textContent)
    expect(ins).toEqual(['added: 10-0', 'added: brisk'])
    expect(del).toEqual(['removed: 9-1', 'removed: calm'])
    for (const hidden of red.querySelectorAll('ins > .sr-only, del > .sr-only')) expect(['added: ', 'removed: ']).toContain(hidden.textContent)
    const paras = screen.getAllByTestId('terminal-fed-redline-para')
    expect(paras).toHaveLength(2)
    expect(paras[0].textContent).toBe('The Committee voted removed: 9-1 added: 10-0 on this invented statement.')
    const links = within(block('terminal-fed-statement-links')).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('rel')])
    expect(links).toEqual([
      ['Full statement', STATEMENT.url, 'noopener noreferrer'],
      ['Implementation note', STATEMENT.implementation_note_url, 'noopener noreferrer'],
      ['Minutes (January 27-28, 2031 meeting)', STATEMENT.minutes.url, 'noopener noreferrer'],
      ['Statement of Jan 28, 2031', STATEMENT.redline.previous.url, 'noopener noreferrer'],
    ])
  })

  it('headlines carry their time and their tickers through PanelSymbol; speeches, this week, projections and the footer', async () => {
    serve({ [FED_URL]: answer() })
    renderPanel()
    const rows = await screen.findAllByTestId('terminal-fed-headline')
    expect(rows[0].textContent).toContain("Fed's Quillfeather says the invented outlook is balanced")
    expect(rows[0].textContent).toMatch(/10:31 AM ET/)
    expect(rows[1].textContent).toMatch(/Mar 19, 2:05 PM ET/)
    expect(within(rows[1]).getByRole('button', { name: /ZZZQ/ })).toBeTruthy()
    expect(block('terminal-fed-headlines-source').textContent).toContain('Source: TradeXchange, live. Picked from the newest 3,000 headlines on the wire.')
    const speeches = screen.getAllByTestId('terminal-fed-speech')
    expect(speeches[0].textContent).toContain('Notes on Orchard Credit')
    expect(speeches[0].textContent).toContain('Quillfeather')
    expect(speeches[1].textContent).toContain('Testimony, Mar 19, 2031')
    expect(within(speeches[0]).getByRole('link').getAttribute('href')).toBe(`${B}/newsevents/speech/quillfeather20310320a.htm`)
    expect(screen.getByTestId('terminal-fed-week-row').textContent).toBe('Fed Brindlewood SpeechWed Mar 19, 9:00 AM ET')
    const proj = block('terminal-fed-projections')
    expect([...proj.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['2031', '2032', 'Longer run'])
    expect([...proj.querySelectorAll('dd')].map((d) => d.textContent)).toEqual(['7.4%', '6.9%', '5.9%'])
    expect(block('terminal-fed-projections-line').textContent).toContain("The officials' own median projection")
    expect(block('terminal-fed-projections-line').textContent).toContain('Not a forecast by UCT.')
    expect(block('terminal-fed-footer').textContent).toContain('Source: Board of Governors of the Federal Reserve System.')
  })

  it('the survey: its path, its probabilities with today\'s range marked and zero ranges counted, its label and its credit', async () => {
    serve({ [FED_URL]: answer() })
    renderPanel()
    expect((await screen.findByTestId('terminal-fed-survey-line')).textContent)
      .toBe('New York Fed Survey of Market Expectations, March 2031, responses due Feb 21, 2031, taken before the Mar. 3-4 2031 meeting.')
    expect(screen.getByTestId('terminal-fed-survey-path-row').textContent).toBe('Apr. 28-29 20319.13%8.88% to 9.13%')
    const buckets = screen.getAllByTestId('terminal-fed-survey-bucket')
    expect(buckets.map((b) => b.textContent)).toEqual(["9.01 - 9.25% (today’s range)55%", '>= 9.26%45%'])
    expect(buckets[0].getAttribute('data-today')).toBe('true')
    expect(block('terminal-fed-survey').textContent).toContain('One range with no probability is left out.')
    expect(block('terminal-fed-survey-passed').textContent).toContain('already held')
    expect(block('terminal-fed-survey-label').textContent).toContain('not market prices and not a forecast by UCT')
    expect(block('terminal-fed-survey-credit').textContent).toBe('© 2031 Federal Reserve Bank of New York. Content from the New York Fed subject to the Terms of Use at newyorkfed.org.')
  })
})

describe('FED blocks fail apart, in words', () => {
  it('rates while the economics feature is off are words, never 0, and the notice is not shown without a figure', async () => {
    const off = { value: null, date: null, reason: 'econ_off' }
    serve({ [FED_URL]: answer({ rates: { state: 'off', notice: 'The invented notice.', effective: off, upper: off, lower: off } }) })
    renderPanel()
    const range = await screen.findByTestId('terminal-fed-range')
    expect(range.textContent).toBe('No figure. Not shown: the economic data feature is not switched on for this server.')
    expect(block('terminal-fed-effr').textContent).not.toMatch(/0\.00|\b0%/)
    expect(block('terminal-fed-glance-source').textContent).not.toContain('The invented notice.')
    expect(screen.queryAllByTestId('terminal-fed-survey-bucket').some((b) => b.getAttribute('data-today'))).toBe(false)
  })

  it('a switched-off wire, an unstarted wire and a failed store each say which', async () => {
    for (const [state, id, words] of [
      ['off', 'terminal-fed-headlines-off', 'The news wire is switched off for this server'],
      ['not_started', 'terminal-fed-headlines-off', 'has not started on the server yet'],
      ['failed', 'terminal-fed-headlines-error', 'That is not the same as no Fed headlines.'],
    ]) {
      serve({ [FED_URL]: answer({ headlines: { state, items: [] } }) })
      renderPanel()
      expect((await screen.findByTestId(id)).textContent).toContain(words)
      expect(screen.queryByTestId('terminal-fed-redline')).toBeTruthy()          // the other blocks still draw
      cleanup()
    }
  })

  it('a refused statement page links the Board; a feed with no statement says so; no earlier statement shows the text', async () => {
    serve({ [FED_URL]: answer({ statement: { state: 'unavailable', url: STATEMENT.url, check: { state: 'unavailable', reason: 'refused', http_status: 403 } } }) })
    renderPanel()
    const miss = await screen.findByTestId('terminal-fed-statement-missing')
    expect(miss.textContent).toContain("The Board's website did not let the server read the statement just now.")
    expect(within(miss).getByRole('link').getAttribute('href')).toBe(STATEMENT.url)
    cleanup()
    serve({ [FED_URL]: answer({ statement: { state: 'none' } }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-fed-statement-none')).textContent).toContain('lists no FOMC statement right now')
    cleanup()
    serve({ [FED_URL]: answer({ statement: { ...STATEMENT, redline: { state: 'no_previous' } } }) })
    renderPanel()
    const text = await screen.findByTestId('terminal-fed-statement-text')
    expect(text.textContent).toContain('Orchard output grew at a brisk pace.')
    expect(block('terminal-fed-redline-summary').textContent).toContain('no earlier statement held')
    expect(screen.queryByTestId('terminal-fed-redline')).toBeNull()
  })

  it('an unreadable survey and unreadable projections link the source; a partial speech list says what is missing', async () => {
    serve({ [FED_URL]: answer({
      survey: { state: 'unreadable', file_url: `${NY}/medialibrary/media/markets/survey/2031/mar-2031-data.xlsx`, credit: null },
      projections: { state: 'unreadable', page_url: `${B}/monetarypolicy/fomcprojtabl20310304.htm` },
      speeches: { ...answer().speeches, missing: ['testimony'] },
    }) })
    renderPanel()
    const sv = await screen.findByTestId('terminal-fed-survey-missing')
    expect(sv.textContent).toContain('The latest survey results could not be read.')
    expect(within(sv).getByRole('link').getAttribute('href')).toContain('mar-2031-data.xlsx')
    expect(block('terminal-fed-survey-credit').textContent).toContain('Federal Reserve Bank of New York')
    const pr = block('terminal-fed-projections-missing')
    expect(pr.textContent).toContain("The projections could not be read from the Board's page.")
    expect(within(pr).getByRole('link').getAttribute('href')).toContain('fomcprojtabl20310304')
    expect(block('terminal-fed-speeches-partial').textContent).toBe('Testimony could not be read just now; the list shows the rest.')
  })

  it('figures still shown after a newer look at the Board failed say so above them', async () => {
    serve({ [FED_URL]: answer({
      statement: { ...STATEMENT, check: { state: 'unavailable', reason: 'refused', http_status: 403 } },
      speeches: { ...answer().speeches, checks: { testimony: { state: 'failed', reason: 'timeout', http_status: null } } },
    }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-fed-statement-stale')).textContent)
      .toBe("The Board's website did not let the server look for anything newer, so this is what the server read before. It looks again by itself.")
    expect(block('terminal-fed-speeches-stale').textContent).toContain('did not get an answer, so this is what the server read before.')
    expect(screen.getByTestId('terminal-fed-redline')).toBeTruthy()
  })

  it('a calendar not held, no meeting ahead and no speaker this week are each said', async () => {
    serve({ [FED_URL]: answer({ calendar: { next_meeting: { state: 'none', date: null, reason: 'no_meeting_held' }, this_week: { state: 'not_held', items: [] } } }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-fed-week-not-held')).textContent).toContain('not held on the server right now')
    expect(block('terminal-fed-next').textContent).toBe('No FOMC decision ahead is in the calendar the server holds.')
    cleanup()
    serve({ [FED_URL]: answer({ calendar: { ...answer().calendar, this_week: { state: 'ok', items: [], total: 0 } } }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-fed-week-none')).textContent).toBe('The calendar lists no Fed speaker this week.')
  })
})

describe('FED rails', () => {
  it('has no axe violations with every block, with blocks missing, and after a failed read', async () => {
    serve({ [FED_URL]: answer() })
    const ok = renderPanel()
    await screen.findByTestId('terminal-fed-redline')
    await expectNoAxeViolations(ok.container)
    cleanup()
    serve({ [FED_URL]: answer({ statement: { state: 'unavailable' }, survey: { state: 'unreadable' }, headlines: { state: 'off' } }) })
    const thin = renderPanel()
    await screen.findByTestId('terminal-fed-statement-missing')
    await expectNoAxeViolations(thin.container)
    cleanup()
    serve({})
    const failed = renderPanel()
    await screen.findByTestId('terminal-fed-error')
    await expectNoAxeViolations(failed.container)
  })

  it('paints no hard-coded color and no price color: the panel, its model and its stylesheet use tokens only', () => {
    for (const file of ['FedWatchPanel.jsx', 'fedWatchModel.js', 'fedWatchPanel.module.css']) {
      const src = fs.readFileSync(path.join(HERE, file), 'utf8')
      expect(colourLiteralsIn(src, file), file).toEqual([])
    }
    const css = fs.readFileSync(path.join(HERE, 'fedWatchPanel.module.css'), 'utf8')
    expect(css).not.toMatch(/--(success|danger|gain|loss)/)
    expect(css).not.toMatch(/@media|infinite/)
  })

  it('reads through the terminal\'s one reader and reports the answer\'s time through the panel header', () => {
    const src = fs.readFileSync(path.join(HERE, 'FedWatchPanel.jsx'), 'utf8')
    expect(src).toMatch(/useMarketRead\(FED_URL/)
    expect(src).toMatch(/usePanelFreshness\(ok \? panelAsOf\(FED_SOURCE, view\.builtAt\) : null\)/)
    expect(src).not.toMatch(/setInterval|setTimeout|fetch\(/)
    expect(process.env.NODE_ENV).not.toBe('production')
  })
})
