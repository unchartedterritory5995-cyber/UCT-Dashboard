// TSRC: search every indexed earnings call. Rails:
//   * nothing is asked until the member submits a search, and a query the server would refuse
//     (under 2 characters) is stopped in the panel;
//   * loading, a failed search (error with Retry), a paywall and a switched-off route (no Retry),
//     signed out;
//   * a query the server cannot read, a failed search and an EMPTY INDEX are each said as what
//     they are; only a healthy search over an index that holds calls says no call mentions it;
//   * the quote is the server's excerpt as text (markup in a transcript is never run), and no
//     speaker is shown because the index has none;
//   * the two reads fail apart; the cut is said, and from which end;
//   * rising or fading is shown with the two numbers it stands on;
//   * a symbol loads into the linked panels; row numbers follow the rows on screen;
//   * saving the search as a call alert is offered on a result the index read and answered (above
//     the quotes, or under "no call mentions it"), and nowhere else. The control's own states are
//     in CallAlertSave.test.jsx.
// The fixtures are the routes' real shapes (api/services/transcript_index.py), made-up tickers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import CallSearchPanel, { CALL_SEARCH_CODE, callSearchUrl, callTrendUrl, indexSpanSentence, trendRead, trendVerdict, verdictSentence } from './CallSearchPanel'
import { CALL_ALERTS_URL } from './callAlertModel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const SOURCE = 'UCT earnings call index (recent call transcripts)'
const Q = 'tariff'
const S_URL = callSearchUrl(Q)
const T_URL = callTrendUrl(Q)
const SEARCH = {
  query: Q,
  match: '"tariff"',
  total: 3,
  hits: [
    { symbol: 'AAA', year: 2026, quarter: 3, date: '2026-11-05 17:00:00', snippet: 'we expect the <mark>tariff</mark> impact to be about … offset by <mark>tariffs</mark> relief', score: 4.211 },
    { symbol: 'BBB', year: 2026, quarter: 2, date: '2026-08-12', snippet: 'no change to our <mark>tariff</mark> assumptions <script>window.__ran = 1</script>', score: 2.5 },
    { symbol: 'CCC', year: 2027, quarter: 1, date: '', snippet: '<mark>Tariff</mark> costs were', score: 1.1 },
  ],
}
const month = (m, calls, mentions) => ({ month: m, calls, mentions, pct: calls ? Math.round((mentions * 1000) / calls) / 10 : null })
const TREND = { query: Q, match: '"tariff"', months: [month('2026-08', 400, 40), month('2026-09', 60, 9), month('2026-10', 500, 75), month('2026-11', 300, 90)], total: 214 }
const EMPTY_INDEX = { query: Q, match: '"tariff"', months: [], total: 0 }
/** The member's call alerts (GET /api/earnings/keyword-alerts): served to every test unless it says otherwise. */
const ALERTS = { keywords: ['buyback'], max: 25, min_length: 3, enabled: true }

const fail = (status) => Object.assign(new Error(`http ${status}`), { status })
const PENDING = Symbol('pending')
/** Serves each URL its body (an Error is thrown, PENDING never answers); anything else is a 500.
 *  A write (a request with a method) is answered by `routes['POST <url>']`, else it is a 500. */
function serve(given) {
  const routes = { [CALL_ALERTS_URL]: ALERTS, ...given }
  jsonFetcher.mockImplementation((url, init) => {
    const key = init?.method ? `${init.method} ${url}` : url
    if (!(key in routes)) return Promise.reject(fail(500))
    const hit = routes[key]
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
const asked = () => jsonFetcher.mock.calls.map(([url]) => url)

function renderPanel(props = {}, { run = vi.fn(), rerun = vi.fn(), publishRows = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const body = <CallSearchPanel {...props} />
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run, rerun, publish: vi.fn(), publishRows }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { run, rerun, publishRows, setFreshness }
}
const rowsOf = () => within(screen.getByTestId('terminal-tsrc-table')).getAllByRole('row').slice(1)
const search = (words) => {
  fireEvent.change(screen.getByTestId('terminal-tsrc-input'), { target: { value: words } })
  fireEvent.click(screen.getByTestId('terminal-tsrc-submit'))
}
const HERE = path.dirname(fileURLToPath(import.meta.url))

beforeEach(() => { jsonFetcher.mockReset(); delete window.__ran })
afterEach(cleanup)

describe('TSRC searching', () => {
  it('asks for nothing until a search is submitted, and never on a keystroke', async () => {
    serve({ [S_URL]: SEARCH, [T_URL]: TREND })
    renderPanel()
    expect(CALL_SEARCH_CODE).toBe('TSRC')
    const idle = screen.getByTestId('terminal-tsrc-idle')
    expect(idle.getAttribute('data-kind')).toBe('input')
    expect(idle.textContent).toContain('Type a word or a phrase to search every indexed earnings call.')
    expect(idle.textContent).toContain('TSRC tariff')
    for (const typed of ['t', 'ta', 'tar', 'tariff']) fireEvent.change(screen.getByTestId('terminal-tsrc-input'), { target: { value: typed } })
    expect(asked()).toEqual([])
    fireEvent.click(screen.getByTestId('terminal-tsrc-submit'))
    await screen.findByTestId('terminal-tsrc-table')
    // the search, the month count, and (once there is a result) the member's call alerts
    expect([...new Set(asked())].sort()).toEqual([CALL_ALERTS_URL, S_URL, T_URL].sort())
    expect(screen.getByTestId('terminal-tsrc').getAttribute('data-query')).toBe('tariff')
  })

  it('stops a query the server would refuse, with a sentence, and asks for nothing', () => {
    serve({})
    renderPanel()
    search('a')
    const error = screen.getByTestId('terminal-tsrc-form-error')
    expect(error.textContent).toBe('Type at least 2 characters.')
    expect(error.getAttribute('role')).toBe('alert')
    expect(screen.getByTestId('terminal-tsrc-input').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByTestId('terminal-tsrc-input').getAttribute('aria-describedby')).toBe(error.id)
    search('   ')
    expect(screen.getByTestId('terminal-tsrc-form-error').textContent).toBe('Type a word or a phrase to search for.')
    search('"--"')
    expect(screen.getByTestId('terminal-tsrc-form-error').textContent).toBe('Type a word: the search needs at least one letter or number.')
    expect(asked()).toEqual([])
    expect(screen.getByTestId('terminal-tsrc-idle')).toBeTruthy()
  })

  it('words typed after the code that cannot be searched stay in the box with the reason, and nothing is asked', () => {
    serve({})
    renderPanel({ q: ' a ' })
    expect(screen.getByTestId('terminal-tsrc-input').value).toBe('a')
    expect(screen.getByTestId('terminal-tsrc-form-error').textContent).toBe('Type at least 2 characters.')
    expect(screen.getByTestId('terminal-tsrc-idle')).toBeTruthy()
    expect(asked()).toEqual([])
    cleanup()
    // no words typed is not an error
    renderPanel({ q: null })
    expect(screen.queryByTestId('terminal-tsrc-form-error')).toBeNull()
  })

  it('the typed words seed the search, and a new search inside a panel that does not take words writes nothing', async () => {
    const other = 'pricing power'
    serve({ [S_URL]: SEARCH, [T_URL]: TREND, [callSearchUrl(other)]: { ...SEARCH, query: other, hits: [SEARCH.hits[2]], total: 1 }, [callTrendUrl(other)]: TREND })
    const { rerun } = renderPanel({ q: '  tariff ' }, { code: 'MOST' })
    await screen.findByTestId('terminal-tsrc-table')
    expect(screen.getByTestId('terminal-tsrc-input').value).toBe('tariff')
    expect(rowsOf()).toHaveLength(3)
    search('pricing   power')
    await waitFor(() => expect(rowsOf()).toHaveLength(1))
    expect(screen.getByTestId('terminal-tsrc-input').value).toBe('pricing power')
    expect(screen.getByTestId('terminal-tsrc-totals').textContent).toContain('1 call mentions pricing power.')
    expect(asked()).toContain(callSearchUrl(other))
    // MOST is a registered code that takes UP and DOWN, not free words: nothing is written back
    expect(rerun).not.toHaveBeenCalled()
  })
})

describe('TSRC states', () => {
  it('shows a loading skeleton while the search is out', () => {
    serve({ [S_URL]: PENDING, [T_URL]: PENDING })
    renderPanel({ q: Q })
    expect(screen.getByTestId('terminal-tsrc-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-tsrc-table')).toBeNull()
  })

  it('a failed search (500) is an error with Retry, never "no call said it"; the month count still shows', async () => {
    serve({ [T_URL]: TREND })
    renderPanel({ q: Q }, { code: 'TSRX' })
    const err = await screen.findByTestId('terminal-tsrc-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The call search could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no call saying it. Retry, or run TSRX tariff again.')
    expect(screen.queryByTestId('terminal-tsrc-empty')).toBeNull()
    // the two reads fail apart
    expect(await screen.findByTestId('terminal-tsrc-trend')).toBeTruthy()
    serve({ [S_URL]: SEARCH, [T_URL]: TREND })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-tsrc-table')).toBeTruthy()
  })

  it('signed out (401) and locked (402, 404) each say so once, and only an error can be retried', async () => {
    for (const [status, kind, words, retry] of [
      [401, 'error', 'You are signed out, so the call search cannot be read. Sign in again.', true],
      [402, 'locked', 'The call search needs a paid plan.', false],
      [404, 'locked', 'The call search is not switched on for this server yet.', false],
    ]) {
      cleanup()
      serve({ [S_URL]: fail(status), [T_URL]: fail(status) })
      renderPanel({ q: Q })
      const state = await screen.findByTestId('terminal-tsrc-error')
      expect(state.getAttribute('data-kind'), String(status)).toBe(kind)
      expect(state.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), String(status)).toBe(retry)
      expect(screen.queryByTestId('terminal-tsrc-trend-error')).toBeNull()
      expect(screen.queryByTestId('terminal-tsrc-empty')).toBeNull()
    }
  })

  it('the search answering "search unavailable" in a 200 is an error, and its raw word is not an empty result', async () => {
    serve({ [S_URL]: { query: Q, hits: [], total: 0, error: 'search unavailable' }, [T_URL]: TREND })
    renderPanel({ q: Q })
    const err = await screen.findByTestId('terminal-tsrc-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.queryByTestId('terminal-tsrc-empty')).toBeNull()
  })

  it('a query the server cannot read shows the server\'s own sentence, and no month count', async () => {
    serve({
      [S_URL]: { query: Q, match: null, hits: [], total: 0, error: 'NEAR needs a word on each side.', query_error: true },
      [T_URL]: { query: Q, months: [], total: 0, error: 'NEAR needs a word on each side.', query_error: true },
    })
    renderPanel({ q: Q })
    const bad = await screen.findByTestId('terminal-tsrc-bad-query')
    expect(bad.getAttribute('data-kind')).toBe('input')
    expect(bad.textContent).toContain('The search could not read that query.')
    expect(bad.textContent).toContain('NEAR needs a word on each side. Change it above and search again.')
    expect(screen.queryByTestId('terminal-tsrc-trend-error')).toBeNull()
    expect(screen.queryByTestId('terminal-tsrc-empty')).toBeNull()
    cleanup()
    serve({ [S_URL]: { query: Q, match: '"x"', hits: [], total: 0, error: 'unsupported search syntax' }, [T_URL]: EMPTY_INDEX })
    renderPanel({ q: Q }, { code: 'TSRX' })
    const syntax = await screen.findByTestId('terminal-tsrc-bad-query')
    expect(syntax.textContent).toContain('The index could not read a symbol in that search.')
    expect(syntax.textContent).toContain('TSRX "pricing power"')
  })

  it('no call mentions it: a finding, with how many calls the index holds', async () => {
    serve({ [S_URL]: { ...SEARCH, hits: [], total: 0 }, [T_URL]: { ...TREND, months: TREND.months.map((m) => ({ ...m, mentions: 0, pct: 0 })), total: 0 } })
    const { setFreshness } = renderPanel({ q: Q })
    const empty = await screen.findByTestId('terminal-tsrc-empty')
    expect(empty.getAttribute('data-kind')).toBe('empty')
    expect(empty.textContent).toContain('No indexed earnings call mentions tariff.')
    await waitFor(() => expect(empty.textContent).toContain('The index holds 1,260 calls from Aug 2026 to Nov 2026.'))
    expect(empty.textContent).toContain('Only recent calls are indexed')
    expect(setFreshness.mock.calls.every(([report]) => report == null)).toBe(true)
  })

  it('an empty index is said as a gap on our side, never as "no call mentions it"', async () => {
    serve({ [S_URL]: { ...SEARCH, hits: [], total: 0 }, [T_URL]: EMPTY_INDEX })
    renderPanel({ q: Q })
    const gap = await screen.findByTestId('terminal-tsrc-index-empty')
    expect(gap.getAttribute('data-kind')).toBe('error')
    expect(gap.textContent).toContain('The call index holds no calls right now.')
    expect(gap.textContent).toContain('That is a gap on our side, not a finding about what companies said.')
    expect(screen.queryByTestId('terminal-tsrc-empty')).toBeNull()
    expect(screen.queryByTestId('terminal-tsrc-verdict')).toBeNull()
  })
})

describe('TSRC populated', () => {
  it('lists the calls with the quarter, the date and the quote, and says the theme is rising with both numbers', async () => {
    serve({ [S_URL]: SEARCH, [T_URL]: TREND })
    const { setFreshness, publishRows } = renderPanel({ q: Q })
    await screen.findByTestId('terminal-tsrc-table')
    await screen.findByTestId('terminal-tsrc-trend')
    const cells = rowsOf().map((r) => r.textContent)
    // the call date is written with hyphens that never break a line (U+2011)
    for (const s of ['1', 'AAA', 'fiscal Q3 2026', '2026‑11‑05', 'we expect the tariff impact to be about … offset by tariffs relief']) expect(cells[0]).toContain(s)
    for (const s of ['2', 'BBB', 'fiscal Q2 2026', '2026‑08‑12', 'no change to our tariff assumptions']) expect(cells[1]).toContain(s)
    for (const s of ['3', 'CCC', 'fiscal Q1 2027', 'date not given', 'Tariff costs were']) expect(cells[2]).toContain(s)
    // the matched words are marked, and only those
    expect([...rowsOf()[0].querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['tariff', 'tariffs'])
    // markup inside a transcript is shown as text and never run
    expect(cells[1]).toContain('<script>window.__ran = 1</script>')
    expect(rowsOf()[1].querySelector('script')).toBeNull()
    expect(window.__ran).toBeUndefined()
    expect(screen.getByTestId('terminal-tsrc-totals').textContent).toBe('3 calls mention tariff. The index holds 1,260 calls from Aug 2026 to Nov 2026.')
    expect(screen.queryByTestId('terminal-tsrc-cut')).toBeNull()
    expect(screen.getByRole('table', { name: 'Earnings calls that mention tariff, best match first, 3 of 3' })).toBeTruthy()
    // rising, with what it stands on
    const verdict = screen.getByTestId('terminal-tsrc-verdict')
    expect(verdict.getAttribute('data-trend')).toBe('rising')
    expect(verdict.textContent).toBe('Rising: 30.0% of calls in Nov 2026 (300 calls) against 12.9% across Aug 2026 to Oct 2026 (960 calls).')
    const months = within(screen.getByTestId('terminal-tsrc-trend')).getAllByRole('row').slice(1).map((r) => r.textContent)
    expect(months).toEqual(['Aug 202640 of 40010.0%', 'Sep 20269 of 6015.0%', 'Oct 202675 of 50015.0%', 'Nov 202690 of 30030.0%'])
    // a share the server sends as 30 is 30%, never 3000%
    expect(document.body.textContent).not.toContain('3000')
    // neither route sends an as-of, so the header names the source alone
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith({ source: SOURCE }))
    expect(publishRows).toHaveBeenLastCalledWith(['$AAA', '$BBB', '$CCC'])
    const method = screen.getByTestId('terminal-tsrc-method').textContent
    expect(method).toContain('this panel cannot say who was speaking')
    expect(method).toContain('NVDA TRAN')
    expect(method).toMatch(/Read at \d{1,2}:\d{2} [AP]M ET\./)
    expect(document.body.textContent).not.toMatch(/[—–]/)
    expect(document.body.textContent).not.toMatch(/speaker:/i)
  })

  it('says when the server sent only the best matches, and shows the other words it searched', async () => {
    serve({ [S_URL]: { ...SEARCH, total: 212, operators: true, expanded: { debt: ['borrowings', 'indebtedness'] }, notes: ['Exact words and quoted phrases were checked against the call text.'] }, [T_URL]: TREND })
    renderPanel({ q: Q })
    await screen.findByTestId('terminal-tsrc-table')
    expect(screen.getByTestId('terminal-tsrc-cut').textContent)
      .toBe('Showing the 3 calls that match best of 212. The server ranks by how much a call dwells on the words, so the calls left out are the weakest matches, not the oldest.')
    expect(screen.getByTestId('terminal-tsrc-totals').textContent).toContain('212 calls mention tariff.')
    expect(screen.getByTestId('terminal-tsrc-expanded').textContent).toBe('Also searched: debt as borrowings, indebtedness.')
    expect(screen.getByTestId('terminal-tsrc-note').textContent).toBe('Exact words and quoted phrases were checked against the call text.')
  })

  it('a failed month count leaves the quotes on screen and says what is missing', async () => {
    serve({ [S_URL]: SEARCH })
    renderPanel({ q: Q })
    await screen.findByTestId('terminal-tsrc-table')
    const note = await screen.findByTestId('terminal-tsrc-trend-error')
    expect(note.textContent).toContain('The month by month count could not be read just now.')
    expect(note.textContent).toContain('cannot say whether the theme is rising or fading, or how many calls the index holds.')
    expect(screen.getByTestId('terminal-tsrc-totals').textContent).toBe('3 calls mention tariff.')
    expect(screen.queryByTestId('terminal-tsrc-verdict')).toBeNull()
    serve({ [S_URL]: SEARCH, [T_URL]: TREND })
    fireEvent.click(screen.getByRole('button', { name: 'Retry the count' }))
    expect(await screen.findByTestId('terminal-tsrc-verdict')).toBeTruthy()
  })

  it('too few calls to compare says so instead of a direction', async () => {
    serve({ [S_URL]: SEARCH, [T_URL]: { ...TREND, months: [month('2026-10', 300, 30), month('2026-11', 6, 3)] } })
    renderPanel({ q: Q })
    const verdict = await screen.findByTestId('terminal-tsrc-verdict')
    expect(verdict.getAttribute('data-trend')).toBe('thin')
    expect(verdict.textContent).toBe('Too few calls to say: fewer than two months have 20 or more indexed calls to compare.')
  })

  it('a symbol loads into the linked panels', async () => {
    serve({ [S_URL]: SEARCH, [T_URL]: TREND })
    const { run } = renderPanel({ q: Q })
    await screen.findByTestId('terminal-tsrc-table')
    fireEvent.click(screen.getByTestId('panel-symbol-BBB'))
    expect(run).toHaveBeenCalledWith('$BBB')
  })
})

describe('TSRC call alerts', () => {
  const writes = () => jsonFetcher.mock.calls.filter(([, init]) => init?.method)
  const follows = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

  it('on a result, the save control sits above the quotes and the small print below; a press saves the search', async () => {
    serve({ [S_URL]: SEARCH, [T_URL]: TREND })
    renderPanel({ q: Q })
    await screen.findByTestId('terminal-tsrc-table')
    const save = await screen.findByTestId('terminal-tsrc-alert-button')
    expect(save.textContent).toBe('Save this search as a call alert: tariff')
    expect(follows(save, screen.getByTestId('terminal-tsrc-table'))).toBe(true)
    expect(follows(screen.getByTestId('terminal-tsrc-method'), screen.getByTestId('terminal-tsrc-alert-notes'))).toBe(true)
    expect(screen.getByTestId('terminal-tsrc-alert-notes').textContent).toContain('6:30 PM ET, Monday to Friday')
    // nothing was written by showing it
    expect(writes()).toEqual([])
    // the server takes the save, and holds the word from then on
    const held = ['buyback', 'tariff']
    serve({ [S_URL]: SEARCH, [T_URL]: TREND, [CALL_ALERTS_URL]: { ...ALERTS, keywords: held }, [`POST ${CALL_ALERTS_URL}`]: { ok: true, keyword: 'tariff', keywords: held } })
    fireEvent.click(save)
    await waitFor(() => expect(screen.getByTestId('terminal-tsrc-alert-status').textContent).toBe('Saved as a call alert: tariff.'))
    expect(writes()).toHaveLength(1)
    expect(writes()[0][0]).toBe(CALL_ALERTS_URL)
    expect(writes()[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ keyword: 'tariff' }) })
    expect(screen.getByTestId('terminal-tsrc-alert-button').textContent).toBe('Remove the call alert: tariff')
    // the quotes are still on screen
    expect(rowsOf()).toHaveLength(3)
  })

  it('a search that is already a call alert shows as saved', async () => {
    serve({ [S_URL]: SEARCH, [T_URL]: TREND, [CALL_ALERTS_URL]: { ...ALERTS, keywords: ['buyback', 'tariff'] } })
    renderPanel({ q: Q })
    await screen.findByTestId('terminal-tsrc-table')
    expect((await screen.findByTestId('terminal-tsrc-alert')).getAttribute('data-state')).toBe('saved')
    expect(screen.getByRole('button', { name: 'Remove the call alert: tariff' })).toBeTruthy()
  })

  it('no call says it yet: the search can still be saved, under the finding', async () => {
    serve({ [S_URL]: { ...SEARCH, hits: [], total: 0 }, [T_URL]: { ...TREND, months: TREND.months.map((m) => ({ ...m, mentions: 0, pct: 0 })), total: 0 } })
    renderPanel({ q: Q })
    const empty = await screen.findByTestId('terminal-tsrc-empty')
    const save = await screen.findByTestId('terminal-tsrc-alert-button')
    expect(save.textContent).toBe('Save this search as a call alert: tariff')
    expect(follows(empty, save)).toBe(true)
    expect(screen.getAllByTestId('terminal-tsrc-alert')).toHaveLength(1)
  })

  it('is not offered before a search, on a failed search, on a query the index cannot read, or over an empty index', async () => {
    serve({})
    renderPanel()
    expect(screen.getByTestId('terminal-tsrc-idle')).toBeTruthy()
    expect(asked()).toEqual([])
    for (const [routes, shown] of [
      [{ [T_URL]: TREND }, 'terminal-tsrc-error'],
      [{ [S_URL]: fail(402), [T_URL]: fail(402) }, 'terminal-tsrc-error'],
      [{ [S_URL]: { query: Q, match: null, hits: [], total: 0, error: 'NEAR needs a word on each side.', query_error: true }, [T_URL]: TREND }, 'terminal-tsrc-bad-query'],
      [{ [S_URL]: { ...SEARCH, hits: [], total: 0 }, [T_URL]: EMPTY_INDEX }, 'terminal-tsrc-index-empty'],
    ]) {
      cleanup()
      jsonFetcher.mockReset()
      serve(routes)
      renderPanel({ q: Q })
      await screen.findByTestId(shown)
      expect(screen.queryByTestId('terminal-tsrc-alert'), shown).toBeNull()
      expect(screen.queryByTestId('terminal-tsrc-alert-loading'), shown).toBeNull()
      expect(screen.queryByTestId('terminal-tsrc-alert-error'), shown).toBeNull()
      expect(screen.queryByTestId('terminal-tsrc-alert-notes'), shown).toBeNull()
      expect(asked(), shown).not.toContain(CALL_ALERTS_URL)
    }
  })

  it('a failed read of the call alerts leaves the quotes on screen and says what it cannot know', async () => {
    serve({ [S_URL]: SEARCH, [T_URL]: TREND, [CALL_ALERTS_URL]: fail(500) })
    renderPanel({ q: Q })
    await screen.findByTestId('terminal-tsrc-table')
    const err = await screen.findByTestId('terminal-tsrc-alert-error')
    expect(err.textContent).toContain('The call alert list could not be read just now.')
    expect(screen.queryByTestId('terminal-tsrc-alert-button')).toBeNull()
    expect(rowsOf()).toHaveLength(3)
    expect(await screen.findByTestId('terminal-tsrc-verdict')).toBeTruthy()
  })
})

describe('TSRC sentences', () => {
  it('the verdict and the index span, as sentences', () => {
    const months = trendRead({ ...TREND, months: [month('2026-10', 200, 60), month('2026-11', 200, 20)] }).months
    expect(verdictSentence(trendVerdict(months))).toBe('Fading: 10.0% of calls in Nov 2026 (200 calls) against 30.0% across Oct 2026 (200 calls).')
    expect(verdictSentence(null)).toContain('Too few calls to say')
    expect(indexSpanSentence(trendRead({ ...TREND, months: [month('2026-11', 1, 0)] }))).toBe('The index holds 1 call from Nov 2026.')
    expect(indexSpanSentence(trendRead(EMPTY_INDEX))).toBe('The index holds no calls right now.')
    expect(indexSpanSentence(trendRead(null))).toBe('')
  })
})

describe('TSRC follows the member\'s theme', () => {
  it('the panel, its model and its form styles hold no hard-coded color', () => {
    for (const f of ['CallSearchPanel.jsx', 'callSearchModel.js', 'panelForm.module.css', 'CallAlertSave.jsx', 'callAlertModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('TSRC accessibility', () => {
  it('the search box with a form error passes axe (WCAG A and AA)', async () => {
    serve({})
    renderPanel()
    search('a')
    expect(screen.getByTestId('terminal-tsrc-form-error')).toBeTruthy()
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)

  it('the quotes and the month by month table pass axe (WCAG A and AA)', async () => {
    serve({ [S_URL]: SEARCH, [T_URL]: TREND })
    renderPanel({ q: Q })
    await screen.findByTestId('terminal-tsrc-table')
    await screen.findByTestId('terminal-tsrc-trend')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)
})
