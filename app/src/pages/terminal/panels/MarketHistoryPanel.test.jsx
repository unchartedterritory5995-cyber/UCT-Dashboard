// MKTH: market history. Rails:
//   * loading, a failed read (error with Retry), signed out, a timeout, not on a paid plan, a switched-off
//     route and an answer that is not the route's shape: none of them is an empty panel;
//   * the first build ("computing") and the first stage (leaders still being worked out) say so and the
//     panel asks again by itself and fills in; an index store with nothing in it is said in words;
//   * the table: every decline newest first, the summary line, the ongoing one "Not yet", a row opens
//     to the rally windows ("not yet", never 0), the leaders through PanelSymbol with the index
//     difference, the sector medians, and the survivorship sentence under EVERY list (ok, too recent,
//     too thin);
//   * the index switch writes `MKTH NDX` back; `MKTH NDX` opens on the Nasdaq-100;
//   * the header gets the data's own date; tokens only; one reader, no polling loop of its own; axe.
// Every value is invented (__fixtures__/marketHistoryFixture.js) in the route's real shape.
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
import MarketHistoryPanel, { MKTH_CODE, MKTH_SOURCE, MKTH_URL } from './MarketHistoryPanel'
import { SURVIVORSHIP_NOTE } from './marketHistoryModel'
import { firstStageAnswer, marketHistoryAnswer } from './__fixtures__/marketHistoryFixture'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
function serve(body) {
  jsonFetcher.mockImplementation((u) => {
    if (u !== MKTH_URL) return Promise.reject(fail(500))
    if (body === PENDING) return new Promise(() => {})
    return body instanceof Error ? Promise.reject(body) : Promise.resolve(body)
  })
}
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([u]) => u))]

function renderPanel({ setFreshness = vi.fn(), code = null, index, rerun = vi.fn(), run = vi.fn() } = {}) {
  const body = <MarketHistoryPanel index={index} />
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run, rerun, publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { setFreshness, rerun, run, container: view.container }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const root = () => screen.getByTestId('terminal-mkth')
const rows = () => screen.getAllByTestId('terminal-mkth-row')
const openRow = (id) => fireEvent.click(screen.getByTestId(`terminal-mkth-open-${id}`))

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('MKTH states', () => {
  it('shows a loading skeleton and asks the one route', () => {
    serve(PENDING)
    renderPanel()
    expect(MKTH_CODE).toBe('MKTH')
    expect(screen.getByTestId('terminal-mkth-loading')).toBeTruthy()
    expect(root().getAttribute('data-state')).toBe('loading')
    expect(asked()).toEqual(['/api/research/market-history'])
  })

  it('a failed read is an error with Retry, and Retry reads again', async () => {
    serve(fail(500))
    const { setFreshness } = renderPanel({ code: 'MKTH' })
    const err = await screen.findByTestId('terminal-mkth-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('Market history could not be read just now.')
    expect(err.textContent).toContain('Retry, or run MKTH again.')
    expect(setFreshness.mock.calls.every(([r]) => r == null)).toBe(true)
    serve(marketHistoryAnswer())
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-mkth-table')).toBeTruthy()
  })

  it('signed out, a timeout, no paid plan and a switched-off route each say so; only an error can be retried', async () => {
    for (const [err, kind, words] of [
      [fail(401), 'error', 'You are signed out, so market history cannot be read. Sign in again.'],
      [fail(0, { timedOut: true }), 'error', 'Market history did not answer within 30 seconds.'],
      [fail(402), 'locked', 'Market history needs a paid plan.'],
      [fail(404), 'locked', 'Market history is not switched on for this server yet.'],
    ]) {
      serve(err)
      renderPanel()
      const state = await screen.findByTestId('terminal-mkth-error')
      expect(state.getAttribute('data-kind')).toBe(kind)
      expect(state.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' })).toBe(kind === 'error')
      cleanup()
    }
  })

  it('an answer that is not the route\'s shape is a failed read with Retry', async () => {
    for (const b of [{ items: [] }, { status: 'ok' }, []]) {
      serve(b)
      renderPanel()
      const err = await screen.findByTestId('terminal-mkth-error')
      expect(err.textContent).toContain('Market history could not be read just now.')
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
      cleanup()
    }
  })

  it('the first build says so, and the panel asks again by itself and fills in', async () => {
    let n = 0
    jsonFetcher.mockImplementation(async () => {
      n += 1
      return n === 1 ? { status: 'computing' } : marketHistoryAnswer()
    })
    renderPanel()
    const working = await screen.findByTestId('terminal-mkth-computing')
    expect(working.textContent).toContain('working out every correction from its stored closes for the first time')
    expect(root().getAttribute('data-state')).toBe('computing')
    await screen.findByTestId('terminal-mkth-table', {}, { timeout: 8000 })
    expect(n).toBeGreaterThanOrEqual(2)
  })

  it('the first stage shows every decline at once and says the leaders are still being worked out', async () => {
    let n = 0
    jsonFetcher.mockImplementation(async () => {
      n += 1
      return n === 1 ? firstStageAnswer() : marketHistoryAnswer()
    })
    renderPanel()
    expect((await screen.findByTestId('terminal-mkth-leaders-computing')).textContent).toContain('still being worked out')
    expect(rows()).toHaveLength(3)
    openRow('SPX-2033-02-14')
    const missing = screen.getByTestId('terminal-mkth-leaders-missing')
    expect(missing.getAttribute('data-kind')).toBe('computing')
    expect(screen.getByTestId('terminal-mkth-survivorship').textContent).toBe(SURVIVORSHIP_NOTE)
    await screen.findByTestId('terminal-mkth-leaders', {}, { timeout: 8000 })
    expect(n).toBeGreaterThanOrEqual(2)
  })

  it('leaders that failed to build say so, and the declines stand', async () => {
    const a = firstStageAnswer()
    a.leaders = { state: 'failed', note: SURVIVORSHIP_NOTE }
    serve(a)
    renderPanel()
    expect((await screen.findByTestId('terminal-mkth-leaders-failed')).textContent).toContain('could not be worked out just now')
    expect(screen.queryByTestId('terminal-mkth-leaders-computing')).toBeNull()
    expect(rows()).toHaveLength(3)
    openRow('SPX-2033-02-14')
    expect(screen.getByTestId('terminal-mkth-leaders-missing').getAttribute('data-kind')).toBe('failed')
    expect(screen.getByTestId('terminal-mkth-survivorship').textContent).toBe(SURVIVORSHIP_NOTE)
  })

  it('no index held, and a failed build, are each said in words with Retry, never as no corrections', async () => {
    serve({ status: 'unavailable', indexes: { SPX: { state: 'not_held' } }, leaders: { state: 'unavailable' } })
    renderPanel()
    const st = await screen.findByTestId('terminal-mkth-unavailable')
    expect(st.textContent).toContain('The index history is not held on this server yet.')
    expect(st.textContent).toContain('That is not the same as no corrections.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    cleanup()
    serve({ status: 'unavailable', reason: 'failed', detail: 'x' })
    renderPanel()
    expect((await screen.findByTestId('terminal-mkth-unavailable')).textContent).toContain('Market history could not be worked out just now.')
  })

  it('one index not held says so, and the other is one pick away', async () => {
    const a = marketHistoryAnswer()
    a.indexes.NDX = { symbol: 'NDX', name: 'Nasdaq-100', state: 'not_held', detail: "UCT does not hold the Nasdaq-100's daily closes on this server yet." }
    serve(a)
    renderPanel({ index: 'NDX' })
    const st = await screen.findByTestId('terminal-mkth-index-not-held')
    expect(st.textContent).toContain("UCT does not hold the Nasdaq-100's daily closes on this server yet.")
    expect(st.textContent).toContain('That is not the same as no corrections in the Nasdaq-100.')
    expect(screen.getByTestId('terminal-mkth-index').value).toBe('NDX')
  })
})

describe('MKTH with a whole answer', () => {
  it('the summary line, every decline newest first, and the header gets the data\'s own date', async () => {
    serve(marketHistoryAnswer())
    const { setFreshness } = renderPanel()
    expect((await screen.findByTestId('terminal-mkth-summary')).textContent).toBe(
      '2 corrections and 1 bear market in the S&P 500 since Jan 2, 2030. Median depth -12.0%; median recovery 127 sessions from the low (2 recovered). One is still below the peak.')
    expect(rows().map((r) => r.getAttribute('data-id'))).toEqual(['SPX-2035-07-16', 'SPX-2033-02-14', 'SPX-2031-04-02'])
    expect(rows().map((r) => r.getAttribute('data-kind'))).toEqual(['correction', 'bear', 'correction'])
    expect(setFreshness).toHaveBeenCalledWith(expect.objectContaining({ source: MKTH_SOURCE, age: { asOfDate: '2035-10-15' } }))
    const [ongoing, bear] = rows()
    expect(within(ongoing).getByTestId('terminal-mkth-kind').textContent).toBe('Correction, still below the peak')
    expect(within(ongoing).getByTestId('terminal-mkth-recovered').textContent).toBe('Not yetnow -6.4% from the peak')
    expect(bear.textContent).toContain('Feb 14, 2033 to Jun 10, 2033')
    expect(bear.textContent).toContain('-26.9%')
    expect(bear.textContent).toContain('81 sessions')
    expect(within(bear).getByTestId('terminal-mkth-recovered').textContent).toBe('Mar 21, 2034194 sessions from the low')
    expect(bear.textContent).toContain('+21.4%')                     // 3 months on
    expect(within(ongoing).getAllByText('not yet')).toHaveLength(1)   // its 3 months have not passed: never 0
    expect(screen.getByTestId('terminal-mkth-definition').textContent).toContain('a double bottom is one decline')
    expect(screen.getByTestId('terminal-mkth-method').textContent).toContain('A record of what happened, not a forecast.')
    expect(screen.getByTestId('terminal-mkth-method').textContent).toContain('the Nasdaq-100 is the closest index it holds')
  })

  it('a row opens to the levels, the rally windows and the leaders, and closes again', async () => {
    serve(marketHistoryAnswer())
    const { run } = renderPanel({ code: 'MKTH' })
    await screen.findByTestId('terminal-mkth-table')
    const btn = screen.getByTestId('terminal-mkth-open-SPX-2033-02-14')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    openRow('SPX-2033-02-14')
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(btn.getAttribute('aria-controls')).toBe('terminal-mkth-detail-SPX-2033-02-14')
    const detail = screen.getByTestId('terminal-mkth-detail')
    expect(detail.id).toBe('terminal-mkth-detail-SPX-2033-02-14')
    expect(screen.getByTestId('terminal-mkth-levels').textContent).toBe('Peak 6,120.40 on Feb 14, 2033; low 4,471.85 on Jun 10, 2033, 81 sessions later.')
    expect(screen.getByTestId('terminal-mkth-rally-1').textContent).toBe('+8.7% (to Jul 11, 2033)')
    expect(screen.getByTestId('terminal-mkth-rally-12').textContent).toBe('+33.9% (to Jun 12, 2034)')
    expect(screen.getByTestId('terminal-mkth-leaders-line').textContent).toBe(
      'The 25 stocks that rose most in the 63 sessions after the low (Jun 10, 2033 to Sep 9, 2033), from 2,844 stocks priced on both days. The S&P 500 over the same days: +21.4%.')
    const leaders = screen.getAllByTestId('terminal-mkth-leader')
    expect(leaders).toHaveLength(25)
    expect(leaders[0].textContent).toContain('QZAA')
    expect(leaders[0].textContent).toContain('Technology')
    expect(leaders[0].textContent).toContain('+188.4%')
    expect(leaders[0].textContent).toContain('+167.0 pts')
    expect(leaders[4].textContent).toContain('Sector not held')
    expect(within(leaders[2]).getByTestId('terminal-mkth-check').textContent).toBe('check the chart')
    expect(screen.getByTestId('terminal-mkth-check-note').textContent).toContain('more than 40% in one session')
    // a ticker loads the linked panels through PanelSymbol
    fireEvent.click(within(leaders[0]).getByTestId('panel-symbol-QZAA'))
    expect(run).toHaveBeenCalledWith('$QZAA')
    const sectors = screen.getAllByTestId('terminal-mkth-sector')
    expect(sectors.map((s) => s.textContent)).toEqual(['Technology+31.6%412', 'Industrials+24.2%377', 'Healthcare+18.9%455',
      'Financial Services+12.1%389', 'Energy-2.4%140'])
    expect(screen.getByTestId('terminal-mkth-sectors-line').textContent).toContain('71 stocks with no sector held are left out.')
    expect(screen.getByTestId('terminal-mkth-survivorship').textContent).toBe(SURVIVORSHIP_NOTE)
    // one row open at a time; the same button closes it
    openRow('SPX-2031-04-02')
    expect(screen.getAllByTestId('terminal-mkth-detail')).toHaveLength(1)
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    openRow('SPX-2031-04-02')
    expect(screen.queryByTestId('terminal-mkth-detail')).toBeNull()
  })

  it('a low too recent, and a low with too few stocks, say why, and still carry the survivorship sentence', async () => {
    serve(marketHistoryAnswer())
    renderPanel()
    await screen.findByTestId('terminal-mkth-table')
    openRow('SPX-2035-07-16')
    let missing = screen.getByTestId('terminal-mkth-leaders-missing')
    expect(missing.getAttribute('data-kind')).toBe('not_yet')
    expect(missing.textContent).toBe('Not yet: 63 sessions have not passed since this low (29 sessions so far).')
    expect(screen.getByTestId('terminal-mkth-survivorship').textContent).toBe(SURVIVORSHIP_NOTE)
    for (const m of [3, 6, 12]) expect(screen.getByTestId(`terminal-mkth-rally-${m}`).getAttribute('data-kind')).toBe('notyet')
    expect(screen.getByTestId('terminal-mkth-rally-1').getAttribute('data-kind')).toBe('value')
    openRow('SPX-2031-04-02')
    missing = screen.getByTestId('terminal-mkth-leaders-missing')
    expect(missing.getAttribute('data-kind')).toBe('thin')
    expect(missing.textContent).toBe("Too few stocks in UCT's price history at this low to list leaders: 58 priced on both days.")
    expect(screen.getByTestId('terminal-mkth-survivorship').textContent).toBe(SURVIVORSHIP_NOTE)
    expect(screen.queryByTestId('terminal-mkth-leaders')).toBeNull()
  })

  it('the index switch shows the Nasdaq-100 from the same answer and writes MKTH NDX back', async () => {
    serve(marketHistoryAnswer())
    const { rerun } = renderPanel({ code: 'MKTH' })
    await screen.findByTestId('terminal-mkth-table')
    fireEvent.change(screen.getByTestId('terminal-mkth-index'), { target: { value: 'NDX' } })
    expect(rerun).toHaveBeenCalledWith('MKTH NDX')
    expect(rows().map((r) => r.getAttribute('data-id'))).toEqual(['NDX-2034-11-06'])
    expect(screen.getByTestId('terminal-mkth-summary').textContent).toContain('in the Nasdaq-100 since Nov 6, 2034')
    expect(asked()).toEqual([MKTH_URL])                                  // no new read
    openRow('NDX-2034-11-06')
    expect(screen.getByTestId('terminal-mkth-levels').textContent).toContain('The peak is the first close in the history UCT holds; the real peak may be earlier.')
    expect(screen.getByTestId('terminal-mkth-leaders').getAttribute('aria-label')).toContain('Nasdaq-100')
    expect(screen.getByRole('columnheader', { name: 'vs Nasdaq-100' })).toBeTruthy()
    fireEvent.change(screen.getByTestId('terminal-mkth-index'), { target: { value: 'SPX' } })
    expect(rerun).toHaveBeenLastCalledWith('MKTH')
  })

  it('MKTH NDX opens on the Nasdaq-100; an unknown index word falls back to the S&P 500', async () => {
    serve(marketHistoryAnswer())
    renderPanel({ index: 'NDX' })
    await screen.findByTestId('terminal-mkth-table')
    expect(root().getAttribute('data-index')).toBe('NDX')
    cleanup()
    serve(marketHistoryAnswer())
    renderPanel({ index: 'DOW' })
    await screen.findByTestId('terminal-mkth-table')
    expect(root().getAttribute('data-index')).toBe('SPX')
  })

  it('a later read that fails keeps the last answer and says so', async () => {
    let n = 0
    jsonFetcher.mockImplementation(async () => {
      n += 1
      if (n === 1) return firstStageAnswer()
      throw fail(503)
    })
    renderPanel()
    await screen.findByTestId('terminal-mkth-leaders-computing')
    expect((await screen.findByTestId('terminal-mkth-stale-read', {}, { timeout: 8000 })).textContent).toContain('Showing the last read.')
    expect(rows()).toHaveLength(3)
  })
})

describe('MKTH rails', () => {
  it('has no axe violations with a row open, while computing, and after a failed read', async () => {
    serve(marketHistoryAnswer())
    const ok = renderPanel()
    await screen.findByTestId('terminal-mkth-table')
    openRow('SPX-2033-02-14')
    await expectNoAxeViolations(ok.container)
    cleanup()
    serve({ status: 'computing' })
    const working = renderPanel()
    await screen.findByTestId('terminal-mkth-computing')
    await expectNoAxeViolations(working.container)
    cleanup()
    serve(fail(500))
    const failed = renderPanel()
    await screen.findByTestId('terminal-mkth-error')
    await expectNoAxeViolations(failed.container)
  })

  it('paints no hard-coded color: the panel, its model and its stylesheet use tokens only, with no screen query', () => {
    for (const file of ['MarketHistoryPanel.jsx', 'marketHistoryModel.js', 'marketHistoryPanel.module.css']) {
      const src = fs.readFileSync(path.join(HERE, file), 'utf8')
      expect(colourLiteralsIn(src, file), file).toEqual([])
    }
    const css = fs.readFileSync(path.join(HERE, 'marketHistoryPanel.module.css'), 'utf8')
    expect(css).not.toMatch(/--(success|danger|gain|loss)/)
    expect(css).not.toMatch(/@media|infinite/)
  })

  it('reads through the terminal\'s one reader and reports the data\'s date through the panel header', () => {
    const src = fs.readFileSync(path.join(HERE, 'MarketHistoryPanel.jsx'), 'utf8')
    expect(src).toMatch(/useMarketRead\(MKTH_URL/)
    expect(src).toMatch(/usePanelFreshness\(ok \? panelAsOf\(MKTH_SOURCE, view\.dataThrough\) : null\)/)
    expect(src).not.toMatch(/setInterval|setTimeout|fetch\(/)
    expect(process.env.NODE_ENV).not.toBe('production')
  })
})
