// SCAT: a universe on two metrics. Rails:
//   * by default RS rank (Y) against % off the 52-week high (X) over the S&P 500, from the Market Map's
//     own /api/scatter reads; a name missing either value is counted, never drawn at zero;
//   * the axis menus are the server's metric catalog; changing an axis re-plots;
//   * picking a universe reads that universe;
//   * clicking a dot loads that ticker into the linked panels;
//   * a failed read is an error with Retry, never an empty plot; a 402 says paid plan;
//   * the registry: `SCAT` resolves to this panel, market-only;
//   * the view is the command (wave 9): props from `SCAT NDX CHG_1M RS_RANK` open that view; a
//     changed pick re-runs the panel's command, the same pick does nothing (no remount loop), and a
//     member's own list is kept for the open panel, unsaved, and said so.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

// ECharts draws a canvas in jsdom: stub it, capture the option and the click handler.
const chart = vi.hoisted(() => ({ option: null, onEvents: null }))
vi.mock('echarts-for-react', () => ({
  default: (props) => { chart.option = props.option; chart.onEvents = props.onEvents; return <div data-testid="echart" /> },
}))
vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext } from '../../../components/terminal'
import ScatterPanel, { METRICS_URL, UNIVERSES_URL, dataUrl, fmtMetric, initialView, scatterPoints, universeOptions } from './ScatterPanel'
import { applyArgs } from '../args'
import { BY_CODE, variantFor } from '../functions'
import { PANEL_IMPORTERS } from '../panels'
import parseCommand from '../parseCommand'

const METRICS = { metrics: [
  { key: 'chg_today', label: '% Change Today', group: 'Today', unit: 'pct', live: true },
  { key: 'rs_rank', label: 'RS Rating', group: 'Momentum', unit: 'num', live: false },
  { key: 'dist_52w_high', label: '% Off 52w High', group: 'Trend', unit: 'pct', live: false },
] }
const UNIVERSES = { groups: [
  { group: 'Indices', items: [{ source: 'index', value: 'sp500', label: 'S&P 500' }, { source: 'index', value: 'ndx', label: 'Nasdaq 100' }] },
  { group: 'My lists', items: [{ source: 'watchlist', value: 'ab12', label: 'Swing list' }] },
] }
const SP500 = { label: 'S&P 500', tickers: [
  { sym: 'NVDA', dir: 'up', m: { rs_rank: 97, dist_52w_high: -2.5, chg_today: 3.1 } },
  { sym: 'XYZ', dir: 'down', m: { rs_rank: 12, dist_52w_high: -41, chg_today: -1.2 } },
  { sym: 'NODATA', dir: 'up', m: { rs_rank: null, dist_52w_high: -5, chg_today: 0.4 } },
] }
const NDX = { label: 'Nasdaq 100', tickers: [{ sym: 'AMD', dir: 'up', m: { rs_rank: 80, dist_52w_high: -10, chg_today: 1 } }] }

const err = (status) => Object.assign(new Error(`answered ${status}`), { status })
function serve({ metrics = METRICS, universes = UNIVERSES, sp500 = SP500 } = {}) {
  jsonFetcher.mockImplementation(async (url) => {
    const hit = url === METRICS_URL ? metrics : url === UNIVERSES_URL ? universes
      : url === dataUrl('index', 'sp500') ? sp500 : url === dataUrl('index', 'ndx') ? NDX
        : url === dataUrl('watchlist', 'ab12') ? NDX : err(404)
    if (hit instanceof Error) throw hit
    return hit
  })
}
function renderPanel({ open = vi.fn(), run = vi.fn(), rerun = vi.fn(), props = {} } = {}) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelListContext.Provider value={{ open, rerun, run }}>
        <ScatterPanel {...props} />
      </PanelListContext.Provider>
    </SWRConfig>,
  )
  return { open, run, rerun }
}
/** The props the shell hands the panel for a typed command line. */
const propsFor = (line) => applyArgs(BY_CODE.SCAT.market, parseCommand(line).args).props

beforeEach(() => { jsonFetcher.mockReset(); chart.option = null; chart.onEvents = null })
afterEach(cleanup)

describe('SCAT panel', () => {
  it('reports its read time as an age, so the header never prints UNKNOWN', async () => {
    serve()
    const reports = []
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <PanelFreshnessContext.Provider value={(r) => reports.push(r)}>
          <PanelListContext.Provider value={{ open: vi.fn(), rerun: vi.fn(), run: vi.fn() }}>
            <ScatterPanel />
          </PanelListContext.Provider>
        </PanelFreshnessContext.Provider>
      </SWRConfig>,
    )
    await vi.waitFor(() => expect(reports.filter(Boolean).length).toBeGreaterThan(0))
    const last = reports.filter(Boolean).at(-1)
    expect(last.source).toMatch(/Market Map/)
    // no freshness class and no age is what made FreshnessBadge print UNKNOWN
    expect(last.age?.asOfDate).toMatch(/ET$/)
  })

  it('plots RS rank against % off the 52-week high, and counts the name it cannot place', async () => {
    serve()
    renderPanel()
    await screen.findByTestId('terminal-scat-chart')
    const data = chart.option.series[0].data
    expect(data.map((d) => d.value[2])).toEqual(['NVDA', 'XYZ'])
    expect(data[0].value.slice(0, 2)).toEqual([-2.5, 97])
    expect(chart.option.xAxis.name).toBe('% Off 52w High')
    expect(chart.option.yAxis.name).toBe('RS Rating')
    const method = screen.getByTestId('terminal-scat-method').textContent
    expect(method).toContain('2 names plotted')
    expect(method).toContain('1 left out')
    expect(jsonFetcher).toHaveBeenCalledWith(dataUrl('index', 'sp500'))
  })

  it('the axis menus are the server catalog, and a new axis re-plots', async () => {
    serve()
    renderPanel()
    await screen.findByTestId('terminal-scat-chart')
    const x = screen.getByTestId('terminal-scat-x')
    expect(within(x).getAllByRole('option').map((o) => o.value)).toEqual(['chg_today', 'rs_rank', 'dist_52w_high'])
    fireEvent.change(x, { target: { value: 'chg_today' } })
    expect(chart.option.xAxis.name).toBe('% Change Today')
    expect(chart.option.series[0].data.find((d) => d.value[2] === 'NVDA').value[0]).toBe(3.1)
  })

  it('picking a universe reads that universe', async () => {
    serve()
    renderPanel()
    await screen.findByTestId('terminal-scat-chart')
    fireEvent.change(screen.getByTestId('terminal-scat-universe'), { target: { value: 'index:ndx' } })
    await vi.waitFor(() => expect(chart.option.series[0].data.map((d) => d.value[2])).toEqual(['AMD']))
    expect(jsonFetcher).toHaveBeenCalledWith(dataUrl('index', 'ndx'))
  })

  it('clicking a dot loads that ticker into the linked panels', async () => {
    serve()
    const { run } = renderPanel()
    await screen.findByTestId('terminal-scat-chart')
    chart.onEvents.click({ value: [-2.5, 97, 'NVDA'], name: 'NVDA' })
    expect(run).toHaveBeenCalledWith('$NVDA')
  })

  it('a failed read is an error with Retry, never an empty plot; a 402 says paid plan', async () => {
    serve({ sp500: err(500) })
    renderPanel()
    expect((await screen.findByTestId('terminal-scat-data-error')).textContent).toContain('could not be read just now')
    expect(screen.queryByTestId('terminal-scat-chart')).toBeNull()
    serve()
    fireEvent.click(within(screen.getByTestId('terminal-scat-data-error')).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-scat-chart')).toBeTruthy()
    cleanup()
    serve({ metrics: err(402) })
    renderPanel()
    expect((await screen.findByTestId('terminal-scat-error')).textContent).toContain('paid plan')
  })

  it('pure helpers', () => {
    expect(scatterPoints(SP500, 'dist_52w_high', 'rs_rank').missing).toBe(1)
    expect(scatterPoints(null, 'a', 'b')).toEqual({ points: [], missing: 0 })
    expect(universeOptions(null, { source: 'index', value: 'sp500', label: 'S&P 500' })[0].items[0].key).toBe('index:sp500')
    expect(fmtMetric(-2.5, 'pct')).toBe('-2.5%')
    expect(fmtMetric(97, 'num')).toBe('97.0')
    expect(fmtMetric(null, 'pct')).toBe('n/a')
  })
})

describe('SCAT: the view is the command', () => {
  it('a typed universe and axes open that view, and mounting re-runs nothing', async () => {
    serve()
    const { rerun } = renderPanel({ props: propsFor('SCAT NDX CHG_TODAY RS_RANK') })
    await vi.waitFor(() => expect(chart.option?.series[0].data.map((d) => d.value[2])).toEqual(['AMD']))
    expect(jsonFetcher).toHaveBeenCalledWith(dataUrl('index', 'ndx'))
    expect(chart.option.yAxis.name).toBe('% Change Today')
    expect(chart.option.xAxis.name).toBe('RS Rating')
    expect(screen.getByTestId('terminal-scat-universe').value).toBe('index:ndx')
    expect(rerun).not.toHaveBeenCalled()
  })

  it('a changed axis or universe is written back as the command', async () => {
    serve()
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-scat-chart')
    fireEvent.change(screen.getByTestId('terminal-scat-x'), { target: { value: 'chg_today' } })
    expect(rerun).toHaveBeenLastCalledWith('SCAT RS_RANK CHG_TODAY')
    fireEvent.change(screen.getByTestId('terminal-scat-universe'), { target: { value: 'index:ndx' } })
    expect(rerun).toHaveBeenLastCalledWith('SCAT NDX RS_RANK CHG_TODAY')
    fireEvent.change(screen.getByTestId('terminal-scat-x'), { target: { value: 'dist_52w_high' } })
    expect(rerun).toHaveBeenLastCalledWith('SCAT NDX')
    expect(rerun).toHaveBeenCalledTimes(3)
  })

  it('picking what is already showing does nothing: no re-run, so no remount loop', async () => {
    serve()
    const { rerun } = renderPanel({ props: propsFor('SCAT NDX') })
    await screen.findByTestId('terminal-scat-chart')
    fireEvent.change(screen.getByTestId('terminal-scat-universe'), { target: { value: 'index:ndx' } })
    fireEvent.change(screen.getByTestId('terminal-scat-y'), { target: { value: 'rs_rank' } })
    fireEvent.change(screen.getByTestId('terminal-scat-x'), { target: { value: 'dist_52w_high' } })
    expect(rerun).not.toHaveBeenCalled()
  })

  it('the command a pick writes opens the same view when it is run again', async () => {
    serve()
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-scat-chart')
    fireEvent.change(screen.getByTestId('terminal-scat-y'), { target: { value: 'chg_today' } })
    const written = rerun.mock.calls[0][0]
    expect(initialView(propsFor(written))).toMatchObject({ pick: { source: 'index', value: 'sp500' }, yKey: 'chg_today', xKey: 'dist_52w_high' })
  })

  it('a member\'s own list is kept for the open panel, not written, and said so', async () => {
    serve()
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-scat-chart')
    expect(screen.queryByTestId('terminal-scat-unsaved')).toBeNull()
    fireEvent.change(screen.getByTestId('terminal-scat-universe'), { target: { value: 'watchlist:ab12' } })
    await vi.waitFor(() => expect(jsonFetcher).toHaveBeenCalledWith(dataUrl('watchlist', 'ab12')))
    expect(screen.getByTestId('terminal-scat-unsaved').textContent).toBe('This list is not saved in the command, so a reload will not keep it.')
    fireEvent.change(screen.getByTestId('terminal-scat-x'), { target: { value: 'chg_today' } })
    expect(rerun).not.toHaveBeenCalled()                 // a re-run would drop the list
    fireEvent.change(screen.getByTestId('terminal-scat-universe'), { target: { value: 'index:sp500' } })
    expect(rerun).toHaveBeenLastCalledWith('SCAT RS_RANK CHG_TODAY')
  })

  it('outside a terminal panel (no rerun) a pick still changes the view', async () => {
    serve()
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <ScatterPanel />
      </SWRConfig>,
    )
    await screen.findByTestId('terminal-scat-chart')
    fireEvent.change(screen.getByTestId('terminal-scat-x'), { target: { value: 'chg_today' } })
    expect(chart.option.xAxis.name).toBe('% Change Today')
  })

  it('initialView: no props is the default view', () => {
    expect(initialView()).toEqual({ pick: { source: 'index', value: 'sp500', label: 'S&P 500' }, yKey: 'rs_rank', xKey: 'dist_52w_high' })
  })
})

describe('SCAT in the registry', () => {
  it('SCAT opens the scatter panel, market-only', async () => {
    expect(BY_CODE.SCAT.group).toBe('Market')
    expect(variantFor('SCAT', false).variant.panel).toBe('Scatter')
    expect(BY_CODE.SCAT.ticker).toBeUndefined()
    expect(parseCommand('SCAT').code).toBe('SCAT')
    expect((await PANEL_IMPORTERS.Scatter()).default).toBe(ScatterPanel)
  })
})
