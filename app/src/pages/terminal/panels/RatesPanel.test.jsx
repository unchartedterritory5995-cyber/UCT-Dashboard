// RATES: Treasury yields and the yield curve. Rails:
//   * loading, a failed read (error with Retry), signed out, not on a paid plan, a switched-off
//     route and an answer that is not the route's shape: none of them is an empty table;
//   * "computing" is a working state and the panel fills in on its own;
//   * a refused source (and an answer the Treasury sent that cannot be read) is said in plain
//     words, with no Retry and no as-of;
//   * the date of the newest figure, that it is an end-of-day number and its source are always on
//     screen, and the header is told the date, never the time of the read;
//   * the table: every maturity, its yield and its changes in basis points with a sign; a missing
//     number is words, never 0; no color for a change; the 1-year column folds on a phone;
//   * each spread is a sentence a trader would say, with which way it has moved;
//   * the two pictures are inline SVG with an accessible name, tokens only, and their numbers are
//     also on screen as text;
//   * a refused look for a newer figure and an old figure are said above figures still shown; axe.
// The fixtures are the route's real shape (api/services/treasury_yields.py), with made-up yields.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { SWRConfig, useSWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
vi.mock('../../calendar/earningsModalRow', async (orig) => ({ ...(await orig()), todayIso: () => '2026-11-18' }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import RatesPanel, { OLD_AFTER_DAYS, RATES_CODE, RATES_URL, SOURCE, asOfSentence, methodSentence, ratesRead } from './RatesPanel'
import { stampedKey } from './marketRead'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const H = (d1, w1, m1, m3, y1) => ({ d1, w1, m1, m3, y1 })
const mat = (key, label, months, y, chg, was = H(null, null, y == null ? null : y + 0.2, null, y == null ? null : y - 0.4)) => (
  { key, label, months, yield: y, was, change_bp: chg })
const MATS = [
  mat('1m', '1-month', 1, null, H(null, null, null, null, null)),
  mat('3m', '3-month', 3, 4.3, H(0, -1, -5, -10, -30)),
  mat('6m', '6-month', 6, 4.2, H(0, 0, -4, -12, -41)),
  mat('1y', '1-year', 12, 4.0, H(1, 2.5, 0, -15, -38)),
  mat('2y', '2-year', 24, 3.7, H(0, 0, 0, -70, -70)),
  mat('3y', '3-year', 36, 3.72, H(1, 3, -2, -60, -61)),
  mat('5y', '5-year', 60, 3.8, H(2, 5, -9, -30, -20)),
  mat('7y', '7-year', 84, 3.95, H(2, 6, -14, -11, 9)),
  mat('10y', '10-year', 120, 4.12, H(2, 7, -18, 2, 50)),
  mat('20y', '20-year', 240, 4.6, H(1, null, -16, 6, 58)),
  mat('30y', '30-year', 360, 4.7, H(0, 8, -15, 9, 61)),
]
const SPREADS = [
  { key: '10y2y', label: '10-year minus 2-year', long: '10y', short: '2y', value: 0.42, state: 'positive', inverted: false,
    days_in_state: 64, since: '2026-08-20', days_at_least: false, was: H(0.4, 0.35, 0.6, -0.3, -0.78), change_bp: H(2, 7, -18, 72, 120) },
  { key: '10y3m', label: '10-year minus 3-month', long: '10y', short: '3m', value: -0.18, state: 'inverted', inverted: true,
    days_in_state: 1317, since: '2021-11-01', days_at_least: true, was: H(-0.2, -0.26, -0.05, -0.3, -0.98), change_bp: H(2, 8, -13, 12, 80) },
]
const HISTORY = {
  from: '2026-11-10', to: '2026-11-17', points: 6, years: 5,
  dates: ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17'],
  y2y: [3.7, 3.7, 3.7, 3.7, 3.7, 3.7], y10y: [4.05, 4.1, 4.1, 4.1, 4.1, 4.12], y30y: [4.7, 4.7, 4.7, 4.7, 4.7, 4.7],
  s10y2y: [0.35, -0.3, null, 0.1, 0.4, 0.42], s10y3m: [-0.25, -0.2, -0.2, -0.2, -0.2, -0.18],
}
const answer = (over = {}) => ({
  status: 'ok', as_of: '2026-11-17', ref_dates: H('2026-11-16', '2026-11-10', '2026-10-16', '2026-08-17', '2025-11-17'),
  maturities: MATS, spreads: SPREADS, history: HISTORY, rows: 1317, read_at: '2026-11-17T23:20:04+00:00',
  basis: 'end_of_day', units: { yield: 'percent', change: 'basis points', spread: 'percentage points' }, source: SOURCE, check: null, ...over,
})

const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
/** Serves each route its body (an Error is thrown, PENDING never answers); anything else is a 500. */
function serve(routes) {
  jsonFetcher.mockImplementation((u) => {
    const hit = routes[u]
    if (hit === undefined) return Promise.reject(fail(500))
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([u]) => u))]

/** The test's handle on the panel's own SWR cache, so a re-read can be asked for. */
const swr = { mutate: null }
function GrabMutate() {
  const { mutate } = useSWRConfig()
  useEffect(() => { swr.mutate = mutate }, [mutate])
  return null
}

function renderPanel({ setFreshness = vi.fn(), code = null } = {}) {
  const body = <RatesPanel />
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <GrabMutate />
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run: vi.fn(), rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { setFreshness, container: view.container }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const rows = () => screen.getAllByTestId('terminal-rates-row')
const cells = (key) => [...rows().find((r) => r.getAttribute('data-key') === key).children].map((c) => c.textContent)
const noDated = (setFreshness) => setFreshness.mock.calls.every(([report]) => report == null)
const root = () => screen.getByTestId('terminal-rates')

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('RATES states', () => {
  it('shows a loading skeleton and asks the one route', () => {
    serve({ [RATES_URL]: PENDING })
    renderPanel()
    expect(RATES_CODE).toBe('RATES')
    expect(RATES_URL).toBe('/api/research/treasury-yields')
    expect(screen.getByTestId('terminal-rates-loading')).toBeTruthy()
    expect(root().getAttribute('data-state')).toBe('loading')
    expect(asked()).toEqual([RATES_URL])
  })

  it('a failed read (500) is an error with Retry, never an empty table', async () => {
    serve({})
    const { setFreshness } = renderPanel({ code: 'RATES' })
    const err = await screen.findByTestId('terminal-rates-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('Treasury yields could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no figures. Retry, or run RATES again.')
    expect(screen.queryByTestId('terminal-rates-table')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    serve({ [RATES_URL]: answer() })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-rates-table')).toBeTruthy()
  })

  it('signed out, a timeout, no paid plan and a switched-off route each say so; only an error can be retried', async () => {
    for (const [err, kind, words] of [
      [fail(401), 'error', 'You are signed out, so treasury yields cannot be read. Sign in again.'],
      [fail(0, { timedOut: true }), 'error', 'Treasury yields did not answer within 30 seconds.'],
      [fail(402), 'locked', 'Treasury yields needs a paid plan.'],
      [fail(404), 'locked', 'Treasury yields is not switched on for this server yet.'],
    ]) {
      serve({ [RATES_URL]: err })
      renderPanel()
      const state = await screen.findByTestId('terminal-rates-error')
      expect(state.getAttribute('data-kind')).toBe(kind)
      expect(state.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' })).toBe(kind === 'error')
      expect(screen.queryByTestId('terminal-rates-table')).toBeNull()
      cleanup()
    }
  })

  it('an answer that is not the route\'s shape, and a failed build, are a failed read with Retry', async () => {
    for (const body of [{ rows: [] }, { status: 'failed', reason: 'source', http_status: 503 }, { status: 'failed', reason: 'timeout', http_status: null }, answer({ as_of: null }), answer({ maturities: [] })]) {
      serve({ [RATES_URL]: body })
      const { setFreshness } = renderPanel()
      const err = await screen.findByTestId('terminal-rates-error')
      expect(err.textContent).toContain('Treasury yields could not be read just now.')
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
      expect(root().getAttribute('data-state')).toBe('error')
      expect(noDated(setFreshness)).toBe(true)
      cleanup()
    }
  })

  it('"computing" says the server is still working, and the panel fills in on its own', async () => {
    let n = 0
    jsonFetcher.mockImplementation(async () => { n += 1; return n === 1 ? { status: 'computing' } : answer() })
    const { setFreshness } = renderPanel()
    const working = await screen.findByTestId('terminal-rates-computing')
    expect(working.getAttribute('role')).toBe('status')
    expect(working.textContent).toContain('Loading, the server is preparing this.')
    expect(working.textContent).toContain('This panel asks again every 3 seconds and fills in on its own. That is not the same as no figures.')
    expect(root().getAttribute('data-state')).toBe('computing')
    expect(noDated(setFreshness)).toBe(true)
    // no click: the panel asks again by itself
    await screen.findByTestId('terminal-rates-table', {}, { timeout: 6000 })
    expect(n).toBeGreaterThanOrEqual(2)
  }, 15_000)

  it('a Treasury website that refuses the server is said in plain words: not an error, no Retry, no as-of, no table', async () => {
    serve({ [RATES_URL]: { status: 'unavailable', reason: 'refused', http_status: 403, source: SOURCE } })
    const { setFreshness } = renderPanel()
    const state = await screen.findByTestId('terminal-rates-unavailable')
    expect(state.getAttribute('data-kind')).toBe('locked')
    expect(state.getAttribute('role')).toBe('status')
    expect(state.textContent).toContain("Treasury yields are not available right now: the Treasury's website refused the server's request (it answered 403).")
    expect(state.textContent).toContain("The site reads these figures from the US Treasury's published daily par yield curve, and the Treasury's website did not let the server in.")
    expect(state.textContent).toContain('That is not the same as no figures. The server asks again by itself; nothing here needs a retry.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.queryByTestId('terminal-rates-table')).toBeNull()
    expect(root().getAttribute('data-state')).toBe('unavailable')
    expect(noDated(setFreshness)).toBe(true)
  })

  it('a redirect, and an answer that cannot be read as yields, each say which', async () => {
    for (const [body, words, refused] of [
      [{ status: 'unavailable', reason: 'refused', http_status: 302 }, "Treasury yields are not available right now: the Treasury's website refused the server's request (it answered 302).", true],
      [{ status: 'unavailable', reason: 'shape', http_status: 200 }, "Treasury yields are not available right now: the Treasury's website answered, but not with figures this screen can read.", false],
    ]) {
      serve({ [RATES_URL]: body })
      renderPanel()
      const state = await screen.findByTestId('terminal-rates-unavailable')
      expect(state.textContent).toContain(words)
      expect(state.textContent.includes('did not let the server in')).toBe(refused)
      expect(state.textContent).toContain("The site reads these figures from the US Treasury's published daily par yield curve")
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
      cleanup()
    }
  })
})

describe('RATES figures', () => {
  it('says the date, that it is an end-of-day number and the source, and tells the header the date', async () => {
    serve({ [RATES_URL]: answer() })
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-rates-table')
    expect(root().getAttribute('data-state')).toBe('ok')
    expect(screen.getByTestId('terminal-rates-asof').textContent).toBe('End-of-day yields for Nov 17, 2026, with each change in basis points. Source: US Treasury daily par yield curve.')
    expect(asOfSentence(ratesRead(answer()))).toBe(screen.getByTestId('terminal-rates-asof').textContent)
    // the header names the source and the figure's own date, never the time of the read
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith(expect.objectContaining({ source: SOURCE, age: { asOfDate: '2026-11-17' } })))
    const method = screen.getByTestId('terminal-rates-method').textContent
    expect(method).toContain(
      'A change is the newest yield minus the yield on the nearest trading day on or before the date named, in basis points '
      + '(1 bp is 0.01 of a percentage point). 1 day is against Nov 16, 2026, 1 week is against Nov 10, 2026, 1 month is against Oct 16, 2026, '
      + '1 year is against Nov 17, 2025.',
    )
    expect(method).toContain('Steeper means the spread rose; flatter means it fell.')
    expect(method).toContain('nothing here moves during the day.')
    expect(method).toContain('The site read these figures from the US Treasury daily par yield curve on Nov 17, 2026 at 6:20 PM ET.')
    expect(screen.queryByTestId('terminal-rates-old')).toBeNull()
    expect(screen.queryByTestId('terminal-rates-check')).toBeNull()
    expect(document.body.textContent).not.toMatch(/[—–]/)
    expect(asked()).toEqual([RATES_URL])
  })

  it('the table: every maturity, its yield, and its changes in basis points with a sign', async () => {
    serve({ [RATES_URL]: answer() })
    renderPanel()
    const table = await screen.findByTestId('terminal-rates-table')
    expect(table.getAttribute('aria-label')).toBe('Treasury yields by maturity for Nov 17, 2026: the yield in percent and its change in basis points')
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Maturity', 'Yield', '1 day', '1 week', '1 month', '1 year'])
    expect([...table.querySelectorAll('thead th')].map((th) => th.getAttribute('title'))).toEqual([
      null, 'The end-of-day yield, in percent', 'Change in basis points against Nov 16, 2026', 'Change in basis points against Nov 10, 2026',
      'Change in basis points against Oct 16, 2026', 'Change in basis points against Nov 17, 2025',
    ])
    expect(rows().map((r) => r.getAttribute('data-key'))).toEqual(['1m', '3m', '6m', '1y', '2y', '3y', '5y', '7y', '10y', '20y', '30y'])
    expect(cells('10y')).toEqual(['10-year', '4.12%', '+2', '+7', '-18', '+50'])
    expect(cells('2y')).toEqual(['2-year', '3.70%', '0', '0', '0', '-70'])
    expect(cells('1y')).toEqual(['1-year', '4.00%', '+1', '+2.5', '0', '-38'])
    // a missing number is words, never 0
    expect(cells('1m')).toEqual(['1-month', 'No figure', 'n/a', 'n/a', 'n/a', 'n/a'])
    expect(cells('20y')).toEqual(['20-year', '4.60%', '+1', 'n/a', '-16', '+58'])
    // every row is headed by its maturity
    expect(rows().every((r) => r.children[0].tagName === 'TH' && r.children[0].getAttribute('scope') === 'row')).toBe(true)
  })

  it('a change wears no price color, and the 1-year column is the one that folds on a phone', async () => {
    serve({ [RATES_URL]: answer() })
    renderPanel()
    const table = await screen.findByTestId('terminal-rates-table')
    // marketPanels.module.css paints `.up` / `.down` / `.badge_up` / `.badge_down` in the price colors: none is worn here
    const classes = [...root().querySelectorAll('[class]')].flatMap((el) => String(el.getAttribute('class')).split(/\s+/))
    expect(classes.length).toBeGreaterThan(20)
    expect(classes.filter((c) => /^_?(up|down|badge_up|badge_down)(_|$)/.test(c))).toEqual([])
    expect([...table.querySelectorAll('th')].filter((th) => /phoneHide/.test(th.className)).map((th) => th.textContent)).toEqual(['1 year'])
    const tenYear = rows().find((r) => r.getAttribute('data-key') === '10y')
    expect([...tenYear.children].map((c) => /phoneHide/.test(c.className))).toEqual([false, false, false, false, false, true])
    expect(/tableBox/.test(table.parentElement.className)).toBe(true)
  })

  it('each spread is a sentence a trader would say, with which way it has moved', async () => {
    serve({ [RATES_URL]: answer() })
    renderPanel()
    await screen.findByTestId('terminal-rates-table')
    const s2 = screen.getByTestId('terminal-rates-spread-10y2y')
    expect(s2.textContent).toBe(
      'The 10-year is 0.42 points above the 2-year: the curve is positive, for 64 trading days (since Aug 20, 2026). '
      + 'It is 7 bp steeper than a week ago and 18 bp flatter than a month ago.',
    )
    expect(s2.getAttribute('data-state')).toBe('positive')
    const s3 = screen.getByTestId('terminal-rates-spread-10y3m')
    expect(s3.textContent).toBe(
      'The 10-year is 0.18 points below the 3-month: the curve is inverted, for at least 1,317 trading days '
      + '(as far back as this screen reads, Nov 1, 2021). It is 8 bp steeper than a week ago and 13 bp flatter than a month ago.',
    )
    expect(s3.getAttribute('data-state')).toBe('inverted')
  })

  it('a spread with a missing yield says so and is never drawn as zero', async () => {
    serve({ [RATES_URL]: answer({ spreads: [{ ...SPREADS[0], value: null, state: null, inverted: null, days_in_state: null, since: null, change_bp: H(null, null, null, null, null) }] }) })
    renderPanel()
    await screen.findByTestId('terminal-rates-table')
    const s2 = screen.getByTestId('terminal-rates-spread-10y2y')
    expect(s2.textContent).toBe('The 10-year against the 2-year: no figure for Nov 17, 2026, because one of the two yields is missing.')
    expect(s2.getAttribute('data-state')).toBe('none')
    expect(screen.queryByTestId('terminal-rates-spread-10y3m')).toBeNull()
  })

  it('the curve picture: three lines on one scale, an accessible name, and its numbers as text', async () => {
    serve({ [RATES_URL]: answer() })
    renderPanel()
    await screen.findByTestId('terminal-rates-table')
    const fig = screen.getByTestId('terminal-rates-curve')
    const svg = fig.querySelector('svg[role="img"]')
    expect(svg.getAttribute('aria-label')).toBe(
      'Treasury yields by maturity on Nov 17, 2026: 3-month 4.30%, 6-month 4.20%, 1-year 4.00%, 2-year 3.70%, 3-year 3.72%, 5-year 3.80%, '
      + '7-year 3.95%, 10-year 4.12%, 20-year 4.60%, 30-year 4.70%. Drawn against the curve a month ago and a year ago; the table holds the same numbers.',
    )
    expect([...svg.querySelectorAll('path')].map((p) => p.getAttribute('data-series'))).toEqual(['y1', 'm1', 'now'])   // the newest on top
    for (const p of svg.querySelectorAll('path')) {
      expect(p.getAttribute('d')).toMatch(/^M[\d.]+ [\d.]+( L[\d.]+ [\d.]+)+$/)
      expect(p.getAttribute('vector-effect')).toBe('non-scaling-stroke')
    }
    // the 1-month has no figure today: the newest line starts at the 3-month, ten points
    expect(svg.querySelector('[data-series="now"]').getAttribute('d').split('L')).toHaveLength(10)
    expect([...fig.querySelectorAll('[class*="axis"] span')].map((s) => s.textContent)).toEqual(['1M', '3M', '6M', '1Y', '2Y', '3Y', '5Y', '7Y', '10Y', '20Y', '30Y'])
    expect([...screen.getByTestId('terminal-rates-curve-legend').querySelectorAll('li')].map((li) => li.textContent)).toEqual(
      ['Nov 17', 'A month ago (Oct 16)', 'A year ago (Nov 17, 2025)', 'From 3.30% to 4.90%'],
    )
  })

  it('the spread picture: the line, the zero line, an accessible name and the same words on screen', async () => {
    serve({ [RATES_URL]: answer() })
    renderPanel()
    await screen.findByTestId('terminal-rates-table')
    const fig = screen.getByTestId('terminal-rates-spread-history')
    const words = '10-year minus 2-year, daily, Nov 10, 2026 to Nov 17, 2026: low -0.30 on Nov 11, 2026, high +0.42 on Nov 17, 2026, now +0.42. '
      + 'In percentage points; below zero is inverted.'
    const svg = fig.querySelector('svg[role="img"]')
    expect(svg.getAttribute('aria-label')).toBe(words)
    expect(screen.getByTestId('terminal-rates-spread-words').textContent).toBe(words)
    expect([...svg.querySelectorAll('path')].map((p) => p.getAttribute('data-series'))).toEqual(['zero', 's10y2y'])
    expect(svg.querySelector('[data-series="s10y2y"]').getAttribute('d').match(/M/g)).toHaveLength(2)      // Nov 12 has no figure
    expect(fig.textContent).toContain('10-year minus 2-year, 5 years')
    expect(fig.textContent).toContain('The dotted line is zero')
  })

  it('with too little to draw there is no picture, and the table still stands', async () => {
    serve({ [RATES_URL]: answer({ maturities: [MATS[8]], history: { dates: ['2026-11-17'], s10y2y: [0.42] } }) })
    renderPanel()
    await screen.findByTestId('terminal-rates-table')
    expect(screen.queryByTestId('terminal-rates-curve')).toBeNull()
    expect(screen.queryByTestId('terminal-rates-spread-history')).toBeNull()
    expect(rows()).toHaveLength(1)
  })

  it('a refused look for a newer figure is said above figures that are still shown', async () => {
    serve({ [RATES_URL]: answer({ check: { state: 'unavailable', reason: 'refused', http_status: 403, at: '2026-11-18T12:00:00+00:00' } }) })
    renderPanel()
    await screen.findByTestId('terminal-rates-table')
    expect(screen.getByTestId('terminal-rates-check').textContent).toBe(
      "Treasury yields are not available right now: the Treasury's website refused the server's request (it answered 403). These are the last figures the site read, for Nov 17, 2026.",
    )
    cleanup()
    serve({ [RATES_URL]: answer({ check: { state: 'failed', reason: 'timeout', http_status: null, at: 'x' } }) })
    renderPanel()
    await screen.findByTestId('terminal-rates-table')
    expect(screen.getByTestId('terminal-rates-check').textContent).toBe(
      'The last look for a newer figure did not get an answer. These are the last figures the site read, for Nov 17, 2026.',
    )
  })

  it('a newest figure more than a few days old is said out loud; a long weekend is not', async () => {
    expect(OLD_AFTER_DAYS).toBe(5)
    serve({ [RATES_URL]: answer({ as_of: '2026-11-12' }) })
    renderPanel()
    await screen.findByTestId('terminal-rates-table')
    expect(screen.getByTestId('terminal-rates-old').textContent).toBe('The newest figure the site has from the Treasury is 6 days old (Nov 12, 2026).')
    cleanup()
    serve({ [RATES_URL]: answer({ as_of: '2026-11-13' }) })
    renderPanel()
    await screen.findByTestId('terminal-rates-table')
    expect(screen.queryByTestId('terminal-rates-old')).toBeNull()
  })

  it('a later read that fails keeps the figures and says it is the last read', async () => {
    let n = 0
    jsonFetcher.mockImplementation(async () => { n += 1; if (n === 1) return answer(); throw fail(500) })
    renderPanel()
    await screen.findByTestId('terminal-rates-table')
    expect(screen.queryByTestId('terminal-rates-stale-read')).toBeNull()
    await act(async () => { await swr.mutate(stampedKey(RATES_URL)).catch(() => {}) })
    const note = await screen.findByTestId('terminal-rates-stale-read')
    expect(note.textContent).toBe('Treasury yields could not be read just now. Showing the last read.')
    expect(rows()).toHaveLength(11)
    expect(screen.queryByTestId('terminal-rates-error')).toBeNull()
  })

  it('with no reference days the method line names none, and with no read time it gives none', async () => {
    expect(methodSentence(ratesRead(answer({ ref_dates: {} })))).toBe(
      'A change is the newest yield minus the yield on the nearest trading day on or before the date named, in basis points (1 bp is 0.01 of a percentage point).',
    )
    serve({ [RATES_URL]: answer({ read_at: null }) })
    renderPanel()
    await screen.findByTestId('terminal-rates-table')
    expect(screen.getByTestId('terminal-rates-method').textContent).not.toContain('The site read these figures')
  })
})

describe('RATES rails', () => {
  it('has no axe violations with figures, when the plan is refused and after a failed read', async () => {
    serve({ [RATES_URL]: answer() })
    const ok = renderPanel()
    await screen.findByTestId('terminal-rates-table')
    await expectNoAxeViolations(ok.container)
    cleanup()
    serve({ [RATES_URL]: { status: 'unavailable', reason: 'refused', http_status: 403 } })
    const refused = renderPanel()
    await screen.findByTestId('terminal-rates-unavailable')
    await expectNoAxeViolations(refused.container)
    cleanup()
    serve({})
    const failed = renderPanel()
    await screen.findByTestId('terminal-rates-error')
    await expectNoAxeViolations(failed.container)
  })

  it('paints no hard-coded color: the panel, its model and its stylesheet use tokens only', () => {
    for (const file of ['RatesPanel.jsx', 'ratesModel.js', 'ratesPanel.module.css']) {
      const src = fs.readFileSync(path.join(HERE, file), 'utf8')
      expect(colourLiteralsIn(src, file), file).toEqual([])
    }
    const css = fs.readFileSync(path.join(HERE, 'ratesPanel.module.css'), 'utf8')
    expect(css).not.toMatch(/--(success|danger|gain|loss)/)                 // no price colors on a yield
    expect(css).not.toMatch(/infinite/)                                      // nothing here animates
    for (const m of css.matchAll(/(?:stroke|fill|color):\s*([^;]+);/g)) expect(m[1].trim()).toMatch(/^(currentColor|none|var\(--[\w-]+\))$/)
  })

  it('reads through the terminal\'s one reader and reports its date through the panel header', () => {
    const src = fs.readFileSync(path.join(HERE, 'RatesPanel.jsx'), 'utf8')
    expect(src).toMatch(/useMarketRead\(RATES_URL/)
    expect(src).toMatch(/usePanelFreshness\(ok \? panelAsOf\(SOURCE, view\.asOf\) : null\)/)
    expect(src).not.toMatch(/setInterval|setTimeout|fetch\(/)
    expect(src).not.toMatch(/echarts|recharts|chart\.js|lightweight-charts/i)
  })
})
