// SHINT: one stock's FINRA short interest, report by report, and its daily short volume. Rails:
//   * no ticker, loading, a failed read (error with Retry), signed out, not on a paid plan, a
//     switched-off route and an answer that is not the route's shape: none is "no short interest";
//   * "computing" is a working state and the panel fills in on its own;
//   * a refused data plan is said in plain words, with no Retry and no as-of, and is not an error;
//   * the newest report in a sentence with its age, the four facts, the reports table (date,
//     shares with a bar that is decoration, the change in percent and shares, days to cover),
//     12 reports at first and 24 on request;
//   * daily short volume beside FINRA's caution, always; its summary; 10 days at first;
//   * the two datasets fail apart, and a missing number is never 0;
//   * where the numbers come from is always on screen with them, and the header gets the
//     settlement date; a new ticker is a new read; no hard-coded color; axe.
// The fixtures are the route's real shape (api/services/short_data.py), with a made-up ticker.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
vi.mock('../../calendar/earningsModalRow', async (orig) => ({ ...(await orig()), todayIso: () => '2026-11-18' }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import ShortInterestPanel, {
  REPORTS_MORE, REPORTS_SHOWN, SHORT_INTEREST_CODE, VOLUME_DAYS_SHOWN, ageSentence, floatWords, latestSentence, readAtWords, shortDataUrl,
} from './ShortInterestPanel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const SOURCE = 'FINRA, through Massive'
const URL = '/api/research/short-data/ZZA'
/** A date is drawn with spaces that never break a line. */
const nb = (s) => s.replace(/ /g, String.fromCharCode(0x00a0))
const DATES = ['2026-10-30', '2026-10-15', '2026-09-30', '2026-09-15', '2026-08-31', '2026-08-14', '2026-07-31', '2026-07-15',
  '2026-06-30', '2026-06-15', '2026-05-29', '2026-05-15', '2026-04-30', '2026-04-15']
const SHARES = [3000000, 2000000, 1020000, 1030000, 1040000, 1050000, 1060000, 1070000, 1080000, 1090000, 1100000, 1110000, 1120000, 1130000]
/** Reports as the server sends them: newest first, each with its change from the one before. */
const reports = (n = DATES.length) => DATES.slice(0, n).map((d, i) => {
  const before = i + 1 < n ? SHARES[i + 1] : null
  return {
    settlement_date: d, short_interest: SHARES[i], avg_daily_volume: i === 0 ? 1200000 : 900000, days_to_cover: i === 0 ? 6 : 2.5,
    change_shares: before == null ? null : SHARES[i] - before,
    change_pct: before == null ? null : Math.round(((SHARES[i] - before) / before) * 10000) / 100,
  }
})
const volDays = (n = 12) => Array.from({ length: n }, (_, i) => ({
  date: `2026-11-${String(17 - i).padStart(2, '0')}`, short_volume: 400000 + i * 1000, total_volume: 1000000, short_volume_ratio: 40 + i,
}))
const answer = (over = {}) => ({
  status: 'ok', sym: 'ZZA', settlement_date: '2026-10-30', published: null, publication_estimate: '2026-11-10',
  published_basis: 'x', read_at: '2026-11-18T15:02:11+00:00', source: SOURCE,
  interest: { state: 'ok', http_status: 200, reason: null, reports: reports(), count: 14, cut: false, first_date: '2026-04-15' },
  volume: { state: 'ok', http_status: 200, reason: null, days: volDays(), count: 12, window_days: 60 },
  float: { shares: 10000000, pct_float: 30, withheld: false, state: 'ok', source: 'x' },
  ...over,
})
const REFUSED = { state: 'unavailable', http_status: 403, reason: 'refused' }

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

function renderPanel(props = { sym: 'zza' }, { open = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const tree = (p) => (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run: vi.fn(), rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}><ShortInterestPanel {...p} /></TerminalPanelContext.Provider>
            : <ShortInterestPanel {...p} />}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>
  )
  const view = render(tree(props))
  return { open, setFreshness, rerender: (p) => view.rerender(tree(p)), container: view.container }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const reportRow = (date) => screen.getByTestId(`terminal-short-report-${date}`)
const cells = (tr) => [...tr.querySelectorAll('td')]
/** A cell's lines, as the <br /> splits them. */
const lines = (td) => td.innerHTML.split(/<br\s*\/?>/).map((h) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent })
const noDated = (setFreshness) => setFreshness.mock.calls.every(([report]) => report == null)

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('SHINT states', () => {
  it('with no ticker it asks for one and reads nothing', () => {
    serve({})
    renderPanel({ sym: '' }, { code: 'SHINT' })
    expect(SHORT_INTEREST_CODE).toBe('SHINT')
    expect(screen.getByText('SHINT needs a ticker.')).toBeTruthy()
    expect(jsonFetcher).not.toHaveBeenCalled()
  })

  it('shows a loading skeleton and asks the one route, with the ticker in capitals', () => {
    serve({ [URL]: PENDING })
    renderPanel()
    expect(shortDataUrl('ZZA')).toBe(URL)
    expect(screen.getByTestId('terminal-short-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-short')).toBeNull()
    expect(asked()).toEqual([URL])
  })

  it('a failed read (500) is an error with Retry, never "no short interest"', async () => {
    serve({})
    const { setFreshness } = renderPanel({ sym: 'ZZA' }, { code: 'SHINT' })
    const err = await screen.findByTestId('terminal-short-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('Short interest could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no short interest. Retry, or run ZZA SHINT again.')
    expect(screen.queryByTestId('terminal-short-reports')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    serve({ [URL]: answer() })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-short-reports')).toBeTruthy()
  })

  it('signed out, a timeout, no paid plan and a switched-off route each say so; only an error can be retried', async () => {
    for (const [err, kind, words] of [
      [fail(401), 'error', 'You are signed out, so short interest cannot be read. Sign in again.'],
      [fail(0, { timedOut: true }), 'error', 'Short interest did not answer within 30 seconds.'],
      [fail(402), 'locked', 'Short interest needs a paid plan.'],
      [fail(404), 'locked', 'Short interest is not switched on for this server yet.'],
    ]) {
      cleanup()
      serve({ [URL]: err })
      renderPanel()
      const state = await screen.findByTestId('terminal-short-error')
      expect(state.getAttribute('data-kind'), words).toBe(kind)
      expect(state.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), words).toBe(kind === 'error')
    }
  })

  it('an answer that is not the route\'s shape, and a failed build, are errors with Retry', async () => {
    for (const body of [{ detail: 'something else' }, { status: 'failed', sym: 'ZZA' }]) {
      cleanup()
      serve({ [URL]: body })
      renderPanel()
      const err = await screen.findByTestId('terminal-short-error')
      expect(err.getAttribute('data-kind')).toBe('error')
      expect(err.textContent).toContain('Short interest for ZZA could not be read just now.')
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    }
  })

  it('"computing" says the server is still working, and the panel fills in on its own', async () => {
    let n = 0
    jsonFetcher.mockImplementation(async () => { n += 1; return n === 1 ? { status: 'computing', sym: 'ZZA' } : answer() })
    const { setFreshness } = renderPanel()
    const working = await screen.findByTestId('terminal-short-computing')
    expect(working.getAttribute('role')).toBe('status')
    expect(working.textContent).toContain('Loading, the server is preparing this.')
    expect(working.textContent).toContain('This panel asks again every 3 seconds and fills in on its own. That is not the same as no short interest.')
    expect(screen.getByTestId('terminal-short').getAttribute('data-state')).toBe('computing')
    expect(noDated(setFreshness)).toBe(true)
    // no click: the panel asks again by itself
    await screen.findByTestId('terminal-short-reports', {}, { timeout: 6000 })
    expect(n).toBeGreaterThanOrEqual(2)
  }, 15_000)

  it('a refused data plan is said in plain words: not an error, no Retry, no as-of, and OWN is not offered as another source', async () => {
    serve({ [URL]: { status: 'unavailable', sym: 'ZZA', interest: REFUSED, volume: REFUSED, float: { shares: null, pct_float: null, withheld: false, state: 'missing' } } })
    const { setFreshness, open } = renderPanel()
    const state = await screen.findByTestId('terminal-short-unavailable')
    expect(state.getAttribute('data-kind')).toBe('locked')
    expect(state.getAttribute('role')).toBe('status')
    expect(state.textContent).toContain('Short interest is not available on the data plan right now (the data vendor answered 403).')
    expect(state.textContent).toContain('through its stock-data vendor, Massive, and the vendor did not allow it. That is not the same as no short interest.')
    expect(state.textContent).toContain('The server asks again by itself in a few hours; nothing here needs a retry.')
    // OWN's short interest card reads this same record: it is named as that, never as a second figure.
    expect(state.textContent).toContain('its short interest card reads this same record, so it is not available there either.')
    expect(state.textContent).not.toMatch(/undated figure|from the screener is still/)
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.queryByTestId('terminal-short-reports')).toBeNull()
    expect(screen.getByTestId('terminal-short').getAttribute('data-state')).toBe('unavailable')
    expect(noDated(setFreshness)).toBe(true)
    fireEvent.click(within(state).getByRole('button', { name: 'Ownership (OWN) for ZZA (ZZA OWN)' }))
    expect(open).toHaveBeenCalledWith('ZZA OWN')
    cleanup()
    serve({ [URL]: { status: 'unavailable', sym: 'ZZA', interest: { state: 'unavailable', http_status: null, reason: 'not_configured' }, volume: REFUSED } })
    renderPanel()
    const noKey = (await screen.findByTestId('terminal-short-unavailable')).textContent
    expect(noKey).toContain('Short interest is not available on this server: it has no key for the data vendor.')
    expect(noKey).toContain('through its stock-data vendor, Massive, and this server has no key for it.')
    expect(noKey).not.toContain('did not allow it')
  })

  it('a symbol that is not a stock is said as that', async () => {
    serve({ '/api/research/short-data/I%3ASPX': { status: 'bad_symbol', sym: null } })
    renderPanel({ sym: 'I:SPX' }, { code: 'SHINT' })
    const state = await screen.findByTestId('terminal-short-bad-symbol')
    expect(state.getAttribute('data-kind')).toBe('input')
    expect(state.textContent).toContain('I:SPX is not a stock or fund symbol this screen can read.')
    expect(state.textContent).toContain('NVDA SHINT')
  })
})

describe('SHINT the reports', () => {
  it('says the newest report in a sentence with its age, and the four facts under it', async () => {
    serve({ [URL]: answer() })
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-short-reports')
    expect(screen.getByTestId('terminal-short').getAttribute('data-state')).toBe('ok')
    expect(screen.getByTestId('terminal-short-headline').textContent).toBe(
      '3.0M shares of ZZA were sold short as of Oct 30, 2026, 6.0 days to cover at its average daily volume. '
      + 'That is up 1.0M shares (+50.0%) from the report before. '
      + 'That settlement date is 19 days ago. FINRA\'s schedule put its publication on about Nov 10, 2026.',
    )
    const facts = [...screen.getByTestId('terminal-short-fields').querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent])
    expect(facts).toEqual([
      ['Short interest', '3,000,000 shares, settlement date Oct 30, 2026'],
      ['Days to cover', '6.0 days at an average daily volume of 1.2M shares'],
      ['Since the last report', '+1.0M shares (+50.0%), from Oct 15, 2026'],
      ['Percent of float', '30.0% of a float of 10.0M shares (today\'s float, from the nightly screener export)'],
    ])
    // the header names the source and the settlement date, never the time of the read
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith(expect.objectContaining({ source: SOURCE, age: { asOfDate: '2026-10-30' } })))
    expect(document.body.textContent).not.toMatch(/[—–]/)
    expect(asked()).toEqual([URL])
  })

  it('the table: date, shares, the change in percent and in shares, days to cover; the bar is decoration', async () => {
    serve({ [URL]: answer() })
    renderPanel()
    const table = await screen.findByTestId('terminal-short-reports')
    expect(screen.getByRole('table', { name: 'ZZA short interest by FINRA settlement date, newest first, 12 reports' })).toBe(table)
    expect([...table.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Settlement date', 'Short interest', 'Change', 'Days to cover', 'Avg daily volume'])
    const [date, short, change, dtc, adv] = cells(reportRow('2026-10-30'))
    expect(date.textContent).toBe(nb('Oct 30, 2026'))
    expect(short.textContent).toBe('3.0M')
    expect(lines(change)).toEqual(['+50.0%', '+1.0M'])
    expect(dtc.textContent).toBe('6.0')
    expect(adv.textContent).toBe('1.2M')
    // a fall carries its sign, and no color is used for either direction
    expect(lines(cells(reportRow('2026-09-30'))[2])).toEqual(['-1.0%', '-10K'])
    expect(reportRow('2026-09-30').getAttribute('data-way')).toBe('down')
    expect(table.querySelector('[class*="up"], [class*="down"]')).toBeNull()
    // the bars share one scale (the biggest report shown) and are hidden from a screen reader
    const bar = (d) => reportRow(d).querySelector('[aria-hidden="true"] span')
    expect(bar('2026-10-30').style.width).toBe('100%')
    expect(bar('2026-10-15').style.width).toBe('66.7%')
    expect(reportRow('2026-10-30').querySelector('[aria-hidden="true"]').textContent).toBe('')
  })

  it('draws 12 reports at first and 24 on request, and counts what is on file', async () => {
    serve({ [URL]: answer() })
    renderPanel()
    const table = await screen.findByTestId('terminal-short-reports')
    expect([REPORTS_SHOWN, REPORTS_MORE]).toEqual([12, 24])
    expect(table.querySelectorAll('tbody tr')).toHaveLength(12)
    expect(screen.queryByTestId('terminal-short-report-2026-04-15')).toBeNull()
    expect(screen.getByTestId('terminal-short-reports-count').textContent).toBe('Showing the newest 12 of 14 reports on file, which go back to Apr 15, 2026.')
    const more = screen.getByTestId('terminal-short-more-reports')
    expect(more.textContent).toBe('Show 14')
    fireEvent.click(more)
    expect(table.querySelectorAll('tbody tr')).toHaveLength(14)
    // the oldest report has nothing before it: said in words, never as 0
    expect(cells(reportRow('2026-04-15'))[2].textContent).toBe('First report')
    expect(screen.getByTestId('terminal-short-reports-count').textContent).toContain('Showing the newest 14 of 14 reports on file')
    expect(more.getAttribute('aria-pressed')).toBe('true')
    expect(more.textContent).toBe('Show 12')
  })

  it('a stock with few reports has no "Show more", and an answer the server cut says so', async () => {
    serve({ [URL]: answer({ interest: { state: 'ok', http_status: 200, reason: null, reports: reports(3), count: 3, cut: true, first_date: '2026-09-30' } }) })
    renderPanel()
    await screen.findByTestId('terminal-short-reports')
    expect(screen.queryByTestId('terminal-short-more-reports')).toBeNull()
    expect(screen.getByTestId('terminal-short-reports-count').textContent)
      .toBe('Showing the newest 3 of 3 reports on file, which go back to Sep 30, 2026. Older reports exist at the data vendor and were not read.')
  })

  it('a missing number is words, never 0: no days to cover, no percent, no float, a float that cannot be right', async () => {
    const rows = reports(2)
    rows[0] = { ...rows[0], days_to_cover: null, avg_daily_volume: null, change_pct: null }
    serve({ [URL]: answer({ interest: { state: 'ok', reports: rows, count: 2, cut: false }, float: { shares: null, pct_float: null, withheld: false, state: 'missing' } }) })
    renderPanel()
    await screen.findByTestId('terminal-short-reports')
    const [, , change, dtc, adv] = cells(reportRow('2026-10-30'))
    expect(lines(change)).toEqual(['No percent', '+1.0M'])
    expect(dtc.textContent).toBe('not given')
    expect(adv.textContent).toBe('not given')
    expect(screen.getByTestId('terminal-short-headline').textContent).toContain('3.0M shares of ZZA were sold short as of Oct 30, 2026. That is up 1.0M shares from the report before.')
    expect(screen.getByTestId('terminal-short-float').textContent).toBe('No float on file for this stock')
    expect(screen.getByTestId('terminal-short-fields').textContent).toContain('Days to covernot given')
    expect(floatWords({ pct: null, withheld: true })).toContain('more than 150% of the float on file')
    expect(floatWords({ pct: 12.5, withheld: false })).toBeNull()
  })

  it('the sentences on their own', () => {
    expect(latestSentence('ZZA', null)).toBe('')
    expect(latestSentence('ZZA', { date: '2026-10-30', short: 500000, dtc: null, changeShares: null, changePct: null }))
      .toBe('500K shares of ZZA were sold short as of Oct 30, 2026. There is no earlier report to compare it with.')
    expect(latestSentence('ZZA', { date: '2026-10-30', short: 500000, dtc: 1.25, changeShares: 0, changePct: 0 }))
      .toBe('500K shares of ZZA were sold short as of Oct 30, 2026, 1.3 days to cover at its average daily volume. That is unchanged from the report before.')
    expect(latestSentence('ZZA', { date: '2026-10-30', short: 500000, dtc: null, changeShares: -250000, changePct: -33.33 }))
      .toBe('500K shares of ZZA were sold short as of Oct 30, 2026. That is down 250K shares (-33.3%) from the report before.')
    expect(ageSentence('2026-11-17', '2026-11-18', null)).toBe('That settlement date is 1 day ago.')
    expect(ageSentence('2026-11-19', '2026-11-18', null)).toBe('')
    expect(ageSentence(null, '2026-11-18', '2026-11-10')).toBe('')
    // a read from an earlier day carries its day, so an old answer is never read as this morning's
    expect(readAtWords('2026-11-18T15:02:11+00:00', '2026-11-18')).toMatch(/^10:02\sAM ET$/)
    expect(readAtWords('2026-11-17T21:30:00+00:00', '2026-11-18')).toMatch(/^4:30\sPM ET on Nov 17, 2026$/)
    expect(readAtWords(null, '2026-11-18')).toBe('')
  })
})

describe('SHINT daily short volume', () => {
  it('sits under FINRA\'s caution, with its summary, 10 days at first and all on request', async () => {
    serve({ [URL]: answer() })
    renderPanel()
    const table = await screen.findByTestId('terminal-short-volume')
    expect(screen.getByTestId('terminal-short-volume-caution').textContent)
      .toBe('Daily short volume is not short interest. It is the share of each day\'s off-exchange volume that was short sales; most of it is bought back the same day.')
    expect(screen.getByTestId('terminal-short-volume-summary').textContent)
      .toBe('Over the last 12 sessions on file, short sales were 45.5% of ZZA\'s off-exchange volume on average (lowest 40.0%, highest 51.0%).')
    expect(screen.getByRole('table', { name: 'ZZA daily off-exchange short volume, newest first, 10 days' })).toBe(table)
    expect([...table.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Date', 'Short share of volume', 'Short volume', 'Total volume'])
    expect(VOLUME_DAYS_SHOWN).toBe(10)
    expect(table.querySelectorAll('tbody tr')).toHaveLength(10)
    const first = cells(screen.getByTestId('terminal-short-day-2026-11-17'))
    expect(first.map((td) => td.textContent)).toEqual([nb('Nov 17, 2026'), '40.0%', '400K', '1.0M'])
    expect(first[1].querySelector('[aria-hidden="true"] span').style.width).toBe('40%')
    fireEvent.click(screen.getByTestId('terminal-short-more-days'))
    expect(table.querySelectorAll('tbody tr')).toHaveLength(12)
    expect(screen.getByTestId('terminal-short-more-days').textContent).toBe('Show 10')
  })

  it('a day without a ratio or a total says so, and is left out of the average', async () => {
    const days = volDays(3)
    days[1] = { ...days[1], total_volume: null, short_volume_ratio: null }
    serve({ [URL]: answer({ volume: { state: 'ok', days, count: 3, window_days: 60 } }) })
    renderPanel()
    await screen.findByTestId('terminal-short-volume')
    expect(cells(screen.getByTestId('terminal-short-day-2026-11-16')).map((td) => td.textContent)).toEqual([nb('Nov 16, 2026'), 'not given', '401K', 'not given'])
    expect(screen.getByTestId('terminal-short-day-2026-11-16').querySelector('[aria-hidden="true"]')).toBeNull()
    expect(screen.getByTestId('terminal-short-volume-summary').textContent).toContain('Over the last 2 sessions on file, short sales were 41.0%')
    expect(screen.queryByTestId('terminal-short-more-days')).toBeNull()
  })
})

describe('SHINT: the two datasets fail apart', () => {
  it('short interest refused, short volume shown: the refusal is said where the reports would be', async () => {
    serve({ [URL]: answer({ interest: REFUSED, settlement_date: null, float: { shares: null, pct_float: null, withheld: false, state: 'missing' } }) })
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-short-volume')
    const missing = screen.getByTestId('terminal-short-interest-missing')
    expect(missing.textContent).toBe('Short interest is not available on the data plan right now (the data vendor answered 403). That is not the same as none.')
    expect(screen.queryByTestId('terminal-short-reports')).toBeNull()
    expect(screen.queryByTestId('terminal-short-headline')).toBeNull()
    // with no settlement date the header is dated by the newest short volume day
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith(expect.objectContaining({ source: SOURCE, age: { asOfDate: '2026-11-17' } })))
  })

  it('no short volume rows, and a short volume read that failed, are each said as what they are', async () => {
    serve({ [URL]: answer({ volume: { state: 'none', http_status: 200, reason: null } }) })
    renderPanel()
    await screen.findByTestId('terminal-short-reports')
    expect(screen.getByTestId('terminal-short-volume-missing').textContent)
      .toBe('Daily short volume has no rows for this symbol at the data vendor. That is not the same as zero.')
    expect(screen.queryByTestId('terminal-short-volume-caution')).toBeNull()
    cleanup()
    serve({ [URL]: answer({ volume: { state: 'failed', http_status: 502, reason: 'vendor' } }) })
    renderPanel()
    await screen.findByTestId('terminal-short-reports')
    const failed = screen.getByTestId('terminal-short-volume-missing')
    expect(failed.textContent).toContain('Daily short volume could not be read just now. That is not the same as none.')
    serve({ [URL]: answer() })
    fireEvent.click(within(failed).getByRole('button', { name: 'Read it again' }))
    expect(await screen.findByTestId('terminal-short-volume')).toBeTruthy()
  })
})

describe('SHINT says where the numbers come from', () => {
  it('the source, the twice-a-month cadence and FINRA\'s caution are always on screen with the numbers', async () => {
    serve({ [URL]: answer({ refreshing: true }) })
    const { open } = renderPanel()
    await screen.findByTestId('terminal-short-reports')
    const method = screen.getByTestId('terminal-short-method').textContent
    expect(method).toContain('Source: FINRA, through Massive.')
    expect(method).toContain('what brokers report to FINRA twice a month')
    expect(method).toContain('about two weeks old the day it comes out')
    expect(method).toContain('Daily short volume is not short interest (FINRA\'s own caution): it counts short sales in one day\'s off-exchange trades only')
    expect(method).toMatch(/Read from the data vendor at 10:02\sAM ET, and being read again now; the server keeps a stock's answer for four hours\./)
    fireEvent.click(screen.getByRole('button', { name: 'Open the short interest list (SHRTS)' }))
    expect(open).toHaveBeenCalledWith('SHRTS')
  })

  it('a new ticker is a new read: one stock\'s numbers are never drawn under another\'s name', async () => {
    serve({ [URL]: answer(), '/api/research/short-data/ZZB': PENDING })
    const { rerender } = renderPanel()
    await screen.findByTestId('terminal-short-reports')
    rerender({ sym: 'ZZB' })
    expect(screen.getByTestId('terminal-short-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-short-reports')).toBeNull()
    expect(asked()).toEqual([URL, '/api/research/short-data/ZZB'])
  })
})

describe('SHINT follows the member\'s theme', () => {
  it('the panel, its model, its notes and its stylesheet hold no hard-coded color', () => {
    for (const f of ['ShortInterestPanel.jsx', 'shortInterestModel.js', 'ShortDataNotes.jsx', 'shortPanels.module.css']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('SHINT accessibility', () => {
  it('the full panel, the refused plan and one dataset missing pass axe (WCAG A and AA)', async () => {
    serve({ [URL]: answer() })
    renderPanel()
    await screen.findByTestId('terminal-short-reports')
    fireEvent.click(screen.getByTestId('terminal-short-more-reports'))
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: { status: 'unavailable', sym: 'ZZA', interest: REFUSED, volume: REFUSED } })
    renderPanel()
    await screen.findByTestId('terminal-short-unavailable')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: answer({ interest: REFUSED, volume: { state: 'failed', http_status: 502, reason: 'vendor' } }) })
    renderPanel()
    await screen.findByTestId('terminal-short-error')
    cleanup()
    serve({ [URL]: answer({ interest: REFUSED }) })
    renderPanel()
    await screen.findByTestId('terminal-short-volume')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)
})
