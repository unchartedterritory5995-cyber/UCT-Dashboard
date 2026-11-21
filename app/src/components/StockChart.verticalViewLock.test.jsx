// app/src/components/StockChart.verticalViewLock.test.jsx
//
// ─── HORIZONTAL NAVIGATION MUST NOT COMPOUND THE VERTICAL SCALE ─────────────
//
// ⚰️⚰️ THE BUG, AS THE MEMBER SAW IT. Reset view, drag the RIGHT PRICE SCALE to
// give the candles more (or less) vertical room, then pan. The chart pinches.
// Pan again — smaller again. Zoom — smaller again. Reset view puts it right, and
// until the next axis drag nothing goes wrong at all.
//
// ⛔ AND IT IS A FEEDBACK LOOP, NOT A ONE-OFF MISDRAW. `_measureViewLock` infers
// the candle band from the VISIBLE BARS' extremes — a reading that describes the
// price scale only while the scale is AUTOSCALED to those same bars. There it is
// a FIXED POINT: the bars fill the margin-inset plot area exactly, so
// measure → store → apply returns the identical margins for ever, which is why a
// never-dragged chart pans all day without moving vertically.
//
// A price-axis drag breaks the identity. From then on the candle series'
// `autoscaleInfoProvider` returns a FIXED range, the visible bars occupy a
// SUB-BAND of the plot area, and `_captureUserLock` — which every pan and every
// wheel called — measured that sub-band and stored it as the new scale margins.
// lightweight-charts insets the SAME pinned range inside the SMALLER region, the
// bars shrink, and the next pan measures the shrunken band.
//
// ⭐ SO THIS HARNESS MODELS THE PRICE SCALE, which is the whole reason it is a
// new file rather than a describe() in an existing one. Every other
// lightweight-charts double in this repo answers `priceToCoordinate: () => 0` —
// with that mock the loop is INVISIBLE, because the number that compounds is
// precisely the one stubbed to a constant. Here `scaleMargins`, the autoscale
// provider and the pixel mapping are real arithmetic over a real pane height, so
// applying a margin set MOVES the candles and re-measuring them reads the move.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'

// ── The renderer double, with a PRICE SCALE that has arithmetic in it ────────
const rig = vi.hoisted(() => {
  const state = {
    paneHeights: [400],      // the pane stack, in px
    pricePaneIndex: 0,       // …and which of them the CANDLES live in
    margins: { top: 0.1, bottom: 0.1 },  // whatever the component last applied
    provider: null,          // the candle series' autoscaleInfoProvider
    userRange: null,         // what an axis drag left the scale at
    autoRange: { min: 100, max: 120 },   // autoscale over the visible bars
    marginWrites: 0,
    lastRange: { from: 0, to: 200 },
    axisWidth: 76,
    container: { left: 0, top: 0, width: 900, height: 560 },
    // ⭐ A LINE ON THE CANDLES' OWN SCALE (an overlay=true script's plot — Fred RS's
    // RS line parks under the bars). `joins`: whether it takes part in the autoscale,
    // as an overlay script's plot does on /charts (`placement.joinPriceScale`), or is
    // excluded (`autoscaleInfoProvider: () => null`) as on a fitPriceToCandles surface.
    overlay: null,           // { min, max, joins }
  }
  const priceH = () => state.paneHeights[state.pricePaneIndex]
  // Autoscale over the visible bars AND every series that joins it — what the
  // library fits into the margin-inset plot area when nothing pins the scale.
  const autoFit = () => {
    const o = state.overlay
    if (!o || !o.joins) return state.autoRange
    return { min: Math.min(state.autoRange.min, o.min), max: Math.max(state.autoRange.max, o.max) }
  }
  // The range lightweight-charts would actually use this frame: the provider's
  // answer when it gives one, else whatever an axis drag left behind, else
  // autoscale over the visible bars.
  const effective = () => {
    const base = state.userRange || autoFit()
    const orig = () => ({ priceRange: { minValue: base.min, maxValue: base.max } })
    let r = null
    try { r = state.provider ? state.provider(orig) : orig() } catch { r = null }
    const pr = (r && r.priceRange) ? r.priceRange : orig().priceRange
    return { min: pr.minValue, max: pr.maxValue }
  }
  const plot = () => {
    const H = priceH()
    return { top: state.margins.top * H, h: H * (1 - state.margins.top - state.margins.bottom) }
  }
  return {
    state,
    priceH,
    effective,
    // The two mappings under test, exactly as lightweight-charts composes them:
    // the effective price range fills the MARGIN-INSET plot area of the CANDLE pane.
    priceToCoordinate: (p) => {
      const R = effective(); const { top, h } = plot()
      return top + ((R.max - p) / (R.max - R.min)) * h
    },
    coordinateToPrice: (y) => {
      const R = effective(); const { top, h } = plot()
      return R.max - ((y - top) / h) * (R.max - R.min)
    },
    reset(paneHeights = [400], pricePaneIndex = 0) {
      state.paneHeights = paneHeights
      state.pricePaneIndex = pricePaneIndex
      state.margins = { top: 0.1, bottom: 0.1 }
      state.provider = null
      state.userRange = null
      state.autoRange = { min: 100, max: 120 }
      state.marginWrites = 0
      state.lastRange = { from: 0, to: 200 }
      state.overlay = null
    },
  }
})

vi.mock('lightweight-charts', () => {
  const S = rig.state
  const rightScale = {
    applyOptions: (o) => {
      if (o && o.scaleMargins
        && Number.isFinite(o.scaleMargins.top) && Number.isFinite(o.scaleMargins.bottom)) {
        const next = { top: o.scaleMargins.top, bottom: o.scaleMargins.bottom }
        if (next.top !== S.margins.top || next.bottom !== S.margins.bottom) S.marginWrites += 1
        S.margins = next
      }
      // `autoScale: true` releases whatever an axis drag left on the scale.
      if (o && o.autoScale === true) S.userRange = null
    },
    options: () => ({ scaleMargins: { ...S.margins } }),
    width: () => S.axisWidth,
    setVisibleRange: () => {}, getVisibleRange: () => null, setAutoScale: () => {},
  }
  const anyScale = {
    applyOptions: () => {}, options: () => ({}), width: () => 0,
    setVisibleRange: () => {}, getVisibleRange: () => null, setAutoScale: () => {},
  }
  let candle = null
  // The overlay line, as the library answers for it: on the candles' scale, its
  // value at each logical index alternating between its min and max (so every
  // visible window holds both), and an autoscale provider that EXCLUDES it when
  // it does not join.
  const overlaySeries = {
    options: () => ({
      priceScaleId: 'right', visible: true,
      ...(S.overlay && !S.overlay.joins ? { autoscaleInfoProvider: () => null } : {}),
    }),
    dataByIndex: (i) => (S.overlay && i >= 0 && i < 200 && Number.isInteger(i)
      ? { time: i, value: (i % 2 ? S.overlay.min : S.overlay.max) } : null),
    seriesType: () => 'Line',
  }
  const panesCache = []
  const panes = () => {
    panesCache.length = 0
    S.paneHeights.forEach((h, i) => panesCache.push({
      getHeight: () => S.paneHeights[i],
      paneIndex: () => i,
      getStretchFactor: () => S.paneHeights[i],
      setStretchFactor: () => {},
      getHTMLElement: () => document.createElement('div'),
      getSeries: () => (i === S.pricePaneIndex && candle ? (S.overlay ? [candle, overlaySeries] : [candle]) : []),
      priceScale: () => anyScale,
      moveTo: () => {},
    }))
    return panesCache
  }
  const mkSeries = (isCandle) => ({
    setData: () => {}, update: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {},
    createPriceLine: () => ({ applyOptions: () => {} }), removePriceLine: () => {},
    dataByIndex: () => null, barsInLogicalRange: () => null, data: () => [],
    seriesType: () => (isCandle ? 'Candlestick' : 'Line'),
    options: () => ({}),
    applyOptions: (o) => {
      if (isCandle && o && typeof o.autoscaleInfoProvider === 'function') S.provider = o.autoscaleInfoProvider
    },
    priceScale: () => (isCandle ? rightScale : anyScale),
    priceToCoordinate: (p) => (isCandle ? rig.priceToCoordinate(p) : 0),
    coordinateToPrice: (y) => (isCandle ? rig.coordinateToPrice(y) : 0),
    getPane: () => panes()[isCandle ? S.pricePaneIndex : Math.min(1, S.paneHeights.length - 1)],
    moveToPane: () => {},
  })
  candle = mkSeries(true)
  const timeScale = {
    applyOptions: () => {}, fitContent: () => {},
    setVisibleLogicalRange: (r) => { S.lastRange = r },
    getVisibleLogicalRange: () => S.lastRange,
    setVisibleRange: () => {}, scrollToPosition: () => {},
    subscribeVisibleLogicalRangeChange: () => {}, unsubscribeVisibleLogicalRangeChange: () => {},
    subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    timeToCoordinate: () => 0, coordinateToTime: () => null, resetTimeScale: () => {},
    options: () => ({}), width: () => S.container.width - S.axisWidth,
    getVisibleRange: () => null, coordinateToLogical: () => 0, logicalToCoordinate: () => 0,
    timeToIndex: () => 0, height: () => 40, scrollPosition: () => 0,
  }
  const chart = {
    addSeries: (type) => ((type && type.__nonCandle) ? mkSeries(false) : candle),
    addCandlestickSeries: () => candle, addHistogramSeries: () => mkSeries(false),
    addLineSeries: () => mkSeries(false), addAreaSeries: () => mkSeries(false),
    addBarSeries: () => candle, removeSeries: () => {},
    applyOptions: (o) => { if (o && o.rightPriceScale) rightScale.applyOptions(o.rightPriceScale) },
    priceScale: (id) => (id === 'right' ? rightScale : anyScale),
    timeScale: () => timeScale,
    panes, addPane: () => panes()[0], removePane: () => {}, swapPanes: () => {},
    paneSize: () => ({ height: S.paneHeights[0], width: 800 }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    subscribeClick: () => {}, unsubscribeClick: () => {},
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    CandlestickSeries: {}, BarSeries: {},
    HistogramSeries: { __nonCandle: true }, LineSeries: { __nonCandle: true },
    AreaSeries: { __nonCandle: true }, BaselineSeries: { __nonCandle: true },
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
vi.mock('../utils/barsIDB', () => ({
  idbGet: async () => null, idbPut: async () => {}, mergeDelta: (_a, b) => b,
}))

import StockChart from './StockChart'

// 200 daily bars in a NARROW price band, so "the candles" is an unambiguous
// rectangle: every visible window has extremes 100 / 120.
const BARS = Array.from({ length: 200 }, (_, i) => ({
  t: new Date(Date.UTC(2026, 1, 20) - (199 - i) * 86400000).toISOString().slice(0, 10),
  o: 105 + (i % 5), h: 120, l: 100, c: 110 + (i % 3), v: 1000 + i,
}))
const LOCK_KEY = 'test.vlock'

/** What the member actually sees: the candles' share of the PRICE pane. */
const occupancy = () => (rig.priceToCoordinate(100) - rig.priceToCoordinate(120)) / rig.priceH()
const margins = () => ({ ...rig.state.margins })
const storedLock = () => { try { return JSON.parse(localStorage.getItem(LOCK_KEY)) } catch { return null } }
const frames = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))

let menuRef = { resetView: null }

const view = (extra = {}) => (
  <StockChart
    sym="AAPL" tf="D" barsOverride={BARS.slice()}
    carryDragPlacement keepPresentOnSymbolChange viewLockKey={LOCK_KEY}
    volumeSeparatePane
    onBarContextMenu={(d) => { menuRef.resetView = d?.resetView || null }}
    {...extra}
  />
)

let host = null
const mount = async (extra = {}) => {
  const r = render(view(extra))
  await waitFor(() => expect(rig.state.provider).toBeTruthy(), { timeout: 5000 })
  host = r.container.querySelector('[class*="chart"]') || r.container.firstChild
  return r
}
/** A REPAINT — a live tick, a backfill, a re-render. This is where a stored lock
 *  becomes applied margins, and it is why the bug compounds rather than appearing
 *  once. */
const repaint = async (rerender, extra = {}) => { rerender(view(extra)); await frames() }

const AXIS_X = () => rig.state.container.width - 10   // inside the price axis
const PLOT_X = 300                                     // inside the plot

/** Drag the RIGHT PRICE SCALE. `k` > 1 stretches it (the candles get smaller). */
const dragPriceAxis = async (k) => {
  fireEvent.pointerDown(host, { clientX: AXIS_X(), clientY: 200, bubbles: true })
  fireEvent.pointerMove(window, { clientX: AXIS_X(), clientY: 260 })
  // …which is what lightweight-charts does while the pin is released.
  const R = rig.effective()
  const mid = (R.max + R.min) / 2, half = ((R.max - R.min) / 2) * k
  rig.state.userRange = { min: mid - half, max: mid + half }
  fireEvent.pointerUp(window, { clientX: AXIS_X(), clientY: 260 })
  await frames()
}
/** Pan the PLOT horizontally — a time gesture, nothing else. */
const pan = async (n) => {
  rig.state.lastRange = { from: -n * 3, to: 200 - n * 3 }
  fireEvent.pointerDown(host, { clientX: PLOT_X, clientY: 200, bubbles: true })
  fireEvent.pointerMove(window, { clientX: PLOT_X - 120, clientY: 200 })
  fireEvent.pointerUp(window, { clientX: PLOT_X - 120, clientY: 200 })
  await frames()
}
/** Wheel-zoom the TIME axis. */
const zoom = async (n) => {
  rig.state.lastRange = { from: 6 * n, to: 200 - 3 * n }
  fireEvent.wheel(host, { deltaY: -100, clientX: PLOT_X, clientY: 200 })
  await frames()
}

// jsdom lays nothing out, so the axis hit-region has to be given a rectangle —
// `inAxis` is `clientX - rect.left >= rect.width - axisWidth - 2`.
const realRect = Element.prototype.getBoundingClientRect
beforeEach(() => {
  localStorage.clear()
  rig.reset()
  menuRef = { resetView: null }
  Element.prototype.getBoundingClientRect = function rect() {
    const c = rig.state.container
    return { left: c.left, top: c.top, width: c.width, height: c.height,
      right: c.left + c.width, bottom: c.top + c.height, x: c.left, y: c.top, toJSON: () => {} }
  }
})
afterEach(() => { cleanup(); host = null; Element.prototype.getBoundingClientRect = realRect })

// ─────────────────────────────────────────────────────────────────────────────
describe('⭐ BASELINE — an untouched price scale is a FIXED POINT', () => {
  it('pan ×20 never moves the vertical geometry, and authors no vertical lock', async () => {
    const { rerender } = await mount()
    await repaint(rerender)
    const occ0 = occupancy(), m0 = margins()
    for (let i = 1; i <= 20; i++) { await pan(i); await repaint(rerender) }
    expect(occupancy()).toBeCloseTo(occ0, 6)
    expect(margins()).toEqual(m0)
    expect(storedLock()?.top ?? null).toBeNull()
  })

  it('wheel-zoom ×20 never moves the vertical geometry', async () => {
    const { rerender } = await mount()
    await repaint(rerender)
    const occ0 = occupancy(), m0 = margins()
    for (let i = 1; i <= 20; i++) { await zoom(i); await repaint(rerender) }
    expect(occupancy()).toBeCloseTo(occ0, 6)
    expect(margins()).toEqual(m0)
    expect(storedLock()?.top ?? null).toBeNull()
  })

  it('alternating pan/zoom ×20 is stable', async () => {
    const { rerender } = await mount()
    await repaint(rerender)
    const occ0 = occupancy()
    for (let i = 1; i <= 20; i++) { if (i % 2) await pan(i); else await zoom(i); await repaint(rerender) }
    expect(occupancy()).toBeCloseTo(occ0, 6)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('⛔⛔ THE ROOT CAUSE — a manual price scale must survive time navigation', () => {
  it('a STRETCH then pan ×20 does not pinch the candles', async () => {
    const { rerender } = await mount()
    await repaint(rerender)
    await dragPriceAxis(3)                 // the member gives the candles more air
    // ⭐ READ IT BEFORE THE FIRST REPAINT. A stretch of ×3 over a 70% band leaves
    // the candles 23.3% of the pane; pre-fix the very next repaint re-applied the
    // freshly-stored band as MARGINS and made it 7.8% before a single pan — the
    // one-shot half of the defect. Measuring after a repaint would have compared
    // a corrupted number to itself.
    const afterDrag = occupancy()
    expect(afterDrag).toBeCloseTo(0.70 / 3, 4)
    await repaint(rerender)
    expect(occupancy(), 'a repaint alone moved the vertical scale').toBeCloseTo(afterDrag, 6)
    const trace = [afterDrag]
    for (let i = 1; i <= 20; i++) { await pan(i); await repaint(rerender); trace.push(occupancy()) }
    // ⛔ THE INVARIANT. Before the fix this ran 0.24 → 0.08 → 0.03 → … down to the
    // 0.95 combined-margin clamp; every entry must now equal the first.
    for (const o of trace) expect(o).toBeCloseTo(afterDrag, 6)
  })

  it('a COMPRESS then pan ×20 does not blow the scale open', async () => {
    const { rerender } = await mount()
    await repaint(rerender)
    await dragPriceAxis(0.4)
    const afterDrag = occupancy()
    expect(afterDrag).toBeCloseTo(0.70 / 0.4, 4)
    await repaint(rerender)
    expect(occupancy(), 'a repaint alone moved the vertical scale').toBeCloseTo(afterDrag, 6)
    for (let i = 1; i <= 20; i++) { await pan(i); await repaint(rerender) }
    expect(occupancy()).toBeCloseTo(afterDrag, 6)
  })

  it('a STRETCH then wheel-zoom ×20 does not pinch the candles', async () => {
    const { rerender } = await mount()
    await repaint(rerender)
    await dragPriceAxis(3)
    const afterDrag = occupancy()
    await repaint(rerender)
    expect(occupancy()).toBeCloseTo(afterDrag, 6)
    for (let i = 1; i <= 20; i++) { await zoom(i); await repaint(rerender) }
    expect(occupancy()).toBeCloseTo(afterDrag, 6)
  })

  it('a COMPRESS then wheel-zoom ×20 is stable', async () => {
    const { rerender } = await mount()
    await repaint(rerender)
    await dragPriceAxis(0.5)
    const afterDrag = occupancy()
    await repaint(rerender)
    expect(occupancy()).toBeCloseTo(afterDrag, 6)
    for (let i = 1; i <= 20; i++) { await zoom(i); await repaint(rerender) }
    expect(occupancy()).toBeCloseTo(afterDrag, 6)
  })

  it('alternating pan/zoom ×20 after a drag never compounds', async () => {
    const { rerender } = await mount()
    await repaint(rerender)
    await dragPriceAxis(2.5)
    const afterDrag = occupancy()
    await repaint(rerender)
    expect(occupancy()).toBeCloseTo(afterDrag, 6)
    for (let i = 1; i <= 20; i++) { if (i % 2) await pan(i); else await zoom(i); await repaint(rerender) }
    expect(occupancy()).toBeCloseTo(afterDrag, 6)
  })

  it('⭐ the manual gesture authors the vertical lock EXACTLY ONCE', async () => {
    const { rerender } = await mount()
    await repaint(rerender)
    await dragPriceAxis(3)
    await repaint(rerender)
    const v0 = storedLock()
    expect(v0?.top, 'the axis drag did not author a vertical lock at all').toBeTypeOf('number')
    for (let i = 1; i <= 20; i++) { await pan(i); await repaint(rerender) }
    const v1 = storedLock()
    // The band the member set carries to the next ticker byte-for-byte…
    expect(v1.top).toBe(v0.top)
    expect(v1.bottom).toBe(v0.bottom)
    // …while the HORIZONTAL half is still free to follow the member's panning.
    expect(v1.anchorFrac).toBeTypeOf('number')
  })

  it('⛔ time navigation after a drag writes NO new scale margins', async () => {
    const { rerender } = await mount()
    await repaint(rerender)
    await dragPriceAxis(3)
    await repaint(rerender)
    const writes0 = rig.state.marginWrites
    const m0 = margins()
    for (let i = 1; i <= 10; i++) { await pan(i); await repaint(rerender) }
    for (let i = 1; i <= 10; i++) { await zoom(i); await repaint(rerender) }
    expect(margins()).toEqual(m0)
    // A repaint may re-assert the SAME numbers; it may never CHANGE them, and
    // marginWrites only counts changes.
    expect(rig.state.marginWrites).toBe(writes0)
  })

  it('⛔ a WHEEL cannot inherit an axis gesture that never captured', async () => {
    // ⚰️ THE LATCH ORDERING HOLE. `_captureUserLock` returns early on a surface
    // that carries no placement and in replay — so a latch spent inside the guard
    // would stay armed and be claimed by whatever came next. A pointerdown clears
    // it; a wheel has none. Here the axis drag lands while the lock capture is
    // refused (no `carryDragPlacement`), and the wheel that follows on a normal
    // chart must still author nothing vertical.
    const { rerender } = await mount({ carryDragPlacement: false })
    await repaint(rerender, { carryDragPlacement: false })
    await dragPriceAxis(3)
    await repaint(rerender, { carryDragPlacement: false })
    expect(storedLock(), 'the refused surface stored a lock').toBeNull()
    // …now the same component starts carrying the placement, and the member scrolls.
    await repaint(rerender)
    for (let i = 1; i <= 5; i++) { await zoom(i); await repaint(rerender) }
    expect(storedLock()?.top ?? null).toBeNull()
  })

  it('⛔ a plain focus-click after a drag changes nothing', async () => {
    const { rerender } = await mount()
    await repaint(rerender)
    await dragPriceAxis(3)
    await repaint(rerender)
    const occ = occupancy(), v0 = storedLock()
    fireEvent.pointerDown(host, { clientX: PLOT_X, clientY: 200, bubbles: true })
    fireEvent.pointerUp(window, { clientX: PLOT_X, clientY: 200 })
    await frames()
    await repaint(rerender)
    expect(occupancy()).toBeCloseTo(occ, 6)
    expect(storedLock()).toEqual(v0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('⛔ PRICE IS SEMANTIC, NOT PHYSICAL — every topology', () => {
  const TOPOLOGIES = [
    { name: 'PRICE alone',           heights: [400],          price: 0 },
    { name: 'PRICE · VOLUME',        heights: [320, 80],      price: 0 },
    { name: 'PRICE · RSI · VOLUME',  heights: [260, 70, 70],  price: 0 },
    { name: 'QQQ · PRICE · VOLUME',  heights: [90, 250, 60],  price: 1 },
    { name: 'RSI · PRICE · VOLUME',  heights: [70, 270, 60],  price: 1 },
    { name: 'RSI · MACD · PRICE',    heights: [70, 70, 260],  price: 2 },
  ]
  for (const t of TOPOLOGIES) {
    it(`${t.name}: stretch + pan ×20 holds`, async () => {
      rig.reset(t.heights, t.price)
      const { rerender } = await mount()
      await repaint(rerender)
      await dragPriceAxis(3)
      const afterDrag = occupancy()
      expect(afterDrag, 'the drag itself already crushed the candles').toBeGreaterThan(0.05)
      await repaint(rerender)
      expect(occupancy(), 'a repaint alone moved the vertical scale').toBeCloseTo(afterDrag, 6)
      for (let i = 1; i <= 20; i++) { await pan(i); await repaint(rerender) }
      expect(occupancy()).toBeCloseTo(afterDrag, 6)
    })
  }

  it('volume BANDED into the price pane (no separate pane) holds too', async () => {
    rig.reset()
    const { rerender } = await mount({ volumeSeparatePane: false })
    await repaint(rerender, { volumeSeparatePane: false })
    await dragPriceAxis(3)
    const afterDrag = occupancy()
    await repaint(rerender, { volumeSeparatePane: false })
    expect(occupancy()).toBeCloseTo(afterDrag, 6)
    for (let i = 1; i <= 20; i++) { await pan(i); await repaint(rerender, { volumeSeparatePane: false }) }
    expect(occupancy()).toBeCloseTo(afterDrag, 6)
  })

  it('a PANE RESIZE between the drag and the panning does not compound', async () => {
    rig.reset([320, 80], 0)
    const { rerender } = await mount()
    await repaint(rerender)
    await dragPriceAxis(2.5)
    await repaint(rerender)
    const mAfterDrag = margins()
    rig.state.paneHeights = [240, 160]          // the member drags the separator
    await repaint(rerender)
    for (let i = 1; i <= 20; i++) { await pan(i); await repaint(rerender) }
    // The band is a FRACTION of whatever the price pane is now — it must not walk.
    expect(margins()).toEqual(mAfterDrag)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ⛔⛔ A LINE THAT JOINS THE AUTOSCALE BREAKS THE FIXED POINT TOO.
//
// ⚰️ MEASURED ON PRODUCTION (2026-11-21, smoke@ on the rig, the owner's report "it
// does not scale the same as the tradingview indicator ... as i move my chart or move
// the placement of where the candles are"). The same gestures twice — compress the
// price axis on PEB, switch to KSS, expand, switch to PEB, compress, switch to KSS:
// without Fred RS the candles landed on every switch exactly where they were left
// (rows 24.1–77.2% → 24.1–76.6%); with Fred RS they filled 37.3% → 23.8% → 13.5% →
// 6.5% of the pane, and KSS (~$15–30) ended on a −123 … 73 scale.
//
// ⛔ THE CAUSE. `_measureViewLock` measured the CANDLES' band and stored it as the
// scale margins; the autoscale then fits the candles AND every series that joins it
// (an overlay=true script's plots since the 11-16 price-scale join, the averages on
// /charts) into those margins. With the RS line parked under the bars the stored band
// is short by the line's share — every capture loses it again.
describe('⛔⛔ A LINE THAT JOINS THE AUTOSCALE — the stored band is everything the autoscale fits', () => {
  const switchTo = async (rerender, sym) => { rerender(view({ sym })); await frames(); await frames() }

  it('RS line under the candles: compress, switch ticker — the candles land where the member left them', async () => {
    rig.reset(); rig.state.overlay = { min: 60, max: 70, joins: true }
    const { rerender } = await mount()
    await repaint(rerender)
    await dragPriceAxis(1.6)
    const afterDrag = occupancy()
    await switchTo(rerender, 'MSFT')
    expect(occupancy(), 'the switch re-applied a band the autoscale then over-filled').toBeCloseTo(afterDrag, 4)
  })

  it('three drag → switch rounds never compound', async () => {
    rig.reset(); rig.state.overlay = { min: 60, max: 70, joins: true }
    const { rerender } = await mount()
    await repaint(rerender)
    const rounds = [[1.6, 'MSFT'], [0.8, 'AAPL'], [1.3, 'MSFT']]
    for (const [k, sym] of rounds) {
      await dragPriceAxis(k)
      const before = occupancy()
      await switchTo(rerender, sym)
      expect(occupancy(), `drag ×${k} then ${sym}`).toBeCloseTo(before, 4)
    }
  })

  it('a line ABOVE the candles (an upper band) is counted the same way', async () => {
    rig.reset(); rig.state.overlay = { min: 125, max: 140, joins: true }
    const { rerender } = await mount()
    await repaint(rerender)
    await dragPriceAxis(1.5)
    const afterDrag = occupancy()
    await switchTo(rerender, 'MSFT')
    expect(occupancy()).toBeCloseTo(afterDrag, 4)
  })

  it('CONTROL — no overlay: the switch is a fixed point', async () => {
    rig.reset()
    const { rerender } = await mount()
    await repaint(rerender)
    await dragPriceAxis(1.6)
    const afterDrag = occupancy()
    await switchTo(rerender, 'MSFT')
    expect(occupancy()).toBeCloseTo(afterDrag, 4)
  })

  it('⛔ a line EXCLUDED from the autoscale is not counted (the band stays the candles\')', async () => {
    rig.reset(); rig.state.overlay = { min: 60, max: 70, joins: false }
    const { rerender } = await mount()
    await repaint(rerender)
    await dragPriceAxis(1.6)
    const afterDrag = occupancy()
    await switchTo(rerender, 'MSFT')
    expect(occupancy(), 'an excluded line was counted into the band').toBeCloseTo(afterDrag, 4)
  })

  it('⭐ an untouched chart with a joined line still authors no vertical lock on pan/zoom', async () => {
    rig.reset(); rig.state.overlay = { min: 60, max: 70, joins: true }
    const { rerender } = await mount()
    await repaint(rerender)
    const occ0 = occupancy()
    for (let i = 1; i <= 6; i++) { if (i % 2) await pan(i); else await zoom(i); await repaint(rerender) }
    expect(occupancy()).toBeCloseTo(occ0, 6)
    expect(storedLock()?.top ?? null).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('⭐ RESET VIEW is canonical', () => {
  it('a reset after a drag + panning restores the default band and clears the lock', async () => {
    const { rerender } = await mount()
    await repaint(rerender)
    const m0 = margins()
    await dragPriceAxis(3)
    await repaint(rerender)
    for (let i = 1; i <= 5; i++) { await pan(i); await repaint(rerender) }
    expect(storedLock()?.top).toBeTypeOf('number')

    fireEvent.contextMenu(host, { clientX: PLOT_X, clientY: 200, bubbles: true })
    expect(menuRef.resetView, 'the context menu never published resetView').toBeTypeOf('function')
    menuRef.resetView()
    await repaint(rerender)

    expect(margins()).toEqual(m0)
    expect(localStorage.getItem(LOCK_KEY)).toBeNull()
    // …and a further pan ×10 stays canonical.
    const occ = occupancy()
    for (let i = 1; i <= 10; i++) { await pan(i); await repaint(rerender) }
    expect(occupancy()).toBeCloseTo(occ, 6)
  })
})
