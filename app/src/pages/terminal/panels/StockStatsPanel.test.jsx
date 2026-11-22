// STAT: one stock's statistics. Rails:
//   * no ticker asks for one; loading; a failed read (error with Retry); signed out, a timeout, not on a
//     paid plan and a switched-off route; not a ticker (400); an answer that is not the route's shape;
//     a stock with no stored prices, a busy server and a failed build each say so in words;
//   * the five sections in order, each with its own as-of; every number through the shared words;
//     a statistic with too little history is words; the market's corrections still being worked out
//     say so and the panel asks again by itself and fills in; their not-held and failed states;
//   * the best and worst moves and a drawdown that hold a suspect one-session move carry the mark;
//   * the header gets the data's own date; tokens only; one reader, no polling loop of its own; axe.
// Every value is invented (__fixtures__/stockStatsFixture.js) in the route's real shape.
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
import StockStatsPanel from './StockStatsPanel'
import { STAT_CODE, STAT_SOURCE, statUrl } from './stockStatsModel'
import { statAnswer } from './__fixtures__/stockStatsFixture'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
const URL_NVDA = '/api/research/stock-stats/NVDA'
function serve(body, url = URL_NVDA) {
  jsonFetcher.mockImplementation((u) => {
    if (u !== url) return Promise.reject(fail(500))
    if (body === PENDING) return new Promise(() => {})
    return body instanceof Error ? Promise.reject(body) : Promise.resolve(body)
  })
}
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([u]) => u))]

function renderPanel({ setFreshness = vi.fn(), code = null, sym = 'NVDA', run = vi.fn(), open = vi.fn() } = {}) {
  const body = <StockStatsPanel sym={sym} />
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run, rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { setFreshness, run, open, container: view.container }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const root = () => screen.getByTestId('terminal-stat')
const fact = (key) => screen.getByTestId(key).textContent

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('STAT states', () => {
  it('without a ticker it asks for one and reads nothing', () => {
    renderPanel({ sym: '', code: 'STAT' })
    expect(screen.getByText('STAT needs a ticker.')).toBeTruthy()
    expect(jsonFetcher).not.toHaveBeenCalled()
  })

  it('shows a loading skeleton and asks the one route for the ticker', () => {
    serve(PENDING)
    renderPanel()
    expect(STAT_CODE).toBe('STAT')
    expect(statUrl('NVDA')).toBe(URL_NVDA)
    expect(screen.getByTestId('terminal-stat-loading')).toBeTruthy()
    expect(asked()).toEqual([URL_NVDA])
  })

  it('a failed read is an error with Retry, and Retry reads again', async () => {
    serve(fail(500))
    const { setFreshness } = renderPanel({ code: 'STAT' })
    const err = await screen.findByTestId('terminal-stat-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('Stock statistics could not be read just now.')
    expect(err.textContent).toContain('Retry, or run NVDA STAT again.')
    expect(setFreshness.mock.calls.every(([r]) => r == null)).toBe(true)
    serve(statAnswer())
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-stat-volatility')).toBeTruthy()
  })

  it('signed out, a timeout, no paid plan and a switched-off route each say so; only an error can be retried', async () => {
    for (const [err, kind, words] of [
      [fail(401), 'error', 'You are signed out, so stock statistics cannot be read. Sign in again.'],
      [fail(0, { timedOut: true }), 'error', 'Stock statistics did not answer within 30 seconds.'],
      [fail(402), 'locked', 'Stock statistics needs a paid plan.'],
      [fail(404), 'locked', 'Stock statistics is not switched on for this server yet.'],
    ]) {
      serve(err)
      renderPanel()
      const state = await screen.findByTestId('terminal-stat-error')
      expect(state.getAttribute('data-kind')).toBe(kind)
      expect(state.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' })).toBe(kind === 'error')
      cleanup()
    }
  })

  it('a symbol the server refuses (400) asks for a ticker; an answer that is not the route\'s shape is a failed read', async () => {
    serve(fail(400), '/api/research/stock-stats/%24%24')
    renderPanel({ sym: '$$', code: 'STAT' })
    expect((await screen.findByTestId('terminal-stat-bad-symbol')).textContent).toContain('Type one first, e.g. NVDA STAT')
    cleanup()
    for (const b of [{ items: [] }, { status: 'computing' }, []]) {
      serve(b)
      renderPanel()
      const err = await screen.findByTestId('terminal-stat-error')
      expect(err.textContent).toContain('Stock statistics for NVDA could not be read just now.')
      cleanup()
    }
  })

  it('a stock with no stored prices, a busy server and a failed build each say so, never an empty panel', async () => {
    serve({ status: 'not_held', symbol: 'NVDA', detail: 'UCT holds no daily prices for NVDA.' })
    renderPanel()
    const none = await screen.findByTestId('terminal-stat-not-held')
    expect(none.textContent).toContain('UCT holds no daily prices for NVDA.')
    expect(none.textContent).toContain('That is not the same as NVDA having no history.')
    cleanup()
    serve({ status: 'busy', symbol: 'NVDA', detail: 'The server is busy working out stock statistics. Try again in a moment.' })
    renderPanel()
    expect((await screen.findByTestId('terminal-stat-busy')).textContent).toContain('Try again in a moment.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    cleanup()
    serve({ status: 'unavailable', symbol: 'NVDA', reason: 'failed', detail: 'Stock statistics for NVDA could not be worked out just now.' })
    renderPanel()
    const un = await screen.findByTestId('terminal-stat-unavailable')
    expect(un.textContent).toContain('could not be worked out just now')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

describe('STAT sections', () => {
  it('draws the five sections in order, each with its own as-of, and reports the data\'s date to the header', async () => {
    serve(statAnswer())
    const { setFreshness } = renderPanel({ code: 'STAT' })
    await screen.findByTestId('terminal-stat-volatility')
    const ids = [...root().querySelectorAll('section')].map((s) => s.getAttribute('data-testid'))
    expect(ids).toEqual(['terminal-stat-volatility', 'terminal-stat-beta', 'terminal-stat-returns', 'terminal-stat-drawdowns', 'terminal-stat-corrections'])
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Volatility and range', 'Beta and correlation', 'Returns', 'Its own drawdowns', 'In every market correction'])
    for (const id of ids.slice(0, 4)) expect(fact(`${id}-asof`)).toBe('As of the close of Nov 20, 2026.')
    expect(fact('terminal-stat-corrections-asof')).toBe("S&P 500 declines from market history (MKTH) through Nov 20, 2026; NVDA's prices through Nov 20, 2026.")
    const last = setFreshness.mock.calls.map(([r]) => r).filter(Boolean).at(-1)
    expect(last.source).toBe(STAT_SOURCE)
    expect(last.age.asOfDate).toBe('2026-11-20')
  })

  it('section 1: each statistic in words with its unit', async () => {
    serve(statAnswer())
    renderPanel()
    await screen.findByTestId('terminal-stat-volatility')
    expect(fact('terminal-stat-vol-atr')).toBe('$4.23 (3.20% of the close)')
    expect(fact('terminal-stat-vol-realized')).toBe('20 days 38.5%, 60 days 36.3%, annualized')
    expect(fact('terminal-stat-vol-adr')).toBe('2.44% ($3.00) over 21 sessions')
    expect(fact('terminal-stat-vol-avgvol')).toBe('23.0M a day over 20 sessions, 24.3M over 50')
    expect(fact('terminal-stat-vol-days')).toBe('50.6% up, 48.6% down (127 and 122 of 251 sessions)')
  })

  it('section 2: beta and correlation against SPY and its sector fund, with the method in words', async () => {
    serve(statAnswer())
    renderPanel()
    await screen.findByTestId('terminal-stat-beta')
    const betas = screen.getByTestId('terminal-stat-betas')
    expect(within(betas).getByText('Beta vs Technology (XLK)')).toBeTruthy()
    expect(fact('terminal-stat-betas-spy')).toMatch(/^\d+\.\d{2}, correlation -?\d\.\d{2}$/)
    expect(fact('terminal-stat-beta-method')).toContain('Daily returns over the last 252 sessions NVDA and the fund both traded (Nov 20, 2025 to Nov 20, 2026); at least 200 needed.')
  })

  it('section 3: every period and the best and worst day and week, the yearly rate on 3 and 5 years', async () => {
    serve(statAnswer())
    renderPanel()
    await screen.findByTestId('terminal-stat-periods')
    const periods = within(screen.getByTestId('terminal-stat-periods')).getAllByRole('row').slice(1)
    expect(periods.map((r) => r.querySelector('td').textContent)).toEqual(['1 week', '1 month', '3 months', '6 months', 'Year to date', '1 year', '3 years', '5 years'])
    expect(screen.getByTestId('terminal-stat-period-3Y').textContent).toContain('-10.3% a year')
    expect(screen.getByTestId('terminal-stat-period-1W').textContent).toContain('Nov 13, 2026')
    const ex = within(screen.getByTestId('terminal-stat-extremes')).getAllByRole('rowheader').map((h) => h.textContent)
    expect(ex).toEqual(['Best day', 'Worst day', 'Best week', 'Worst week'])
    expect(screen.queryByTestId('terminal-stat-check-note')).toBeNull()
  })

  it('a period with too little history is words across the row, never 0', async () => {
    const b = statAnswer()
    b.returns.periods[7] = { key: '5Y', label: '5 years', target: '2021-11-20', state: 'short', needed_from: '2021-11-20', held_from: '2024-03-01' }
    b.returns.extremes.year = { state: 'short', needed_from: '2025-11-20', held_from: '2026-02-02' }
    serve(b)
    renderPanel()
    const row = await screen.findByTestId('terminal-stat-period-5Y')
    expect(row.getAttribute('data-kind')).toBe('short')
    expect(row.textContent).toBe("5 yearsNeeds prices back to Nov 20, 2021; UCT's start Mar 1, 2024.")
    expect(row.textContent).not.toMatch(/0\.0%/)
    expect(fact('terminal-stat-year-short')).toBe('Last year: needs prices back to Nov 20, 2025.')
  })

  it('a move holding a suspect one-session jump carries the mark and the note says why', async () => {
    const b = statAnswer()
    b.returns.extremes.all.worst_day.check = true
    b.drawdowns.episodes[0].check = true
    serve(b)
    renderPanel()
    await screen.findByTestId('terminal-stat-extremes')
    expect(screen.getAllByTestId('terminal-stat-check')).toHaveLength(2)
    expect(fact('terminal-stat-check-note')).toBe('A move marked "check the chart" holds a change of more than 40% in one session, which can be a split the history did not adjust.')
    expect(fact('terminal-stat-drawdowns-check-note')).toContain('A decline marked "check the chart" holds a change of more than 40% in one session')
  })

  it('section 4: the drawdowns newest first, the summary and how many were left out', async () => {
    const b = statAnswer()
    b.drawdowns.total = 12
    serve(b)
    renderPanel()
    await screen.findByTestId('terminal-stat-drawdown-table')
    expect(screen.getAllByTestId('terminal-stat-drawdown')).toHaveLength(3)
    expect(fact('terminal-stat-drawdowns-line')).toMatch(/^12 declines of 20% or more since Jan 2, 2004\./)
    expect(fact('terminal-stat-deepest')).toMatch(/^Max drawdown -\d/)
    expect(fact('terminal-stat-drawdowns-cut')).toBe('Showing the newest 3 of 12.')
  })

  it('section 5: each S&P 500 decline with how it fell, its high and the months after; the summary; MKTH one click away', async () => {
    serve(statAnswer())
    const { open } = renderPanel()
    await screen.findByTestId('terminal-stat-corrections-table')
    const rows = screen.getAllByTestId('terminal-stat-correction')
    expect(rows).toHaveLength(4)
    expect(rows[0].getAttribute('data-kind')).toBe('bear')
    expect(rows[0].textContent).toContain('the index')
    expect(fact('terminal-stat-corrections-line')).toMatch(/^In 18 S&P 500 declines of 10% or more inside NVDA's history/)
    expect(screen.getByTestId('terminal-stat-corrections-method').textContent).toContain('A decline counts from a closing high')
    fireEvent.click(within(screen.getByTestId('terminal-stat-mkth-link')).getByRole('button', { name: 'Market history (MKTH)' }))
    expect(open).toHaveBeenCalledWith('MKTH')
  })

  it('the market\'s corrections still being worked out say so, the panel asks again by itself and fills in', async () => {
    const first = statAnswer()
    first.corrections = { state: 'computing', index: 'S&P 500', first: '2004-01-02', as_of: '2026-11-20' }
    let n = 0
    jsonFetcher.mockImplementation(async () => {
      n += 1
      return n === 1 ? first : statAnswer()
    })
    renderPanel()
    expect((await screen.findByTestId('terminal-stat-corrections-computing')).textContent).toContain('working out every S&P 500 correction for the first time')
    expect(screen.getByTestId('terminal-stat-volatility')).toBeTruthy()            // the other sections stand
    await screen.findByTestId('terminal-stat-corrections-table', {}, { timeout: 9000 })
    expect(n).toBeGreaterThanOrEqual(2)
  })

  it('an index not held and a failed read of the corrections are words; the other sections stand', async () => {
    for (const [state, id] of [['not_held', 'terminal-stat-corrections-not-held'], ['unavailable', 'terminal-stat-corrections-unavailable']]) {
      const b = statAnswer()
      b.corrections = { state, index: 'S&P 500', first: '2004-01-02', as_of: '2026-11-20' }
      serve(b)
      renderPanel()
      expect((await screen.findByTestId(id)).textContent).toMatch(/sections above stand/)
      expect(screen.getByTestId('terminal-stat-returns')).toBeTruthy()
      cleanup()
    }
  })

  it('a later read that fails keeps the last answer and says so', async () => {
    const first = statAnswer()
    first.corrections = { state: 'computing', index: 'S&P 500', first: '2004-01-02', as_of: '2026-11-20' }
    let n = 0
    jsonFetcher.mockImplementation(async () => {
      n += 1
      if (n === 1) return first
      throw fail(503)
    })
    renderPanel()
    await screen.findByTestId('terminal-stat-corrections-computing')
    expect((await screen.findByTestId('terminal-stat-stale-read', {}, { timeout: 9000 })).textContent).toContain('Showing the last read.')
    expect(screen.getByTestId('terminal-stat-volatility')).toBeTruthy()
  })
})

describe('STAT rails', () => {
  it('has no axe violations with every section, while computing, and after a failed read', async () => {
    serve(statAnswer())
    const ok = renderPanel()
    await screen.findByTestId('terminal-stat-corrections-table')
    await expectNoAxeViolations(ok.container)
    cleanup()
    const working = statAnswer()
    working.corrections = { state: 'computing', index: 'S&P 500', first: '2004-01-02', as_of: '2026-11-20' }
    serve(working)
    const w = renderPanel()
    await screen.findByTestId('terminal-stat-corrections-computing')
    await expectNoAxeViolations(w.container)
    cleanup()
    serve(fail(500))
    const failed = renderPanel()
    await screen.findByTestId('terminal-stat-error')
    await expectNoAxeViolations(failed.container)
  })

  it('paints no hard-coded color: the panel, its model and its stylesheet use tokens only, with no screen query', () => {
    for (const file of ['StockStatsPanel.jsx', 'stockStatsModel.js', 'stockStatsPanel.module.css']) {
      const src = fs.readFileSync(path.join(HERE, file), 'utf8')
      expect(colourLiteralsIn(src, file), file).toEqual([])
    }
    const css = fs.readFileSync(path.join(HERE, 'stockStatsPanel.module.css'), 'utf8')
    expect(css).not.toMatch(/--(success|danger|gain|loss)/)
    expect(css).not.toMatch(/@media|infinite/)
  })

  it('reads through the terminal\'s one reader and reports the data\'s date through the panel header', () => {
    const src = fs.readFileSync(path.join(HERE, 'StockStatsPanel.jsx'), 'utf8')
    expect(src).toMatch(/useMarketRead\(statUrl\(s\), \{ refreshInterval: pace \}\)/)
    expect(src).toMatch(/usePanelFreshness\(ok \? panelAsOf\(STAT_SOURCE, view\.dataThrough\) : null\)/)
    expect(src).not.toMatch(/setInterval|setTimeout|fetch\(/)
    expect(process.env.NODE_ENV).not.toBe('production')
  })
})
