/**
 * A SYMBOL MUST NEVER DISPLAY ANOTHER SYMBOL'S BARS.
 *
 * 2026-09-20, reproduced against production. A chart whose header read GOOGL
 * printed `O 984.72 H 1016.44 L 977.83 C 1015.80 +38.30 +3.92%` — MU's quote,
 * exact to every decimal (GOOGL's own was 349.54 / +0.64%). A second chart headed
 * NOW printed TRI's, down to `Volume 4.0M` (4,007,052). It looked BLACK rather
 * than merely wrong because `ChartSkeleton` is opaque at `z-index: 2` while the
 * legend sits at `z-index: 3`, so the stale strip painted on top of the skeleton
 * that was hiding the empty canvas.
 *
 * Root cause: `prevBarsRef` carries no symbol, and the empty-bars early return in
 * `updateChart` cleared `candleSeriesRef`, `volumeSeriesRef` and
 * `prevPaintBarsRef` — but not it. `computeLatestCrosshair()` reads that ref, so
 * the outgoing ticker's last bar became the incoming ticker's readout. Worse,
 * `ohlcData` recomputing to a fresh `[]` is in the readout effect's deps, so the
 * switch actively RE-published the stale payload, and a 500 ms interval kept it
 * alive.
 *
 * ⚠️ This is a DATA-IDENTITY test, not a CSS one. Hiding the legend while loading
 * would make the screenshot look right and leave the defect in place: the readout
 * would still be built from another ticker's bars. So the assertion is on the
 * printed VALUES, and the fix is a symbol stamp on the bars themselves.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, waitFor, act } from '@testing-library/react'

// Two tickers with disjoint, unmistakable price bands — no value of one can be
// mistaken for a rounding of the other.
const A = { sym: 'MU', close: 1015.8, open: 984.72, high: 1016.44, low: 977.83 }
const B = { sym: 'GOOGL' }

vi.mock('lightweight-charts', () => {
  const series = {
    setData: () => {}, update: () => {}, applyOptions: () => {},
    priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
    attachPrimitive: () => {}, detachPrimitive: () => {}, priceToCoordinate: () => 0,
    coordinateToPrice: () => 0, options: () => ({}), dataByIndex: () => null,
    getPane: () => ({ getHeight: () => 300, paneIndex: () => 0 }),
    barsInLogicalRange: () => null, data: () => [], seriesType: () => 'Candlestick',
  }
  const timeScale = {
    applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {},
    getVisibleLogicalRange: () => null, setVisibleRange: () => {}, scrollToPosition: () => {},
    subscribeVisibleLogicalRangeChange: () => {}, unsubscribeVisibleLogicalRangeChange: () => {},
    timeToCoordinate: () => 0, coordinateToTime: () => null, resetTimeScale: () => {},
    options: () => ({}), width: () => 600,
    subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    getVisibleRange: () => null, coordinateToLogical: () => 0, logicalToCoordinate: () => 0,
    timeToIndex: () => 0, height: () => 40, scrollPosition: () => 0,
  }
  const chart = {
    addSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    removeSeries: () => {}, applyOptions: () => {},
    priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {},
    createSeriesMarkers: () => ({ setMarkers: () => {} }),
    BaselineSeries: {}, LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
  }
})

vi.mock('../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: {}, staleSymbols: new Set(), isStreaming: false, status: 'idle' }),
}))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))
vi.mock('../utils/barsIDB', () => ({
  idbGet: async () => null, idbPut: async () => {}, mergeDelta: (_a, b) => b,
  idbDelete: async () => {}, idbDeleteIntraday: async () => {}, idbCountKeys: async () => 0,
  idbImportPack: async () => {}, idbApplyDelta: async () => {},
  _findRecentBarByT: () => null, _closeMismatch: () => false,
}))

function barsFor(spec) {
  const out = []
  const d = new Date(Date.UTC(2026, 0, 5))
  for (let i = 0; i < 260; i++) {
    const day = d.getUTCDay()
    if (day !== 0 && day !== 6) {
      out.push({
        t: d.toISOString().slice(0, 10),
        o: spec.open, h: spec.high, l: spec.low, c: spec.close, v: 1000,
      })
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

// B never returns bars — the "new ticker is still loading" state that produced
// the screenshots. A returns a full series.
const BY_SYM = { [A.sym]: barsFor(A) }

beforeEach(() => {
  cleanup()
  vi.stubGlobal('fetch', vi.fn((url) => {
    const s = String(url)
    const m = s.match(/\/api\/bars(?:-history)?\/([A-Z.]+)/)
    const sym = m && m[1]
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(
        sym ? { ticker: sym, bars: BY_SYM[sym] || [] } : {}),
    })
  }))
})

const { default: StockChart } = await import('./StockChart')

const CHART_PROPS = { tf: 'D', alwaysShowLegend: true, height: 400 }

/** Every number the bar-info strip could print for A, as it would be formatted. */
const A_VALUES = [A.close, A.open, A.high, A.low].map(v => v.toFixed(2))

describe('stale readout identity', () => {
  it('does not print the previous ticker\'s O/H/L/C under the new ticker', async () => {
    const { container, rerender } = render(<StockChart sym={A.sym} {...CHART_PROPS} />)

    // A is fully painted: its close reaches the strip.
    await waitFor(() => {
      expect(container.textContent).toContain(A.close.toFixed(2))
    }, { timeout: 4000 })

    // Switch to a ticker whose bars have not arrived.
    await act(async () => {
      rerender(<StockChart sym={B.sym} {...CHART_PROPS} />)
      await new Promise(r => setTimeout(r, 0))
    })

    // The 500ms interval that kept the stale payload alive gets a chance to fire.
    await act(async () => { await new Promise(r => setTimeout(r, 700)) })

    const text = container.textContent
    for (const v of A_VALUES) {
      expect(text, `readout printed ${A.sym}'s ${v} while showing ${B.sym}`).not.toContain(v)
    }
  })

  it('shows no readout at all rather than a wrong one', async () => {
    const { container, rerender } = render(<StockChart sym={A.sym} {...CHART_PROPS} />)
    await waitFor(() => {
      expect(container.textContent).toContain(A.close.toFixed(2))
    }, { timeout: 4000 })

    await act(async () => {
      rerender(<StockChart sym={B.sym} {...CHART_PROPS} />)
      await new Promise(r => setTimeout(r, 700))
    })

    // `computeLatestCrosshair` must return null, not a half-filled candle: no
    // stray "O"/"H"/"L"/"C" field carrying a number from the old ticker.
    expect(container.textContent).not.toMatch(/\d+\.\d{2}/)
  })
})
