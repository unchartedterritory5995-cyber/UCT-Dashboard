// GP's panel: what it hands the shared chart.
//   * a registered GP (a stock, an index) hands the chart exactly what it always did, with live
//     updates ON and nothing extra;
//   * the one other caller, the currency-pair panel, can switch live updates off and add the
//     daily-only switches.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

const { chartSpy } = vi.hoisted(() => ({ chartSpy: vi.fn() }))
vi.mock('../../../components/StockChart', () => ({ default: (props) => { chartSpy(props); return <div data-testid="chart" /> } }))
import ChartPanel from './ChartPanel'

beforeEach(() => chartSpy.mockReset())
afterEach(cleanup)

describe('GP hands the chart', () => {
  it('for a stock: the same props as ever, live updates on, nothing extra', () => {
    render(<ChartPanel sym="NVDA" tf="5" />)
    expect(chartSpy.mock.calls.at(-1)[0]).toEqual({ sym: 'NVDA', tf: '5', height: '100%', showDrawingTools: false, hideReplay: true, liveUpdates: true })
    cleanup()
    render(<ChartPanel sym="SPY" />)
    expect(chartSpy.mock.calls.at(-1)[0]).toEqual({ sym: 'SPY', tf: 'D', height: '100%', showDrawingTools: false, hideReplay: true, liveUpdates: true })
  })

  it('for a currency pair: live updates off and the daily-only switches', () => {
    render(<ChartPanel sym="BTCUSD" tf="D" liveUpdates={false} chartProps={{ breadthSeries: true, watermarkName: 'Bitcoin' }} />)
    expect(chartSpy.mock.calls.at(-1)[0]).toEqual({
      sym: 'BTCUSD', tf: 'D', height: '100%', showDrawingTools: false, hideReplay: true, liveUpdates: false, breadthSeries: true, watermarkName: 'Bitcoin',
    })
  })
})
