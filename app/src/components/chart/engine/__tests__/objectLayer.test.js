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
  const canvas = { style: {}, width: 0, height: 0, getContext: () => ctx, parentNode: null }
  const container = {
    clientWidth: 800,
    clientHeight: 400,
    children: [],
    appendChild(c) { this.children.push(c); c.parentNode = this },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null },
  }
  const frames = []
  const doc = { createElement: () => canvas }
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
    expect(f.container.children).toHaveLength(1)
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
