// ERNS: the earnings season screen. Rails:
//   * loading, a failed read (error with Retry), signed out, not on a paid plan (no Retry), and an
//     answer that is not the route's shape: none of them is an empty day;
//   * "computing" is a working state and the panel fills in on its own; a calendar the server
//     could not read, a day out of reach, a closed day and a day with nobody are each said apart;
//   * the day: groups before the open / after the close / time not confirmed, biggest first; the
//     priced move, the past moves and the result and move, each in fixed lines; a missing number
//     is a dash or words, never 0;
//   * "4 of 7 priced" is said, and the reason for no priced move is said once;
//   * the chips pick a day and a part of it and write themselves into the command; typed words
//     seed them; one day's rows are never drawn under another day's name;
//   * a long group is cut on screen and counted; row numbers follow the rows on screen;
//   * a symbol loads into the linked panels; no hard-coded color; axe.
// The fixtures are the route's real shape (api/services/earnings_season.py), with made-up tickers.
import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import { SWRConfig, useSWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
vi.mock('../../calendar/earningsModalRow', async (orig) => ({ ...(await orig()), todayIso: () => '2026-11-17' }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import EarningsSeasonPanel, {
  EARNINGS_SEASON_CODE, GROUP_ROWS, dayLabel, daySentence, earningsSeasonRead, moveWords, pastSentence, resultWords, shortDay,
} from './EarningsSeasonPanel'
import { stampedKey } from './marketRead'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const SOURCE = 'UCT earnings calendar, UCT option chain capture, UCT daily bars, Massive prices'
const TODAY = '2026-11-17'       // a Tuesday
const TOMORROW = '2026-11-18'
const YESTERDAY = '2026-11-16'
const BARE = '/api/calendar/earnings-season'
const urlFor = (date) => `${BARE}?date=${date}`

const FOUR = { moves: [{ date: '2026-08-18', pct: 3.1 }, { date: '2026-05-19', pct: -2 }, { date: '2026-02-17', pct: 8.4 }, { date: '2025-11-18', pct: -1.3 }], avg_abs: 3.7, n: 4 }
const FIVE = { moves: [...FOUR.moves, { date: '2025-08-19', pct: 5 }], avg_abs: 3.96, n: 5 }
const row = (sym, over = {}) => ({
  sym, name: `${sym} Corp`, session: 'amc', mc_b: 10, eps_est: 1.1, eps_act: null, rev_est: 100, rev_act: null,
  reported: false, verdict: null, priced: null, past: null, past_state: 'not_held', move: null, move_state: null, ...over,
})
const day = (sessions, over = {}) => ({
  status: 'ok', date: TODAY, today: TODAY, day_kind: 'today', default: false, range: { from: '2026-11-09', to: '2026-11-27' },
  sessions: { bmo: [], amc: [], tbd: [], ...sessions },
  counts: { scheduled: 0, reported: 0, priced: 0, priced_withheld: 0, with_past: 0, past_not_held: 0, moved: 0 },
  priced_state: 'read', moves_state: null, calendar_as_of: '2026-11-17T14:00:00+00:00', built_at: '2026-11-17T14:05:00+00:00',
  capture: { hour_et: 16, minute_et: 35 }, ...over,
})
const DAY = day({
  bmo: [
    row('BBIG', { session: 'bmo', mc_b: 3400, eps_act: 1.25, rev_act: 110, reported: true, verdict: 'beat',
      priced: { pct: 6.2, dollar: 12.4, captured_at: '2026-11-16T16:35:04-05:00', expiry: '2026-11-20' },
      past: FOUR, past_state: 'ok', move: 8.12, move_state: 'live' }),
    row('BMISS', { session: 'bmo', eps_act: 0.8, rev_act: 90, reported: true, verdict: 'miss',
      priced: { pct: 3, dollar: null, captured_at: '2026-11-16T16:35:04-05:00', expiry: '2026-11-20' },
      past_state: 'not_measured', move: -1.2, move_state: 'live' }),
    row('BWAIT', { session: 'bmo', mc_b: null, name: null }),
  ],
  amc: [
    row('AAA', { priced: { pct: 7.5, dollar: 15, captured_at: '2026-11-16T16:35:04-05:00', expiry: '2026-11-20' }, past: FIVE, past_state: 'ok' }),
    row('ANONE', { eps_est: null }),
    row('ACLOSE', { eps_act: 1.25, rev_act: 90, reported: true, verdict: 'mixed', move_state: 'next_close',
      priced: { pct: 4, dollar: 2, captured_at: '2026-11-16T16:35:04-05:00', expiry: '2026-11-20' }, past: FOUR, past_state: 'ok' }),
  ],
  tbd: [row('TLATE', { session: 'tbd', past_state: 'not_measured' })],
}, { moves_state: 'live' })
const TOMORROW_DAY = day({ amc: [row('NEXT1'), row('NEXT2')] }, { date: TOMORROW, day_kind: 'future' })

const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
/** Serves each URL its body (an Error is thrown, PENDING never answers); any other URL is a 500. */
function serve(map) {
  jsonFetcher.mockImplementation((url) => {
    const hit = map[url]
    if (hit === undefined) return Promise.reject(fail(500))
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
  const body = <EarningsSeasonPanel {...props} />
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
const root = () => screen.getByTestId('terminal-erns')
const rows = () => screen.getAllByTestId('terminal-erns-row')
const syms = () => rows().map((r) => r.getAttribute('data-sym'))
const cells = (sym) => [...rows().find((r) => r.getAttribute('data-sym') === sym).querySelectorAll('td')]
/** A cell's lines, as the <br /> splits them. */
const lines = (td) => td.innerHTML.split(/<br\s*\/?>/).map((h) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent })
const pressed = () => within(root()).getAllByRole('button', { pressed: true }).map((b) => b.textContent)

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('ERNS states', () => {
  it('shows a loading skeleton and asks the one route, with no day for the bare command', () => {
    serve({ [BARE]: PENDING })
    renderPanel()
    expect(EARNINGS_SEASON_CODE).toBe('ERNS')
    expect(screen.getByTestId('terminal-erns-loading').textContent).toContain('Loading the earnings reporters for the next day with reports')
    expect(root().getAttribute('data-state')).toBe('loading')
    expect(screen.queryByTestId('terminal-erns-date')).toBeNull()       // no day is named before the server names it
    expect(asked()).toEqual([BARE])
  })

  it('a failed read is an error with Retry, never an empty day; Retry reads again', async () => {
    serve({ [BARE]: fail(500) })
    const { setFreshness, publishRows } = renderPanel({}, { code: 'ERNX' })
    const err = await screen.findByTestId('terminal-erns-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The earnings season screen could not be read just now.')
    expect(err.textContent).toContain('That is not the same as nobody reporting. Retry, or run ERNX again.')
    expect(screen.queryByTestId('terminal-erns-empty')).toBeNull()
    expect(setFreshness.mock.calls.every(([report]) => report == null)).toBe(true)
    expect(publishRows.mock.calls.every(([r]) => r.length === 0)).toBe(true)
    serve({ [BARE]: DAY })
    fireEvent.click(within(err).getByRole('button', { name: 'Retry' }))
    await screen.findByTestId('terminal-erns-table-amc')
  })

  it.each([
    [fail(402), 'locked', 'The earnings season screen needs a paid plan.', false],
    [fail(404), 'locked', 'The earnings season screen is not switched on for this server yet.', false],
    [fail(401), 'error', 'You are signed out, so the earnings season screen cannot be read. Sign in again.', true],
    [fail(0, { timedOut: true }), 'error', 'The earnings season screen did not answer within 30 seconds.', true],
  ])('a read the member cannot fix by retrying has no Retry (%#)', async (error, kind, text, retry) => {
    serve({ [BARE]: error })
    renderPanel()
    const err = await screen.findByTestId('terminal-erns-error')
    expect(err.getAttribute('data-kind')).toBe(kind)
    expect(err.textContent).toContain(text)
    expect(within(err).queryAllByRole('button', { name: 'Retry' })).toHaveLength(retry ? 1 : 0)
  })

  it('an answer that is not the route\'s shape is an error, never an empty day', async () => {
    serve({ [BARE]: { hello: 'world' } })
    renderPanel()
    const err = await screen.findByTestId('terminal-erns-error')
    expect(err.textContent).toContain('The earnings season screen came back in a form this panel cannot read.')
    expect(screen.queryByTestId('terminal-erns-empty')).toBeNull()
  })

  it('"computing" says the server is still working, and the panel fills in on its own', async () => {
    let n = 0
    jsonFetcher.mockImplementation(async () => { n += 1; return n === 1 ? { status: 'computing', date: null, default: true } : DAY })
    const { setFreshness } = renderPanel()
    const working = await screen.findByTestId('terminal-erns-computing')
    expect(working.getAttribute('role')).toBe('status')
    expect(working.textContent).toContain('Loading, the server is preparing this.')
    expect(working.textContent).toContain('This panel asks again every 3 seconds and fills in on its own. That is not the same as nobody reporting.')
    expect(screen.queryByTestId('terminal-erns-row')).toBeNull()
    expect(setFreshness.mock.calls.every(([report]) => report == null)).toBe(true)
    // no click: the panel asks again by itself
    await screen.findByTestId('terminal-erns-table-amc', {}, { timeout: 6000 })
    expect(n).toBeGreaterThanOrEqual(2)
  }, 15_000)

  it('a calendar the server could not read is said as that, with Retry', async () => {
    serve({ [urlFor(TODAY)]: { status: 'unavailable', reason: 'calendar', date: TODAY, today: TODAY, default: false } })
    renderPanel({ day: 'today' })
    const block = await screen.findByTestId('terminal-erns-unavailable')
    expect(block.getAttribute('data-kind')).toBe('error')
    expect(block.textContent).toContain('The earnings calendar could not be read for Tue Nov 17, 2026 just now.')
    expect(block.textContent).toContain('That is not the same as nobody reporting.')
    serve({ [urlFor(TODAY)]: DAY })
    fireEvent.click(within(block).getByRole('button', { name: 'Retry' }))
    await screen.findByTestId('terminal-erns-table-amc')
  })

  it('a day outside the server\'s reach says what the screen covers and points at the calendar', async () => {
    const far = '2026-12-21'
    serve({ [urlFor(far)]: { status: 'out_of_range', date: far, today: TODAY, range: { from: '2026-11-09', to: '2026-11-27' } } })
    const { open } = renderPanel({ day: far })
    const block = await screen.findByTestId('terminal-erns-out-of-range')
    expect(block.textContent).toContain('Mon Dec 21, 2026 is outside the three weeks this screen covers.')
    expect(block.textContent).toContain('It covers Mon Nov 9, 2026 to Fri Nov 27, 2026: last week, this week and next week.')
    fireEvent.click(screen.getByTestId('panel-command-CAL'))
    expect(open).toHaveBeenCalledWith('CAL')
    // stepping further out is not offered
    expect(screen.queryByTestId('terminal-erns-next')).toBeNull()
    expect(screen.queryByTestId('terminal-erns-prev')).toBeNull()
  })

  it('a closed day and a day the calendar does not carry are each said, and neither is an error', async () => {
    serve({ [urlFor('2026-11-21')]: { status: 'no_day', weekend: true, date: '2026-11-21', today: TODAY, default: false } })
    renderPanel({ day: '2026-11-21' })
    const closed = await screen.findByTestId('terminal-erns-closed')
    expect(closed.textContent).toContain('The market is closed on Sat Nov 21, 2026.')
    expect(closed.getAttribute('data-kind')).toBe('empty')
    expect(within(closed).getByRole('button', { name: 'Next reports' })).toBeTruthy()
    cleanup()
    // the bare command already IS the next reports, so it offers no way back to itself
    serve({ [BARE]: { status: 'no_day', weekend: true, date: '2026-11-21', today: '2026-11-21', default: true } })
    renderPanel()
    expect(within(await screen.findByTestId('terminal-erns-closed')).queryByRole('button', { name: 'Next reports' })).toBeNull()
    cleanup()
    serve({ [urlFor('2026-11-19')]: { status: 'no_day', weekend: false, date: '2026-11-19', today: TODAY, default: false } })
    renderPanel({ day: '2026-11-19' })
    expect((await screen.findByTestId('terminal-erns-no-day')).textContent).toContain('The earnings calendar has no entry for Thu Nov 19, 2026.')
  })

  it('a day with nobody on the calendar says so, and is not a failed read', async () => {
    serve({ [urlFor(TODAY)]: day({}) })
    const { setFreshness } = renderPanel({ day: 'today' })
    const empty = await screen.findByTestId('terminal-erns-empty')
    expect(empty.textContent).toContain('No company is on the earnings calendar for Tue Nov 17, 2026.')
    expect(empty.textContent).toContain('That is what the calendar holds, not a failed read.')
    expect(within(empty).getByRole('button', { name: 'Next reports' })).toBeTruthy()
    expect(setFreshness.mock.calls.every(([report]) => report == null)).toBe(true)
    cleanup()
    serve({ [BARE]: day({}, { default: true }) })
    renderPanel()
    const none = await screen.findByTestId('terminal-erns-empty')
    expect(none.textContent).toContain('No company is on the calendar from today through the next ten days.')
    expect(within(none).queryByRole('button', { name: 'Next reports' })).toBeNull()
  })
})

describe('ERNS the day', () => {
  it('draws the groups in order, biggest first as the server sent them, with each count', async () => {
    serve({ [BARE]: { ...DAY, default: true } })
    const { publishRows, setFreshness } = renderPanel()
    await screen.findByTestId('terminal-erns-table-amc')
    expect(root().getAttribute('data-state')).toBe('ok')
    expect(root().getAttribute('data-date')).toBe(TODAY)
    expect(screen.getByTestId('terminal-erns-date').textContent).toBe('Tue Nov 17, 2026')
    expect(syms()).toEqual(['BBIG', 'BMISS', 'BWAIT', 'AAA', 'ANONE', 'ACLOSE', 'TLATE'])
    expect(screen.getByTestId('terminal-erns-table-bmo').querySelector('caption').textContent).toBe('Before the open (3), 2 reported')
    expect(screen.getByTestId('terminal-erns-table-amc').querySelector('caption').textContent).toBe('After the close (3), 1 reported')
    expect(screen.getByTestId('terminal-erns-table-tbd').querySelector('caption').textContent).toBe('Time not confirmed (1)')
    expect(screen.getByRole('table', { name: 'After the close, Tue Nov 17, 2026: 3 of 3 companies, biggest first' })).toBeTruthy()
    expect([...screen.getByTestId('terminal-erns-table-amc').querySelectorAll('th')].map((th) => th.textContent))
      .toEqual(['Symbol', 'Priced move', 'Past moves, %', 'Result and move'])
    expect(screen.getByTestId('terminal-erns-day').textContent).toBe(
      '7 companies report: 3 before the open, 3 after the close, 1 with no confirmed time. 3 have reported. '
      + 'Priced move stored for 4 of 7. Past reports on file for 3 of 7.')
    expect(publishRows).toHaveBeenLastCalledWith(['$BBIG', '$BMISS', '$BWAIT', '$AAA', '$ANONE', '$ACLOSE', '$TLATE'])
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith(expect.objectContaining({ source: SOURCE, observedAt: '2026-11-17T14:00:00.000Z' })))
    expect(pressed()).toEqual(['Next reports', 'All day'])
  })

  it('a reporter still to come: the priced move in percent and dollars, the last four moves and their average, and no result', async () => {
    serve({ [BARE]: DAY })
    renderPanel()
    await screen.findByTestId('terminal-erns-table-amc')
    const [sym, priced, past, result] = cells('AAA')
    expect(lines(sym)).toEqual(['4AAA', 'AAA Corp, $10.00B'])
    expect(lines(priced)).toEqual(['±7.5%', '$15.00'])
    expect(priced.className).toBe('')                                   // not stepped back: it is the number that matters now
    expect(lines(past)).toEqual(['+3.1 -2.0 +8.4 -1.3', 'avg ±4.0% of 5'])   // four drawn, the average over all five
    expect(past.getAttribute('title')).toBe('Past reports, newest first: Aug 18 +3.1%, May 19 -2.0%, Feb 17 +8.4%, Nov 18, 2025 -1.3%, Aug 19, 2025 +5.0%')
    expect(lines(result)).toEqual(['Not reported, EPS est. 1.10'])
    expect(result.textContent).not.toMatch(/%/)                         // no move is drawn for a stock that has not reported
  })

  it('a missing number is a dash or words, never 0', async () => {
    serve({ [BARE]: DAY })
    renderPanel()
    await screen.findByTestId('terminal-erns-table-amc')
    const [sym, priced, past, result] = cells('ANONE')
    expect(lines(sym)).toEqual(['5ANONE', 'ANONE Corp, $10.00B'])
    expect(priced.textContent).toBe('—')
    expect(priced.querySelector('[title]').getAttribute('title')).toBe('No priced move is stored for this report')
    expect(past.textContent).toBe('not on file')
    expect(lines(result)).toEqual(['Not reported, no EPS estimate'])
    expect(cells('TLATE')[2].textContent).toBe('too few')
    expect(cells('TLATE')[2].getAttribute('title')).toBe('Too few past reports could be measured')
    // no market cap and no name: the symbol alone
    expect(lines(cells('BWAIT')[0])).toEqual(['3BWAIT'])
    expect(lines(cells('BMISS')[1])).toEqual(['±3.0%', 'dollars not stored'])
    for (const cell of [priced, past, result]) expect(cell.textContent).not.toMatch(/\b0(\.0+)?%/)
  })

  it('once a result is in: the verdict and figures, the move against what was priced, and the priced move steps back', async () => {
    serve({ [BARE]: DAY })
    renderPanel()
    await screen.findByTestId('terminal-erns-table-amc')
    const big = cells('BBIG')
    expect(lines(big[0])).toEqual(['1BBIG', 'BBIG Corp, $3.40T'])
    expect(lines(big[3])).toEqual(['Beat, EPS 1.25 vs 1.10', '+8.1% more than priced so far'])
    expect(big[1].className).toContain('muted')
    expect(within(big[3]).getByTestId('terminal-erns-verdict').className).toContain('up')
    expect(within(big[3]).getByTestId('terminal-erns-move').className).toContain('up')
    const miss = cells('BMISS')
    expect(lines(miss[3])).toEqual(['Missed, EPS 0.80 vs 1.10', '-1.2% within priced so far'])
    expect(within(miss[3]).getByTestId('terminal-erns-verdict').className).toContain('down')
    expect(within(miss[3]).getByTestId('terminal-erns-move').className).toContain('down')
    // a report after the close today has no move yet, in words, and no percent
    const close = cells('ACLOSE')
    expect(lines(close[3])).toEqual(['Mixed, EPS 1.25 vs 1.10', 'move at the next close'])
    expect(within(close[3]).queryByTestId('terminal-erns-move')).toBeNull()
    expect(rows().find((r) => r.getAttribute('data-sym') === 'ACLOSE').getAttribute('data-reported')).toBe('yes')
  })

  it('says once why nothing is priced, and how to see one stock\'s live figure', async () => {
    serve({ [urlFor(TOMORROW)]: TOMORROW_DAY })
    const { open } = renderPanel({ day: 'tomorrow' })
    await screen.findByTestId('terminal-erns-table-amc')
    const note = screen.getByTestId('terminal-erns-none-priced')
    expect(note.textContent).toContain('No priced move is stored for this day yet. UCT stores it once, in its weekday capture at about 4:35 PM ET, for reports due that night or the next day')
    expect(screen.getAllByTestId('terminal-erns-none-priced')).toHaveLength(1)
    expect(screen.getByTestId('terminal-erns-day').textContent).toBe('2 companies report after the close. Priced move stored for 0 of 2. Past reports on file for 0 of 2.')
    fireEvent.click(within(note).getByTestId('panel-command-EXMV'))
    expect(open).toHaveBeenCalledWith('EXMV')
    expect(screen.getByTestId('terminal-erns-method').textContent).toContain('Results and moves fill in as each company reports.')
    expect(screen.getByTestId('terminal-erns-method').textContent).toContain('this panel reads it again every 5 minutes.')
  })

  it('a store that could not be read is said as that, never as nothing priced', async () => {
    serve({ [BARE]: day({ amc: [row('AAA')] }, { priced_state: 'failed' }) })
    renderPanel()
    await screen.findByTestId('terminal-erns-table-amc')
    expect(screen.getByTestId('terminal-erns-priced-failed').textContent)
      .toBe('The stored priced moves could not be read just now, so none is shown. That is not the same as none being priced.')
    expect(screen.queryByTestId('terminal-erns-none-priced')).toBeNull()
    expect(screen.getByTestId('terminal-erns-day').textContent).toBe('1 company reports after the close. None has reported yet. Past reports on file for 0 of 1.')
  })

  it('a past day whose moves the server does not hold says so and points at the scoreboard', async () => {
    serve({ [urlFor(YESTERDAY)]: day({ bmo: [row('OLD', { session: 'bmo', eps_act: 1.2, reported: true, verdict: 'beat', move_state: 'not_held' })] },
      { date: YESTERDAY, day_kind: 'past', moves_state: 'not_held' }) })
    const { open } = renderPanel({ day: YESTERDAY })
    await screen.findByTestId('terminal-erns-table-bmo')
    expect(lines(cells('OLD')[3])).toEqual(['Beat, EPS 1.20 vs 1.10', 'move not held'])
    const note = screen.getByTestId('terminal-erns-moves-not-held')
    expect(note.textContent).toContain('The server is not holding the moves for Mon Nov 16, 2026 right now, so none is shown; that is not the same as no move.')
    fireEvent.click(within(note).getByTestId('panel-command-EMOV-2026-11-16'))
    expect(open).toHaveBeenCalledWith('EMOV 2026-11-16')
    expect(screen.getByTestId('terminal-erns-method').textContent)
      .toContain('A report before the open, or with no confirmed time, is measured from the prior close to that day\'s close, and one after the close from that day\'s close to the next.')
  })

  it('a settled move reads against what was priced, and a failed price read today is said', async () => {
    serve({ [urlFor(YESTERDAY)]: day({ bmo: [
      row('WIN', { session: 'bmo', eps_act: 1.2, reported: true, verdict: 'beat', move: 9.04, move_state: 'settled', priced: { pct: 5, dollar: 4 } }),
      row('PLAIN', { session: 'bmo', eps_act: 1.2, eps_est: null, reported: true, move: -2, move_state: 'settled' }),
      row('NOMOVE', { session: 'bmo', eps_act: 1.2, reported: true, verdict: 'beat', move_state: 'none' }),
    ] }, { date: YESTERDAY, day_kind: 'past', moves_state: 'held' }) })
    renderPanel({ day: YESTERDAY })
    await screen.findByTestId('terminal-erns-table-bmo')
    expect(lines(cells('WIN')[3])).toEqual(['Beat, EPS 1.20 vs 1.10', '+9.0% more than priced'])
    expect(lines(cells('PLAIN')[3])).toEqual(['Reported, EPS 1.20, no estimate', '-2.0% close to close'])
    expect(lines(cells('NOMOVE')[3])).toEqual(['Beat, EPS 1.20 vs 1.10', 'no move yet'])
    expect(screen.queryByTestId('terminal-erns-moves-not-held')).toBeNull()
    cleanup()
    serve({ [BARE]: day({ bmo: [row('AAA', { session: 'bmo', eps_act: 1.2, reported: true, verdict: 'beat', move_state: 'failed' })] }, { moves_state: 'failed' }) })
    renderPanel()
    await screen.findByTestId('terminal-erns-table-bmo')
    expect(screen.getByTestId('terminal-erns-moves-failed').textContent).toBe('Today\'s moves could not be read just now. That is not the same as no move.')
    expect(lines(cells('AAA')[3])[1]).toBe('move not read')
  })

  it('the method line names the sources and today\'s rule, and says when it was put together', async () => {
    serve({ [BARE]: { ...DAY, refreshing: true, counts: { ...DAY.counts, priced_withheld: 1 } } })
    renderPanel()
    await screen.findByTestId('terminal-erns-table-amc')
    const method = screen.getByTestId('terminal-erns-method').textContent
    expect(method).toContain('Companies on UCT\'s earnings calendar for Tue Nov 17, 2026, biggest first by market cap.')
    expect(method).toContain('UCT stores it once, in its weekday capture at about 4:35 PM ET, from its own option chain read')
    expect(method).toContain('from UCT daily bars, shown where the server already holds them: the last 4, newest first')
    expect(method).toContain('Today a report before the open, or with no confirmed time, shows the regular session\'s change so far; a report after the close is measured at the next close, so it has no move yet.')
    expect(method).toContain('1 stored figure was left out because it did not come from UCT\'s own option chain read.')
    expect(method).toContain('Put together at 9:05 AM ET, and being updated now; this panel reads it again every minute.')
    expect(screen.queryByTestId('terminal-erns-none-priced')).toBeNull()
  })

  it('calendar entries with no readable symbol are counted, never drawn', async () => {
    serve({ [BARE]: day({ amc: [row('AAA'), { sym: '' }, 'junk'] }) })
    renderPanel()
    await screen.findByTestId('terminal-erns-table-amc')
    expect(syms()).toEqual(['AAA'])
    expect(screen.getByTestId('terminal-erns-unread').textContent).toBe('2 calendar entries came without a symbol and are not listed.')
  })

  it('a refresh that fails keeps the last day and says it is the last read', async () => {
    let calls = 0
    jsonFetcher.mockImplementation(async () => { calls += 1; if (calls === 1) return DAY; throw fail(500) })
    renderPanel()
    await screen.findByTestId('terminal-erns-table-amc')
    expect(screen.queryByTestId('terminal-erns-stale-read')).toBeNull()
    await act(async () => { await swr.mutate(stampedKey(BARE)).catch(() => {}) })
    const note = await screen.findByTestId('terminal-erns-stale-read')
    expect(note.textContent).toBe('The earnings season screen could not be read just now. Showing the last read.')
    expect(syms()).toHaveLength(7)
    expect(screen.queryByTestId('terminal-erns-error')).toBeNull()
  })

  it('a long group is cut on screen and counted, and row numbers run on across the groups', async () => {
    const many = Array.from({ length: GROUP_ROWS + 5 }, (_, i) => row(`Z${String(i).padStart(2, '0')}`))
    serve({ [BARE]: day({ bmo: [row('FIRST', { session: 'bmo' })], amc: many, tbd: [row('LAST', { session: 'tbd' })] }) })
    const { publishRows } = renderPanel()
    await screen.findByTestId('terminal-erns-table-amc')
    expect(GROUP_ROWS).toBe(15)
    expect(rows()).toHaveLength(1 + GROUP_ROWS + 1)
    expect(screen.getByTestId('terminal-erns-cut-amc').textContent).toBe('Showing the 15 biggest of 20, by market cap.')
    expect(screen.getByRole('table', { name: 'After the close, Tue Nov 17, 2026: 15 of 20 companies, biggest first' })).toBeTruthy()
    // the numbers a member types follow the rows on screen
    expect(cells('Z00')[0].textContent.startsWith('2Z00')).toBe(true)
    expect(cells('LAST')[0].textContent.startsWith('17LAST')).toBe(true)
    expect(publishRows.mock.calls.at(-1)[0]).toHaveLength(17)
    expect(publishRows.mock.calls.at(-1)[0][16]).toBe('$LAST')
    fireEvent.click(screen.getByTestId('terminal-erns-more-amc'))
    expect(rows()).toHaveLength(22)
    expect(screen.queryByTestId('terminal-erns-more-amc')).toBeNull()
    expect(cells('LAST')[0].textContent.startsWith('22LAST')).toBe(true)
    expect(publishRows.mock.calls.at(-1)[0]).toHaveLength(22)
    // the day sentence counts every company, drawn or not
    expect(screen.getByTestId('terminal-erns-day').textContent).toContain('22 companies report: 1 before the open, 20 after the close, 1 with no confirmed time.')
  })

  it('a symbol loads that stock into the linked panels', async () => {
    serve({ [BARE]: DAY })
    const { run } = renderPanel()
    await screen.findByTestId('terminal-erns-table-amc')
    fireEvent.click(screen.getByTestId('panel-symbol-AAA'))
    expect(run).toHaveBeenCalledWith('$AAA')
  })
})

describe('ERNS chips and typed words', () => {
  it('a day chip asks for that day, and the next day\'s rows are never drawn under the old day\'s name', async () => {
    serve({ [BARE]: DAY, [urlFor(TOMORROW)]: PENDING })
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-erns-table-amc')
    fireEvent.click(screen.getByTestId('terminal-erns-day-tomorrow'))
    // the new day is on its way: a skeleton, not yesterday's rows under tomorrow's name
    expect(screen.getByTestId('terminal-erns-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-erns-row')).toBeNull()
    expect(screen.getByTestId('terminal-erns-date').textContent).toBe('Wed Nov 18, 2026')
    expect(asked()).toEqual([BARE, urlFor(TOMORROW)])
    expect(pressed()).toEqual(['Tomorrow', 'All day'])
    // outside the shell nothing is re-run
    expect(rerun).not.toHaveBeenCalled()
    cleanup()
    serve({ [BARE]: DAY, [urlFor(TOMORROW)]: TOMORROW_DAY, [urlFor(TODAY)]: DAY })
    renderPanel()
    await screen.findByTestId('terminal-erns-table-amc')
    fireEvent.click(screen.getByTestId('terminal-erns-day-tomorrow'))
    await waitFor(() => expect(syms()).toEqual(['NEXT1', 'NEXT2']))
    fireEvent.click(screen.getByTestId('terminal-erns-day-today'))
    await waitFor(() => expect(syms()).toHaveLength(7))
    expect(asked()).toEqual([BARE, urlFor(TOMORROW), urlFor(TODAY)])
  })

  it('the part-of-the-day chips show one group and count only it; nothing is read again', async () => {
    serve({ [BARE]: DAY })
    const { publishRows } = renderPanel()
    await screen.findByTestId('terminal-erns-table-amc')
    fireEvent.click(screen.getByTestId('terminal-erns-session-amc'))
    expect(syms()).toEqual(['AAA', 'ANONE', 'ACLOSE'])
    expect(screen.queryByTestId('terminal-erns-table-bmo')).toBeNull()
    expect(screen.getByTestId('terminal-erns-day').textContent)
      .toBe('3 companies report after the close. 1 has reported. Priced move stored for 2 of 3. Past reports on file for 2 of 3.')
    expect(cells('AAA')[0].textContent.startsWith('1AAA')).toBe(true)
    expect(publishRows).toHaveBeenLastCalledWith(['$AAA', '$ANONE', '$ACLOSE'])
    fireEvent.click(screen.getByTestId('terminal-erns-session-bmo'))
    expect(syms()).toEqual(['BBIG', 'BMISS', 'BWAIT'])
    fireEvent.click(screen.getByTestId('terminal-erns-session-all'))
    expect(syms()).toHaveLength(7)
    expect(jsonFetcher).toHaveBeenCalledTimes(1)
  })

  it('a part of the day with nobody says so and offers the whole day', async () => {
    serve({ [BARE]: day({ amc: [row('AAA')] }) })
    renderPanel()
    await screen.findByTestId('terminal-erns-table-amc')
    fireEvent.click(screen.getByTestId('terminal-erns-session-bmo'))
    const none = screen.getByTestId('terminal-erns-none-match')
    expect(none.textContent).toContain('No company reports before the open on Tue Nov 17, 2026.')
    expect(none.textContent).toContain('1 company reports at another time that day.')
    expect(screen.queryByTestId('terminal-erns-row')).toBeNull()
    fireEvent.click(within(none).getByRole('button', { name: 'Show the whole day' }))
    expect(syms()).toEqual(['AAA'])
  })

  it('typed words seed the chips: tonight is today after the close', async () => {
    serve({ [urlFor(TODAY)]: DAY })
    renderPanel({ day: 'tonight' })
    await screen.findByTestId('terminal-erns-table-amc')
    expect([root().getAttribute('data-day'), root().getAttribute('data-session')]).toEqual(['today', 'amc'])
    expect(syms()).toEqual(['AAA', 'ANONE', 'ACLOSE'])
    expect(pressed()).toEqual(['Today', 'After the close'])
    expect(asked()).toEqual([urlFor(TODAY)])
    cleanup()
    jsonFetcher.mockReset()
    serve({ [urlFor(TOMORROW)]: TOMORROW_DAY })
    renderPanel({ day: '2026-11-18', session: 'bmo' })                   // a date that is the next session is "Tomorrow"
    await screen.findByTestId('terminal-erns-none-match')
    expect(pressed()).toEqual(['Tomorrow', 'Before the open'])
    cleanup()
    jsonFetcher.mockReset()
    serve({ [BARE]: DAY })
    renderPanel({ day: 'nonsense', session: 7 })                         // unknown words are the default
    await screen.findByTestId('terminal-erns-table-amc')
    expect(pressed()).toEqual(['Next reports', 'All day'])
    expect(asked()).toEqual([BARE])
  })

  it('in the shell every pick is written into the command, in the words a member would type', async () => {
    serve({ [BARE]: { ...DAY, default: true }, [urlFor(TODAY)]: DAY, [urlFor(TOMORROW)]: TOMORROW_DAY,
      [urlFor(YESTERDAY)]: day({}, { date: YESTERDAY, day_kind: 'past' }) })
    const { rerun } = renderPanel({}, { code: 'ERNS' })
    await screen.findByTestId('terminal-erns-table-amc')
    fireEvent.click(screen.getByTestId('terminal-erns-day-tomorrow'))
    expect(rerun).toHaveBeenLastCalledWith('ERNS TOMORROW')
    fireEvent.click(screen.getByTestId('terminal-erns-session-amc'))
    expect(rerun).toHaveBeenLastCalledWith('ERNS TOMORROW AMC')
    fireEvent.click(screen.getByTestId('terminal-erns-day-today'))
    expect(rerun).toHaveBeenLastCalledWith('ERNS TONIGHT')
    fireEvent.click(screen.getByTestId('terminal-erns-session-all'))
    expect(rerun).toHaveBeenLastCalledWith('ERNS TODAY')
    await screen.findByTestId('terminal-erns-table-amc')
    fireEvent.click(screen.getByTestId('terminal-erns-prev'))
    expect(rerun).toHaveBeenLastCalledWith('ERNS 2026-11-16')
    fireEvent.click(screen.getByTestId('terminal-erns-day-next'))
    expect(rerun).toHaveBeenLastCalledWith('ERNS')
    await screen.findByTestId('terminal-erns-table-amc')
    fireEvent.click(screen.getByTestId('terminal-erns-next'))            // the day after today is "tomorrow", kept as the word
    expect(rerun).toHaveBeenLastCalledWith('ERNS TOMORROW')
  })

  it('in the shell a chip keeps working when the registry does not take its word (the choice stays in the panel)', async () => {
    serve({ [BARE]: DAY })
    // MOST is a registered code that takes none of these words, so nothing may be written back
    const { rerun } = renderPanel({}, { code: 'MOST' })
    await screen.findByTestId('terminal-erns-table-amc')
    fireEvent.click(screen.getByTestId('terminal-erns-session-amc'))
    expect(rerun).not.toHaveBeenCalled()
    expect(syms()).toEqual(['AAA', 'ANONE', 'ACLOSE'])
    // the default is the bare command, which any registered code takes
    fireEvent.click(screen.getByTestId('terminal-erns-session-all'))
    expect(rerun).toHaveBeenLastCalledWith('MOST')
  })

  it('on a Friday the Tomorrow chip names Monday, and stepping skips the weekend', async () => {
    const friday = '2026-11-20'
    serve({ [urlFor(friday)]: day({ amc: [row('AAA')] }, { date: friday, today: TODAY, day_kind: 'future' }), [urlFor('2026-11-23')]: PENDING })
    renderPanel({ day: friday })
    await screen.findByTestId('terminal-erns-table-amc')
    expect(screen.getByTestId('terminal-erns-day-tomorrow').textContent).toBe('Tomorrow')   // today is Tuesday here
    fireEvent.click(screen.getByTestId('terminal-erns-next'))
    expect(screen.getByTestId('terminal-erns-date').textContent).toBe('Mon Nov 23, 2026')
    expect(asked()).toEqual([urlFor(friday), urlFor('2026-11-23')])
  })
})

describe('ERNS words (pure)', () => {
  const view = earningsSeasonRead(DAY)
  const all = ['bmo', 'amc', 'tbd'].flatMap((s) => view.groups[s])
  const of = (sym) => all.find((r) => r.sym === sym)

  it('dayLabel and shortDay', () => {
    expect(dayLabel('2026-11-17')).toBe('Tue Nov 17, 2026')
    expect(dayLabel('nonsense')).toBe('nonsense')
    expect(dayLabel(null)).toBe('')
    expect(shortDay('2026-08-18', TODAY)).toBe('Aug 18')
    expect(shortDay('2025-08-19', TODAY)).toBe('Aug 19, 2025')
    expect(shortDay('2025-08-19')).toBe('Aug 19')
  })

  it('daySentence counts what is there, and leaves out what it cannot say', () => {
    expect(daySentence(view, [], 'all')).toBe('')
    const one = earningsSeasonRead(day({ tbd: [row('ONE', { session: 'tbd', priced: { pct: 5 } })] }, { date: TOMORROW, day_kind: 'future' }))
    expect(daySentence(one, one.groups.tbd, 'all')).toBe('1 company reports with no confirmed time. Priced move stored for 1 of 1. Past reports on file for 0 of 1.')
    const past = earningsSeasonRead(day({ bmo: [row('ONE', { session: 'bmo' })] }, { date: YESTERDAY, day_kind: 'past' }))
    expect(daySentence(past, past.groups.bmo, 'bmo')).toBe('1 company reports before the open. None has reported yet. Priced move stored for 0 of 1. Past reports on file for 0 of 1.')
  })

  it('resultWords, moveWords and pastSentence', () => {
    expect(resultWords(of('AAA'))).toEqual(['Not reported', 'EPS est. 1.10'])
    expect(resultWords(of('ANONE'))).toEqual(['Not reported', 'no EPS estimate'])
    expect(resultWords(of('BBIG'))).toEqual(['Beat', 'EPS 1.25 vs 1.10'])
    expect(resultWords({ reported: true, verdict: null, epsAct: -0.5, epsEst: null })).toEqual(['Reported', 'EPS -0.50, no estimate'])
    expect(moveWords(of('AAA'))).toEqual(['', false])
    expect(moveWords(of('BBIG'))).toEqual(['more than priced so far', true])
    expect(moveWords(of('ACLOSE'))).toEqual(['move at the next close', false])
    expect(moveWords({ reported: true, move: 2, moveState: 'live', against: null })).toEqual(['so far today', true])
    expect(moveWords({ reported: true, move: 2, moveState: 'settled', against: 'within' })).toEqual(['within priced', true])
    expect(moveWords({ reported: true, move: null, moveState: 'not_held' })).toEqual(['move not held', false])
    expect(moveWords({ reported: true, move: null, moveState: 'none' })).toEqual(['no move yet', false])
    expect(pastSentence(of('ANONE'), TODAY)).toBe('No past reports are held for this stock yet')
    expect(pastSentence(of('BBIG'), TODAY)).toBe('Past reports, newest first: Aug 18 +3.1%, May 19 -2.0%, Feb 17 +8.4%, Nov 18, 2025 -1.3%')
  })
})

describe('ERNS follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['EarningsSeasonPanel.jsx', 'earningsSeasonModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('ERNS accessibility', () => {
  it('the day, one part of it, a day with nothing priced and the states pass axe (WCAG A and AA)', async () => {
    serve({ [BARE]: DAY, [urlFor(TOMORROW)]: TOMORROW_DAY })
    renderPanel()
    await screen.findByTestId('terminal-erns-table-amc')
    await expectNoAxeViolations(document.body.firstElementChild)
    fireEvent.click(screen.getByTestId('terminal-erns-session-amc'))
    expect(pressed()).toHaveLength(2)
    await expectNoAxeViolations(document.body.firstElementChild)
    fireEvent.click(screen.getByTestId('terminal-erns-day-tomorrow'))
    await screen.findByTestId('terminal-erns-none-priced')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [BARE]: { status: 'computing', date: null, default: true } })
    renderPanel()
    await screen.findByTestId('terminal-erns-computing')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [BARE]: fail(500) })
    renderPanel()
    await screen.findByTestId('terminal-erns-error')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)
})
