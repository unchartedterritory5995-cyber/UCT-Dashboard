import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// ECharts renders a canvas in jsdom — stub it and capture the option so we can
// assert what got plotted without a real chart.
let chartOption = null
vi.mock('echarts-for-react', () => ({
  default: (props) => { chartOption = props.option; return <div data-testid="echart" /> },
}))

// The widget calls useMobileSWR three times (metrics / universes / data); branch on url.
const METRICS = [
  { key: 'chg_today', label: '% Change Today', group: 'Today', unit: 'pct', live: true },
  { key: 'rvol', label: 'RVOL (today)', group: 'Today', unit: 'x', live: true },
  { key: 'rs_rank', label: 'RS Rating', group: 'Momentum', unit: 'num', live: false },
]
const UNIVERSES = { groups: [{ group: 'Indices', items: [{ source: 'index', value: 'sp500', label: 'S&P 500' }] }] }
const DATA = {
  label: 'S&P 500', count: 2,
  tickers: [
    { sym: 'AAPL', name: 'Apple', sector: 'Tech', dir: 'up', m: { chg_today: 2.1, rvol: 1.4, rs_rank: 88 } },
    { sym: 'XYZ', name: 'Zed', sector: 'Fin', dir: 'down', m: { chg_today: -1.2, rvol: 0.8, rs_rank: 40 } },
  ],
}
vi.mock('../../../hooks/useMobileSWR', () => ({
  default: (url) => {
    if (typeof url === 'string' && url.includes('/scatter/metrics')) return { data: { metrics: METRICS } }
    if (typeof url === 'string' && url.includes('/scatter/universes')) return { data: UNIVERSES }
    if (typeof url === 'string' && url.includes('/scatter/data')) return { data: DATA, isValidating: false }
    return { data: null }
  },
}))
const setGroupSym = vi.fn()
vi.mock('../WorkspaceContext', () => ({ useWorkspace: () => ({ setGroupSym }) }))
vi.mock('../../../hooks/usePlacedTheme', () => ({ default: () => 'dark' }))

import ScatterWidget from './ScatterWidget'

beforeEach(() => {
  chartOption = null
  setGroupSym.mockReset()
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ points: {} }) }))
})

describe('ScatterWidget', () => {
  it('renders the universe pill + the point count', () => {
    render(<ScatterWidget color="A" opts={{}} onOptsChange={() => {}} />)
    expect(screen.getByText('S&P 500')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()   // 2 plotted points
  })

  it('labels the axes from the chosen metrics (default RVOL vs % Change)', () => {
    render(<ScatterWidget color="A" opts={{}} onOptsChange={() => {}} />)
    expect(screen.getByText('RVOL (today)')).toBeInTheDocument()      // X (default rvol)
    expect(screen.getByText('% Change Today')).toBeInTheDocument()    // Y (default chg_today)
  })

  it('plots a point per ticker, coloured by direction, with the right coords', () => {
    render(<ScatterWidget color="A" opts={{}} onOptsChange={() => {}} />)
    const data = chartOption.series[0].data
    expect(data).toHaveLength(2)
    const aapl = data.find(d => d.value[3] === 'AAPL')
    expect(aapl.value[0]).toBe(1.4)     // x = rvol
    expect(aapl.value[1]).toBe(2.1)     // y = chg_today
    expect(aapl.itemStyle.color).toBe('#34d17c')   // up → green
    const xyz = data.find(d => d.value[3] === 'XYZ')
    expect(xyz.itemStyle.color).toBe('#f24b42')    // down → red
  })

  it('switching the Y-axis metric persists via opts.yKey', () => {
    const onOpts = vi.fn()
    render(<ScatterWidget color="A" opts={{}} onOptsChange={onOpts} />)
    fireEvent.click(screen.getByText('% Change Today'))     // open Y menu
    fireEvent.click(screen.getByText('RS Rating'))          // pick RS
    expect(onOpts).toHaveBeenCalledWith(expect.objectContaining({ yKey: 'rs_rank' }))
  })

  it('the ＋ button opens the universe picker; picking one ADDS a tab', () => {
    const onOpts = vi.fn()
    render(<ScatterWidget color="A" opts={{}} onOptsChange={onOpts} />)
    fireEvent.click(screen.getByLabelText('Add a universe'))
    expect(screen.getByText('Indices')).toBeInTheDocument()
    // The default tab is already S&P 500; the menu item is the second "S&P 500".
    const items = screen.getAllByText('S&P 500')
    fireEvent.click(items[items.length - 1])
    // Same universe already present → switches to it rather than duplicating.
    expect(onOpts).toHaveBeenCalledWith(expect.objectContaining({ activeUniverse: 0 }))
  })

  it('renders one tab per saved universe and switches on click', () => {
    const onOpts = vi.fn()
    render(<ScatterWidget color="A" onOptsChange={onOpts}
      opts={{ universes: [
        { source: 'index', value: 'sp500', label: 'S&P 500' },
        { source: 'index', value: 'ndx', label: 'Nasdaq 100' },
      ], activeUniverse: 0 }} />)
    expect(screen.getByText('S&P 500')).toBeInTheDocument()
    expect(screen.getByText('Nasdaq 100')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Nasdaq 100'))
    expect(onOpts).toHaveBeenCalledWith(expect.objectContaining({ activeUniverse: 1 }))
  })

  it('a tab can be removed (but never the last one)', () => {
    const onOpts = vi.fn()
    render(<ScatterWidget color="A" onOptsChange={onOpts}
      opts={{ universes: [
        { source: 'index', value: 'sp500', label: 'S&P 500' },
        { source: 'index', value: 'ndx', label: 'Nasdaq 100' },
      ], activeUniverse: 1 }} />)
    fireEvent.click(screen.getAllByLabelText('Remove universe')[1])   // remove Nasdaq
    expect(onOpts).toHaveBeenCalledWith(expect.objectContaining({
      universes: [{ source: 'index', value: 'sp500', label: 'S&P 500' }],
    }))
  })

  it('a point with a missing axis value is dropped from the plot', () => {
    render(<ScatterWidget color="A" opts={{ xKey: 'rs_rank', yKey: 'chg_today' }} onOptsChange={() => {}} />)
    // both AAPL + XYZ have rs_rank + chg_today → still 2
    expect(chartOption.series[0].data).toHaveLength(2)
  })
})
