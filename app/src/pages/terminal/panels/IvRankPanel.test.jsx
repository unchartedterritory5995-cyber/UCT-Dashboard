// OSCR RICH / OSCR CHEAP: the highest and lowest IV rank across the options log. Rails:
//   * loading, a failed read (error with Retry), signed out, no paid plan, switched off, a timeout, and an answer of
//     the wrong shape: none is "no symbols";
//   * not built yet (when the next build is), the first build running, and a log with no session: answers, not errors;
//   * the list: one row a symbol through PanelSymbol, its rank and word, its ATM IV and the range it is ranked in, its
//     percentile, sessions and open interest; the counts of what was left out; the cut; the build and the log in words;
//   * the two ends switch in place outside the shell and write `OSCR RICH` / `OSCR CHEAP` back inside it; the chip back
//     to the screener writes `OSCR`; OSCR's own body takes the view word and the Screener page is unchanged;
//   * the data's own as-of in the header, no hard-coded color, axe.
// Every symbol and figure is invented; the answers are the route's real shape.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import IvRankPanel from './IvRankPanel'
import OptionsScreener from '../../screener/options/OptionsScreener'
import { IV_RANK_URL } from './ivRankModel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const r = (symbol, rank, over = {}) => ({
  symbol, atm_iv: 0.482, iv_rank: rank, iv_percentile: 96, rank_word: 'High', low: 0.21, high: 0.501, sessions: 35,
  atm_dte: 28, open_interest: 1_234_000, ...over,
})
const OK = {
  status: 'ok', session: '2026-11-20', built_at: '2026-11-21T01:45:12+00:00', next_run: '2026-11-21T20:45-05:00',
  logging_began: '2026-09-30', sessions_logged: 36, rankable_sessions: 35, legacy_sessions: ['2026-09-30'], unread_sessions: [],
  missing_sessions: ['2026-10-01'], rank_min_sessions: 20, rank_window: 252, max_per_side: 100,
  counts: { ranked: 3, below_min: 1022, flat: 0, not_in_latest: 0, latest_rows: 6034, latest_no_atm_iv: 156, symbols_logged: 5878 },
  high: [r('QRSX', 100), r('TUVX', 88, { rank_word: 'High', open_interest: null }), r('MNOX', 61, { rank_word: 'Elevated' })],
  low: [r('WXYX', 0, { rank_word: 'Very low', iv_percentile: 0, atm_iv: 0.183, low: 0.183, high: 0.44 }), r('MNOX', 61, { rank_word: 'Elevated' })],
  method: 'IV rank = where the latest session\'s ATM IV sits between its lowest and highest.',
  high_order: 'Highest IV rank first.', low_order: 'Lowest IV rank first.', building: false, last_run: { at: 'x', ok: true },
  source: 'UCT options log',
}
const CUT = { ...OK, counts: { ...OK.counts, ranked: 4812 } }

const fail = (status) => ({ ok: false, status, headers: { get: () => null }, json: async () => ({ detail: 'x' }) })
const answer = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body })
const PENDING = Symbol('pending')
function serve(routes) {
  globalThis.fetch.mockImplementation((url) => {
    const hit = routes[url]
    if (hit === undefined) return Promise.resolve(fail(500))
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
const asked = () => [...new Set(globalThis.fetch.mock.calls.map(([url]) => url))]

function renderEl(el, { code = null, rerun = vi.fn(), setFreshness = vi.fn(), publishRows = vi.fn() } = {}) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run: vi.fn(), rerun, publish: vi.fn(), publishRows }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{el}</TerminalPanelContext.Provider> : el}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { rerun, setFreshness, publishRows }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const tableRows = () => within(screen.getByTestId('terminal-ivrank-table')).getAllByRole('row').slice(1)
const lastReport = (setFreshness) => setFreshness.mock.calls.map(([x]) => x).filter(Boolean).pop()
const noDated = (setFreshness) => setFreshness.mock.calls.every(([x]) => x == null)

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('OSCR RICH / CHEAP states', () => {
  it('shows a loading skeleton and asks the one route', () => {
    serve({ [IV_RANK_URL]: PENDING })
    renderEl(<IvRankPanel />)
    expect(screen.getByTestId('terminal-ivrank-loading')).toBeTruthy()
    expect(asked()).toEqual([IV_RANK_URL])
  })

  it('a failed read is an error with Retry, never an empty list', async () => {
    serve({})
    const { setFreshness } = renderEl(<IvRankPanel />)
    const err = await screen.findByTestId('terminal-ivrank-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The IV rank list could not be read just now.')
    expect(err.textContent).toContain('That is not the same as an empty list.')
    expect(screen.queryByTestId('terminal-ivrank-table')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    serve({ [IV_RANK_URL]: answer(OK) })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-ivrank-table')).toBeTruthy()
  })

  it('signed out, a timeout, no paid plan and switched off each say so; only an error can be retried', async () => {
    for (const [hit, kind, words] of [
      [fail(401), 'error', 'You are signed out, so the IV rank list cannot be read. Sign in again.'],
      [Object.assign(new Error('late'), { timedOut: true }), 'error', 'The IV rank list did not answer within 30 seconds.'],
      [fail(402), 'locked', 'The IV rank list needs a paid plan.'],
      [fail(404), 'locked', 'The IV rank list is not switched on for this server yet.'],
    ]) {
      serve({ [IV_RANK_URL]: hit })
      renderEl(<IvRankPanel />)
      const box = await screen.findByTestId('terminal-ivrank-error')
      expect(box.getAttribute('data-kind'), words).toBe(kind)
      expect(box.textContent, words).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), words).toBe(kind === 'error')
      cleanup()
    }
  })

  it('an answer of another shape is an error with Retry', async () => {
    serve({ [IV_RANK_URL]: answer({ status: 'ok', high: 'x' }) })
    renderEl(<IvRankPanel />)
    expect((await screen.findByTestId('terminal-ivrank-error')).textContent).toContain('came back in a shape this panel cannot read')
  })

  it('not built yet says when the build is; while it runs it says so; nothing is built on opening', async () => {
    serve({ [IV_RANK_URL]: answer({ status: 'not_built', building: false, next_run: '2026-11-21T20:45-05:00', last_run: null }) })
    renderEl(<IvRankPanel />)
    const box = await screen.findByTestId('terminal-ivrank-not-built')
    expect(box.textContent).toContain('The IV rank list has not been built yet.')
    expect(box.textContent).toContain('the next build is Sat Nov 21, 8:45 PM ET.')
    expect(box.textContent).toContain('Nothing is built when you open the panel.')
    cleanup()
    serve({ [IV_RANK_URL]: answer({ status: 'not_built', building: true, next_run: null, last_run: null }) })
    renderEl(<IvRankPanel />)
    expect((await screen.findByTestId('terminal-ivrank-not-built')).textContent).toContain('The first evening build is running now.')
  })

  it('a log with no session is an answer', async () => {
    serve({ [IV_RANK_URL]: answer({ status: 'no_log', built_at: OK.built_at, counts: {}, high: [], low: [] }) })
    renderEl(<IvRankPanel />)
    expect((await screen.findByTestId('terminal-ivrank-no-log')).textContent).toContain('The options log held no session at the last build.')
  })

  it('an answered list with no ranked symbol says so with the counts, and keeps the method', async () => {
    serve({ [IV_RANK_URL]: answer({ ...OK, high: [], low: [], counts: { ...OK.counts, ranked: 0 } }) })
    renderEl(<IvRankPanel />)
    const box = await screen.findByTestId('terminal-ivrank-empty')
    expect(box.textContent).toContain('1,022 symbols have fewer than 20 logged sessions and are left out.')
    expect(screen.getByTestId('terminal-ivrank-method')).toBeTruthy()
  })
})

describe('OSCR RICH / CHEAP: the list', () => {
  it('the highest first: each row in words, the counts, the build, the log and the source; the header names the session', async () => {
    serve({ [IV_RANK_URL]: answer(OK) })
    const { setFreshness, publishRows } = renderEl(<IvRankPanel />, { code: 'OSCR' })
    await screen.findByTestId('terminal-ivrank-table')
    const rows = tableRows()
    expect(rows.map((tr) => tr.getAttribute('data-testid'))).toEqual(['terminal-ivrank-row-QRSX', 'terminal-ivrank-row-TUVX', 'terminal-ivrank-row-MNOX'])
    const cells = [...rows[0].querySelectorAll('td')].map((td) => td.textContent)
    expect(cells).toEqual(['1QRSX', '100High', '48.2%21.0% to 50.1%', '96', '35', '1.2M'])
    expect([...rows[1].querySelectorAll('td')].map((td) => td.textContent)[5]).toBe('not given')
    expect(screen.getByTestId('terminal-ivrank').getAttribute('data-side')).toBe('high')
    expect(screen.getByTestId('terminal-ivrank-side-high').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('terminal-ivrank-counts').textContent).toBe('3 symbols ranked on the Nov 20 session.')
    expect(screen.getByTestId('terminal-ivrank-left-out').textContent).toBe('1,022 symbols have fewer than 20 logged sessions and are left out. '
      + '156 of the 6,034 underlyings logged on Nov 20 had no ATM IV (no expiry 7 to 90 days out).')
    expect(screen.queryByTestId('terminal-ivrank-cut')).toBeNull()
    expect(screen.getByTestId('terminal-ivrank-built').textContent).toBe('From the end-of-day snapshot of Nov 20, built Fri Nov 20, 8:45 PM ET. The next build is Sat Nov 21, 8:45 PM ET.')
    const method = screen.getByTestId('terminal-ivrank-method').textContent
    expect(method).toContain('Highest IV rank first.')
    expect(method).toContain('Sep 30 was read under the first run\'s 20 to 45 day rule and is not counted.')
    expect(method).toContain('Source: the site\'s own options log, recorded once a trading day after the close (a snapshot, not a live chain).')
    expect(lastReport(setFreshness)).toMatchObject({ source: 'The site\'s own options log (end of day)', age: { asOfDate: '2026-11-20' } })
    // each symbol is a PanelSymbol and the rows are published for the board
    expect(within(rows[0]).getByRole('button', { name: /QRSX/ })).toBeTruthy()
    expect(publishRows).toHaveBeenCalled()
  })

  it('a cut list says how many were left off, from its own end', async () => {
    serve({ [IV_RANK_URL]: answer(CUT) })
    renderEl(<IvRankPanel side="low" />)
    await screen.findByTestId('terminal-ivrank-table')
    expect(screen.getByTestId('terminal-ivrank-cut').textContent).toBe('Showing the 2 lowest of 4,812; the rest are left off this list.')
  })

  it('outside the shell the two ends switch in place, and the chip back to the screener calls the host', async () => {
    serve({ [IV_RANK_URL]: answer(OK) })
    const onView = vi.fn()
    renderEl(<IvRankPanel onView={onView} />)
    await screen.findByTestId('terminal-ivrank-table')
    fireEvent.click(screen.getByTestId('terminal-ivrank-side-low'))
    expect(screen.getByTestId('terminal-ivrank').getAttribute('data-side')).toBe('low')
    expect(tableRows().map((tr) => tr.getAttribute('data-testid'))).toEqual(['terminal-ivrank-row-WXYX', 'terminal-ivrank-row-MNOX'])
    expect(screen.getByTestId('terminal-ivrank-method').textContent).toContain('Lowest IV rank first.')
    fireEvent.click(screen.getByTestId('terminal-ivrank-screener'))
    expect(onView).toHaveBeenCalledWith(null)
  })

  it('inside the shell each chip writes its command back: OSCR CHEAP, OSCR RICH and OSCR', async () => {
    serve({ [IV_RANK_URL]: answer(OK) })
    const { rerun } = renderEl(<IvRankPanel />, { code: 'OSCR' })
    await screen.findByTestId('terminal-ivrank-table')
    fireEvent.click(screen.getByTestId('terminal-ivrank-side-high'))
    expect(rerun).not.toHaveBeenCalled()                              // already showing: nothing to write
    fireEvent.click(screen.getByTestId('terminal-ivrank-side-low'))
    expect(rerun).toHaveBeenLastCalledWith('OSCR CHEAP')
    fireEvent.click(screen.getByTestId('terminal-ivrank-side-high'))
    expect(rerun).toHaveBeenLastCalledWith('OSCR RICH')
    fireEvent.click(screen.getByTestId('terminal-ivrank-screener'))
    expect(rerun).toHaveBeenLastCalledWith('OSCR')
  })

  it('OSCR\'s own body takes the view word; with none (the Screener page) it is the screener, unchanged', async () => {
    serve({ [IV_RANK_URL]: answer(OK) })
    renderEl(<OptionsScreener view="cheap" />)
    await screen.findByTestId('terminal-ivrank-table')
    expect(screen.getByTestId('terminal-ivrank').getAttribute('data-side')).toBe('low')
    fireEvent.click(screen.getByTestId('terminal-ivrank-screener'))  // outside the shell: back to the screener in place
    expect(await screen.findByTestId('options-screener')).toBeTruthy()
    cleanup()
    globalThis.fetch.mockClear()
    serve({})
    renderEl(<OptionsScreener />)
    expect(screen.getByTestId('options-screener')).toBeTruthy()
    expect(screen.queryByTestId('terminal-ivrank')).toBeNull()
    expect(asked()).not.toContain(IV_RANK_URL)
  })
})

describe('OSCR RICH / CHEAP follows the theme and is reachable', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['IvRankPanel.jsx', 'ivRankModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })

  it('the full list, the low end, not built and a failed read pass axe (WCAG A and AA)', async () => {
    serve({ [IV_RANK_URL]: answer(CUT) })
    renderEl(<IvRankPanel />, { code: 'OSCR' })
    await screen.findByTestId('terminal-ivrank-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [IV_RANK_URL]: answer(OK) })
    renderEl(<IvRankPanel side="low" />)
    await screen.findByTestId('terminal-ivrank-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [IV_RANK_URL]: answer({ status: 'not_built', building: false, next_run: OK.next_run }) })
    renderEl(<IvRankPanel />)
    await screen.findByTestId('terminal-ivrank-not-built')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({})
    renderEl(<IvRankPanel />)
    await screen.findByTestId('terminal-ivrank-error')
    await expectNoAxeViolations(document.body.firstElementChild)
  })
})
