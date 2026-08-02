import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import bars200 from '../../../../pages/parityBars/ramp200.json'

// ─── THE MACD HEAD-MASK, PINNED ON THE RENDERED ARTIFACT (B3/A5) ────────────
//
// `nativeRegistry.test.js` pins the COLUMN — what `computeFor` returns. That is
// not where a user meets the mask. `macd` is NOT migrated (it is absent from
// `ENGINE_MIGRATED_DEF_IDS`), so the lane that draws every MACD chart in
// production is `StockChart.jsx`'s `indicatorData` memo, and the mask lives in
// the RENDER path. A pin that only watches the engine's column would stay green
// through a commit that dropped the mask from the lane people actually see.
//
// So this file asserts on the array handed to `series.setData` — the bytes the
// renderer draws from. It is the closest thing to a pixel a vitest run can hold,
// and it is deliberately paired with the real pixel measurement:
//
//     python tools/chart_parity.py --base-a $MASK_ON --base-b $MASK_OFF \
//         --cases macd_headmask --repeat 20
//
// ⚠️ WHAT THIS FILE IS FOR. It is not here because the mask is right. It is here
// because the mask is a DECISION THAT IS STILL OPEN (id **MACD_HEAD_MASK**,
// record at `docs/decisions/2026-08-02-macd-head-mask.md`, adjudication row in
// the indicator-platform spec §11), and an open decision that nothing fails on
// is a decision that gets applied by accident inside somebody's refactor. When
// the owner signs off on dropping the mask, this file is EXPECTED to go red —
// update it in the same commit as the flag, and never separately.
//
// The lightweight-charts double is `stockChartWiring.test.jsx`'s, with one
// change: `setData` RECORDS. Without that, everything below is unreachable from
// the component level — the mask leaves no trace in `addSeries` options.

const H = vi.hoisted(() => ({
  addSeriesCalls: [],
  setDataCalls: [],
  reset() {
    H.addSeriesCalls.length = 0
    H.setDataCalls.length = 0
  },
}))

vi.mock('lightweight-charts', () => {
  const makeSeries = (ctor) => {
    const s = {
      __ctor: ctor,
      setData: (data) => { H.setDataCalls.push({ series: s, data }) },
      update: () => {},
      applyOptions: () => {},
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
      createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
      attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
      moveToPane: () => {}, getPane: () => ({ getHeight: () => 300 }),
    }
    return s
  }
  const timeScaleBase = {
    applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
    getVisibleRange: () => null, setVisibleRange: () => {}, scrollToPosition: () => {}, scrollPosition: () => 0,
    timeToCoordinate: () => 0, coordinateToTime: () => null, logicalToCoordinate: () => 0, coordinateToLogical: () => 0,
    options: () => ({}), width: () => 600, height: () => 40, barSpacing: () => 6,
  }
  const timeScale = new Proxy(timeScaleBase, {
    get: (t, p) => {
      if (p in t) return t[p]
      if (typeof p === 'symbol' || p === 'then') return undefined
      return () => undefined
    },
  })
  const chart = {
    addSeries: (ctor, options, paneIndex) => {
      const s = makeSeries(ctor)
      H.addSeriesCalls.push({ ctor, options, paneIndex, series: s })
      return s
    },
    addCustomSeries: (_impl, options, paneIndex) => {
      const s = makeSeries('custom')
      H.addSeriesCalls.push({ ctor: 'custom', options, paneIndex, series: s })
      return s
    },
    removeSeries: () => {},
    applyOptions: () => {},
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
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    CandlestickSeries: 'CandlestickSeries', HistogramSeries: 'HistogramSeries', LineSeries: 'LineSeries',
    AreaSeries: 'AreaSeries', BaselineSeries: 'BaselineSeries', BarSeries: 'BarSeries',
    createSeriesMarkers: () => ({ setMarkers: () => {} }),
  }
})

vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../../../../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../../../../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

const CANVAS_2D_NOOPS = [
  'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc',
  'stroke', 'fill', 'save', 'restore', 'setLineDash', 'translate', 'scale', 'rotate', 'setTransform',
  'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'rect', 'clip', 'drawImage', 'putImageData',
]
function fakeCanvasContext() {
  const ctx = { canvas: null, measureText: () => ({ width: 0 }), createLinearGradient: () => ({ addColorStop: () => {} }), getImageData: () => ({ data: [] }) }
  for (const m of CANVAS_2D_NOOPS) ctx[m] = () => {}
  return ctx
}
HTMLCanvasElement.prototype.getContext = function getContext() { return fakeCanvasContext() }

beforeEach(() => {
  cleanup()
  H.reset()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})

const { default: StockChart } = await import('../../../StockChart')
const { computeMACD } = await import('../../indicators')
const { MACD_HEAD_MASK, computeFor, getDefinition } = await import('../nativeRegistry')

const BARS = bars200.bars
const MACD_CFG = {
  enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
  macdColor: '#2196F3', signalColor: '#FF9800',
}

/** The DEFAULT 12/26/9 arithmetic, written out rather than derived. */
const LINE_FIRST_BAR = 25          // slowPeriod - 1
const SIGNAL_FIRST_BAR = 33        // + signalPeriod - 1
const MASKED_BARS = [25, 26, 27, 28, 29, 30, 31, 32]   // exactly 8

const draw = () => render(
  <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={{ indicators: { macd: MACD_CFG } }} />,
)

/** The LAST array a given series was handed — that is what is on screen. */
function lastDataFor(predicate) {
  const call = H.addSeriesCalls.filter(predicate).slice(-1)[0]
  if (!call) return null
  const writes = H.setDataCalls.filter(c => c.series === call.series)
  return writes.length ? writes[writes.length - 1].data : null
}

/** `indPoint` emits `{time}` (LWC whitespace) for a NaN and `{time,value}` otherwise. */
const firstDrawn = (data) => data.findIndex(p => Number.isFinite(p && p.value))

describe('the MACD head-mask, on the RENDERED series (B3/A5, decision MACD_HEAD_MASK)', () => {
  it('draws a MACD line and a signal line on the macd scale — else nothing below is real', () => {
    draw()
    const onMacdScale = H.addSeriesCalls.filter(c => c.options?.priceScaleId === 'macd')
    expect(onMacdScale.length, 'the legacy MACD block did not render').toBeGreaterThanOrEqual(3)
    expect(onMacdScale.some(c => c.options.color === MACD_CFG.macdColor)).toBe(true)
    expect(onMacdScale.some(c => c.options.color === MACD_CFG.signalColor)).toBe(true)
  })

  it('holds the line\'s head back to the signal\'s first bar — the shipped look', () => {
    draw()
    const macd = lastDataFor(c => c.options?.priceScaleId === 'macd' && c.options?.color === MACD_CFG.macdColor)
    const signal = lastDataFor(c => c.options?.priceScaleId === 'macd' && c.options?.color === MACD_CFG.signalColor)
    expect(macd, 'MACD line series never received data').toBeTruthy()
    expect(signal, 'signal series never received data').toBeTruthy()
    expect(macd).toHaveLength(BARS.length)
    expect(signal).toHaveLength(BARS.length)

    expect(firstDrawn(signal)).toBe(SIGNAL_FIRST_BAR)
    expect(firstDrawn(macd), 'the drawn line must start WITH its signal').toBe(SIGNAL_FIRST_BAR)
  })

  it('the 8 bars it hides are drawable, and they are bars 25-32', () => {
    draw()
    const macd = lastDataFor(c => c.options?.priceScaleId === 'macd' && c.options?.color === MACD_CFG.macdColor)
    const raw = computeMACD(BARS, 12, 26, 9)

    // The line the maths defines starts 8 bars earlier than the one drawn.
    expect(raw.macd.findIndex(p => Number.isFinite(p.value))).toBe(LINE_FIRST_BAR)
    expect(SIGNAL_FIRST_BAR - LINE_FIRST_BAR).toBe(MASKED_BARS.length)

    for (const i of MASKED_BARS) {
      expect(Number.isFinite(raw.macd[i].value), `computeMACD has a value at bar ${i}`).toBe(true)
      expect(macd[i], `bar ${i} must be drawn as whitespace`).toEqual({ time: macd[i].time })
      expect('value' in macd[i], `bar ${i} must carry NO value`).toBe(false)
    }
    // A head-hold, not a shift: the first UNMASKED bar draws its real value.
    expect(macd[SIGNAL_FIRST_BAR].value).toBe(raw.macd[SIGNAL_FIRST_BAR].value)
    // …and the signal is untouched on both sides of the boundary.
    expect(signalUntouched(lastDataFor(c => c.options?.priceScaleId === 'macd' && c.options?.color === MACD_CFG.signalColor), raw)).toBe(true)
  })

  it('both lanes read ONE switch — the render agrees with the engine column exactly', () => {
    // The whole point of naming the constant. If the engine and the legacy memo
    // ever disagree about the mask, the `macd_headmask` measurement is measuring
    // one lane while the user sees the other, and the number is a lie.
    draw()
    const macd = lastDataFor(c => c.options?.priceScaleId === 'macd' && c.options?.color === MACD_CFG.macdColor)
    const drawnFinite = macd.map(p => Number.isFinite(p && p.value))

    expect(MACD_HEAD_MASK).toBe(true)
    const column = computeFor(getDefinition('macd'), BARS, { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }).macd
    expect(column.length).toBe(drawnFinite.length)
    for (let i = 0; i < column.length; i++) {
      expect(Number.isFinite(column[i]), `engine vs render disagree at bar ${i}`).toBe(drawnFinite[i])
    }
  })
})

function signalUntouched(signal, raw) {
  for (let i = 0; i < signal.length; i++) {
    const s = raw.signal[i].value
    if (Number.isFinite(s)) { if (signal[i].value !== s) return false }
    else if ('value' in signal[i]) return false
  }
  return true
}

