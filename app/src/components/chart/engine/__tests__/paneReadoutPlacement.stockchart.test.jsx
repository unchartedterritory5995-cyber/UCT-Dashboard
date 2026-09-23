// ─── PANE READOUTS SIT WHERE THE SERIES DREW — THE STOCKCHART-LEVEL RAIL ─────
//
// ⚰️ THE DEFECT (fixed in cb4fb9a67, PRE-EXISTING on master): `computePaneLayout`
// runs before the binder computes anything, so it gives every own-pane host a
// SLOT — including one whose column is all-NaN. The pool gives that host no
// series, lightweight-charts never makes its pane, and a readout pinned by SLOT
// labels the NEXT pane down with the empty host's name. Measured in a real
// browser: `sym:ZZZZ` (no bars) above `sym:SPY` captioned SPY's line "ZZZZ".
//
// ⭐ WHY THIS FILE EXISTS BESIDE `legendFromDefinitions.test.jsx`: that file's
// renderer double answers `getPane()` with no `paneIndex`, so it only ever runs
// the fix's FALLBACK path, and its `panes()` is one frozen pane. This double
// behaves like lightweight-charts in the one respect that matters: A PANE EXISTS
// ONLY WHILE IT HOLDS A SERIES, so physical pane indices COMPACT when a slot has
// nothing in it. That is the regime in which slot ≠ pane.
//
// ⛔ NO FUNDAMENTALS HERE. The no-data host is an RSI(100) on 60 bars — a
// technical indicator that honestly computes nothing — so this rail proves the
// shared fix on its own, independent of the feature that exposed it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import bars200 from '../../../../pages/parityBars/ramp200.json'
import { legendAlways } from './legendProbe'

const H = vi.hoisted(() => ({
  live: [],                 // series currently on the chart, creation order
  crosshairHandlers: [],
  reset() { H.live.length = 0; H.crosshairHandlers.length = 0 },
  /** Distinct requested slots of LIVE series, ascending: the panes that exist. */
  occupied() { return [...new Set(H.live.map((s) => s.__slot))].sort((a, b) => a - b) },
  /** Physical index = rank of the series' slot among occupied slots (compaction). */
  paneIndexOf(s) { return H.occupied().indexOf(s.__slot) },
  heightOf(i) { return 100 + 10 * i },          // distinct, so a `top` names its index
}))

vi.mock('lightweight-charts', () => {
  const makeSeries = (ctor, options, slot) => {
    const s = {
      __ctor: ctor, __slot: Number.isInteger(slot) ? slot : 0, __options: { ...(options || {}) },
      setData: () => {}, update: () => {},
      applyOptions: (o) => { Object.assign(s.__options, o || {}) },
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
      createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
      attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => s.__options,
      moveToPane: (i) => { s.__slot = i },
      getPane: () => ({ paneIndex: () => H.paneIndexOf(s), getHeight: () => H.heightOf(H.paneIndexOf(s)) }),
      dataByIndex: () => null,
    }
    return s
  }
  const timeScale = new Proxy({
    width: () => 600, height: () => 40, barSpacing: () => 6, options: () => ({}),
    getVisibleLogicalRange: () => null, getVisibleRange: () => null, scrollPosition: () => 0,
    coordinateToTime: () => null, timeToCoordinate: () => 0, logicalToCoordinate: () => 0, coordinateToLogical: () => 0,
  }, { get: (t, p) => (p in t ? t[p] : (typeof p === 'symbol' || p === 'then') ? undefined : () => undefined) })
  const add = (ctor, options, slot) => { const s = makeSeries(ctor, options, slot); H.live.push(s); return s }
  const chart = {
    addSeries: add,
    addCustomSeries: (_impl, options, slot) => add('custom', options, slot),
    removeSeries: (s) => { const i = H.live.indexOf(s); if (i >= 0) H.live.splice(i, 1) },
    applyOptions: () => {},
    priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: (fn) => { H.crosshairHandlers.push(fn) },
    unsubscribeCrosshairMove: (fn) => { const i = H.crosshairHandlers.indexOf(fn); if (i >= 0) H.crosshairHandlers.splice(i, 1) },
    subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => H.occupied().map((_, i) => ({
      paneIndex: () => i, getHeight: () => H.heightOf(i),
      getHTMLElement: () => document.createElement('div'), setHeight: () => {}, moveTo: () => {},
    })),
    swapPanes: () => {},
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

HTMLCanvasElement.prototype.getContext = function getContext() {
  const ctx = { canvas: null, measureText: () => ({ width: 0 }), createLinearGradient: () => ({ addColorStop: () => {} }), getImageData: () => ({ data: [] }) }
  for (const m of ['clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'stroke', 'fill',
    'save', 'restore', 'setLineDash', 'translate', 'scale', 'rotate', 'setTransform', 'quadraticCurveTo', 'bezierCurveTo',
    'ellipse', 'rect', 'clip', 'drawImage', 'putImageData']) ctx[m] = () => {}
  return ctx
}

beforeEach(() => {
  cleanup()
  H.reset()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})

const { default: StockChart } = await import('../../../StockChart')
const registry = await import('../nativeRegistry')
const { mergeChartSettings } = await import('../../chartDefaults')
const { addInstance, setInstanceInput } = await import('../instanceControls')
const { SEPARATOR_PX } = await import('../paneLayout')

// 60 bars: an RSI(100) cannot produce a single value on them, an RSI(14) can.
const BARS = bars200.bars.slice(0, 60)
const RSI_COLOR = '#12ab34'

/** Mint an instance through the product's own writers and return its id. */
function mint(cs, defId, inputs) {
  const before = new Set((cs.indicatorInstances || []).map((i) => i.instanceId))
  let next = addInstance(cs, defId, registry)
  const id = next.indicatorInstances.find((i) => !before.has(i.instanceId)).instanceId
  for (const [k, v] of Object.entries(inputs || {})) {
    const written = setInstanceInput(next, id, k, v, registry)
    // A refused write returns the SAME object — fail here, not in a vacuous case.
    expect(written, `setInstanceInput refused ${defId}.${k}=${v}`).not.toBe(next)
    next = written
  }
  return [next, id]
}

async function drawAndHover(cs) {
  const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={legendAlways(cs)} />)
  // Readouts render off the crosshair; deliver one event until the DOM settles.
  let last = ''
  for (let i = 0; i < 60; i++) {
    await act(async () => {
      const candle = H.live.find((s) => s.__ctor === 'CandlestickSeries')
      const param = { time: BARS.at(-1).t, point: { x: 100, y: 100 }, logical: BARS.length - 1,
        seriesData: new Map(candle ? [[candle, { open: 1, high: 2, low: 0.5, close: 1.5 }]] : []) }
      for (const fn of [...H.crosshairHandlers]) fn(param)
      await new Promise((r) => setTimeout(r, 20))
    })
    const now = [...view.container.querySelectorAll('[data-pane-legend]')]
      .map((e) => `${e.dataset.paneLegend}@${e.style.top}/${e.style.display}`).join('|')
    if (now && now === last) break
    last = now
  }
  return view
}

/** The `top` a readout gets when it sits in physical pane `k`. */
const topOf = (k) => {
  let top = 0
  for (let i = 0; i < k; i++) top += H.heightOf(i) + SEPARATOR_PX
  return `${Math.round(top + 3)}px`
}
const readout = (view, key) => view.container.querySelector(`[data-pane-legend="${key}"]`)
const visible = (el) => el && el.style.display !== 'none'
const seriesColored = (color) => H.live.find((s) => s.__options.color === color)

describe('a pane readout is pinned where its series DREW, not where the layout slotted it', () => {
  it('⛔⛔ an EMPTY own-pane host above a drawn one steals no caption, and the one below keeps its own', async () => {
    let cs = mergeChartSettings(null)
    let empty, drawn
    ;[cs, empty] = mint(cs, 'rsi', { period: 100 })               // 60 bars: computes nothing
    ;[cs, drawn] = mint(cs, 'rsi', { period: 14, color: RSI_COLOR })
    const view = await drawAndHover(cs)

    const s = seriesColored(RSI_COLOR)
    expect(s, 'the drawn RSI was never created — the case is vacuous').toBeTruthy()
    const drawnPane = H.paneIndexOf(s)
    // The regime under test: the slot the layout asked for is NOT the pane that exists.
    expect(s.__slot, 'slot == pane, so this case cannot tell the two apart').not.toBe(drawnPane)

    const own = readout(view, drawn)
    expect(visible(own), 'the drawn RSI lost its readout').toBe(true)
    expect(own.style.top, 'the drawn RSI readout is not on the pane its line is in').toBe(topOf(drawnPane))

    const ghost = readout(view, empty)
    expect(!ghost || !visible(ghost), 'the EMPTY host printed a readout — it has no pane to caption').toBe(true)
    // No two visible readouts share a rectangle.
    const tops = [...view.container.querySelectorAll('[data-pane-legend]')].filter(visible).map((e) => e.style.top)
    expect(new Set(tops).size).toBe(tops.length)
  })

  it('⭐ with nothing empty, every readout still sits on its own series\' pane (ordinary indicators unchanged)', async () => {
    let cs = mergeChartSettings(null)
    let rsi, macd
    ;[cs, rsi] = mint(cs, 'rsi', { period: 14, color: RSI_COLOR })
    ;[cs, macd] = mint(cs, 'macd', {})
    const view = await drawAndHover(cs)
    const s = seriesColored(RSI_COLOR)
    expect(readout(view, rsi).style.top).toBe(topOf(H.paneIndexOf(s)))
    // MACD is multi-output: ONE readout for the instance, carrying both chip rows.
    const m = readout(view, macd)
    expect(visible(m)).toBe(true)
    expect(m.textContent).toMatch(/MACD/)
    expect(m.textContent).toMatch(/SIG/)
    expect(m.style.top).not.toBe(readout(view, rsi).style.top)
  })

  it('Price and Volume own no pane readout; the empty host never appears in the price stack either', async () => {
    let cs = mergeChartSettings(null)
    let empty
    ;[cs, empty] = mint(cs, 'rsi', { period: 100 })
    const view = await drawAndHover(cs)
    const keys = [...view.container.querySelectorAll('[data-pane-legend]')].filter(visible).map((e) => e.dataset.paneLegend)
    expect(keys).not.toContain(empty)
    expect(keys.some((k) => /price|candle/i.test(k)), 'price grew a pane readout').toBe(false)
  })
})
