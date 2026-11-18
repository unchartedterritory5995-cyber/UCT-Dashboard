// EXMV: the move options price for the next earnings report, against the stock's past reports.
// Rails:
//   * needs a ticker; the move read WAITS for the report date and is asked with it (asked
//     without one the route prices the nearest expiry);
//   * loading, a failed move read (error with Retry), a paywall and a switched-off route (no
//     Retry), signed out;
//   * the two reads fail apart: a failed earnings read is said as one, never as "no past moves";
//   * no priced move says why in the server's own words, and is never a small or zero move;
//   * report by report: priced before, the actual move, and a comparison only where both exist;
//   * a fund, a stock with nothing on hand, a report too recent to measure, and a straddle that
//     expires on the report day are each said.
// The fixtures are the routes' real shapes (api/routers/expected_move.py, implied_store
// get_implied_history, earnings_reaction.reaction_for), with a made-up ticker.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
vi.mock('../../calendar/earningsModalRow', async (orig) => ({ ...(await orig()), todayIso: () => '2026-11-17' }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import ExpectedMovePanel, {
  EXPECTED_MOVE_CODE, earningsIntelUrl, expectedMoveUrl, outcomeSentence, pairedSentence, recordSentence,
} from './ExpectedMovePanel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const SOURCE = 'UCT option chain read (at-the-money straddle) and UCT daily bars'
const E_URL = earningsIntelUrl('AAA')
const M_URL = expectedMoveUrl('AAA', '2026-11-19')
const M_NODATE = expectedMoveUrl('AAA')
const EARN = {
  ticker: 'AAA',
  quarters: [{ label: 'Q2 FY26', report_date: '2026-08-20', reported: true }],
  summary: { next_report_date: '2026-11-19' },
  next_report_date: '2026-11-19',
  reaction: {
    events: [
      { quarter: 'Q3 FY25', report_date: '2025-11-20', reaction_pct: -3.2, eps_actual: 1.0, eps_estimate: 0.9 },
      { quarter: 'Q4 FY25', report_date: '2026-02-19', reaction_pct: 8.5, eps_actual: 1.1, eps_estimate: 1.0 },
      { quarter: 'Q1 FY26', report_date: '2026-05-21', reaction_pct: -11.0, eps_actual: 0.8, eps_estimate: 1.0 },
      { quarter: 'Q2 FY26', report_date: '2026-08-20', reaction_pct: 4.2, eps_actual: 1.2, eps_estimate: 1.1 },
    ],
    avg_abs_move_pct: 6.73,
    n_quarters: 4,
  },
}
const LIVE = { pct: 7.1, dollar: 12.4, strike: 175, spot: 174.6, call_mid: 6.3, put_mid: 6.1, iv_atm: 0.62, expiry: '2026-11-20', horizon: 'through 2026-11-20', asof: '2026-11-17T15:02:11+00:00', source: 'massive-chain' }
const MOVE = {
  live: LIVE,
  live_outcome: { kind: 'ok', reason: null },
  history: [
    { sym: 'AAA', report_date: '2026-11-19', captured_at: '2026-11-13T21:35:04+00:00', pct: 6.8, dollar: 11.9, expiry: '2026-11-20', fiscal_year: 2026, fiscal_quarter: 3 },
    { sym: 'AAA', report_date: '2026-08-20', captured_at: '2026-08-19T20:35:00+00:00', pct: 6.0, dollar: 9.1, expiry: '2026-08-21', fiscal_year: 2026, fiscal_quarter: 2 },
    { sym: 'AAA', report_date: '2026-05-20', captured_at: '2026-05-19T20:35:00+00:00', pct: 7.4, dollar: 10.0, expiry: '2026-05-22', fiscal_year: 2026, fiscal_quarter: 1 },
  ],
  history_since: '2026-05-20',
  grade: null,
}
const NO_LIVE = { ...MOVE, live: null, live_outcome: { kind: 'refused', reason: 'no_atm_strike' } }

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

function renderPanel(props = { sym: 'aaa' }, { run = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const body = <ExpectedMovePanel {...props} />
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run, rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { run, setFreshness }
}
const rowsOf = () => within(screen.getByTestId('terminal-exmv-table')).getAllByRole('row').slice(1)
const HERE = path.dirname(fileURLToPath(import.meta.url))

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('EXMV reads', () => {
  it('needs a ticker, and asks for nothing without one', () => {
    serve({})
    renderPanel({ sym: '  ' }, { code: 'EXMX' })
    expect(EXPECTED_MOVE_CODE).toBe('EXMV')
    expect(screen.getByText('EXMX needs a ticker.')).toBeTruthy()
    expect(document.body.textContent).toContain('NVDA EXMX')
    expect(asked()).toEqual([])
  })

  it('reads the report date first: the option chain is not asked while the date is unknown', () => {
    serve({ [E_URL]: PENDING, [M_URL]: MOVE, [M_NODATE]: MOVE })
    renderPanel()
    expect(screen.getByTestId('terminal-exmv-loading')).toBeTruthy()
    expect(asked()).toEqual([E_URL])
  })

  it('then asks for the move WITH the report date, never for the nearest expiry', async () => {
    serve({ [E_URL]: EARN, [M_URL]: MOVE, [M_NODATE]: MOVE })
    renderPanel()
    await screen.findByTestId('terminal-exmv-table')
    expect(M_URL).toBe('/api/research/expected-move/AAA?grade=0&report_date=2026-11-19')
    expect(asked()).toContain(M_URL)
    expect(asked()).not.toContain(M_NODATE)
  })

  it('a failed move read (500) is an error with Retry, never "no expected move"', async () => {
    serve({ [E_URL]: EARN })
    renderPanel({ sym: 'AAA' }, { code: 'EXMX' })
    const err = await screen.findByTestId('terminal-exmv-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The expected move could not be read just now.')
    expect(err.textContent).toContain('That is not the same as having none. Retry, or run AAA EXMX again.')
    expect(screen.queryByTestId('terminal-exmv-empty')).toBeNull()
    serve({ [E_URL]: EARN, [M_URL]: MOVE })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-exmv-table')).toBeTruthy()
  })

  it('signed out (401) and locked (402, 404) each say so, and only an error can be retried', async () => {
    for (const [status, kind, words] of [
      [401, 'error', 'You are signed out, so the expected move cannot be read. Sign in again.'],
      [402, 'locked', 'The expected move needs a paid plan.'],
      [404, 'locked', 'The expected move is not switched on for this server yet.'],
    ]) {
      cleanup()
      serve({ [E_URL]: EARN, [M_URL]: fail(status) })
      renderPanel()
      const state = await screen.findByTestId('terminal-exmv-error')
      expect(state.getAttribute('data-kind'), String(status)).toBe(kind)
      expect(state.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), String(status)).toBe(kind === 'error')
      // a member with no paid plan is shown none of the past moves either
      expect(screen.queryByTestId('terminal-exmv-table')).toBeNull()
    }
  })

  it('an answer that is not the route\'s shape is an error', async () => {
    serve({ [E_URL]: EARN, [M_URL]: { detail: 'something else' } })
    renderPanel()
    const err = await screen.findByTestId('terminal-exmv-error')
    expect(err.textContent).toContain('The expected move for AAA could not be read just now.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

describe('EXMV populated', () => {
  it('says what is priced, through which expiry and for which report, with the break-even prices', async () => {
    serve({ [E_URL]: EARN, [M_URL]: MOVE })
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-exmv-table')
    expect(screen.getByTestId('terminal-exmv-headline').textContent)
      .toBe('Options price a ±7.1% move for AAA (about $12.40 a share either way) through 2026-11-20. The next report is 2026-11-19; 2026-11-20 is the first option expiry on or after it.')
    expect(screen.getByTestId('terminal-exmv-record').textContent)
      .toBe('On its last 4 measured reports AAA moved ±6.7% on average, and more than the ±7.1% priced now on 2 of them. The biggest was -11.0%.')
    const fields = screen.getByTestId('terminal-exmv-fields').textContent
    expect(fields).toContain('Break-even prices$162.20 to $187.00, around the $174.60 price when the options were read')
    expect(fields).toContain('The $175 call ($6.30) and put ($6.10) expiring 2026-11-20, each at the middle of its bid and ask')
    expect(fields).toContain('Next report2026-11-19')
    // a percent the server sends as 7.1 is 7.1%, never 710%
    expect(document.body.textContent).not.toContain('710')
    expect(screen.queryByTestId('terminal-exmv-same-day')).toBeNull()
    expect(screen.queryByTestId('terminal-exmv-no-live')).toBeNull()
    // the header: the source and the instant the options were read
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith(expect.objectContaining({ source: SOURCE, observedAt: '2026-11-17T15:02:11.000Z' })))
    const method = screen.getByTestId('terminal-exmv-method').textContent
    expect(method).toContain('It covers every day up to the expiry, not only the report.')
    expect(method).toContain('this is not a forecast or a recommendation.')
    expect(method).toMatch(/Options read at \d{1,2}:\d{2} [AP]M ET; the server keeps a read for 15 minutes\./)
    expect(document.body.textContent).not.toMatch(/[—–]/)
  })

  it('lists each report: what was priced before it, what the stock did, and a comparison only where both exist', async () => {
    serve({ [E_URL]: EARN, [M_URL]: MOVE })
    renderPanel()
    await screen.findByTestId('terminal-exmv-table')
    const rows = rowsOf()
    expect(rows.map((r) => [r.getAttribute('data-state'), r.getAttribute('data-verdict')])).toEqual([
      ['upcoming', null], ['measured', 'within'], ['measured', 'beyond'], ['measured', null], ['measured', null],
    ])
    const cells = rows.map((r) => r.textContent)
    // dates are written with hyphens that never break a line (U+2011)
    for (const s of ['2026‑11‑19', 'Q3 2026', '±6.8%', '($11.90)', 'recorded 2026‑11‑13', 'Not reported yet', 'Not compared']) expect(cells[0]).toContain(s)
    for (const s of ['2026‑08‑20', 'Q2 FY26', '±6.0%', '($9.10)', '+4.2%', 'Stayed within the priced move']) expect(cells[1]).toContain(s)
    // priced for the 20th, measured on the 21st: one report
    for (const s of ['2026‑05‑21', 'Q1 FY26', '±7.4%', '-11.0%', 'Moved more than priced']) expect(cells[2]).toContain(s)
    for (const s of ['2026‑02‑19', 'Q4 FY25', 'Not recorded', '+8.5%', 'Not compared']) expect(cells[3]).toContain(s)
    for (const s of ['2025‑11‑20', 'Not recorded', '-3.2%', 'Not compared']) expect(cells[4]).toContain(s)
    expect(screen.getByTestId('terminal-exmv-paired').textContent)
      .toBe('Before 2 past reports the priced move is on record: the stock moved more than was priced on 1 and stayed within it on 1 (priced ±6.7% on average, moved ±7.6%).')
    expect(screen.getByRole('table', { name: 'AAA earnings reports, newest first: the move options priced before each and the move the stock made' })).toBeTruthy()
  })

  it('with no next report date it asks for the nearest expiry and says that is what it is', async () => {
    serve({ [E_URL]: { ...EARN, next_report_date: null, summary: {} }, [M_NODATE]: MOVE })
    renderPanel()
    await screen.findByTestId('terminal-exmv-table')
    expect(asked()).toEqual(expect.arrayContaining([E_URL, M_NODATE]))
    expect(asked()).not.toContain(M_URL)
    expect(screen.getByTestId('terminal-exmv-headline').textContent)
      .toContain('No next report date is on file, so this is the nearest option expiry. It only reflects earnings if the report comes on or before 2026-11-20.')
    expect(screen.getByTestId('terminal-exmv-fields').textContent).toContain('Next reportNo date on file')
    cleanup()
    // a "next report" that has already passed is not next
    serve({ [E_URL]: { ...EARN, next_report_date: '2026-11-10', summary: {} }, [M_NODATE]: MOVE })
    renderPanel()
    await screen.findByTestId('terminal-exmv-table')
    expect(screen.getByTestId('terminal-exmv-headline').textContent).toContain('No next report date is on file')
  })

  it('warns when the straddle expires on the report day itself', async () => {
    const url = expectedMoveUrl('AAA', '2026-11-20')
    serve({ [E_URL]: { ...EARN, next_report_date: '2026-11-20', summary: {} }, [url]: MOVE })
    renderPanel()
    const warn = await screen.findByTestId('terminal-exmv-same-day')
    expect(warn.textContent).toContain('That expiry is the report day itself. If AAA reports after the close, those options stop trading before the news')
  })

  it('no priced move says why in words, is never a small move, and the past reports still show', async () => {
    serve({ [E_URL]: EARN, [M_URL]: NO_LIVE })
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-exmv-table')
    const note = screen.getByTestId('terminal-exmv-no-live')
    expect(note.textContent).toContain('The option chain for AAA was read, but it gave no number that can be trusted (no atm strike).')
    expect(note.textContent).toContain('That is not the same as a small expected move. The next report is 2026-11-19.')
    expect(document.body.textContent).not.toContain('no_atm_strike')
    expect(screen.queryByTestId('terminal-exmv-headline')).toBeNull()
    expect(screen.queryByTestId('terminal-exmv-fields')).toBeNull()
    expect(document.body.textContent).not.toContain('±0.0%')
    // with nothing priced now, the past reports are described on their own
    expect(screen.getByTestId('terminal-exmv-record').textContent)
      .toBe('On its last 4 measured reports AAA moved ±6.7% on average. The biggest was -11.0%.')
    expect(rowsOf()).toHaveLength(5)
    // no options instant to report: the source alone
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith({ source: SOURCE }))
    cleanup()
    serve({ [E_URL]: EARN, [M_URL]: { ...NO_LIVE, live_outcome: { kind: 'unavailable', reason: 'chain_timeout' } } })
    renderPanel()
    await screen.findByTestId('terminal-exmv-table')
    expect(screen.getByTestId('terminal-exmv-no-live').textContent).toContain('The option chain for AAA could not be read just now (chain timeout).')
    serve({ [E_URL]: EARN, [M_URL]: MOVE })
    fireEvent.click(screen.getByRole('button', { name: 'Read the options again' }))
    expect(await screen.findByTestId('terminal-exmv-headline')).toBeTruthy()
  })
})

describe('EXMV the earnings read fails apart', () => {
  it('a failed earnings read is said as one: the priced move still shows, as the nearest expiry', async () => {
    serve({ [M_NODATE]: MOVE })
    renderPanel()
    await screen.findByTestId('terminal-exmv-table')
    const note = screen.getByTestId('terminal-exmv-earn-error')
    expect(note.textContent).toContain('The earnings history could not be read just now. So the next report date and the past moves are missing, which is not the same as having none.')
    expect(screen.getByTestId('terminal-exmv-headline').textContent).toContain('The next report date could not be read, so this is the nearest option expiry.')
    // the priced moves on record are listed; with no earnings read none has an actual move
    expect(rowsOf().map((r) => r.getAttribute('data-state'))).toEqual(['upcoming', 'no-actual', 'no-actual'])
    expect(rowsOf()[1].textContent).toContain('Not on file')
    expect(screen.queryByTestId('terminal-exmv-record')).toBeNull()
    expect(screen.getByTestId('terminal-exmv-paired').textContent)
      .toBe('No past report of AAA has both a recorded priced move and a measured move yet. The record of priced moves for AAA starts with its 2026-05-20 report.')
    // retrying the earnings read brings the date, and the move is asked again with it
    serve({ [E_URL]: EARN, [M_URL]: MOVE, [M_NODATE]: MOVE })
    fireEvent.click(screen.getByRole('button', { name: 'Retry the earnings history' }))
    await waitFor(() => expect(screen.getByTestId('terminal-exmv-headline').textContent).toContain('The next report is 2026-11-19'))
    expect(asked()).toContain(M_URL)
    expect(screen.queryByTestId('terminal-exmv-earn-error')).toBeNull()
  })

  it('too few measured reports says so; a report too recent to measure is held back', async () => {
    serve({ [E_URL]: { ...EARN, reaction: null }, [M_URL]: MOVE })
    renderPanel()
    await screen.findByTestId('terminal-exmv-table')
    expect(screen.getByTestId('terminal-exmv-earn-none').textContent)
      .toBe('Past earnings moves for AAA are not on file: fewer than four of its recent reports could be measured.')
    cleanup()
    const recent = { ...EARN, next_report_date: null, summary: {}, reaction: { events: [...EARN.reaction.events, { quarter: 'Q3 FY26', report_date: '2026-11-16', reaction_pct: 0.4 }] } }
    serve({ [E_URL]: recent, [M_NODATE]: { ...MOVE, history: [{ ...MOVE.history[0], report_date: '2026-11-16' }] } })
    renderPanel()
    await screen.findByTestId('terminal-exmv-table')
    const first = rowsOf()[0]
    expect(first.getAttribute('data-state')).toBe('too-recent')
    expect(first.textContent).toContain('Too recent to measure')
    expect(first.textContent).not.toContain('0.4%')
    expect(first.getAttribute('data-verdict')).toBeNull()
  })

  it('a fund says funds do not report earnings, and the option chain is never asked', async () => {
    serve({ [E_URL]: { ticker: 'AAA', not_applicable: 'fund', reason: 'AAA is a fund; funds do not report earnings', quarters: [], estimates: [] }, [M_NODATE]: MOVE })
    renderPanel()
    const fund = await screen.findByTestId('terminal-exmv-fund')
    expect(fund.textContent).toContain('AAA is a fund, and funds do not report earnings.')
    expect(asked()).toEqual([E_URL])
  })

  it('nothing priced and nothing measured is an empty state that says why', async () => {
    serve({ [E_URL]: { ...EARN, next_report_date: null, summary: {}, reaction: null }, [M_NODATE]: { ...NO_LIVE, history: [], history_since: null } })
    const { setFreshness } = renderPanel()
    const empty = await screen.findByTestId('terminal-exmv-empty')
    expect(empty.getAttribute('data-kind')).toBe('empty')
    expect(empty.textContent).toContain('No expected move and no past earnings moves are on hand for AAA.')
    expect(empty.textContent).toContain('it gave no number that can be trusted (no atm strike). No next report date is on file.')
    expect(setFreshness.mock.calls.every(([report]) => report == null)).toBe(true)
  })
})

describe('EXMV sentences', () => {
  it('one report, no live number, and no record each read as plain sentences', () => {
    expect(recordSentence('AAA', { n: 1, avgAbs: 5.4, beyond: 0, biggest: 5.4 }, 7.1)).toBe('On its last measured report AAA moved ±5.4%, no more than the ±7.1% priced now.')
    expect(recordSentence('AAA', { n: 1, avgAbs: 9, beyond: 1, biggest: -9 }, 7.1)).toBe('On its last measured report AAA moved ±9.0%, more than the ±7.1% priced now.')
    expect(recordSentence('AAA', { n: 0, avgAbs: null, beyond: null, biggest: null }, 7.1)).toBe('')
    expect(outcomeSentence('AAA', null)).toBe('No options read came back for AAA.')
    expect(pairedSentence('AAA', { n: 0 }, null)).toBe('No priced move is on record from before any past report of AAA, so past reports cannot be set against what was priced then.')
    expect(pairedSentence('AAA', { n: 1, beyond: 0, avgImplied: 6, avgAbs: 4.2 }, '2026-05-20'))
      .toBe('Before 1 past report the priced move is on record: the stock moved more than was priced on 0 and stayed within it on 1 (priced ±6.0% on average, moved ±4.2%).')
  })
})

describe('EXMV follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['ExpectedMovePanel.jsx', 'expectedMoveModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('EXMV accessibility', () => {
  it('the full panel passes axe (WCAG A and AA)', async () => {
    serve({ [E_URL]: EARN, [M_URL]: MOVE })
    renderPanel()
    await screen.findByTestId('terminal-exmv-table')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)

  it('the panel with no priced move and a failed earnings read passes axe', async () => {
    serve({ [M_NODATE]: NO_LIVE })
    renderPanel()
    await screen.findByTestId('terminal-exmv-table')
    expect(screen.getByTestId('terminal-exmv-earn-error')).toBeTruthy()
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)
})
