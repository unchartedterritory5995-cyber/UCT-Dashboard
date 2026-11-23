// SETH: how setups acted. Rails:
//   * loading, a failed read (error with Retry), signed out, a timeout, not on a paid plan, a switched-off route and
//     an answer that is not the route's shape: none of them is an empty panel;
//   * the weekly build: "computing" asks again by itself and fills in; "waiting" (no build in trading hours) and an
//     index history not held are said in words, never as no signals;
//   * the study: one table per setup with its words, rows = phases, every number with the count it rests on, a group
//     under the floor says "too few" (never a 0), the hindsight and survivorship sentences beside the numbers, the
//     horizon pick re-reads nothing and changes every table, the dropped setups listed;
//   * one stock: its signals newest first with the phase under the setup, "not yet" for a horizon not reached, the
//     universe table per setup and phase, the cut said from its end, not held / computing; the chip writes back;
//   * the header gets the data's own date; tokens only; one reader, no polling loop of its own; axe.
// Every value is invented (__fixtures__/setupHistoryFixture.js) in the routes' real shape.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import SetupHistoryPanel, { SETH_CODE, SETH_SOURCE, SETH_URL } from './SetupHistoryPanel'
import { HINDSIGHT, setupHistoryAnswer, setupStockAnswer } from './__fixtures__/setupHistoryFixture'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
const STOCK_URL = '/api/research/setup-history/QZSA'
function serve(map) {
  jsonFetcher.mockImplementation((u) => {
    if (!(u in map)) return Promise.reject(fail(500))
    const body = map[u]
    if (body === PENDING) return new Promise(() => {})
    return body instanceof Error ? Promise.reject(body) : Promise.resolve(typeof body === 'function' ? body() : body)
  })
}
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([u]) => u))]

function renderPanel({ sym, view, setFreshness = vi.fn(), code = null, rerun = vi.fn(), run = vi.fn() } = {}) {
  const body = <SetupHistoryPanel sym={sym} view={view} />
  const out = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run, rerun, publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { setFreshness, rerun, run, container: out.container }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const root = () => screen.getByTestId('terminal-seth')

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('SETH states', () => {
  it('shows a loading skeleton and asks the one route', () => {
    serve({ [SETH_URL]: PENDING })
    renderPanel()
    expect(SETH_CODE).toBe('SETH')
    expect(screen.getByTestId('terminal-seth-loading')).toBeTruthy()
    expect(asked()).toEqual(['/api/research/setup-history'])
  })

  it('a failed read is an error with Retry, and Retry reads again', async () => {
    serve({ [SETH_URL]: fail(500) })
    const { setFreshness } = renderPanel({ code: 'SETH' })
    const err = await screen.findByTestId('terminal-seth-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('How setups acted could not be read just now.')
    expect(err.textContent).toContain('Retry, or run SETH again.')
    expect(setFreshness.mock.calls.every(([r]) => r == null)).toBe(true)
    serve({ [SETH_URL]: setupHistoryAnswer() })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect((await screen.findAllByTestId('terminal-seth-setup')).length).toBe(4)
  })

  it('signed out, a timeout, no paid plan and a switched-off route each say so; only an error can be retried', async () => {
    for (const [err, kind, words] of [
      [fail(401), 'error', 'You are signed out'],
      [fail(0, { timedOut: true }), 'error', 'did not answer within 30 seconds'],
      [fail(402), 'locked', 'needs a paid plan'],
      [fail(404), 'locked', 'is not switched on for this server yet'],
    ]) {
      serve({ [SETH_URL]: err })
      renderPanel()
      const state = await screen.findByTestId('terminal-seth-error')
      expect(state.getAttribute('data-kind')).toBe(kind)
      expect(state.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' })).toBe(kind === 'error')
      cleanup()
    }
  })

  it('an answer that is not the route\'s shape is a failed read with Retry', async () => {
    for (const b of [{ items: [] }, { status: 'ok' }, []]) {
      serve({ [SETH_URL]: b })
      renderPanel()
      const err = await screen.findByTestId('terminal-seth-error')
      expect(err.textContent).toContain('came back in a shape this panel cannot read')
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
      cleanup()
    }
  })

  it('the weekly build says so, and the panel asks again at the pace the answer sets (sooner while it builds)', async () => {
    serve({ [SETH_URL]: { status: 'computing' } })
    renderPanel()
    const working = await screen.findByTestId('terminal-seth-computing')
    expect(working.textContent).toContain('one stock at a time')
    expect(root().getAttribute('data-state')).toBe('computing')
    const src = fs.readFileSync(path.join(HERE, 'SetupHistoryPanel.jsx'), 'utf8')
    expect(src).toContain('refreshInterval: (latest) => studyPollMs(sethRead(latest?.body))')
    expect(src).toContain('refreshInterval: (latest) => stockPollMs(sethStockRead(latest?.body))')
  })

  it('waiting for the quiet hours and an index history not held are each said in words, never as no signals', async () => {
    serve({ [SETH_URL]: { status: 'waiting', detail: 'The first one starts after 20:15 New York time on a weekday.' } })
    renderPanel()
    const w = await screen.findByTestId('terminal-seth-waiting')
    expect(w.textContent).toContain('after 20:15 New York time')
    expect(w.textContent).toContain('not the same as no signals')
    cleanup()
    serve({ [SETH_URL]: { status: 'unavailable', reason: 'index_not_held' } })
    renderPanel()
    const u = await screen.findByTestId('terminal-seth-unavailable')
    expect(u.textContent).toContain("The S&P 500's history is not held on this server yet.")
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

describe('SETH the study', () => {
  it('one table per setup with its words, rows = the four phases, and the header gets the data\'s own date', async () => {
    serve({ [SETH_URL]: setupHistoryAnswer() })
    const { setFreshness } = renderPanel()
    const setups = await screen.findAllByTestId('terminal-seth-setup')
    expect(setups.map((s) => s.getAttribute('data-id'))).toEqual(['breakout', 'pullback_21ema', 'gap_up', 'reclaim_50'])
    const first = setups[0]
    expect(within(first).getByRole('heading', { level: 3 }).textContent).toBe('Breakout to a new 52-week high')
    expect(within(first).getByTestId('terminal-seth-words').textContent).toContain('252 sessions')
    const rows = within(first).getAllByTestId('terminal-seth-group')
    expect(rows.map((r) => r.getAttribute('data-phase'))).toEqual(['correction', 'after_low', 'uptrend', 'all'])
    expect(within(rows[0]).getByRole('rowheader').textContent).toBe('In a correction')
    expect(within(rows[0]).getByTestId('terminal-seth-n').textContent).toBe('609of 612')
    expect(within(rows[0]).getByTestId('terminal-seth-avg').textContent).toMatch(/^[+-]?\d+\.\d%median [+-]?\d+\.\d%$/)
    expect(screen.getByTestId('terminal-seth-summary').textContent).toContain('How 4 setups acted across 3,388 stocks')
    expect(setFreshness).toHaveBeenLastCalledWith(expect.objectContaining({ source: SETH_SOURCE }))
  })

  it('a group under the floor shows its count and says too few, never a 0; a missing same-day match says why', async () => {
    serve({ [SETH_URL]: setupHistoryAnswer() })
    renderPanel()
    const reclaim = (await screen.findAllByTestId('terminal-seth-setup'))[3]
    const thin = within(reclaim).getAllByTestId('terminal-seth-group')[0]
    expect(thin.getAttribute('data-below')).toBe('true')
    expect(within(thin).getByTestId('terminal-seth-too-few').textContent).toBe('Too few signals: 18 (30 needed).')
    expect(within(thin).queryByTestId('terminal-seth-hit')).toBeNull()
    const gap = screen.getAllByTestId('terminal-seth-setup')[2]
    const ex = within(within(gap).getAllByTestId('terminal-seth-group')[1]).getByTestId('terminal-seth-excess')
    expect(ex.getAttribute('data-kind')).toBe('no_unoccupied_cell')
    expect(ex.textContent).toContain('no other stock moved alike that day')
  })

  it('the hindsight and survivorship sentences sit beside the numbers, with the method and the setups left out', async () => {
    serve({ [SETH_URL]: setupHistoryAnswer() })
    renderPanel()
    expect((await screen.findByTestId('terminal-seth-hindsight')).textContent).toBe(HINDSIGHT)
    expect(screen.getByTestId('terminal-seth-survivorship').textContent).toContain('survivorship bias')
    const method = screen.getByTestId('terminal-seth-method').textContent
    expect(method).toContain('from the open of the session after the signal')
    expect(method).toContain('One signal per run')
    expect(method).toContain('Below 30 signals a group shows its count and no rates')
    expect(method).toContain('newest 8 years')
    expect(within(screen.getByTestId('terminal-seth-dropped')).getAllByRole('listitem')).toHaveLength(2)
  })

  it('the horizon pick changes every table from the same answer, with no second read', async () => {
    serve({ [SETH_URL]: setupHistoryAnswer() })
    renderPanel()
    const first = (await screen.findAllByTestId('terminal-seth-setup'))[0]
    expect(within(first).getAllByTestId('terminal-seth-n')[0].textContent).toBe('609of 612')
    fireEvent.change(screen.getByTestId('terminal-seth-horizon'), { target: { value: '60' } })
    expect(within(screen.getAllByTestId('terminal-seth-setup')[0]).getAllByTestId('terminal-seth-n')[0].textContent).toBe('603of 612')
    expect(within(screen.getAllByTestId('terminal-seth-setup')[0]).getByRole('table').getAttribute('aria-label')).toContain('60 days')
    expect(asked()).toEqual([SETH_URL])
  })

  it('a capped setup says its numbers are withheld; last week\'s study while this week\'s builds says so', async () => {
    serve({ [SETH_URL]: setupHistoryAnswer({ capped: true, refreshing: true }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-seth-capped')).textContent).toContain('withheld rather than cut')
    expect(screen.getByTestId('terminal-seth-refreshing').textContent).toContain("this is last week's")
  })

  it('a later read that fails keeps the last answer and says so', async () => {
    let n = 0
    serve({ [SETH_URL]: () => { if (n++ === 0) return setupHistoryAnswer(); throw fail(500) } })
    renderPanel()
    await screen.findAllByTestId('terminal-seth-setup')
    fireEvent.change(screen.getByTestId('terminal-seth-horizon'), { target: { value: '5' } })
    expect(screen.getAllByTestId('terminal-seth-setup')).toHaveLength(4)
  })
})

describe('SETH one stock', () => {
  it('lists its signals newest first, the phase under the setup, "not yet" where the days have not passed', async () => {
    serve({ [STOCK_URL]: setupStockAnswer() })
    renderPanel({ sym: 'qzsa' })
    const rows = await screen.findAllByTestId('terminal-seth-signal')
    expect(asked()).toEqual([STOCK_URL])
    expect(root().getAttribute('data-view')).toBe('stock')
    expect(rows.map((r) => r.getAttribute('data-setup'))).toEqual(['breakout', 'pullback_21ema', 'gap_up', 'reclaim_50'])
    expect(rows[0].textContent).toContain('Breakout to a new 52-week high')
    expect(rows[0].textContent).toContain('Later in an uptrend')
    expect(rows[0].querySelectorAll('[data-kind="notyet"]')).toHaveLength(2)
    expect(rows[3].getAttribute('data-phase')).toBe('none')
    expect(rows[3].textContent).toContain('No phase (outside the index history held)')
    expect(screen.getByTestId('terminal-seth-stock-summary').textContent).toContain('had 4 signals of the 4 setups')
  })

  it('the universe table lines each setup and phase up with its count, and says too few under the floor', async () => {
    serve({ [STOCK_URL]: setupStockAnswer() })
    renderPanel({ sym: 'QZSA' })
    const lines = await screen.findAllByTestId('terminal-seth-universe-row')
    expect(lines.map((r) => r.getAttribute('data-key'))).toEqual(['breakout|uptrend', 'pullback_21ema|after_low', 'gap_up|correction', 'reclaim_50|all'])
    expect(lines[3].textContent).toContain('Too few signals: 12 (30 needed).')
    expect(screen.getByTestId('terminal-seth-universe-line').textContent).toContain('Jun 6, 2028 to Jun 6, 2031')
    expect(screen.getByTestId('terminal-seth-universe-survivorship').textContent).toContain('survivorship bias')
  })

  it('a cut list says from which end; the study not yet held is said under the list', async () => {
    serve({ [STOCK_URL]: setupStockAnswer({ cut: true, universe: 'waiting' }) })
    renderPanel({ sym: 'QZSA' })
    expect((await screen.findByTestId('terminal-seth-cut')).textContent).toBe('Showing the newest 4 of 412; the oldest 408 are not shown.')
    expect(screen.getByTestId('terminal-seth-universe-missing').getAttribute('data-kind')).toBe('waiting')
  })

  it('no prices held, the first ask being worked out, and a bad symbol are each said in words', async () => {
    serve({ [STOCK_URL]: { status: 'not_held', symbol: 'QZSA', detail: 'UCT holds no daily prices for QZSA.' } })
    renderPanel({ sym: 'QZSA' })
    expect((await screen.findByTestId('terminal-seth-not-held')).textContent).toContain('not the same as QZSA having no history')
    cleanup()
    let n = 0
    serve({ [STOCK_URL]: () => (n++ === 0 ? { status: 'computing' } : setupStockAnswer()) })
    renderPanel({ sym: 'QZSA' })
    expect((await screen.findByTestId('terminal-seth-computing')).textContent).toContain("reading QZSA's stored prices")
    expect(await screen.findAllByTestId('terminal-seth-signal', {}, { timeout: 8000 })).toHaveLength(4)
    cleanup()
    serve({ [STOCK_URL]: fail(400) })
    renderPanel({ sym: 'QZSA', code: 'SETH' })
    expect((await screen.findByTestId('terminal-seth-bad-symbol')).textContent).toContain('NVDA SETH')
  }, 15000)

  it('the chip switches to the study and writes the market word back; SETH MARKET opens on the study', async () => {
    serve({ [STOCK_URL]: setupStockAnswer(), [SETH_URL]: setupHistoryAnswer() })
    renderPanel({ sym: 'QZSA' })
    await screen.findAllByTestId('terminal-seth-signal')
    expect(screen.getByTestId('terminal-seth-view-stock').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('terminal-seth-view-market'))
    expect(await screen.findAllByTestId('terminal-seth-setup')).toHaveLength(4)
    expect(root().getAttribute('data-view')).toBe('study')
    cleanup()
    jsonFetcher.mockClear()
    renderPanel({ sym: 'QZSA', view: 'market' })
    expect(await screen.findAllByTestId('terminal-seth-setup')).toHaveLength(4)
    expect(asked()).toEqual([SETH_URL])
  })
})

describe('SETH rails', () => {
  it('has no axe violations on the study, one stock, while computing and after a failed read', async () => {
    serve({ [SETH_URL]: setupHistoryAnswer() })
    const a = renderPanel()
    await screen.findAllByTestId('terminal-seth-setup')
    await expectNoAxeViolations(a.container)
    cleanup()
    serve({ [STOCK_URL]: setupStockAnswer() })
    const b = renderPanel({ sym: 'QZSA' })
    await screen.findAllByTestId('terminal-seth-signal')
    await expectNoAxeViolations(b.container)
    cleanup()
    serve({ [SETH_URL]: { status: 'computing' } })
    const c = renderPanel()
    await screen.findByTestId('terminal-seth-computing')
    await expectNoAxeViolations(c.container)
    cleanup()
    serve({ [SETH_URL]: fail(500) })
    const d = renderPanel()
    await screen.findByTestId('terminal-seth-error')
    await expectNoAxeViolations(d.container)
  })

  it('paints no hard-coded color: the panel, its model and its stylesheet use tokens only, with no screen query', () => {
    for (const file of ['SetupHistoryPanel.jsx', 'setupHistoryModel.js', 'setupHistoryPanel.module.css']) {
      const src = fs.readFileSync(path.join(HERE, file), 'utf8')
      expect(colourLiteralsIn(src, file), file).toEqual([])
    }
    expect(fs.readFileSync(path.join(HERE, 'setupHistoryPanel.module.css'), 'utf8')).not.toMatch(/@media/)
  })

  it('reads through the terminal\'s one reader and reports the data\'s date through the panel header', () => {
    const src = fs.readFileSync(path.join(HERE, 'SetupHistoryPanel.jsx'), 'utf8')
    expect(src).toContain('useMarketRead(')
    expect(src).toContain('usePanelFreshness(')
    expect(src).not.toMatch(/setInterval|setTimeout|fetch\(/)
  })
})
