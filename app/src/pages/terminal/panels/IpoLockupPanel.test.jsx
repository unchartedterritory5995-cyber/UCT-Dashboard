// IPO LOCKUP: the IPO lockups ending in the next 30 days and the past 7. Rails:
//   * loading, a failed read (error with Retry), signed out, no paid plan, a timeout, a failed build and an answer of
//     the wrong shape: none is "no lockups";
//   * computing and warming say the server is working it out (no error, no empty list);
//   * an answered window with no lockup is an answer, and still says every date would be an estimate;
//   * the list: the past days apart from today and ahead, soonest first; each row's stock through PanelSymbol, its
//     company where held, its listing date, the estimated expiry with the days to go and "estimated" on EVERY row
//     (and the full sentence for a screen reader), the change since listing or why there is none;
//   * the header says the basis of every date; the chip back to the calendar writes `IPO`; IPO's own body takes the
//     view word and the calendar is unchanged without it;
//   * the data's own as-of, no hard-coded color, axe.
// Every symbol, name, date and price is invented; the answers are the route's real shape.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../calendar/earningsModalRow', async (orig) => ({ ...(await orig()), todayIso: () => '2026-11-20' }))
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import IpoLockupPanel from './IpoLockupPanel'
import IpoCalendarPanel from './IpoCalendarPanel'
import { IPO_LOCKUP_URL } from './ipoLockupModel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const BASIS = 'estimated: 180 days after listing; the prospectus sets the actual date'
const row = (symbol, expiry, days, over = {}) => ({
  symbol, company: `${symbol} Holdings Inc`, listing_date: '2026-05-28', listing_source: 'first_bar',
  listing_source_words: "its first daily bar in the site's bar store", estimated_expiry: expiry, days_to_go: days,
  basis: 'estimated', basis_words: BASIS,
  change_since_listing: { pct: 25.0, first_close: 20.0, first_date: '2026-05-28', last_close: 25.0, last_date: '2026-11-19', reason: null },
  ...over,
})
const OK = {
  status: 'ok', today: '2026-11-20', lockup_days: 180, basis: 'estimated', basis_words: BASIS, built_at: '2026-11-20T15:00:00+00:00',
  listings_as_of: '2026-11-20T09:58:00-05:00', window: { behind_days: 7, ahead_days: 30, from: '2026-11-13', to: '2026-12-20' },
  counts: { listings: 412, with_listing_date: 410, without_listing_date: 2, in_window: 3, by_source: { first_bar: 2, reference: 1 } },
  rows: [
    row('AQXA', '2026-11-24', 4),
    row('BQXB', '2026-11-16', -4, { company: null, listing_date: '2026-05-20', change_since_listing: { pct: null, first_date: '2026-06-02', reason: 'no_first_day' } }),
    row('GQXG', '2026-11-27', 7, { change_since_listing: { pct: -12.5, first_close: 40, first_date: '2026-05-30', last_close: 35, last_date: '2026-11-19' } }),
  ],
}
const CAL_URL = '/api/calendar/ipos?from=2026-11-09&to=2026-11-27'

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
const bodyRows = () => within(screen.getByTestId('terminal-ipo-lockup-table')).getAllByRole('row').filter((tr) => tr.getAttribute('data-testid'))
const lastReport = (setFreshness) => setFreshness.mock.calls.map(([x]) => x).filter(Boolean).pop()
const noDated = (setFreshness) => setFreshness.mock.calls.every(([x]) => x == null)

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('IPO LOCKUP states', () => {
  it('shows a loading skeleton and asks the one route', () => {
    serve({ [IPO_LOCKUP_URL]: PENDING })
    renderEl(<IpoLockupPanel />)
    expect(screen.getByTestId('terminal-ipo-lockup-loading')).toBeTruthy()
    expect(asked()).toEqual([IPO_LOCKUP_URL])
  })

  it('a failed read is an error with Retry, never "no lockups"', async () => {
    serve({})
    const { setFreshness } = renderEl(<IpoLockupPanel />)
    const err = await screen.findByTestId('terminal-ipo-lockup-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The IPO lockup list could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no lockups ending.')
    expect(screen.queryByTestId('terminal-ipo-lockup-none')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    serve({ [IPO_LOCKUP_URL]: answer(OK) })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-ipo-lockup-table')).toBeTruthy()
  })

  it('signed out, a timeout and no paid plan each say so; only an error can be retried', async () => {
    for (const [hit, kind, words] of [
      [fail(401), 'error', 'You are signed out, so the IPO lockup list cannot be read. Sign in again.'],
      [Object.assign(new Error('late'), { timedOut: true }), 'error', 'The IPO lockup list did not answer within 30 seconds.'],
      [fail(402), 'locked', 'The IPO lockup list needs a paid plan.'],
    ]) {
      serve({ [IPO_LOCKUP_URL]: hit })
      renderEl(<IpoLockupPanel />)
      const box = await screen.findByTestId('terminal-ipo-lockup-error')
      expect(box.getAttribute('data-kind'), words).toBe(kind)
      expect(box.textContent, words).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), words).toBe(kind === 'error')
      cleanup()
    }
  })

  it('a failed build and an answer of another shape are errors with Retry', async () => {
    for (const body of [{ status: 'failed', reason: 'error' }, { status: 'ok', rows: 'x' }]) {
      serve({ [IPO_LOCKUP_URL]: answer(body) })
      renderEl(<IpoLockupPanel />)
      const box = await screen.findByTestId('terminal-ipo-lockup-error')
      expect(box.textContent).toContain('The IPO lockup list could not be worked out just now.')
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
      cleanup()
    }
  })

  it('computing and warming say the server is working it out, never an empty list', async () => {
    serve({ [IPO_LOCKUP_URL]: answer({ status: 'computing' }) })
    renderEl(<IpoLockupPanel />)
    expect((await screen.findByTestId('terminal-ipo-lockup-busy')).textContent).toContain('Working out the lockups from the listings the site holds.')
    cleanup()
    serve({ [IPO_LOCKUP_URL]: answer({ status: 'warming', rows: [] }) })
    renderEl(<IpoLockupPanel />)
    expect((await screen.findByTestId('terminal-ipo-lockup-busy')).textContent).toContain('has not been read since the server started')
  })

  it('an answered window with no lockup is an answer that still names the basis', async () => {
    serve({ [IPO_LOCKUP_URL]: answer({ ...OK, rows: [], counts: { ...OK.counts, in_window: 0, by_source: {} } }) })
    renderEl(<IpoLockupPanel />)
    const box = await screen.findByTestId('terminal-ipo-lockup-none')
    expect(box.textContent).toContain('No estimated lockup expiry falls from Fri Nov 13 to Sun Dec 20.')
    expect(box.textContent).toContain(`Every date would be ${BASIS}.`)
    expect(screen.getByTestId('terminal-ipo-lockup-read').textContent).toContain('410 have a listing date')
  })
})

describe('IPO LOCKUP: the list', () => {
  it('the past apart from today and ahead, soonest first; every row says it is an estimate', async () => {
    serve({ [IPO_LOCKUP_URL]: answer(OK) })
    const { setFreshness, publishRows } = renderEl(<IpoLockupPanel />, { code: 'IPO' })
    await screen.findByTestId('terminal-ipo-lockup-table')
    expect(screen.getByTestId('terminal-ipo-lockup-count').textContent).toBe('3 estimated lockup expiries from Fri Nov 13 to Sun Dec 20: 2 today or ahead, 1 in the past 7 days.')
    expect(screen.getByTestId('terminal-ipo-lockup-basis').textContent).toBe(`Every date is ${BASIS}.`)
    const groups = [...screen.getByTestId('terminal-ipo-lockup-table').querySelectorAll('th[scope="rowgroup"]')].map((th) => th.textContent)
    expect(groups).toEqual(['Ended in the past 7 days', 'Today and the next 30 days'])
    const rows = bodyRows()
    expect(rows.map((tr) => tr.getAttribute('data-testid'))).toEqual(['terminal-ipo-lockup-row-BQXB', 'terminal-ipo-lockup-row-AQXA', 'terminal-ipo-lockup-row-GQXG'])
    for (const tr of rows) {
      expect(tr.getAttribute('data-basis')).toBe('estimated')
      const sym = tr.getAttribute('data-testid').split('-').pop()
      expect(screen.getByTestId(`terminal-ipo-lockup-basis-${sym}`).textContent).toBe(BASIS)
    }
    const cells = [...rows[1].querySelectorAll('td')].map((td) => td.textContent)
    expect(cells).toEqual(['AQXAAQXA Holdings IncListed Thu May 28', `Tue Nov 24in 4 days${BASIS}`,
      '+25.0%$25.00 on Nov 19 against its first close, $20.00 on May 28'])
    expect([...rows[0].querySelectorAll('td')].map((td) => td.textContent)).toEqual(['BQXBListed Wed May 20', `Mon Nov 164 days ago${BASIS}`,
      "The site's closes start Jun 2, after its first days."])
    expect(within(rows[2]).getByText('-12.5%')).toBeTruthy()
    expect(within(rows[1]).getByRole('button', { name: /AQXA/ })).toBeTruthy()
    expect(screen.getByTestId('terminal-ipo-lockup-read').textContent).toContain("2 from the first daily bar in the site's bar store")
    expect(screen.getByTestId('terminal-ipo-lockup-method').textContent).toContain('the site reads no prospectus')
    expect(lastReport(setFreshness)).toMatchObject({ source: "The site's last-year listings scan" })
    expect(lastReport(setFreshness).age.asOfDate).toMatch(/ET$/)
    expect(publishRows).toHaveBeenCalled()
  })

  it('the full sentence is in each row for a screen reader, and the visible words never drop "estimated"', async () => {
    serve({ [IPO_LOCKUP_URL]: answer(OK) })
    renderEl(<IpoLockupPanel />)
    await screen.findByTestId('terminal-ipo-lockup-table')
    for (const sym of ['AQXA', 'BQXB', 'GQXG']) {
      const basis = screen.getByTestId(`terminal-ipo-lockup-basis-${sym}`)
      expect(basis.querySelector('.sr-only').textContent).toBe('; the prospectus sets the actual date')
      expect(basis.textContent.startsWith('estimated: 180 days after listing')).toBe(true)
    }
  })

  it('the chip back to the calendar writes IPO inside the shell, and switches in place outside it', async () => {
    serve({ [IPO_LOCKUP_URL]: answer(OK) })
    const { rerun } = renderEl(<IpoLockupPanel />, { code: 'IPO' })
    await screen.findByTestId('terminal-ipo-lockup-table')
    expect(screen.getByTestId('terminal-ipo-lockup-view-lockup').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('terminal-ipo-lockup-view-calendar'))
    expect(rerun).toHaveBeenCalledWith('IPO')
    cleanup()
    serve({ [IPO_LOCKUP_URL]: answer(OK), [CAL_URL]: answer([]) })
    renderEl(<IpoCalendarPanel view="lockup" />)
    await screen.findByTestId('terminal-ipo-lockup-table')
    fireEvent.click(screen.getByTestId('terminal-ipo-lockup-view-calendar'))
    expect(await screen.findByTestId('terminal-ipo-none')).toBeTruthy()
  })

  it('IPO without the word is the calendar, unchanged, and it opens the lockups beside it', async () => {
    serve({ [CAL_URL]: answer([]) })
    renderEl(<IpoCalendarPanel />)
    await screen.findByTestId('terminal-ipo-none')
    expect(asked()).toEqual([CAL_URL])
    expect(screen.getByTestId('terminal-ipo-links').textContent).toContain('Lockups (IPO LOCKUP)')
  })
})

describe('IPO LOCKUP follows the theme and is reachable', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['IpoLockupPanel.jsx', 'ipoLockupModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })

  it('the list, an empty window, computing and a failed read pass axe (WCAG A and AA)', async () => {
    serve({ [IPO_LOCKUP_URL]: answer(OK) })
    renderEl(<IpoLockupPanel />, { code: 'IPO' })
    await screen.findByTestId('terminal-ipo-lockup-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [IPO_LOCKUP_URL]: answer({ ...OK, rows: [] }) })
    renderEl(<IpoLockupPanel />)
    await screen.findByTestId('terminal-ipo-lockup-none')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [IPO_LOCKUP_URL]: answer({ status: 'computing' }) })
    renderEl(<IpoLockupPanel />)
    await screen.findByTestId('terminal-ipo-lockup-busy')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({})
    renderEl(<IpoLockupPanel />)
    await screen.findByTestId('terminal-ipo-lockup-error')
    await expectNoAxeViolations(document.body.firstElementChild)
  })
})
