// ONE CHANGE, ONE PAINT: what the chart library DRAWS after a change, shipped against patched (edits 7-10 of
// scripts/chartLibraryPatch.mjs: "a draw paints what its own layout raised, in the same frame" and "an applied
// canvas size asks for no second paint", for the price axes, the panes and the time axis).
//
// Each build is the real production build of lightweight-charts read from the installed package, evaluated the
// way chartLibraryPatch.behaviour.test.js evaluates them. The library's animation frames run when the test says
// so, one at a time, and every call on every canvas is recorded, canvas by canvas. A chart with candles and three
// oscillator panes goes through the changes a symbol switch makes (data onto narrower and wider prices, the option
// sets the binder writes) and the ones a member makes (recolour, fit, a range, a pane height, a resize).
//
// THE PICTURE of a chart is, for every canvas, the calls of the last frame that drew on it (a widget redraws its
// whole canvas each time it paints). After every change, against the shipped build:
//   * the same layout once the frames stop: every pane's height, every price axis' width and range, the time scale;
//   * the same picture once the frames stop, canvas for canvas, call for call;
//   * and that picture is what a full repaint of the settled chart draws (on both builds);
// while the patched chart gets there in ONE painted frame per change, with that frame's layout already the final
// one: an axis that has to widen does so in the frame of the change. The shipped build takes two for most of them,
// and so does the patched build with the four edits left out (the other six cannot be what moved), or with either
// half left out.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PATCHES, patchLightweightCharts } from '../../scripts/chartLibraryPatch.mjs'

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SHIPPED = readFileSync(path.join(APP, 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.production.mjs'), 'utf8')
const DRAW = PATCHES.filter((p) => p.name.startsWith('a draw paints what its own layout raised')).map((p) => p.name)
const SIZE = PATCHES.filter((p) => p.name.startsWith('an applied canvas size asks for no second paint')).map((p) => p.name)

const libs = {}
let log = null                       // every canvas call while an array: [canvas id, call]
const queue = []                     // the library's animation frames, run by `frame()`

beforeAll(async () => {
  const round = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : (typeof v === 'string' ? v : typeof v))
  const ids = new WeakMap()
  let next = 0
  const contextFor = (id, el) => new Proxy({}, {
    get: (_t, k) => {
      if (k === '__id') return id
      if (k === 'canvas') return { width: 900, height: 600 }
      // a label is as wide as its text, so an axis re-fits when its labels change (as a real one does)
      if (k === 'measureText') return (text) => ({ width: 7 * String(text).length, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
      return (...a) => {
        if (!log) return
        // a rectangle covering the whole bitmap: what came before it on this canvas can no longer be seen
        const whole = (k === 'clearRect' || k === 'fillRect') && a[0] <= 0 && a[1] <= 0 && a[0] + a[2] >= el.width && a[1] + a[3] >= el.height
        log.push([id, [k, ...a.map(round)].join(' ') + (whole ? ' @whole' : '')])
      }
    },
    set: (_t, k, v) => { if (log) log.push([id, `${String(k)}=${round(v)}`]); return true },
  })
  HTMLCanvasElement.prototype.getContext = function getContext() {
    if (!ids.has(this)) ids.set(this, contextFor(next++, this))
    return ids.get(this)
  }
  // each chart numbers its own canvases from 0, in the order it creates them
  rig.resetCanvasIds = () => { next = 0 }
  rig.canvasId = (el) => { const c = ids.get(el); return c ? c.__id : undefined }
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get() { return 900 }, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get() { return 600 }, configurable: true })
  // ids stay valid until their frame runs: a cancelled frame is nulled in place
  let base = 0
  window.requestAnimationFrame = (cb) => { queue.push(cb); return base + queue.length }
  window.cancelAnimationFrame = (id) => { const k = id - base - 1; if (k >= 0 && k < queue.length) queue[k] = null }
  frame.reset = () => { base += queue.length }

  const canvas = await import('fancy-canvas')
  const IMPORT = /import\{([^}]*)\}from"fancy-canvas";/
  const EXPORT = /export\{([^}]*)\};?\s*$/
  const load = (code) => {
    const imported = IMPORT.exec(code)
    const exported = EXPORT.exec(code)
    if (!imported || !exported) throw new Error('the library file is no longer one import, a body and one export')
    const takes = imported[1].split(',').map((x) => x.trim().split(' as ')).map(([from, to]) => `${from}:${to || from}`).join(',')
    const gives = exported[1].split(',').map((x) => x.trim().split(' as ')).map(([local, name]) => `${name || local}:${local}`).join(',')
    const body = code.replace(IMPORT, () => `const{${takes}}=uctCanvas;`).replace(EXPORT, () => `return{${gives}}`)
    return new Function('uctCanvas', `"use strict";${body}`)(canvas)
  }
  libs.shipped = load(SHIPPED)
  libs.patched = load(patchLightweightCharts(SHIPPED))
  libs.without = load(patchLightweightCharts(SHIPPED, [...DRAW, ...SIZE]))
  libs.withoutDraw = load(patchLightweightCharts(SHIPPED, DRAW))
  libs.withoutSize = load(patchLightweightCharts(SHIPPED, SIZE))
})

/**
 * What a canvas SHOWS after these calls: everything from the last call that covered its whole bitmap (a
 * `clearRect`, or a `fillRect` in `copy` mode, as every widget starts its paint), from the `save` that opened it,
 * so the state it was drawn with comes along. Calls before it (a label measured for the layout, an earlier paint
 * in the same frame) left nothing on screen. A canvas never wholly covered keeps every call.
 */
function shows(calls) {
  return withoutNoOps(lastCover(calls))
}
/** A `save` ... `restore` holding nothing but state (a font set to measure a label) draws nothing: dropped. */
function withoutNoOps(calls) {
  let out = calls
  for (;;) {
    const next = []
    let changed = false
    for (let i = 0; i < out.length; i++) {
      if (out[i] === 'save') {
        let j = i + 1
        while (j < out.length && /^[A-Za-z]+=/.test(out[j])) j++
        if (j < out.length && out[j] === 'restore') { i = j; changed = true; continue }
      }
      next.push(out[i])
    }
    out = next
    if (!changed) return out
  }
}
function lastCover(calls) {
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i]
    if (!c.endsWith(' @whole')) continue
    const copy = c.startsWith('clearRect') || calls.slice(Math.max(0, i - 3), i).includes('globalCompositeOperation=copy')
    if (!copy) continue
    let start = i
    for (let j = i - 1; j >= Math.max(0, i - 4); j--) if (calls[j] === 'save') { start = j; break }
    if (start > 0 && calls[start - 1] === 'setTransform 1 0 0 1 0 0' && calls[start - 2] === 'save') start -= 2
    return calls.slice(start)
  }
  return calls
}

/** One animation frame: every callback asked for before it, in order. Its canvas calls, by canvas (empty: none). */
function frame() {
  frame.reset()
  const now = queue.splice(0)
  log = []
  for (const cb of now) if (cb) cb(1000)
  const byCanvas = new Map()
  for (const [id, call] of log) { if (!byCanvas.has(id)) byCanvas.set(id, []); byCanvas.get(id).push(call) }
  log = null
  return byCanvas
}

const N = 600
const series = (base, seed) => Array.from({ length: N }, (_, i) => base * (1 + 0.25 * Math.sin(i / (6 + seed)) + 0.001 * i))
const day = (i) => 1_600_000_000 + i * 86400

/** A chart as the product draws one: candles and two lines on the price pane, three lines on each of three panes. */
function rig(L) {
  rig.resetCanvasIds()
  const el = document.createElement('div')
  document.body.appendChild(el)
  const chart = L.createChart(el, { width: 900, height: 600 })
  const candles = chart.addSeries(L.CandlestickSeries, {})
  const lines = []
  for (let pane = 0; pane < 4; pane++) for (let j = 0; j < (pane === 0 ? 2 : 3); j++) {
    lines.push({ pane, j, s: chart.addSeries(L.LineSeries, { color: `#${pane}${j}a0b0`, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } }, pane) })
  }
  /** What a symbol switch does: every series' data, then every series' whole option set (the binder's writes). */
  const load = (base) => {
    const c = series(base, 1)
    candles.setData(c.map((v, i) => ({ time: day(i), open: v, high: v * 1.01, low: v * 0.99, close: v * 1.002 })))
    for (const { pane, j, s } of lines) {
      const scale = pane === 0 ? 1 : (pane === 1 ? 0.01 : pane === 2 ? 1 : 100)
      s.setData(series(base * scale * (1 + j / 10), pane * 3 + j).map((v, i) => ({ time: day(i), value: v })))
      s.applyOptions({ color: `#${pane}${j}a0b0`, lineWidth: 1, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } })
    }
  }
  const state = () => ({
    panes: chart.panes().map((p) => p.getHeight()),
    axes: chart.panes().map((_p, i) => chart.priceScale('right', i).width()),
    ranges: chart.panes().map((_p, i) => { const r = chart.priceScale('right', i).getVisibleRange(); return r && [+r.from.toFixed(6), +r.to.toFixed(6)] }),
    time: { range: chart.timeScale().getVisibleLogicalRange(), width: chart.timeScale().width() },
  })
  return { chart, candles, lines, load, state, el }
}

const CHANGES = [
  ['first load', (r) => r.load(1000)],
  ['the same data and sets again', (r) => r.load(1000)],
  ['a switch onto narrower prices', (r) => r.load(10)],
  ['a switch onto much wider prices', (r) => r.load(100000)],
  ['a recolour', (r) => r.lines[4].s.applyOptions({ color: '#ff0000' })],
  ['fit the content', (r) => r.chart.timeScale().fitContent()],
  ['a logical range', (r) => r.chart.timeScale().setVisibleLogicalRange({ from: 120, to: 420 })],
  ['a pane height', (r) => r.chart.panes()[2].setHeight(90)],
  ['a resize', (r) => r.chart.resize(820, 560)],
  // App code reacting WHILE the chart lays itself out: a visible-range listener runs inside the layout when the
  // time scale's width changes. One asks for a range (time-scale work), one widens the axis twice (a full update
  // raised by the relayout the library's own fold runs): neither may be folded into a paint that has not done it.
  ['a range listener asks for a range during the layout', (r) => {
    let n = 0
    const h = () => { n += 1; if (n === 1) r.chart.timeScale().setVisibleLogicalRange({ from: 200, to: 480 }) }
    r.chart.timeScale().subscribeVisibleLogicalRangeChange(h)
    r.chart.resize(760, 560)
    r.after = () => r.chart.timeScale().unsubscribeVisibleLogicalRangeChange(h)
  }, { timeScaleWork: true }],
  ['a range listener widens the axis twice during the layout', (r) => {
    let n = 0
    const h = () => { n += 1; if (n <= 2) r.chart.priceScale('right', 0).applyOptions({ minimumWidth: 90 + 40 * n }) }
    r.chart.timeScale().subscribeVisibleLogicalRangeChange(h)
    r.chart.resize(700, 560)
    r.after = () => r.chart.timeScale().unsubscribeVisibleLogicalRangeChange(h)
  }, { listener: true }],
]

// ─── how the browser tells a canvas its size ─────────────────────────────────────────────────────────────────────
// fancy-canvas learns a canvas' bitmap size one of two ways, and the library runs on both:
//   * 'observer' (Chrome, Edge, Firefox): the size is PREDICTED from the canvas' rectangle the moment the chart sets
//     it, and a ResizeObserver on its device-pixel content box reports the size the browser actually gave it AFTER
//     the page is laid out. Where the two differ (a fractional zoom snaps the box to device pixels) the canvas is
//     painted once at the predicted size and again at the reported one. `FakeResizeObserver` reports, after every
//     frame, each observed canvas whose CSS size changed, one device pixel WIDER than predicted, so that second
//     paint always happens here: the edits must keep it.
//   * 'ratio' (Safari, and jsdom as it is): no such observer; the size is worked out from the CSS size the moment
//     the chart sets it.
class FakeResizeObserver {
  constructor(cb) { this.cb = cb; this.seen = new Map(); FakeResizeObserver.live.add(this) }
  observe(el) {
    // the support probe observes the body and asks only whether entries carry the device-pixel box
    if (el === document.body) { queueMicrotask(() => this.cb([{ target: el, devicePixelContentBoxSize: [{ inlineSize: 1, blockSize: 1 }] }], this)); return }
    this.seen.set(el, null)
  }
  unobserve(el) { this.seen.delete(el) }
  disconnect() { this.seen.clear(); FakeResizeObserver.live.delete(this) }
  /** The browser snapping ONE canvas' box to a different device-pixel width, with nothing else changed. */
  static snap(el, extra) {
    for (const ro of FakeResizeObserver.live) {
      if (!ro.seen.has(el)) continue
      const w = parseFloat(el.style.width) || 0
      const h = parseFloat(el.style.height) || 0
      ro.cb([{ target: el, devicePixelContentBoxSize: [{ inlineSize: Math.round(w) + extra, blockSize: Math.round(h) }] }], ro)
    }
  }
  static canvases() {
    const out = new Set()
    for (const ro of FakeResizeObserver.live) for (const el of ro.seen.keys()) out.add(el)
    return [...out].sort((a, b) => rig.canvasId(a) - rig.canvasId(b))
  }
  /** What the browser does after a frame's layout: report every canvas whose size changed. True if any did. */
  static report() {
    let any = false
    for (const ro of [...FakeResizeObserver.live]) {
      const entries = []
      for (const [el, last] of ro.seen) {
        const w = parseFloat(el.style.width) || 0
        const h = parseFloat(el.style.height) || 0
        const now = `${w}x${h}`
        if (now === last) continue
        ro.seen.set(el, now)
        entries.push({ target: el, devicePixelContentBoxSize: [{ inlineSize: Math.round(w) + 1, blockSize: Math.round(h) }] })
      }
      if (entries.length) { any = true; ro.cb(entries, ro) }
    }
    return any
  }
}
FakeResizeObserver.live = new Set()
const idle = () => new Promise((r) => setTimeout(r, 0))

/** Frames until none is asked for and no canvas changes size: how many, how many drew, the layout of the first. */
async function settle(r, picture, mode) {
  let frames = 0
  let painted = 0
  let first = null
  for (let guard = 0; guard < 20; guard++) {
    await idle()
    if (!queue.length) {
      if (mode === 'observer' && FakeResizeObserver.report()) continue
      break
    }
    frames += 1
    const drew = frame()
    if (drew.size) {
      painted += 1
      for (const [id, calls] of drew) {
        const seen = shows(calls)
        // a frame that only measured on a canvas (no whole-bitmap cover) adds to what it showed
        picture.set(id, seen === calls && picture.has(id) && !calls.some((c) => / @whole$/.test(c)) ? [...picture.get(id), ...calls] : seen)
      }
      if (!first) first = r.state()
    }
    // after the frame's layout, the observer reports what it resized (before the next frame)
    if (mode === 'observer') FakeResizeObserver.report()
  }
  return { frames, painted, first }
}

/** Every change on one build, under one way of learning canvas sizes. */
async function run(L, mode) {
  if (mode === 'observer') globalThis.ResizeObserver = FakeResizeObserver
  else delete globalThis.ResizeObserver
  const r = rig(L)
  const picture = new Map()
  await settle(r, picture, mode)            // the chart's creation
  const out = []
  for (const [name, change, how = {}] of CHANGES) {
    change(r)
    const s = await settle(r, picture, mode)
    if (r.after) { r.after(); r.after = null }
    const rest = r.state()
    const shown = new Map(picture)
    // a full repaint of the chart at rest, painted onto a copy of what it shows
    r.chart.applyOptions({})
    await settle(r, picture, mode)
    out.push({ name, how, ...s, rest, shown, repainted: new Map(picture) })
  }
  // the observer alone, one canvas at a time: a size the browser reports later must still be painted at
  const snaps = []
  if (mode === 'observer') {
    for (const el of FakeResizeObserver.canvases()) {
      // (a corner stub paints itself inside the observer's callback, outside any frame)
      log = []
      FakeResizeObserver.snap(el, 3)
      const direct = new Map()
      for (const [id, call] of log) { if (!direct.has(id)) direct.set(id, []); direct.get(id).push(call) }
      log = null
      for (const [id, calls] of direct) picture.set(id, shows(calls))
      const s = await settle(r, picture, mode)
      snaps.push({ id: rig.canvasId(el), painted: s.painted + (direct.size ? 1 : 0), bitmap: el.width, shown: new Map(picture) })
    }
  }
  out.snaps = snaps
  r.chart.remove()
  r.el.remove()
  delete globalThis.ResizeObserver
  FakeResizeObserver.live.clear()
  return out
}

const asObject = (m) => Object.fromEntries([...m].sort((a, b) => a[0] - b[0]))
const BUILDS = ['shipped', 'patched', 'without', 'withoutDraw', 'withoutSize']

for (const mode of ['observer', 'ratio']) {
  describe(`edits 7-10, canvas sizes by ${mode === 'observer' ? 'a ResizeObserver (Chrome)' : 'the pixel ratio (Safari)'}: one change, one paint, the same picture`, () => {
    const R = {}
    beforeAll(async () => { for (const k of BUILDS) R[k] = await run(libs[k], mode) }, 60_000)

    it('the same layout at rest after every change', () => {
      for (let k = 0; k < CHANGES.length; k++) expect(R.patched[k].rest, R.patched[k].name).toEqual(R.shipped[k].rest)
    })
    it('the same picture at rest after every change, canvas for canvas, call for call', () => {
      for (let k = 0; k < CHANGES.length; k++) {
        expect(R.shipped[k].shown.size, `${R.shipped[k].name}: no canvas drawn (vacuous)`).toBeGreaterThan(8)
        expect(asObject(R.patched[k].shown), R.patched[k].name).toEqual(asObject(R.shipped[k].shown))
      }
    })
    it.runIf(mode === 'observer')('a size the observer reports on its own is painted at, canvas by canvas, as shipped', () => {
      expect(R.shipped.snaps.length, 'no canvas observed: vacuous').toBeGreaterThan(8)
      expect(R.patched.snaps.map((x) => x.id)).toEqual(R.shipped.snaps.map((x) => x.id))
      for (let k = 0; k < R.shipped.snaps.length; k++) {
        const a = R.patched.snaps[k]
        const b = R.shipped.snaps[k]
        expect(b.painted, `canvas ${b.id}: shipped repainted (non-vacuous)`).toBeGreaterThan(0)
        expect(a.painted, `canvas ${a.id}: repainted`).toBeGreaterThan(0)
        expect(a.bitmap, `canvas ${a.id}: bitmap width`).toBe(b.bitmap)
        expect(asObject(a.shown), `canvas ${a.id}: the picture`).toEqual(asObject(b.shown))
      }
    })
    it('a full repaint of the settled chart draws the same on both builds', () => {
      for (let k = 0; k < CHANGES.length; k++) expect(asObject(R.patched[k].repainted), R.patched[k].name).toEqual(asObject(R.shipped[k].repainted))
    })
    // (Not under the observer: a relayout re-predicts every canvas' size, and the observer, seeing no CSS change,
    // does not correct it again; that is fancy-canvas, on both builds alike.)
    it.runIf(mode === 'ratio')('the picture at rest is what a full repaint of the settled chart draws, on both builds', () => {
      for (const b of ['shipped', 'patched']) {
        // (a listener that changes the chart while it lays out is not "at rest" for a relayout, on either build)
        for (const x of R[b]) if (!x.how.listener && !x.how.timeScaleWork) expect(asObject(x.shown), `${b}: ${x.name}`).toEqual(asObject(x.repainted))
      }
    })
    it('ONE painted frame fewer than shipped for every change that painted twice, the first already laid out as at rest', () => {
      const counts = (rs) => rs.map((x) => `${x.name}: ${x.painted}/${x.frames}`)
      for (const b of BUILDS) console.log(`[one paint] ${mode} ${b} ${JSON.stringify(counts(R[b]))}`)
      for (let k = 0; k < CHANGES.length; k++) {
        const p = R.patched[k]
        const s = R.shipped[k]
        // time-scale work asked for during the layout is done by the next frame, as shipped: never folded away
        if (!p.how.timeScaleWork) expect(p.first, `${p.name}: the first painted frame's layout is the final one`).toEqual(p.rest)
        expect(p.painted, `${p.name}: painted frames, patched against shipped (${s.painted})`).toBe(Math.max(1, s.painted - 1))
      }
      expect(R.shipped.filter((x) => x.painted > 1).length, 'shipped never painted twice: vacuous').toBeGreaterThanOrEqual(5)
      expect(R.without.map((x) => x.painted), 'the four edits left out: as shipped').toEqual(R.shipped.map((x) => x.painted))
      const more = (b) => R[b].filter((x, k) => x.painted > R.patched[k].painted).map((x) => x.name)
      expect(more('withoutDraw').length, 'the draw edit left out paints more').toBeGreaterThan(0)
      expect(more('withoutSize').length, 'the canvas size edits left out paint more').toBeGreaterThan(0)
    })
  })
}
