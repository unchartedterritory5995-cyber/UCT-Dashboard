// @vitest-environment jsdom
/* Touch routing — a finger on a drawing adjusts the DRAWING, never the chart.
 *
 * ⚰️ THE DEFECT. lightweight-charts starts a pan from a native `touchstart` on
 * its own canvas; it never listens to pointer events. The overlay's touch
 * router claimed a drawing touch by stopping `pointerdown` in the capture
 * phase — a correct stop of the wrong event. `pointerdown` and `touchstart` are
 * two dispatches for one finger, so the chart still received its `touchstart`,
 * bound its move/end handlers, and panned the view under the very drag that
 * was moving the drawing. On a phone, adjusting a trendline moved the chart
 * with it. That is the report this file exists for.
 *
 * ⭐ THESE ARE BEHAVIOURAL, driven through the real component. The canvas maps
 * no pixels under jsdom, but a hit test needs no pixels — only a coordinate
 * mapping, and the fake chart below supplies a deterministic one (price →
 * `400 - p*10`, bar index → `100 + i*100`). What jsdom cannot do (paint,
 * kinetic scroll, a real pinch) stays the device pass's job.
 *
 * The chart is a STAND-IN element inside the same wrapper the overlay lives in,
 * carrying bubble-phase listeners exactly where lightweight-charts binds its
 * own. "The chart saw the touch" is therefore a spy call, not an inference.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, screen } from '@testing-library/react'
import { createRef } from 'react'
import ChartDrawingOverlay from './ChartDrawingOverlay'
import {
  __resetCoarsePointerForTest, HANDLE_GRAB_COARSE, HIT_COARSE, SLOP_COARSE, SELECTED_BODY_BOOST_COARSE,
} from './coarsePointer'

// ── a coarse primary pointer, the way coarsePointer.test installs one ───────
function installMatchMedia({ coarse }) {
  window.matchMedia = vi.fn((q) => ({
    media: q,
    matches: q.includes('pointer: coarse') ? coarse : false,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }))
}

// ── a chart/series pair with a DETERMINISTIC mapping ────────────────────────
const bars = [
  { t: '2026-01-02', o: 10, h: 12, l: 9, c: 11, v: 100 },
  { t: '2026-01-05', o: 11, h: 14, l: 10, c: 13, v: 120 },
  { t: '2026-01-06', o: 13, h: 15, l: 12, c: 14, v: 90 },
]
const X_OF_IDX = (i) => 100 + i * 100
const Y_OF_PRICE = (p) => 400 - p * 10
const PRICE_OF_Y = (y) => (400 - y) / 10
const SCROLL = { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true }
const SCALE = {
  axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true },
  mouseWheel: true, pinch: true,
}
const ALL_OFF = (o) => Object.values(o).every(v => (typeof v === 'object' ? ALL_OFF(v) : v === false))

/** lightweight-charts' own semantics, which the shipped defect depended on:
 *  `options()` hands back the LIVE internal object, and `applyOptions` expands a
 *  boolean `handleScroll`/`handleScale` into the object form and then merges it
 *  INTO that live object in place (`merge(dst, src)` in the library). A fake that
 *  returned fresh objects let a restore-from-a-mutated-reference pass green. */
function lwcMerge(dst, src) {
  for (const k of Object.keys(src)) {
    if (src[k] === undefined) continue
    if (typeof src[k] !== 'object' || src[k] === null || dst[k] === undefined) dst[k] = src[k]
    else lwcMerge(dst[k], src[k])
  }
}
function expandBooleans(o) {
  const n = { ...o }
  if (typeof n.handleScroll === 'boolean') {
    const b = n.handleScroll
    n.handleScroll = { mouseWheel: b, pressedMouseMove: b, horzTouchDrag: b, vertTouchDrag: b }
  }
  if (typeof n.handleScale === 'boolean') {
    const b = n.handleScale
    n.handleScale = { axisPressedMouseMove: { time: b, price: b }, axisDoubleClickReset: { time: b, price: b }, mouseWheel: b, pinch: b }
  }
  return n
}

function fakeChart() {
  const panes = [400, 100].map(h => ({ getHeight: () => h, getHTMLElement: () => null }))
  const timeScale = {
    height: () => 30,
    coordinateToLogical: (x) => (x - 100) / 100,
    logicalToCoordinate: (i) => X_OF_IDX(i),
    timeToCoordinate: (t) => { const i = bars.findIndex(b => b.t === t); return i < 0 ? null : X_OF_IDX(i) },
    getVisibleLogicalRange: () => ({ from: 0, to: 2 }),
    subscribeVisibleLogicalRangeChange: () => {},
    unsubscribeVisibleLogicalRangeChange: () => {},
  }
  const live = { layout: { background: { color: '#0f0f0f' } }, handleScroll: structuredClone(SCROLL), handleScale: structuredClone(SCALE) }
  const chart = {
    panes: () => panes,
    timeScale: () => timeScale,
    options: () => live,                                   // LIVE, as the library does
    applyOptions: vi.fn((o) => { lwcMerge(live, expandBooleans(o)) }),
    priceScale: () => ({ width: () => 56 }),
  }
  const series = {
    priceScale: () => ({ width: () => 56, options: () => ({ scaleMargins: { top: 0.1, bottom: 0.22 } }) }),
    priceToCoordinate: Y_OF_PRICE,
    coordinateToPrice: PRICE_OF_Y,
    getPane: () => panes[0],
  }
  return { chart, series }
}

const HLINE = { id: 'h1', type: 'horizontal', points: [{ price: 12 }], color: '#1ae51a' }
const TREND = {
  id: 't1', type: 'trendline', color: '#c9a84c',
  points: [{ time: '2026-01-02', price: 10 }, { time: '2026-01-06', price: 14 }],
}
// Where those land in the fake: the line at y=280; the trendline (100,300)→(300,260).
const ON_HLINE = { x: 200, y: Y_OF_PRICE(12) }
const EMPTY = { x: 200, y: 150 }

/** Mount the overlay beside a chart stand-in, under one wrapper — the DOM shape
 *  StockChart produces (the overlay canvas and the chart canvas are siblings). */
function mount({ drawings, selectedId = null, undo = null } = {}) {
  const { chart, series } = fakeChart()
  const chartRef = createRef(); chartRef.current = chart
  const seriesRef = createRef(); seriesRef.current = series
  const updateDrawing = vi.fn()
  const setSelectedId = vi.fn()
  const snapshotHistory = vi.fn()
  const utils = render(
    <div data-testid="wrap">
      <div data-testid="chart-canvas" />
      <ChartDrawingOverlay
        chartRef={chartRef} seriesRef={seriesRef} bars={bars}
        activeTool={null} setActiveTool={() => {}}
        color="#c9a84c" lineWidth={1}
        drawings={drawings} addDrawing={() => 'id'} updateDrawing={updateDrawing} removeDrawing={() => {}}
        selectedId={selectedId} setSelectedId={setSelectedId}
        snapshotHistory={snapshotHistory}
        undo={undo}
      />
    </div>,
  )
  const chartEl = utils.getByTestId('chart-canvas')
  // Bubble-phase listeners, where lightweight-charts binds its own.
  const chartSaw = { touchstart: vi.fn(), pointerdown: vi.fn(), touchmove: vi.fn() }
  for (const [type, fn] of Object.entries(chartSaw)) chartEl.addEventListener(type, fn)
  return { ...utils, chart, chartEl, updateDrawing, setSelectedId, snapshotHistory, chartSaw }
}

// ── the two event families a finger dispatches ──────────────────────────────
function pointer(el, type, { x, y, id = 1 }) {
  const ev = new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerType: 'touch', pointerId: id, isPrimary: id === 1,
    clientX: x, clientY: y, button: 0,
  })
  act(() => { el.dispatchEvent(ev) })
  return ev
}
function touch(el, type, { x, y, fingers = 1 }) {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  const list = Array.from({ length: fingers }, () => ({ clientX: x, clientY: y }))
  Object.defineProperty(ev, 'touches', { value: list })
  Object.defineProperty(ev, 'changedTouches', { value: list })
  act(() => { el.dispatchEvent(ev) })
  return ev
}
/** One finger going down, in the order every current engine dispatches it. */
function fingerDown(el, at) { pointer(el, 'pointerdown', at); return touch(el, 'touchstart', at) }
function fingerMove(el, at) { pointer(el, 'pointermove', at); return touch(el, 'touchmove', at) }
function fingerUp(el, at) { pointer(el, 'pointerup', at); return touch(el, 'touchend', { ...at, fingers: 0 }) }

const origRect = HTMLElement.prototype.getBoundingClientRect
const origMatchMedia = window.matchMedia
const origVibrate = navigator.vibrate

beforeEach(() => {
  __resetCoarsePointerForTest()
  installMatchMedia({ coarse: true })
  // jsdom lays nothing out; the overlay sizes its canvas from the wrapper's box
  // and rejects any hit outside the plot rect, so give it a real box.
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, right: 600, bottom: 500, width: 600, height: 500, x: 0, y: 0 }
  }
  Object.defineProperty(navigator, 'vibrate', { value: vi.fn(), configurable: true, writable: true })
})
afterEach(() => {
  cleanup()
  HTMLElement.prototype.getBoundingClientRect = origRect
  window.matchMedia = origMatchMedia
  Object.defineProperty(navigator, 'vibrate', { value: origVibrate, configurable: true, writable: true })
  __resetCoarsePointerForTest()
  vi.restoreAllMocks()
})

describe('⛔ a finger on a drawing never reaches the chart', () => {
  it('the chart sees neither the pointerdown NOR the touchstart of a drawing touch', () => {
    const rig = mount({ drawings: [HLINE] })
    fingerDown(rig.chartEl, ON_HLINE)
    expect(rig.chartSaw.pointerdown, 'pointerdown leaked to the chart').not.toHaveBeenCalled()
    expect(rig.chartSaw.touchstart, 'THE DEFECT: touchstart reached the chart, so it pans under the drag')
      .not.toHaveBeenCalled()
  })

  it('NON-VACUITY · a finger on EMPTY space reaches the chart on both families, and locks nothing', () => {
    const rig = mount({ drawings: [HLINE] })
    fingerDown(rig.chartEl, EMPTY)
    expect(rig.chartSaw.pointerdown).toHaveBeenCalledTimes(1)
    expect(rig.chartSaw.touchstart).toHaveBeenCalledTimes(1)
    const mv = fingerMove(rig.chartEl, { x: 200, y: 190 })
    expect(mv.defaultPrevented, 'an unclaimed touchmove must stay scrollable').toBe(false)
    expect(rig.chartSaw.touchmove).toHaveBeenCalledTimes(1)
    const up = fingerUp(rig.chartEl, { x: 200, y: 190 })
    expect(up.defaultPrevented, 'an unclaimed tap must still click the chart').toBe(false)
    expect(rig.chart.applyOptions).not.toHaveBeenCalled()
  })

  it('the chart is LOCKED for the drag and restored from its OWN options on release', () => {
    const rig = mount({ drawings: [HLINE] })
    fingerDown(rig.chartEl, ON_HLINE)
    expect(rig.chart.applyOptions).toHaveBeenCalledWith({ handleScroll: false, handleScale: false })
    expect(ALL_OFF(rig.chart.options().handleScroll), 'locked for the drag').toBe(true)
    expect(ALL_OFF(rig.chart.options().handleScale)).toBe(true)
    fingerMove(rig.chartEl, { x: 200, y: 320 })
    const up = fingerUp(rig.chartEl, { x: 200, y: 320 })
    // ⛔⛔ THE LIVE STATE, not the call arguments. The library mutates its
    // options object in place, so a restore built from a REFERENCE to the
    // pre-lock objects re-applied the lock. That shipped: one drag, then the
    // chart could never pan, pinch or price-scale again. Read what the chart
    // is actually left with.
    expect(rig.chart.options().handleScroll, 'the chart must pan again after the drag').toEqual(SCROLL)
    expect(rig.chart.options().handleScale, 'the chart must pinch and price-scale again').toEqual(SCALE)
    // …and the browser is told not to synthesise a click out of a touch the
    // overlay owned, so the chart's own click subscribers never see it.
    expect(up.defaultPrevented, 'a claimed touchend must suppress the compat click').toBe(true)
  })

  it('the drag moves the DRAWING: every touchmove is claimed and the points follow the finger', () => {
    const rig = mount({ drawings: [HLINE] })
    fingerDown(rig.chartEl, ON_HLINE)
    const mv = fingerMove(rig.chartEl, { x: 200, y: 320 })        // 40px down, past the slop
    expect(mv.defaultPrevented, 'the browser must not scroll under a claimed drag').toBe(true)
    expect(rig.chartSaw.touchmove, 'touchmove leaked to the chart').not.toHaveBeenCalled()
    expect(rig.updateDrawing).toHaveBeenCalled()
    const [, patch] = rig.updateDrawing.mock.calls.at(-1)
    expect(patch.points[0].price).toBeCloseTo(PRICE_OF_Y(320), 5)   // 12 → 8
    expect(rig.setSelectedId).toHaveBeenCalledWith('h1')
  })

  it('a touchstart that arrives BEFORE its pointerdown is claimed all the same (order-independent)', () => {
    const rig = mount({ drawings: [HLINE] })
    touch(rig.chartEl, 'touchstart', ON_HLINE)
    pointer(rig.chartEl, 'pointerdown', ON_HLINE)
    expect(rig.chartSaw.touchstart).not.toHaveBeenCalled()
    expect(rig.chartSaw.pointerdown).not.toHaveBeenCalled()
    const mv = fingerMove(rig.chartEl, { x: 200, y: 320 })
    expect(mv.defaultPrevented).toBe(true)
    expect(rig.updateDrawing).toHaveBeenCalled()
  })

  it('a SECOND finger hands the gesture back to the chart (pinch wins) and unlocks it', () => {
    const rig = mount({ drawings: [HLINE] })
    fingerDown(rig.chartEl, ON_HLINE)
    rig.chart.applyOptions.mockClear()
    pointer(rig.chartEl, 'pointerdown', { x: 300, y: 200, id: 2 })
    touch(rig.chartEl, 'touchstart', { x: 300, y: 200, fingers: 2 })
    expect(rig.chartSaw.pointerdown, 'the 2nd finger must reach the chart').toHaveBeenCalledTimes(1)
    expect(rig.chartSaw.touchstart, 'the pinch touchstart must reach the chart').toHaveBeenCalledTimes(1)
    expect(rig.chart.options().handleScale, 'pinch must be enabled again for the 2nd finger').toEqual(SCALE)
    expect(rig.chart.options().handleScroll).toEqual(SCROLL)
  })

  it('⚰️ REGRESSION · a SECOND drag still locks and restores — the first did not poison the snapshot', () => {
    const rig = mount({ drawings: [HLINE] })
    fingerDown(rig.chartEl, ON_HLINE); fingerMove(rig.chartEl, { x: 200, y: 320 }); fingerUp(rig.chartEl, { x: 200, y: 320 })
    expect(rig.chart.options().handleScroll).toEqual(SCROLL)
    // `updateDrawing` is a spy, so the line is still painted at y=280 — grab it there again.
    fingerDown(rig.chartEl, ON_HLINE)
    expect(ALL_OFF(rig.chart.options().handleScroll), 'second drag must lock too').toBe(true)
    fingerMove(rig.chartEl, { x: 200, y: 300 }); fingerUp(rig.chartEl, { x: 200, y: 300 })
    expect(rig.chart.options().handleScroll, 'and release again').toEqual(SCROLL)
    expect(rig.chart.options().handleScale).toEqual(SCALE)
  })

  it('a chart that was FROZEN before the drag comes back frozen, not unlocked', () => {
    const rig = mount({ drawings: [HLINE] })
    rig.chart.applyOptions({ handleScroll: false, handleScale: false })   // the Setup Library / frozen surface
    rig.chart.applyOptions.mockClear()
    fingerDown(rig.chartEl, ON_HLINE); fingerMove(rig.chartEl, { x: 200, y: 320 }); fingerUp(rig.chartEl, { x: 200, y: 320 })
    expect(ALL_OFF(rig.chart.options().handleScroll), 'frozen stays frozen').toBe(true)
    expect(ALL_OFF(rig.chart.options().handleScale)).toBe(true)
  })

  it('the wrapper listeners are removed on unmount and a chart frozen mid-drag is released', () => {
    const rig = mount({ drawings: [HLINE] })
    fingerDown(rig.chartEl, ON_HLINE)
    rig.chart.applyOptions.mockClear()
    rig.unmount()
    expect(rig.chart.options().handleScroll).toEqual(SCROLL)
    expect(rig.chart.options().handleScale).toEqual(SCALE)
  })
})

describe('a selected handle is a full fingertip', () => {
  // Handle 0 of the trendline sits at (100, 300). 20px to its LEFT is off the
  // segment (the nearest point is the endpoint itself, 20 > HIT_COARSE) — so
  // this touch is a handle grab or it is nothing.
  const NEAR_HANDLE = { x: 100 - 20, y: 300 }
  const FAR_FROM_HANDLE = { x: 100 - (HANDLE_GRAB_COARSE + 6), y: 300 }

  it('the numbers this relies on', () => {
    expect(20).toBeGreaterThan(HIT_COARSE)             // not a body hit
    expect(20).toBeGreaterThan(HIT_COARSE + 2)         // the OLD handle radius — this used to miss
    expect(20).toBeLessThan(HANDLE_GRAB_COARSE)        // the new one — this grabs
  })

  it('a touch 20px from the selected handle grabs THAT handle and moves only its point', () => {
    const rig = mount({ drawings: [TREND], selectedId: 't1' })
    fingerDown(rig.chartEl, NEAR_HANDLE)
    expect(rig.chartSaw.touchstart, 'the chart got the touch: the handle was missed').not.toHaveBeenCalled()
    fingerMove(rig.chartEl, { x: NEAR_HANDLE.x, y: 340 })
    const [id, patch] = rig.updateDrawing.mock.calls.at(-1)
    expect(id).toBe('t1')
    expect(patch.points[0].price).toBeCloseTo(10 + (PRICE_OF_Y(340) - PRICE_OF_Y(300)), 5)   // 10 → 6
    expect(patch.points[1]).toEqual(TREND.points[1])   // the other end did not move
  })

  it('NON-VACUITY · past the grab radius the same touch is the chart\'s', () => {
    const rig = mount({ drawings: [TREND], selectedId: 't1' })
    fingerDown(rig.chartEl, FAR_FROM_HANDLE)
    expect(rig.chartSaw.touchstart).toHaveBeenCalledTimes(1)
    expect(rig.updateDrawing).not.toHaveBeenCalled()
  })

  it('⛔ reaching for the handle does NOT deselect the drawing (the tap-away listener stands down)', () => {
    const rig = mount({ drawings: [TREND], selectedId: 't1' })
    fingerDown(rig.chartEl, NEAR_HANDLE)
    fingerMove(rig.chartEl, { x: NEAR_HANDLE.x, y: 340 })
    fingerUp(rig.chartEl, { x: NEAR_HANDLE.x, y: 340 })
    expect(rig.setSelectedId, 'the document deselect fired on a handle touch').not.toHaveBeenCalledWith(null)
  })

  it('NON-VACUITY · a TAP on empty space still deselects', () => {
    const rig = mount({ drawings: [TREND], selectedId: 't1' })
    fingerDown(rig.chartEl, EMPTY)
    expect(rig.setSelectedId, 'the decision is made on release, not on the first touch').not.toHaveBeenCalledWith(null)
    fingerMove(rig.chartEl, { x: EMPTY.x + 3, y: EMPTY.y + 2 })   // finger jitter
    fingerUp(rig.chartEl, { x: EMPTY.x + 3, y: EMPTY.y + 2 })
    expect(rig.setSelectedId).toHaveBeenCalledWith(null)
  })

  it('⭐ a PAN on empty space keeps the selection — scrolling to look is not tapping away', () => {
    const rig = mount({ drawings: [TREND], selectedId: 't1' })
    fingerDown(rig.chartEl, EMPTY)
    fingerMove(rig.chartEl, { x: EMPTY.x + 60, y: EMPTY.y })
    fingerUp(rig.chartEl, { x: EMPTY.x + 60, y: EMPTY.y })
    expect(rig.setSelectedId).not.toHaveBeenCalledWith(null)
    expect(rig.chartSaw.touchstart, 'and the chart still got the pan').toHaveBeenCalledTimes(1)
  })

  it('a pan the browser cancels never deselects either', () => {
    const rig = mount({ drawings: [TREND], selectedId: 't1' })
    fingerDown(rig.chartEl, EMPTY)
    pointer(rig.chartEl, 'pointercancel', EMPTY)
    expect(rig.setSelectedId).not.toHaveBeenCalledWith(null)
  })
})

describe('the body of the drawing you already chose is easier to re-grab', () => {
  // The trendline runs (100,300)→(300,260); (200,300) is ~19.6px off it —
  // outside HIT_COARSE, inside HIT_COARSE + the selected-body boost.
  const NEAR_BODY = { x: 200, y: 300 }

  it('the numbers this relies on', () => {
    const dist = Math.abs(200 * 0 - (-40) * 100) / Math.hypot(200, 40)
    expect(dist).toBeGreaterThan(HIT_COARSE)
    expect(dist).toBeLessThan(HIT_COARSE + SELECTED_BODY_BOOST_COARSE)
  })

  it('SELECTED · a touch 20px off the line grabs it and drags the whole drawing', () => {
    const rig = mount({ drawings: [TREND], selectedId: 't1' })
    fingerDown(rig.chartEl, NEAR_BODY)
    expect(rig.chartSaw.touchstart).not.toHaveBeenCalled()
    fingerMove(rig.chartEl, { x: 200, y: 340 })
    const [id, patch] = rig.updateDrawing.mock.calls.at(-1)
    expect(id).toBe('t1')
    expect(patch.points[0].price).toBeCloseTo(6, 5)    // both ends moved by -4
    expect(patch.points[1].price).toBeCloseTo(10, 5)
  })

  it('NON-VACUITY · UNSELECTED · the same touch is the chart\'s — the boost never widens a first tap', () => {
    const rig = mount({ drawings: [TREND], selectedId: null })
    fingerDown(rig.chartEl, NEAR_BODY)
    expect(rig.chartSaw.touchstart).toHaveBeenCalledTimes(1)
    expect(rig.updateDrawing).not.toHaveBeenCalled()
  })

  it('NON-VACUITY · the boost does not leak: a later plain read is the base radius', async () => {
    const { hitThreshold } = await import('./coarsePointer')
    expect(hitThreshold()).toBe(HIT_COARSE)
  })
})

describe('the touch quick bar can undo a mis-drag', () => {
  it('shows Undo when the surface owns history, and it calls it', () => {
    const undo = vi.fn()
    const rig = mount({ drawings: [TREND], selectedId: 't1', undo })
    const btn = rig.getByRole('button', { name: 'Undo' })
    act(() => { btn.click() })
    expect(undo).toHaveBeenCalledTimes(1)
  })

  it('NON-VACUITY · no Undo on a surface without history (annotation layers)', () => {
    const rig = mount({ drawings: [TREND], selectedId: 't1' })
    expect(rig.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(rig.getByRole('button', { name: 'Delete' }), 'the bar itself is there').toBeTruthy()
  })
})

describe('feedback through the finger', () => {
  it('a short haptic tick when the touch BECOMES a drag — not on the tap itself', () => {
    const rig = mount({ drawings: [HLINE] })
    fingerDown(rig.chartEl, ON_HLINE)
    expect(navigator.vibrate).not.toHaveBeenCalled()
    fingerMove(rig.chartEl, { x: 200, y: ON_HLINE.y + SLOP_COARSE - 2 })   // jitter — still a tap
    expect(navigator.vibrate).not.toHaveBeenCalled()
    fingerMove(rig.chartEl, { x: 200, y: 320 })
    expect(navigator.vibrate).toHaveBeenCalledTimes(1)
    fingerMove(rig.chartEl, { x: 200, y: 330 })
    expect(navigator.vibrate, 'one tick per drag, not per move').toHaveBeenCalledTimes(1)
  })

  it('a readout names what is moving while a body drags, and goes away on release', () => {
    const rig = mount({ drawings: [HLINE] })
    fingerDown(rig.chartEl, ON_HLINE)
    expect(screen.queryByTestId('drag-readout')).toBeNull()
    fingerMove(rig.chartEl, { x: 200, y: 320 })
    expect(screen.getByTestId('drag-readout').textContent).toMatch(/moving horizontal line/i)
    fingerUp(rig.chartEl, { x: 200, y: 320 })
    expect(screen.queryByTestId('drag-readout')).toBeNull()
  })

  it('a handle drag reads the anchor the finger is covering — price and bar', () => {
    const rig = mount({ drawings: [TREND], selectedId: 't1' })
    fingerDown(rig.chartEl, { x: 80, y: 300 })
    fingerMove(rig.chartEl, { x: 80, y: 340 })
    const text = screen.getByTestId('drag-readout').textContent
    expect(text).toMatch(/6(\.0+)?\b/)      // point 0: 10 → 6
    expect(text).toMatch(/Jan 2/)           // its bar
  })
})
