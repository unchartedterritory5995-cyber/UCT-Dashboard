// IPO: the IPO calendar, day by day. Rails:
//   * loading, a failed read (error with Retry), signed out, no paid plan, a timeout, an answer that
//     is not a list, and an empty list the server LABELLED failed: none is "no IPOs";
//   * an answered, empty calendar is an answer, with the days asked for;
//   * the count line, the two tables (today and ahead soonest first, earlier newest first), each
//     day in words, each deal's price, shares, value and status, a missing field as "Not given";
//   * a symbol is a link only once its deal has priced and its day has come;
//   * 15 earlier deals, then the rest on request; rows that cannot be placed are counted in a note;
//   * the door to LEAD IPO, the source and read time in words, no polling, no hard-coded color; axe.
// Every company, symbol and figure is invented; the rows are the route's real shape.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../calendar/earningsModalRow', async (orig) => ({ ...(await orig()), todayIso: () => '2026-11-18' }))
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import IpoCalendarPanel, { IPO_CODE, IPO_EARLIER_SHOWN, IPO_SOURCE, ipoUrl } from './IpoCalendarPanel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const TODAY = '2026-11-18'
const URL = '/api/calendar/ipos?from=2026-11-09&to=2026-11-27'
const deal = (sym, date, over = {}) => ({
  sym, name: `${sym} Holdings Inc`, date, exchange: 'NASDAQ', price_range: '$18.00-$20.00', shares: 12_500_000, value: 237_500_000,
  status: 'expected', entity: { id: `ent-${sym}` }, ...over,
})
const WEEK = [
  deal('AAAQ', '2026-11-10', { status: 'priced', price_range: '$21.00', value: 262_500_000 }),
  deal('BBBQ', '2026-11-17', { status: 'priced', price_range: '9.50', shares: 4_000_000, value: 38_000_000, exchange: 'NYSE' }),
  deal('CCCQ', TODAY, { status: 'priced', price_range: '$14.00' }),
  deal('DDDQ', '2026-11-20'),
  { sym: null, name: 'Northwind Robotics', date: '2026-11-24', exchange: null, price_range: null, shares: null, value: null, status: null },
]

const fail = (status) => ({ ok: false, status, headers: { get: () => null }, json: async () => ({ detail: 'x' }) })
const answer = (body, label = null) => ({ ok: true, status: 200, headers: { get: (h) => (h === 'X-Calendar-Read' ? label : null) }, json: async () => body })
const PENDING = Symbol('pending')
/** Serves each URL its response (PENDING never answers); anything else is a 500. */
function serve(routes) {
  globalThis.fetch.mockImplementation((url) => {
    const hit = routes[url]
    if (hit === undefined) return Promise.resolve(fail(500))
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
const asked = () => [...new Set(globalThis.fetch.mock.calls.map(([url]) => url))]

function renderPanel({ open = vi.fn(), run = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run, rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}><IpoCalendarPanel /></TerminalPanelContext.Provider>
            : <IpoCalendarPanel />}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { open, run, setFreshness, container: view.container }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const rowsIn = (testId) => within(screen.getByTestId(testId)).getAllByTestId('terminal-ipo-row')
const cells = (tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)
const noDated = (setFreshness) => setFreshness.mock.calls.every(([report]) => report == null)
const lastReport = (setFreshness) => setFreshness.mock.calls.map(([r]) => r).filter(Boolean).pop()

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('IPO states', () => {
  it('shows a loading skeleton and asks the one route for last week to next week', () => {
    serve({ [URL]: PENDING })
    renderPanel()
    expect(IPO_CODE).toBe('IPO')
    expect(ipoUrl(TODAY)).toBe(URL)
    expect(screen.getByTestId('terminal-ipo-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-ipo')).toBeNull()
    expect(asked()).toEqual([URL])
  })

  it('a failed read (500) is an error with Retry, never "no IPOs"', async () => {
    serve({})
    const { setFreshness } = renderPanel({ code: 'IPO' })
    const err = await screen.findByTestId('terminal-ipo-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The IPO calendar could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no IPOs. Retry, or run IPO again.')
    expect(screen.queryByTestId('terminal-ipo-none')).toBeNull()
    expect(screen.queryByTestId('terminal-ipo-ahead')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    serve({ [URL]: answer(WEEK) })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-ipo-ahead')).toBeTruthy()
  })

  it('signed out, a timeout and no paid plan each say so; only an error can be retried', async () => {
    for (const [hit, kind, words] of [
      [fail(401), 'error', 'You are signed out, so the IPO calendar cannot be read. Sign in again.'],
      [Object.assign(new Error('late'), { timedOut: true }), 'error', 'The IPO calendar did not answer within 30 seconds.'],
      [fail(503), 'error', 'The IPO calendar could not be read just now.'],
      [fail(402), 'locked', 'The IPO calendar needs a paid plan.'],
    ]) {
      serve({ [URL]: hit })
      renderPanel()
      const box = await screen.findByTestId('terminal-ipo-error')
      expect(box.getAttribute('data-kind'), words).toBe(kind)
      expect(box.textContent, words).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), words).toBe(kind === 'error')
      cleanup()
    }
  })

  it('an empty list the server labelled failed is a failed read with Retry, never an empty calendar', async () => {
    serve({ [URL]: answer([], 'failed') })
    const { setFreshness } = renderPanel()
    const err = await screen.findByTestId('terminal-ipo-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The IPO calendar could not be read from either of its two sources just now.')
    expect(err.textContent).toContain('That is not the same as no IPOs.')
    expect(screen.queryByTestId('terminal-ipo-none')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    serve({ [URL]: answer([]) })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-ipo-none')).toBeTruthy()
  })

  it('an answer that is not a list is a failed read, never an empty calendar', async () => {
    serve({ [URL]: answer({ detail: 'nope' }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-ipo-error')).textContent).toContain('could not be read from either of its two sources')
    expect(screen.queryByTestId('terminal-ipo-none')).toBeNull()
  })

  it('an answered, empty calendar is an answer: it names the days and keeps the door and the source', async () => {
    serve({ [URL]: answer([]) })
    const { setFreshness } = renderPanel()
    const none = await screen.findByTestId('terminal-ipo-none')
    expect(none.getAttribute('data-kind')).toBe('empty')
    expect(none.getAttribute('role')).toBe('status')
    expect(none.textContent).toContain('No IPO is on the calendar, Mon Nov 9 to Fri Nov 27.')
    expect(none.textContent).toContain('That is an answer, not a failed read.')
    expect(screen.getByTestId('terminal-ipo').getAttribute('data-state')).toBe('none')
    expect(screen.getByTestId('terminal-ipo-links').textContent).toContain('New listings (LEAD IPO)')
    expect(screen.getByTestId('terminal-ipo-method')).toBeTruthy()
    expect(lastReport(setFreshness)).toMatchObject({ source: IPO_SOURCE })
  })
})

describe('IPO the answer', () => {
  it('counts the deals and the days asked for, and names the source alone in the header (the calendars are undated)', async () => {
    serve({ [URL]: answer(WEEK) })
    const { setFreshness } = renderPanel()
    expect((await screen.findByTestId('terminal-ipo-count')).textContent).toBe('5 IPOs on the calendar, Mon Nov 9 to Fri Nov 27: 3 today or ahead, 2 earlier.')
    expect(screen.getByTestId('terminal-ipo').getAttribute('data-state')).toBe('ok')
    const report = lastReport(setFreshness)
    expect(report.source).toBe('Finnhub and FMP IPO calendars')
    expect(report.observedAt).toBeUndefined()
  })

  it('today and ahead run soonest first, each day in words with today marked', async () => {
    serve({ [URL]: answer(WEEK) })
    renderPanel()
    const ahead = await screen.findByTestId('terminal-ipo-ahead')
    expect(ahead.getAttribute('aria-label')).toBe('IPOs today and ahead, soonest day first, 3 deals')
    expect([...ahead.querySelectorAll('th[scope="rowgroup"]')].map((th) => th.textContent)).toEqual(['Wed Nov 18 (today)', 'Fri Nov 20', 'Tue Nov 24'])
    expect([...ahead.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Company', 'Price', 'Shares', 'Value', 'Status'])
    const [c, d, n] = rowsIn('terminal-ipo-ahead')
    expect(cells(c)).toEqual(['CCCQ Holdings IncCCCQ, NASDAQ', '$14.00', '12.5M', '$237.5M', 'Priced'])
    expect(cells(d)).toEqual(['DDDQ Holdings IncDDDQ, NASDAQ', '$18.00 to $20.00', '12.5M', '$237.5M', 'Expected'])
    expect(d.getAttribute('data-status')).toBe('expected')
    // no symbol, no exchange, no price, no shares, no value, no status: words, never 0
    expect(cells(n)).toEqual(['Northwind Robotics', 'Not given', 'Not given', 'Not given', 'Not given'])
    expect(n.getAttribute('data-status')).toBe('none')
    expect(ahead.textContent).not.toMatch(/\$0|\b0\b/)
  })

  it('earlier deals run newest first', async () => {
    serve({ [URL]: answer(WEEK) })
    renderPanel()
    const earlier = await screen.findByTestId('terminal-ipo-earlier')
    expect(earlier.getAttribute('aria-label')).toBe('IPOs before today, newest day first, 2 deals')
    expect([...earlier.querySelectorAll('th[scope="rowgroup"]')].map((th) => th.textContent)).toEqual(['Tue Nov 17', 'Tue Nov 10'])
    expect(rowsIn('terminal-ipo-earlier').map((tr) => cells(tr))).toEqual([
      ['BBBQ Holdings IncBBBQ, NYSE', '$9.50', '4.0M', '$38.0M', 'Priced'],
      ['AAAQ Holdings IncAAAQ, NASDAQ', '$21.00', '12.5M', '$262.5M', 'Priced'],
    ])
    expect(screen.queryByTestId('terminal-ipo-more')).toBeNull()
  })

  it('a priced deal whose day has come loads its symbol; an expected one is plain text', async () => {
    serve({ [URL]: answer(WEEK) })
    const { run } = renderPanel({ code: 'IPO' })
    await screen.findByTestId('terminal-ipo-ahead')
    for (const sym of ['AAAQ', 'BBBQ', 'CCCQ']) expect(screen.getByTestId(`panel-symbol-${sym}`), sym).toBeTruthy()
    expect(screen.queryByTestId('panel-symbol-DDDQ')).toBeNull()              // expected: does not trade yet
    fireEvent.click(screen.getByTestId('panel-symbol-BBBQ'))
    expect(run).toHaveBeenCalledWith('$BBBQ')
  })

  it('a deal with a symbol and no name leads with the symbol', async () => {
    serve({ [URL]: answer([deal('EEEQ', TODAY, { name: null, exchange: null }), deal('FFFQ', '2026-11-19', { name: '', status: 'priced' })]) })
    renderPanel({ code: 'IPO' })
    const [e, f] = await screen.findAllByTestId('terminal-ipo-row')
    expect(cells(e)[0]).toBe('EEEQ')
    expect(cells(f)[0]).toBe('FFFQNASDAQ')                                    // the exchange sits on its own line under it
    expect(f.querySelector('td br')).toBeTruthy()
    expect(screen.queryByTestId('panel-symbol-FFFQ')).toBeNull()              // priced, but its day has not come
  })

  it('with nothing ahead it says so and still draws what came before', async () => {
    serve({ [URL]: answer([WEEK[0]]) })
    renderPanel()
    expect((await screen.findByTestId('terminal-ipo-ahead-none')).textContent).toBe('No deal is on the calendar for today or the days ahead.')
    expect(screen.queryByTestId('terminal-ipo-ahead')).toBeNull()
    expect(rowsIn('terminal-ipo-earlier')).toHaveLength(1)
  })

  it('opens the last year of listings on LEAD beside it, and says where the numbers come from and when it read them', async () => {
    serve({ [URL]: answer(WEEK) })
    const { open } = renderPanel({ code: 'IPO' })
    await screen.findByTestId('terminal-ipo-ahead')
    fireEvent.click(screen.getByTestId('panel-command-LEAD-IPO'))
    expect(open).toHaveBeenCalledWith('LEAD IPO')
    const method = screen.getByTestId('terminal-ipo-method').textContent
    expect(method).toContain('Source: the Finnhub and FMP IPO calendars, merged by the server.')
    expect(method).toContain('The calendars give no as-of time of their own.')
    expect(method).toMatch(/This panel read the server at \d{1,2}:\d{2} (AM|PM) ET\./)
    expect(method).toContain('The server keeps one answer for up to six hours.')
    expect(method).toContain('the answer does not say which')
    expect(method).toContain('reads Not given, never 0')
  })

  it('rows with no day or no name are counted in a note, not dropped in silence', async () => {
    serve({ [URL]: answer([...WEEK, { sym: 'NODAY', name: 'No Day Inc', date: null }, { sym: null, name: null, date: TODAY }]) })
    renderPanel()
    expect((await screen.findByTestId('terminal-ipo-dropped')).textContent).toBe('2 rows in the answer had no day or no name and are not shown.')
    cleanup()
    serve({ [URL]: answer([...WEEK, { sym: 'NODAY', name: 'No Day Inc', date: null }]) })
    renderPanel()
    expect((await screen.findByTestId('terminal-ipo-dropped')).textContent).toBe('1 row in the answer had no day or no name and is not shown.')
  })
})

describe('IPO the cut', () => {
  const many = Array.from({ length: 22 }, (_, i) => deal(`Q${String.fromCharCode(65 + i)}XQ`, i < 12 ? '2026-11-17' : '2026-11-12', { status: 'priced' }))

  it('draws 15 earlier deals, says how many there are, and shows the rest on request', async () => {
    serve({ [URL]: answer(many) })
    renderPanel()
    await screen.findByTestId('terminal-ipo-earlier')
    expect(IPO_EARLIER_SHOWN).toBe(15)
    expect(rowsIn('terminal-ipo-earlier')).toHaveLength(15)
    const more = screen.getByTestId('terminal-ipo-more')
    expect(more.textContent).toBe('Show all 22')
    expect(more.getAttribute('aria-pressed')).toBe('false')
    expect(more.parentElement.textContent).toContain('Showing 15 of 22 earlier deals.')
    fireEvent.click(more)
    expect(rowsIn('terminal-ipo-earlier')).toHaveLength(22)
    expect(screen.getByTestId('terminal-ipo-more').textContent).toBe('Show 15')
    expect(screen.getByTestId('terminal-ipo-more').getAttribute('aria-pressed')).toBe('true')
  })
})

describe('IPO reads once and follows the member\'s theme', () => {
  it('the reader holds no polling interval, and its key is not the bare URL the Calendar page caches under', () => {
    const src = fs.readFileSync(path.join(HERE, 'calendarEventsRead.js'), 'utf8')
    expect(src).not.toMatch(/refreshInterval\s*:/)
    expect(src).toContain("[url, 'terminal-calendar-events']")
  })

  it('the panel, its model and its reader hold no hard-coded color', () => {
    for (const f of ['IpoCalendarPanel.jsx', 'ipoCalendarModel.js', 'calendarEventsRead.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('IPO accessibility', () => {
  it('the full panel, the cut, an empty calendar and a failed read pass axe (WCAG A and AA)', async () => {
    serve({ [URL]: answer(WEEK) })
    renderPanel({ code: 'IPO' })
    await screen.findByTestId('terminal-ipo-ahead')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: answer(Array.from({ length: 20 }, (_, i) => deal(`R${String.fromCharCode(65 + i)}XQ`, '2026-11-12'))) })
    renderPanel()
    await screen.findByTestId('terminal-ipo-more')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: answer([]) })
    renderPanel()
    await screen.findByTestId('terminal-ipo-none')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: answer([], 'failed') })
    renderPanel()
    await screen.findByTestId('terminal-ipo-error')
    await expectNoAxeViolations(document.body.firstElementChild)
  })
})
