// SCAT: a universe on two metrics. Rails:
//   * by default RS rank (Y) against % off the 52-week high (X) over the S&P 500, from the Market Map's
//     own /api/scatter reads; a name missing either value is counted, never drawn at zero;
//   * the axis menus are the server's metric catalog; changing an axis re-plots;
//   * picking a universe reads that universe;
//   * clicking a dot loads that ticker into the linked panels;
//   * a failed read is an error with Retry, never an empty plot; a 402 says paid plan;
//   * the registry: `SCAT` resolves to this panel, market-only.
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
import { PanelListContext } from '../../../components/terminal'
import ScatterPanel, { METRICS_URL, UNIVERSES_URL, dataUrl, fmtMetric, scatterPoints, universeOptions } from './ScatterPanel'
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
      : url === dataUrl('index', 'sp500') ? sp500 : url === dataUrl('index', 'ndx') ? NDX : err(404)
    if (hit instanceof Error) throw hit
    return hit
  })
}
function renderPanel({ open = vi.fn(), run = vi.fn() } = {}) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelListContext.Provider value={{ open, rerun: vi.fn(), run }}>
        <ScatterPanel />
      </PanelListContext.Provider>
    </SWRConfig>,
  )
  return { open, run }
}

beforeEach(() => { jsonFetcher.mockReset(); chart.option = null; chart.onEvents = null })
afterEach(cleanup)

describe('SCAT panel', () => {
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

describe('SCAT in the registry', () => {
  it('SCAT opens the scatter panel, market-only', async () => {
    expect(BY_CODE.SCAT.group).toBe('Market')
    expect(variantFor('SCAT', false).variant.panel).toBe('Scatter')
    expect(BY_CODE.SCAT.ticker).toBeUndefined()
    expect(parseCommand('SCAT').code).toBe('SCAT')
    expect((await PANEL_IMPORTERS.Scatter()).default).toBe(ScatterPanel)
  })
})
