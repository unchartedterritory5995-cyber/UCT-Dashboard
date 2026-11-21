// ECON: the economy board. Rails:
//   * loading, a failed read (error with Retry), signed out, a plan without chart data (403), the
//     economic data switched off for this server (404, said in words and never an empty board), a
//     timeout and an answer that is not the route's shape;
//   * every theme in order; each row's value in its own units, the print before, the change, the
//     period, the release day and the next release from the calendar; a name opens the chart;
//   * a missing value, a series not held and a series with nothing published are words, never 0;
//   * the releases ahead, soonest first; every source's credit line once; the header gets the
//     newest release time; tokens only; axe.
// Every value is invented in the route's real shape (__fixtures__/economyFixture.js).
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
import EconomyPanel, { ECON_CODE, ECON_LATEST_URL, ECON_SOURCE } from './EconomyPanel'
import { econAnswer, econSeries } from './__fixtures__/economyFixture'
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

function renderPanel({ setFreshness = vi.fn(), code = null } = {}) {
  const body = <EconomyPanel />
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
const root = () => screen.getByTestId('terminal-econ')
const el = (id) => screen.getByTestId(id)
const text = (id) => el(id).textContent

// Thursday 2031-03-20, noon in New York: the fixtures' "today"
const NOW_MS = Date.parse('2031-03-20T16:00:00Z')
beforeEach(() => { jsonFetcher.mockReset(); vi.spyOn(Date, 'now').mockReturnValue(NOW_MS) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('ECON states', () => {
  it('shows a loading skeleton and asks the one route, for every series at once', () => {
    serve({ [ECON_LATEST_URL]: PENDING })
    renderPanel()
    expect(ECON_CODE).toBe('ECON')
    expect(screen.getByTestId('terminal-econ-loading')).toBeTruthy()
    expect(root().getAttribute('data-state')).toBe('loading')
    expect(asked()).toEqual([ECON_LATEST_URL])
    expect(ECON_LATEST_URL.startsWith('/api/econ/latest?symbols=USCPIYOY,USCPIMOM,')).toBe(true)
  })

  it('a failed read is an error with Retry, and Retry reads again', async () => {
    serve({})
    const { setFreshness } = renderPanel({ code: 'ECON' })
    const err = await screen.findByTestId('terminal-econ-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The economic data could not be read just now.')
    expect(err.textContent).toContain('Retry, or run ECON again.')
    expect(setFreshness.mock.calls.every(([r]) => r == null)).toBe(true)
    serve({ [ECON_LATEST_URL]: econAnswer() })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-econ-table')).toBeTruthy()
  })

  it('signed out, a timeout, a plan without chart data and the feature switched off each say so; only an error can be retried', async () => {
    for (const [err, kind, state, words] of [
      [fail(401), 'error', 'signed_out', 'You are signed out, so the economic data cannot be read. Sign in again.'],
      [fail(0, { timedOut: true }), 'error', 'timeout', 'The economic data did not answer within 30 seconds.'],
      [fail(403), 'locked', 'plan', 'The economic data needs a paid plan.'],
      [fail(404), 'locked', 'off', 'The economic data is switched off for this server.'],
    ]) {
      serve({ [ECON_LATEST_URL]: err })
      renderPanel()
      const st = await screen.findByTestId('terminal-econ-error')
      expect(st.getAttribute('data-kind')).toBe(kind)
      expect(root().getAttribute('data-state')).toBe(state)
      expect(st.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' })).toBe(kind === 'error')
      cleanup()
    }
  })

  it('the feature switched off is said in words, never drawn as an empty board', async () => {
    serve({ [ECON_LATEST_URL]: fail(404) })
    renderPanel()
    const st = await screen.findByTestId('terminal-econ-error')
    expect(st.textContent).toContain('The official releases this board shows (CPI, jobs, GDP, housing, rates) are not served here right now.')
    expect(screen.queryByTestId('terminal-econ-table')).toBeNull()
    expect(screen.queryByTestId('terminal-econ-ahead')).toBeNull()
    expect(screen.queryAllByRole('row')).toHaveLength(0)
  })

  it('an answer that is not the route\'s shape is a failed read with Retry', async () => {
    for (const b of [{ items: [] }, { series: 'x' }, []]) {
      serve({ [ECON_LATEST_URL]: b })
      renderPanel()
      const err = await screen.findByTestId('terminal-econ-error')
      expect(err.textContent).toContain('The economic data could not be read just now.')
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
      cleanup()
    }
  })
})

describe('ECON with every series', () => {
  it('the themes in order, each row with its latest print, the print before, the change, the period and the dates', async () => {
    serve({ [ECON_LATEST_URL]: econAnswer() })
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-econ-table')
    const heads = [...el('terminal-econ-table').querySelectorAll('th[scope="rowgroup"]')].map((h) => h.textContent)
    expect(heads).toEqual(['Inflation', 'Jobs', 'Growth and spending', 'Housing', 'Rates and money'])
    expect(text('terminal-econ-latest-cpi')).toBe('2.9%Feb 2031m/m 0.4%')
    expect(text('terminal-econ-prior-cpi')).toBe('2.7%change +0.2 pts')
    expect(text('terminal-econ-next-cpi')).toBe('Released Mar 12Next Apr 10, 8:30 AM ET')
    expect(text('terminal-econ-measure-cpi')).toBe('Change from a year earlier, UCT calculation')
    expect(text('terminal-econ-latest-claims')).toBe('214,000wk 3/15')
    expect(text('terminal-econ-prior-claims')).toBe('221,000change -7,000')
    expect(text('terminal-econ-latest-starts')).toBe('1,355,000Feb 2031')
    expect(text('terminal-econ-prior-starts')).toBe('1,402,000change -3.4%')
    expect(text('terminal-econ-prior-ten_year')).toBe('4.21%change -4 bp')
    expect(text('terminal-econ-next-ten_year')).toBe('Released Mar 18Next Mar 21, 4:15 PM ET')
    expect(el('terminal-econ-prior-cpi').getAttribute('title')).toBe('The print before: Jan 2031')
    expect(setFreshness).toHaveBeenCalledWith(expect.objectContaining({ source: ECON_SOURCE, observedAt: '2031-03-20T12:30:00.000Z' }))
  })

  it('a name opens the series on the chart the way an economic symbol opens there', async () => {
    serve({ [ECON_LATEST_URL]: econAnswer() })
    renderPanel()
    const link = await screen.findByTestId('terminal-econ-open-payrolls')
    expect(link.getAttribute('href')).toBe('/charts?sym=ECON%3AUSNFPCHG')
    expect(link.textContent).toBe('Nonfarm payrolls')
    expect(within(el('terminal-econ-theme-rates')).getAllByRole('link').map((a) => a.getAttribute('href')))
      .toEqual(['/charts?sym=ECON%3AUSEFFR', '/charts?sym=ECON%3AUST10Y'])
  })

  it('the releases ahead: soonest first, grouped by time, daily rates and later dates left out', async () => {
    serve({ [ECON_LATEST_URL]: econAnswer() })
    renderPanel()
    const items = await screen.findAllByTestId('terminal-econ-ahead-item')
    expect(items.map((i) => i.textContent)).toEqual([
      'Tue Mar 25, 9:00 AM ET (est.): House prices (FHFA)',
      'Tue Mar 25, 10:00 AM ET: New home sales',
      'Wed Mar 26, 8:30 AM ET: PCE prices, Core PCE prices, Personal income, Personal spending',
      'Thu Mar 27, 8:30 AM ET: Initial jobless claims, Real GDP',
    ])
    expect(el('terminal-econ-ahead').querySelector('h3').textContent).toBe('Releases in the next 7 days')
  })

  it('every source\'s credit line once, in the order the board shows them, blanks filled', async () => {
    serve({ [ECON_LATEST_URL]: econAnswer() })
    renderPanel()
    const credits = await screen.findAllByTestId('terminal-econ-credit')
    expect(credits.map((c) => c.getAttribute('data-source'))).toEqual(['bls', 'bea', 'dol', 'fed_board', 'census', 'fhfa', 'nyfed'])
    expect(credits[0].textContent).toBe('Invented BLS line, read on 2031-03-20.')
    expect(credits[6].textContent).toBe('The Effective Federal Funds Rate is invented for UCT Intelligence.')
    expect(text('terminal-econ-footer')).toContain('A row marked UCT calculation is a change UCT works out')
  })

  it('a theme says what it lacks', async () => {
    serve({ [ECON_LATEST_URL]: econAnswer() })
    renderPanel()
    expect((await screen.findByTestId('terminal-econ-missing-growth')).textContent)
      .toBe('Retail sales: not among the economic series this server publishes.')
  })
})

describe('ECON never draws a missing number as 0', () => {
  it('a period with no figure, a series not served and one with nothing published are words', async () => {
    const cpi = econSeries('USCPIYOY', { name: 'CPI YoY %', op: 'yoy_pct',
      points: [[1928669400, 2.7, '2031-01-01', '2031-01-28', 'V'], [1931085000, null, '2031-02-01', '2031-02-28', 'V']],
      next: { date: '2031-04-10', time: '08:30', tz: 'America/New_York', precision: 'exact' } })
    serve({ [ECON_LATEST_URL]: econAnswer({ bySymbol: { USCPIYOY: cpi, USUNRATE: { symbol: 'USUNRATE', state: 'not_found' } } }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-econ-latest-cpi')).textContent).toBe('No figure for Feb 2031Feb 2031m/m 0.4%')
    expect(text('terminal-econ-prior-cpi')).toBe('2.7%')                     // no change without two prints
    expect(screen.queryByTestId('terminal-econ-change-cpi')).toBeNull()
    expect(text('terminal-econ-none-unemployment')).toBe('Not among the economic series this server publishes.')
    expect(screen.queryByTestId('terminal-econ-open-unemployment')).toBeNull()      // nothing to open
    expect(text('terminal-econ-row-new_homes')).toContain('No reading published here yet.')
    expect(text('terminal-econ-row-new_homes')).toContain('Next Mar 25, 10:00 AM ET')
    for (const id of ['terminal-econ-latest-cpi', 'terminal-econ-row-unemployment', 'terminal-econ-row-new_homes']) {
      expect(text(id)).not.toMatch(/(^|[^.\d])0(\.0+)?%?(?![\d.])/)
    }
  })

  it('a next release the calendar does not hold, and a release due and not in, are said', async () => {
    const pce = { ...econAnswer().series.find((s) => s.symbol === 'USPCEPIYOY') }
    pce.currentness = { ...pce.currentness, state: 'DELAYED', next_release: { date: null, time: null, tz: 'America/New_York', precision: 'unknown' } }
    serve({ [ECON_LATEST_URL]: econAnswer({ bySymbol: { USPCEPIYOY: pce } }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-econ-next-pce')).textContent).toContain('Next release date not held')
    expect(text('terminal-econ-note-pce')).toBe('Delayed: the newest release has not arrived')
  })
})

describe('ECON rails', () => {
  it('has no axe violations with every series, with rows missing, and after a failed read', async () => {
    serve({ [ECON_LATEST_URL]: econAnswer() })
    const ok = renderPanel()
    await screen.findByTestId('terminal-econ-table')
    await expectNoAxeViolations(ok.container)
    cleanup()
    serve({ [ECON_LATEST_URL]: econAnswer({ bySymbol: { USUNRATE: { symbol: 'USUNRATE', state: 'not_found' }, USCPIYOY: null } }) })
    const thin = renderPanel()
    await screen.findByTestId('terminal-econ-none-unemployment')
    await expectNoAxeViolations(thin.container)
    cleanup()
    serve({ [ECON_LATEST_URL]: fail(404) })
    const off = renderPanel()
    await screen.findByTestId('terminal-econ-error')
    await expectNoAxeViolations(off.container)
  })

  it('paints no hard-coded colour and no price colour: the panel, its model and its stylesheet use tokens only', () => {
    for (const file of ['EconomyPanel.jsx', 'economyModel.js', 'economyPanel.module.css']) {
      const src = fs.readFileSync(path.join(HERE, file), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${file}`, src).map((h) => h.lit), file).toEqual([])
    }
    const css = fs.readFileSync(path.join(HERE, 'economyPanel.module.css'), 'utf8')
    expect(css).not.toMatch(/--(success|danger|gain|loss)/)
    expect(css).not.toMatch(/@media|infinite/)
  })

  it('reads through the terminal\'s one reader and reports the data\'s own time through the panel header', () => {
    const src = fs.readFileSync(path.join(HERE, 'EconomyPanel.jsx'), 'utf8')
    expect(src).toMatch(/useMarketRead\(ECON_LATEST_URL, \{ refreshInterval: ECON_POLL_MS \}\)/)
    expect(src).toMatch(/usePanelFreshness\(ok \? panelAsOf\(ECON_SOURCE, view\.newestT\) : null\)/)
    expect(src).not.toMatch(/setInterval|setTimeout|fetch\(/)
    expect(process.env.NODE_ENV).not.toBe('production')
  })
})
