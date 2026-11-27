// app/src/components/chart/engine/__tests__/markerCanvas.test.js
//
// ─── e99 — PINE MARKERS ON CANVAS: THE SHAPE, THE PLACE AND THE SIZE, AS MEASURED ──
//
// `markerCanvas.js` draws each `plotshape` style as its own glyph (TradingView
// substitutes none: FRED RS, AMEX:SPY 1D captures 2026-11-26) at the author's
// location, through one series primitive per pane, behind a gate that is OFF.
//
// ⭐ THE GEOMETRY RAILS ARE DRIVEN BY THE MEASUREMENT. FRED RS's run
// `markers-2026-11-26` measured TradingView's markers (light theme, DPR 1, 90 px bar
// spacing); its derived numbers are committed as
// `tests/fixtures/vendor/tv-marker-geometry-spy-1d-2026-11-26.json` (no screenshot is
// committed). Every measured cell — each shape's box at each size word, its near-edge
// gap at abovebar / belowbar / top / bottom, its centre at `location.absolute` (rows
// a candle did not clip), the arrows' width and `size.auto` at each bar spacing — is
// laid out here by `layoutMarkers` and held within the fixture's tolerance. A control
// moves the layout by more than the tolerance and every cell misses.
// What is NOT measured (text, a `plotchar`'s character size, a triangle's anchor at
// `location.absolute`) is held to be NAMED approximate, not to a number.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {
  GLYPHS, MARKER_GEOMETRY, glyphOf, locationOf, placeY, layoutMarkers, paintMarkers,
  canvasMarkerRecord, createMarkerCanvasRegistry, sizePxOf, boxOf, scaleMarginsOf, unmeasuredGeometryOf,
} from '../markerCanvas'
import { markerCanvasEnabled } from '../markerCanvasGate'
import { createBinder } from '../binder'
import { createFakeChart } from './fakeChart'

const FLAG = 'VITE_PINE_MARKER_CANVAS_ENABLED'
afterEach(() => { vi.unstubAllEnvs() })

const FX = JSON.parse(fs.readFileSync(
  path.resolve(process.cwd(), '../tests/fixtures/vendor/tv-marker-geometry-spy-1d-2026-11-26.json'), 'utf8'))
const TOL = FX.tolerancePx

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
      fn(ctx, 10, 10, 'x')
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
    expect(GLYPHS.char(ctx, 12, 12, 'B')).toBe('text')
    expect(ctx.ops.find((o) => o[0] === 'fillText')).toEqual(['fillText', 'B', 0, 0])
  })

  it('the cross and the xcross are strokes of the measured widths (2 px, about 2.4 px)', () => {
    for (const [name, px] of [['shape.cross', 2], ['shape.xcross', 2.4]]) {
      const ctx = recordingCtx()
      expect(GLYPHS[name](ctx, 27, 27)).toBe('stroke')
      expect(ctx.ops).toContainEqual(['=lineWidth', px])
    }
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
  const margins = { top: 0.3, bottom: 0.15 }
  const at = { high: 110, low: 90, value: 50, paneHeight: 1000, toY, size: 20, margins }
  const d = MARKER_GEOMETRY.anchorDistance.perSize * 20 - MARKER_GEOMETRY.anchorDistance.lessPx
  it('⭐ abovebar sits above the bar\'s HIGH', () => {
    expect(placeY('location.abovebar', at)).toBe(toY(110) - d)
  })
  it('⭐ belowbar sits below the bar\'s LOW', () => {
    expect(placeY('location.belowbar', at)).toBe(toY(90) + d)
  })
  it('⭐ top and bottom are measured from the price scale\'s margin lines, inside them, not from the pane\'s edges', () => {
    expect(placeY('location.top', at)).toBe(300 + d)
    expect(placeY('location.bottom', at)).toBe(850 - d)
  })
  it('⭐ absolute is priceToCoordinate(the plotted value), exactly', () => {
    expect(placeY('location.absolute', at)).toBe(toY(50))
  })
  it('no price, no place', () => {
    expect(placeY('location.absolute', { ...at, value: NaN })).toBeNull()
    expect(placeY('location.abovebar', { ...at, toY: () => null })).toBeNull()
  })
  it('the margins are the host\'s price scale\'s; LWC\'s default when it does not say', () => {
    expect(scaleMarginsOf({ priceScale: () => ({ options: () => ({ scaleMargins: { top: 0.25, bottom: 0.1 } }) }) }))
      .toEqual({ top: 0.25, bottom: 0.1 })
    expect(scaleMarginsOf({})).toEqual(MARKER_GEOMETRY.fallback.scaleMargins)
  })
})

// ─── the measurement, laid out ───────────────────────────────────────────────
const SIZE_WORDS = ['tiny', 'small', 'normal', 'large', 'huge']
const PANE = FX.pane
// the measured pane: 891 px tall, scale margins 25 % / 10 %; high 110 → y 400, low 90 → y 600, value v → 1500 - 10 v
const HOST = {
  priceToCoordinate: (p) => 1500 - p * 10,
  priceScale: () => ({ options: () => ({ scaleMargins: { ...PANE.scaleMargins } }) }),
}
const Y_HIGH = HOST.priceToCoordinate(110)
const Y_LOW = HOST.priceToCoordinate(90)

/** The one entry `layoutMarkers` gives a single marker on one bar. */
function laidOut(marker, { barSpacing = PANE.barSpacing, value = 100, text = '' } = {}) {
  const out = layoutMarkers([{ marker, host: HOST, items: [{ time: 1, color: '#2962FF', text, value, high: 110, low: 90 }] }],
    { timeToCoordinate: () => 500, paneHeight: PANE.height, paneWidth: 1601, barSpacing })
  expect(out).toHaveLength(1)
  return out[0]
}
const LOC_WORDS = { abovebar: 'location.abovebar', belowbar: 'location.belowbar', top: 'location.top', bottom: 'location.bottom' }
/** The near-edge gap as the measurement defines it (`FX.nearEdgeGapNote`). */
const gapOf = (loc, m) => ({
  abovebar: () => Y_HIGH - (m.y + m.h * 0.5),
  belowbar: () => (m.y - m.h * 0.5) - Y_LOW,
  top: () => (m.y - m.h * 0.5) - PANE.marginTopY,
  bottom: () => PANE.marginBottomY - (m.y + m.h * 0.5),
}[loc]())

/** Every measured near-edge gap the layout misses by more than the tolerance (`shiftPx` moves every glyph: the control). */
function gapMisses(shiftPx = 0) {
  const misses = []
  let checked = 0
  for (const [loc, shapes] of Object.entries(FX.nearEdgeGap)) {
    for (const [shape, bySize] of Object.entries(shapes)) {
      for (const [sz, measured] of Object.entries(bySize)) {
        const m = laidOut({ pineShape: `shape.${shape}`, pineLocation: LOC_WORDS[loc], pineSize: `size.${sz}` })
        const got = gapOf(loc, { ...m, y: m.y + shiftPx })
        checked += 1
        if (Math.abs(got - measured) > TOL) misses.push(`${loc}/${shape}/${sz}: measured ${measured}, drawn ${got.toFixed(2)}`)
      }
    }
  }
  return { misses, checked }
}

describe('e99 — the geometry is TradingView\'s, as measured (run markers-2026-11-26)', () => {
  it('the fixture names its run and holds derived numbers only', () => {
    expect(FX.source.run).toBe('markers-2026-11-26')
    expect(MARKER_GEOMETRY.source).toContain(FX.source.run)
    expect(TOL).toBe(2)
  })

  it('⭐ every measured box (shape x size word) is drawn within the tolerance', () => {
    const misses = []
    let checked = 0
    for (const [shape, bySize] of Object.entries(FX.box)) {
      for (const [sz, [w, h]] of Object.entries(bySize)) {
        const m = laidOut({ pineShape: `shape.${shape}`, pineLocation: 'location.abovebar', pineSize: `size.${sz}` })
        checked += 1
        if (Math.abs(m.w - w) > TOL || Math.abs(m.h - h) > TOL) misses.push(`${shape}/${sz}: measured ${w}x${h}, drawn ${m.w.toFixed(2)}x${m.h.toFixed(2)}`)
      }
    }
    expect(misses).toEqual([])
    expect(checked).toBe(60)
  })

  it('⭐ every measured near-edge gap (abovebar, belowbar, top, bottom) is drawn within the tolerance', () => {
    const { misses, checked } = gapMisses()
    expect(misses).toEqual([])
    expect(checked).toBeGreaterThan(230)
  })

  it('control: a layout moved by more than the tolerance misses every gap', () => {
    const { misses, checked } = gapMisses(TOL + 2)
    // every cell on the side the shift moves away from, and every cell on the other side by more than a tolerance
    expect(misses.length).toBe(checked)
  })

  it('⭐ at location.absolute the plotted value is the glyph\'s centre, and a label\'s pointer TIP', () => {
    const misses = []
    let checked = 0
    for (const [shape, bySize] of Object.entries(FX.absoluteCentreMinusValue)) {
      for (const [sz, measured] of Object.entries(bySize)) {
        const m = laidOut({ pineShape: `shape.${shape}`, pineLocation: 'location.absolute', pineSize: `size.${sz}` }, { value: 100 })
        const got = m.y - HOST.priceToCoordinate(100)
        checked += 1
        if (Math.abs(got - measured) > TOL) misses.push(`${shape}/${sz}: measured ${measured}, drawn ${got.toFixed(2)}`)
      }
    }
    expect(misses).toEqual([])
    expect(checked).toBeGreaterThan(20)
    // the label's tip, exactly: labelup's top edge and labeldown's bottom edge ARE the value's y
    const up = laidOut({ pineShape: 'shape.labelup', pineLocation: 'location.absolute', pineSize: 'size.normal' })
    const down = laidOut({ pineShape: 'shape.labeldown', pineLocation: 'location.absolute', pineSize: 'size.normal' })
    expect(up.y - up.h * 0.5).toBeCloseTo(HOST.priceToCoordinate(100), 9)
    expect(down.y + down.h * 0.5).toBeCloseTo(HOST.priceToCoordinate(100), 9)
  })

  it('⭐ the arrow width follows the bar spacing (about half), its height the size word', () => {
    for (const [spacing, width] of FX.barSpacing.arrowWidth) {
      for (const shape of ['shape.arrowup', 'shape.arrowdown']) {
        const m = laidOut({ pineShape: shape, pineLocation: 'location.abovebar', pineSize: 'size.large' }, { barSpacing: spacing })
        expect(Math.abs(m.w - width), `${shape} at ${spacing}: ${m.w}`).toBeLessThanOrEqual(TOL)
        expect(Math.abs(m.h - FX.box.arrowup.large[1])).toBeLessThanOrEqual(TOL)
      }
    }
  })

  it('⭐ size.auto (and an unwritten size: Pine\'s default) follows the bar spacing', () => {
    expect(FX.defaults.plotshape.size).toBe('size.auto')
    for (const [spacing, edge] of FX.barSpacing.autoBox) {
      for (const marker of [{ pineShape: 'shape.xcross', pineSize: 'size.auto' }, { pineShape: 'shape.xcross' }]) {
        const m = laidOut(marker, { barSpacing: spacing })
        expect(Math.abs(m.w - edge), `${JSON.stringify(marker)} at ${spacing}: ${m.w}`).toBeLessThanOrEqual(TOL)
        expect(Math.abs(m.h - edge)).toBeLessThanOrEqual(TOL)
      }
    }
    // a fixed size word does NOT follow the spacing (measured at 90, 17.2 and 8.7 px)
    expect(laidOut({ pineShape: 'shape.square', pineSize: 'size.tiny' }, { barSpacing: 8.73 }).w)
      .toBe(laidOut({ pineShape: 'shape.square', pineSize: 'size.tiny' }, { barSpacing: 90 }).w)
  })

  it('the default plotshape (xcross, abovebar, size.auto) sits where the measurement put it', () => {
    // k0: `plotshape(cond)` 46x46 at 90 spacing, its bottom 44.8 px above the high
    const m = laidOut({ pineShape: FX.defaults.plotshape.shape, pineLocation: FX.defaults.plotshape.location })
    expect(Math.abs(gapOf('abovebar', m) - 44.8)).toBeLessThanOrEqual(TOL)
  })
})

describe('e99 — no stacking, the last declared on top', () => {
  const at = { time: 1, color: '#111111', text: '', value: 100, high: 110, low: 90 }
  const g = (pineShape, color, order) => ({ marker: { pineShape, pineLocation: 'location.abovebar', pineSize: 'size.small' }, host: HOST, items: [{ ...at, color }], order })
  it('⭐ a marker\'s place never depends on another on its bar', () => {
    const alone = layoutMarkers([g('shape.square', '#a', 0)], { timeToCoordinate: () => 5, paneHeight: 891 })
    const both = layoutMarkers([g('shape.circle', '#b', 0), g('shape.square', '#a', 1)], { timeToCoordinate: () => 5, paneHeight: 891 })
    expect(both[1].y).toBe(alone[0].y)
  })
  it('⭐ the last declared plot is painted last (on top), whatever order the layers were made in', () => {
    const out = layoutMarkers([g('shape.square', '#later', 2), g('shape.circle', '#earlier', 1)], { timeToCoordinate: () => 5, paneHeight: 891 })
    expect(out.map((m) => m.color)).toEqual(['#earlier', '#later'])
  })
})

describe('e99 — text', () => {
  const item = { time: 1, color: '#ff0000', text: 'Dn', value: 100, high: 110, low: 90 }
  const paintOne = (marker) => {
    const [m] = layoutMarkers([{ marker, host: HOST, items: [item] }], { timeToCoordinate: () => 5, paneHeight: 891, barSpacing: 90 })
    const ctx = recordingCtx()
    paintMarkers(ctx, [m])
    return { m, ctx }
  }
  it('⭐ a triangle\'s text is in the marker colour when no text colour is given', () => {
    const { ctx } = paintOne({ pineShape: 'shape.triangledown', pineLocation: 'location.abovebar', pineSize: 'size.small' })
    const fills = ctx.ops.filter((o) => o[0] === '=fillStyle').map((o) => o[1])
    expect(fills).toEqual(['#ff0000', '#ff0000'])
  })
  it('⭐ above the bar the text sits about 13 px above the shape; below it, about 11 px below (one triangle measured)', () => {
    const above = paintOne({ pineShape: 'shape.triangledown', pineLocation: 'location.abovebar', pineSize: 'size.small' })
    const tA = above.ctx.ops.find((o) => o[0] === 'fillText')
    expect(tA[3]).toBeCloseTo(-above.m.h * 0.5 - FX.text.triangleSmallTextGapAbovePx, 3)
    const below = paintOne({ pineShape: 'shape.triangleup', pineLocation: 'location.belowbar', pineSize: 'size.small' })
    const tB = below.ctx.ops.find((o) => o[0] === 'fillText')
    expect(tB[3] - FX.text.textCapPx).toBeCloseTo(below.m.h * 0.5 + FX.text.triangleSmallTextGapBelowPx, 3)
  })
  it('a label grows around its text and keeps its tip on the anchor', () => {
    const plain = laidOut({ pineShape: 'shape.labeldown', pineLocation: 'location.absolute', pineSize: 'size.normal' })
    const grown = laidOut({ pineShape: 'shape.labeldown', pineLocation: 'location.absolute', pineSize: 'size.normal' }, { text: 'Ab' })
    expect(grown.w).toBeGreaterThan(plain.w)
    expect(Math.abs(grown.w - FX.text.labelNormalWithTextAb[0])).toBeLessThanOrEqual(TOL)
    expect(Math.abs(grown.h - FX.text.labelNormalWithTextAb[1])).toBeLessThanOrEqual(TOL)
    expect(grown.y + grown.h * 0.5).toBeCloseTo(plain.y + plain.h * 0.5, 9)
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
  it('⭐ x is timeToCoordinate(bar time) exactly; a bar off the scale draws nothing; abovebar sits above the bar\'s high', () => {
    const marker = { shape: 'arrowUp', pineShape: 'shape.triangleup', position: 'aboveBar' }
    const out = layoutMarkers([{ marker, host, items }], { timeToCoordinate: tx, paneHeight: 800 })
    expect(out.map((m) => m.x)).toEqual([307, 607])
    expect(out.map((m) => m.glyph)).toEqual(['shape.triangleup', 'shape.triangleup'])
    const s = sizePxOf(marker, NaN)
    const box = boxOf('shape.triangleup', s, NaN)
    const anchorY = 1000 - 110 - (MARKER_GEOMETRY.anchorDistance.perSize * s - MARKER_GEOMETRY.anchorDistance.lessPx)
    expect(out[0].y).toBeCloseTo(anchorY - box.anchor * box.h + box.h * 0.5, 9)
  })
  it('text takes the record\'s textColor, and the size word picks the box', () => {
    const [m] = layoutMarkers([{ marker: { shape: 'square', pineShape: 'shape.flag', pineSize: 'size.huge', textColor: '#2962FF' }, host, items: [items[0]] }],
      { timeToCoordinate: tx, paneHeight: 800 })
    expect(m).toMatchObject({ text: 'B', textColor: '#2962FF', w: MARKER_GEOMETRY.sizePx['size.huge'], textAbove: true })
  })
  it('a hand-authored marker is not laid out here', () => {
    expect(layoutMarkers([{ marker: { shape: 'circle' }, host, items }], { timeToCoordinate: tx, paneHeight: 800 })).toEqual([])
  })
  it('paint draws the glyph at (x, y) in the item colour', () => {
    const ctx = recordingCtx()
    paintMarkers(ctx, [{ glyph: 'shape.diamond', x: 5, y: 6, w: 10, h: 10, color: '#abcdef', text: '', char: '', textColor: '#000000', textAbove: true }])
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
  const code = stripComments(src.replace(/\r\n/g, '\n'))
  const start = code.indexOf('export const MARKER_GEOMETRY = Object.freeze({')
  const end = start < 0 ? -1 : code.indexOf('\n})', start)
  const outside = start < 0 ? code : code.slice(0, start) + code.slice(end + 3)
  const noStrings = outside.replace(/'[^'\n]*'/g, "''").replace(/`[^`\n]*`/g, '``')
  return [...noStrings.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g)].map((m) => m[1])
    .filter((n) => !['0', '1', '2', '0.5'].includes(n))
}

describe('e99 — ONE geometry table', () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), 'src/components/chart/engine/markerCanvas.js'), 'utf8')
  it('control: a stray number outside the table is found, one inside is not', () => {
    const fake = 'const a = 3\nexport const MARKER_GEOMETRY = Object.freeze({\n  b: 7,\n})\nconst c = 0.5 * 2 // 9\n'
    expect(strayNumbers(fake)).toEqual(['3'])
  })
  it('⛔ markerCanvas.js holds no geometry number outside MARKER_GEOMETRY', () => {
    expect(strayNumbers(src)).toEqual([])
  })
  it('the table names its source run and what it does not pin', () => {
    expect(MARKER_GEOMETRY).not.toHaveProperty('provisional')
    expect([...MARKER_GEOMETRY.unmeasured].sort()).toEqual(['absoluteTriangle', 'char', 'text'])
    expect(Object.keys(MARKER_GEOMETRY.sizePx)).toEqual(['size.tiny', 'size.small', 'size.normal', 'size.large', 'size.huge'])
    expect(Object.keys(MARKER_GEOMETRY.box).sort()).toEqual([...PINE_SHAPES, 'char'].sort())
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
  it('⭐ ON: no shape or pane-edge substitution, and a pinned marker is not geometryApprox', () => {
    const r = canvasMarkerRecord({ ...tri, geometryApprox: true }, true)
    expect(r).toMatchObject({ shapeApprox: false, positionApprox: false, shape: 'arrowUp', pineShape: 'shape.triangleup' })
    expect(r).not.toHaveProperty('geometryApprox')
    expect(tri.shapeApprox).toBe(true)
  })
  it('⭐ ON: geometryApprox for an unmeasured fact, and each fact named', () => {
    const text = { ...tri, text: 'Up' }
    const absTri = { ...tri, pineLocation: 'location.absolute', position: 'inBar', positionApprox: undefined }
    const char = { shape: 'circle', pineShape: null, text: '★', shapeApprox: true, pineLocation: 'location.abovebar' }
    expect(canvasMarkerRecord(text, true).geometryApprox).toBe(true)
    expect(canvasMarkerRecord(absTri, true).geometryApprox).toBe(true)
    expect(canvasMarkerRecord(char, true).geometryApprox).toBe(true)
    expect(unmeasuredGeometryOf(text)).toEqual(['text'])
    expect(unmeasuredGeometryOf(absTri)).toEqual(['absoluteTriangle'])
    expect(unmeasuredGeometryOf(char)).toEqual(['char'])
    expect(unmeasuredGeometryOf({ pineShape: 'shape.square', pineLocation: 'location.absolute' })).toEqual([])
    expect(unmeasuredGeometryOf({ shape: 'circle' })).toEqual([])
  })
  it('a hand-authored marker is never touched', () => {
    const m = { shape: 'circle', position: 'belowBar' }
    expect(canvasMarkerRecord(m, true)).toBe(m)
  })
  it('reads the gate by default', () => {
    expect(canvasMarkerRecord(tri)).toBe(tri)
    vi.stubEnv(FLAG, '1')
    expect(canvasMarkerRecord(tri).shapeApprox).toBe(false)
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
const drawPane = (prim, { width = 400, height = 300 } = {}) => {
  const ctx = recordingCtx()
  prim.paneViews()[0].renderer().drawBackground({ useMediaCoordinateSpace: (f) => f({ context: ctx, mediaSize: { width, height } }) })
  return ctx
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
    const marker = { pineShape: 'shape.diamond', pineLocation: 'location.abovebar', pineSize: 'size.normal' }
    reg.layerFor({ host: a, paneIndex: 0 }).set([{ time: 10, color: '#111111', value: 1 }], marker)
    const prim = a.calls[0][1]
    prim.attached({ chart: { timeScale: () => ({ timeToCoordinate: (t) => t * 2 }) }, requestUpdate: () => {} })
    const s = MARKER_GEOMETRY.sizePx['size.normal']
    const y = 500 - 105 - (MARKER_GEOMETRY.anchorDistance.perSize * s - MARKER_GEOMETRY.anchorDistance.lessPx)
    expect(drawPane(prim).ops).toContainEqual(['translate', 20, y])
  })
  it('⭐ the candles paint over the markers: the view is LWC\'s normal layer and draws only in its background pass', () => {
    const reg = createMarkerCanvasRegistry(HOOKS)
    const a = fakeHost('a')
    reg.layerFor({ host: a, paneIndex: 0 }).set([], { pineShape: 'shape.flag' })
    const view = a.calls[0][1].paneViews()[0]
    expect(view.zOrder()).toBe('normal')
    expect(typeof view.renderer().drawBackground).toBe('function')
    expect(view.renderer().draw).toBeUndefined()
  })
  it('⭐ the time scale\'s bar spacing reaches the layout (an arrow is half of it wide)', () => {
    const reg = createMarkerCanvasRegistry(HOOKS)
    const a = fakeHost('a')
    reg.layerFor({ host: a, paneIndex: 0 }).set([{ time: 10, color: '#111111', value: 1 }],
      { pineShape: 'shape.arrowup', pineLocation: 'location.abovebar', pineSize: 'size.large' })
    const prim = a.calls[0][1]
    prim.attached({ chart: { timeScale: () => ({ timeToCoordinate: (t) => t * 2, options: () => ({ barSpacing: 90 }) }) } })
    const head = drawPane(prim).ops.filter((o) => o[0] === 'lineTo').map((o) => o[1])
    expect(Math.max(...head)).toBeCloseTo(MARKER_GEOMETRY.box['shape.arrowup'].wPerBarSpacing * 90 * 0.5, 6)
  })
  it('⭐ the pane paints its plots in declaration order, the later layer made first', () => {
    const reg = createMarkerCanvasRegistry(HOOKS)
    const a = fakeHost('a')
    const later = reg.layerFor({ host: a, paneIndex: 0, order: 5 })
    const earlier = reg.layerFor({ host: a, paneIndex: 0, order: 1 })
    later.set([{ time: 10, color: '#later', value: 1 }], { pineShape: 'shape.square', pineLocation: 'location.abovebar' })
    earlier.set([{ time: 10, color: '#earlier', value: 1 }], { pineShape: 'shape.circle', pineLocation: 'location.abovebar' })
    const prim = a.calls[0][1]
    prim.attached({ chart: { timeScale: () => ({ timeToCoordinate: (t) => t * 2 }) } })
    const fills = drawPane(prim).ops.filter((o) => o[0] === '=fillStyle').map((o) => o[1])
    expect(fills).toEqual(['#earlier', '#later'])
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
    const ctx = drawPane(prim, { width: 1000, height: 600 })
    const s = sizePxOf(TRI, NaN)
    const box = boxOf('shape.triangleup', s, NaN)
    const d = MARKER_GEOMETRY.anchorDistance.perSize * s - MARKER_GEOMETRY.anchorDistance.lessPx
    const centre = (low) => 500 - low + d - box.anchor * box.h + box.h * 0.5
    // on the bar's own x, below THAT bar's low (the candles' lows differ bar to bar)
    const tr = ctx.ops.filter((o) => o[0] === 'translate')
    expect(tr.map((o) => o[1])).toEqual([60, 240])
    expect(tr[0][2]).toBeCloseTo(centre(BARS[1].l), 2)
    expect(tr[1][2]).toBeCloseTo(centre(BARS[4].l), 2)
  })
  it('ON: a hand-authored marker stays on the LWC markers', () => {
    vi.stubEnv(FLAG, '1')
    const h = harness(pineDef({ shape: 'arrowUp', position: 'belowBar' }))
    h.run()
    expect(h.lwc).toHaveLength(1)
    expect(h.PRICE.calls).toEqual([])
  })
})
