// app/src/components/chart/engine/__tests__/markerCanvas.test.js
//
// ─── e99 — PINE MARKERS ON CANVAS: THE SHAPE AND THE PLACE, NOT YET THE SIZE ──
//
// `markerCanvas.js` draws each `plotshape` style as its own glyph (TradingView
// substitutes none: FRED RS, AMEX:SPY 1D captures 2026-11-26) at the author's
// location, through one series primitive per pane, behind a gate that is OFF.
//
// ⛔ SYNTHETIC RAILS. Nothing here grades a pixel against TradingView: the
// geometry table is provisional, and a marker drawn by it is recorded
// `geometryApprox` and said so at the member door. What IS held here:
//   - thirteen distinct glyphs, each Pine shape drawn by its own (no substitution);
//   - x is the bar's own coordinate; y is the bar's high / low, the pane's edge or
//     the plotted value, each fixture built so the wrong anchor gives another y;
//   - every geometry constant lives in ONE table;
//   - off, nothing changes (the LWC markers and the record are untouched).
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {
  GLYPHS, MARKER_GEOMETRY, glyphOf, locationOf, placeY, layoutMarkers, paintMarkers,
  canvasMarkerRecord, createMarkerCanvasRegistry, sizePxOf,
} from '../markerCanvas'
import { markerCanvasEnabled } from '../markerCanvasGate'
import { createBinder } from '../binder'
import { createFakeChart } from './fakeChart'

const FLAG = 'VITE_PINE_MARKER_CANVAS_ENABLED'
afterEach(() => { vi.unstubAllEnvs() })

const PINE_SHAPES = ['shape.circle', 'shape.square', 'shape.diamond', 'shape.triangleup', 'shape.triangledown',
  'shape.arrowup', 'shape.arrowdown', 'shape.labelup', 'shape.labeldown', 'shape.flag', 'shape.cross', 'shape.xcross']

/** A 2D context that records every call, rounded so two paths compare as data. */
function recordingCtx() {
  const ops = []
  const r = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)
  const handler = {
    get(target, prop) {
      if (prop === 'ops') return ops
      if (prop in target) return target[prop]
      return (...args) => { ops.push([String(prop), ...args.map(r)]) }
    },
    set(target, prop, value) { ops.push([`=${String(prop)}`, r(value)]); return true },
  }
  return new Proxy({}, handler)
}

describe('e99 — thirteen glyphs, each Pine shape its own', () => {
  it('the table is exactly the twelve Pine shapes and the character', () => {
    expect(Object.keys(GLYPHS).sort()).toEqual([...PINE_SHAPES, 'char'].sort())
  })

  it('⛔ no Pine shape is drawn by another\'s glyph', () => {
    for (const s of PINE_SHAPES) expect(glyphOf({ shape: 'circle', pineShape: s }), s).toBe(s)
  })

  it('⛔ all thirteen paths are pairwise distinct', () => {
    const paths = Object.entries(GLYPHS).map(([name, fn]) => {
      const ctx = recordingCtx()
      fn(ctx, 10, 'x')
      return [name, JSON.stringify(ctx.ops)]
    })
    const seen = new Map()
    for (const [name, p] of paths) {
      expect(seen.get(p), `${name} draws the same path as ${seen.get(p)}`).toBeUndefined()
      seen.set(p, name)
    }
    expect(seen.size).toBe(13)
  })

  it('a plotchar draws its character; a hand-authored marker is left to the LWC markers', () => {
    expect(glyphOf({ shape: 'circle', pineShape: null, text: '★' })).toBe('char')
    expect(glyphOf({ shape: 'arrowUp', position: 'belowBar' })).toBeNull()
    expect(glyphOf({ shape: 'square', pineShape: 'shape.star' })).toBeNull()
    expect(glyphOf({ shape: 'square', pineShape: 'char' })).toBeNull()
  })

  it('the char glyph writes the character, not a path', () => {
    const ctx = recordingCtx()
    expect(GLYPHS.char(ctx, 12, 'B')).toBe('text')
    expect(ctx.ops.find((o) => o[0] === 'fillText')).toEqual(['fillText', 'B', 0, 0])
  })
})

describe('e99 — the location', () => {
  it('the word wins; without one it is read back off the LWC fallback', () => {
    expect(locationOf({ position: 'aboveBar', pineLocation: 'location.top', positionApprox: true })).toBe('location.top')
    expect(locationOf({ position: 'aboveBar', positionApprox: true })).toBe('location.top')
    expect(locationOf({ position: 'belowBar', positionApprox: true })).toBe('location.bottom')
    expect(locationOf({ position: 'belowBar' })).toBe('location.belowbar')
    expect(locationOf({ position: 'inBar' })).toBe('location.absolute')
    expect(locationOf({ position: 'aboveBar' })).toBe('location.abovebar')
  })

  // a price scale where every anchor lands on a different y: high 110 → 100, low 90 → 300, value 50 → 700
  const toY = (p) => (200 - p) * 10 - 800
  const at = { high: 110, low: 90, value: 50, paneHeight: 1000, toY, size: 20 }
  const G = MARKER_GEOMETRY
  it('⭐ abovebar sits above the bar\'s HIGH', () => {
    expect(placeY('location.abovebar', at)).toBe(toY(110) - G.barGapPx - 10)
  })
  it('⭐ belowbar sits below the bar\'s LOW', () => {
    expect(placeY('location.belowbar', at)).toBe(toY(90) + G.barGapPx + 10)
  })
  it('⭐ top and bottom are measured from the PANE\'s edges, not the bar', () => {
    expect(placeY('location.top', at)).toBe(G.edgeInsetPx + 10)
    expect(placeY('location.bottom', at)).toBe(1000 - G.edgeInsetPx - 10)
  })
  it('⭐ absolute is priceToCoordinate(the plotted value), exactly', () => {
    expect(placeY('location.absolute', at)).toBe(toY(50))
  })
  it('no price, no place', () => {
    expect(placeY('location.absolute', { ...at, value: NaN })).toBeNull()
    expect(placeY('location.abovebar', { ...at, toY: () => null })).toBeNull()
  })
})

describe('e99 — the layout', () => {
  const host = { priceToCoordinate: (p) => 1000 - p }
  const items = [
    { time: 100, color: '#ff0000', text: 'B', value: 1, high: 110, low: 90 },
    { time: 200, color: '#00ff00', text: '', value: 1, high: 120, low: 95 },
    { time: 300, color: '#0000ff', text: '', value: 1, high: 120, low: 95 },
  ]
  const tx = (t) => (t === 300 ? null : t * 3 + 7)
  it('⭐ x is timeToCoordinate(bar time) exactly; a bar off the scale draws nothing', () => {
    const out = layoutMarkers([{ marker: { shape: 'arrowUp', pineShape: 'shape.triangleup', position: 'aboveBar' }, host, items }],
      { timeToCoordinate: tx, paneHeight: 800 })
    expect(out.map((m) => m.x)).toEqual([307, 607])
    expect(out.map((m) => m.glyph)).toEqual(['shape.triangleup', 'shape.triangleup'])
    expect(out[0].y).toBe(1000 - 110 - MARKER_GEOMETRY.barGapPx - sizePxOf({}) / 2)
  })
  it('text takes the record\'s textColor, and the size word picks the box', () => {
    const [m] = layoutMarkers([{ marker: { shape: 'square', pineShape: 'shape.flag', pineSize: 'size.huge', textColor: '#2962FF' }, host, items: [items[0]] }],
      { timeToCoordinate: tx, paneHeight: 800 })
    expect(m).toMatchObject({ text: 'B', textColor: '#2962FF', size: MARKER_GEOMETRY.sizePx['size.huge'], textAbove: true })
  })
  it('a hand-authored marker is not laid out here', () => {
    expect(layoutMarkers([{ marker: { shape: 'circle' }, host, items }], { timeToCoordinate: tx, paneHeight: 800 })).toEqual([])
  })
  it('paint draws the glyph at (x, y) in the item colour', () => {
    const ctx = recordingCtx()
    paintMarkers(ctx, [{ glyph: 'shape.diamond', x: 5, y: 6, size: 10, color: '#abcdef', text: '', char: '', textColor: '#000000', textAbove: true }])
    expect(ctx.ops[1]).toEqual(['translate', 5, 6])
    expect(ctx.ops).toContainEqual(['=fillStyle', '#abcdef'])
    expect(ctx.ops).toContainEqual(['fill'])
  })
})

/** The code with its comments removed (block comments, then line comments not inside a quote on that line). */
function stripComments(src) {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, '')
  return noBlocks.split('\n').map((line) => {
    let quote = null
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (quote) { if (ch === '\\') i += 1; else if (ch === quote) quote = null; continue }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
      if (ch === '/' && line[i + 1] === '/') return line.slice(0, i)
    }
    return line
  }).join('\n')
}
/** Every numeric literal of `src` outside the `MARKER_GEOMETRY` table, other than 0, 1, 2 and 0.5. */
function strayNumbers(src) {
  const code = stripComments(src)
  const start = code.indexOf('export const MARKER_GEOMETRY = Object.freeze({')
  const end = start < 0 ? -1 : code.indexOf('\n})', start)
  const outside = start < 0 ? code : code.slice(0, start) + code.slice(end + 3)
  const noStrings = outside.replace(/'[^'\n]*'/g, "''").replace(/`[^`\n]*`/g, '``')
  return [...noStrings.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g)].map((m) => m[1])
    .filter((n) => !['0', '1', '2', '0.5'].includes(n))
}

describe('e99 — ONE provisional geometry table', () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), 'src/components/chart/engine/markerCanvas.js'), 'utf8')
  it('control: a stray number outside the table is found, one inside is not', () => {
    const fake = 'const a = 3\nexport const MARKER_GEOMETRY = Object.freeze({\n  b: 7,\n})\nconst c = 0.5 * 2 // 9\n'
    expect(strayNumbers(fake)).toEqual(['3'])
  })
  it('⛔ markerCanvas.js holds no geometry number outside MARKER_GEOMETRY', () => {
    expect(strayNumbers(src)).toEqual([])
  })
  it('the table is provisional (no pixel read has pinned it)', () => {
    expect(MARKER_GEOMETRY.provisional).toBe(true)
    expect(Object.keys(MARKER_GEOMETRY.sizePx)).toEqual(['size.tiny', 'size.small', 'size.normal', 'size.large', 'size.huge', 'size.auto'])
  })
})

describe('e99 — the record', () => {
  const tri = { shape: 'arrowUp', pineShape: 'shape.triangleup', shapeApprox: true, position: 'aboveBar', pineLocation: 'location.top', positionApprox: true }
  it('⛔ OFF: the marker is returned as is, the same object', () => {
    expect(canvasMarkerRecord(tri, false)).toBe(tri)
    expect(markerCanvasEnabled({})).toBe(false)
    expect(markerCanvasEnabled({ [FLAG]: '1' })).toBe(true)
    expect(markerCanvasEnabled({ [FLAG]: 'true' })).toBe(false)
  })
  it('⭐ ON: no shape or pane-edge substitution, and geometryApprox while the table is provisional', () => {
    const r = canvasMarkerRecord(tri, true)
    expect(r).toMatchObject({ shapeApprox: false, positionApprox: false, geometryApprox: true, shape: 'arrowUp', pineShape: 'shape.triangleup' })
    expect(tri.shapeApprox).toBe(true)
  })
  it('a hand-authored marker is never touched', () => {
    const m = { shape: 'circle', position: 'belowBar' }
    expect(canvasMarkerRecord(m, true)).toBe(m)
  })
  it('reads the gate by default', () => {
    expect(canvasMarkerRecord(tri)).toBe(tri)
    vi.stubEnv(FLAG, '1')
    expect(canvasMarkerRecord(tri).geometryApprox).toBe(true)
  })
})

function fakeHost(name) {
  const calls = []
  return {
    name, calls,
    attachPrimitive: (p) => calls.push(['attach', p]),
    detachPrimitive: (p) => calls.push(['detach', p]),
    priceToCoordinate: (p) => 500 - p,
    data: () => [{ time: 10, high: 105, low: 95 }],
  }
}

/** The binder's attach / detach (`binder.js` hands these to the registry). */
const HOOKS = {
  attach: (host, primitive) => host.attachPrimitive(primitive),
  detach: (host, primitive) => host.detachPrimitive(primitive),
}

describe('e99 — one primitive per pane', () => {
  it('⛔ without the binder\'s hooks nothing is attached', () => {
    const a = fakeHost('a')
    createMarkerCanvasRegistry().layerFor({ host: a, paneIndex: 0 }).set([], { pineShape: 'shape.flag' })
    expect(a.calls).toEqual([])
  })
  it('two plots in one pane share one primitive; another pane gets its own', () => {
    const reg = createMarkerCanvasRegistry(HOOKS)
    const a = fakeHost('a')
    const b = fakeHost('b')
    reg.layerFor({ host: a, paneIndex: 0 }).set([], { pineShape: 'shape.flag' })
    reg.layerFor({ host: a, paneIndex: 0 }).set([], { pineShape: 'shape.cross' })
    reg.layerFor({ host: b, paneIndex: 1 }).set([], { pineShape: 'shape.cross' })
    expect(reg.panes.size).toBe(2)
    expect(a.calls.filter((c) => c[0] === 'attach')).toHaveLength(1)
    expect(b.calls.filter((c) => c[0] === 'attach')).toHaveLength(1)
  })
  it('the primitive stays on the pane\'s first host, moves to a remaining host, and leaves when the pane has no marker plot', () => {
    const reg = createMarkerCanvasRegistry(HOOKS)
    const a = fakeHost('a')
    const b = fakeHost('b')
    const la = reg.layerFor({ host: a, paneIndex: 2 })
    const lb = reg.layerFor({ host: b, paneIndex: 2 })
    la.set([], { pineShape: 'shape.flag' })
    lb.set([], { pineShape: 'shape.flag' })
    expect(a.calls.map((c) => c[0])).toEqual(['attach'])
    expect(b.calls).toEqual([])
    la.clear()
    expect(a.calls.map((c) => c[0])).toEqual(['attach', 'detach'])
    expect(b.calls.map((c) => c[0])).toEqual(['attach'])
    lb.clear()
    expect(b.calls.map((c) => c[0])).toEqual(['attach', 'detach'])
    expect(reg.panes.size).toBe(0)
  })
  it('⭐ the primitive draws every plot of its pane, on its own bar, off the host\'s high', () => {
    const reg = createMarkerCanvasRegistry(HOOKS)
    const a = fakeHost('a')
    reg.layerFor({ host: a, paneIndex: 0 }).set([{ time: 10, color: '#111111', value: 1 }], { pineShape: 'shape.diamond', pineLocation: 'location.abovebar' })
    const prim = a.calls[0][1]
    prim.attached({ chart: { timeScale: () => ({ timeToCoordinate: (t) => t * 2 }) }, requestUpdate: () => {} })
    const ctx = recordingCtx()
    prim.paneViews()[0].renderer().draw({ useMediaCoordinateSpace: (f) => f({ context: ctx, mediaSize: { width: 400, height: 300 } }) })
    const y = 500 - 105 - MARKER_GEOMETRY.barGapPx - sizePxOf({}) / 2
    expect(ctx.ops).toContainEqual(['translate', 20, y])
  })
})

// ─── the binder: off draws LWC markers exactly as before; on, a Pine marker goes to canvas ───
const N = 6
const BARS = Array.from({ length: N }, (_, i) => ({ t: 1700000000 + i * 60, o: 10, h: 11 + i, l: 9 - i, c: 10, v: 1 }))
const COND = Float64Array.from([0, 1, 0, 0, 1, 0])
const pineDef = (marker) => ({
  id: 'm', schemaVersion: 2, label: 'm', inputs: [],
  plots: [{ key: 'buy', label: 'Buy', style: 'markers', color: '#ff9800', legend: { decimals: 2 }, marker }],
})
function harness(def) {
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const PRICE = fakeHost('price')
  const lwc = []
  const run = () => binder.sync({
    enabled: true,
    instances: [{ instanceId: 'inst:m:1', defId: 'm', inputs: {} }],
    registry: {
      getDefinition: () => def,
      computeFor: () => ({ buy: COND }),
      hasAnyFinite: () => true,
      columnKeys: (d) => (d.plots || []).map((p) => p.key),
    },
    bars: BARS,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (series, data) => series.setData(data),
    resolvePlacement: () => ({ paneIndex: 0, scaleId: 'right', scaleOptions: {} }),
    priceSeries: () => PRICE,
    createSeriesMarkers: (series, first) => { lwc.push({ series, first }); return { setMarkers: () => {} } },
  })
  return { run, lwc, PRICE }
}
const TRI = { shape: 'arrowUp', pineShape: 'shape.triangleup', shapeApprox: true, position: 'belowBar', pineLocation: 'location.belowbar' }

describe('e99 — the binder', () => {
  it('⛔ OFF: a Pine marker is drawn by the LWC series markers, and no primitive is attached', () => {
    const h = harness(pineDef(TRI))
    h.run()
    expect(h.lwc).toHaveLength(1)
    expect(h.lwc[0].first.map((m) => m.time)).toEqual([BARS[1].t, BARS[4].t])
    expect(h.lwc[0].first[0]).not.toHaveProperty('value')
    expect(h.PRICE.calls).toEqual([])
  })
  it('⭐ ON: the Pine marker is drawn by the pane\'s canvas primitive, and not by LWC', () => {
    vi.stubEnv(FLAG, '1')
    const h = harness(pineDef(TRI))
    h.run()
    expect(h.lwc).toHaveLength(0)
    expect(h.PRICE.calls.filter((c) => c[0] === 'attach')).toHaveLength(1)
    const prim = h.PRICE.calls[0][1]
    prim.attached({ chart: { timeScale: () => ({ timeToCoordinate: (t) => t - 1700000000 }) }, requestUpdate: () => {} })
    const ctx = recordingCtx()
    prim.paneViews()[0].renderer().draw({ useMediaCoordinateSpace: (f) => f({ context: ctx, mediaSize: { width: 1000, height: 600 } }) })
    const half = sizePxOf(TRI) / 2
    // on the bar's own x, below THAT bar's low (the candles' lows differ bar to bar)
    expect(ctx.ops.filter((o) => o[0] === 'translate')).toEqual([
      ['translate', 60, 500 - BARS[1].l + MARKER_GEOMETRY.barGapPx + half],
      ['translate', 240, 500 - BARS[4].l + MARKER_GEOMETRY.barGapPx + half],
    ])
  })
  it('ON: a hand-authored marker stays on the LWC markers', () => {
    vi.stubEnv(FLAG, '1')
    const h = harness(pineDef({ shape: 'arrowUp', position: 'belowBar' }))
    h.run()
    expect(h.lwc).toHaveLength(1)
    expect(h.PRICE.calls).toEqual([])
  })
})
