// SEASB: the seasonality board panel.
//
// What these tests hold the panel to:
//   * every state has its own words: loading, the switch off, no paid plan, a failed read with
//     Retry, every fund still being read, some funds still being read, the full board;
//   * a fund without numbers is named under the grid with why, and is never a row of zeros;
//   * a month counted too few times is dimmed with its count and carries no up or down ink;
//   * this month's column is marked with a word and a rule, next month's header says "next";
//   * the measure is a dropdown that writes itself into the command; a fund's symbol opens SEAS;
//   * the panel asks again every 30 seconds while a fund is waiting and slows once none is;
//   * no hard-coded color; axe in the grid, the list and the states.
// Every number is invented; the fixtures are the route's real shape.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react'
import { SWRConfig, useSWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
// the real read, wrapped only so a test can see the pace the panel asked for
vi.mock('./marketRead', async (original) => {
  const real = await original()
  return { ...real, useMarketRead: vi.fn(real.useMarketRead) }
})
import jsonFetcher from '../../../utils/jsonFetcher'
import { useMarketRead } from './marketRead'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import SeasonalityBoardPanel, { SEASB_CODE, SEASB_POLL_MS, SEASB_SETTLED_POLL_MS, SEASB_SOURCE, SEASB_URL } from './SeasonalityBoardPanel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const URL = '/api/research/seasonality-board'
const LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const mo = (month, n, median, avg, pctUp, thin = n < 5) => ({ month, label: LABELS[month - 1], n, avg_pct: avg, median_pct: median, pct_up: pctUp, thin })
/** Twelve months of `n` years each, +0.5 median / +0.7 average / 62% up (16 of 26), with overrides by month number. */
const twelve = (n, over = {}) => LABELS.map((_, i) => over[i + 1] || mo(i + 1, n, 0.5, 0.7, 62))
const fund = (symbol, name, kind, months, from = '1999-01-04') => ({
  symbol, name, kind, status: 'ok', months, covered_from: from, covered_to: '2026-11-19', full_months: 300,
})
const lacking = (symbol, name, kind, status, reason = null) => ({ symbol, name, kind, status, reason })
const board = (funds, over = {}) => ({
  funds, this_month: 11, next_month: 12, et_date: '2026-11-20', min_years: 5, source: 'UCT daily bar store, close to close',
  as_of: '2026-11-20T09:31:00-05:00', data_through: funds.some((f) => f.status === 'ok') ? '2026-11-19' : null,
  complete: funds.every((f) => f.status === 'ok'), settled: funds.every((f) => f.status === 'ok' || f.status === 'not_held'), ...over,
})
const SPY = fund('SPY', 'S&P 500', 'index', twelve(26, { 11: mo(11, 26, 1.1, 0.9, 65) }))
const XLK = fund('XLK', 'Technology', 'sector', twelve(26, { 11: mo(11, 26, 2.14, 1.62, 73), 12: mo(12, 26, -0.44, 0.31, 46), 3: mo(3, 26, 0.02, 0.4, 50) }))
const XLE = fund('XLE', 'Energy', 'sector', twelve(26, { 11: mo(11, 26, -1.36, -0.2, 35) }))
const XLC = fund('XLC', 'Communication Services', 'sector', twelve(3, { 11: mo(11, 3, 6.5, 6.9, 100), 12: mo(12, 3, -2.2, -1.9, 33) }), '2018-06-19')
const FULL = board([SPY, XLK, XLE, XLC])
const PARTIAL = board([SPY, XLK, XLE, lacking('XLC', 'Communication Services', 'sector', 'pending'),
  lacking('XLRE', 'Real Estate', 'sector', 'not_held'), lacking('XLB', 'Materials', 'sector', 'unavailable', 'RuntimeError')])
const COLD = board(['SPY', 'QQQ', 'XLK', 'XLE'].map((s) => lacking(s, s, 'sector', 'pending')), { building: true })

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

/** Re-reads every key the panel holds, as its poll would (set by the mounted tree). */
let revalidateAll = async () => {}
function Revalidator() {
  const { mutate } = useSWRConfig()
  revalidateAll = () => mutate(() => true)
  return null
}

function renderPanel(props = {}, { rerun = vi.fn(), open = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const tree = (p) => (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <Revalidator />
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run: vi.fn(), rerun, publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}><SeasonalityBoardPanel {...p} /></TerminalPanelContext.Provider>
            : <SeasonalityBoardPanel {...p} />}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>
  )
  const view = render(tree(props))
  return { rerun, open, setFreshness, rerender: (p) => view.rerender(tree(p)), container: view.container }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const rows = () => screen.getAllByTestId('terminal-seasb-row')
const cellsOf = (tr) => within(tr).getAllByTestId('terminal-seasb-cell')
const figure = (cell) => within(cell).getByTestId('terminal-seasb-figure')
const heads = () => screen.getAllByTestId('terminal-seasb-month')
const rowOf = (sym) => rows().find((r) => r.getAttribute('data-symbol') === sym)
const noDated = (setFreshness) => setFreshness.mock.calls.every(([report]) => report == null)
const lastReport = (setFreshness) => setFreshness.mock.calls.map(([r]) => r).filter(Boolean).pop()
/** The pace the panel last asked its read for. */
const pace = () => useMarketRead.mock.calls[useMarketRead.mock.calls.length - 1][1].refreshInterval
const classOf = (name) => new RegExp(`(^|\\s)_?${name}(_|\\s|$)`)

beforeEach(() => { jsonFetcher.mockReset(); useMarketRead.mockClear() })
afterEach(cleanup)

describe('SEASB states', () => {
  it('shows a loading skeleton and asks the one route', () => {
    serve({ [URL]: PENDING })
    renderPanel()
    expect(SEASB_CODE).toBe('SEASB')
    expect(SEASB_URL).toBe(URL)
    expect(screen.getByTestId('terminal-seasb-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-seasb')).toBeNull()
    expect(asked()).toEqual([URL])
    expect(pace()).toBe(30000)
  })

  it('a failed read (500) is an error with Retry, never an empty board', async () => {
    serve({})
    const { setFreshness } = renderPanel({}, { code: 'SEASB' })
    const err = await screen.findByTestId('terminal-seasb-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The seasonality board could not be read just now.')
    expect(err.textContent).toContain('That is a gap in what we could read, not a finding about any fund. Retry, or run SEASB again.')
    expect(screen.queryByTestId('terminal-seasb-table')).toBeNull()
    expect(screen.queryByTestId('terminal-seasb-waiting')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    expect(pace()).toBe(30000)                                   // a failed read is asked again on the panel's own pace
    serve({ [URL]: FULL })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-seasb-table')).toBeTruthy()
  })

  it('signed out, a timeout and no paid plan each say so; only an error can be retried', async () => {
    for (const [err, kind, words] of [
      [fail(401), 'error', 'You are signed out, so the seasonality board cannot be read. Sign in again.'],
      [fail(0, { timedOut: true }), 'error', 'The seasonality board did not answer within 30 seconds.'],
      [fail(503), 'error', 'The seasonality board could not be read just now.'],
      [fail(402), 'locked', 'The seasonality board needs a paid plan.'],
    ]) {
      serve({ [URL]: err })
      renderPanel()
      const box = await screen.findByTestId('terminal-seasb-error')
      expect(box.getAttribute('data-kind'), words).toBe(kind)
      expect(box.textContent, words).toContain(words)
      expect(!!within(box).queryByRole('button', { name: 'Retry' }), words).toBe(kind === 'error')
      expect(screen.queryByTestId('terminal-seasb-table')).toBeNull()
      cleanup()
    }
  })

  it('no paid plan and the switch off are not asked again on a timer', async () => {
    for (const status of [402, 404]) {
      serve({ [URL]: fail(status) })
      renderPanel()
      await screen.findByTestId('terminal-seasb-error')
      expect(pace(), String(status)).toBe(0)
      cleanup()
    }
  })

  it('a switched-off route says it is a setting on our side, with no Retry and no empty grid', async () => {
    serve({ [URL]: fail(404) })
    const { setFreshness } = renderPanel()
    const box = await screen.findByTestId('terminal-seasb-error')
    expect(box.getAttribute('data-kind')).toBe('locked')
    expect(box.textContent).toContain('Seasonality isn\'t switched on yet.')
    expect(box.textContent).toContain('That is a setting on our side, not an empty result.')
    expect(within(box).queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.queryByTestId('terminal-seasb-table')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
  })

  it('an answer that is not a board is a failed read, never an empty board', async () => {
    serve({ [URL]: { detail: 'nope' } })
    renderPanel()
    const box = await screen.findByTestId('terminal-seasb-error')
    expect(box.textContent).toContain('The seasonality board could not be read just now.')
    expect(within(box).getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.queryByTestId('terminal-seasb-table')).toBeNull()
  })

  it('every fund still being read: says so in words, draws no grid, and asks again every 30 seconds', async () => {
    serve({ [URL]: COLD })
    const { setFreshness } = renderPanel({}, { code: 'SEASB' })
    const box = await screen.findByTestId('terminal-seasb-waiting')
    expect(screen.getByTestId('terminal-seasb').getAttribute('data-state')).toBe('waiting')
    expect(box.textContent).toContain('The full daily history of these funds is still being read.')
    expect(box.textContent).toContain('This happens on the first read after a restart.')
    expect(box.textContent).toContain('asks again every 30 seconds')
    expect(screen.getByTestId('terminal-seasb-without').textContent).toBe('All 4 funds: the full history is still being read; this fills in on its own.')
    expect(screen.queryByTestId('terminal-seasb-table')).toBeNull()
    expect(screen.queryByTestId('terminal-seasb-measure')).toBeNull()
    expect(screen.queryByTestId('terminal-seasb-facts')).toBeNull()
    expect(document.body.textContent).not.toContain('0.0%')
    expect(noDated(setFreshness)).toBe(true)
    expect(pace()).toBe(SEASB_POLL_MS)
    // the history arrives: the next read fills the board in with no reload
    serve({ [URL]: FULL })
    await act(async () => { await revalidateAll() })
    expect(await screen.findByTestId('terminal-seasb-table')).toBeTruthy()
    expect(screen.queryByTestId('terminal-seasb-waiting')).toBeNull()
    expect(pace()).toBe(SEASB_SETTLED_POLL_MS)
  })

  it('no fund with numbers and none waiting says there is nothing to show', async () => {
    serve({ [URL]: board([lacking('SPY', 'S&P 500', 'index', 'not_held'), lacking('XLK', 'Technology', 'sector', 'not_held')]) })
    renderPanel()
    const box = await screen.findByTestId('terminal-seasb-none')
    expect(box.textContent).toContain('No fund has numbers to show.')
    expect(screen.getByTestId('terminal-seasb').getAttribute('data-state')).toBe('none')
    expect(within(screen.getByTestId('terminal-seasb-without')).getAllByTestId('terminal-seasb-without-fund').map((li) => li.textContent)).toEqual([
      'SPY: we hold no daily bars for it.', 'XLK: we hold no daily bars for it.'])
    expect(pace()).toBe(SEASB_SETTLED_POLL_MS)
  })

  it('some funds still being read: the rest are drawn, the missing are named with why, never as rows', async () => {
    serve({ [URL]: PARTIAL })
    renderPanel()
    await screen.findByTestId('terminal-seasb-table')
    expect(screen.getByTestId('terminal-seasb').getAttribute('data-state')).toBe('partial')
    expect(rows().map((r) => r.getAttribute('data-symbol'))).toEqual(['SPY', 'XLK', 'XLE'])
    const lines = within(screen.getByTestId('terminal-seasb-without')).getAllByTestId('terminal-seasb-without-fund')
    expect(lines.map((li) => li.textContent)).toEqual([
      'XLC: the full history is still being read; this fills in on its own.',
      'XLRE: we hold no daily bars for it.',
      'XLB: its daily bars could not be read just now; it is asked again on its own.',
    ])
    expect(lines.map((li) => li.getAttribute('data-status'))).toEqual(['pending', 'not_held', 'unavailable'])
    expect(lines[2].getAttribute('data-reason')).toBe('RuntimeError')        // for support; not in the words
    expect(document.body.textContent).not.toContain('RuntimeError')
    expect(pace()).toBe(SEASB_POLL_MS)
  })

  it('a later failed read keeps the board and says it is showing the last read', async () => {
    serve({ [URL]: FULL })
    renderPanel()
    await screen.findByTestId('terminal-seasb-table')
    serve({})
    await act(async () => { await revalidateAll().catch(() => {}) })
    const stale = await screen.findByTestId('terminal-seasb-stale-read')
    expect(stale.textContent).toBe('The seasonality board could not be read just now. Showing the last read.')
    expect(rows()).toHaveLength(4)
  })
})

describe('SEASB the grid', () => {
  it('one row per fund in the order sent; twelve months from this month forward', async () => {
    serve({ [URL]: FULL })
    const { setFreshness } = renderPanel({}, { code: 'SEASB' })
    await screen.findByTestId('terminal-seasb-table')
    expect(screen.getByTestId('terminal-seasb').getAttribute('data-state')).toBe('ready')
    expect(rows().map((r) => r.getAttribute('data-symbol'))).toEqual(['SPY', 'XLK', 'XLE', 'XLC'])
    expect(heads().map((th) => th.getAttribute('data-month'))).toEqual(['11', '12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
    for (const tr of rows()) expect(cellsOf(tr).map((td) => td.getAttribute('data-month'))).toEqual(heads().map((th) => th.getAttribute('data-month')))
    expect(screen.queryByTestId('terminal-seasb-without')).toBeNull()
    // the data's own date and where it is from
    expect(lastReport(setFreshness)).toMatchObject({ source: SEASB_SOURCE })
    expect(JSON.stringify(lastReport(setFreshness))).toContain('2026-11-19')
  })

  it('a cell is the median as a signed percent, with how many years it rose under it', async () => {
    serve({ [URL]: FULL })
    renderPanel()
    await screen.findByTestId('terminal-seasb-table')
    const [nov, dec, jan] = cellsOf(rowOf('XLK'))
    expect(figure(nov).textContent).toBe('+2.1%')
    expect(within(nov).getByTestId('terminal-seasb-sub').textContent).toBe('19 of 26 up')
    expect(nov.getAttribute('title')).toBe('November: median +2.1%, 19 of 26 up')
    expect(figure(dec).textContent).toBe('-0.4%')
    expect(within(dec).getByTestId('terminal-seasb-sub').textContent).toBe('12 of 26 up')
    expect(figure(jan).textContent).toBe('+0.5%')
  })

  it('green and red are the sign only; a figure that shows as zero has neither', async () => {
    serve({ [URL]: FULL })
    renderPanel()
    await screen.findByTestId('terminal-seasb-table')
    const cells = cellsOf(rowOf('XLK'))
    const [nov, dec] = cells
    const mar = cells.find((td) => td.getAttribute('data-month') === '3')
    expect(nov.getAttribute('data-tone')).toBe('up')
    expect(figure(nov).className).toMatch(classOf('up'))
    expect(figure(nov).className).not.toMatch(classOf('down'))
    expect(dec.getAttribute('data-tone')).toBe('down')
    expect(figure(dec).className).toMatch(classOf('down'))
    expect(figure(mar).textContent).toBe('0.0%')
    expect(mar.getAttribute('data-tone')).toBe('flat')
    expect(figure(mar).className).not.toMatch(classOf('up'))
    expect(figure(mar).className).not.toMatch(classOf('down'))
  })

  it('a thin month is dimmed with its count and never coloured, up or down', async () => {
    serve({ [URL]: FULL })
    renderPanel()
    await screen.findByTestId('terminal-seasb-table')
    const [nov, dec] = cellsOf(rowOf('XLC'))
    for (const [cell, text] of [[nov, '+6.5%'], [dec, '-2.2%']]) {
      expect(figure(cell).textContent).toBe(text)
      expect(cell.getAttribute('data-tone')).toBe('thin')
      expect(cell.className).toMatch(classOf('thin'))
      expect(figure(cell).className).not.toMatch(classOf('up'))
      expect(figure(cell).className).not.toMatch(classOf('down'))
      expect(within(cell).getByTestId('terminal-seasb-sub').textContent).toBe('3 yrs')
    }
    expect(nov.getAttribute('title')).toBe('November: median +6.5% over 3 years. Fewer than 5 years: too few to lean on.')
    // a full month is not dimmed
    expect(cellsOf(rowOf('XLK'))[0].className).not.toMatch(classOf('thin'))
  })

  it('a month nobody counted reads n/a, never 0', async () => {
    const hole = fund('XLB', 'Materials', 'sector', twelve(26, { 12: { month: 12, label: 'Dec', n: 0, avg_pct: null, median_pct: null, pct_up: null, thin: true } }))
    serve({ [URL]: board([XLK, hole]) })
    renderPanel()
    await screen.findByTestId('terminal-seasb-table')
    const dec = cellsOf(rowOf('XLB'))[1]
    expect(figure(dec).textContent).toBe('n/a')
    expect(dec.getAttribute('data-tone')).toBe('none')
    expect(within(dec).getByTestId('terminal-seasb-sub').textContent).toBe('no full month')
  })

  it('this month is marked with a word and a rule, next month says next, and nothing else is marked', async () => {
    serve({ [URL]: FULL })
    renderPanel()
    await screen.findByTestId('terminal-seasb-table')
    const h = heads()
    expect(h[0].textContent).toBe('Novnow')
    expect(h[0].getAttribute('data-mark')).toBe('now')
    expect(h[0].className).toMatch(classOf('now'))
    expect(h[0].getAttribute('title')).toBe('November, this month')
    expect(h[1].textContent).toBe('Decnext')
    expect(h[1].getAttribute('data-mark')).toBe('next')
    expect(h[1].className).not.toMatch(classOf('now'))
    expect(h.slice(2).map((th) => th.textContent)).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'])
    expect(h.slice(2).every((th) => th.getAttribute('data-mark') == null)).toBe(true)
    for (const tr of rows()) {
      const tds = cellsOf(tr)
      expect(tds[0].className).toMatch(classOf('now'))
      expect(tds.slice(1).every((td) => !classOf('now').test(td.className))).toBe(true)
    }
    expect(screen.getByTestId('terminal-seasb-lede').textContent).toBe(
      'How each fund has done in each calendar month, close to close, from the daily bars we hold. This month is November; the months run from it forward.')
  })

  it('a narrow panel keeps this month, the next and the one after: the other nine fold, in the header and in every row', async () => {
    serve({ [URL]: board([SPY, XLK], { this_month: 12, next_month: 1 }) })
    renderPanel()
    await screen.findByTestId('terminal-seasb-table')
    const folds = (el) => classOf('phoneHide').test(el.className)
    expect(heads().map((th) => [th.getAttribute('data-month'), folds(th)])).toEqual([
      ['12', false], ['1', false], ['2', false], ['3', true], ['4', true], ['5', true], ['6', true], ['7', true], ['8', true], ['9', true], ['10', true], ['11', true]])
    for (const tr of rows()) expect(cellsOf(tr).map(folds)).toEqual(heads().map(folds))
    // the fund column never folds
    expect(screen.getByTestId('terminal-seasb-table').querySelectorAll('th[scope="row"]')).toHaveLength(2)
    for (const th of screen.getByTestId('terminal-seasb-table').querySelectorAll('th[scope="row"]')) expect(folds(th)).toBe(false)
  })

  it('each row says where its own record starts', async () => {
    serve({ [URL]: board([XLK, XLC, fund('XLB', 'Materials', 'sector', twelve(26), null)]) })
    renderPanel()
    await screen.findByTestId('terminal-seasb-table')
    expect(rows().map((tr) => within(tr).getByTestId('terminal-seasb-fund-meta').textContent)).toEqual([
      'Technology, since 1999', 'Communication Services, since 2018', 'Materials, start of record unknown'])
  })

  it('says how to read it, where it is from, and that it is not a forecast', async () => {
    serve({ [URL]: FULL })
    renderPanel()
    await screen.findByTestId('terminal-seasb-table')
    const method = screen.getByTestId('terminal-seasb-method').textContent
    expect(method).toContain('Each figure is the median of that calendar month\'s close-to-close return')
    expect(method).toContain('A dimmed figure has fewer than 5 years behind it')
    expect(method).toContain('Green and red mark the sign of a figure only.')
    expect(method).toContain('A record of what happened, not a forecast.')
    expect(method).toContain('Source: the UCT daily bar store.')
    expect(document.body.textContent).not.toMatch(/—/)
  })
})

describe('SEASB the two facts', () => {
  it('the best and the weakest sector fund this month, each with its count; an index fund and a thin fund never', async () => {
    serve({ [URL]: FULL })
    renderPanel()
    await screen.findByTestId('terminal-seasb-table')
    expect(screen.getByTestId('terminal-seasb-best').textContent).toBe('Best sector fund in November since 1999: Technology (XLK), median +2.1%, up 19 of 26 years.')
    expect(screen.getByTestId('terminal-seasb-worst').textContent).toBe('Weakest sector fund in November since 1999: Energy (XLE), median -1.4%, up 9 of 26 years.')
    expect(screen.getByTestId('terminal-seasb-left-out').textContent).toBe('Not counted in those two: XLC (3 years).')
    expect(screen.queryByTestId('terminal-seasb-no-facts')).toBeNull()
  })

  it('with too few funds that have the years, no fact is drawn and the panel says why', async () => {
    serve({ [URL]: board([SPY, XLK, XLC]) })
    renderPanel()
    await screen.findByTestId('terminal-seasb-table')
    expect(screen.queryByTestId('terminal-seasb-best')).toBeNull()
    expect(screen.queryByTestId('terminal-seasb-worst')).toBeNull()
    expect(screen.getByTestId('terminal-seasb-no-facts').textContent).toBe('Too few sector funds have 5 or more Novembers on record to name a best or a weakest.')
  })

  it('the facts stay on the median when the grid shows the average', async () => {
    serve({ [URL]: FULL })
    renderPanel({ measure: 'average' })
    await screen.findByTestId('terminal-seasb-table')
    expect(figure(cellsOf(rowOf('XLK'))[0]).textContent).toBe('+1.6%')
    expect(screen.getByTestId('terminal-seasb-best').textContent).toContain('median +2.1%')
  })
})

describe('SEASB the measure', () => {
  it('opens on the median; the dropdown switches to the average and writes it into the command', async () => {
    serve({ [URL]: FULL })
    const { rerun } = renderPanel({}, { code: 'SEASB' })
    await screen.findByTestId('terminal-seasb-table')
    const pick = screen.getByTestId('terminal-seasb-measure')
    expect(pick.tagName).toBe('SELECT')
    expect(pick.value).toBe('median')
    expect([...pick.options].map((o) => o.textContent)).toEqual(['Median month', 'Average month'])
    expect(screen.getByLabelText('Show')).toBe(pick)
    expect(screen.getByTestId('terminal-seasb').getAttribute('data-measure')).toBe('median')
    fireEvent.change(pick, { target: { value: 'average' } })
    expect(screen.getByTestId('terminal-seasb').getAttribute('data-measure')).toBe('average')
    const [nov, dec] = cellsOf(rowOf('XLK'))
    expect(figure(nov).textContent).toBe('+1.6%')
    expect(figure(dec).textContent).toBe('+0.3%')                 // the average of the same month has the other sign
    expect(dec.getAttribute('data-tone')).toBe('up')
    expect(nov.getAttribute('title')).toBe('November: average +1.6%, 19 of 26 up')
    expect(screen.getByTestId('terminal-seasb-method').textContent).toContain('Each figure is the average of that calendar month')
    expect(screen.getByTestId('terminal-seasb-table').getAttribute('aria-label')).toBe('Seasonality board, average month return by fund, from November forward')
    expect(rerun).toHaveBeenLastCalledWith('SEASB AVG')
    fireEvent.change(pick, { target: { value: 'median' } })
    expect(rerun).toHaveBeenLastCalledWith('SEASB')
    expect(rerun).toHaveBeenCalledTimes(2)
    fireEvent.change(pick, { target: { value: 'median' } })       // the same choice writes nothing
    expect(rerun).toHaveBeenCalledTimes(2)
    expect(asked()).toEqual([URL])                                 // one read serves both measures
  })

  it('outside the shell the choice stays in the panel and writes nothing', async () => {
    serve({ [URL]: FULL })
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-seasb-table')
    fireEvent.change(screen.getByTestId('terminal-seasb-measure'), { target: { value: 'average' } })
    expect(figure(cellsOf(rowOf('XLK'))[0]).textContent).toBe('+1.6%')
    expect(rerun).not.toHaveBeenCalled()
  })

  it('SEASB AVG opens on the average, and a command typed over it re-opens on the new measure', async () => {
    serve({ [URL]: FULL })
    const { rerender } = renderPanel({ measure: 'average' }, { code: 'SEASB' })
    await screen.findByTestId('terminal-seasb-table')
    expect(screen.getByTestId('terminal-seasb-measure').value).toBe('average')
    rerender({})
    expect((await screen.findByTestId('terminal-seasb-measure')).value).toBe('median')
    rerender({ measure: 'nonsense' })
    expect(screen.getByTestId('terminal-seasb-measure').value).toBe('median')
  })
})

describe('SEASB doors and the list', () => {
  it('a fund\'s symbol opens that fund\'s own seasonality beside the panel', async () => {
    serve({ [URL]: FULL })
    const { open } = renderPanel({}, { code: 'SEASB' })
    await screen.findByTestId('terminal-seasb-table')
    const door = within(rowOf('XLK')).getByTestId('panel-command-XLK-SEAS')
    expect(door.textContent).toBe('XLK')
    expect(door.getAttribute('aria-label')).toBe('Seasonality by month and weekday for XLK (XLK SEAS)')
    fireEvent.click(door)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenLastCalledWith('XLK SEAS')
    fireEvent.click(within(rowOf('SPY')).getByTestId('panel-command-SPY-SEAS'))
    expect(open).toHaveBeenLastCalledWith('SPY SEAS')
  })

  it('"All months as a list" swaps the grid for one block per fund with all twelve months, and back', async () => {
    serve({ [URL]: FULL })
    const { open } = renderPanel({}, { code: 'SEASB' })
    await screen.findByTestId('terminal-seasb-table')
    const toggle = screen.getByTestId('terminal-seasb-all-months')
    expect(toggle.textContent).toBe('All months as a list')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('terminal-seasb').getAttribute('data-layout')).toBe('grid')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('terminal-seasb').getAttribute('data-layout')).toBe('list')
    expect(screen.queryByTestId('terminal-seasb-table')).toBeNull()
    const blocks = screen.getAllByTestId('terminal-seasb-block')
    expect(blocks.map((b) => b.getAttribute('data-symbol'))).toEqual(['SPY', 'XLK', 'XLE', 'XLC'])
    const items = within(blocks[1]).getAllByTestId('terminal-seasb-item')
    expect(items).toHaveLength(12)
    expect(items.map((li) => li.getAttribute('data-month'))).toEqual(['11', '12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
    expect(items[0].textContent).toBe('Nov, now+2.1%19 of 26 up')
    expect(items[1].textContent).toBe('Dec, next-0.4%12 of 26 up')
    expect(items[2].textContent).toBe('Jan+0.5%16 of 26 up')
    expect(items[0].className).toMatch(classOf('monthItemNow'))
    expect(items[1].className).not.toMatch(classOf('monthItemNow'))
    // nothing in the list folds, and a thin month keeps its treatment
    expect(items.every((li) => !classOf('phoneHide').test(li.className))).toBe(true)
    const thin = within(blocks[3]).getAllByTestId('terminal-seasb-item')[0]
    expect(thin.getAttribute('data-tone')).toBe('thin')
    expect(thin.className).toMatch(classOf('thin'))
    expect(within(thin).getByTestId('terminal-seasb-figure').className).not.toMatch(classOf('up'))
    // the door is in the list too, and the facts and the measure stay
    fireEvent.click(within(blocks[1]).getByTestId('panel-command-XLK-SEAS'))
    expect(open).toHaveBeenLastCalledWith('XLK SEAS')
    expect(screen.getByTestId('terminal-seasb-best')).toBeTruthy()
    fireEvent.change(screen.getByTestId('terminal-seasb-measure'), { target: { value: 'average' } })
    expect(within(screen.getAllByTestId('terminal-seasb-block')[1]).getAllByTestId('terminal-seasb-item')[0].textContent).toBe('Nov, now+1.6%19 of 26 up')
    fireEvent.click(toggle)
    expect(screen.getByTestId('terminal-seasb-table')).toBeTruthy()
    expect(screen.queryByTestId('terminal-seasb-list')).toBeNull()
  })
})

describe('SEASB follows the member\'s theme', () => {
  it('the panel, its model and its sheet hold no hard-coded color', () => {
    for (const f of ['SeasonalityBoardPanel.jsx', 'seasonalityBoardModel.js', 'seasonalityBoard.module.css']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })

  it('the panel measures nothing and its sheet keys nothing on the panel\'s width', () => {
    // the shell owns the one fit mechanism: a panel that named it, or a sheet with its own rule,
    // would be a second one (panelPhoneFit.rail.test.js counts them)
    const jsx = fs.readFileSync(path.join(HERE, 'SeasonalityBoardPanel.jsx'), 'utf8')
    const css = fs.readFileSync(path.join(HERE, 'seasonalityBoard.module.css'), 'utf8')
    expect(jsx).not.toMatch(/data-fit|panelFit|ResizeObserver|matchMedia/)
    // the one thing it says about width: the step its table was measured to fold from
    expect(jsx.match(/data-fold="[^"]*"/g)).toEqual(['data-fold="590"'])
    expect(css).not.toMatch(/\[data-fit|@container|@media/)
  })
})

describe('SEASB accessibility', () => {
  it('the grid, the list, some funds waiting, every fund waiting and each locked state pass axe (WCAG A and AA)', async () => {
    serve({ [URL]: FULL })
    renderPanel({}, { code: 'SEASB' })
    await screen.findByTestId('terminal-seasb-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    fireEvent.click(screen.getByTestId('terminal-seasb-all-months'))
    await screen.findByTestId('terminal-seasb-list')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: FULL })
    renderPanel({ measure: 'average' })                             // outside the shell
    await screen.findByTestId('terminal-seasb-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: PARTIAL })
    renderPanel()
    await screen.findByTestId('terminal-seasb-without')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: COLD })
    renderPanel()
    await screen.findByTestId('terminal-seasb-waiting')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    for (const status of [402, 404, 500]) {
      serve({ [URL]: fail(status) })
      renderPanel()
      await screen.findByTestId('terminal-seasb-error')
      await expectNoAxeViolations(document.body.firstElementChild)
      cleanup()
    }
  })

  it('the table names its rows and columns for a screen reader', async () => {
    serve({ [URL]: FULL })
    renderPanel()
    const table = await screen.findByTestId('terminal-seasb-table')
    expect(table.getAttribute('aria-label')).toBe('Seasonality board, median month return by fund, from November forward')
    expect(table.querySelectorAll('thead th[scope="col"]')).toHaveLength(13)
    expect(table.querySelectorAll('tbody th[scope="row"]')).toHaveLength(4)
    expect(screen.getByRole('toolbar', { name: 'Seasonality board controls' })).toBeTruthy()
  })
})
