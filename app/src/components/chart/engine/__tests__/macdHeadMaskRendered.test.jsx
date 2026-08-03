import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import bars200 from '../../../../pages/parityBars/ramp200.json'

// ─── THE MACD HEAD-MASK, DROPPED — PINNED ON THE RENDERED ARTIFACT (B3/A5) ──
//
// ✅ **DECIDED 2026-08-02: the owner dropped the mask.** `MACD_HEAD_MASK` is
// `false`. This file used to assert that bars 25-32 were drawn as whitespace; it
// now asserts they carry their real values. Measured cost of the flip: **88
// changed pixels (0.011828%)**, builds `9f566cd22874` (mask on) vs
// `9045bb69fc56` (mask off), 20/20 runs.
//
// `nativeRegistry.test.js` pins the COLUMN — what `computeFor` returns. That is
// not where a user meets this. `macd` is NOT migrated (it is absent from
// `ENGINE_MIGRATED_DEF_IDS`), so the lane that draws every MACD chart in
// production is `StockChart.jsx`'s `indicatorData` memo. A pin that only watched
// the engine's column would stay green through a commit that re-masked the lane
// people actually see — and, symmetrically, a flip that had reached only the
// engine would have measured **0 px** instead of 88.
//
// So this file asserts on the array handed to `series.setData` — the bytes the
// renderer draws from. It is the closest thing to a pixel a vitest run can hold,
// and it is deliberately paired with the real pixel measurement:
//
//     python tools/chart_parity.py --base-a $MASK_OFF --base-b $MASK_ON \
//         --cases macd_headmask --repeat 20
//
// ⚠️ WHAT THIS FILE IS FOR. It is not here because the mask was wrong. It is here
// because the mask is a DECISION (id **MACD_HEAD_MASK**, record at
// `docs/decisions/2026-08-02-macd-head-mask.md`, adjudication row in the
// indicator-platform spec §11, status ACCEPTED), and a decision that nothing
// fails on is a decision that gets REVERSED by accident inside somebody's
// refactor as easily as it was once applied by one. The direction of the pin
// flipped with the decision; its job did not.
//
// The lightweight-charts double is `stockChartWiring.test.jsx`'s, with one
// change: `setData` RECORDS. Without that, everything below is unreachable from
// the component level — the mask left no trace in `addSeries` options.

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
/** The 8 bars the mask used to hide. They are the 88 pixels. */
const FORMERLY_MASKED_BARS = [25, 26, 27, 28, 29, 30, 31, 32]   // exactly 8

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

describe('the MACD head-mask, DROPPED, on the RENDERED series (B3/A5, decision MACD_HEAD_MASK)', () => {
  it('draws a MACD line and a signal line on the macd scale — else nothing below is real', () => {
    draw()
    const onMacdScale = H.addSeriesCalls.filter(c => c.options?.priceScaleId === 'macd')
    expect(onMacdScale.length, 'the legacy MACD block did not render').toBeGreaterThanOrEqual(3)
    expect(onMacdScale.some(c => c.options.color === MACD_CFG.macdColor)).toBe(true)
    expect(onMacdScale.some(c => c.options.color === MACD_CFG.signalColor)).toBe(true)
  })

  it('draws the line from its OWN first bar, 8 before the signal — the mask is gone', () => {
    draw()
    const macd = lastDataFor(c => c.options?.priceScaleId === 'macd' && c.options?.color === MACD_CFG.macdColor)
    const signal = lastDataFor(c => c.options?.priceScaleId === 'macd' && c.options?.color === MACD_CFG.signalColor)
    expect(macd, 'MACD line series never received data').toBeTruthy()
    expect(signal, 'signal series never received data').toBeTruthy()
    expect(macd).toHaveLength(BARS.length)
    expect(signal).toHaveLength(BARS.length)

    expect(firstDrawn(signal)).toBe(SIGNAL_FIRST_BAR)
    expect(firstDrawn(macd), 'the drawn line must NOT be held back to its signal').toBe(LINE_FIRST_BAR)
    expect(SIGNAL_FIRST_BAR - firstDrawn(macd), 'the 88 px are these bars').toBe(FORMERLY_MASKED_BARS.length)
  })

  it('the 8 bars it used to hide are DRAWN, with their real values, and they are 25-32', () => {
    draw()
    const macd = lastDataFor(c => c.options?.priceScaleId === 'macd' && c.options?.color === MACD_CFG.macdColor)
    const raw = computeMACD(BARS, 12, 26, 9)

    // The line the maths defines starts 8 bars before the signal, and that is now
    // what is drawn.
    expect(raw.macd.findIndex(p => Number.isFinite(p.value))).toBe(LINE_FIRST_BAR)
    expect(SIGNAL_FIRST_BAR - LINE_FIRST_BAR).toBe(FORMERLY_MASKED_BARS.length)

    for (const i of FORMERLY_MASKED_BARS) {
      expect(Number.isFinite(raw.macd[i].value), `computeMACD has a value at bar ${i}`).toBe(true)
      expect('value' in macd[i], `bar ${i} must now carry a value`).toBe(true)
      expect(macd[i].value, `bar ${i} must be drawn at its real value`).toBe(raw.macd[i].value)
    }
    // The bar BEFORE the line begins is still whitespace — the flip restored the
    // head, it did not invent history in front of it.
    expect('value' in macd[LINE_FIRST_BAR - 1], `bar ${LINE_FIRST_BAR - 1} must stay whitespace`).toBe(false)
    // The bar the mask used to stop at is unchanged.
    expect(macd[SIGNAL_FIRST_BAR].value).toBe(raw.macd[SIGNAL_FIRST_BAR].value)
    // …and the signal is untouched on both sides of the old boundary — dropping
    // the mask moved ONE series, which is why the 88 px are one 44×4 sliver.
    expect(signalUntouched(lastDataFor(c => c.options?.priceScaleId === 'macd' && c.options?.color === MACD_CFG.signalColor), raw)).toBe(true)
  })

  it('both lanes read ONE switch — the render agrees with the engine column exactly', () => {
    // The whole point of naming the constant, and the reason the 88 is honest. If
    // the engine and the legacy memo ever disagree about the mask, `macd_headmask`
    // measures one lane while the user sees the other — and a flip that reached
    // only the engine would have priced this decision at 0 px.
    draw()
    const macd = lastDataFor(c => c.options?.priceScaleId === 'macd' && c.options?.color === MACD_CFG.macdColor)
    const drawnFinite = macd.map(p => Number.isFinite(p && p.value))

    expect(MACD_HEAD_MASK).toBe(false)
    const column = computeFor(getDefinition('macd'), BARS, { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }).macd
    expect(column.length).toBe(drawnFinite.length)
    for (let i = 0; i < column.length; i++) {
      expect(Number.isFinite(column[i]), `engine vs render disagree at bar ${i}`).toBe(drawnFinite[i])
    }
    // Not just the finite-ness — the VALUES. Element for element on every bar the
    // line covers, which is §9.1 with no render-boundary exception left in it.
    for (let i = 0; i < column.length; i++) {
      if (Number.isFinite(column[i])) expect(macd[i].value, `bar ${i}`).toBe(column[i])
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

