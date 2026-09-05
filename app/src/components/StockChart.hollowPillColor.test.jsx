import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

// Regression test for the black price-pill bug (root-caused 2026-09-04/05):
// a hollow candle's transparent body used the literal 'rgba(0,0,0,0)', and
// lightweight-charts reuses a series' per-bar `color` for the last-value axis
// label — its internal color parser strips alpha before contrasting, turning
// transparent BLACK into an OPAQUE black box over the price pill. The fix
// (_hollowFill, in StockChart.jsx) keeps the real up/down RGB and only zeroes
// alpha, so a future library change to that parser can't paint the pill black
// again — this test captures the actual `color` handed to the mocked series'
// setData(), the same value the library's label logic consumes.

let setDataCalls
let applyOptionsCalls
vi.mock('lightweight-charts', () => {
  const series = {
    setData: (...args) => { setDataCalls.push(args[0]) },
    update: () => {}, applyOptions: (opts) => { applyOptionsCalls.push(opts) }, priceScale: () => ({ applyOptions: () => {} }),
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
    }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {}, createSeriesMarkers: () => ({ setMarkers: () => {} }),
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

const { default: StockChart } = await import('./StockChart')
const { _hollowFill } = await import('./StockChart')

// Every up day (close >= prevClose, netchange default) also closing above its
// own open (close >= open) — the exact combination that flips the hollow branch.
const bars = [
  { t: '2026-08-01', o: 10, h: 11, l: 9, c: 10, v: 1000 },
  { t: '2026-08-02', o: 10.2, h: 11.5, l: 10, c: 11, v: 1000 },
  { t: '2026-08-03', o: 11.1, h: 12.5, l: 11, c: 12, v: 1000 },
]

beforeEach(() => {
  cleanup()
  setDataCalls = []
  applyOptionsCalls = []
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(String(url).includes('/api/bars') ? { bars } : {}),
  })))
})

describe('_hollowFill', () => {
  it('zeroes alpha but keeps the real RGB', () => {
    expect(_hollowFill('#21c45c')).toBe('rgba(33,196,92,0)')
  })

  it('falls back to the old flat-black placeholder only when unparseable (never worse than before the fix)', () => {
    expect(_hollowFill('var(--whatever)')).toBe('rgba(0,0,0,0)')
    expect(_hollowFill(undefined)).toBe('rgba(0,0,0,0)')
  })
})

// Asserts a color string is 'rgba(r,g,b,0)' whose RGB is NOT flat black — the
// bug collapsed every hollow color to black; the fix must keep the real hue.
function expectAlphaZeroedNonBlack(color) {
  const m = /^rgba\((\d+),(\d+),(\d+),0\)$/.exec(color)
  expect(m).not.toBeNull()
  expect(m[1] === '0' && m[2] === '0' && m[3] === '0').toBe(false)
}

describe('hollow candle body color (the black price-pill bug)', () => {
  it('netchange mode (_paintNet, the confirmed root cause): per-bar hollow color keeps the real up/down RGB', async () => {
    // colorByNetChange + a hollow-eligible theme (sunrise) on the 'candles' type
    // is the exact combination that reaches _paintNet's hollow branch (line ~8748).
    render(<StockChart sym="AAPL" tf="D" colorByNetChange canvasTheme="sunrise" settingsOverride={{ chartType: 'candles' }} />)
    await vi.waitFor(() => expect(setDataCalls.length).toBeGreaterThan(0), { timeout: 4000 })
    // Several series share the mocked setData (candles + volume histogram);
    // the candlestick payload is the one whose bars carry open/close.
    const candleCalls = setDataCalls.filter((call) => call.some((b) => b?.close != null && b?.open != null))
    const painted = candleCalls[candleCalls.length - 1]
    const hollowBars = painted.filter((b) => b?.color && b.color !== 'rgba(0,0,0,0)')
    // At least one bar took the real fix path (an unparseable custom color would
    // fall back to the old literal and not appear here, which would also fail).
    expect(hollowBars.length).toBeGreaterThan(0)
    for (const b of hollowBars) expectAlphaZeroedNonBlack(b.color)
  })

  it("hollow chart TYPE (series-level 'Live color apply', line ~8809): upColor keeps the real up RGB", async () => {
    render(<StockChart sym="AAPL" tf="D" settingsOverride={{ chartType: 'hollow', candles: { upColor: '#22c55e', downColor: '#ef4444' } }} />)
    await vi.waitFor(() => expect(applyOptionsCalls.some((o) => o && 'upColor' in o)).toBe(true), { timeout: 4000 })
    // The FIRST pass can precede prefs/settings loading (upColor still unresolved,
    // same safe placeholder as before this fix) — the steady-state (last) call is
    // what a settled headless render actually paints, so that's what must be fixed.
    const hollowApply = applyOptionsCalls.filter((o) => o && 'upColor' in o)
    expectAlphaZeroedNonBlack(hollowApply[hollowApply.length - 1].upColor)
  })
})
