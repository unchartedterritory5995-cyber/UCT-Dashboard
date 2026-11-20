// CEOS: what CEOs are saying. Rails:
//   * the two lists with their numbers as sent, and what the month was compared with;
//   * a phrase opens the call search on it BESIDE this panel, a ticker loads the company, and the
//     row numbers open the same phrases;
//   * the chips: a list, a month; each writes itself into the command where the registry takes it;
//   * every state that is not a list is said as what it is: loading, a failed read (Retry), a
//     paywall and signed out (no Retry on a paywall), the server still working the lists out (the
//     panel asks again by itself), an empty index, too few calls, a month with no list, a failed
//     build, an answer that is not this route's shape, an old answer being replaced;
//   * a list the server cut says so and from which end; a missing number is never drawn as 0;
//   * the method text states the measure with the server's own thresholds;
//   * no transcript text, no color literal, and axe.
// The fixture is the route's real shape (api/services/call_themes.py get_themes), with made-up
// tickers and phrases.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import CallThemesPanel, { CALL_THEMES_URL, builtText, comparedSentence, holdsSentence, callThemesRead } from './CallThemesPanel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const SOURCE = 'UCT earnings call index (recent call transcripts)'
const row = (phrase, over = {}) => ({
  phrase, words: phrase.split(' ').length, calls: 42, pct: 14.0, companies: 41, base_calls: 0, base_pct: 0.0, base_raw_pct: 0.0,
  rise: 14.0, ratio: null, related: [], examples: ['AAA', 'BBB', 'CCC'], ...over,
})
const RULES = { min_month_calls: 100, min_base_calls: 100, base_months: 3, min_calls: 8, min_share_pct: 2.0, min_companies: 6, new_max_base_pct: 0.5, rise_min_points: 2.0, rise_min_ratio: 1.25, rise_min_ratio_one_word: 2.0, min_z: 3.0, list_cap: 30, max_words: 3 }
const CORPUS = { calls: 790, oldest: '2026-08-19', newest: '2026-11-17', months: [{ month: '2026-08', calls: 110 }, { month: '2026-09', calls: 120 }, { month: '2026-10', calls: 260 }, { month: '2026-11', calls: 300 }] }
const OK = {
  status: 'ok', month: '2026-11', months: ['2026-11', '2026-10'], calls: 300, companies: 296,
  baseline: { months: ['2026-08', '2026-09', '2026-10'], calls: 490, matched_pct: 92.5 },
  floor: { calls: 8, companies: 6 },
  new: [
    row('government shutdown', { related: ['federal orders', 'agencies'] }),
    row('agentic commerce', { calls: 18, pct: 6.0, companies: 18, rise: 5.8, base_calls: 1, base_pct: 0.2, base_raw_pct: 0.2, ratio: 30.0, examples: ['DDD'] }),
  ],
  rising: [
    row('tariffs', { calls: 101, pct: 33.7, companies: 99, base_calls: 67, base_pct: 13.2, base_raw_pct: 13.7, rise: 20.5, ratio: 2.6, related: ['tariff impact'] }),
    row('data center', { calls: 98, pct: 32.7, companies: 97, base_calls: 96, base_pct: 18.6, base_raw_pct: 19.6, rise: 14.1, ratio: 1.8, examples: [] }),
  ],
  qualified: { new: 2, rising: 2 },
  built_at: '2026-11-17T11:52:00Z', refreshing: false, corpus: CORPUS, rules: RULES,
}
const OCT = { ...OK, month: '2026-10', calls: 260, companies: 258, baseline: { months: ['2026-08', '2026-09'], calls: 230, matched_pct: 88.0 }, new: [], rising: [row('electrification', { base_calls: 20, base_pct: 6.0, base_raw_pct: 8.7, rise: 8.0, ratio: 2.3 })], qualified: { new: 0, rising: 1 } }
const OCT_URL = `${CALL_THEMES_URL}?month=2026-10`

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
const asked = () => jsonFetcher.mock.calls.map(([url]) => url)

function renderPanel(props = {}, { open = vi.fn(), run = vi.fn(), rerun = vi.fn(), publishRows = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const body = <CallThemesPanel {...props} />
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run, rerun, publish: vi.fn(), publishRows }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { open, run, rerun, publishRows, setFreshness }
}
const rowsOf = (testId) => within(screen.getByTestId(testId)).getAllByRole('row').slice(1)
/** A row's cells as text, with the no-break spaces the panel uses read as plain spaces. */
const cells = (r) => within(r).getAllByRole('cell').map((c) => c.textContent.replace(/ /g, ' '))
const HERE = path.dirname(fileURLToPath(import.meta.url))

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(() => { vi.useRealTimers(); cleanup() })

describe('CEOS the lists', () => {
  it('bare CEOS reads the newest month once and draws both lists with their numbers as sent', async () => {
    serve({ [CALL_THEMES_URL]: OK })
    renderPanel()
    expect(screen.getByTestId('terminal-ceos-loading')).toBeTruthy()
    await screen.findByTestId('terminal-ceos-new-table')
    expect(asked()).toEqual([CALL_THEMES_URL])
    expect(screen.getByTestId('terminal-ceos-totals').textContent)
      .toBe('Nov 2026: 300 indexed earnings calls from 296 companies, compared with Aug 2026 to Oct 2026 (490 calls).')
    const [shutdown, agentic] = rowsOf('terminal-ceos-new-table')
    expect(cells(shutdown)).toEqual(['1government shutdown with federal orders, agencies', '14.0% 42 calls', '0.0%', 'Not said before', '41 e.g. AAA, BBB, CCC'])
    expect(cells(agentic)).toEqual(['2agentic commerce', '6.0% 18 calls', '0.2%', '+5.8 pts 30.0×', '18 e.g. DDD'])
    const [tariffs, dc] = rowsOf('terminal-ceos-rising-table')
    expect(cells(tariffs)).toEqual(['3tariffs with tariff impact', '33.7% 101 calls', '13.2%', '+20.5 pts 2.6×', '99 e.g. AAA, BBB, CCC'])
    expect(cells(dc)).toEqual(['4data center', '32.7% 98 calls', '18.6%', '+14.1 pts 1.8×', '97'])
    expect(screen.getByTestId('terminal-ceos').getAttribute('data-month')).toBe('2026-11')
    expect(screen.getByTestId('terminal-ceos-list-both').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('terminal-ceos-month-2026-11').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('terminal-ceos-month-2026-10').getAttribute('aria-pressed')).toBe('false')
  })

  it('the header carries the source and when the lists were worked out, and the row numbers open the same phrases', async () => {
    serve({ [CALL_THEMES_URL]: OK })
    const { publishRows, setFreshness } = renderPanel()
    await screen.findByTestId('terminal-ceos-new-table')
    await waitFor(() => expect(publishRows).toHaveBeenLastCalledWith(['TSRC "government shutdown"', 'TSRC "agentic commerce"', 'TSRC tariffs', 'TSRC "data center"']))
    const report = setFreshness.mock.calls.map(([r]) => r).filter(Boolean).pop()
    expect(report.source).toBe(SOURCE)
    expect(report.observedAt).toBe('2026-11-17T11:52:00.000Z')
  })

  it('a phrase opens the call search on it beside the panel; a ticker loads the company', async () => {
    serve({ [CALL_THEMES_URL]: OK })
    const { open, run } = renderPanel()
    await screen.findByTestId('terminal-ceos-new-table')
    fireEvent.click(screen.getByRole('button', { name: 'Open the calls that say government shutdown (TSRC "government shutdown")' }))
    expect(open).toHaveBeenLastCalledWith('TSRC "government shutdown"')
    fireEvent.click(screen.getByRole('button', { name: 'Open the calls that say tariffs (TSRC tariffs)' }))
    expect(open).toHaveBeenLastCalledWith('TSRC tariffs')
    fireEvent.click(within(rowsOf('terminal-ceos-new-table')[1]).getByTestId('panel-symbol-DDD'))
    expect(run).toHaveBeenLastCalledWith('$DDD')
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('outside the terminal a phrase and a ticker are plain text', async () => {
    serve({ [CALL_THEMES_URL]: OK })
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><CallThemesPanel /></SWRConfig>)
    await screen.findByTestId('terminal-ceos-new-table')
    expect(screen.queryAllByRole('button', { name: /Open the calls/ })).toEqual([])
    expect(screen.getByTestId('terminal-ceos-new-table').textContent).toContain('government shutdown')
  })

  it('both lists show ten rows each with a way to the rest; one list shows all of it and the numbers restart', async () => {
    const many = { ...OK, new: Array.from({ length: 14 }, (_, i) => row(`theme ${String.fromCharCode(97 + i)}`)), qualified: { new: 14, rising: 2 } }
    serve({ [CALL_THEMES_URL]: many })
    const { publishRows } = renderPanel({}, { code: 'CEOS' })
    await screen.findByTestId('terminal-ceos-new-table')
    expect(rowsOf('terminal-ceos-new-table')).toHaveLength(10)
    expect(cells(rowsOf('terminal-ceos-rising-table')[0])[0]).toBe('11tariffs with tariff impact')
    const more = screen.getByTestId('terminal-ceos-new-all')
    expect(more.textContent).toBe('Show all 14 (CEOS NEW)')
    expect(screen.queryByTestId('terminal-ceos-rising-all')).toBeNull()
    fireEvent.click(more)
    await waitFor(() => expect(rowsOf('terminal-ceos-new-table')).toHaveLength(14))
    expect(screen.queryByTestId('terminal-ceos-rising')).toBeNull()
    expect(screen.queryByTestId('terminal-ceos-new-all')).toBeNull()
    await waitFor(() => expect(publishRows.mock.calls.at(-1)[0]).toHaveLength(14))
    expect(asked()).toEqual([CALL_THEMES_URL])                       // a list is a view of the same read
  })

  it('a list the server cut says how many passed and that the weakest were left out', async () => {
    serve({ [CALL_THEMES_URL]: { ...OK, qualified: { new: 2, rising: 212 } } })
    renderPanel({ list: 'RISING' })
    await screen.findByTestId('terminal-ceos-rising-table')
    expect(screen.getByTestId('terminal-ceos-rising-cut').textContent)
      .toBe('212 phrases passed; the server keeps the 2 that rose most, so the ones left out are the weakest.')
    expect(screen.queryByTestId('terminal-ceos-new')).toBeNull()
    expect(screen.getByTestId('terminal-ceos-rising-table').getAttribute('aria-label')).toBe('Rising across earnings calls in Nov 2026, 2 of 212 phrases')
  })

  it('a list with nothing in it says the count found nothing, and the other list is still drawn', async () => {
    serve({ [CALL_THEMES_URL]: { ...OK, new: [], qualified: { new: 0, rising: 2 } } })
    renderPanel()
    await screen.findByTestId('terminal-ceos-rising-table')
    expect(within(screen.getByTestId('terminal-ceos-new-empty')).getByText('No phrase is new in Nov 2026.')).toBeTruthy()
    expect(screen.getByTestId('terminal-ceos-new-empty').textContent).toContain('not a failed read')
    expect(cells(rowsOf('terminal-ceos-rising-table')[0])[0]).toBe('1tariffs with tariff impact')
  })

  it('a missing number is n/a, never 0', async () => {
    serve({ [CALL_THEMES_URL]: { ...OK, companies: null, new: [{ phrase: 'agentic commerce', calls: 18 }], qualified: { new: 1, rising: 2 } } })
    renderPanel({ list: 'NEW' })
    await screen.findByTestId('terminal-ceos-new-table')
    expect(cells(rowsOf('terminal-ceos-new-table')[0])).toEqual(['1agentic commerce', 'n/a 18 calls', 'n/a', 'n/a', 'n/a'])
    expect(screen.getByTestId('terminal-ceos-totals').textContent).toBe('Nov 2026: 300 indexed earnings calls, compared with Aug 2026 to Oct 2026 (490 calls).')
  })
})

describe('CEOS the chips and the typed words', () => {
  it('CEOS RISING 2026-10 asks for that month and shows that list', async () => {
    serve({ [OCT_URL]: OCT })
    renderPanel({ list: 'rising', month: '2026-10' })
    await screen.findByTestId('terminal-ceos-rising-table')
    expect(asked()).toEqual([OCT_URL])
    expect(screen.queryByTestId('terminal-ceos-new')).toBeNull()
    expect(screen.getByTestId('terminal-ceos-totals').textContent).toContain('Oct 2026: 260 indexed earnings calls from 258 companies, compared with Aug 2026 to Sep 2026 (230 calls).')
    expect(screen.getByTestId('terminal-ceos-month-2026-10').getAttribute('aria-pressed')).toBe('true')
  })

  it('a chip writes its choice into the command: the list, an earlier month, and back to the bare command', async () => {
    serve({ [CALL_THEMES_URL]: OK, [OCT_URL]: OCT })
    const { rerun } = renderPanel({}, { code: 'CEOS' })
    await screen.findByTestId('terminal-ceos-new-table')
    fireEvent.click(screen.getByTestId('terminal-ceos-list-rising'))
    expect(rerun).toHaveBeenLastCalledWith('CEOS RISING')
    fireEvent.click(screen.getByTestId('terminal-ceos-month-2026-10'))
    expect(rerun).toHaveBeenLastCalledWith('CEOS RISING 2026-10')
    await screen.findByText(/Oct 2026: 260 indexed/)
    expect(asked()).toEqual([CALL_THEMES_URL, OCT_URL])
    fireEvent.click(screen.getByTestId('terminal-ceos-month-2026-11'))     // the newest month is never written
    expect(rerun).toHaveBeenLastCalledWith('CEOS RISING')
    fireEvent.click(screen.getByTestId('terminal-ceos-list-both'))
    expect(rerun).toHaveBeenLastCalledWith('CEOS')
  })

  it('inside a panel whose code does not take the words, a chip still switches and writes nothing', async () => {
    serve({ [CALL_THEMES_URL]: OK })
    const { rerun } = renderPanel({}, { code: 'MOST' })
    await screen.findByTestId('terminal-ceos-new-table')
    fireEvent.click(screen.getByTestId('terminal-ceos-list-new'))
    await waitFor(() => expect(screen.queryByTestId('terminal-ceos-rising')).toBeNull())
    expect(rerun).not.toHaveBeenCalled()
  })

  it('a typed word that is not a list or a month falls back to both lists of the newest month', async () => {
    serve({ [CALL_THEMES_URL]: OK })
    renderPanel({ list: 'banana', month: 'soon' })
    await screen.findByTestId('terminal-ceos-new-table')
    expect(asked()).toEqual([CALL_THEMES_URL])
    expect(screen.getByTestId('terminal-ceos').getAttribute('data-list')).toBe('both')
  })
})

describe('CEOS states that are not a list', () => {
  it('a failed read is an error with Retry, never an empty list', async () => {
    serve({ [CALL_THEMES_URL]: fail(500) })
    renderPanel({}, { code: 'CEOS' })
    const box = await screen.findByTestId('terminal-ceos-error')
    expect(box.getAttribute('data-kind')).toBe('error')
    expect(box.textContent).toContain('What CEOs are saying could not be read just now.')
    expect(box.textContent).toContain('That is not the same as no theme. Retry, or run CEOS again.')
    expect(screen.queryByTestId('terminal-ceos-new')).toBeNull()
    serve({ [CALL_THEMES_URL]: OK })
    fireEvent.click(within(box).getByRole('button', { name: 'Retry' }))
    await screen.findByTestId('terminal-ceos-new-table')
  })

  it('a paywall is locked with no Retry; signed out says so', async () => {
    serve({ [CALL_THEMES_URL]: fail(402) })
    renderPanel()
    const locked = await screen.findByTestId('terminal-ceos-error')
    expect(locked.getAttribute('data-kind')).toBe('locked')
    expect(locked.textContent).toBe('What CEOs are saying needs a paid plan.')
    expect(within(locked).queryByRole('button')).toBeNull()
    cleanup()
    serve({ [CALL_THEMES_URL]: fail(401) })
    renderPanel()
    expect((await screen.findByTestId('terminal-ceos-error')).textContent).toContain('You are signed out, so what CEOs are saying cannot be read. Sign in again.')
  })

  it('a read that times out says so', async () => {
    serve({ [CALL_THEMES_URL]: Object.assign(new Error('deadline'), { timedOut: true }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-ceos-error')).textContent).toContain('What CEOs are saying did not answer within 30 seconds.')
  })

  it('while the server works the lists out the panel says so and asks again by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    serve({ [CALL_THEMES_URL]: { status: 'computing' } })
    renderPanel()
    const box = await screen.findByTestId('terminal-ceos-computing')
    expect(box.textContent).toContain('Loading, the server is preparing this.')
    expect(box.textContent).toContain('asks again every 20 seconds')
    expect(box.textContent).toContain('That is not the same as no theme.')
    expect(asked()).toHaveLength(1)
    serve({ [CALL_THEMES_URL]: OK })
    await act(async () => { await vi.advanceTimersByTimeAsync(20500) })
    await screen.findByTestId('terminal-ceos-new-table')
    expect(asked().length).toBeGreaterThanOrEqual(2)
    const settled = asked().length
    await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
    expect(asked()).toHaveLength(settled)                              // a finished list is not polled
  })

  it('an index with no calls is a gap on our side, not a finding', async () => {
    serve({ [CALL_THEMES_URL]: { status: 'empty', months: [], built_at: OK.built_at, corpus: { calls: 0, months: [] }, rules: RULES } })
    renderPanel()
    const box = await screen.findByTestId('terminal-ceos-index-empty')
    expect(box.textContent).toContain('The call index holds no calls right now.')
    expect(box.textContent).toContain('That is a gap on our side, not a finding about what companies said.')
    expect(within(box).getByRole('button', { name: 'Check again' })).toBeTruthy()
  })

  it('too few calls says what a month needs and what the index holds', async () => {
    serve({ [CALL_THEMES_URL]: { status: 'thin', months: [], built_at: OK.built_at, corpus: { calls: 102, months: [{ month: '2026-10', calls: 40 }, { month: '2026-11', calls: 62 }] }, rules: RULES } })
    renderPanel()
    const box = await screen.findByTestId('terminal-ceos-thin')
    expect(box.textContent).toContain('Too few calls are indexed to compare one month with another yet.')
    expect(box.textContent).toContain('A month needs 100 indexed calls, and the months before it 100 between them.')
    expect(box.textContent).toContain('The index holds 40 in Oct 2026, 62 in Nov 2026.')
    expect(box.textContent).toContain('That is not the same as no theme.')
  })

  it('a month with no list names the months that have one and offers the newest', async () => {
    const SEP_URL = `${CALL_THEMES_URL}?month=2026-09`
    serve({ [SEP_URL]: { status: 'no_month', month: '2026-09', months: ['2026-11', '2026-10'], built_at: OK.built_at, corpus: CORPUS, rules: RULES }, [CALL_THEMES_URL]: OK })
    const { rerun } = renderPanel({ month: '2026-09' }, { code: 'CEOS' })
    const box = await screen.findByTestId('terminal-ceos-no-month')
    expect(box.textContent).toContain('There is no list for Sep 2026.')
    expect(box.textContent).toContain('Nov 2026 and Oct 2026.')
    fireEvent.click(screen.getByTestId('terminal-ceos-newest'))
    expect(rerun).toHaveBeenLastCalledWith('CEOS')
    await screen.findByTestId('terminal-ceos-new-table')
  })

  it('a failed build and an answer that is not this route\'s shape are errors with Retry', async () => {
    serve({ [CALL_THEMES_URL]: { status: 'error' } })
    renderPanel()
    const box = await screen.findByTestId('terminal-ceos-error')
    expect(box.textContent).toContain('The lists could not be worked out just now.')
    expect(within(box).getByRole('button', { name: 'Retry' })).toBeTruthy()
    cleanup()
    serve({ [CALL_THEMES_URL]: { rows: [] } })
    renderPanel()
    expect((await screen.findByTestId('terminal-ceos-error')).textContent).toContain('The lists could not be worked out just now.')
    expect(screen.queryByTestId('terminal-ceos-new')).toBeNull()
  })

  it('an old answer being replaced is shown with its date and a note', async () => {
    serve({ [CALL_THEMES_URL]: { ...OK, built_at: '2026-11-10T11:52:00Z', refreshing: true } })
    renderPanel({}, { code: 'CEOS' })
    await screen.findByTestId('terminal-ceos-new-table')
    expect(screen.getByTestId('terminal-ceos-refreshing').textContent)
      .toBe('These lists were worked out Nov 10, 6:52 AM ET and the daily update has not replaced them yet. The server is working out new ones now; run CEOS again in a few minutes.')
  })
})

describe('CEOS wording', () => {
  it('the method text states the measure with the server\'s own thresholds', async () => {
    serve({ [CALL_THEMES_URL]: OK })
    renderPanel()
    await screen.findByTestId('terminal-ceos-new-table')
    const method = screen.getByTestId('terminal-ceos-method').textContent.replace(/\s+/g, ' ')
    for (const say of [
      'a one-, two- or three-word phrase counts once per call however often the call says it',
      "Share of calls is the calls that said it over the month's 300 calls",
      "weighted to this month's mix of industries",
      "92.5% of this month's calls were matched to their own industry or sector",
      'New means 0.5% of the earlier calls or fewer said it',
      'up by 2 points or more and is 1.25 times the share before or more (a single word, 2 times)',
      'needs 8 calls from 6 different companies this month',
      'a gap at least 3 times what chance alone would produce',
      'speaker names',
      'analysts as well as executives',
      'not what a stock will do',
      'Worked out Nov 17, 6:52 AM ET; updated once a day.',
    ]) expect(method, say).toContain(say)
  })

  it('with no industry map the method text says the months were compared as they are', async () => {
    serve({ [CALL_THEMES_URL]: { ...OK, baseline: { ...OK.baseline, matched_pct: 0.0 } } })
    renderPanel()
    await screen.findByTestId('terminal-ceos-new-table')
    const method = screen.getByTestId('terminal-ceos-method').textContent.replace(/\s+/g, ' ')
    expect(method).toContain('compared as they are (the industry map could not be read')
    expect(method).not.toContain('matched to their own industry')
  })

  it('the pure sentences', () => {
    expect(builtText('2026-11-17T11:52:00Z')).toBe('Nov 17, 6:52 AM ET')
    expect(builtText(null)).toBe('')
    expect(builtText('not a time')).toBe('')
    expect(comparedSentence(callThemesRead({ ...OK, calls: 1, companies: 1, baseline: { months: ['2026-10'], calls: 1 } })))
      .toBe('Nov 2026: 1 indexed earnings call from 1 company, compared with Oct 2026 (1 call).')
    expect(comparedSentence(callThemesRead({ status: 'computing' }))).toBe('')
    expect(holdsSentence({ months: [] })).toBe('')
  })

  it('the panel and its model use app tokens only, no color literal', () => {
    for (const f of ['CallThemesPanel.jsx', 'callThemesModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('CEOS accessibility', () => {
  it('the lists, a single list and the states pass axe (WCAG A and AA)', async () => {
    serve({ [CALL_THEMES_URL]: OK })
    renderPanel()
    await screen.findByTestId('terminal-ceos-new-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    fireEvent.click(screen.getByTestId('terminal-ceos-list-rising'))
    await waitFor(() => expect(screen.queryByTestId('terminal-ceos-new')).toBeNull())
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [CALL_THEMES_URL]: { status: 'thin', months: [], corpus: { calls: 40, months: [{ month: '2026-11', calls: 40 }] }, rules: RULES } })
    renderPanel()
    await screen.findByTestId('terminal-ceos-thin')
    await expectNoAxeViolations(document.body.firstElementChild)
  })
})
