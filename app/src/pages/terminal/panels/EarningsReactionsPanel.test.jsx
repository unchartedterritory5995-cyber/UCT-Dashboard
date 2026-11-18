// EMOV: the earnings scoreboard for one day. Rails:
//   * the pure half (earningsReactionsModel.js): session stepping, the default day, who reported,
//     the rows (biggest move first) and the tally (up, down, median);
//   * the panel pairs the two reads the Calendar page makes: the week (who reported) and the moves;
//   * the day buttons step a session at a time and write the day into the command;
//   * a failed read is an error with Retry, never "nobody reported"; one read failing keeps the other;
//   * reporters with an empty moves answer say the moves are missing, never that nothing moved;
//   * 402 and 404 are locked with no Retry.
// Fixtures are the shapes api/routers/calendar.py returns (`get_calendar`, `get_reactions`).
// The route has no "building" answer, so there is no warming state to test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import EarningsReactionsPanel, {
  EMOV_CODE, dayLabel, defaultReactionDate, epsSurprisePct, epsText, isIsoDate, isSessionDay, newestReactionDate,
  nextSession, prevSession, reactionDateOrDefault, reactionMap, reactionRows, reactionTally, reactionsCommand,
  reactionsUrl, reportersOf, reportersUrl, shiftDay, tallyText, weekdayOf,
} from './EarningsReactionsPanel'
import * as model from './earningsReactionsModel'

// Friday 2026-11-13, 5:30 PM Eastern: the session has closed, so it is the latest finished one.
const NOW = new Date('2026-11-13T22:30:00Z')
const THU = '2026-11-12'
const FRI = '2026-11-13'
const WEEK_URL = '/api/calendar?week=2026-11-09'

const day = (over) => ({ label: 'x', day: 'x', is_today: false, bmo: [], amc: [], tbd: [], econ: [], fed: [], ...over })
const WEEK = {
  week_start: '2026-11-09', week_end: '2026-11-13', source: 'range', is_current_week: true,
  days: {
    [THU]: day({
      bmo: [
        { sym: 'AAA', name: 'Alpha Corp', eps_est: 1.1, eps_act: 1.25, rev_est: 500, rev_act: 520 },
        { sym: 'BBB', name: 'Beta Inc', eps_est: 0.5, eps_act: 0.4, rev_est: 90, rev_act: 88 },
      ],
      amc: [
        { sym: 'CCC', name: 'Gamma Ltd', eps_est: 2, eps_act: 2, rev_est: null, rev_act: null },
        { sym: 'DDD', name: 'Delta Co', eps_est: null, eps_act: 0.05 },
      ],
      tbd: [{ sym: 'EEE', name: 'Epsilon Plc', eps_est: 0.2, eps_act: null }],
    }),
    [FRI]: day({
      is_today: true,
      bmo: [{ sym: 'FFF', name: 'Phi Group', eps_est: 1, eps_act: 1.5 }],
      amc: [{ sym: 'GGG', name: 'Gee Holdings', eps_est: 1, eps_act: null }],
    }),
    '2026-11-11': day({ amc: [{ sym: 'HHH', name: 'Aitch', eps_est: 1, eps_act: null }, { sym: 'III', name: 'Eye', eps_est: 2, eps_act: null }] }),
    '2026-11-10': day({}),
  },
}
const MOVES_THU = { AAA: 8.42, BBB: -12.5, CCC: 1.5 }   // DDD reported after the close: no next close yet
const MOVES_FRI = { FFF: 4.1 }

const httpError = (status) => Object.assign(new Error(`http ${status}`), { status })
/** Serves each URL its body (an Error instance is thrown); anything else is a 500. */
function serve(routes) {
  jsonFetcher.mockImplementation(async (url) => {
    if (url in routes) {
      const hit = routes[url]
      if (hit instanceof Error) throw hit
      return hit
    }
    throw httpError(500)
  })
}

function renderPanel(props = {}, { run = vi.fn(), rerun = vi.fn(), publishRows = vi.fn(), freshness = vi.fn(), code = null } = {}) {
  const tree = (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={freshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run, rerun, publish: vi.fn(), publishRows }}>
          <EarningsReactionsPanel {...props} />
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>
  )
  render(code ? <TerminalPanelContext.Provider value={{ code, density: 'compact', inset: true }}>{tree}</TerminalPanelContext.Provider> : tree)
  return { run, rerun, publishRows, freshness }
}
const symsInTable = () => within(screen.getByTestId('terminal-ernr-table')).getAllByRole('row').slice(1)
  .map((r) => r.getAttribute('data-testid').replace('terminal-ernr-row-', ''))

beforeEach(() => {
  jsonFetcher.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] })   // the clock only: SWR and the test's own waits stay real
  vi.setSystemTime(NOW)
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('EMOV pure helpers (earningsReactionsModel)', () => {
  it('the panel re-exports the model, so a caller can import either', () => {
    expect(reactionRows).toBe(model.reactionRows)
    expect(reportersOf).toBe(model.reportersOf)
    expect(EMOV_CODE).toBe('EMOV')
  })

  it('the two URLs: the moves for the day, and the week that holds it', () => {
    expect(reactionsUrl(THU)).toBe('/api/calendar/reactions?date=2026-11-12')
    expect(reportersUrl(THU)).toBe(WEEK_URL)
    expect(reportersUrl('2026-11-14')).toBe(WEEK_URL)   // a Saturday belongs to the week it ends
    expect(reportersUrl('2026-02-30')).toBeNull()
    expect(reportersUrl('soon')).toBeNull()
  })

  it('dates: real days only, zone-free arithmetic, weekdays named', () => {
    expect(isIsoDate(THU)).toBe(true)
    for (const bad of ['2026-02-30', '2026-13-01', '11/12', '', null, 20261112]) expect(isIsoDate(bad)).toBe(false)
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
    expect(weekdayOf(THU)).toBe('Thu')
    expect(weekdayOf('nope')).toBe('')
    expect(dayLabel(FRI)).toBe('Fri Nov 13, 2026')
  })

  it('sessions skip weekends and NYSE holidays', () => {
    expect(isSessionDay(THU)).toBe(true)
    expect(isSessionDay('2026-11-14')).toBe(false)      // Saturday
    expect(isSessionDay('2026-11-26')).toBe(false)      // Thanksgiving
    expect(isSessionDay('not a day')).toBe(false)
    expect(prevSession('2026-11-16')).toBe(FRI)         // Monday -> Friday
    expect(nextSession(FRI)).toBe('2026-11-16')
    expect(nextSession('2026-11-25')).toBe('2026-11-27')
    expect(prevSession('2026-11-27')).toBe('2026-11-25')
  })

  it('the default day is the latest FINISHED session in Eastern time', () => {
    expect(defaultReactionDate(Date.parse('2026-11-13T22:30:00Z'))).toBe(FRI)    // Fri 5:30 PM ET: closed
    expect(defaultReactionDate(Date.parse('2026-11-13T19:00:00Z'))).toBe(THU)    // Fri 2:00 PM ET: still open
    expect(defaultReactionDate(Date.parse('2026-11-15T17:00:00Z'))).toBe(FRI)    // Sunday
    expect(defaultReactionDate()).toBe(FRI)                                        // the faked clock
    expect(newestReactionDate(FRI)).toBe(FRI)
    expect(newestReactionDate('2026-11-15')).toBe(FRI)
  })

  it('a typed day is kept when real and not in the future; the command names it unless it is the default', () => {
    const o = { today: FRI, fallback: FRI }
    expect(reactionDateOrDefault(THU, o)).toBe(THU)
    expect(reactionDateOrDefault('2026-11-14', { today: '2026-11-16', fallback: FRI })).toBe('2026-11-14')
    for (const bad of [null, undefined, '', '2026-11-20', '2026-02-30', 'TODAY']) expect(reactionDateOrDefault(bad, o)).toBe(FRI)
    expect(reactionsCommand(THU, { fallback: FRI })).toBe('EMOV 2026-11-12')
    expect(reactionsCommand(FRI, { fallback: FRI })).toBe('EMOV')
    expect(reactionsCommand(THU, { code: 'ERM', fallback: FRI })).toBe('ERM 2026-11-12')
  })

  it('EPS surprise is against the size of the estimate, and unknown when there is none', () => {
    expect(epsSurprisePct(0.4, 0.5)).toBeCloseTo(-20)
    expect(epsSurprisePct(-0.1, -0.2)).toBeCloseTo(50)   // a smaller loss than expected is a beat
    for (const [a, e] of [[1, null], [null, 1], [1, 0], ['x', 1]]) expect(epsSurprisePct(a, e)).toBeNull()
  })

  it('reportersOf: who reported (an EPS on file), their session, and how many were scheduled', () => {
    const cal = reportersOf(WEEK, THU)
    expect(cal.state).toBe('ok')
    expect(cal.scheduled).toBe(5)
    expect(cal.reporters.map((r) => `${r.sym}:${r.session}`)).toEqual(['AAA:bmo', 'BBB:bmo', 'CCC:amc', 'DDD:amc'])
    expect(cal.reporters[0]).toMatchObject({ name: 'Alpha Corp', epsActual: 1.25, epsEstimate: 1.1, revActual: 520, revEstimate: 500 })
    expect(cal.reporters[0].surprisePct).toBeCloseTo(13.636, 2)
    expect(cal.reporters[3]).toMatchObject({ sym: 'DDD', epsEstimate: null, surprisePct: null })
  })

  it('reportersOf never reads a failure, a far-off week or a missing day as "nobody reported"', () => {
    expect(reportersOf({ days: {}, source: 'error' }, THU).state).toBe('failed')
    expect(reportersOf({ days: {}, source: 'out_of_range' }, THU).state).toBe('out-of-range')
    expect(reportersOf(WEEK, '2026-11-14').state).toBe('no-day')
    for (const body of [null, undefined, [], 'x']) expect(reportersOf(body, THU).state).toBe('failed')
    expect(reportersOf(WEEK, '2026-11-10')).toEqual({ state: 'ok', reporters: [], scheduled: 0 })
  })

  it('reactionMap keeps numbers only; reactionRows orders by the size of the move, no-move last', () => {
    expect(reactionMap({ aaa: 1.5, BBB: '2', CCC: null, DDD: 'x', '': 3 })).toEqual({ AAA: 1.5, BBB: 2 })
    for (const body of [null, [], 'x', 5]) expect(reactionMap(body)).toEqual({})
    const rows = reactionRows(reportersOf(WEEK, THU).reporters, reactionMap(MOVES_THU))
    expect(rows.map((r) => r.sym)).toEqual(['BBB', 'AAA', 'CCC', 'DDD'])
    expect(rows.map((r) => r.move)).toEqual([-12.5, 8.42, 1.5, null])
    expect(rows.map((r) => r.size)).toEqual([12.5, 8.42, 1.5, null])
    expect(rows.map((r) => r.order)).toEqual([0, 1, 2, 3])
    // a symbol only the moves answer names still gets a row (the calendar read failed)
    const loose = reactionRows([], { ZZZ: -3, YYY: 9 })
    expect(loose.map((r) => r.sym)).toEqual(['YYY', 'ZZZ'])
    expect(loose[0]).toMatchObject({ name: null, session: null, surprisePct: null, move: 9 })
  })

  it('the tally counts up, down and unchanged, takes the median, and counts the reporters with no move', () => {
    const rows = reactionRows(reportersOf(WEEK, THU).reporters, MOVES_THU)
    expect(reactionTally(rows)).toEqual({ reported: 4, moved: 3, up: 2, down: 1, flat: 0, noMove: 1, median: 1.5 })
    expect(tallyText(reactionTally(rows))).toBe('4 reported. 2 up, 1 down. Median move +1.50%. 1 has no move yet.')
    const even = reactionTally([{ move: -4 }, { move: 0 }, { move: 2 }, { move: 10 }])
    expect(even).toMatchObject({ up: 2, down: 1, flat: 1, median: 1 })
    expect(tallyText(even)).toBe('4 reported. 2 up, 1 down, 1 unchanged. Median move +1.00%.')
    expect(reactionTally([{ move: null }]).median).toBeNull()
    expect(tallyText(reactionTally([{ move: null }, { move: null }]))).toBe('2 reported. No moves yet.')
    expect(tallyText(reactionTally([]))).toBe('')
  })

  it('epsText: reported against expected, or the reported figure alone', () => {
    expect(epsText({ epsActual: 1.25, epsEstimate: 1.1 })).toBe('1.25 vs 1.10 expected')
    expect(epsText({ epsActual: 0.05, epsEstimate: null })).toBe('0.05, no estimate')
    expect(epsText({ epsActual: null })).toBe('n/a')
  })
})

describe('EMOV panel', () => {
  it('shows a skeleton while the reads are out, with the day buttons already there', () => {
    jsonFetcher.mockReturnValue(new Promise(() => {}))
    renderPanel()
    expect(screen.getByTestId('terminal-ernr-loading').textContent).toContain('Loading earnings reactions for Fri Nov 13, 2026')
    expect(screen.getByTestId('terminal-ernr-date').textContent).toBe('Fri Nov 13, 2026')
    expect(screen.getByTestId('terminal-ernr-prev')).toBeTruthy()
    expect(screen.queryByTestId('terminal-ernr-empty')).toBeNull()
  })

  it('opens on the latest finished session and reads its moves and its week', async () => {
    serve({ [WEEK_URL]: WEEK, [reactionsUrl(FRI)]: MOVES_FRI })
    const { freshness } = renderPanel()
    await screen.findByTestId('terminal-ernr-table')
    expect(screen.getByTestId('terminal-ernr').getAttribute('data-date')).toBe(FRI)
    expect(jsonFetcher).toHaveBeenCalledWith('/api/calendar/reactions?date=2026-11-13')
    expect(jsonFetcher).toHaveBeenCalledWith(WEEK_URL)
    expect(symsInTable()).toEqual(['FFF'])   // GGG has not reported
    expect(screen.getByTestId('terminal-ernr-tally').textContent).toBe('1 reported. 1 up, 0 down. Median move +4.10%.')
    // today: the moves are live, and the header's as-of is when they were read
    expect(screen.getByTestId('terminal-ernr-method').textContent).toContain('For today the move is the live change so far today.')
    const report = freshness.mock.calls.map((c) => c[0]).filter(Boolean).pop()
    expect(report.source).toBe('UCT earnings calendar, Massive prices')
    expect(report.observedAt).toBe(NOW.toISOString())
    // nothing newer to step to
    expect(screen.queryByTestId('terminal-ernr-next')).toBeNull()
    expect(screen.queryByTestId('terminal-ernr-latest')).toBeNull()
  })

  it('a typed day: rows biggest move first with every field, the tally, the as-of, and a symbol loads', async () => {
    serve({ [WEEK_URL]: WEEK, [reactionsUrl(THU)]: MOVES_THU })
    const { run, publishRows, freshness } = renderPanel({ date: THU })
    await screen.findByTestId('terminal-ernr-table')
    expect(symsInTable()).toEqual(['BBB', 'AAA', 'CCC', 'DDD'])
    const bbb = screen.getByTestId('terminal-ernr-row-BBB').textContent
    for (const s of ['1', 'BBB', 'Beta Inc', 'Before the open', '0.40 vs 0.50 expected', '-20.0%', '-12.50%']) expect(bbb).toContain(s)
    const aaa = screen.getByTestId('terminal-ernr-row-AAA').textContent
    for (const s of ['Alpha Corp', '1.25 vs 1.10 expected', '+13.6%', '+8.42%']) expect(aaa).toContain(s)
    const ddd = screen.getByTestId('terminal-ernr-row-DDD').textContent
    for (const s of ['Delta Co', 'After the close', '0.05, no estimate', 'n/a']) expect(ddd).toContain(s)
    expect(screen.queryByTestId('terminal-ernr-row-EEE')).toBeNull()   // scheduled, not reported
    expect(screen.getByTestId('terminal-ernr-tally').textContent).toBe('4 reported. 2 up, 1 down. Median move +1.50%. 1 has no move yet.')
    expect(screen.getByTestId('terminal-ernr-by-size').textContent).toContain('by size')
    expect(screen.getByTestId('terminal-ernr-sort-move').closest('th').getAttribute('aria-sort')).toBe('other')
    fireEvent.click(screen.getByTestId('panel-symbol-AAA'))
    expect(run).toHaveBeenCalledWith('$AAA')
    expect(publishRows).toHaveBeenLastCalledWith(['$BBB', '$AAA', '$CCC', '$DDD'])
    const method = screen.getByTestId('terminal-ernr-method').textContent
    expect(method).toContain('A report after the close is measured from that day\'s close to the next close.')
    expect(method).not.toMatch(/[—–]/)
    // a past day's as-of is the day itself, never the moment it was read
    const report = freshness.mock.calls.map((c) => c[0]).filter(Boolean).pop()
    expect(report.age).toEqual({ asOfDate: THU })
    expect(report.observedAt).toBeUndefined()
  })

  it('sorts by a column, says which way, and offers the way back to biggest move first', async () => {
    serve({ [WEEK_URL]: WEEK, [reactionsUrl(THU)]: MOVES_THU })
    renderPanel({ date: THU })
    await screen.findByTestId('terminal-ernr-table')
    expect(screen.queryByTestId('terminal-ernr-sort-reset')).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-ernr-sort-move'))
    expect(symsInTable()).toEqual(['AAA', 'CCC', 'BBB', 'DDD'])   // gains first; no move still last
    expect(screen.getByTestId('terminal-ernr-sort-move').closest('th').getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(screen.getByTestId('terminal-ernr-sort-move'))
    expect(symsInTable()).toEqual(['BBB', 'CCC', 'AAA', 'DDD'])
    fireEvent.click(screen.getByTestId('terminal-ernr-sort-sym'))
    expect(symsInTable()).toEqual(['AAA', 'BBB', 'CCC', 'DDD'])
    fireEvent.click(screen.getByTestId('terminal-ernr-sort-reset'))
    expect(symsInTable()).toEqual(['BBB', 'AAA', 'CCC', 'DDD'])
  })

  it('the day buttons step one session, read that day, and write it into the command', async () => {
    serve({
      [WEEK_URL]: WEEK, [reactionsUrl(THU)]: MOVES_THU, [reactionsUrl(FRI)]: MOVES_FRI, [reactionsUrl('2026-11-11')]: {},
    })
    const { rerun } = renderPanel({ date: THU }, { code: 'EMOV' })
    await screen.findByTestId('terminal-ernr-row-BBB')
    expect(screen.getByTestId('terminal-ernr-latest')).toBeTruthy()

    fireEvent.click(screen.getByTestId('terminal-ernr-prev'))
    expect(rerun).toHaveBeenLastCalledWith('EMOV 2026-11-11')
    expect(screen.getByTestId('terminal-ernr-date').textContent).toBe('Wed Nov 11, 2026')
    const empty = await screen.findByTestId('terminal-ernr-empty')
    expect(empty.textContent).toContain('None of the 2 companies on the calendar for Wed Nov 11, 2026 has reported yet.')
    expect(jsonFetcher).toHaveBeenCalledWith('/api/calendar/reactions?date=2026-11-11')
    expect(screen.queryByTestId('terminal-ernr-row-BBB')).toBeNull()   // never the last day's rows

    fireEvent.click(screen.getByTestId('terminal-ernr-next'))
    expect(rerun).toHaveBeenLastCalledWith('EMOV 2026-11-12')
    await screen.findByTestId('terminal-ernr-row-BBB')

    fireEvent.click(screen.getByTestId('terminal-ernr-next'))
    expect(rerun).toHaveBeenLastCalledWith('EMOV')   // the latest finished session is the bare code
    await screen.findByTestId('terminal-ernr-row-FFF')
    expect(screen.queryByTestId('terminal-ernr-next')).toBeNull()

    fireEvent.click(screen.getByTestId('terminal-ernr-prev'))
    await screen.findByTestId('terminal-ernr-row-BBB')
    fireEvent.click(screen.getByTestId('terminal-ernr-latest'))
    expect(rerun).toHaveBeenLastCalledWith('EMOV')
    await screen.findByTestId('terminal-ernr-row-FFF')
  })

  it('both reads failing (500) is an error with Retry, never "nobody reported"', async () => {
    serve({})
    renderPanel({ date: THU })
    const err = await screen.findByTestId('terminal-ernr-error')
    expect(err.textContent).toContain('The companies that reported on Thu Nov 12, 2026 could not be read just now.')
    expect(err.textContent).toContain('That is not the same as nobody reporting.')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(screen.queryByTestId('terminal-ernr-empty')).toBeNull()
    serve({ [WEEK_URL]: WEEK, [reactionsUrl(THU)]: MOVES_THU })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-ernr-table')).toBeTruthy()
  })

  it('a week the server could not build, with no moves, is an error too', async () => {
    serve({ [WEEK_URL]: { week_start: '2026-11-09', week_end: '2026-11-13', days: {}, source: 'error' }, [reactionsUrl(THU)]: {} })
    renderPanel({ date: THU })
    expect((await screen.findByTestId('terminal-ernr-error')).getAttribute('data-kind')).toBe('error')
    expect(screen.queryByTestId('terminal-ernr-empty')).toBeNull()
  })

  it('the calendar read failing keeps the moves: rows by symbol, and a note for what is missing', async () => {
    serve({ [WEEK_URL]: httpError(500), [reactionsUrl(THU)]: MOVES_THU })
    renderPanel({ date: THU })
    await screen.findByTestId('terminal-ernr-table')
    expect(symsInTable()).toEqual(['BBB', 'AAA', 'CCC'])
    expect(screen.getByTestId('terminal-ernr-calendar-note').textContent).toContain('could not be read just now. The moves are still shown.')
    expect(screen.getByTestId('terminal-ernr-row-BBB').textContent).toContain('-12.50%')
    expect(screen.queryByTestId('terminal-ernr-error')).toBeNull()
  })

  it('the moves read failing keeps the reporters: moves read n/a, a note says so, and it can be retried', async () => {
    serve({ [WEEK_URL]: WEEK, [reactionsUrl(THU)]: httpError(500) })
    renderPanel({ date: THU })
    await screen.findByTestId('terminal-ernr-table')
    expect(symsInTable()).toEqual(['AAA', 'BBB', 'CCC', 'DDD'])
    const note = screen.getByTestId('terminal-ernr-moves-note').textContent
    expect(note).toContain('The move for each stock could not be read just now.')
    expect(note).toContain('That is not the same as no move.')
    expect(screen.getByTestId('terminal-ernr-tally').textContent).toBe('4 reported. No moves yet.')
    serve({ [WEEK_URL]: WEEK, [reactionsUrl(THU)]: MOVES_THU })
    fireEvent.click(screen.getByRole('button', { name: 'Retry the moves' }))
    await waitFor(() => expect(screen.getByTestId('terminal-ernr-tally').textContent).toContain('Median move'))
    expect(screen.getByTestId('terminal-ernr-row-BBB').textContent).toContain('-12.50%')
    expect(screen.queryByTestId('terminal-ernr-moves-note')).toBeNull()
  })

  it('reporters with an empty moves answer: the moves are missing, not zero', async () => {
    serve({ [WEEK_URL]: WEEK, [reactionsUrl(THU)]: {} })
    renderPanel({ date: THU })
    await screen.findByTestId('terminal-ernr-table')
    expect(symsInTable()).toEqual(['AAA', 'BBB', 'CCC', 'DDD'])
    expect(screen.getByTestId('terminal-ernr-moves-note').textContent).toContain('No move has come back for this day yet.')
    expect(screen.getByTestId('terminal-ernr-tally').textContent).toBe('4 reported. No moves yet.')
    expect(screen.queryByTestId('terminal-ernr-empty')).toBeNull()
  })

  it('a 402 says paid plan and a 404 says not switched on: both locked, neither offers Retry', async () => {
    serve({ [WEEK_URL]: httpError(402), [reactionsUrl(THU)]: httpError(402) })
    renderPanel({ date: THU })
    const paid = await screen.findByTestId('terminal-ernr-error')
    expect(paid.textContent).toContain('Earnings reactions needs a paid plan.')
    expect(paid.getAttribute('data-kind')).toBe('locked')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    cleanup()
    serve({ [WEEK_URL]: httpError(404), [reactionsUrl(THU)]: httpError(404) })
    renderPanel({ date: THU })
    const off = await screen.findByTestId('terminal-ernr-error')
    expect(off.textContent).toContain('Earnings reactions is not switched on for this server yet.')
    expect(off.getAttribute('data-kind')).toBe('locked')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.getByTestId('terminal-ernr-prev')).toBeTruthy()   // the day buttons stay
  })

  it('empty days say why: nobody on the calendar, a closed market, or a day too far back', async () => {
    serve({ [WEEK_URL]: WEEK, [reactionsUrl('2026-11-10')]: {} })
    renderPanel({ date: '2026-11-10' })
    expect((await screen.findByTestId('terminal-ernr-empty')).textContent).toContain('No company was on the earnings calendar for Tue Nov 10, 2026.')
    cleanup()

    serve({ '/api/calendar?week=2026-11-02': { ...WEEK, days: {} }, [reactionsUrl('2026-11-08')]: {} })
    renderPanel({ date: '2026-11-08' })
    const closed = await screen.findByTestId('terminal-ernr-closed')
    expect(closed.textContent).toContain('The market was closed on Sun Nov 8, 2026.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    cleanup()

    serve({ '/api/calendar?week=2024-01-01': { week_start: '2024-01-01', week_end: '2024-01-05', days: {}, source: 'out_of_range' }, [reactionsUrl('2024-01-03')]: {} })
    renderPanel({ date: '2024-01-03' })
    expect((await screen.findByTestId('terminal-ernr-out-of-range')).textContent)
      .toContain('Wed Jan 3, 2024 is outside the year of history the earnings calendar keeps.')
  })

  it('a day that is not real, or still ahead, opens the latest finished session instead', async () => {
    serve({ [WEEK_URL]: WEEK, [reactionsUrl(FRI)]: MOVES_FRI })
    renderPanel({ date: '2026-12-01' })
    await screen.findByTestId('terminal-ernr-table')
    expect(screen.getByTestId('terminal-ernr').getAttribute('data-date')).toBe(FRI)
  })
})
