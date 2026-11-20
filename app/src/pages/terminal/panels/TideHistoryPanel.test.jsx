// TIDEH: Market Tide by day, each finished session's net call and net put premium as stored. Rails:
//   * loading, a failed read (error with Retry), signed out, no paid plan, a switched-off route and
//     an answer that is not the route's shape: none is "no sessions stored";
//   * nothing stored yet says when the first is stored; one stored session draws its row with no sums;
//   * the line above the table (how many sessions, since which day, the tape's filters), the table
//     newest first (day in words, three signed compact figures, a bar from a zero line), the sums
//     and their refusals, the missing session named in a note and never drawn as a row;
//   * 20 rows then the rest; the chips ask the server for one scope and write it into the command;
//   * no row is called bullish or bearish; no hard-coded color; axe.
// Every number is invented; the fixtures are the route's real shape.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react'
import { SWRConfig, useSWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import TideHistoryPanel, { TIDE_HISTORY_CODE, TIDE_HISTORY_POLL_MS, TIDE_HISTORY_SOURCE, TIDE_ROWS_SHOWN, tideHistoryUrl } from './TideHistoryPanel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const URL = '/api/options/market-tide/history?scope=all&sessions=250'
const STOCKS = '/api/options/market-tide/history?scope=stocks&sessions=250'
const ETFS = '/api/options/market-tide/history?scope=etfs&sessions=250'
const FILTERS = 'The flow tape records option prints of 50+ contracts and $10K+ premium; smaller prints are not on it and are not in this tide.'
const STORED_NOTE = 'Each session is stored once after its close, about 4:30 PM ET, and is not revised afterwards. Sessions before the first stored day were never stored and cannot be recovered.'
const sess = (session, call, put, over = {}) => ({
  session, net_call_premium: call, net_put_premium: put, net_premium: call - put, prints_counted: 1200, prints_unsigned: 90,
  data_through: '15:59', stored_at: `${session}T21:33:04+00:00`, source: 'capture', ...over,
})
/** A history answer; `sessions` newest first, as the route sends them. */
const answer = (sessions, over = {}) => ({
  scope: 'all', sessions, sessions_stored: sessions.length, sessions_asked: 250,
  history_began: sessions.length ? sessions[sessions.length - 1].session : null, latest_session: sessions.length ? sessions[0].session : null,
  missing_sessions: [], missing_checked_through: sessions.length ? sessions[0].session : null, backfill: false,
  stored_note: STORED_NOTE, filters: FILTERS, method: 'Each print is signed by its side.', label: 'computed', ...over,
})
const WED = sess('2026-11-18', 6_200_000, 2_200_000, { prints_counted: 2040, data_through: '16:14' })    // net +4.0M
const TUE = sess('2026-11-17', 1_500_000, 3_500_000)                                                     // net -2.0M
const MON = sess('2026-11-16', 900_000, 900_000)                                                         // net 0
const FRI = sess('2026-11-13', -400_000, -1_400_000)                                                     // net +1.0M
const THU = sess('2026-11-12', 2_000_000, 1_500_000)                                                     // net +500K
const FIVE = [WED, TUE, MON, FRI, THU]
/** `n` weekday sessions ending Wed Nov 18 2026, newest first (weekends skipped; no holiday falls in reach of 30). */
const many = (n, over) => {
  const out = []
  const d = new Date(Date.UTC(2026, 10, 18))
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(sess(d.toISOString().slice(0, 10), 1_000_000 + out.length * 10_000, 400_000))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return answer(out, over)
}

const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
/** Serves each route its body (an Error is thrown, PENDING never answers); anything else is a 500. */
function serve(routes) {
  jsonFetcher.mockImplementation((url) => {
    const hit = routes[url]
    if (hit === undefined) return Promise.reject(fail(500))
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([url]) => url))]

/** Re-reads every key the panel holds, as its poll would (set by the mounted tree). */
let revalidateAll = async () => {}
function Revalidator() {
  const { mutate } = useSWRConfig()
  revalidateAll = () => mutate(() => true)
  return null
}

function renderPanel(props = {}, { rerun = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const tree = (p) => (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <Revalidator />
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run: vi.fn(), rerun, publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}><TideHistoryPanel {...p} /></TerminalPanelContext.Provider>
            : <TideHistoryPanel {...p} />}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>
  )
  const view = render(tree(props))
  return { rerun, setFreshness, rerender: (p) => view.rerender(tree(p)), container: view.container }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const rows = () => screen.getAllByTestId('terminal-tideh-row')
const cells = (tr) => [...tr.querySelectorAll('td')]
const noDated = (setFreshness) => setFreshness.mock.calls.every(([report]) => report == null)
const lastReport = (setFreshness) => setFreshness.mock.calls.map(([r]) => r).filter(Boolean).pop()

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('TIDEH states', () => {
  it('shows a loading skeleton and asks the one route', () => {
    serve({ [URL]: PENDING })
    renderPanel()
    expect(TIDE_HISTORY_CODE).toBe('TIDEH')
    expect(tideHistoryUrl('all')).toBe(URL)
    expect(TIDE_HISTORY_POLL_MS).toBe(600000)
    expect(screen.getByTestId('terminal-tideh-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-tideh')).toBeNull()
    expect(asked()).toEqual([URL])
  })

  it('a failed read (500) is an error with Retry, never "no sessions stored"', async () => {
    serve({})
    const { setFreshness } = renderPanel({}, { code: 'TIDEH' })
    const err = await screen.findByTestId('terminal-tideh-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The Market Tide history could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no sessions stored. Retry, or run TIDEH again.')
    expect(screen.queryByTestId('terminal-tideh-table')).toBeNull()
    expect(screen.queryByTestId('terminal-tideh-none')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    serve({ [URL]: answer(FIVE) })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-tideh-table')).toBeTruthy()
  })

  it('signed out, a timeout and no paid plan each say so; only an error can be retried', async () => {
    for (const [err, kind, words] of [
      [fail(401), 'error', 'You are signed out, so the Market Tide history cannot be read. Sign in again.'],
      [fail(0, { timedOut: true }), 'error', 'The Market Tide history did not answer within 30 seconds.'],
      [fail(503), 'error', 'The Market Tide history could not be read just now.'],
      [fail(402), 'locked', 'The Market Tide history needs a paid plan.'],
    ]) {
      serve({ [URL]: err })
      renderPanel()
      const box = await screen.findByTestId('terminal-tideh-error')
      expect(box.getAttribute('data-kind'), words).toBe(kind)
      expect(box.textContent, words).toContain(words)
      expect(!!within(box).queryByRole('button', { name: 'Retry' }), words).toBe(kind === 'error')
      expect(screen.queryByTestId('terminal-tideh-table')).toBeNull()
      cleanup()
    }
  })

  it('a switched-off route says it is a setting on our side, with no Retry and no empty table', async () => {
    serve({ [URL]: fail(404) })
    const { setFreshness } = renderPanel()
    const box = await screen.findByTestId('terminal-tideh-error')
    expect(box.getAttribute('data-kind')).toBe('locked')
    expect(box.textContent).toContain('Market Tide isn\'t switched on yet.')
    expect(box.textContent).toContain('That is a setting on our side, not an empty result.')
    expect(within(box).queryByRole('button')).toBeNull()
    expect(screen.queryByTestId('terminal-tideh-none')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
  })

  it('an answer that is not the route\'s shape is a failed read, never an empty history', async () => {
    serve({ [URL]: { status: 'ok', rows: [] } })
    renderPanel()
    const err = await screen.findByTestId('terminal-tideh-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The Market Tide history could not be read just now.')
    expect(screen.queryByTestId('terminal-tideh-none')).toBeNull()
  })

  it('nothing stored yet says when the first session is stored, is not dated, and keeps the chips', async () => {
    serve({ [URL]: answer([]), [ETFS]: answer([], { scope: 'etfs' }) })
    const { setFreshness } = renderPanel()
    const none = await screen.findByTestId('terminal-tideh-none')
    expect(screen.getByTestId('terminal-tideh').getAttribute('data-state')).toBe('none')
    expect(none.textContent).toContain('No session is stored yet.')
    expect(none.textContent).toContain('The first is stored after the next close on a weekday, about 4:30 PM ET.')
    expect(none.textContent).toContain('Sessions before the first stored day were never stored and cannot be recovered.')
    expect(within(none).getByRole('button', { name: 'Market Tide (TIDE)' })).toBeTruthy()
    expect(screen.queryByTestId('terminal-tideh-table')).toBeNull()
    expect(screen.queryByTestId('terminal-tideh-summary')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'ETFs' }))
    expect((await screen.findByText('No session is stored yet for ETFs and indexes only.'))).toBeTruthy()
  })

  it('one stored session draws its row, says there is nothing to sum yet, and offers no sum', async () => {
    serve({ [URL]: answer([WED]) })
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-tideh-table')
    expect(screen.getByTestId('terminal-tideh').getAttribute('data-state')).toBe('one')
    expect(screen.getByTestId('terminal-tideh-asof').textContent).toContain('1 session stored, Wed Nov 18.')
    expect(rows()).toHaveLength(1)
    expect(screen.getByTestId('terminal-tideh-one').textContent).toContain('Only one session is stored so far, so there is nothing to compare or sum yet.')
    expect(screen.queryByTestId('terminal-tideh-summary')).toBeNull()
    expect(screen.queryByTestId('terminal-tideh-missing')).toBeNull()
    expect(JSON.stringify(lastReport(setFreshness))).toContain('2026-11-18')
  })
})

describe('TIDEH the answer', () => {
  it('says how many sessions are stored, since which day, and the tape\'s own filters; the header is dated the newest session', async () => {
    serve({ [URL]: answer(FIVE) })
    const { setFreshness } = renderPanel()
    const asOf = await screen.findByTestId('terminal-tideh-asof')
    expect(asOf.textContent).toBe(`5 sessions stored since Thu Nov 12. ${FILTERS}`)
    expect(screen.getByTestId('terminal-tideh').getAttribute('data-state')).toBe('ok')
    const report = lastReport(setFreshness)
    expect(report.source).toBe(TIDE_HISTORY_SOURCE)
    expect(JSON.stringify(report)).toContain('2026-11-18')
  })

  it('each row: the day in words over its prints, then net call, net put and net as signed compact dollars', async () => {
    serve({ [URL]: answer(FIVE) })
    renderPanel()
    await screen.findByTestId('terminal-tideh-table')
    expect(rows().map((r) => r.getAttribute('data-session'))).toEqual(['2026-11-18', '2026-11-17', '2026-11-16', '2026-11-13', '2026-11-12'])
    const [day, call, put, net] = cells(rows()[0])
    expect(day.textContent).toBe('Wed Nov\u00a0182,040 prints')       // "Nov 18" never breaks apart in a narrow panel
    // each word sits in a box of one width for every row, so a narrow panel breaks every day or none
    const boxes = rows().map((r) => [...cells(r)[0].querySelectorAll('span')].slice(0, 2).map((s) => `${s.style.display} ${s.style.minWidth}`))
    expect(new Set(boxes.map(String)).size).toBe(1)
    expect(boxes[0]).toEqual(['inline-block 2.3em', 'inline-block 3.5em'])
    expect(day.className).toMatch(/phoneWrap/)
    expect(day.getAttribute('title')).toBe('Stored through 4:14 PM ET')
    expect(call.textContent).toBe('+$6.2M')
    expect(put.textContent).toBe('+$2.2M')
    expect(net.textContent).toBe('+$4.0M')
    expect(cells(rows()[1]).map((td) => td.textContent).slice(1)).toEqual(['+$1.5M', '+$3.5M', '-$2.0M'])
    expect(cells(rows()[3]).map((td) => td.textContent).slice(1)).toEqual(['-$400K', '-$1.4M', '+$1.0M'])
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Session', 'Net call', 'Net put', 'Net'])
  })

  it('green and red follow the sign of each number, and zero has neither', async () => {
    serve({ [URL]: answer(FIVE) })
    renderPanel()
    await screen.findByTestId('terminal-tideh-table')
    const cls = (td) => td.querySelector('span').className
    const [, call, put, net] = cells(rows()[1])            // +1.5M, +3.5M, -2.0M
    expect(cls(call)).toMatch(/up/)
    expect(cls(put)).toMatch(/up/)
    expect(cls(net)).toMatch(/down/)
    expect(cls(cells(rows()[3])[1])).toMatch(/down/)       // a negative net call is red
    expect(cls(cells(rows()[2])[3])).toBe('')              // a net of $0 has no colour
    expect(cells(rows()[2])[3].textContent).toBe('$0')
  })

  it('the bar grows from the middle: its length is the share of the largest net shown, its side the sign', async () => {
    serve({ [URL]: answer(FIVE) })
    renderPanel()
    await screen.findByTestId('terminal-tideh-table')
    const bar = (i) => within(rows()[i]).queryByTestId('terminal-tideh-bar')
    expect(bar(0).style.width).toBe('50%')                 // +4.0M is the largest: half the track, to the right
    expect(bar(0).getAttribute('data-dir')).toBe('up')
    expect(bar(1).style.width).toBe('25%')                 // -2.0M: half of that, to the left
    expect(bar(1).getAttribute('data-dir')).toBe('down')
    expect(bar(3).style.width).toBe('12.5%')
    expect(bar(4).style.width).toBe('6.3%')
    expect(bar(2)).toBeNull()                              // a net of $0 draws the track and no bar
    expect(rows()[2].querySelector('[aria-hidden="true"]')).toBeTruthy()
  })

  it('a figure the server did not send reads n/a with no colour and no bar, never $0', async () => {
    serve({ [URL]: answer([sess('2026-11-18', 5_000_000, 1_000_000, { net_premium: null, net_put_premium: null, prints_counted: null }), TUE]) })
    renderPanel()
    await screen.findByTestId('terminal-tideh-table')
    const [day, call, put, net] = cells(rows()[0])
    expect(day.textContent).toBe('Wed Nov\u00a018n/a')
    expect(call.textContent).toBe('+$5.0M')
    expect(put.textContent).toBe('n/a')
    expect(net.textContent).toBe('n/a')
    expect(net.querySelector('span').className).toBe('')
    expect(within(rows()[0]).queryByTestId('terminal-tideh-bar')).toBeNull()
    expect(within(rows()[1]).getByTestId('terminal-tideh-bar').style.width).toBe('50%')
  })

  it('sums the last five sessions and says how many the twenty needs', async () => {
    serve({ [URL]: answer(FIVE) })
    renderPanel()
    await screen.findByTestId('terminal-tideh-table')
    const five = screen.getByTestId('terminal-tideh-sum-5')
    expect(five.getAttribute('data-ok')).toBe('yes')
    expect(five.textContent).toBe('+$3.5M, Thu Nov 12 to Wed Nov 18')        // 4.0 - 2.0 + 0 + 1.0 + 0.5
    expect(five.querySelector('span').className).toMatch(/up/)
    expect(five.querySelector('span').textContent).toBe('+$3.5M')            // the colour is the figure's, not the dates'
    const twenty = screen.getByTestId('terminal-tideh-sum-20')
    expect(twenty.getAttribute('data-ok')).toBe('no')
    expect(twenty.textContent).toBe('Needs 20 stored sessions; 5 are stored.')
    expect(twenty.querySelector('span').className).toBe('')
    expect(screen.getByTestId('terminal-tideh-summary').textContent).toContain('Net, last 5 sessions')
  })

  it('a missing session is named in a note, is not a row, and refuses the sum it sits inside', async () => {
    serve({ [URL]: answer([WED, TUE, FRI, THU, sess('2026-11-11', 700_000, 200_000)], { missing_sessions: ['2026-11-16'] }) })
    renderPanel()
    await screen.findByTestId('terminal-tideh-table')
    expect(screen.getByTestId('terminal-tideh-missing').textContent).toBe('No tide was stored for Mon Nov 16. A day with no stored tide is left out, not drawn as zero.')
    expect(rows().map((r) => r.getAttribute('data-session'))).toEqual(['2026-11-18', '2026-11-17', '2026-11-13', '2026-11-12', '2026-11-11'])
    const tableText = screen.getByTestId('terminal-tideh-table').textContent.replace(/\u00a0/g, ' ')
    expect(tableText).toContain('Tue Nov 17')                                  // control: this reading can see a day
    expect(tableText).not.toContain('Mon Nov 16')
    const five = screen.getByTestId('terminal-tideh-sum-5')
    expect(five.getAttribute('data-ok')).toBe('no')
    expect(five.textContent).toBe('Not summed: no tide was stored for Mon Nov 16, inside these 5 sessions.')
  })

  it('a day that left unreadable prints out says how many under the day, and the note says what that means', async () => {
    const LEFT_OUT = 'Prints marked left out had no usable time, premium or call/put on the tape, so they are not in that day\u2019s figures.'
    serve({ [URL]: answer([{ ...WED, prints_unreadable: 3 }, { ...TUE, prints_unreadable: 0 }, MON]) })
    renderPanel()
    await screen.findByTestId('terminal-tideh-table')
    expect(screen.getAllByTestId('terminal-tideh-prints').map((el) => el.textContent)).toEqual(
      ['2,040 prints, 3 left out', '1,200 prints', '1,200 prints'])
    const piece = screen.getAllByTestId('terminal-tideh-prints')[0].querySelector('span')
    expect([piece.textContent, piece.style.display]).toEqual(['3 left out', 'inline-block'])     // wraps as one piece
    expect(screen.getByTestId('terminal-tideh-method').textContent).toContain(LEFT_OUT)
    cleanup()
    serve({ [URL]: answer(FIVE) })
    renderPanel()
    await screen.findByTestId('terminal-tideh-table')
    expect(document.body.textContent).not.toContain('left out')
  })

  it('says each session is stored once and not revised, that earlier days cannot be recovered, and calls no day bullish or bearish', async () => {
    serve({ [URL]: answer(FIVE) })
    renderPanel()
    await screen.findByTestId('terminal-tideh-table')
    const method = screen.getByTestId('terminal-tideh-method').textContent
    expect(method).toContain(STORED_NOTE)
    expect(method).toContain('Each bar is that day\'s share of the largest net among the rows shown.')
    expect(method).toContain('Green and red mark the sign of a number only; this panel does not call a day bullish or bearish.')
    expect(method).toContain('Each print is signed by its side.')
    expect(method).toContain('Source: UCT\'s options flow tape.')
    expect(document.body.textContent.match(/bullish|bearish/gi)).toHaveLength(2)        // that one sentence, nowhere else
    expect(within(screen.getByTestId('terminal-tideh-links')).getByRole('button', { name: 'Market Tide (TIDE)' })).toBeTruthy()
  })

  it('a failed re-read keeps the last answer on screen and says so', async () => {
    serve({ [URL]: answer(FIVE) })
    renderPanel()
    await screen.findByTestId('terminal-tideh-table')
    expect(screen.queryByTestId('terminal-tideh-stale-read')).toBeNull()
    serve({})
    await act(async () => { await revalidateAll() })
    const stale = await screen.findByTestId('terminal-tideh-stale-read')
    expect(stale.textContent).toBe('The Market Tide history could not be read just now. Showing the last read.')
    expect(rows()).toHaveLength(5)
  })
})

describe('TIDEH the cut', () => {
  it('draws 20 rows, says how many are stored, and shows the rest on request', async () => {
    serve({ [URL]: many(28) })
    renderPanel()
    await screen.findByTestId('terminal-tideh-table')
    expect(TIDE_ROWS_SHOWN).toBe(20)
    expect(rows()).toHaveLength(20)
    expect(rows()[0].getAttribute('data-session')).toBe('2026-11-18')
    const cut = screen.getByTestId('terminal-tideh-cut')
    expect(cut.textContent).toContain('Showing the newest 20 of 28 stored sessions.')
    // both sums are of stored sessions, on screen or not
    expect(screen.getByTestId('terminal-tideh-sum-20').getAttribute('data-ok')).toBe('yes')
    fireEvent.click(within(cut).getByRole('button', { name: 'Show 8 more' }))
    expect(rows()).toHaveLength(28)
    expect(screen.queryByTestId('terminal-tideh-cut')).toBeNull()
  })

  it('the bars are scaled to the rows on screen, and rescale when the rest is shown', async () => {
    const a = many(22)
    a.sessions[21] = { ...a.sessions[21], net_call_premium: 9_000_000, net_put_premium: 1_000_000, net_premium: 8_000_000 }
    a.sessions[0] = { ...a.sessions[0], net_call_premium: 2_400_000, net_put_premium: 400_000, net_premium: 2_000_000 }
    serve({ [URL]: a })
    renderPanel()
    await screen.findByTestId('terminal-tideh-table')
    const first = () => within(rows()[0]).getByTestId('terminal-tideh-bar').style.width
    expect(first()).toBe('50%')                            // the largest of the 20 on screen
    fireEvent.click(screen.getByTestId('terminal-tideh-more'))
    expect(first()).toBe('12.5%')                          // 2.0M of 8.0M once the older rows are drawn
  })

  it('20 or fewer rows carry no cut line; more stored than sent keeps the line and says the ceiling', async () => {
    serve({ [URL]: many(20) })
    renderPanel()
    await screen.findByTestId('terminal-tideh-table')
    expect(screen.queryByTestId('terminal-tideh-cut')).toBeNull()
    cleanup()
    serve({ [URL]: many(3, { sessions_stored: 900, history_began: '2023-04-03' }) })
    renderPanel()
    const cut = await screen.findByTestId('terminal-tideh-cut')
    expect(cut.textContent).toContain('Showing the newest 3 of 900 stored sessions; this panel reads at most 250.')
    expect(within(cut).queryByRole('button')).toBeNull()
    expect(screen.getByTestId('terminal-tideh-asof').textContent).toContain('900 sessions stored since Mon Apr 3.')
  })
})

describe('TIDEH scopes', () => {
  it('the chips ask the server for one scope and say which is pressed', async () => {
    serve({ [URL]: answer(FIVE), [ETFS]: answer([WED], { scope: 'etfs' }) })
    renderPanel()
    await screen.findByTestId('terminal-tideh-table')
    expect(screen.getByTestId('terminal-tideh-scope-all').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'ETFs' }))
    await screen.findByLabelText('Market Tide by day, ETFs and indexes only, newest session first')
    expect(rows()).toHaveLength(1)
    expect(screen.getByTestId('terminal-tideh-scope-etfs').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('terminal-tideh-scope-all').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('terminal-tideh').getAttribute('data-scope')).toBe('etfs')
    expect(asked()).toEqual([URL, ETFS])
  })

  it('a typed scope opens on that scope: TIDEH STOCKS', async () => {
    serve({ [STOCKS]: answer(FIVE, { scope: 'stocks' }) })
    renderPanel({ scope: 'stocks' })
    await screen.findByLabelText('Market Tide by day, stocks only, newest session first')
    expect(asked()).toEqual([STOCKS])
    expect(screen.getByTestId('terminal-tideh-scope-stocks').getAttribute('aria-pressed')).toBe('true')
  })

  it('a scope the panel does not know reads as all', async () => {
    serve({ [URL]: answer(FIVE) })
    renderPanel({ scope: 'bonds' })
    await screen.findByTestId('terminal-tideh-table')
    expect(asked()).toEqual([URL])
  })

  it('inside the terminal a chip writes the scope into the panel\'s own command', async () => {
    serve({ [URL]: answer(FIVE), [STOCKS]: answer(FIVE, { scope: 'stocks' }), [ETFS]: answer(FIVE, { scope: 'etfs' }) })
    const { rerun } = renderPanel({}, { code: 'TIDEH' })
    await screen.findByTestId('terminal-tideh-table')
    fireEvent.click(screen.getByRole('button', { name: 'ETFs' }))
    expect(rerun).toHaveBeenLastCalledWith('TIDEH ETFS')
    fireEvent.click(await screen.findByRole('button', { name: 'Stocks' }))
    expect(rerun).toHaveBeenLastCalledWith('TIDEH STOCKS')
    fireEvent.click(await screen.findByRole('button', { name: 'All' }))
    expect(rerun).toHaveBeenLastCalledWith('TIDEH')
    expect(rerun).toHaveBeenCalledTimes(3)
    fireEvent.click(await screen.findByRole('button', { name: 'All' }))     // the pressed chip is not a new command
    expect(rerun).toHaveBeenCalledTimes(3)
  })

  it('outside the terminal the chip still works and writes nothing', async () => {
    serve({ [URL]: answer(FIVE), [STOCKS]: answer([WED, TUE], { scope: 'stocks' }) })
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-tideh-table')
    fireEvent.click(screen.getByRole('button', { name: 'Stocks' }))
    await screen.findByLabelText('Market Tide by day, stocks only, newest session first')
    expect(rows()).toHaveLength(2)
    expect(rerun).not.toHaveBeenCalled()
  })

  it('a scope whose read fails is an error with Retry, never the last scope\'s rows under the new chip', async () => {
    serve({ [URL]: answer(FIVE) })
    renderPanel()
    await screen.findByTestId('terminal-tideh-table')
    fireEvent.click(screen.getByRole('button', { name: 'ETFs' }))
    const err = await screen.findByTestId('terminal-tideh-error')
    expect(err.textContent).toContain('The Market Tide history could not be read just now.')
    expect(screen.queryByTestId('terminal-tideh-table')).toBeNull()
    serve({ [ETFS]: answer([WED], { scope: 'etfs' }) })
    fireEvent.click(within(err).getByRole('button', { name: 'Retry' }))
    await screen.findByLabelText('Market Tide by day, ETFs and indexes only, newest session first')
    expect(rows()).toHaveLength(1)
  })

  it('a new command scope is a new read: one scope\'s rows are never drawn under another\'s chip', async () => {
    serve({ [URL]: answer(FIVE), [ETFS]: PENDING })
    const { rerender } = renderPanel()
    await screen.findByTestId('terminal-tideh-table')
    rerender({ scope: 'etfs' })
    expect(screen.getByTestId('terminal-tideh-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-tideh-table')).toBeNull()
    expect(asked()).toEqual([URL, ETFS])
  })
})

describe('TIDEH follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['TideHistoryPanel.jsx', 'tideHistoryModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('TIDEH accessibility', () => {
  it('the full panel, a missing session, the cut, one session and nothing stored pass axe (WCAG A and AA)', async () => {
    serve({ [URL]: answer(FIVE) })
    renderPanel({}, { code: 'TIDEH' })
    await screen.findByTestId('terminal-tideh-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: answer([WED, TUE, FRI], { missing_sessions: ['2026-11-16'] }) })
    renderPanel()
    await screen.findByTestId('terminal-tideh-missing')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: many(28) })
    renderPanel()
    await screen.findByTestId('terminal-tideh-cut')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: answer([WED]) })
    renderPanel()
    await screen.findByTestId('terminal-tideh-one')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: answer([]) })
    renderPanel()
    await screen.findByTestId('terminal-tideh-none')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: fail(404) })
    renderPanel()
    await screen.findByTestId('terminal-tideh-error')
    await expectNoAxeViolations(document.body.firstElementChild)
  })
})
