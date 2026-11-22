// LIQ: liquidity. Rails:
//   * loading, a failed read (error with Retry), signed out, a plan without chart data (403), the economic
//     data switched off for this server (404, said in words and never an empty panel), a timeout and an
//     answer that is not the route's shape;
//   * net liquidity: the headline and its Wednesday, the label, the four changes, the sentence, the line
//     and its gaps in words, the next H.4.1; reverse repo from the day before when a Wednesday has none;
//     its history loading, failed (Retry) or not held, while the parts still show;
//   * the parts, each in its own units with its date and change; a name opens the chart;
//   * a missing value and a series not held are words, never 0; every source's credit line once; the
//     header gets the newest release time; tokens only; axe.
// Every value is invented in the routes' real shapes (__fixtures__/liquidityFixture.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import LiquidityPanel, { LIQ_CODE, LIQ_LATEST_URL, LIQ_SOURCE } from './LiquidityPanel'
import { historyUrls } from './liquidityModel'
import { LIQ_NOW_MS, LIQ_TODAY, NEWEST_WED, liqLatest, liqMeta, liqRoutes, plusDays } from './__fixtures__/liquidityFixture'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
function serve(routes) {
  jsonFetcher.mockImplementation((u) => {
    const hit = routes[u]
    if (hit === undefined) return Promise.reject(fail(500))
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([u]) => u))]
const URLS = historyUrls(LIQ_TODAY)

function renderPanel({ setFreshness = vi.fn(), code = null } = {}) {
  const body = <LiquidityPanel />
  const view = render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <PanelFreshnessContext.Provider value={setFreshness}>
          <PanelListContext.Provider value={{ open: vi.fn(), run: vi.fn(), rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
            {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
          </PanelListContext.Provider>
        </PanelFreshnessContext.Provider>
      </SWRConfig>
    </MemoryRouter>,
  )
  return { setFreshness, container: view.container }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const root = () => screen.getByTestId('terminal-liq')
const el = (id) => screen.getByTestId(id)
const text = (id) => el(id).textContent
const wedK = (k) => plusDays(NEWEST_WED, -7 * k)

beforeEach(() => { jsonFetcher.mockReset(); vi.spyOn(Date, 'now').mockReturnValue(LIQ_NOW_MS) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('LIQ states', () => {
  it('shows a loading skeleton and asks the latest read first; the history waits for it', () => {
    serve({ [LIQ_LATEST_URL]: PENDING })
    renderPanel()
    expect(LIQ_CODE).toBe('LIQ')
    expect(screen.getByTestId('terminal-liq-loading')).toBeTruthy()
    expect(root().getAttribute('data-state')).toBe('loading')
    expect(asked()).toEqual([LIQ_LATEST_URL])
  })

  it('a failed read is an error with Retry, and Retry reads again', async () => {
    serve({})
    const { setFreshness } = renderPanel({ code: 'LIQ' })
    const err = await screen.findByTestId('terminal-liq-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The economic data could not be read just now.')
    expect(err.textContent).toContain('Retry, or run LIQ again.')
    expect(setFreshness.mock.calls.every(([r]) => r == null)).toBe(true)
    serve(liqRoutes())
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-liq-parts')).toBeTruthy()
  })

  it('signed out, a timeout, a plan without chart data and the feature switched off each say so; only an error can be retried', async () => {
    for (const [err, kind, state, words] of [
      [fail(401), 'error', 'signed_out', 'You are signed out, so the economic data cannot be read. Sign in again.'],
      [fail(0, { timedOut: true }), 'error', 'timeout', 'The economic data did not answer within 30 seconds.'],
      [fail(403), 'locked', 'plan', 'The economic data needs a paid plan.'],
      [fail(404), 'locked', 'off', 'The economic data is switched off for this server.'],
    ]) {
      serve({ [LIQ_LATEST_URL]: err })
      renderPanel()
      const st = await screen.findByTestId('terminal-liq-error')
      expect(st.getAttribute('data-kind')).toBe(kind)
      expect(root().getAttribute('data-state')).toBe(state)
      expect(st.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' })).toBe(kind === 'error')
      expect(asked()).toEqual([LIQ_LATEST_URL])                    // no history read behind a failed first read
      cleanup()
      jsonFetcher.mockReset()
    }
  })

  it('the feature switched off is said in words, never drawn as an empty panel', async () => {
    serve({ [LIQ_LATEST_URL]: fail(404) })
    renderPanel()
    const st = await screen.findByTestId('terminal-liq-error')
    expect(st.textContent).toContain("The Fed's balance sheet, the Treasury's cash account and the reverse repo figures this panel works from are not served here right now.")
    expect(screen.queryByTestId('terminal-liq-net')).toBeNull()
    expect(screen.queryByTestId('terminal-liq-parts')).toBeNull()
    expect(screen.queryAllByRole('row')).toHaveLength(0)
  })

  it('an answer that is not the route\'s shape is a failed read with Retry', async () => {
    for (const b of [{ items: [] }, { series: 'x' }, []]) {
      serve({ [LIQ_LATEST_URL]: b })
      renderPanel()
      const err = await screen.findByTestId('terminal-liq-error')
      expect(err.textContent).toContain('The economic data could not be read just now.')
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
      cleanup()
    }
  })
})

describe('LIQ net liquidity', () => {
  it('the headline, its Wednesday and the label; the four changes; the sentence; the line; the next H.4.1', async () => {
    serve(liqRoutes())
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-liq-headline')
    expect(asked().sort()).toEqual([LIQ_LATEST_URL, ...Object.values(URLS)].sort())
    expect(text('terminal-liq-headline')).toBe('$6.03TWed Mar 19')
    expect(text('terminal-liq-label')).toBe("UCT calculation from the Fed's and Treasury's own figures: the Fed's total assets minus the "
      + 'Treasury General Account minus overnight reverse repo, on the Wednesday of each H.4.1 week.')
    expect([1, 4, 13, 52].map((w) => text(`terminal-liq-change-${w}`))).toEqual(['1 week: +$7.50B', '4 weeks: +$30.00B', '13 weeks: +$39.00B', '52 weeks: +$78.00B'])
    expect(el('terminal-liq-change-4').getAttribute('title')).toBe('Since Wed Feb 19')
    expect(text('terminal-liq-sentence')).toBe("Net liquidity rose $30.00B over 4 weeks (Feb 19 to Mar 19): the Fed's assets fell $20.00B, "
      + 'the TGA fell $30.00B and reverse repo fell $20.00B.')
    expect(text('terminal-liq-line-words')).toBe('Net liquidity, weekly, Mar 21, 2029 to Mar 19: low $5.90T on Mar 21, 2029, high $6.03T on Mar 19, '
      + 'now $6.03T. 3 of 105 Wednesdays have no value, and the line breaks there.')
    const svg = el('terminal-liq-line').querySelector('svg')
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toBe(text('terminal-liq-line-words'))
    expect(text('terminal-liq-next')).toBe('Next Fed balance sheet (H.4.1): Mar 27, 4:30 PM ET.')
    expect(screen.queryByTestId('terminal-liq-shifted')).toBeNull()
    expect(screen.queryByTestId('terminal-liq-change-why')).toBeNull()
    expect(setFreshness).toHaveBeenCalledWith(expect.objectContaining({ source: LIQ_SOURCE, observedAt: '2031-03-21T13:00:00.000Z' }))
  })

  it('no reverse repo print on the newest Wednesday: the day before is used, and the panel says so', async () => {
    serve(liqRoutes({ edit: { USRRP: (p) => p.filter((x) => x[3] !== NEWEST_WED) } }))
    renderPanel()
    expect((await screen.findByTestId('terminal-liq-shifted')).textContent)
      .toBe('Reverse repo for this week is from Tue Mar 18: there was no print on Wed Mar 19.')
    expect(text('terminal-liq-change-1')).toBe('1 week: +$6.50B')     // Tuesday's print is 1e9 above the Wednesday formula
  })

  it('the newest Wednesday has no value: the headline is the one before, and the newest is named', async () => {
    const drop = [0, 1, 2].map((n) => plusDays(NEWEST_WED, -n))
    serve(liqRoutes({ edit: { USRRP: (p) => p.filter((x) => !drop.includes(x[3])) } }))
    renderPanel()
    expect((await screen.findByTestId('terminal-liq-headline')).textContent).toBe('$6.02TWed Mar 12')
    expect(text('terminal-liq-newest-gap')).toBe('No value yet for Wed Mar 19: reverse repo not held.')
  })

  it('a change whose earlier Wednesday has no value is words, never 0', async () => {
    serve(liqRoutes({ edit: { USTGAFED: (p) => p.map((x) => (x[3] === wedK(13) ? [x[0], null, x[2], x[3], x[4]] : x)) } }))
    renderPanel()
    expect((await screen.findByTestId('terminal-liq-change-13')).textContent).toBe('13 weeks: n/a')
    expect(text('terminal-liq-change-why')).toBe('13 weeks: No value for Wed Dec 18, 2030: the TGA (H.4.1) not held.')
    expect(text('terminal-liq-change-13')).not.toMatch(/\$0|(^|\D)0(\.0+)?$/)
  })

  it('the history loading: the parts show, net liquidity waits with its own skeleton', async () => {
    const routes = liqRoutes()
    for (const s of ['USFEDBAL', 'USTGAFED', 'USRRP']) routes[URLS[s]] = PENDING
    serve(routes)
    renderPanel()
    expect(await screen.findByTestId('terminal-liq-net-loading')).toBeTruthy()
    expect(el('terminal-liq-net').getAttribute('data-state')).toBe('loading')
    expect(await screen.findByTestId('terminal-liq-part-assets')).toBeTruthy()
  })

  it('the history failed: an error with Retry in the net block, the parts still show, and Retry reads it again', async () => {
    const routes = liqRoutes()
    serve({ ...routes, [URLS.USRRP]: fail(500) })
    renderPanel()
    const err = await screen.findByTestId('terminal-liq-net-error')
    expect(err.textContent).toContain('The history behind net liquidity could not be read just now.')
    expect(text('terminal-liq-latest-rrp')).toContain('$151.00B')
    expect(text('terminal-liq-change-rrp')).toBe('change n/aThe history for this change could not be read just now.')
    serve(routes)
    fireEvent.click(within(el('terminal-liq-net')).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-liq-headline')).toBeTruthy()
  })

  it('a history answer that is not the series is a failed read, never an empty line', async () => {
    serve({ ...liqRoutes(), [URLS.USFEDBAL]: { items: [] } })
    renderPanel()
    expect(await screen.findByTestId('terminal-liq-net-error')).toBeTruthy()
    expect(screen.queryByTestId('terminal-liq-line')).toBeNull()
  })

  it('an input the latest read does not hold: net liquidity says which, and its history is never asked', async () => {
    serve(liqRoutes({ latest: liqLatest({ bySymbol: { USRRP: { symbol: 'USRRP', state: 'not_found' } } }) }))
    renderPanel()
    expect((await screen.findByTestId('terminal-liq-net-none')).textContent).toBe('Net liquidity cannot be worked out: reverse repo is not held here.')
    expect(asked()).not.toContain(URLS.USRRP)
    expect(text('terminal-liq-none-rrp')).toBe('Not among the economic series this server publishes.')
    expect(screen.queryByTestId('terminal-liq-open-rrp')).toBeNull()
  })
})

describe('LIQ parts', () => {
  it('each in its own units, with its date and its change, and a name that opens the chart', async () => {
    serve(liqRoutes())
    renderPanel()
    await screen.findByTestId('terminal-liq-parts')
    const rows = [...el('terminal-liq-parts').querySelectorAll('tbody tr')].map((r) => r.getAttribute('data-testid'))
    expect(rows).toEqual(['assets', 'tga_weekly', 'tga_daily', 'rrp', 'reserves', 'm2', 'sofr'].map((k) => `terminal-liq-part-${k}`))
    expect(text('terminal-liq-latest-assets')).toBe('$7.00TWed Mar 19')
    expect(text('terminal-liq-change-assets')).toBe('change -$5.00B1 week, since Mar 12')
    expect(text('terminal-liq-latest-tga_weekly')).toBe('$820.00BWed Mar 19')
    expect(text('terminal-liq-latest-tga_daily')).toBe('$815.00BWed Mar 19')
    expect(text('terminal-liq-change-tga_daily')).toBe('change -$7.50B1 week, since Mar 12')
    expect(text('terminal-liq-latest-rrp')).toBe('$151.00BThu Mar 20')
    expect(text('terminal-liq-change-rrp')).toBe('change -$5.00B1 week, since Mar 13')
    expect(text('terminal-liq-latest-reserves')).toBe('$3.15TWed Mar 19')
    expect(text('terminal-liq-change-reserves')).toBe('change +$30.00B1 week, since Mar 12')
    expect(text('terminal-liq-latest-m2')).toBe('$22.41TJan 2031y/y 4.1% (Jan 2031)')
    expect(text('terminal-liq-change-m2')).toBe('change +$59.50B1 month, since Dec 2030')
    expect(text('terminal-liq-latest-sofr')).toBe('4.30%Thu Mar 20')
    expect(text('terminal-liq-change-sofr')).toBe('change -2 bp1 week, since Mar 13')
    const link = el('terminal-liq-open-tga_daily')
    expect(link.getAttribute('href')).toBe('/charts?sym=ECON%3AUSTGA')
    expect(link.textContent).toBe("Treasury General Account (the Treasury's daily statement)")
  })

  it('a newest period with no figure and a series with nothing published are words, never 0', async () => {
    const latest = liqLatest({
      edit: { USRESBAL: (p) => p.map((x, i, a) => (i === a.length - 1 ? [x[0], null, x[2], x[3], x[4]] : x)) },
      bySymbol: { USSOFR: { symbol: 'USSOFR', state: 'no_data', meta: liqMeta('USSOFR'), points: [], currentness: null, retrieved_at: null } },
    })
    serve(liqRoutes({ latest }))
    renderPanel()
    expect((await screen.findByTestId('terminal-liq-latest-reserves')).textContent).toBe('No figure for Wed Mar 19Wed Mar 19')
    expect(text('terminal-liq-change-reserves')).toBe('change n/aThe newest period has no figure.')
    expect(text('terminal-liq-none-sofr')).toBe('No reading published here yet.')
    expect(asked()).not.toContain(URLS.USSOFR)
    for (const id of ['terminal-liq-latest-reserves', 'terminal-liq-change-reserves', 'terminal-liq-part-sofr']) {
      expect(text(id)).not.toMatch(/(^|[^.\d])0(\.0+)?%?(?![\d.])/)
    }
  })

  it('every source\'s credit line once, in the order the panel shows them, blanks filled', async () => {
    serve(liqRoutes())
    renderPanel()
    const credits = await screen.findAllByTestId('terminal-liq-credit')
    expect(credits.map((c) => c.getAttribute('data-source'))).toEqual(['fed_board', 'fiscaldata', 'nyfed'])
    expect(credits.map((c) => c.textContent)).toEqual(['Invented Board line.', 'Invented Fiscal Data line.',
      'The ON RRP Facility Take-up and Secured Overnight Financing Rate is invented for UCT Intelligence.'])
    expect(text('terminal-liq-footer')).toContain('Net liquidity is a UCT calculation from them')
    expect(text('terminal-liq-footer')).toContain('it is not a forecast')
  })
})

describe('LIQ rails', () => {
  it('has no axe violations with everything, with an input missing, and after a failed read', async () => {
    serve(liqRoutes())
    const ok = renderPanel()
    await screen.findByTestId('terminal-liq-line')
    await expectNoAxeViolations(ok.container)
    cleanup()
    serve(liqRoutes({ latest: liqLatest({ bySymbol: { USRRP: { symbol: 'USRRP', state: 'not_found' } } }) }))
    const thin = renderPanel()
    await screen.findByTestId('terminal-liq-net-none')
    await expectNoAxeViolations(thin.container)
    cleanup()
    serve({ [LIQ_LATEST_URL]: fail(404) })
    const off = renderPanel()
    await screen.findByTestId('terminal-liq-error')
    await expectNoAxeViolations(off.container)
  })

  it('paints no hard-coded colour and no price colour: the panel, its model and its stylesheet use tokens only', () => {
    for (const file of ['LiquidityPanel.jsx', 'liquidityModel.js', 'liquidityPanel.module.css']) {
      const src = fs.readFileSync(path.join(HERE, file), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${file}`, src).map((h) => h.lit), file).toEqual([])
    }
    const css = fs.readFileSync(path.join(HERE, 'liquidityPanel.module.css'), 'utf8')
    expect(css).not.toMatch(/--(success|danger|gain|loss)/)
    expect(css).not.toMatch(/@media|infinite/)
  })

  it('reads through the terminal\'s one reader and reports the data\'s own time through the panel header', () => {
    const src = fs.readFileSync(path.join(HERE, 'LiquidityPanel.jsx'), 'utf8')
    expect(src).toMatch(/useMarketRead\(LIQ_LATEST_URL, \{ refreshInterval: LIQ_POLL_MS \}\)/)
    expect((src.match(/useMarketRead\(/g) || []).length).toBe(6)
    expect(src).toMatch(/usePanelFreshness\(ok \? panelAsOf\(LIQ_SOURCE, view\.newestT\) : null\)/)
    expect(src).not.toMatch(/setInterval|setTimeout|fetch\(/)
    expect(src).not.toContain('USNETLIQ')
    expect(process.env.NODE_ENV).not.toBe('production')
  })
})
