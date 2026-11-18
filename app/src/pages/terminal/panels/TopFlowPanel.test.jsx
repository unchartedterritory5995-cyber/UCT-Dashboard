// TOPF: the Top Flow picks, one by one. Rails:
//   * loading, a failed read (error with Retry), signed out, a switched-off route (no Retry), and
//     an answer that is not the route's shape: none of them is an empty list;
//   * an empty store says what it cannot tell apart (no pick saved, or a store that did not load);
//   * a pick with fewer than two daily prices reads "Too new to score" in words: never 0%, never
//     a loss, and it never ranks among the gains;
//   * the list: contract in two fixed lines, grade and direction, entry, latest price with its
//     gain and its own date, peak and days; an expired pick keeps its last priced day;
//   * the count line, the too-new count, and how fresh the daily prices are (stopped history);
//   * the chips filter and order the list, and write themselves into the command where the
//     registry takes the words; typed props seed them; row numbers follow the rows on screen;
//   * the pointer to FREC, a symbol loading into the linked panels, no hard-coded color, axe.
// The fixtures are the store's real shape (api/top_flow_tracker.py), with made-up tickers.
import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import { SWRConfig, useSWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
vi.mock('../../calendar/earningsModalRow', async (orig) => ({ ...(await orig()), todayIso: () => '2026-07-06' }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import TopFlowPanel, {
  MAX_ROWS, PAGE_ROWS, TOP_FLOW_CODE, TOP_FLOW_URL, contractText, expiryText, totalsSentence, unscoredWords,
} from './TopFlowPanel'
import { stampedKey } from './marketRead'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const SOURCE = 'UCT options flow tape (picks), daily option prices from Massive'
/** The hyphen a date is drawn with, so it never breaks a line. */
const HY = String.fromCharCode(0x2011)
const day = (iso) => iso.replace(/-/g, HY)
const snap = (date, price, oi = 1000) => ({ date, price, oi, spot: 150, volume: 200 })
const pick = (over = {}) => ({
  id: `${over.sym || 'ZZA'}|C|200.0|8/21/2026`, sym: 'ZZA', cp: 'C', strike: 200, exp: '8/21/2026', entry: 2.0, grade: 'A', dir: 'BULL', cap: 'Large',
  dateSaved: '2026-07-01', hits: 4, prem: 1500000, history: [snap('7/1/2026', 2.0), snap('7/2/2026', 3.0, 1300), snap('7/6/2026', 2.5, 900)],
  ...over,
})
const STORE = {
  active: [
    pick(), // +25.0% now, +50.0% peak
    pick({ sym: 'ZZB', cp: 'P', strike: 27.5, exp: '6/20', entry: 1.2, grade: 'A+', dir: 'BEAR', dateSaved: '2026-07-06', history: [snap('7/6/2026', 1.3)] }),
    pick({ sym: 'ZZC', strike: 50, exp: '9/18/2026', entry: 5.0, grade: 'B', dir: 'BEAR', dateSaved: '2026-06-22', history: [snap('6/22/2026', 5.0), snap('7/6/2026', 2.0)] }), // -60.0%
    pick({ sym: 'ZZG', strike: 1200, exp: '1/15/2027', entry: 0, grade: 'B+', dir: '', dateSaved: '2026-07-06', history: [] }),
  ],
  archived: [
    pick({ sym: 'ZZD', strike: 10, exp: '6/19/2026', entry: 4.0, grade: 'C', dateSaved: '2026-06-01', archivedDate: '2026-06-20', finalPrice: 0, finalPnl: 0,
      history: [snap('6/1/2026', 4.0), snap('6/18/2026', 9.0), snap('6/19/2026', 0)] }), // +125.0%, last priced 6/18
    pick({ sym: 'ZZE', cp: 'P', strike: 5, exp: '6/12/2026', entry: 0.5, dir: 'BEAR', dateSaved: '2026-06-10', archivedDate: '2026-06-13', finalPrice: 0.4, finalPnl: -20,
      history: [snap('6/11/2026', 0.4)] }),
  ],
}
const EMPTY = { active: [], archived: [] }

const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
/** Serves the route its body (an Error is thrown, PENDING never answers); anything else is a 500. */
function serve(hit) {
  jsonFetcher.mockImplementation((url) => {
    if (url !== TOP_FLOW_URL || hit === undefined) return Promise.reject(fail(500))
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([url]) => url))]

/** The panel's own SWR cache, so a test can ask for a refresh. */
const swr = { mutate: null }
function Grab() {
  const { mutate } = useSWRConfig()
  useEffect(() => { swr.mutate = mutate }, [mutate])
  return null
}

function renderPanel(props = {}, { run = vi.fn(), open = vi.fn(), rerun = vi.fn(), publishRows = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const body = <TopFlowPanel {...props} />
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <Grab />
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run, rerun, publish: vi.fn(), publishRows }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { run, open, rerun, publishRows, setFreshness, container: view.container }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const rows = () => screen.getAllByTestId('terminal-topf-row')
const syms = () => rows().map((r) => r.getAttribute('data-sym'))
const cells = (sym) => [...rows().find((r) => r.getAttribute('data-sym') === sym).querySelectorAll('td')]
/** A cell's lines, as the <br /> splits them. */
const lines = (td) => td.innerHTML.split(/<br\s*\/?>/).map((h) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent })

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('TOPF states', () => {
  it('shows a loading skeleton and asks the one route', () => {
    serve(PENDING)
    renderPanel()
    expect(TOP_FLOW_CODE).toBe('TOPF')
    expect(screen.getByTestId('terminal-topf-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-topf')).toBeNull()
    expect(asked()).toEqual(['/api/top-flow/history'])
  })

  it('a failed read (500) is an error with Retry, never an empty list', async () => {
    serve(undefined)
    const { setFreshness, publishRows } = renderPanel({}, { code: 'TOPX' })
    const err = await screen.findByTestId('terminal-topf-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The Top Flow picks could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no picks. Retry, or run TOPX again.')
    expect(screen.queryByTestId('terminal-topf-empty')).toBeNull()
    expect(setFreshness.mock.calls.every(([report]) => report == null)).toBe(true)
    expect(publishRows.mock.calls.every(([r]) => r.length === 0)).toBe(true)
    serve(STORE)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-topf-table')).toBeTruthy()
  })

  it('signed out (401), a timeout and a switched-off route (404) each say so; only an error can be retried', async () => {
    for (const [err, kind, words] of [
      [fail(401), 'error', 'You are signed out, so the Top Flow picks cannot be read. Sign in again.'],
      [fail(0, { timedOut: true }), 'error', 'The Top Flow picks did not answer within 30 seconds.'],
      [fail(404), 'locked', 'The Top Flow picks is not switched on for this server yet.'],
    ]) {
      cleanup()
      serve(err)
      renderPanel()
      const state = await screen.findByTestId('terminal-topf-error')
      expect(state.getAttribute('data-kind'), words).toBe(kind)
      expect(state.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), words).toBe(kind === 'error')
      expect(screen.queryByTestId('terminal-topf-empty')).toBeNull()
    }
  })

  it('an answer that is not the route\'s shape is an error, not an empty list', async () => {
    serve({ detail: 'something else' })
    renderPanel()
    const err = await screen.findByTestId('terminal-topf-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The Top Flow picks came back in a form this panel cannot read.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.queryByTestId('terminal-topf-empty')).toBeNull()
  })

  it('an empty store says so, and says what its answer cannot tell apart: no as-of, no chips, and it can be checked again', async () => {
    serve(EMPTY)
    const { setFreshness } = renderPanel()
    const empty = await screen.findByTestId('terminal-topf-empty')
    expect(empty.getAttribute('data-kind')).toBe('empty')
    expect(empty.textContent).toContain('No Top Flow pick is on record.')
    expect(empty.textContent).toContain('Either no pick has been saved yet, or the server could not read its store of picks when it last started; its answer does not say which.')
    expect(screen.queryByRole('toolbar')).toBeNull()
    expect(screen.queryByTestId('terminal-topf-table')).toBeNull()
    expect(setFreshness.mock.calls.every(([report]) => report == null)).toBe(true)
    serve(STORE)
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByTestId('terminal-topf-table')).toBeTruthy()
  })
})

describe('TOPF the list', () => {
  it('counts the store, ranks the scored picks by their gain now, and puts the picks with no score last', async () => {
    serve(STORE)
    const { setFreshness, publishRows } = renderPanel()
    await screen.findByTestId('terminal-topf-table')
    expect(screen.getByTestId('terminal-topf').getAttribute('data-sort')).toBe('gain')
    expect(screen.getByTestId('terminal-topf-totals').textContent).toBe(
      '6 picks on record: 4 open, 2 expired. 3 are scored. 2 open picks are too new to score (1 with no price yet). '
      + '1 ended with fewer than 2 daily prices, so it was never scored.',
    )
    // scored: ZZD +125.0%, ZZA +25.0%, ZZC -60.0%; then not scored, newest pick first
    expect(syms()).toEqual(['ZZD', 'ZZA', 'ZZC', 'ZZB', 'ZZG', 'ZZE'])
    expect(rows().map((r) => r.getAttribute('data-scored'))).toEqual(['yes', 'yes', 'yes', 'no', 'no', 'no'])
    expect(screen.getByRole('table', { name: 'Top Flow picks, biggest current gain first, 6 of 6' })).toBeTruthy()
    expect([...screen.getByTestId('terminal-topf-table').querySelectorAll('th')].map((th) => th.textContent))
      .toEqual(['Symbol', 'Contract', 'Grade', 'Entry', 'Latest price', 'Peak'])
    // the header names both sources and the newest daily price's date
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith(expect.objectContaining({ source: SOURCE, age: { asOfDate: '2026-07-06' } })))
    expect(publishRows).toHaveBeenLastCalledWith(['$ZZD', '$ZZA', '$ZZC', '$ZZB', '$ZZG', '$ZZE'])
    expect(screen.queryByTestId('terminal-topf-stale')).toBeNull()
    expect(screen.queryByTestId('terminal-topf-no-prices')).toBeNull()
    expect(screen.getByTestId('terminal-topf-newest').textContent).toBe(`Newest daily price: ${day('2026-07-06')}.`)
    expect(screen.queryByTestId('terminal-topf-cut')).toBeNull()
    expect(document.body.textContent).not.toMatch(/[—–]/)
    expect(asked()).toEqual([TOP_FLOW_URL])
  })

  it('a scored pick: contract in two lines, grade and direction, entry and pick date, latest price with gain and date, peak and days', async () => {
    serve(STORE)
    renderPanel()
    await screen.findByTestId('terminal-topf-table')
    const [symCell, contract, grade, entry, latest, peak] = cells('ZZA')
    expect(symCell.textContent).toBe('2ZZA')
    expect(lines(contract)).toEqual(['$200 call', `exp 8/21/2026`])
    expect(lines(grade)).toEqual(['A', 'Bullish'])
    expect(lines(entry)).toEqual(['$2.00', `on ${day('2026-07-01')}`])
    expect(lines(latest)).toEqual(['$2.50 +25.0%', `as of ${day('2026-07-06')}`])
    expect(lines(peak)).toEqual(['+50.0%', '5 days'])
    // a losing pick is a loss, with its sign
    expect(lines(cells('ZZC')[4])).toEqual(['$2.00 -60.0%', `as of ${day('2026-07-06')}`])
    expect(lines(cells('ZZC')[5])).toEqual(['+0.0%', '14 days'])
    expect(lines(cells('ZZC')[2])).toEqual(['B', 'Bearish'])
  })

  it('too new to score is said in words: never 0%, never a loss, never a gain', async () => {
    serve(STORE)
    renderPanel()
    await screen.findByTestId('terminal-topf-table')
    const one = cells('ZZB')
    expect(lines(one[1])).toEqual(['$27.50 put', 'exp 6/20'])
    expect(lines(one[3])).toEqual(['$1.20', `on ${day('2026-07-06')}`])
    expect(lines(one[4])).toEqual(['Too new to score', '1 daily price so far'])
    expect(one[5].textContent).toBe('n/a')
    const none = cells('ZZG')
    expect(lines(none[1])).toEqual(['$1,200 call', 'exp 1/15/2027'])
    expect(lines(none[2])).toEqual(['Not graded', 'No direction'])
    expect(lines(none[3])).toEqual(['Not recorded', `on ${day('2026-07-06')}`])
    expect(lines(none[4])).toEqual(['Too new to score', 'no price yet'])
    expect(none[5].textContent).toBe('n/a')
    for (const sym of ['ZZB', 'ZZG', 'ZZE']) {
      const text = cells(sym).slice(4).map((td) => td.textContent).join(' ')
      expect(text, sym).not.toMatch(/%|[+-]\d|\$0/)
    }
  })

  it('an expired pick keeps the gain of its last priced day and says a later quote had no price; one daily price is never a result', async () => {
    serve(STORE)
    renderPanel()
    await screen.findByTestId('terminal-topf-table')
    const zzd = cells('ZZD')
    expect(lines(zzd[1])).toEqual(['$10 call', 'expired 6/19/2026'])
    expect(lines(zzd[4])).toEqual(['$9.00 +125.0%', `as of ${day('2026-06-18')}`, 'later quote had no price'])
    expect(lines(zzd[5])).toEqual(['+125.0%', '17 days'])
    // the store's own finalPnl for ZZE is -20; with one daily price it is not drawn
    const zze = cells('ZZE')
    expect(lines(zze[1])).toEqual(['$5 put', 'expired 6/12/2026'])
    expect(lines(zze[4])).toEqual(['Never scored', 'expired, 1 daily price'])
    expect(document.body.textContent).not.toContain('-20')
  })

  it('a pick the desk stopped early says so on its own line, is counted, and is not called expired', async () => {
    serve({
      active: [pick()],
      archived: [
        pick({ sym: 'ZZF', strike: 80, exp: '12/18/2026', entry: 3.0, dateSaved: '2026-05-01', archivedDate: '2026-07-01', purgeReason: 'older than 60d', finalPrice: 6, finalPnl: 100,
          history: [snap('5/1/2026', 3.0), snap('5/4/2026', 6.0)] }),
        pick({ sym: 'ZZI', strike: 15, exp: '11/20/2026', dateSaved: '2026-05-01', archivedDate: '2026-07-01', purgeReason: 'older than 60d', history: [snap('5/1/2026', 3.0)] }),
      ],
    })
    renderPanel()
    await screen.findByTestId('terminal-topf-table')
    expect(screen.getByTestId('terminal-topf-totals').textContent)
      .toBe('3 picks on record: 1 open, 2 expired (2 of them stopped early). 2 are scored. 1 ended with fewer than 2 daily prices, so it was never scored.')
    expect(lines(cells('ZZF')[1])).toEqual(['$80 call', 'exp 12/18/2026', 'stopped early'])
    expect(lines(cells('ZZF')[4])).toEqual(['$6.00 +100.0%', `as of ${day('2026-05-04')}`])
    expect(lines(cells('ZZI')[4])).toEqual(['Never scored', 'stopped, 1 daily price'])
    expect(lines(cells('ZZA')[1])).toEqual(['$200 call', 'exp 8/21/2026'])
  })

  it('the method says where each number comes from and points to FREC, which opens beside the panel', async () => {
    serve(STORE)
    const { open, run } = renderPanel()
    await screen.findByTestId('terminal-topf-table')
    const method = screen.getByTestId('terminal-topf-method').textContent
    for (const s of [
      'A pick and its entry come from UCT\'s options flow tape',
      'Its daily prices are recorded about 4:30 PM ET on weekdays until the contract expires, from Massive (prices recorded before November 2026 came from Schwab and stay as recorded).',
      'A gain is the contract\'s own price against its entry, not the stock\'s move',
      'A pick needs 2 daily prices to be scored; until then it is too new, which is not 0%.',
      'Losing picks are never removed.',
      'open Flow record (FREC).',
      'this is not a forecast or a recommendation',
    ]) expect(method, s).toContain(s)
    fireEvent.click(screen.getByTestId('panel-command-FREC'))
    expect(open).toHaveBeenCalledWith('FREC')
    fireEvent.click(screen.getByTestId('panel-symbol-ZZC'))
    expect(run).toHaveBeenCalledWith('$ZZC')
  })
})

describe('TOPF says when the record has stopped growing', () => {
  it('a newest pick that is weeks old is said so; a recent one is not', async () => {
    serve({ active: [pick({ dateSaved: '2026-06-01', history: [snap('7/2/2026', 2.0), snap('7/3/2026', 3.0)] })], archived: [] })
    renderPanel()
    await screen.findByTestId('terminal-topf-table')
    const note = screen.getByTestId('terminal-topf-no-new-picks')
    expect(note.getAttribute('role')).toBe('status')
    expect(note.textContent).toContain(`The newest pick on this record is from ${day('2026-06-01')}, 35 days ago.`)
    expect(note.textContent).toContain('this is a record of older picks, not a list of current ideas')
    // its prices are current, so the price note stays away: the two are different questions
    expect(screen.queryByTestId('terminal-topf-stale')).toBeNull()
    cleanup()
    serve({ active: [pick({ dateSaved: '2026-06-30', history: [snap('7/2/2026', 2.0), snap('7/3/2026', 3.0)] })], archived: [] })
    renderPanel()
    await screen.findByTestId('terminal-topf-table')
    expect(screen.queryByTestId('terminal-topf-no-new-picks')).toBeNull()
  })
})

describe('TOPF how fresh the daily prices are', () => {
  it('a history that has stopped is said so, with the date and the reason it can stop', async () => {
    serve({ active: [pick({ history: [snap('6/29/2026', 2.0), snap('6/30/2026', 3.0)] })], archived: [] })
    renderPanel()
    await screen.findByTestId('terminal-topf-table')
    const stale = screen.getByTestId('terminal-topf-stale')
    expect(stale.getAttribute('role')).toBe('status')
    expect(stale.textContent).toContain(`The newest daily price is from ${day('2026-06-30')}, 6 days ago.`)
    expect(stale.textContent).toContain('recorded from Massive; when it has no price for a contract none is stored, and its history stops')
    expect(stale.textContent).toContain('Every gain below is as of the date in its own row, not today.')
    expect(screen.queryByTestId('terminal-topf-newest')).toBeNull()
  })

  it('a store with no daily price at all says every pick is too new, and draws no gain', async () => {
    serve({ active: [pick({ history: [] }), pick({ sym: 'ZZB', history: [] })], archived: [] })
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-topf-table')
    expect(screen.getByTestId('terminal-topf-no-prices').textContent).toContain('No daily price has been stored for any pick yet.')
    expect(screen.getByTestId('terminal-topf-totals').textContent)
      .toBe('2 picks on record: 2 open, 0 expired. 0 are scored. 2 open picks are too new to score (2 with no price yet).')
    expect(screen.getByTestId('terminal-topf-table').textContent).not.toMatch(/%/)
    // the sources are still named; no date is made up for them
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith({ source: SOURCE }))
  })

  it('open picks the server did not price on the newest day are counted, and each row keeps its own date', async () => {
    serve({
      active: [pick(), pick({ sym: 'ZZH', dateSaved: '2026-05-01', history: [snap('5/1/2026', 2.0), snap('6/1/2026', 2.2)] })],
      archived: [],
    })
    renderPanel()
    await screen.findByTestId('terminal-topf-table')
    expect(screen.getByTestId('terminal-topf-behind').textContent)
      .toContain(`1 open pick has no price from ${day('2026-07-06')}, the newest day on record: the server prices the 200 newest open picks each day`)
    expect(lines(cells('ZZH')[4])).toEqual(['$2.20 +10.0%', `as of ${day('2026-06-01')}`])
    expect(screen.queryByTestId('terminal-topf-stale')).toBeNull()
  })

  it('a refresh that fails keeps the last list and says it is the last read', async () => {
    let calls = 0
    jsonFetcher.mockImplementation(async () => { calls += 1; if (calls === 1) return STORE; throw fail(500) })
    renderPanel()
    await screen.findByTestId('terminal-topf-table')
    expect(screen.queryByTestId('terminal-topf-stale-read')).toBeNull()
    await act(async () => { await swr.mutate(stampedKey(TOP_FLOW_URL)).catch(() => {}) })
    const note = await screen.findByTestId('terminal-topf-stale-read')
    expect(note.textContent).toBe('The Top Flow picks could not be read just now. Showing the last read.')
    expect(syms()).toEqual(['ZZD', 'ZZA', 'ZZC', 'ZZB', 'ZZG', 'ZZE'])
    expect(screen.queryByTestId('terminal-topf-error')).toBeNull()
  })
})

describe('TOPF chips and typed words', () => {
  it('the chips filter and order the list; the count says how many match; row numbers follow the rows on screen', async () => {
    serve(STORE)
    const { publishRows, rerun } = renderPanel()
    await screen.findByTestId('terminal-topf-table')
    fireEvent.click(screen.getByTestId('terminal-topf-status-open'))
    expect(syms()).toEqual(['ZZA', 'ZZC', 'ZZB', 'ZZG'])
    expect(screen.getByTestId('terminal-topf-status-open').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('terminal-topf-totals').textContent).toContain('1 ended with fewer than 2 daily prices, so it was never scored. 4 match the chips above.')
    expect(publishRows).toHaveBeenLastCalledWith(['$ZZA', '$ZZC', '$ZZB', '$ZZG'])
    fireEvent.click(screen.getByTestId('terminal-topf-direction-bearish'))
    expect(syms()).toEqual(['ZZC', 'ZZB'])
    expect(rows()[0].querySelector('td').textContent).toBe('1ZZC')
    fireEvent.click(screen.getByTestId('terminal-topf-status-all'))
    fireEvent.click(screen.getByTestId('terminal-topf-direction-any'))
    fireEvent.click(screen.getByTestId('terminal-topf-sort-loss'))
    expect(syms()).toEqual(['ZZC', 'ZZA', 'ZZD', 'ZZB', 'ZZG', 'ZZE'])
    fireEvent.click(screen.getByTestId('terminal-topf-sort-peak'))
    expect(syms()).toEqual(['ZZD', 'ZZA', 'ZZC', 'ZZB', 'ZZG', 'ZZE'])
    fireEvent.click(screen.getByTestId('terminal-topf-sort-newest'))
    expect(syms()).toEqual(['ZZB', 'ZZG', 'ZZA', 'ZZC', 'ZZE', 'ZZD'])
    expect(screen.getByRole('table', { name: 'Top Flow picks, newest pick first, 6 of 6' })).toBeTruthy()
    // outside the shell nothing is re-run, and the one read is not repeated by a chip
    expect(rerun).not.toHaveBeenCalled()
    expect(jsonFetcher).toHaveBeenCalledTimes(1)
  })

  it('a filter that matches nothing says so and offers every pick again', async () => {
    serve({ active: [pick()], archived: [] })
    renderPanel()
    await screen.findByTestId('terminal-topf-table')
    fireEvent.click(screen.getByTestId('terminal-topf-status-expired'))
    const none = screen.getByTestId('terminal-topf-none-match')
    expect(none.textContent).toContain('No pick on record matches the chips above.')
    expect(screen.queryByTestId('terminal-topf-table')).toBeNull()
    expect(screen.getByTestId('terminal-topf-totals').textContent).toContain('0 match the chips above.')
    fireEvent.click(screen.getByRole('button', { name: 'Show all picks' }))
    expect(syms()).toEqual(['ZZA'])
  })

  it('typed words seed the chips: a word or a key, and an unknown one is the default', async () => {
    serve(STORE)
    renderPanel({ status: 'EXPIRED', direction: 'bearish', sort: 'NEW' })
    await screen.findByTestId('terminal-topf-table')
    const root = screen.getByTestId('terminal-topf')
    expect([root.getAttribute('data-status'), root.getAttribute('data-direction'), root.getAttribute('data-sort')]).toEqual(['expired', 'bearish', 'newest'])
    expect(syms()).toEqual(['ZZE'])
    cleanup()
    serve(STORE)
    renderPanel({ status: 'nonsense', direction: 7, sort: null })
    await screen.findByTestId('terminal-topf-table')
    expect(syms()).toEqual(['ZZD', 'ZZA', 'ZZC', 'ZZB', 'ZZG', 'ZZE'])
  })

  it('in the shell a chip keeps working when the registry does not take its word (the choice stays in the panel)', async () => {
    serve(STORE)
    // MOST is a registered code that takes none of these words, so nothing may be written back
    const { rerun } = renderPanel({}, { code: 'MOST' })
    await screen.findByTestId('terminal-topf-table')
    fireEvent.click(screen.getByTestId('terminal-topf-status-expired'))
    expect(rerun).not.toHaveBeenCalled()
    expect(syms()).toEqual(['ZZD', 'ZZE'])
    // every default is the bare command, which any registered code takes
    fireEvent.click(screen.getByTestId('terminal-topf-status-all'))
    expect(rerun).toHaveBeenLastCalledWith('MOST')
  })

  it('a long list is cut on screen and counted: 50 at first, 50 more each time, 250 at most', async () => {
    const many = Array.from({ length: MAX_ROWS + 30 }, (_, i) => pick({
      sym: `Z${String(i).padStart(3, '0')}`, history: [snap('7/1/2026', 2.0), snap('7/6/2026', 2.0 + (MAX_ROWS + 30 - i) / 100)],
    }))
    serve({ active: many, archived: [] })
    const { publishRows } = renderPanel()
    await screen.findByTestId('terminal-topf-table')
    expect(rows()).toHaveLength(PAGE_ROWS)
    expect(syms()[0]).toBe('Z000')
    expect(screen.getByTestId('terminal-topf-cut').textContent).toBe('Showing the first 50 of 280, biggest current gain first.')
    expect(publishRows.mock.calls.at(-1)[0]).toHaveLength(PAGE_ROWS)
    fireEvent.click(screen.getByTestId('terminal-topf-more'))
    expect(rows()).toHaveLength(100)
    for (let i = 0; i < 3; i += 1) fireEvent.click(screen.getByTestId('terminal-topf-more'))
    expect(rows()).toHaveLength(MAX_ROWS)
    expect(screen.queryByTestId('terminal-topf-more')).toBeNull()
    expect(screen.getByTestId('terminal-topf-cut').textContent)
      .toBe('Showing the first 250 of 280, biggest current gain first. This panel draws 250 at most; the chips above narrow the list or change its order.')
    // a new order starts again from the first page
    fireEvent.click(screen.getByTestId('terminal-topf-sort-loss'))
    expect(rows()).toHaveLength(PAGE_ROWS)
    expect(syms()[0]).toBe('Z279')
  })
})

describe('TOPF words (pure)', () => {
  it('contractText and expiryText leave out what a pick lacks, and never guess call or put', () => {
    expect(contractText({ strike: 420, side: 'call' })).toBe('$420 call')
    expect(contractText({ strike: 27.5, side: 'put' })).toBe('$27.50 put')
    expect(contractText({ strike: 1200, side: null })).toBe('$1,200')
    expect(contractText({ strike: null, side: null })).toBe('Contract not given')
    expect(expiryText({ status: 'open', exp: '6/20' })).toBe('exp 6/20')
    expect(expiryText({ status: 'open', exp: null })).toBe('no expiry given')
    expect(expiryText({ status: 'expired', exp: '6/19/2026' })).toBe('expired 6/19/2026')
    expect(expiryText({ status: 'expired', exp: null })).toBe('expired')
    // a pick the desk stopped early has not expired
    expect(expiryText({ status: 'expired', stopped: true, exp: '12/18/2026' })).toBe('exp 12/18/2026')
    expect(expiryText({ status: 'expired', stopped: true, exp: null })).toBe('no expiry given')
  })

  it('unscoredWords and totalsSentence', () => {
    expect(unscoredWords({ status: 'open', prices: 0 })).toEqual(['Too new to score', 'no price yet'])
    expect(unscoredWords({ status: 'open', prices: 1 })).toEqual(['Too new to score', '1 daily price so far'])
    expect(unscoredWords({ status: 'expired', prices: 0 })).toEqual(['Never scored', 'expired, no daily price'])
    expect(unscoredWords({ status: 'expired', stopped: true, prices: 1 })).toEqual(['Never scored', 'stopped, 1 daily price'])
    const zero = { all: 0, open: 0, expired: 0, stopped: 0, scored: 0, tooNew: 0, neverScored: 0, noPrice: 0 }
    expect(totalsSentence({ ...zero, all: 1, open: 1, scored: 1 })).toBe('1 pick on record: 1 open, 0 expired. 1 is scored.')
    expect(totalsSentence({ ...zero, all: 1200, open: 300, expired: 900, stopped: 40, scored: 1100, tooNew: 1, neverScored: 99 }))
      .toBe('1,200 picks on record: 300 open, 900 expired (40 of them stopped early). 1,100 are scored. 1 open pick is too new to score. '
        + '99 ended with fewer than 2 daily prices, so they were never scored.')
  })
})

describe('TOPF follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['TopFlowPanel.jsx', 'topFlowModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('TOPF accessibility', () => {
  it('the list, a filtered list and the empty store pass axe (WCAG A and AA)', async () => {
    serve(STORE)
    renderPanel()
    await screen.findByTestId('terminal-topf-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    fireEvent.click(screen.getByTestId('terminal-topf-direction-bullish'))
    fireEvent.click(screen.getByTestId('terminal-topf-status-expired'))
    expect(within(screen.getByTestId('terminal-topf')).getAllByRole('button', { pressed: true })).toHaveLength(3)
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve(EMPTY)
    renderPanel()
    await screen.findByTestId('terminal-topf-empty')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)
})
