// OIL: the EIA's weekly oil report. Rails:
//   * loading, a failed read (error with Retry), signed out, a plan without chart data (403), the economic
//     data switched off for this server (404, said in words and never an empty panel), a timeout and an
//     answer that is not the route's shape;
//   * the top line: the build or draw in plain words, the week, the release day, the next report from the
//     calendar; each row's figures in their own units, the week before and the change, the same week a
//     year ago, the date; a name opens the chart; the 2-year line and its words; the credit line;
//   * a history is asked only for a series the latest read says is held; a failed history is said, with
//     Retry, and never drawn as an empty history; a missing value is words, never 0;
//   * the header gets the newest release time; tokens only; axe.
// Every value is invented in the routes' real shapes (__fixtures__/oilFixture.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import OilPanel, { OIL_CODE, OIL_LATEST_URL, OIL_SOURCE } from './OilPanel'
import { OIL_SYMBOLS, historyUrls } from './oilModel'
import { OIL_TODAY, oilHistory, oilLatest } from './__fixtures__/oilFixture'
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
const URLS = historyUrls(OIL_TODAY)
/** The latest read and every history read, with `over` replacing any of them. */
const routes = (over = {}) => ({
  [OIL_LATEST_URL]: oilLatest(),
  ...Object.fromEntries(OIL_SYMBOLS.map((s) => [URLS[s], oilHistory(s)])),
  ...over,
})

function renderPanel({ setFreshness = vi.fn(), code = null } = {}) {
  const body = <OilPanel />
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
const root = () => screen.getByTestId('terminal-oil')
const el = (id) => screen.getByTestId(id)
const text = (id) => el(id).textContent

// Thursday 2031-03-20, noon in New York: the fixtures' "today"
const NOW_MS = Date.parse('2031-03-20T16:00:00Z')
beforeEach(() => { jsonFetcher.mockReset(); vi.spyOn(Date, 'now').mockReturnValue(NOW_MS) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('OIL states', () => {
  it('shows a loading skeleton and asks only the latest read until it answers', () => {
    serve({ [OIL_LATEST_URL]: PENDING })
    renderPanel()
    expect(OIL_CODE).toBe('OIL')
    expect(el('terminal-oil-loading')).toBeTruthy()
    expect(root().getAttribute('data-state')).toBe('loading')
    expect(asked()).toEqual([OIL_LATEST_URL])
  })

  it('a failed read is an error with Retry, and Retry reads again', async () => {
    serve({})
    const { setFreshness } = renderPanel({ code: 'OIL' })
    const err = await screen.findByTestId('terminal-oil-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The economic data could not be read just now.')
    expect(err.textContent).toContain('Retry, or run OIL again.')
    expect(setFreshness.mock.calls.every(([r]) => r == null)).toBe(true)
    serve(routes())
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-oil-table')).toBeTruthy()
  })

  it('signed out, a timeout, a plan without chart data (403) and the feature switched off each say so; only an error can be retried', async () => {
    for (const [err, kind, state, words] of [
      [fail(401), 'error', 'signed_out', 'You are signed out, so the economic data cannot be read. Sign in again.'],
      [fail(0, { timedOut: true }), 'error', 'timeout', 'The economic data did not answer within 30 seconds.'],
      [fail(403), 'locked', 'plan', 'The economic data needs a paid plan.'],
      [fail(404), 'locked', 'off', 'The economic data is switched off for this server.'],
    ]) {
      serve({ [OIL_LATEST_URL]: err })
      renderPanel()
      const st = await screen.findByTestId('terminal-oil-error')
      expect(st.getAttribute('data-kind')).toBe(kind)
      expect(root().getAttribute('data-state')).toBe(state)
      expect(st.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' })).toBe(kind === 'error')
      cleanup()
    }
  })

  it('the feature switched off is said in words, never drawn as an empty panel, and no history is asked', async () => {
    serve({ [OIL_LATEST_URL]: fail(404) })
    renderPanel()
    const st = await screen.findByTestId('terminal-oil-error')
    expect(st.textContent).toContain("The EIA's weekly oil figures this panel shows (stocks, production, refining, pump prices) are not served here right now.")
    expect(screen.queryByTestId('terminal-oil-table')).toBeNull()
    expect(screen.queryByTestId('terminal-oil-head')).toBeNull()
    expect(screen.queryAllByRole('row')).toHaveLength(0)
    expect(asked()).toEqual([OIL_LATEST_URL])
  })

  it('an answer that is not the route\'s shape is a failed read with Retry', async () => {
    for (const b of [{ items: [] }, { series: 'x' }, []]) {
      serve({ [OIL_LATEST_URL]: b })
      renderPanel()
      const err = await screen.findByTestId('terminal-oil-error')
      expect(err.textContent).toContain('The economic data could not be read just now.')
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
      cleanup()
    }
  })
})

describe('OIL with every series', () => {
  it('the top line: the draw in plain words, the week, the release, the next report from the calendar', async () => {
    serve(routes())
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-oil-headline')
    expect(text('terminal-oil-headline')).toBe('Draw of 2.3 million barrels')
    expect(text('terminal-oil-week')).toBe('U.S. crude oil stocks, excluding the Strategic Petroleum Reserve, in the week to Fri Mar 14. Released Wed Mar 19.')
    expect(text('terminal-oil-derived')).toBe("The weekly change is a UCT calculation from the EIA's own stock figures.")
    expect(text('terminal-oil-next')).toBe('Next EIA weekly petroleum report: Wed Mar 26, 10:30 AM ET.')
    expect(text('terminal-oil-pump-next')).toBe('Next EIA pump price survey: Tue Mar 25, ~5:00 PM ET (est.).')
    expect(setFreshness).toHaveBeenCalledWith(expect.objectContaining({ source: OIL_SOURCE, observedAt: '2031-03-19T14:30:00.000Z' }))
  })

  it('each row: the latest week and its date, the week before and the change, the same week a year ago', async () => {
    serve(routes())
    renderPanel()
    await waitFor(() => expect(text('terminal-oil-yearago-crude')).toContain('436.1M bbl'))
    const heads = [...el('terminal-oil-table').querySelectorAll('th[scope="rowgroup"]')].map((h) => h.textContent)
    expect(heads).toEqual(['Inventories', 'Production and refining', 'Pump prices (U.S. average)'])
    expect(text('terminal-oil-latest-crude')).toBe('431.2M bblwk 3/14, released Mar 19')
    expect(text('terminal-oil-prior-crude')).toBe('433.6M bblchange -2.3M bbl')
    expect(text('terminal-oil-yearago-crude')).toBe('436.1M bblwk 3/15, 2030change since then -4.8M bbl')
    expect(el('terminal-oil-prior-crude').getAttribute('title')).toBe('The week before: wk 3/7')
    expect(text('terminal-oil-latest-crude_change')).toBe('-2.3M bbldrawwk 3/14, released Mar 19')
    expect(text('terminal-oil-prior-crude_change')).toBe('+2.6M bblbuild')
    expect(text('terminal-oil-yearago-crude_change')).toBe('+5.6M bblbuildwk 3/15, 2030')
    expect(text('terminal-oil-derived-crude_change')).toBe('UCT calculation')
    expect(screen.queryByTestId('terminal-oil-change-crude_change')).toBeNull()       // no change of a change
    expect(text('terminal-oil-latest-production')).toBe('13.81M bbl/dwk 3/14, released Mar 19')
    expect(text('terminal-oil-prior-production')).toBe('13.79M bbl/dchange +22K bbl/d')
    expect(text('terminal-oil-prior-refining')).toBe('87.6%change +0.8 pts')
    expect(text('terminal-oil-latest-gas_price')).toBe('$3.284/galwk 3/17, released Mar 18')
    expect(text('terminal-oil-prior-gas_price')).toBe('$3.312/galchange -$0.028/gal')
    expect(text('terminal-oil-yearago-gas_price')).toBe('$3.517/galwk 3/18, 2030change since then -$0.233/gal')
    expect(text('terminal-oil-yearago-diesel_price')).toBe('Not held for a year ago')
  })

  it('a name opens the series on the chart the way an economic symbol opens there', async () => {
    serve(routes())
    renderPanel()
    const link = await screen.findByTestId('terminal-oil-open-spr')
    expect(link.getAttribute('href')).toBe('/charts?sym=ECON%3AUSSPR')
    expect(link.textContent).toBe('Strategic Petroleum Reserve')
    expect(within(el('terminal-oil-group-pump')).getAllByRole('link').map((a) => a.getAttribute('href')))
      .toEqual(['/charts?sym=ECON%3AUSGASPRICE', '/charts?sym=ECON%3AUSDIESELPRICE'])
  })

  it('two years of crude stocks as a line in its own range, with its words; the credit line once, with its publication date', async () => {
    serve(routes())
    renderPanel()
    const fig = await screen.findByTestId('terminal-oil-line')
    const svg = fig.querySelector('svg')
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toContain('low 412.3M bbl (week to Aug 3, 2029), high 452.1M bbl (week to Jul 19, 2030), latest 431.2M bbl.')
    expect(fig.querySelectorAll('path')).toHaveLength(1)                              // no zero line: zero is not in its range
    expect(fig.querySelector('path').getAttribute('d').match(/M/g)).toHaveLength(2)   // the missing week breaks it
    expect(text('terminal-oil-line-words')).toContain('1 of 105 weeks have no figure here, and the line breaks there.')
    expect(fig.textContent).toContain('412.3M bbl to 452.1M bbl')
    const credits = screen.getAllByTestId('terminal-oil-credit')
    expect(credits.map((c) => [c.getAttribute('data-source'), c.textContent])).toEqual([['eia', 'Invented EIA credit (Mar 19, 2031).']])
    expect(text('terminal-oil-footer')).toContain('except the weekly build or draw, a UCT calculation')
  })

  it('asks the latest read once, then one history per held series', async () => {
    serve(routes())
    renderPanel()
    await waitFor(() => expect(text('terminal-oil-yearago-diesel_price')).toBe('Not held for a year ago'))
    expect(asked().sort()).toEqual([OIL_LATEST_URL, ...OIL_SYMBOLS.map((s) => URLS[s])].sort())
  })
})

describe('OIL histories', () => {
  it('a series the latest read says is not held is never asked for its history (a 404 there would read as the feature off)', async () => {
    const latest = oilLatest({ bySymbol: { USSPR: { symbol: 'USSPR', state: 'not_found' }, USDIESELPRICE: { ...oilLatest().series[8], state: 'no_data', points: [] } } })
    serve(routes({ [OIL_LATEST_URL]: latest }))
    renderPanel()
    expect((await screen.findByTestId('terminal-oil-none-spr')).textContent).toBe('Not among the economic series this server publishes.')
    expect(text('terminal-oil-none-diesel_price')).toBe('No reading published here yet.')
    await waitFor(() => expect(text('terminal-oil-yearago-crude')).toContain('436.1M bbl'))
    expect(asked()).not.toContain(URLS.USSPR)
    expect(asked()).not.toContain(URLS.USDIESELPRICE)
    expect(screen.queryByTestId('terminal-oil-open-spr')).toBeNull()                 // nothing to open
  })

  it('a failed history is said, with Retry, never drawn as an empty history; the latest weeks still show; Retry asks again', async () => {
    serve(routes({ [URLS.USGASINV]: fail(500), [URLS.USCRUDEINV]: fail(500) }))
    renderPanel()
    expect((await screen.findByTestId('terminal-oil-history-failed')).textContent).toContain('Some of the history behind the year-ago figures could not be read just now.')
    expect(text('terminal-oil-yearago-gasoline')).toBe('The week a year ago could not be read just now')
    expect(text('terminal-oil-latest-gasoline')).toBe('238.4M bblwk 3/14, released Mar 19')
    expect(text('terminal-oil-prior-gasoline')).toBe('236.9M bblchange +1.5M bbl')
    expect(el('terminal-oil-line-error').textContent).toContain('The history of crude oil stocks could not be read just now.')
    expect(screen.queryByTestId('terminal-oil-line')).toBeNull()
    serve(routes())
    fireEvent.click(screen.getByRole('button', { name: 'Retry the history' }))       // every failed history, crude's too
    await waitFor(() => expect(text('terminal-oil-yearago-gasoline')).toContain('241.7M bbl'))
    expect(screen.queryByTestId('terminal-oil-history-failed')).toBeNull()
    expect(await screen.findByTestId('terminal-oil-line')).toBeTruthy()
  })

  it('the line has its own Retry, which asks crude stocks\' history again', async () => {
    serve(routes({ [URLS.USCRUDEINV]: fail(500) }))
    renderPanel()
    const err = await screen.findByTestId('terminal-oil-line-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(text('terminal-oil-yearago-crude')).toBe('The week a year ago could not be read just now')
    const before = jsonFetcher.mock.calls.filter(([u]) => u === URLS.USCRUDEINV).length
    serve(routes())
    fireEvent.click(within(err).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-oil-line')).toBeTruthy()
    expect(jsonFetcher.mock.calls.filter(([u]) => u === URLS.USCRUDEINV).length).toBe(before + 1)
    await waitFor(() => expect(text('terminal-oil-yearago-crude')).toContain('436.1M bbl'))
  })

  it('a history the server does not hold (404, the feature being on) says not held, and the line says so', async () => {
    serve(routes({ [URLS.USCRUDEINV]: fail(404), [URLS.USREFUTIL]: fail(404) }))
    renderPanel()
    await waitFor(() => expect(text('terminal-oil-yearago-refining')).toBe('Not held for a year ago'))
    expect(text('terminal-oil-line-none')).toBe('The history of crude oil stocks is not held here, so there is no line to draw.')
    expect(screen.queryByTestId('terminal-oil-history-failed')).toBeNull()
  })
})

describe('OIL never draws a missing number as 0', () => {
  it('a week with no figure, a top line with no figure, and the next report not held are words', async () => {
    const base = oilLatest()
    const nul = (s) => ({ ...s, points: s.points.map((p, i, a) => (i === a.length - 1 ? [p[0], null, p[2], p[3], p[4]] : p)) })
    const unheld = (s) => ({ ...s, currentness: { ...s.currentness, next_release: { date: null, time: null, precision: 'unknown' } } })
    const latest = oilLatest({ bySymbol: { USGASINV: nul(base.series[2]), USCRUDEINVCHG: unheld(nul(base.series[1])), USCRUDEINV: unheld(base.series[0]) } })
    const gasHist = oilHistory('USGASINV')
    serve(routes({ [OIL_LATEST_URL]: latest, [URLS.USGASINV]: { ...gasHist, points: gasHist.points.slice(0, -1) } }))
    renderPanel()
    expect((await screen.findByTestId('terminal-oil-head-none')).textContent).toBe('No figure for the week to Fri Mar 14. Released Wed Mar 19.')
    expect(screen.queryByTestId('terminal-oil-headline')).toBeNull()
    expect(text('terminal-oil-next')).toBe('EIA weekly petroleum report: next release not held.')
    await waitFor(() => expect(text('terminal-oil-yearago-gasoline')).toContain('241.7M bbl'))
    expect(text('terminal-oil-latest-gasoline')).toBe('No figure for wk 3/14wk 3/14, released Mar 19')
    expect(screen.queryByTestId('terminal-oil-change-gasoline')).toBeNull()            // no change without two figures
    expect(text('terminal-oil-yearago-gasoline')).toBe('241.7M bblwk 3/15, 2030')
    expect(text('terminal-oil-latest-crude_change')).toBe('No figure for wk 3/14wk 3/14, released Mar 19')
    for (const id of ['terminal-oil-latest-gasoline', 'terminal-oil-latest-crude_change', 'terminal-oil-head']) {
      expect(text(id)).not.toMatch(/(^|[^.\d/,])0(\.0+)?(M| bbl|%)?(?![\d.,/])/)
    }
  })
})

describe('OIL rails', () => {
  it('has no axe violations with every series, with rows and histories missing, and after a failed read', async () => {
    serve(routes())
    const ok = renderPanel()
    await screen.findByTestId('terminal-oil-line')
    await expectNoAxeViolations(ok.container)
    cleanup()
    serve(routes({ [OIL_LATEST_URL]: oilLatest({ bySymbol: { USSPR: { symbol: 'USSPR', state: 'not_found' } } }), [URLS.USCRUDEINV]: fail(500), [URLS.USGASINV]: fail(500) }))
    const thin = renderPanel()
    await screen.findByTestId('terminal-oil-history-failed')
    await expectNoAxeViolations(thin.container)
    cleanup()
    serve({ [OIL_LATEST_URL]: fail(404) })
    const off = renderPanel()
    await screen.findByTestId('terminal-oil-error')
    await expectNoAxeViolations(off.container)
  })

  it('paints no hard-coded colour and no price colour: the panel, its model and its stylesheet use tokens only', () => {
    for (const file of ['OilPanel.jsx', 'oilModel.js', 'oilPanel.module.css']) {
      const src = fs.readFileSync(path.join(HERE, file), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${file}`, src).map((h) => h.lit), file).toEqual([])
    }
    const css = fs.readFileSync(path.join(HERE, 'oilPanel.module.css'), 'utf8')
    expect(css).not.toMatch(/--(success|danger|gain|loss)/)
    expect(css).not.toMatch(/@media|infinite/)
  })

  it('reads through the terminal\'s one reader and reports the data\'s own time through the panel header', () => {
    const src = fs.readFileSync(path.join(HERE, 'OilPanel.jsx'), 'utf8')
    expect(src).toMatch(/useMarketRead\(OIL_LATEST_URL, \{ refreshInterval: OIL_POLL_MS \}\)/)
    expect(src).toMatch(/usePanelFreshness\(ok \? panelAsOf\(OIL_SOURCE, view\.newestT\) : null\)/)
    expect(src).not.toMatch(/setInterval|setTimeout|fetch\(/)
    // one history read per series, each asked only when wanted
    for (const s of OIL_SYMBOLS) expect(src).toContain(`${s}: useMarketRead(at('${s}'), opts)`)
    expect(process.env.NODE_ENV).not.toBe('production')
  })
})
