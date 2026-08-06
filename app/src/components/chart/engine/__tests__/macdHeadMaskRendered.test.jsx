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
// not where a user meets this. A pin that only watched the engine's column would
// stay green through a commit that re-masked the lane people actually see, and a
// flip that had reached only the column would have measured **0 px** instead of
// 88.
//
// 🔴 THIS PARAGRAPH USED TO SAY *"`macd` is NOT migrated … so the lane that draws
// every MACD chart in production is `StockChart.jsx`'s `indicatorData` memo"*,
// and B5 Task 8 finished falsifying it: `macd` is in BOTH flip sets, its
// hand-written block is deleted, and the lane that draws it is the binder. That
// does not retire this file — it is why it keeps `computeMACD` (the LEGACY
// arithmetic, which nothing renders any more) as the independent oracle the drawn
// bytes are compared against below. The pin is still on the rendered artifact;
// only the renderer behind it changed.
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

// ─── WHICH SERIES ARE MACD'S ────────────────────────────────────────────────
//
// ⭐ B5 TASK 12 RETIRED `priceScaleId === 'macd'` AS A SELECTOR, and it is not a
// rename. Under `PANE_MODE = 'panes'` every oscillator draws in a REAL pane on
// that pane's own visible right axis (sub-choice 2.2), so `priceScaleId` names
// the AXIS SIDE and no longer names the indicator: `'right'` is also the candles',
// every MA overlay's and every other oscillator's. A selector on it either matches
// nothing (the old string) or matches half the chart (the new one).
//
// ⛔ AND THE REPLACEMENT IS THE SERIES' ROLE, NOT ITS PANE. A pane index would
// work today and would make this file — whose subject is a decision about which
// BARS are drawn — go red on a Flip-C reversal, which is one edit and is priced at
// the same numbers. The role is what the head-mask claim is actually about: the
// MACD line versus its signal. `macdColor`/`signalColor` are set explicitly in
// `MACD_CFG` above, so each names exactly one series on this chart in EITHER mode.
//
// What the pane/scale IS still gets asserted — as a relation rather than a
// literal: the two lines must share one axis, or "the line starts 8 bars before
// the signal" is not a statement about one picture. `placement.test.js` owns the
// literal (`'right'`, and never the definition id).

/** The `addSeries` call for one of MACD's two lines, by its configured colour. */
const macdCall = (color) => H.addSeriesCalls.filter(c => c.options?.color === color).slice(-1)[0] || null
const macdLineCall = () => macdCall(MACD_CFG.macdColor)
const signalLineCall = () => macdCall(MACD_CFG.signalColor)

/** Every series sharing the MACD line's (pane, price scale) — line, signal, histogram. */
function seriesOnMacdAxis() {
  const line = macdLineCall()
  if (!line) return []
  return H.addSeriesCalls.filter(c =>
    c.paneIndex === line.paneIndex && c.options?.priceScaleId === line.options?.priceScaleId)
}

/** The LAST array the MACD line / signal line was handed. */
const macdLineData = () => lastDataFor(c => c.options?.color === MACD_CFG.macdColor)
const signalLineData = () => lastDataFor(c => c.options?.color === MACD_CFG.signalColor)

describe('the MACD head-mask, DROPPED, on the RENDERED series (B3/A5, decision MACD_HEAD_MASK)', () => {
  it('draws a MACD line and a signal line on ONE shared axis — else nothing below is real', () => {
    draw()
    const line = macdLineCall()
    const signal = signalLineCall()
    expect(line, 'the MACD line never rendered').toBeTruthy()
    expect(signal, 'the signal line never rendered').toBeTruthy()

    // SAME pane, SAME price scale. Not decoration: every claim below compares the
    // two lines' first drawn bar, and two lines on two ladders are two pictures.
    expect(signal.paneIndex, 'the two lines are in different panes').toBe(line.paneIndex)
    expect(signal.options.priceScaleId, 'the two lines are on different scales')
      .toBe(line.options.priceScaleId)

    // …and the histogram is on it too — three series, one axis, which is what the
    // legacy `applyIndScale` call did and what the binder's trap #6 preserves.
    expect(seriesOnMacdAxis().length, 'the MACD block did not render').toBeGreaterThanOrEqual(3)
  })

  it('draws the line from its OWN first bar, 8 before the signal — the mask is gone', () => {
    draw()
    const macd = macdLineData()
    const signal = signalLineData()
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
    const macd = macdLineData()
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
    expect(signalUntouched(signalLineData(), raw)).toBe(true)
  })

  it('both lanes read ONE switch — the render agrees with the engine column exactly', () => {
    // The whole point of naming the constant, and the reason the 88 is honest. If
    // the drawn bytes and the column ever disagree about the mask, `macd_headmask`
    // measures one lane while the user sees the other — and a flip that reached
    // only the column would have priced this decision at 0 px.
    //
    // 🔴 THE TWO LANES ARE NO LONGER *engine vs legacy memo* — B5 Task 8 deleted
    // the memo. They are the COLUMN and the BYTES HANDED TO THE RENDERER, which
    // is the boundary a re-masking `indPoint`-style conversion would live at, and
    // the case above holds the third source: `computeMACD`, the legacy arithmetic
    // nothing renders any more.
    draw()
    const macd = macdLineData()
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

