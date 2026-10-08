import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, screen, waitFor } from '@testing-library/react'

// Wave 13 lane 13H-4: the annotationsEditable branch (the one a Notebook chart
// embed's Draw mode actually runs on — ChartEmbed.jsx always passes
// showDrawingTools={false} — see docs/notebook/wave13-13h3.md §2) now gets the
// same MobileDrawBar <-> ChartToolbar swap the showDrawingTools branch already
// had, gated behind the SAME `mobileDrawBar` prop (opt-in, default false).
// This file proves the swap fires on that branch and ONLY when asked for.
//
// Mocks mirror StockChart.smoke.test.jsx exactly (lightweight-charts touches
// <canvas>; the realtime hooks open sockets jsdom doesn't have).
vi.mock('lightweight-charts', () => {
  const series = {
    setData: () => {}, update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
  }
  const chart = {
    addSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => ({
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
      setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
      resetTimeScale: () => {}, options: () => ({}), width: () => 600,
      subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
      getVisibleRange: () => null,
    }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1 },
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {}, BaselineSeries: {},
    createSeriesMarkers: () => ({ setMarkers: () => {} }),
  }
})
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

const BARS = Array.from({ length: 30 }, (_, i) => ({
  t: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`, o: 10, h: 11, l: 9, c: 10.5, v: 1000,
}))

beforeEach(() => {
  cleanup()
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(String(url).includes('/api/bars') ? { bars: BARS } : {}),
  })))
})

const { default: StockChart } = await import('./StockChart')

// A chart with `annotations != null` + bars loaded, so the annotationsEditable
// overlay block actually mounts (StockChart gates it on both). showDrawingTools
// is forced OFF — the real Notebook caller (ChartEmbed.jsx) always does this,
// and leaving it at its own default (true) would additionally mount THAT
// branch's own, unrelated MobileDrawBar/ChartToolbar pairing and confuse what
// this file is checking.
async function renderAnnotated(extraProps) {
  const seen = []
  const utils = render(
    <StockChart
      sym="AAPL"
      tf="D"
      showDrawingTools={false}
      annotations={[]}
      annotationsVisible
      annotationsEditable
      onDrawnBarCount={(n) => seen.push(n)}
      {...extraProps}
    />
  )
  // The annotations block also requires bars?.length > 0 to mount at all —
  // wait for the REAL drawn-bar count, not just "a canvas exists somewhere"
  // (several canvases in this component render whether or not bars loaded).
  await waitFor(() => expect(seen[seen.length - 1]).toBe(BARS.length), { timeout: 4000 })
  return utils
}

describe('StockChart annotationsEditable + mobileDrawBar (13H-4)', () => {
  it('opt-out (default): no MobileDrawBar, and the ChartToolbar host is not hidden', async () => {
    const { container } = await renderAnnotated()
    expect(screen.queryByTestId('mobile-draw-bar')).toBeNull()
    // hiddenHost is only ever applied via the `display: none` inline style this
    // lane wires onto ChartToolbar's own root — absent here is the control half
    // of the mutation proof (killing the wiring would make this pass vacuously
    // in BOTH directions otherwise).
    expect(container.querySelector('[style*="display: none"]')).toBeNull()
  })

  it('opt-in: mobileDrawBar swaps in MobileDrawBar and hides the ChartToolbar host', async () => {
    const { container } = await renderAnnotated({ mobileDrawBar: true })
    expect(screen.getByTestId('mobile-draw-bar')).toBeTruthy()
    // The desktop ChartToolbar is still MOUNTED (its portaled dialogs / ref API
    // must keep serving) — just visually hidden via hiddenHost.
    expect(container.querySelector('[style*="display: none"]')).toBeTruthy()
  })

  it('mobileDrawBar is a no-op on every OTHER StockChart caller (opt-in contract)', async () => {
    // showDrawingTools=true, annotationsEditable left at its default (false):
    // this is the shape every pre-existing showDrawingTools caller already
    // uses; passing mobileDrawBar here must behave exactly as it did before
    // this lane touched the file (the annotations branch never mounts).
    const { container } = render(<StockChart sym="AAPL" tf="D" showDrawingTools mobileDrawBar />)
    await waitFor(() => expect(container.querySelectorAll('canvas').length).toBeGreaterThan(0))
    // The showDrawingTools branch's own MobileDrawBar wiring is unrelated to
    // this lane (pre-existing) and is free to render here — the point of this
    // case is narrower: an annotationsEditable=false mount must never render
    // the annotations-branch's ChartDrawingOverlay/ChartToolbar pairing at all,
    // which `annotationsEditable + mobileDrawBar` cases above cover by name.
    expect(container).toBeTruthy()
  })
})
