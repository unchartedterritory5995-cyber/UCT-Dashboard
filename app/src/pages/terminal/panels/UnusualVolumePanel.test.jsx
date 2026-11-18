// UNVOL: stocks far above their usual volume for the time of day. Rails:
//   * loading; a failed read (500) is an error with Retry; 402 and 404 are locked with none; a 400
//     says the scan cannot run; an answer that is not a scan answer is a failed read. None of them
//     is an empty list;
//   * the by-now list: one scan with the pinned body, rows in the server's order, the multiple,
//     the day change with its sign, the count and the time the reading was worked out, the header's
//     as-of, the symbols published to the shell, the cut said when more matched than are shown;
//   * a reading that has stopped moving (after the close) is not badged "By now";
//   * no by-now reading: the panel says so and shows the last full session with its date, and says
//     when prices are today's while volumes are not. Never an empty table under a "now";
//   * "nothing matches" against "no reading": a filtered pick that comes back empty asks ONE more
//     one-row question, then says which it is;
//   * the chips re-ask the server and write themselves into the command; typed words seed them;
//   * the definition of the number is in the method text for each reading; no hard-coded color; axe.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const wire = vi.hoisted(() => ({ writeBack: null }))
vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
// The registry half of the write-back has its own test (commandWriteBack.test.jsx); here the panel's
// half is pinned: which words it hands over, and when.
vi.mock('./commandWriteBack', () => ({ usePanelWriteBack: () => wire.writeBack }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import UnusualVolumePanel, {
  IDLE_POLL_MS, LIVE_POLL_MS, UNUSUAL_VOLUME_CODE, UNVOL_SCAN_URL, picksWords, readingStamp, unvolScanBody, unvolView,
} from './UnusualVolumePanel'
import * as model from './unusualVolumeModel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = 'UCT screener (live volume reading, Massive prices)'
// The panel reads the wall clock to say whether a reading is still moving, so the stamps here are
// set against the real clock: 30 seconds old is moving, three hours old is not.
const secondsAgo = (s) => Math.floor(Date.now() / 1000) - s
const row = (over = {}) => ({
  ticker: 'ZZA', company: 'Zeta Alpha Corp', price: 41.2, chg_pct_1d: 6.4, rvol_live: 4.23, vol_ratio: 1.1,
  avg_volume_30d: 2_400_000, industry: 'Semiconductors', bars_asof: 20261117, live_row: 1, live_asof: secondsAgo(30), ...over,
})
const NOW_ROWS = () => [
  row(),
  row({ ticker: 'ZZB', company: 'Zeta Beta Inc', price: 12.5, chg_pct_1d: -2.25, rvol_live: 3.1, avg_volume_30d: 850_000, industry: 'Regional Banks' }),
  row({ ticker: 'ZZC', company: 'Zeta Gamma', price: 230.75, chg_pct_1d: 0, rvol_live: 12.4, avg_volume_30d: 15_500_000, industry: null }),
]
const LAST_ROWS = (over = {}) => [
  row({ ticker: 'ZZD', rvol_live: null, vol_ratio: 6.2, chg_pct_1d: 9.1, price: 18.4, live_row: 0, live_asof: null, ...over }),
  row({ ticker: 'ZZE', rvol_live: null, vol_ratio: 3.4, chg_pct_1d: -4.4, price: 77, live_row: 0, live_asof: null, ...over }),
]
const answer = (rows, over = {}) => ({
  total: rows.length, rows, view: 'technical', view_columns: [], snapshot_date: '20261118', snapshot: { snapshot_date: '20261118' }, ...over,
})
const EMPTY = answer([])
const fail = (status) => Object.assign(new Error(`http ${status}`), { status })
const PENDING = Symbol('pending')
const COVERAGE = { evaluated: 4200, answered: 4100, dropped: 0, not_computable: 100, dropped_symbols: [] }

/** Which read a POSTed body is: the by-now list, the one-row probe, or the last session. */
const kindOf = (body) => (body.filters[0].key === 'vol_ratio' ? 'last' : body.page_size === 1 ? 'probe' : 'now')
/** Serves one answer per kind. An Error is thrown, PENDING never answers, a function is called with
 *  the body; a kind with no entry is a 500. */
function serve(by = {}) {
  jsonFetcher.mockImplementation((url, init) => {
    if (url !== UNVOL_SCAN_URL || init?.method !== 'POST') return Promise.reject(fail(500))
    const body = JSON.parse(init.body)
    const kind = kindOf(body)
    if (!(kind in by)) return Promise.reject(fail(500))
    const hit = typeof by[kind] === 'function' ? by[kind](body) : by[kind]
    return hit === PENDING ? new Promise(() => {}) : hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
const calls = () => jsonFetcher.mock.calls.map(([, init]) => JSON.parse(init.body))
const callsOf = (kind) => calls().filter((b) => kindOf(b) === kind)

function renderPanel(props = {}, { run = vi.fn(), open = vi.fn(), publishRows = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const tree = (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run, rerun: vi.fn(), publish: vi.fn(), publishRows }}>
          <UnusualVolumePanel {...props} />
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>
  )
  render(code ? <TerminalPanelContext.Provider value={{ code, density: 'compact', inset: true }}>{tree}</TerminalPanelContext.Provider> : tree)
  return { run, open, publishRows, setFreshness }
}
const panel = () => screen.getByTestId('terminal-unvol')
const table = () => screen.getByTestId('terminal-unvol-table')
const symsInTable = () => within(table()).getAllByRole('row').slice(1).map((r) => r.getAttribute('data-testid').replace('terminal-unvol-row-', ''))
const headers = () => within(table()).getAllByRole('columnheader').map((h) => h.textContent.trim())

beforeEach(() => { jsonFetcher.mockReset(); wire.writeBack = vi.fn(() => false) })
afterEach(cleanup)

describe('UNVOL pure helpers of the panel', () => {
  it('re-exports the model, and names the one door itself', () => {
    expect(unvolView).toBe(model.unvolView)
    expect(unvolScanBody).toBe(model.unvolScanBody)
    expect(UNUSUAL_VOLUME_CODE).toBe('UNVOL')
    expect(UNVOL_SCAN_URL).toBe('/api/screener/scan')
    expect([LIVE_POLL_MS, IDLE_POLL_MS]).toEqual([60_000, 300_000])
  })

  it('readingStamp: the time alone for today\'s reading (ET), the date and the time for an earlier day\'s', () => {
    const now = Date.parse('2026-11-18T20:00:00Z')            // 3:00 PM ET
    expect(readingStamp('2026-11-18T15:42:00.000Z', now)).toBe('10:42 AM ET')
    expect(readingStamp('2026-11-17T21:28:05.000Z', now)).toBe('11/17/2026, 4:28:05 PM ET')
    // 9:30 PM ET on the 17th is the 18th in UTC: still read as the ET day it belongs to
    expect(readingStamp('2026-11-18T02:30:00.000Z', now)).toBe('11/17/2026, 9:30:00 PM ET')
    for (const bad of [null, '', 'x']) expect(readingStamp(bad, now)).toBeNull()
  })

  it('picksWords says the picks as a trader would', () => {
    expect(picksWords('all', 2)).toBe('2× its usual volume or more, up or down on the day')
    expect(picksWords('down', 5)).toBe('5× its usual volume or more, down on the day')
  })
})

describe('UNVOL states', () => {
  it('shows a skeleton while the list is read, with the chips already there', () => {
    serve({ now: PENDING })
    renderPanel()
    expect(screen.getByTestId('terminal-unvol-loading').textContent).toContain('Loading the unusual volume list')
    expect(screen.getByTestId('terminal-unvol-side-up')).toBeTruthy()
    expect(callsOf('now')).toHaveLength(1)
    expect(callsOf('last')).toEqual([])
  })

  it('a failed read (500) is an error with Retry; 402 and 404 are locked with none; never an empty list', async () => {
    serve({ now: fail(500) })
    renderPanel({}, { code: 'UVX' })
    const err = await screen.findByTestId('terminal-unvol-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The unusual volume list could not be read just now.')
    expect(err.textContent).toContain('That is not the same as a quiet market. Retry, or run UVX again.')
    expect(screen.queryByTestId('terminal-unvol-empty')).toBeNull()
    expect(panel().getAttribute('data-stage')).toBe('error')
    expect(callsOf('last')).toEqual([])                      // a failure is not "no reading"
    serve({ now: answer(NOW_ROWS()) })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-unvol-table')).toBeTruthy()
    cleanup()
    jsonFetcher.mockReset()
    serve({ now: fail(402) })
    renderPanel()
    const paid = await screen.findByTestId('terminal-unvol-error')
    expect(paid.getAttribute('data-kind')).toBe('locked')
    expect(paid.textContent).toContain('The unusual volume list needs a paid plan.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    cleanup()
    jsonFetcher.mockReset()
    serve({ now: fail(404) })
    renderPanel()
    const dark = await screen.findByTestId('terminal-unvol-error')
    expect(dark.getAttribute('data-kind')).toBe('locked')
    expect(dark.textContent).toContain('The unusual volume list is not switched on for this server yet.')
  })

  it('a scan the server refuses (400) says it cannot run; an answer that is not one is a failed read', async () => {
    serve({ now: fail(400) })
    renderPanel()
    expect((await screen.findByTestId('terminal-unvol-error')).textContent)
      .toContain('The unusual volume list cannot run on this server yet. The screener snapshot is missing a column it needs.')
    cleanup()
    jsonFetcher.mockReset()
    serve({ now: { detail: 'unexpected' } })
    renderPanel()
    const err = await screen.findByTestId('terminal-unvol-error')
    expect(err.textContent).toContain('The unusual volume list came back in a form this panel cannot read.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.queryByTestId('terminal-unvol-empty')).toBeNull()
    expect(callsOf('last')).toEqual([])
  })

  it('the fallback reads fail loudly too: a failed probe or a failed last-session read is an error, never a list', async () => {
    serve({ now: EMPTY, probe: fail(500) })
    renderPanel({ side: 'down' })
    expect((await screen.findByTestId('terminal-unvol-error')).textContent).toContain('could not be read just now')
    expect(callsOf('last')).toEqual([])
    cleanup()
    jsonFetcher.mockReset()
    serve({ now: EMPTY, last: fail(500) })
    renderPanel()
    const err = await screen.findByTestId('terminal-unvol-error')
    expect(err.textContent).toContain('could not be read just now')
    expect(screen.queryByTestId('terminal-unvol-table')).toBeNull()
    serve({ now: EMPTY, last: answer(LAST_ROWS()) })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-unvol-table')).toBeTruthy()
  })
})

describe('UNVOL, the by-now reading', () => {
  it('one scan with the pinned body; rows in the server\'s order with the multiple and the signed change', async () => {
    const rows = NOW_ROWS()
    serve({ now: answer(rows, { total: 3 }) })
    const { run, open, publishRows, setFreshness } = renderPanel()
    await screen.findByTestId('terminal-unvol-table')
    expect(calls()).toEqual([unvolScanBody('now')])          // no probe, no last-session read
    expect(panel().getAttribute('data-stage')).toBe('now')
    expect(headers()).toEqual(['Symbol', 'Vol vs usual', 'Day change', 'Avg volume', 'Industry', 'Why'])
    expect(symsInTable()).toEqual(['ZZA', 'ZZB', 'ZZC'])
    const a = screen.getByTestId('terminal-unvol-row-ZZA').textContent
    for (const s of ['1', 'ZZA', '4.2×', '+6.40%', '$41.20', '2.4M', 'Semiconductors']) expect(a).toContain(s)
    const b = screen.getByTestId('terminal-unvol-row-ZZB').textContent
    for (const s of ['3.1×', '-2.25%', '$12.50', '850K', 'Regional Banks']) expect(b).toContain(s)
    const c = screen.getByTestId('terminal-unvol-row-ZZC').textContent
    for (const s of ['12×', '0.00%', '$230.75', 'n/a']) expect(c).toContain(s)   // no industry on file reads n/a
    expect(screen.getByTestId('terminal-unvol-badge').textContent).toBe('By now')
    const stamp = readingStamp(new Date(rows[0].live_asof * 1000).toISOString())
    expect(screen.getByTestId('terminal-unvol-lede').textContent)
      .toBe(`3 stocks at 2× its usual volume or more, up or down on the day, as of ${stamp}.`)
    expect(screen.queryByTestId('terminal-unvol-last-note')).toBeNull()
    expect(screen.queryByTestId('terminal-unvol-capped')).toBeNull()
    // the header's as-of is the instant the reading was worked out, not when the panel read it
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith(expect.objectContaining({
      source: SOURCE, observedAt: new Date(rows[0].live_asof * 1000).toISOString(),
    })))
    expect(publishRows.mock.calls.at(-1)[0]).toEqual(['$ZZA', '$ZZB', '$ZZC'])
    fireEvent.click(screen.getByTestId('panel-symbol-ZZB'))
    expect(run).toHaveBeenCalledWith('$ZZB')
    fireEvent.click(screen.getByTestId('panel-command-ZZA-MOVE'))
    expect(open).toHaveBeenCalledWith('ZZA MOVE')
    expect(screen.getByRole('table', { name: 'Unusual volume, by now, 3 stocks, highest first' })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/[—–]/)
  })

  it('the method text defines the number, the floors and the neighbours', async () => {
    serve({ now: answer(NOW_ROWS()) })
    const { open } = renderPanel()
    await screen.findByTestId('terminal-unvol-table')
    const method = screen.getByTestId('terminal-unvol-method').textContent
    expect(method).toContain('today\'s volume so far divided by what the stock usually trades by this time of day')
    expect(method).toContain('average daily volume over the last 30 completed sessions')
    expect(method).toContain('It starts at 9:45 AM ET')
    expect(method).toContain('US stocks (no funds) priced $5 or more that trade $10 million or more a day on average')
    expect(method).toContain('at 2× its usual volume or more, up or down on the day, highest first')
    expect(method).toContain('not a forecast or a recommendation')
    expect(method).toContain('this panel reads again every minute')
    fireEvent.click(screen.getByRole('button', { name: 'Open the movers list on unusual volume (MOST RVOL)' }))
    expect(open).toHaveBeenCalledWith('MOST RVOL')
    fireEvent.click(screen.getByRole('button', { name: 'Open the 1-year volume highs (LEAD VOL1Y)' }))
    expect(open).toHaveBeenCalledWith('LEAD VOL1Y')
  })

  it('says the cut when more matched than are shown, a row with no reading, and draws the receipt', async () => {
    serve({ now: answer([...NOW_ROWS(), row({ ticker: 'ZZX', rvol_live: null })], { total: 240, coverage: COVERAGE }) })
    renderPanel()
    await screen.findByTestId('terminal-unvol-table')
    expect(screen.getByTestId('terminal-unvol-capped').textContent)
      .toContain('240 stocks matched; the 3 furthest above their usual volume are shown.')
    expect(screen.getByTestId('terminal-unvol-lede').textContent).toContain('240 stocks at 2× its usual volume or more')
    expect(screen.getByTestId('terminal-unvol-unread').textContent).toContain('1 stock came back with no volume reading and is not listed.')
    expect(screen.queryByTestId('terminal-unvol-row-ZZX')).toBeNull()
    expect(screen.getByTestId('coverage-line').textContent).toContain('4,200 evaluated')
  })

  it('a reading that has stopped moving is not badged "By now", and says so', async () => {
    const old = secondsAgo(3 * 3600)
    serve({ now: answer(NOW_ROWS().map((r) => ({ ...r, live_asof: old }))) })
    renderPanel()
    await screen.findByTestId('terminal-unvol-table')
    expect(screen.getByTestId('terminal-unvol-badge').textContent).toBe('Earlier reading')
    const lede = screen.getByTestId('terminal-unvol-lede').textContent
    expect(lede).toContain(`as of ${readingStamp(new Date(old * 1000).toISOString())}.`)
    expect(lede).toContain('This reading is not moving now: the session is over, or the server has stopped rewriting it.')
    expect(screen.getByTestId('terminal-unvol-method').textContent).toContain('this panel reads again every 5 minutes')
  })
})

describe('UNVOL with no by-now reading', () => {
  it('says so and shows the last full session with its date; never an empty table under a "now"', async () => {
    serve({ now: EMPTY, last: answer(LAST_ROWS()) })
    const { setFreshness, publishRows } = renderPanel()
    await screen.findByTestId('terminal-unvol-table')
    expect(calls()).toEqual([unvolScanBody('now'), unvolScanBody('last')])   // the base picks need no probe
    expect(panel().getAttribute('data-stage')).toBe('last')
    const note = screen.getByTestId('terminal-unvol-last-note').textContent
    expect(note).toContain('There is no by-now volume reading at the moment.')
    expect(note).toContain('It runs in the regular session from 9:45 AM ET')
    expect(note).toContain('Showing the last full session instead, 2026-11-17')
    expect(note).not.toContain('The prices and day changes below are today\'s')
    expect(screen.getByTestId('terminal-unvol-badge').textContent).toBe('Last session')
    expect(screen.getByTestId('terminal-unvol-lede').textContent)
      .toBe('2 stocks at 2× its usual volume or more, up or down on the day in the session of 2026-11-17.')
    expect(symsInTable()).toEqual(['ZZD', 'ZZE'])
    expect(screen.getByTestId('terminal-unvol-row-ZZD').textContent).toContain('6.2×')
    expect(screen.getByTestId('terminal-unvol-method').textContent)
      .toContain('that session\'s full-day volume divided by the stock\'s average volume over the 30 sessions before it')
    expect(screen.getByTestId('terminal-unvol-method').textContent).not.toContain('by this time of day:')
    // the header's as-of is the session's date, never a time it does not have
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith({ source: SOURCE, age: { asOfDate: '2026-11-17' } }))
    expect(publishRows.mock.calls.at(-1)[0]).toEqual(['$ZZD', '$ZZE'])
    expect(screen.getByRole('table', { name: 'Unusual volume, the last full session, 2 stocks, highest first' })).toBeTruthy()
  })

  it('says when the prices are today\'s while the volumes are the last session\'s', async () => {
    serve({ now: EMPTY, last: answer(LAST_ROWS({ live_row: 1, live_asof: secondsAgo(20) })) })
    renderPanel()
    await screen.findByTestId('terminal-unvol-table')
    expect(screen.getByTestId('terminal-unvol-last-note').textContent)
      .toContain('The prices and day changes below are today\'s; the volume is that session\'s.')
  })

  it('a last session with no match is the one empty state, dated', async () => {
    serve({ now: EMPTY, last: answer([], { coverage: COVERAGE }) })
    renderPanel()
    const empty = await screen.findByTestId('terminal-unvol-empty')
    expect(empty.getAttribute('data-kind')).toBe('empty')
    expect(empty.textContent).toContain('No stock traded 2× its usual volume or more, up or down on the day in the last full session (2026-11-17).')
    expect(empty.textContent).toContain('not a failed read')
    expect(screen.getByTestId('terminal-unvol-last-note')).toBeTruthy()
    expect(screen.getByTestId('coverage-line')).toBeTruthy()
    expect(screen.queryByTestId('terminal-unvol-reset')).toBeNull()   // nothing to loosen at the base picks
  })
})

describe('UNVOL: "nothing matches" is not "no reading"', () => {
  it('a filtered pick that comes back empty asks one row; a reading that runs is an empty answer for NOW', async () => {
    serve({ now: (body) => (body.filters.length > 4 || body.filters[0].min > 2 ? EMPTY : answer(NOW_ROWS())), probe: answer([row()]) })
    renderPanel({ side: 'down', min: 5 })
    const empty = await screen.findByTestId('terminal-unvol-empty')
    expect(panel().getAttribute('data-stage')).toBe('nowEmpty')
    expect(empty.textContent).toContain('No stock is at 5× its usual volume or more, down on the day right now.')
    expect(empty.textContent).toContain('The by-now reading is running and nothing passes these picks.')
    expect(callsOf('probe')).toEqual([unvolScanBody('now', { probe: true })])
    expect(callsOf('last')).toEqual([])                       // never last session's names under these picks
    expect(screen.queryByTestId('terminal-unvol-last-note')).toBeNull()
    // the way out is said: back to the base picks, written into the command
    fireEvent.click(screen.getByTestId('terminal-unvol-reset'))
    expect(wire.writeBack).toHaveBeenLastCalledWith([])
    expect(await screen.findByTestId('terminal-unvol-table')).toBeTruthy()
    expect(panel().getAttribute('data-side')).toBe('all')
    expect(panel().getAttribute('data-min')).toBe('2')
  })

  it('no reading at all under a filtered pick: the last full session for the SAME picks', async () => {
    serve({ now: EMPTY, probe: EMPTY, last: answer(LAST_ROWS().slice(0, 1)) })
    renderPanel({ side: 'up', min: 3 })
    await screen.findByTestId('terminal-unvol-table')
    expect(calls()).toEqual([
      unvolScanBody('now', { side: 'up', min: 3 }),
      unvolScanBody('now', { probe: true }),
      unvolScanBody('last', { side: 'up', min: 3 }),
    ])
    expect(screen.getByTestId('terminal-unvol-lede').textContent)
      .toBe('1 stock at 3× its usual volume or more, up on the day in the session of 2026-11-17.')
    expect(screen.queryByTestId('terminal-unvol-loading')).toBeNull()
  })

  it('says it is checking while the one-row question is out', async () => {
    serve({ now: EMPTY, probe: PENDING })
    renderPanel({ min: 5 })
    await waitFor(() => expect(screen.getByTestId('terminal-unvol-loading').textContent).toContain('Checking for a by-now volume reading'))
    expect(screen.queryByTestId('terminal-unvol-empty')).toBeNull()
  })
})

describe('UNVOL chips', () => {
  it('a chip re-asks the server with its rule and writes its word into the command', async () => {
    serve({ now: (body) => answer(body.filters.some((f) => f.key === 'chg_pct_1d' && f.op === 'gt') ? NOW_ROWS().slice(0, 1) : NOW_ROWS()) })
    renderPanel()
    await screen.findByTestId('terminal-unvol-table')
    expect(within(screen.getByRole('group', { name: 'Direction on the day' })).getAllByRole('button').map((b) => b.textContent))
      .toEqual(['Up or down', 'Up on the day', 'Down on the day'])
    expect(within(screen.getByRole('group', { name: 'How far above usual' })).getAllByRole('button').map((b) => b.textContent))
      .toEqual(['2× or more', '3× or more', '5× or more'])
    expect(screen.getByTestId('terminal-unvol-side-all').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('terminal-unvol-min-2').getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByTestId('terminal-unvol-side-up'))
    expect(wire.writeBack).toHaveBeenLastCalledWith(['UP'])
    await waitFor(() => expect(symsInTable()).toEqual(['ZZA']))
    expect(calls().at(-1)).toEqual(unvolScanBody('now', { side: 'up' }))
    expect(screen.getByTestId('terminal-unvol-lede').textContent).toContain('1 stock at 2× its usual volume or more, up on the day')

    fireEvent.click(screen.getByTestId('terminal-unvol-min-3'))
    expect(wire.writeBack).toHaveBeenLastCalledWith(['UP', '3X'])
    await waitFor(() => expect(calls().at(-1)).toEqual(unvolScanBody('now', { side: 'up', min: 3 })))
    await screen.findByTestId('terminal-unvol-table')
    expect(screen.getByTestId('terminal-unvol-min-3').getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByTestId('terminal-unvol-side-all'))
    expect(wire.writeBack).toHaveBeenLastCalledWith(['3X'])
  })

  it('typed words seed the picks; a word the panel does not know opens the default', async () => {
    serve({ now: answer(NOW_ROWS()) })
    renderPanel({ side: 'down', min: 5 })
    await screen.findByTestId('terminal-unvol-table')
    expect(calls()[0]).toEqual(unvolScanBody('now', { side: 'down', min: 5 }))
    expect(screen.getByTestId('terminal-unvol-side-down').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('terminal-unvol-min-5').getAttribute('aria-pressed')).toBe('true')
    cleanup()
    jsonFetcher.mockClear()
    renderPanel({ side: 'LOSERS', min: '3X' })
    await screen.findByTestId('terminal-unvol-table')
    expect(calls()[0]).toEqual(unvolScanBody('now', { side: 'down', min: 3 }))
    cleanup()
    jsonFetcher.mockClear()
    renderPanel({ side: 'NOPE', min: 'NOPE' })
    await screen.findByTestId('terminal-unvol-table')
    expect(calls()[0]).toEqual(unvolScanBody('now'))
  })
})

describe('UNVOL follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const file of ['UnusualVolumePanel.jsx', 'unusualVolumeModel.js']) {
      const text = fs.readFileSync(path.join(HERE, file), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${file}`, text).map((h) => h.lit), file).toEqual([])
    }
  })
})

describe('UNVOL accessibility', () => {
  it('the by-now list, the last session, an empty answer and an error pass axe (WCAG A and AA)', async () => {
    serve({ now: answer(NOW_ROWS(), { total: 240, coverage: COVERAGE }) })
    renderPanel()
    await screen.findByTestId('terminal-unvol-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    jsonFetcher.mockReset()
    serve({ now: EMPTY, last: answer(LAST_ROWS({ live_row: 1, live_asof: secondsAgo(20) })) })
    renderPanel()
    await screen.findByTestId('terminal-unvol-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    jsonFetcher.mockReset()
    serve({ now: EMPTY, probe: answer([row()]) })
    renderPanel({ side: 'down' })
    await screen.findByTestId('terminal-unvol-empty')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    jsonFetcher.mockReset()
    serve({ now: fail(500) })
    renderPanel()
    await screen.findByTestId('terminal-unvol-error')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 30_000)
})
