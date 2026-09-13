// app/src/components/chart/engine/__tests__/objectLayer.test.js
//
// ─── C3B — THE LAYER'S TWO JOBS, BOTH OF WHICH FAIL SILENTLY IF WRONG ──────
//
//   1. it must STOP DRAWING and REMOVE ITSELF when the indicator goes away —
//      a layer that only stopped updating leaves its last picture frozen over
//      the chart, which reads as "the indicator is still on";
//   2. it must NOT repaint a still chart — a per-frame redraw forever is a
//      background CPU cost on a page that already runs a live feed, and this
//      repo has an incident for exactly that shape.
//
// Both are invisible in a screenshot, which is why they are asserted here.
import { describe, it, expect } from 'vitest'
import { createObjectLayer } from '../objectLayer'

/** A DOM stand-in small enough to reason about, with a recording 2D context. */
function fakeHost() {
  const painted = []
  const ctx = {
    setTransform() {}, clearRect() {}, save() {}, restore() {}, beginPath() {},
    closePath() {}, moveTo(...a) { painted.push(['moveTo', ...a]) }, lineTo() {},
    stroke() { painted.push(['stroke']) }, fill() {}, fillRect() {}, strokeRect() {},
    fillText() {}, setLineDash() {}, measureText: (s) => ({ width: s.length * 6 }),
  }
  const canvas = {
    tagName: 'CANVAS', style: {}, width: 0, height: 0, getContext: () => ctx,
    parentNode: null, attrs: {}, setAttribute(k, v) { this.attrs[k] = v },
  }
  /** ⭐ THE FACTORY IS TAG-AWARE NOW, because the layer owns TWO nodes: the
   *  canvas for the drawings and a `<div>` holding the DOM tables. Returning one
   *  shared stub for every tag made `createElement('div')` hand back the canvas,
   *  and the table root then wrote its attributes onto it. */
  const el = (tag) => ({
    tagName: String(tag).toUpperCase(),
    style: {},
    attrs: {},
    children: [],
    parentNode: null,
    firstChild: null,
    textContent: '',
    setAttribute(k, v) { this.attrs[k] = v },
    appendChild(c) { this.children.push(c); c.parentNode = this; this.firstChild = this.children[0]; return c },
    removeChild(c) {
      this.children = this.children.filter((x) => x !== c)
      c.parentNode = null
      this.firstChild = this.children[0] || null
      return c
    },
  })
  const container = {
    clientWidth: 800,
    clientHeight: 400,
    children: [],
    appendChild(c) { this.children.push(c); c.parentNode = this },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null },
  }
  const frames = []
  const doc = { createElement: (tag) => (tag === 'canvas' ? canvas : el(tag)) }
  return {
    painted,
    container,
    frames,
    doc,
    /** run every queued frame */
    flush() { const q = frames.splice(0); q.forEach((f) => f()) },
    host: {
      container,
      doc,
      raf: (cb) => { frames.push(cb); return frames.length },
      cancel: () => {},
      mapping: () => ({ timeToX: (t) => t, priceToY: (p) => 400 - p, width: 800, height: 400 }),
    },
  }
}

const oneLine = () => ({
  lines: [{ id: 1, x1: 10, y1: 100, x2: 90, y2: 200, color: '#0f0', width: 1, style: 'solid' }],
  labels: [], boxes: [], tables: [], fills: [],
})

describe('C3B — the object layer', () => {
  it('⭐ attaches ONE canvas and paints the state it is given', () => {
    const f = fakeHost()
    const layer = createObjectLayer(f.host)
    // ⭐ TWO NODES, AND EXACTLY ONE OF THEM IS A CANVAS. R2 step 6 added the DOM
    // table root beside it, so the count moved from 1 to 2 — what this case is
    // actually about is that the layer attaches ONE canvas, which is asserted by
    // tag rather than by a total that any future sibling would break again.
    expect(f.container.children).toHaveLength(2)
    expect(f.container.children.filter((c) => c.tagName === 'CANVAS')).toHaveLength(1)
    expect(f.container.children.filter((c) => c.tagName === 'DIV')).toHaveLength(1)
    layer.set(oneLine(), 'sig-1')
    f.flush()
    expect(f.painted.filter((p) => p[0] === 'stroke')).toHaveLength(1)
  })

  it('⛔⛔ A STILL CHART DOES NOT REPAINT — same state, same signature, no frame', () => {
    const f = fakeHost()
    const layer = createObjectLayer(f.host)
    const state = oneLine()
    layer.set(state, 'sig-1')
    f.flush()
    const after = f.painted.length
    for (let i = 0; i < 50; i += 1) layer.set(state, 'sig-1')
    f.flush()
    expect(f.painted.length).toBe(after)
    expect(f.frames).toHaveLength(0)
  })

  it('⭐ …but a CHANGED signature repaints, even with the same state object', () => {
    const f = fakeHost()
    const layer = createObjectLayer(f.host)
    const state = oneLine()
    layer.set(state, 'sig-1')
    f.flush()
    const after = f.painted.length
    layer.set(state, 'sig-2') // the chart moved
    f.flush()
    expect(f.painted.length).toBeGreaterThan(after)
  })

  it('⛔⛔ CLEAR REMOVES THE CANVAS — no frozen ghost over the chart', () => {
    const f = fakeHost()
    const layer = createObjectLayer(f.host)
    layer.set(oneLine(), 'sig-1')
    f.flush()
    layer.clear()
    // ⛔ BOTH nodes, not just the canvas — a `<table>` left behind is a crisp
    // stale number over the chart, which reads MORE live than a frozen raster.
    expect(f.container.children).toHaveLength(0)
    // …and a later set cannot resurrect a drawing on a detached node
    const before = f.painted.length
    layer.set(oneLine(), 'sig-2')
    f.flush()
    expect(f.painted.length).toBe(before)
  })

  it('⭐ tables come back as a layout, not as pixels', () => {
    const f = fakeHost()
    const layer = createObjectLayer(f.host)
    const tables = layer.set({
      lines: [], labels: [], boxes: [], fills: [],
      tables: [{ id: 7, position: 'top_right', cells: [{ col: 0, row: 0, text: 'RSI' }] }],
    }, 's')
    expect(tables).toHaveLength(1)
    expect(tables[0].anchor).toEqual({ h: 1, v: 0 })
    expect(tables[0].grid[0][0].text).toBe('RSI')
    // ⭐⭐ …AND THE PIXELS ARE NOW DOM. The layout above is still the contract a
    // Builder could one day produce without Pine; what CONSUMES it is a real
    // `<table>` on the layer's own node, and the layer stamps what it built.
    const root = f.container.children.find((c) => c.tagName === 'DIV')
    expect(root.attrs['data-uct-tables-drawn']).toBe('{"tables":1,"cells":1,"skipped":0}')
    expect(root.children).toHaveLength(1)
    expect(root.children[0].attrs['data-uct-object-table']).toBe('7')
  })

  it('⛔ a host that cannot provide a container gets NO layer and no error', () => {
    expect(createObjectLayer({ container: null, mapping: () => ({}) })).toBe(null)
    expect(createObjectLayer({ container: {}, mapping: null })).toBe(null)
  })

  it('⭐ the painter’s own counts are readable — what drew, and what did not', () => {
    const f = fakeHost()
    const layer = createObjectLayer(f.host)
    layer.set(oneLine(), 's')
    f.flush()
    expect(layer.stats().drawn.line).toBe(1)
    expect(layer.stats().skipped.line).toBe(0)
  })
})
