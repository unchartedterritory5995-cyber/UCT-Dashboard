// FCTX: how one stock trades against six style factors. Rails:
//   * no ticker asks for one; loading; a failed read (error with Retry); signed out, a timeout, not on a
//     paid plan and a switched-off route; not a ticker (400); an answer that is not the route's shape;
//     a stock with no stored prices, a busy server and a failed build (or no market fund) each say so;
//   * the four sections in order, each with its own as-of; the plain line and the loadings it is built
//     from; the loadings table with its bars, t and change; the fit pairs; the funds and the method;
//   * too few sessions is words with no table; unstable loadings and a possible unadjusted split warn;
//     an alternative fund and a factor left out are said; a later failed read keeps the last answer;
//   * the header gets the data's own date; tokens only; one reader, no polling loop of its own; axe;
//     screen-reader text adds no width (no visually hidden copy inside a table cell).
// Every value is invented (__fixtures__/factorExposureFixture.js) in the route's real shape.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import FactorExposurePanel from './FactorExposurePanel'
import { COMPUTING_POLL_MS, FCTX_CODE, FCTX_SOURCE, HELD_POLL_MS, fctxPollMs, fctxRead, fctxUrl } from './factorExposureModel'
import { WARMING_TITLE } from './marketRead'
import { fctxAnswer } from './__fixtures__/factorExposureFixture'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
const URL_NVDA = '/api/research/factor-exposure/NVDA'
function serve(body, url = URL_NVDA) {
  jsonFetcher.mockImplementation((u) => {
    if (u !== url) return Promise.reject(fail(500))
    if (body === PENDING) return new Promise(() => {})
    return body instanceof Error ? Promise.reject(body) : Promise.resolve(body)
  })
}
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([u]) => u))]

function renderPanel({ setFreshness = vi.fn(), code = null, sym = 'NVDA', run = vi.fn() } = {}) {
  const body = <FactorExposurePanel sym={sym} />
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run, rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { setFreshness, container: view.container, run }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const root = () => screen.getByTestId('terminal-fctx')
const textOf = (id) => screen.getByTestId(id).textContent

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('FCTX states', () => {
  it('without a ticker it asks for one and reads nothing', () => {
    renderPanel({ sym: '', code: 'FCTX' })
    expect(screen.getByText('FCTX needs a ticker.')).toBeTruthy()
    expect(jsonFetcher).not.toHaveBeenCalled()
  })

  it('shows a loading skeleton and asks the one route for the ticker', () => {
    serve(PENDING)
    renderPanel()
    expect(FCTX_CODE).toBe('FCTX')
    expect(fctxUrl('NVDA')).toBe(URL_NVDA)
    expect(screen.getByTestId('terminal-fctx-loading')).toBeTruthy()
    expect(asked()).toEqual([URL_NVDA])
  })

  it('a failed read is an error with Retry, and Retry reads again', async () => {
    serve(fail(500))
    const { setFreshness } = renderPanel({ code: 'FCTX' })
    const err = await screen.findByTestId('terminal-fctx-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The factor exposure could not be read just now.')
    expect(err.textContent).toContain('Retry, or run NVDA FCTX again.')
    expect(setFreshness.mock.calls.every(([r]) => r == null)).toBe(true)
    serve(fctxAnswer())
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-fctx-reading')).toBeTruthy()
  })

  it('signed out, a timeout, no paid plan and a switched-off route each say so; only an error can be retried', async () => {
    for (const [err, kind, words] of [
      [fail(401), 'error', 'You are signed out, so the factor exposure cannot be read. Sign in again.'],
      [fail(0, { timedOut: true }), 'error', 'The factor exposure did not answer within 30 seconds.'],
      [fail(402), 'locked', 'The factor exposure needs a paid plan.'],
      [fail(404), 'locked', 'The factor exposure is not switched on for this server yet.'],
    ]) {
      serve(err)
      renderPanel()
      const state = await screen.findByTestId('terminal-fctx-error')
      expect(state.getAttribute('data-kind')).toBe(kind)
      expect(state.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' })).toBe(kind === 'error')
      cleanup()
    }
  })

  it('a symbol the server refuses (400) asks for a ticker; an answer that is not the route\'s shape is a failed read', async () => {
    serve(fail(400), '/api/research/factor-exposure/%24%24')
    renderPanel({ sym: '$$', code: 'FCTX' })
    expect((await screen.findByTestId('terminal-fctx-bad-symbol')).textContent).toContain('Type one first, e.g. NVDA FCTX')
    cleanup()
    for (const b of [{ items: [] }, { status: 'pending' }, []]) {
      serve(b)
      renderPanel()
      expect((await screen.findByTestId('terminal-fctx-error')).textContent).toContain('The factor exposure for NVDA could not be read just now.')
      cleanup()
    }
  })

  it('a stock with no stored prices, a busy server, no market fund and a failed build each say so', async () => {
    serve({ status: 'not_held', symbol: 'NVDA', detail: 'UCT holds no daily prices for NVDA.' })
    renderPanel()
    const none = await screen.findByTestId('terminal-fctx-not-held')
    expect(none.textContent).toContain('UCT holds no daily prices for NVDA.')
    expect(none.textContent).toContain('That is not the same as NVDA having no history.')
    cleanup()
    serve({ status: 'busy', symbol: 'NVDA', detail: 'The server is busy working out factor exposures. Try again in a moment.' })
    renderPanel()
    expect((await screen.findByTestId('terminal-fctx-busy')).textContent).toContain('Try again in a moment.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    cleanup()
    serve({ status: 'unavailable', symbol: 'NVDA', reason: 'no_market_fund', detail: 'The market fund (SPY or IVV) is not held on this server just now, so no factor exposure can be worked out.' })
    renderPanel()
    expect((await screen.findByTestId('terminal-fctx-unavailable')).textContent).toContain('The market fund (SPY or IVV) is not held')
    cleanup()
    serve({ status: 'unavailable', symbol: 'NVDA', reason: 'failed', detail: 'The factor exposure for NVDA could not be worked out just now.' })
    renderPanel()
    expect((await screen.findByTestId('terminal-fctx-unavailable')).textContent).toContain('could not be worked out just now')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

describe('FCTX sections', () => {
  it('draws the four sections in order, each with its own as-of, and reports the data\'s date to the header', async () => {
    serve(fctxAnswer())
    const { setFreshness } = renderPanel({ code: 'FCTX' })
    await screen.findByTestId('terminal-fctx-reading')
    const ids = [...root().querySelectorAll('section')].map((s) => s.getAttribute('data-testid'))
    expect(ids).toEqual(['terminal-fctx-reading', 'terminal-fctx-loadings', 'terminal-fctx-fit', 'terminal-fctx-method'])
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'How it trades', 'Loadings, now and a year earlier', 'How much the factors explain', 'Method and funds'])
    expect(textOf('terminal-fctx-reading-asof')).toBe('As of the close of Nov 20, 2026.')
    expect(textOf('terminal-fctx-loadings-asof')).toBe('Now: 252 sessions, Dec 4, 2025 to Nov 20, 2026. A year earlier: 252 sessions, Dec 17, 2024 to Dec 3, 2025.')
    expect(textOf('terminal-fctx-fit-asof')).toBe('As of the close of Nov 20, 2026.')
    expect(textOf('terminal-fctx-method-asof')).toBe('Funds and stock through the close of Nov 20, 2026.')
    const last = setFreshness.mock.calls.map(([r]) => r).filter(Boolean).at(-1)
    expect(last.source).toBe(FCTX_SOURCE)
    expect(last.age.asOfDate).toBe('2026-11-20')
  })

  it('section 1: the plain line, what it is built from, a year earlier, and that it is not a forecast', async () => {
    serve(fctxAnswer())
    renderPanel()
    expect((await screen.findByTestId('terminal-fctx-line')).textContent).toBe('NVDA trades like a high-momentum growth stock with more market sensitivity than the S&P 500.')
    expect(textOf('terminal-fctx-basis')).toBe('Built only from the loadings with a t-statistic above 2: market, growth vs value, momentum. Too uncertain to read: size, quality, low volatility.')
    expect(textOf('terminal-fctx-then-line')).toBe('A year earlier: NVDA trades like a high-quality growth stock with more market sensitivity than the S&P 500.')
    expect(textOf('terminal-fctx-descriptive')).toContain('a description, not a forecast')
    for (const id of ['terminal-fctx-unstable', 'terminal-fctx-check', 'terminal-fctx-funds-note']) expect(screen.queryByTestId(id)).toBeNull()
  })

  it('section 2: one row per factor with the loading, its bar, its t and the change from a year earlier', async () => {
    serve(fctxAnswer())
    renderPanel()
    const table = await screen.findByTestId('terminal-fctx-table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(
      ['market', 'size', 'growth', 'momentum', 'quality', 'lowvol'].map((k) => `terminal-fctx-row-${k}`))
    expect(rows.map((r) => r.getAttribute('data-clears'))).toEqual(['true', 'false', 'true', 'true', 'false', 'false'])
    expect(within(table).getAllByRole('rowheader').map((h) => h.textContent)).toEqual([
      'Marketcorrelation +0.63',
      expect.stringMatching(/^Size\+ small caps, - large capscorrelation [+-]\d\.\d{2}$/),
      expect.stringMatching(/^Growth vs value\+ growth, - valuecorrelation [+-]\d\.\d{2}$/),
      expect.stringMatching(/^Momentum/), expect.stringMatching(/^Quality/), expect.stringMatching(/^Low volatility/)])
    expect(textOf('terminal-fctx-now-market')).toBe('+1.53t 14.7, above 2')
    expect(textOf('terminal-fctx-now-size')).toBe('-0.10t -0.6, too uncertain')
    expect(textOf('terminal-fctx-then-momentum')).toMatch(/^\+0\.\d{2}t [\d.]+, too uncertainchange \+0\.71, beyond the noise \(t 3\.2\)$/)
    const bar = screen.getByTestId('terminal-fctx-now-market-bar')
    expect(bar.getAttribute('data-dir')).toBe('pos')
    expect(bar.style.width).toBe('38.2%')                                    // 1.528 on a scale of 2, half the track
    expect(screen.getByTestId('terminal-fctx-now-size-bar').getAttribute('data-dir')).toBe('neg')
    expect(textOf('terminal-fctx-loadings-method')).toContain('only above 2 (either sign) is it read, under that it is too uncertain')
    expect(textOf('terminal-fctx-loadings-method')).toContain('The bars share one scale (2.0 at either end)')
  })

  it('section 3: the fit pairs now and a year earlier, with the constant\'s uncertainty', async () => {
    serve(fctxAnswer())
    renderPanel()
    await screen.findByTestId('terminal-fctx-fit-now')
    expect(textOf('terminal-fctx-fit-now-explained')).toBe('57.1% of its daily variance (R-squared 0.57, adjusted 0.56)')
    expect(textOf('terminal-fctx-fit-now-own')).toBe('42.9%: moves the factors do not explain')
    expect(textOf('terminal-fctx-fit-now-vsone')).toBe('t 5.1 against 1: more sensitive to the market than the S&P 500.')
    expect(textOf('terminal-fctx-fit-now-constant')).toMatch(/a year \([+-][\d.]+% a day\); t -?[\d.]+, (too uncertain to read|above 2)$/)
    expect(textOf('terminal-fctx-fit-now-vif')).toBe('1.1 (quality), under 5')
    expect(screen.getByRole('heading', { level: 4 }).textContent).toBe('A year earlier')
    expect(within(screen.getByTestId('terminal-fctx-fit-then')).getAllByRole('term').map((t) => t.textContent)).toEqual(['Explained by the factors', 'Its own part', 'Volatility, a year'])
  })

  it('section 4: each factor\'s spread, its funds loading the board on a click, and the method in words', async () => {
    serve(fctxAnswer())
    const { run } = renderPanel({ code: 'FCTX' })
    const funds = await screen.findByTestId('terminal-fctx-funds')
    expect(run).not.toHaveBeenCalled()
    expect(within(funds).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['Market', 'Size', 'Growth vs value', 'Momentum', 'Quality', 'Low volatility'])
    expect(textOf('terminal-fctx-fund-size')).toBe('SizeIWM minus SPYIWM: 564 closes read, through Nov 20, 2026SPY: 564 closes read, through Nov 20, 2026')
    expect(textOf('terminal-fctx-fund-market')).toBe('MarketSPYSPY: 564 closes read, through Nov 20, 2026')
    expect(textOf('terminal-fctx-fund-growth')).toContain('IWF minus IWD')
    fireEvent.click(within(screen.getByTestId('terminal-fctx-fund-growth')).getByRole('button', { name: 'Load IWD' }))
    expect(run).toHaveBeenCalledWith('$IWD')
    const text = textOf('terminal-fctx-method-text')
    expect(text).toContain("An ordinary least-squares regression of NVDA's daily return on the six spreads (a constant included), over the newest 252 sessions")
    expect(text).toContain('so a day missing anywhere never counts as a zero')
    expect(text).toContain('a variance inflation factor above 5 marks the loadings unstable')
    expect(textOf('terminal-fctx-source')).toBe("From UCT's stored daily prices: settled sessions only, split-adjusted closes, price returns; the newest 563 sessions of NVDA from Sep 25, 2024 through Nov 20, 2026. Worked out by the server from what it already holds, once a session.")
  })

  it('too few common sessions is words with no table and no reading', async () => {
    const b = fctxAnswer()
    b.now = { state: 'short', needed: 200, held: 150, unit: 'returns' }
    b.then = { state: 'short', needed: 200, held: 0, unit: 'returns' }
    b.change = null
    b.reading = null
    b.reading_then = null
    serve(b)
    renderPanel()
    expect((await screen.findByTestId('terminal-fctx-line')).textContent).toBe('No reading for NVDA: Needs 200 common sessions; UCT holds 150.')
    expect(screen.queryByTestId('terminal-fctx-table')).toBeNull()
    expect(textOf('terminal-fctx-no-loadings')).toBe('Needs 200 common sessions; UCT holds 150.')
    expect(textOf('terminal-fctx-fit-short')).toBe('Needs 200 common sessions; UCT holds 150.')
    expect(textOf('terminal-fctx-fit-then-short')).toBe('Needs 200 common sessions; UCT holds none.')
    expect(root().textContent).not.toMatch(/\+0\.00|R-squared 0\.00/)
    expect(screen.queryByTestId('terminal-fctx-basis')).toBeNull()
  })

  it('unstable loadings and a possible unadjusted split warn; an alternative fund and a left-out factor are said', async () => {
    const b = fctxAnswer()
    b.now.unstable = true
    b.now.max_vif = { key: 'momentum', value: 6.34 }
    b.now.check = ['2026-06-02']
    b.factors[2] = { ...b.factors[2], state: 'substituted', funds: ['VUG', 'VTV'] }
    b.factors[4] = { ...b.factors[4], state: 'dropped', funds: null }
    b.fund_checks.push({ symbol: 'VUG', state: 'ok', closes: 564, first: '2024-09-24', last: '2026-11-20', full: true },
      { symbol: 'VTV', state: 'ok', closes: 564, first: '2024-09-24', last: '2026-11-20', full: true },
      { symbol: 'SPHQ', state: 'not_held', closes: 0 })
    b.fund_checks.find((c) => c.symbol === 'IWD').state = 'not_held'
    b.fund_checks.find((c) => c.symbol === 'QUAL').state = 'not_held'
    serve(b)
    renderPanel()
    expect((await screen.findByTestId('terminal-fctx-unstable')).textContent).toBe('The factors overlap: the largest variance inflation factor is 6.3 (momentum), above 5, so these loadings are unstable: a small change in the sessions can move them a lot. Read them with care.')
    expect(textOf('terminal-fctx-check')).toContain('A one-session move of more than 40% on Jun 2, 2026')
    expect(textOf('terminal-fctx-funds-note')).toBe('Alternative funds used: VUG and VTV for IWF and IWD. Left out of the model, no fund held with enough history: quality.')
    expect(textOf('terminal-fctx-fit-now-vif')).toBe('6.3 (momentum), above 5: unstable')
    expect(screen.getByTestId('terminal-fctx-fund-growth').getAttribute('data-state')).toBe('substituted')
    expect(textOf('terminal-fctx-fund-growth')).toContain('VUG minus VTVstands in for IWF minus IWD, which is not held with enough history')
    expect(textOf('terminal-fctx-fund-quality')).toContain('Left outleft out: neither QUAL nor SPHQ is held with enough history')
    expect(textOf('terminal-fctx-fund-quality')).toContain('QUAL: not held on this server')
  })

  it('the first ask being worked out says the server is preparing it, asks again by itself, and stops once it is ready', async () => {
    // speed pass 2 (2026-11-24): the server answers `computing` at once while it works the stock out
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let n = 0
      jsonFetcher.mockImplementation(async () => {
        n += 1
        return n === 1 ? { status: 'computing', symbol: 'NVDA' } : fctxAnswer()
      })
      renderPanel()
      const working = await screen.findByTestId('terminal-fctx-computing')
      expect(working.textContent).toBe(WARMING_TITLE)
      expect(working.getAttribute('role')).toBe('status')
      expect(root().getAttribute('data-state')).toBe('computing')
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
      expect(n).toBe(1)
      await vi.advanceTimersByTimeAsync(COMPUTING_POLL_MS + 100)
      await screen.findByTestId('terminal-fctx-table')
      expect(n).toBe(2)
      await vi.advanceTimersByTimeAsync(COMPUTING_POLL_MS * 3)
      expect(n).toBe(2)                                                    // ready: back to the half-hour pace
    } finally {
      vi.useRealTimers()
    }
  })

  it('the pace: soon while the stock is being worked out, else once a half hour', () => {
    expect(fctxPollMs(fctxRead({ status: 'computing', symbol: 'NVDA' }))).toBe(COMPUTING_POLL_MS)
    expect(fctxPollMs(fctxRead(fctxAnswer()))).toBe(HELD_POLL_MS)
    expect(fctxPollMs(fctxRead({ status: 'busy' }))).toBe(HELD_POLL_MS)
    expect(fctxPollMs(fctxRead(undefined))).toBe(HELD_POLL_MS)
  })

  it('asks again after half an hour; a later read that fails keeps the last answer and says so', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let n = 0
      jsonFetcher.mockImplementation(async () => {
        n += 1
        if (n === 1) return fctxAnswer()
        throw fail(503)
      })
      renderPanel()
      await screen.findByTestId('terminal-fctx-reading')
      expect(n).toBe(1)
      await vi.advanceTimersByTimeAsync(HELD_POLL_MS + 1000)
      expect((await screen.findByTestId('terminal-fctx-stale-read')).textContent).toBe('The factor exposure could not be read just now. Showing the last read.')
      expect(n).toBe(2)
      expect(screen.getByTestId('terminal-fctx-table')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('FCTX rails', () => {
  it('has no axe violations with every section and after a failed read', async () => {
    serve(fctxAnswer())
    const ok = renderPanel()
    await screen.findByTestId('terminal-fctx-table')
    await expectNoAxeViolations(ok.container)
    cleanup()
    serve(fail(500))
    const failed = renderPanel()
    await screen.findByTestId('terminal-fctx-error')
    await expectNoAxeViolations(failed.container)
  })

  it('paints no hard-coded color, no green or red on a loading: tokens only, with no screen query', () => {
    for (const file of ['FactorExposurePanel.jsx', 'factorExposureModel.js', 'factorExposurePanel.module.css']) {
      const src = fs.readFileSync(path.join(HERE, file), 'utf8')
      expect(colourLiteralsIn(src, file), file).toEqual([])
    }
    const css = fs.readFileSync(path.join(HERE, 'factorExposurePanel.module.css'), 'utf8')
    expect(css).not.toMatch(/--(success|danger|gain|loss|up|down)/)
    expect(css).not.toMatch(/@media|infinite/)
    expect(fs.readFileSync(path.join(HERE, 'FactorExposurePanel.jsx'), 'utf8')).not.toMatch(/styles\.(up|down)\b/)
  })

  it('reads through the terminal\'s one reader and reports the data\'s date through the panel header', () => {
    const src = fs.readFileSync(path.join(HERE, 'FactorExposurePanel.jsx'), 'utf8')
    expect(src).toMatch(/useMarketRead\(fctxUrl\(s\), \{ refreshInterval: \(latest\) => fctxPollMs\(fctxRead\(latest\?\.body\)\) \}\)/)
    expect(src).toMatch(/usePanelFreshness\(ok \? panelAsOf\(FCTX_SOURCE, view\.dataThrough\) : null\)/)
    expect(src).not.toMatch(/setInterval|setTimeout|fetch\(/)
    expect(src).not.toMatch(/srOnly|visually-?hidden/i)
    expect(process.env.NODE_ENV).not.toBe('production')
  })
})
