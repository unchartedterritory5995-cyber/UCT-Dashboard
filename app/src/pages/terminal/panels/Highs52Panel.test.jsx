// H52: stocks at new 52-week highs and new 52-week lows. Rails:
//   * the pure half (highs52Model.js): the typed words, the URLs, which session the live read says
//     to show, the rows of a live and a stored list, and the sentences above the lists;
//   * while the session is live the two lists are the live ones, with the live read's own time;
//   * out of session, after the close and on a thin live read the panel shows the newest
//     FINISHED session's stored lists and says which day and why (never a live list as today's);
//   * when the live read itself fails, the newest stored date comes from /latest and the panel
//     says so; when that fails too it is an error with Retry;
//   * a paywall (402) and a dark route (404) are locked, with no Retry;
//   * a list the server cannot give, and a list that fails, are notes with Retry beside the other
//     list: never "no stock made a new high"; a healthy answer with no rows is the only empty;
//   * chips cut the lists, renumber the rows and hand their word to the command.
// Fixtures are the shapes api/routers/breadth_monitor.py and api/services/breadth_live.py answer
// (`_live_payload`, `live_drill`, `drill_items`, `get_drill_list`), with made-up tickers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const wire = vi.hoisted(() => ({ writeBack: null }))
vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
// The list alert switch has its own test (ListAlertSwitch.test.jsx). Here it is a marker, so this
// file's reads stay the panel's own, and one test at the end pins that the panel mounts it.
vi.mock('./ListAlertSwitch', async () => {
  const { createElement } = await import('react')
  return { default: ({ kind }) => createElement('span', { 'data-testid': 'list-alert-stub', 'data-kind': kind, hidden: true }) }
})
// The registry half of the write-back has its own test (commandWriteBack.test.jsx); here the panel's
// half is pinned: which words it hands over, and when.
vi.mock('./commandWriteBack', () => ({ usePanelWriteBack: () => wire.writeBack }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import Highs52Panel, {
  BREADTH_LATEST_URL, BREADTH_LIVE_URL, HIGHS52_CODE, HIGHS52_SIDES, MAX_ROWS, countsSentence, dayOf, drillRead,
  highs52CommandArgs, highs52Mode, latestSessionDate, liveDrillUrl, normSide52, settledSentence, storedDrillUrl,
} from './Highs52Panel'
import * as model from './highs52Model'
import { ARG_KINDS, HILO_SIDE_WORDS } from '../args'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const AS_OF = '2026-11-16T10:31:02-05:00'
const LIVE_STATUS = {
  ok: true, provisional: true, as_of: AS_OF, data_as_of: '2026-11-16T10:30:40-05:00', levels_as_of: '2026-11-13',
  session_date: '2026-11-16', market_open: true, session_live: true, traded_share: 0.93, universe_size: 2900,
  measured: 2850, anchored: true, degraded: false, superseded: false, carried: {}, carried_from: '2026-11-13',
  nhnl_basis: 'intraday', metrics: { new_52w_highs: 3, new_52w_lows: 2 },
}
// A Saturday: the last read is Friday's, and Friday's row is stored.
const CLOSED_STATUS = {
  ...LIVE_STATUS, as_of: '2026-11-14T12:00:00-05:00', session_date: '2026-11-13', market_open: false, session_live: false,
  superseded: true,
}
// After the close, once the collector has written the day's row.
const FINISHED_STATUS = { ...LIVE_STATUS, as_of: '2026-11-16T16:45:00-05:00', market_open: false, superseded: true, carried_from: '2026-11-16' }
const THIN_STATUS = { ...LIVE_STATUS, degraded: true }

const LIVE_HIGHS = {
  ok: true, reason: null, as_of: AS_OF,
  items: [
    { t: 'AAA', c: 391.62, pct: 4.21, vr: 2.3, v: 48_500_000, n: 'Aaa Holdings' },
    { t: 'BBB', c: 113.98, pct: 1.05, vr: 0.9, v: 1_250_000, n: 'Bbb Corp' },
    { t: 'CCC', c: 18.11 },
  ],
}
// The server orders every list biggest gain first; a lows list is read biggest fall first.
const LIVE_LOWS = {
  ok: true, reason: null, as_of: '2026-11-16T10:30:01-05:00',
  items: [
    { t: 'DDD', c: 104.54, pct: -2.9, vr: 1.2, v: 3_100_000, n: 'Ddd Inc' },
    { t: 'EEE', c: 7.5, pct: -8.4, vr: 4, v: 9_000_000, n: 'Eee Group' },
  ],
}
const STORED_HIGHS = {
  date: '2026-11-13', metric: 'new_52w_highs_list',
  items: [
    { t: 'FFF', n: 'Fff Corp', c: 50, vr: 1.4, a50: 12.1, atr: 2.2, pct: 2.5, v: 900_000 },
    { t: 'GGG', n: 'Ggg Ltd', c: 20.25, vr: 3.1, a50: 30, atr: 1.1, pct: 6.75, v: 4_400_000 },
  ],
}
const STORED_LOWS = { date: '2026-11-13', metric: 'new_52w_lows_list', items: [{ t: 'HHH', n: 'Hhh Co', c: 4.2, vr: 2, pct: -5.5, v: 700_000 }] }
const UNAVAILABLE = { ok: false, items: [], reason: 'new_52w_lows is not computed on the live path', as_of: AS_OF }

const L_HIGHS = '/api/breadth-monitor/live/drill/new_52w_highs_list'
const L_LOWS = '/api/breadth-monitor/live/drill/new_52w_lows_list'
const S_HIGHS = '/api/breadth-monitor/2026-11-13/drill/new_52w_highs_list'
const S_LOWS = '/api/breadth-monitor/2026-11-13/drill/new_52w_lows_list'
const LIVE_ROUTES = { [BREADTH_LIVE_URL]: LIVE_STATUS, [L_HIGHS]: LIVE_HIGHS, [L_LOWS]: LIVE_LOWS }
const CLOSED_ROUTES = { [BREADTH_LIVE_URL]: CLOSED_STATUS, [S_HIGHS]: STORED_HIGHS, [S_LOWS]: STORED_LOWS }

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

function renderPanel(props = {}, { run = vi.fn(), publishRows = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const tree = (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run, rerun: vi.fn(), publish: vi.fn(), publishRows }}>
          <Highs52Panel {...props} />
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>
  )
  render(code ? <TerminalPanelContext.Provider value={{ code, density: 'compact', inset: true }}>{tree}</TerminalPanelContext.Provider> : tree)
  return { run, publishRows, setFreshness }
}
const rowsOf = (testId) => within(screen.getByTestId(testId)).getAllByRole('row').slice(1)
const symsOf = (side) => rowsOf(`terminal-h52-${side}`).map((r) => r.getAttribute('data-testid').replace(`terminal-h52-${side}-row-`, ''))
const HERE = path.dirname(fileURLToPath(import.meta.url))

beforeEach(() => { jsonFetcher.mockReset(); wire.writeBack = vi.fn(() => false) })
afterEach(cleanup)

describe('H52 pure helpers (highs52Model)', () => {
  it('the panel re-exports the model, so a caller can import either', () => {
    expect(drillRead).toBe(model.drillRead)
    expect(highs52Mode).toBe(model.highs52Mode)
    expect(HIGHS52_CODE).toBe('H52')
    expect(MAX_ROWS).toBe(100)
  })

  it('the sides, the typed words and the command arguments', () => {
    expect(Object.keys(HIGHS52_SIDES)).toEqual(['both', 'highs', 'lows'])
    for (const [raw, want] of [['HIGHS', 'highs'], ['high', 'highs'], ['NH', 'highs'], ['lows', 'lows'], ['LO', 'lows'], ['NL', 'lows'],
      ['both', 'both'], [null, 'both'], ['', 'both'], ['SECTOR', 'both'], ['toString', 'both']]) expect(normSide52(raw), String(raw)).toBe(want)
    // the registry's existing `hiloSide` kind reads every word the same way, so H52 can reuse it
    for (const word of Object.keys(HILO_SIDE_WORDS)) expect(normSide52(word), word).toBe(ARG_KINDS.hiloSide.parse(word))
    expect(highs52CommandArgs()).toEqual([])
    expect(highs52CommandArgs({ side: 'both' })).toEqual([])
    expect(highs52CommandArgs({ side: 'lows' })).toEqual(['LOWS'])
    expect(highs52CommandArgs({ side: 'HIGH' })).toEqual(['HIGHS'])
    // every word a chip writes is read back to the same choice, by the panel and by the registry
    for (const [key, s] of Object.entries(HIGHS52_SIDES)) {
      if (!s.token) continue
      expect(normSide52(s.token)).toBe(key)
      expect(ARG_KINDS.hiloSide.parse(s.token)).toBe(key)
    }
  })

  it('the URLs: the live read, the newest stored row, and one list live or for a finished day', () => {
    expect(BREADTH_LIVE_URL).toBe('/api/breadth-monitor/live')
    expect(BREADTH_LATEST_URL).toBe('/api/breadth-monitor/latest')
    expect([liveDrillUrl('highs'), liveDrillUrl('lows')]).toEqual([L_HIGHS, L_LOWS])
    expect([storedDrillUrl('2026-11-13', 'highs'), storedDrillUrl('2026-11-13', 'lows')]).toEqual([S_HIGHS, S_LOWS])
    // never a path built from something that is not a calendar date ("live" is a route of its own)
    for (const bad of [null, '', 'live', '2026-11-13T10:00:00', '11/13/2026', '../x']) expect(storedDrillUrl(bad, 'highs')).toBeNull()
    expect(dayOf('2026-11-13T10:00:00-05:00')).toBe('2026-11-13')
    expect(dayOf('Friday')).toBeNull()
  })

  it('highs52Mode reads the live read\'s own words, never a clock', () => {
    expect(highs52Mode(LIVE_STATUS)).toEqual({ mode: 'live', date: '2026-11-16', why: null, basis: 'intraday' })
    expect(highs52Mode(CLOSED_STATUS)).toEqual({ mode: 'settled', date: '2026-11-13', why: 'closed', basis: 'intraday' })
    expect(highs52Mode(FINISHED_STATUS)).toEqual({ mode: 'settled', date: '2026-11-16', why: 'finished', basis: 'intraday' })
    expect(highs52Mode(THIN_STATUS)).toEqual({ mode: 'settled', date: '2026-11-13', why: 'thin', basis: 'intraday' })
    expect(highs52Mode({ ...LIVE_STATUS, nhnl_basis: undefined }).basis).toBeNull()
    // not in session and nothing stored: there is no session to show
    expect(highs52Mode({ ...CLOSED_STATUS, carried_from: null }).mode).toBeNull()
    // a live session with no date, and anything that is not a live read, is not "live"
    expect(highs52Mode({ ...LIVE_STATUS, session_date: null }).mode).toBe('settled')
    for (const body of [null, undefined, [], 'x', {}, { ok: false, reason: 'breadth live disabled' }, { detail: 'x' }]) {
      expect(highs52Mode(body)).toEqual({ mode: null, date: null, why: null, basis: null })
    }
    expect(latestSessionDate({ date: '2026-11-13', new_52w_highs: 41 })).toBe('2026-11-13')
    for (const body of [null, [], {}, { date: 'soon' }]) expect(latestSessionDate(body)).toBeNull()
  })

  it('drillRead: a live list keeps the read\'s time; highs biggest gain first, lows biggest fall first', () => {
    const highs = drillRead(LIVE_HIGHS, { side: 'highs', live: true })
    expect(highs.state).toBe('ok')
    expect(highs.asOf).toBe(AS_OF)
    expect(highs.rows.map((r) => r.sym)).toEqual(['AAA', 'BBB', 'CCC'])   // the row with no change sinks last
    expect(highs.rows[0]).toEqual({ key: 'highs-AAA', sym: 'AAA', name: 'Aaa Holdings', price: 391.62, pct: 4.21, rvol: 2.3, volume: 48_500_000, order: 0 })
    expect(highs.rows[2]).toMatchObject({ sym: 'CCC', name: null, pct: null, rvol: null, volume: null })   // not known, never 0
    const lows = drillRead(LIVE_LOWS, { side: 'lows', live: true })
    expect(lows.rows.map((r) => r.sym)).toEqual(['EEE', 'DDD'])
    expect(lows.rows.map((r) => r.order)).toEqual([0, 1])
  })

  it('drillRead: a stored list carries its session date; repeated and ticker-less rows are dropped', () => {
    const stored = drillRead(STORED_HIGHS, { side: 'highs' })
    expect(stored).toMatchObject({ state: 'ok', date: '2026-11-13', asOf: null })
    expect(stored.rows.map((r) => r.sym)).toEqual(['GGG', 'FFF'])
    const messy = drillRead({ date: '2026-11-13', items: [{ t: 'aaa', c: 1, pct: 1 }, { t: 'AAA', c: 2, pct: 9 }, { c: 3 }, null, 'x'] }, { side: 'highs' })
    expect(messy.rows.map((r) => r.sym)).toEqual(['AAA'])
    expect(messy.rows[0].price).toBe(1)
    expect(drillRead({ date: '2026-11-13', metric: 'new_52w_lows_list', items: [] }, { side: 'lows' })).toMatchObject({ state: 'ok', rows: [] })
  })

  it('drillRead: "cannot give this list" and "not an answer" are never an empty list', () => {
    expect(drillRead(UNAVAILABLE, { side: 'lows', live: true })).toMatchObject({
      state: 'unavailable', rows: [], asOf: AS_OF, reason: 'new_52w_lows is not computed on the live path',
    })
    expect(drillRead({ ok: false, items: [], reason: 'no live read cached', as_of: null }, { live: true }).state).toBe('unavailable')
    // a live answer with no `ok` at all is not a drill answer
    expect(drillRead({ items: [] }, { live: true }).state).toBe('failed')
    for (const body of [null, undefined, [], 'x', {}, { detail: 'No data' }, { items: 'no' }]) expect(drillRead(body, { side: 'highs' }).state).toBe('failed')
  })

  it('the sentences above the lists', () => {
    expect(countsSentence({ mode: 'live', highs: 3, lows: 2 })).toBe('3 stocks are at a new 52-week high so far today, 2 at a new low.')
    expect(countsSentence({ mode: 'live', highs: 1, lows: null })).toBe('1 stock is at a new 52-week high so far today.')
    expect(countsSentence({ mode: 'live', highs: null, lows: 1 })).toBe('1 stock is at a new 52-week low so far today.')
    expect(countsSentence({ mode: 'settled', date: '2026-11-13', highs: 41, lows: 1 })).toBe('41 stocks made a new 52-week high, 1 a new low on 2026-11-13.')
    expect(countsSentence({ mode: 'settled', date: '2026-11-13', highs: null, lows: 7 })).toBe('7 stocks made a new 52-week low on 2026-11-13.')
    expect(countsSentence({ mode: 'live', highs: null, lows: null })).toBe('')
    expect(countsSentence({ mode: 'live', highs: 1234, lows: 0, count: (n) => n.toLocaleString('en-US') })).toContain('1,234 stocks are')
    expect(settledSentence({ why: 'closed', date: '2026-11-13' })).toContain('The market is not in session')
    expect(settledSentence({ why: 'finished', date: '2026-11-16' })).toBe('Today\'s session has finished. These are its final lists, 2026-11-16.')
    expect(settledSentence({ why: 'thin', date: '2026-11-13' })).toContain('covering fewer stocks than usual')
    expect(settledSentence({ date: '2026-11-13', fallback: true })).toContain('Live breadth could not be read just now')
    for (const why of ['closed', 'finished', 'thin', null]) {
      expect(settledSentence({ why, date: '2026-11-13' })).toContain('2026-11-13')
      expect(settledSentence({ why, date: '2026-11-13' })).not.toMatch(/[—–]/)
    }
  })
})

describe('H52 panel states', () => {
  it('shows a loading skeleton, with the chips already there', () => {
    jsonFetcher.mockReturnValue(new Promise(() => {}))
    renderPanel()
    expect(screen.getByTestId('terminal-h52-loading')).toBeTruthy()
    expect(screen.getByTestId('terminal-h52-side-both').getAttribute('aria-pressed')).toBe('true')
    expect(asked()).toEqual([BREADTH_LIVE_URL])   // no list is asked for before the session is known
  })

  it('a 402 says paid plan and a 404 says not switched on: both locked, neither offers Retry', async () => {
    jsonFetcher.mockRejectedValue(fail(402))
    renderPanel()
    const paid = await screen.findByTestId('terminal-h52-error')
    expect(paid.getAttribute('data-kind')).toBe('locked')
    expect(paid.textContent).toContain('The 52-week highs and lows needs a paid plan.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(asked()).not.toContain(BREADTH_LATEST_URL)   // a paywall is not an outage: no stored list would answer it
    cleanup()
    jsonFetcher.mockReset()
    jsonFetcher.mockRejectedValue(fail(404))
    renderPanel()
    const off = await screen.findByTestId('terminal-h52-error')
    expect(off.getAttribute('data-kind')).toBe('locked')
    expect(off.textContent).toContain('The 52-week highs and lows is not switched on for this server yet.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('the live read AND the stored date failing (500) is an error with Retry, never an empty list', async () => {
    serve({})   // every route answers 500
    renderPanel({}, { code: 'NH52' })
    const err = await screen.findByTestId('terminal-h52-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The 52-week highs and lows could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no stock at a new high or low. Retry, or run NH52 again.')
    expect(screen.queryByTestId('terminal-h52-empty')).toBeNull()
    expect(asked()).toContain(BREADTH_LATEST_URL)
    serve(LIVE_ROUTES)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-h52-highs')).toBeTruthy()
  })

  it('the live read failing falls back to the newest stored session, and says so', async () => {
    serve({ [BREADTH_LIVE_URL]: fail(503), [BREADTH_LATEST_URL]: { date: '2026-11-13', new_52w_highs: 2 }, [S_HIGHS]: STORED_HIGHS, [S_LOWS]: STORED_LOWS })
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-h52-highs')
    expect(screen.getByTestId('terminal-h52-mode').textContent).toBe('Finished session')
    const day = screen.getByTestId('terminal-h52-day')
    expect(day.textContent).toBe('Live breadth could not be read just now, so these are the lists of the last finished session, 2026-11-13.')
    expect(day.getAttribute('role')).toBe('status')
    expect(symsOf('highs')).toEqual(['GGG', 'FFF'])
    expect(asked()).not.toContain(L_HIGHS)
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith({ source: 'UCT Breadth Monitor (52-week highs and lows)', age: { asOfDate: '2026-11-13' } }))
  })

  it('a signed-out member is told to sign in, and no stored list is asked for', async () => {
    jsonFetcher.mockRejectedValue(fail(401))
    renderPanel()
    const err = await screen.findByTestId('terminal-h52-error')
    expect(err.textContent).toContain('You are signed out')
    expect(asked()).toEqual([BREADTH_LIVE_URL])
  })

  it('market closed: the last finished session\'s lists, dated, and never a live list', async () => {
    serve(CLOSED_ROUTES)
    const { setFreshness, publishRows } = renderPanel()
    await screen.findByTestId('terminal-h52-highs')
    expect(screen.getByTestId('terminal-h52').getAttribute('data-mode')).toBe('settled')
    expect(screen.getByTestId('terminal-h52-mode').textContent).toBe('Finished session')
    expect(screen.getByTestId('terminal-h52-totals').textContent).toBe('2 stocks made a new 52-week high, 1 a new low on 2026-11-13.')
    const day = screen.getByTestId('terminal-h52-day').textContent
    expect(day).toContain('The market is not in session, so these are the lists of the last finished session, 2026-11-13.')
    expect(asked()).toEqual(expect.arrayContaining([S_HIGHS, S_LOWS]))
    expect(asked()).not.toContain(L_HIGHS)
    expect(asked()).not.toContain(L_LOWS)
    // a finished session reads Close, not Last, and has no "worked out at" time
    expect(within(screen.getByTestId('terminal-h52-highs')).getAllByRole('columnheader').map((h) => h.textContent))
      .toEqual(['Symbol', 'Close', 'Change', 'Vs usual volume'])   // two lists side by side: the columns that fit half a panel
    expect(screen.getByTestId('terminal-h52-method').textContent).not.toContain('Lists worked out at')
    expect(publishRows).toHaveBeenLastCalledWith(['$GGG', '$FFF', '$HHH'])
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith({ source: 'UCT Breadth Monitor (52-week highs and lows)', age: { asOfDate: '2026-11-13' } }))
  })

  it('after the close the day\'s own stored lists are shown, and a thin live read is not trusted', async () => {
    serve({
      [BREADTH_LIVE_URL]: FINISHED_STATUS,
      '/api/breadth-monitor/2026-11-16/drill/new_52w_highs_list': { ...STORED_HIGHS, date: '2026-11-16' },
      '/api/breadth-monitor/2026-11-16/drill/new_52w_lows_list': { ...STORED_LOWS, date: '2026-11-16' },
    })
    renderPanel()
    await screen.findByTestId('terminal-h52-highs')
    expect(screen.getByTestId('terminal-h52-day').textContent).toBe('Today\'s session has finished. These are its final lists, 2026-11-16.')
    cleanup()
    jsonFetcher.mockReset()
    serve({ ...CLOSED_ROUTES, [BREADTH_LIVE_URL]: THIN_STATUS })
    renderPanel()
    await screen.findByTestId('terminal-h52-highs')
    expect(screen.getByTestId('terminal-h52-day').textContent).toContain('covering fewer stocks than usual')
    expect(asked()).not.toContain(L_HIGHS)
  })

  it('not in session with nothing stored says so: it is not an empty list', async () => {
    serve({ [BREADTH_LIVE_URL]: { ...CLOSED_STATUS, carried_from: null } })
    renderPanel()
    const none = await screen.findByTestId('terminal-h52-no-session')
    expect(none.textContent).toContain('The market is not in session, and no finished session is stored on this server yet.')
    expect(screen.queryByTestId('terminal-h52-empty')).toBeNull()
    expect(asked()).toEqual([BREADTH_LIVE_URL])
  })

  it('a healthy answer with no rows is the one empty state, and keeps the chips', async () => {
    serve({ [BREADTH_LIVE_URL]: LIVE_STATUS, [L_HIGHS]: { ...LIVE_HIGHS, items: [] }, [L_LOWS]: { ...LIVE_LOWS, items: [] } })
    renderPanel()
    const empty = await screen.findByTestId('terminal-h52-empty')
    expect(empty.getAttribute('data-kind')).toBe('empty')
    expect(empty.textContent).toContain('No stock is at a new 52-week high or low so far today.')
    expect(screen.getByTestId('terminal-h52-totals').textContent).toBe('0 stocks are at a new 52-week high so far today, 0 at a new low.')
    expect(screen.queryByTestId('terminal-h52-split')).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-h52-side-lows'))
    expect(screen.getByTestId('terminal-h52-empty').textContent).toContain('No stock is at a new 52-week low so far today.')
    cleanup()
    jsonFetcher.mockReset()
    serve({ ...CLOSED_ROUTES, [S_HIGHS]: { ...STORED_HIGHS, items: [] }, [S_LOWS]: { ...STORED_LOWS, items: [] } })
    renderPanel()
    expect((await screen.findByTestId('terminal-h52-empty')).textContent).toContain('No stock made a new 52-week high or low on 2026-11-13.')
  })
})

describe('H52 panel, the two lists fail apart', () => {
  it('a list the server cannot give is said as that, beside the list that answered', async () => {
    serve({ ...LIVE_ROUTES, [L_LOWS]: UNAVAILABLE })
    const { publishRows } = renderPanel()
    await screen.findByTestId('terminal-h52-highs')
    const note = screen.getByTestId('terminal-h52-lows-unavailable')
    expect(note.textContent).toContain('The server cannot give the live lows list right now.')
    expect(note.textContent).toContain('That is not the same as no stock making a new low.')
    expect(screen.queryByTestId('terminal-h52-no-lows')).toBeNull()
    expect(screen.queryByTestId('terminal-h52-empty')).toBeNull()
    expect(screen.getByTestId('terminal-h52-totals').textContent).toBe('3 stocks are at a new 52-week high so far today.')
    expect(publishRows).toHaveBeenLastCalledWith(['$AAA', '$BBB', '$CCC'])
    serve(LIVE_ROUTES)
    fireEvent.click(screen.getByRole('button', { name: 'Retry the lows list' }))
    expect(await screen.findByTestId('terminal-h52-lows')).toBeTruthy()
  })

  it('one list failing (500) keeps the other and offers its own Retry; both failing is the panel\'s error', async () => {
    serve({ ...LIVE_ROUTES, [L_HIGHS]: fail(500) })
    renderPanel()
    await screen.findByTestId('terminal-h52-lows')
    const note = screen.getByTestId('terminal-h52-highs-error')
    expect(note.textContent).toContain('The 52-week highs list could not be read just now.')
    expect(note.textContent).toContain('That is not the same as no stock making a new high.')
    expect(screen.getByRole('button', { name: 'Retry the highs list' })).toBeTruthy()
    cleanup()
    jsonFetcher.mockReset()
    serve({ [BREADTH_LIVE_URL]: LIVE_STATUS })
    renderPanel()
    const err = await screen.findByTestId('terminal-h52-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The 52-week highs and lows could not be read just now.')
    expect(screen.queryByTestId('terminal-h52-empty')).toBeNull()
  })

  it('a finished session with no stored lists says they are not stored, never "no new highs"', async () => {
    serve({ [BREADTH_LIVE_URL]: CLOSED_STATUS, [S_HIGHS]: fail(404), [S_LOWS]: fail(404) })
    renderPanel()
    const err = await screen.findByTestId('terminal-h52-error')
    expect(err.textContent).toContain('The 52-week lists for 2026-11-13 are not stored on this server.')
    expect(screen.queryByTestId('terminal-h52-empty')).toBeNull()
    cleanup()
    jsonFetcher.mockReset()
    serve({ ...CLOSED_ROUTES, [S_LOWS]: fail(404) })
    renderPanel()
    await screen.findByTestId('terminal-h52-highs')
    expect(screen.getByTestId('terminal-h52-lows-error').textContent)
      .toContain('The 52-week lows list for 2026-11-13 is not stored on this server. That is not the same as no stock making a new low.')
  })
})

describe('H52 panel, live', () => {
  it('shows both live lists, the counts, and the live read\'s own time in the header', async () => {
    serve(LIVE_ROUTES)
    const { setFreshness, run, publishRows } = renderPanel()
    await screen.findByTestId('terminal-h52-highs')
    expect(screen.getByTestId('terminal-h52').getAttribute('data-mode')).toBe('live')
    expect(screen.getByTestId('terminal-h52-mode').textContent).toBe('Live session')
    expect(screen.getByTestId('terminal-h52-totals').textContent).toBe('3 stocks are at a new 52-week high so far today, 2 at a new low.')
    expect(screen.queryByTestId('terminal-h52-day')).toBeNull()
    const [up, down] = screen.getByTestId('terminal-h52-split').children
    expect(up.style.width).toBe('60%')
    expect(down.style.width).toBe('40%')
    expect(screen.getByRole('table', { name: 'New 52-week highs (3)' })).toBeTruthy()
    expect(screen.getByRole('table', { name: 'New 52-week lows (2)' })).toBeTruthy()
    expect(symsOf('highs')).toEqual(['AAA', 'BBB', 'CCC'])
    expect(symsOf('lows')).toEqual(['EEE', 'DDD'])
    const aaa = screen.getByTestId('terminal-h52-highs-row-AAA').textContent
    for (const s of ['1', 'AAA', '$391.62', '+4.21%', '2.3×']) expect(aaa).toContain(s)
    // side by side, each list keeps the columns that fit half a panel: no company name, no share count
    expect(aaa).not.toContain('Aaa Holdings')
    expect(aaa).not.toContain('48.5M')
    expect(within(screen.getByTestId('terminal-h52-highs')).getAllByRole('columnheader').map((h) => h.textContent))
      .toEqual(['Symbol', 'Last', 'Change', 'Vs usual volume'])
    // a missing change or ratio is said in words, never drawn as 0
    expect(screen.getByTestId('terminal-h52-highs-row-CCC').textContent.match(/n\/a/g)).toHaveLength(2)
    // the lows carry on the numbering: EEE is row 4
    const eee = screen.getByTestId('terminal-h52-lows-row-EEE').textContent
    for (const s of ['4', 'EEE', '$7.50', '-8.40%', '4.0×']) expect(eee).toContain(s)
    fireEvent.click(screen.getByTestId('panel-symbol-DDD'))
    expect(run).toHaveBeenCalledWith('$DDD')
    expect(publishRows).toHaveBeenLastCalledWith(['$AAA', '$BBB', '$CCC', '$EEE', '$DDD'])
    // the header's as-of is the OLDER of the two lists on screen
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith({
      source: 'UCT Breadth Monitor (52-week highs and lows)',
      observedAt: '2026-11-16T15:30:01.000Z',
      age: { asOfDate: 'Nov 16, 10:30 AM ET' },
    }))
    const method = screen.getByTestId('terminal-h52-method').textContent
    expect(method).toContain('These are 52-week highs and lows')
    expect(method).toContain('once it trades above its highest price of the prior 52 weeks')
    expect(method).toContain('Lists worked out at 10:30 AM ET.')
    expect(method).not.toContain('Showing the')
    expect(document.body.textContent).not.toMatch(/[—–]/)
  })

  it('a long list draws the first 100 and counts the rest; Show every stock draws them all', async () => {
    const items = Array.from({ length: 104 }, (_, i) => ({ t: `S${String(i).padStart(3, '0')}`, c: 20, pct: 30 - i * 0.1, vr: 1, v: 1000 }))
    serve({ ...LIVE_ROUTES, [L_HIGHS]: { ...LIVE_HIGHS, items } })
    const { publishRows } = renderPanel({ side: 'HIGHS' })
    await screen.findByTestId('terminal-h52-highs')
    expect(symsOf('highs')).toHaveLength(100)
    expect(symsOf('highs')[0]).toBe('S000')
    expect(screen.getByRole('table', { name: 'New 52-week highs (104)' })).toBeTruthy()
    expect(screen.getByTestId('terminal-h52-method').textContent).toContain('Showing the 100 biggest moves of 104 new highs.')
    expect(publishRows.mock.calls.at(-1)[0]).toHaveLength(100)
    fireEvent.click(screen.getByTestId('terminal-h52-all'))
    expect(symsOf('highs')).toHaveLength(104)
    expect(screen.getByTestId('terminal-h52-method').textContent).not.toContain('Showing the 100')
    expect(screen.getByTestId('terminal-h52-all').getAttribute('aria-pressed')).toBe('true')
  })
})

describe('H52 chips', () => {
  it('Highs and Lows cut the lists, renumber the rows, and hand their word to the command', async () => {
    serve(LIVE_ROUTES)
    const { publishRows } = renderPanel()
    await screen.findByTestId('terminal-h52-highs')
    fireEvent.click(screen.getByTestId('terminal-h52-side-lows'))
    expect(wire.writeBack).toHaveBeenLastCalledWith(['LOWS'])
    expect(screen.getByTestId('terminal-h52').getAttribute('data-side')).toBe('lows')
    expect(screen.queryByTestId('terminal-h52-highs')).toBeNull()
    expect(symsOf('lows')).toEqual(['EEE', 'DDD'])
    expect(screen.getByTestId('terminal-h52-lows-row-EEE').textContent.startsWith('1')).toBe(true)
    expect(screen.getByTestId('terminal-h52-totals').textContent).toBe('2 stocks are at a new 52-week low so far today.')
    expect(publishRows).toHaveBeenLastCalledWith(['$EEE', '$DDD'])
    fireEvent.click(screen.getByTestId('terminal-h52-side-highs'))
    expect(wire.writeBack).toHaveBeenLastCalledWith(['HIGHS'])
    expect(screen.queryByTestId('terminal-h52-lows')).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-h52-side-both'))
    expect(wire.writeBack).toHaveBeenLastCalledWith([])   // both lists is the bare command
    expect(symsOf('highs')).toHaveLength(3)
    expect(symsOf('lows')).toHaveLength(2)
  })

  it('one list on its own shows every column: the company name and the share count too', async () => {
    serve(LIVE_ROUTES)
    renderPanel({ side: 'HIGHS' })
    await screen.findByTestId('terminal-h52-highs')
    expect(within(screen.getByTestId('terminal-h52-highs')).getAllByRole('columnheader').map((h) => h.textContent))
      .toEqual(['Symbol', 'Company', 'Last', 'Change', 'Volume', 'Volume vs usual'])
    const aaa = screen.getByTestId('terminal-h52-highs-row-AAA').textContent
    for (const s of ['AAA', 'Aaa Holdings', '$391.62', '+4.21%', '48.5M', '2.3×']) expect(aaa).toContain(s)
    // a missing name, change, volume or ratio is said in words, never drawn as 0
    expect(screen.getByTestId('terminal-h52-highs-row-CCC').textContent.match(/n\/a/g)).toHaveLength(4)
  })

  it('the side prop seeds the chip, and a hidden list failing is not the shown list\'s problem', async () => {
    serve({ ...LIVE_ROUTES, [L_HIGHS]: fail(500) })
    renderPanel({ side: 'LOWS' })
    await screen.findByTestId('terminal-h52-lows')
    expect(screen.getByTestId('terminal-h52-side-lows').getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByTestId('terminal-h52-highs-error')).toBeNull()
    expect(screen.queryByTestId('terminal-h52-error')).toBeNull()
  })
})

describe('H52 follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const file of ['Highs52Panel.jsx', 'highs52Model.js']) {
      const text = fs.readFileSync(path.join(HERE, file), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${file}`, text).map((h) => h.lit), file).toEqual([])
    }
  })
})

describe('H52 accessibility', () => {
  it('the live lists and a finished session pass axe (WCAG A and AA)', async () => {
    serve(LIVE_ROUTES)
    renderPanel()
    await screen.findByTestId('terminal-h52-highs')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    jsonFetcher.mockReset()
    serve({ ...CLOSED_ROUTES, [S_LOWS]: fail(500) })
    renderPanel()
    await screen.findByTestId('terminal-h52-highs')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 20_000)
})

describe('H52 list alert', () => {
  it('mounts the "alert me" switch for the new 52-week highs list, outside the toolbar', async () => {
    serve(LIVE_ROUTES)
    renderPanel()
    await screen.findByTestId('terminal-h52-highs')
    const stub = screen.getByTestId('list-alert-stub')
    expect(stub.getAttribute('data-kind')).toBe('highs52')
    expect(stub.closest('[role="toolbar"]')).toBeNull()
  })
})
