// DVD: declared dividends and splits ahead. `DVD` = the member's own stocks, `NVDA DVD` = one stock. Rails:
//   * loading, a failed read (error with Retry), signed out, no paid plan (402, locked, no Retry), a
//     timeout, an answer that is not a list, and an empty list the server LABELLED failed: none is
//     "no dividends";
//   * an answered, empty list is an answer, worded for one stock or for the member's own stocks;
//   * rows the server labelled partial are drawn with a note that some stocks could not be read;
//   * the count line, the week blocks (this week, next week, later), each day in words, each event
//     and its detail, a missing amount or ratio in words and never $0;
//   * every symbol loads through the kit; one stock's view opens CACT beside for its history;
//   * a new symbol is a new read; rows that cannot be placed are counted in a note;
//   * the source and read time in words, no hard-coded color; axe.
// Every symbol, date and amount is invented; the rows are the route's real shape.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../calendar/earningsModalRow', async (orig) => ({ ...(await orig()), todayIso: () => '2026-11-18' }))
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import DividendCalendarPanel, { DVD_CODE, DVD_SOURCE, dvdUrl } from './DividendCalendarPanel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const TODAY = '2026-11-18'
const MINE = '/api/calendar/dividends'
const ONE = '/api/calendar/dividends?syms=NVDA'
const div = (sym, date, amount = 0.25) => ({ sym, type: 'dividend', date, amount, source: 'massive', entity: { id: `ent-${sym}` } })
const split = (sym, date, ratio = '4:1') => ({ sym, type: 'split', date, ratio, source: 'massive', entity: { id: `ent-${sym}` } })
const BOOK = [
  div('MSFT', TODAY, 0.83), div('KO', '2026-11-20', 0.51), div('AAPL', '2026-11-20', 0.26),
  split('NVDA', '2026-11-24', '10:1'), div('PEP', '2027-01-08', 1.4225), split('XYZQ', '2026-12-03', '1:10'),
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

function tree(props, { open, run, setFreshness, code }) {
  const panel = <DividendCalendarPanel {...props} />
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run, rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{panel}</TerminalPanelContext.Provider> : panel}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>
  )
}
function renderPanel(props = {}, { open = vi.fn(), run = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const ctx = { open, run, setFreshness, code }
  const view = render(tree(props, ctx))
  return { ...ctx, rerender: (next) => view.rerender(tree(next, ctx)) }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const rowsIn = (testId) => within(screen.getByTestId(testId)).getAllByTestId('terminal-dvd-row')
const cells = (tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)
const days = (testId) => [...screen.getByTestId(testId).querySelectorAll('th[scope="rowgroup"]')].map((th) => th.textContent)
const noDated = (setFreshness) => setFreshness.mock.calls.every(([report]) => report == null)
const lastReport = (setFreshness) => setFreshness.mock.calls.map(([r]) => r).filter(Boolean).pop()

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('DVD states', () => {
  it('shows a loading skeleton and reads the member\'s own stocks when no symbol is loaded', () => {
    serve({ [MINE]: PENDING })
    renderPanel()
    expect(DVD_CODE).toBe('DVD')
    expect(dvdUrl(null)).toBe(MINE)
    expect(screen.getByTestId('terminal-dvd-loading').textContent).toContain('Loading the dividend calendar for your stocks')
    expect(screen.queryByTestId('terminal-dvd')).toBeNull()
    expect(asked()).toEqual([MINE])
  })

  it('with a symbol loaded it reads that one stock, in capitals', () => {
    serve({ [ONE]: PENDING })
    renderPanel({ sym: ' nvda ' })
    expect(asked()).toEqual([ONE])
  })

  it('a failed read (500) is an error with Retry, never "no dividends"', async () => {
    serve({})
    const { setFreshness } = renderPanel({}, { code: 'DVD' })
    const err = await screen.findByTestId('terminal-dvd-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The dividend calendar could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no dividends. Retry, or run DVD again.')
    expect(screen.queryByTestId('terminal-dvd-none')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    serve({ [MINE]: answer(BOOK) })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-dvd-this')).toBeTruthy()
  })

  it('a failed read for one stock names the command to run again', async () => {
    serve({})
    renderPanel({ sym: 'NVDA' }, { code: 'DVD' })
    expect((await screen.findByTestId('terminal-dvd-error')).textContent).toContain('Retry, or run NVDA DVD again.')
  })

  it('no paid plan is locked with no Retry; signed out and a timeout say so and can be retried', async () => {
    for (const [hit, kind, words] of [
      [fail(402), 'locked', 'The dividend calendar needs a paid plan.'],
      [fail(401), 'error', 'You are signed out, so the dividend calendar cannot be read. Sign in again.'],
      [Object.assign(new Error('late'), { timedOut: true }), 'error', 'The dividend calendar did not answer within 30 seconds.'],
    ]) {
      serve({ [MINE]: hit })
      renderPanel()
      const box = await screen.findByTestId('terminal-dvd-error')
      expect(box.getAttribute('data-kind'), words).toBe(kind)
      expect(box.textContent, words).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), words).toBe(kind === 'error')
      if (kind === 'locked') expect(box.textContent).not.toContain('not the same as no dividends')
      cleanup()
    }
  })

  it('an empty list the server labelled failed is a failed read with Retry, never an empty calendar', async () => {
    serve({ [MINE]: answer([], 'failed') })
    const { setFreshness } = renderPanel()
    const err = await screen.findByTestId('terminal-dvd-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The dividend calendar could not be read from the data vendor just now.')
    expect(err.textContent).toContain('That is not the same as no dividends.')
    expect(screen.queryByTestId('terminal-dvd-none')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    serve({ [MINE]: answer([]) })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-dvd-none')).toBeTruthy()
  })

  it('an answer that is not a list is a failed read', async () => {
    serve({ [MINE]: answer({ detail: 'nope' }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-dvd-error')).textContent).toContain('could not be read from the data vendor')
    expect(screen.queryByTestId('terminal-dvd-none')).toBeNull()
  })

  it('an answered, empty list for the member\'s own stocks is an answer and says why it may be empty', async () => {
    serve({ [MINE]: answer([]) })
    const { setFreshness } = renderPanel()
    const none = await screen.findByTestId('terminal-dvd-none')
    expect(none.getAttribute('data-kind')).toBe('empty')
    expect(none.getAttribute('role')).toBe('status')
    expect(none.textContent).toContain('No dividend or split is declared ahead for your stocks.')
    expect(none.textContent).toContain('If your My Stocks set is empty, this list is empty for that reason.')
    expect(screen.getByTestId('terminal-dvd').getAttribute('data-state')).toBe('none')
    expect(screen.getByTestId('terminal-dvd-method')).toBeTruthy()
    expect(lastReport(setFreshness)).toMatchObject({ source: DVD_SOURCE })
  })

  it('an answered, empty list for one stock is not "pays no dividend", and still opens its history', async () => {
    serve({ [ONE]: answer([]) })
    const { open } = renderPanel({ sym: 'NVDA' }, { code: 'DVD' })
    const none = await screen.findByTestId('terminal-dvd-none')
    expect(none.textContent).toContain('No dividend or split is declared ahead for NVDA.')
    expect(none.textContent).toContain('Only declared, future events are listed, so this is not the same as NVDA paying no dividend.')
    fireEvent.click(screen.getByTestId('panel-command-NVDA-CACT'))
    expect(open).toHaveBeenCalledWith('NVDA CACT')
  })
})

describe('DVD the answer', () => {
  it('counts the events and names the source alone in the header (the feed is undated)', async () => {
    serve({ [MINE]: answer(BOOK) })
    const { setFreshness } = renderPanel()
    expect((await screen.findByTestId('terminal-dvd-count')).textContent).toBe('4 ex-dividend dates and 2 splits ahead for your stocks.')
    expect(screen.getByTestId('terminal-dvd').getAttribute('data-state')).toBe('ok')
    expect(screen.getByTestId('terminal-dvd').getAttribute('data-sym')).toBe('')
    const report = lastReport(setFreshness)
    expect(report.source).toBe('Massive reference data')
    expect(report.observedAt).toBeUndefined()
  })

  it('draws this week, next week and later, each by day, soonest first, with today marked and another year named', async () => {
    serve({ [MINE]: answer(BOOK) })
    renderPanel()
    const thisWeek = await screen.findByTestId('terminal-dvd-this')
    expect(thisWeek.getAttribute('aria-label')).toBe('This week: dividends and splits for your stocks, soonest day first, 3 events')
    expect(thisWeek.querySelector('caption').textContent).toBe('This week')
    expect([...thisWeek.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Symbol', 'Event', 'Detail'])
    expect(days('terminal-dvd-this')).toEqual(['Wed Nov 18 (today)', 'Fri Nov 20'])
    expect(rowsIn('terminal-dvd-this').map(cells)).toEqual([
      ['MSFT', 'Ex-dividend', '$0.83 a share'], ['AAPL', 'Ex-dividend', '$0.26 a share'], ['KO', 'Ex-dividend', '$0.51 a share'],
    ])
    expect(days('terminal-dvd-next')).toEqual(['Tue Nov 24'])
    expect(rowsIn('terminal-dvd-next').map(cells)).toEqual([['NVDA', 'Split', '10 for 1']])
    expect(rowsIn('terminal-dvd-next')[0].getAttribute('data-type')).toBe('split')
    expect(days('terminal-dvd-later')).toEqual(['Thu Dec 3', 'Fri Jan 8, 2027'])
    expect(rowsIn('terminal-dvd-later').map(cells)).toEqual([
      ['XYZQ', 'Split', '1 for 10 (reverse split)'], ['PEP', 'Ex-dividend', '$1.4225 a share'],
    ])
  })

  it('only the blocks with events are drawn', async () => {
    serve({ [MINE]: answer([div('PEP', '2027-01-08', 1.4)]) })
    renderPanel()
    await screen.findByTestId('terminal-dvd-later')
    expect(screen.queryByTestId('terminal-dvd-this')).toBeNull()
    expect(screen.queryByTestId('terminal-dvd-next')).toBeNull()
  })

  it('a missing amount or ratio is said in words, never $0', async () => {
    serve({ [MINE]: answer([div('KO', TODAY, null), div('PEP', TODAY, 0), split('NVDA', TODAY, null)]) })
    renderPanel()
    await screen.findByTestId('terminal-dvd-this')
    expect(rowsIn('terminal-dvd-this').map(cells)).toEqual([
      ['KO', 'Ex-dividend', 'Amount not given'], ['NVDA', 'Split', 'Ratio not given'], ['PEP', 'Ex-dividend', 'Amount not given'],
    ])
    expect(screen.getByTestId('terminal-dvd-this').textContent).not.toMatch(/\$0(\.00)?\b/)
  })

  it('every symbol loads through the kit', async () => {
    serve({ [MINE]: answer(BOOK) })
    const { run } = renderPanel({}, { code: 'DVD' })
    await screen.findByTestId('terminal-dvd-this')
    for (const sym of ['MSFT', 'KO', 'AAPL', 'NVDA', 'PEP', 'XYZQ']) expect(screen.getByTestId(`panel-symbol-${sym}`), sym).toBeTruthy()
    fireEvent.click(screen.getByTestId('panel-symbol-KO'))
    expect(run).toHaveBeenCalledWith('$KO')
  })

  it('rows the server labelled partial are drawn with a note and a re-read', async () => {
    serve({ [MINE]: answer([div('KO', TODAY)], 'partial') })
    renderPanel()
    const note = await screen.findByTestId('terminal-dvd-partial')
    expect(note.textContent).toContain('Some stocks could not be read from the data vendor just now, so this list may be missing events. That is not the same as none.')
    expect(rowsIn('terminal-dvd-this')).toHaveLength(1)
    serve({ [MINE]: answer([div('KO', TODAY), div('PEP', TODAY)]) })
    fireEvent.click(within(note).getByRole('button', { name: 'Read it again' }))
    expect(await screen.findByText('2 ex-dividend dates ahead for your stocks.')).toBeTruthy()
    expect(screen.queryByTestId('terminal-dvd-partial')).toBeNull()
  })

  it('rows labelled failed are still drawn, with the same note', async () => {
    serve({ [MINE]: answer([div('KO', TODAY)], 'failed') })
    renderPanel()
    expect(await screen.findByTestId('terminal-dvd-partial')).toBeTruthy()
    expect(rowsIn('terminal-dvd-this')).toHaveLength(1)
  })

  it('an empty list the server labelled partial says some stocks could not be read, beside the empty answer', async () => {
    serve({ [MINE]: answer([], 'partial') })
    renderPanel()
    expect((await screen.findByTestId('terminal-dvd-partial')).textContent).toContain('That is not the same as none.')
    expect(screen.getByTestId('terminal-dvd').getAttribute('data-state')).toBe('none')
    expect(screen.getByTestId('terminal-dvd-none')).toBeTruthy()
    serve({ [MINE]: answer([]) })
    fireEvent.click(within(screen.getByTestId('terminal-dvd-partial')).getByRole('button', { name: 'Read it again' }))
    await waitFor(() => expect(screen.queryByTestId('terminal-dvd-partial')).toBeNull())
    expect(screen.getByTestId('terminal-dvd-none')).toBeTruthy()
  })

  it('a re-read that fails keeps the last answer and says so', async () => {
    serve({ [MINE]: answer([div('KO', TODAY)], 'partial') })
    renderPanel()
    const note = await screen.findByTestId('terminal-dvd-partial')
    serve({})
    fireEvent.click(within(note).getByRole('button', { name: 'Read it again' }))
    expect((await screen.findByTestId('terminal-dvd-stale-read')).textContent).toBe('The dividend calendar could not be read just now. Showing the last read.')
    expect(rowsIn('terminal-dvd-this')).toHaveLength(1)
  })

  it('rows with no day, no symbol or an unknown kind are counted in a note', async () => {
    serve({ [MINE]: answer([div('KO', TODAY), { sym: 'X', type: 'dividend', date: null }, { sym: 'Y', type: 'earnings', date: TODAY }]) })
    renderPanel()
    expect((await screen.findByTestId('terminal-dvd-dropped')).textContent).toBe('2 rows in the answer had no day, no symbol or an unknown kind and are not shown.')
    cleanup()
    serve({ [MINE]: answer([div('KO', TODAY), { sym: 'X', type: 'dividend', date: null }]) })
    renderPanel()
    expect((await screen.findByTestId('terminal-dvd-dropped')).textContent).toBe('1 row in the answer had no day, no symbol or an unknown kind and is not shown.')
  })
})

describe('DVD one stock, and the doors', () => {
  it('one stock: its own count line, its symbol on the panel, and CACT opens beside for the past', async () => {
    serve({ [ONE]: answer([div('NVDA', '2026-12-03', 0.01), split('NVDA', '2026-11-24', '10:1')]) })
    const { open } = renderPanel({ sym: 'NVDA' }, { code: 'DVD' })
    expect((await screen.findByTestId('terminal-dvd-count')).textContent).toBe('1 ex-dividend date and 1 split ahead for NVDA.')
    expect(screen.getByTestId('terminal-dvd').getAttribute('data-sym')).toBe('NVDA')
    expect(screen.getByTestId('terminal-dvd-next').getAttribute('aria-label')).toBe('Next week: dividends and splits for NVDA, soonest day first, 1 events')
    const links = screen.getByTestId('terminal-dvd-links')
    expect(links.textContent).toContain('This list holds declared, future events only. Past dividends and splits for NVDA:')
    fireEvent.click(screen.getByTestId('panel-command-NVDA-CACT'))
    expect(open).toHaveBeenCalledWith('NVDA CACT')
    expect(screen.getByTestId('terminal-dvd-method').textContent).not.toContain('My Stocks')
  })

  it('own stocks: says how to ask for one stock and where the past is, and whose stocks these are', async () => {
    serve({ [MINE]: answer(BOOK) })
    renderPanel()
    await screen.findByTestId('terminal-dvd-this')
    const links = screen.getByTestId('terminal-dvd-links')
    expect([...links.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['NVDA DVD', 'NVDA CACT'])
    const method = screen.getByTestId('terminal-dvd-method').textContent
    expect(method).toContain('Source: Massive reference data, read by the server.')
    expect(method).toContain('One dividend is listed per stock, its next declared ex-date')
    expect(method).toContain("Your stocks are the Calendar page's My Stocks set; at most 200 are read.")
    expect(method).toContain('The feed gives no as-of time of its own.')
    expect(method).toMatch(/This panel read the server at \d{1,2}:\d{2} (AM|PM) ET\./)
    expect(method).toContain('The server keeps an answer for up to 12 hours.')
  })

  it('a new symbol is a new read: one stock\'s events are never drawn under another\'s name', async () => {
    serve({ [ONE]: answer([div('NVDA', TODAY, 0.01)]), '/api/calendar/dividends?syms=KO': PENDING })
    const view = renderPanel({ sym: 'NVDA' })
    await screen.findByTestId('terminal-dvd-this')
    view.rerender({ sym: 'KO' })
    expect(screen.getByTestId('terminal-dvd-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-dvd-row')).toBeNull()
    expect(asked()).toEqual([ONE, '/api/calendar/dividends?syms=KO'])
  })
})

describe('DVD follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['DividendCalendarPanel.jsx', 'dividendCalendarModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('DVD accessibility', () => {
  it('the full list, one stock, a partial read, an empty list and a failed read pass axe (WCAG A and AA)', async () => {
    serve({ [MINE]: answer(BOOK) })
    renderPanel({}, { code: 'DVD' })
    await screen.findByTestId('terminal-dvd-this')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [ONE]: answer([div('NVDA', TODAY, 0.01)], 'partial') })
    renderPanel({ sym: 'NVDA' }, { code: 'DVD' })
    await screen.findByTestId('terminal-dvd-partial')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [MINE]: answer([]) })
    renderPanel()
    await screen.findByTestId('terminal-dvd-none')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [MINE]: fail(402) })
    renderPanel()
    await screen.findByTestId('terminal-dvd-error')
    await expectNoAxeViolations(document.body.firstElementChild)
  })
})
