// SEG: one stock's revenue by segment. Rails:
//   * loading, a failed read (error with Retry), signed out, no paid plan (locked, no Retry), a timeout and an
//     answer that is not the route's shape: none is "no segments";
//   * "computing" is said in words and the panel asks again every 3 seconds on its own;
//   * the server's own failed read (neither leg answered) is said with Retry;
//   * a leg the provider's plan does not include says so in words, with no Retry and no table; a leg with no
//     split held is an answer; a failed leg offers Retry;
//   * the lede, the newest period ranked with shares, the periods side by side with a missing figure in words,
//     the two oldest periods folding on a phone, the currency note when none is given;
//   * the view and period chips write `SYM SEG REGION QUARTERLY` back (or switch in state); a new period is a
//     new read; no symbol says how to ask;
//   * the source and the period end in words; no hard-coded color; axe.
// Every symbol, segment name and figure is invented.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import RevenueSegmentsPanel from './RevenueSegmentsPanel'
import { SEG_SOURCE, segUrl } from './revenueSegmentsModel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const seg = (name, revenue, share) => ({ name, revenue, share })
const period = (date, label, segments, over = {}) => ({ date, fiscal_year: date.slice(0, 4), label, currency: 'USD', total: 1e9, segments, cut: false, ...over })
const PRODUCT = { state: 'ok', http_status: null, dropped: 0, cut: false, periods: [
  period('2030-09-28', 'FY2030', [seg('Kettles', 6e8, 60), seg('Lanterns', 3e8, 30), seg('Ropes', 1e8, 10)]),
  period('2029-09-29', 'FY2029', [seg('Kettles', 5e8, 66.67), seg('Lanterns', 2.5e8, 33.33)], { total: 7.5e8 }),
  period('2028-09-30', 'FY2028', [seg('Kettles', 4e8, 100)], { total: 4e8 }),
] }
const REGION = { state: 'ok', http_status: null, dropped: 1, cut: false, periods: [
  period('2030-09-28', 'FY2030', [seg('Northland', 7e8, 70), seg('Southmere', 3e8, 30)], { currency: null }),
] }
const BODY = (over = {}) => ({ status: 'ok', sym: 'QQZA', period: 'annual', read_at: '2031-03-12T14:02:00+00:00', source: SEG_SOURCE,
  check: null, product: PRODUCT, region: REGION, ...over })
const ANNUAL = segUrl('QQZA', 'annual')
const QUARTER = segUrl('QQZA', 'quarter')

const httpError = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status, ...extra })
const PENDING = Symbol('pending')
function serve(routes) {
  jsonFetcher.mockImplementation((u) => {
    const hit = typeof routes[u] === 'function' ? routes[u]() : routes[u]
    if (hit === undefined) return Promise.reject(httpError(500))
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
function renderPanel(props = { sym: 'QQZA' }, { code = null, rerun = vi.fn(), setFreshness = vi.fn() } = {}) {
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run: vi.fn(), rerun, publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}><RevenueSegmentsPanel {...props} /></TerminalPanelContext.Provider>
            : <RevenueSegmentsPanel {...props} />}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { rerun, setFreshness, container: view.container }
}
const frame = () => screen.getByTestId('terminal-seg')
const cells = (tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)
const noTables = () => !screen.queryByTestId('terminal-seg-ranked') && !screen.queryByTestId('terminal-seg-periods')
const lastReport = (setFreshness) => setFreshness.mock.calls.map(([r]) => r).filter(Boolean).pop()
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([u]) => u))]

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('SEG states', () => {
  it('shows a loading skeleton and asks for the stock\'s annual figures', () => {
    serve({ [ANNUAL]: PENDING })
    renderPanel()
    expect(screen.getByTestId('terminal-seg-loading').textContent).toContain('Loading revenue by segment for QQZA')
    expect(asked()).toEqual([ANNUAL])
  })

  it('with no symbol it says how to ask, and reads nothing', () => {
    renderPanel({})
    expect(screen.getByTestId('terminal-seg-no-sym').textContent).toContain('NVDA SEG')
    expect(jsonFetcher).not.toHaveBeenCalled()
  })

  it('a failed read is an error with Retry, never "no segments"; a retry that works fills in', async () => {
    serve({})
    renderPanel()
    const err = await screen.findByTestId('terminal-seg-error')
    expect(err.textContent).toContain('Revenue by segment could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no segments.')
    expect(noTables()).toBe(true)
    serve({ [ANNUAL]: BODY() })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-seg-ranked')).toBeTruthy()
  })

  it('signed out, a timeout, no paid plan and an unreadable answer each say so; only an error can be retried', async () => {
    for (const [hit, kind, words] of [
      [httpError(401), 'error', 'You are signed out, so revenue by segment cannot be read. Sign in again.'],
      [httpError(0, { timedOut: true }), 'error', 'Revenue by segment did not answer within 30 seconds.'],
      [httpError(402), 'locked', 'Revenue by segment needs a paid plan.'],
      [{ status: 'ok', product: PRODUCT }, 'error', 'Revenue by segment came back in a shape this panel cannot read.'],
    ]) {
      serve({ [ANNUAL]: hit })
      renderPanel()
      const box = await screen.findByTestId('terminal-seg-error')
      expect(box.getAttribute('data-kind'), words).toBe(kind)
      expect(box.textContent, words).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), words).toBe(kind === 'error')
      cleanup()
    }
  })

  it('"computing" is said in words, and the panel asks again every 3 seconds until it fills in', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let body = { status: 'computing', sym: 'QQZA', period: 'annual', source: SEG_SOURCE }
    serve({ [ANNUAL]: () => body })
    renderPanel()
    const box = await screen.findByTestId('terminal-seg-computing')
    expect(box.textContent).toContain('Loading, the server is preparing this.')
    expect(box.textContent).toContain('This panel asks again every 3 seconds')
    const before = jsonFetcher.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(3200) })
    expect(jsonFetcher.mock.calls.length).toBeGreaterThan(before)
    body = BODY()
    await act(async () => { await vi.advanceTimersByTimeAsync(3200) })
    await waitFor(() => expect(screen.getByTestId('terminal-seg-ranked')).toBeTruthy())
    const held = jsonFetcher.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
    expect(jsonFetcher.mock.calls.length).toBe(held)
  })

  it('the server\'s own failed read is said with Retry', async () => {
    serve({ [ANNUAL]: { status: 'failed', reason: 'source', sym: 'QQZA', period: 'annual' } })
    renderPanel()
    expect((await screen.findByTestId('terminal-seg-unavailable')).textContent).toContain('could not be read from Financial Modeling Prep just now')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

describe('SEG leg states', () => {
  it('a report the provider\'s plan does not include is said in words, with no Retry and no table', async () => {
    serve({ [ANNUAL]: BODY({ product: { state: 'not_in_plan', http_status: 402, periods: [] } }) })
    renderPanel()
    const box = await screen.findByTestId('terminal-seg-not-in-plan')
    expect(frame().getAttribute('data-state')).toBe('not_in_plan')
    expect(box.getAttribute('data-kind')).toBe('locked')
    expect(box.textContent).toContain('Revenue by product is not available from our data provider.')
    expect(box.textContent).toContain('That is an answer about the source, not a failed read.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(noTables()).toBe(true)
  })

  it('no split held is an answer; a failed leg offers Retry', async () => {
    serve({ [ANNUAL]: BODY({ product: { state: 'none', periods: [] } }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-seg-none')).textContent).toContain('Financial Modeling Prep holds no revenue split by product for QQZA.')
    cleanup()
    serve({ [ANNUAL]: BODY({ product: { state: 'failed', periods: [] } }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-seg-failed')).textContent).toContain('Revenue by product could not be read from Financial Modeling Prep just now.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

describe('SEG the figures', () => {
  it('the lede, the newest period ranked with shares, and the periods side by side', async () => {
    serve({ [ANNUAL]: BODY() })
    const { setFreshness } = renderPanel()
    expect((await screen.findByTestId('terminal-seg-lede')).textContent)
      .toBe('QQZA: revenue by product, FY2030 (period ended Sep 28, 2030). 3 segments listed, $1.00B together.')
    const ranked = within(screen.getByTestId('terminal-seg-ranked')).getAllByTestId('terminal-seg-ranked-row')
    expect(ranked.map(cells)).toEqual([['Kettles', '$600.0M', '60.0%'], ['Lanterns', '$300.0M', '30.0%'], ['Ropes', '$100.0M', '10.0%']])
    const table = screen.getByTestId('terminal-seg-periods')
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Segment', 'FY2030', 'FY2029', 'FY2028'])
    const rows = within(table).getAllByTestId('terminal-seg-periods-row')
    expect(cells(rows[2])).toEqual(['Ropes', '$100.0M', 'Not reported', 'Not reported'])
    // the two oldest periods fold on a phone, header and cell together
    const ths = [...table.querySelectorAll('thead th')]
    expect(ths.map((th) => !!th.className)).toEqual([false, false, false, true])
    expect(lastReport(setFreshness)).toMatchObject({ source: SEG_SOURCE })
    expect(screen.getByTestId('terminal-seg-method').textContent).toContain('A share is the segment\'s part of the segments listed for the period')
  })

  it('by region: a currency that is not given is said, and bare figures are not dollars', async () => {
    serve({ [ANNUAL]: BODY() })
    renderPanel({ sym: 'QQZA', view: 'region' })
    const ranked = within(await screen.findByTestId('terminal-seg-ranked')).getAllByTestId('terminal-seg-ranked-row')
    expect(cells(ranked[0])).toEqual(['Northland', '700.0M', '70.0%'])
    expect(screen.getByTestId('terminal-seg-currency').textContent).toBe('Currency not reported. Figures are as reported.')
    expect(screen.getByTestId('terminal-seg-note').textContent).toContain('1 row in the answer had no date or no segment figure')
    expect(screen.queryByTestId('terminal-seg-periods')).toBeNull()        // one period: no side-by-side table
  })
})

describe('SEG picks', () => {
  it('inside the shell the chips write the stock\'s command back', async () => {
    serve({ [ANNUAL]: BODY() })
    const { rerun } = renderPanel({ sym: 'QQZA' }, { code: 'SEG' })
    await screen.findByTestId('terminal-seg-ranked')
    expect(screen.getByTestId('terminal-seg-view-product').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('terminal-seg-view-region'))
    expect(rerun).toHaveBeenLastCalledWith('QQZA SEG REGION')
    fireEvent.click(screen.getByTestId('terminal-seg-period-quarter'))
    expect(rerun).toHaveBeenLastCalledWith('QQZA SEG QUARTERLY')
  })

  it('outside the shell a chip switches in state; a new period is a new read', async () => {
    serve({ [ANNUAL]: BODY(), [QUARTER]: PENDING })
    renderPanel()
    await screen.findByTestId('terminal-seg-ranked')
    fireEvent.click(screen.getByTestId('terminal-seg-view-region'))
    expect(frame().getAttribute('data-view')).toBe('region')
    fireEvent.click(screen.getByTestId('terminal-seg-period-quarter'))
    expect(screen.getByTestId('terminal-seg-loading')).toBeTruthy()
    expect(asked()).toEqual([ANNUAL, QUARTER])
  })
})

describe('SEG follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['RevenueSegmentsPanel.jsx', 'revenueSegmentsModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('SEG accessibility', () => {
  it('the figures, a report not in the plan and a failed read pass axe (WCAG A and AA)', async () => {
    serve({ [ANNUAL]: BODY() })
    const ok = renderPanel({ sym: 'QQZA' }, { code: 'SEG' })
    await screen.findByTestId('terminal-seg-periods')
    await expectNoAxeViolations(ok.container)
    cleanup()
    serve({ [ANNUAL]: BODY({ product: { state: 'not_in_plan', periods: [] } }) })
    const locked = renderPanel()
    await screen.findByTestId('terminal-seg-not-in-plan')
    await expectNoAxeViolations(locked.container)
    cleanup()
    serve({})
    const failed = renderPanel()
    await screen.findByTestId('terminal-seg-error')
    await expectNoAxeViolations(failed.container)
  })
})
