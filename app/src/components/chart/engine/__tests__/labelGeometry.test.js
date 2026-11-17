// app/src/components/chart/engine/__tests__/labelGeometry.test.js
//
// ─── ⭐⭐ A LABEL IS DRAWN WHERE, AND AS BIG AS, TRADINGVIEW DRAWS IT (Q-LB1 / Q-LB2, 2026-11-17) ───
//
// The numbers are TradingView's own (`__fixtures__/labelGeometry.tradingview.json`: probe
// vw-lb2-label-geometry.pine on NYSE:RDDT 1D, one capture per size, TradingView's canvas calls traced
// read-only; NUMBERS ONLY). Each rail paints a label the way the probe drew it, with TradingView's own
// text width standing in for ours, and compares what OUR painter drew with what TradingView drew:
// the body (with its pointer), each line's top, a glyph's box. A box edge is held to 1 px and a text
// top to 1.6 px (TradingView snaps both to its pixel grid; we do not).
// ⛔ Boxes, lines and fills are not labels: every call the painter makes for them is byte-identical to
// `objectNonLabel.golden.json` (recorded from master's painter before Q-LB2; re-recorded by Q-LB3, where exactly
// the 192 box-text cases at the measured normal / large / huge sizes moved, and nothing else).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { paintObjects, LABEL_GEOMETRY, GLYPH_BOX } from '../objectCanvas'
import { nonLabelCases, recordNonLabel, shaOf } from './objectNonLabel.cases'

const FIX = (f) => JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/components/chart/engine/__tests__/__fixtures__', f), 'utf8'))
const TV = FIX('labelGeometry.tradingview.json').sizes
const NON_LABEL = FIX('objectNonLabel.golden.json')
const SIZES = ['tiny', 'small', 'normal', 'large', 'huge']
const AX = 100
const AY = 200
const mapping = { timeToX: (t) => t, priceToY: (p) => 500 - p, width: 1000, height: 500 }
const BOX = 1
const TOP = 1.6

/** A canvas that records calls, and answers `measureText` with TradingView's width for the probe's texts. */
function canvas(widths) {
  const calls = []
  const rec = (name) => (...a) => calls.push([name, ...a])
  const ctx = {
    calls,
    save: rec('save'), restore: rec('restore'), beginPath: rec('beginPath'), closePath: rec('closePath'),
    moveTo: rec('moveTo'), lineTo: rec('lineTo'), stroke: rec('stroke'), fill: rec('fill'), arc: rec('arc'),
    fillRect: rec('fillRect'), strokeRect: rec('strokeRect'), fillText: rec('fillText'), strokeText: rec('strokeText'),
    setLineDash: rec('setLineDash'),
    measureText: (s) => ({ width: Object.prototype.hasOwnProperty.call(widths, s) ? widths[s] : s.length * 6 }),
  }
  return ctx
}
function paint(style, size, text, widths = {}) {
  const ctx = canvas(widths)
  paintObjects(ctx, { labels: [{ id: 1, x: AX, y: 500 - AY, yloc: 'price', text, style, size, color: '#f00', textcolor: '#000' }] }, mapping)
  return ctx.calls
}
const tops = (calls) => calls.filter((c) => c[0] === 'fillText').map((c) => ({ t: c[1], x: c[2] - AX, top: c[3] - AY }))
/** The body and its pointer, as one box from the anchor (TradingView's body path holds both). */
function bodyBox(calls) {
  const r = calls.find((c) => c[0] === 'fillRect')
  const xs = [r[1], r[1] + r[3]]
  const ys = [r[2], r[2] + r[4]]
  for (const c of calls) if (c[0] === 'moveTo' || c[0] === 'lineTo') { xs.push(c[1]); ys.push(c[2]) }
  return { x0: Math.min(...xs) - AX, x1: Math.max(...xs) - AX, y0: Math.min(...ys) - AY, y1: Math.max(...ys) - AY }
}
function glyphBox(calls) {
  const xs = []
  const ys = []
  for (const c of calls) {
    if (c[0] === 'fillText') break
    if (c[0] === 'moveTo' || c[0] === 'lineTo') { xs.push(c[1]); ys.push(c[2]) }
    if (c[0] === 'arc') { xs.push(c[1] - c[3], c[1] + c[3]); ys.push(c[2] - c[3], c[2] + c[3]) }
    if (c[0] === 'fillRect') { xs.push(c[1], c[1] + c[3]); ys.push(c[2], c[2] + c[4]) }
  }
  return { x0: Math.min(...xs) - AX, x1: Math.max(...xs) - AX, y0: Math.min(...ys) - AY, y1: Math.max(...ys) - AY }
}
const near = (got, want, tol, what) => {
  for (const k of ['x0', 'x1', 'y0', 'y1']) {
    if (want[k] === undefined || want[k] === null) continue
    expect(Math.abs(got[k] - want[k]), `${what} ${k}: ours ${got[k]}, TradingView ${want[k]}`).toBeLessThanOrEqual(tol)
  }
}

describe('⭐⭐ the font, per size (TradingView: 7.2 / 9.6 / 12 / 18 / 24 px)', () => {
  it.each(SIZES)('%s', (size) => {
    const ctx = canvas({})
    const fonts = []
    const proxy = new Proxy(ctx, { set(t, k, v) { if (k === 'font') fonts.push(v); t[k] = v; return true } })
    paintObjects(proxy, { labels: [{ id: 1, x: AX, y: 300, yloc: 'price', text: 'Sc', style: 'label_center', size }] }, mapping)
    expect(fonts.pop()).toMatch(new RegExp(`(^|\\s)${TV[size].px}px `))
    expect(LABEL_GEOMETRY[size].px).toBe(TV[size].px)
  })
})

describe('⭐⭐ every measured offset is a TOP: the text is drawn with textBaseline \'top\'', () => {
  it.each(['label_center', 'label_up', 'none', 'text_outline', 'circle', 'arrowup'])('%s', (style) => {
    const ctx = canvas({})
    let baseline = null
    const at = []
    const proxy = new Proxy(ctx, {
      set(t, k, v) { if (k === 'textBaseline') baseline = v; t[k] = v; return true },
      get(t, k) { return k === 'fillText' ? (...a) => { at.push(baseline); return t.fillText(...a) } : t[k] },
    })
    paintObjects(proxy, { labels: [{ id: 1, x: AX, y: 300, yloc: 'price', text: 'S\nT', style, size: 'normal', color: '#f00' }] }, mapping)
    expect(at.length, 'no text was drawn').toBe(2)
    expect(at.every((b) => b === 'top'), `${style}: ${at}`).toBe(true)
  })
})

describe('⭐⭐ a body: its size, its pointer, its text (label_center / up / down / left / right)', () => {
  it.each(SIZES)('%s — label_center, one line and two', (size) => {
    const tv = TV[size]
    const c1 = paint('label_center', size, 'Sc', { Sc: tv.center.textW })
    near(bodyBox(c1), tv.center.box, BOX, `${size} center body`)
    expect(Math.abs(tops(c1)[0].top - tv.center.textTop), `${size} center text top`).toBeLessThanOrEqual(TOP)
    const c2 = paint('label_center', size, 'Mc\nNc', { Mc: tv.centerMulti.textW, Nc: tv.centerMulti.textW - 1 })
    near(bodyBox(c2), tv.centerMulti.box, BOX + 0.5, `${size} two-line body`)
    const t = tops(c2)
    expect(Math.abs(t[0].top - tv.centerMulti.textTop), `${size} two-line first top`).toBeLessThanOrEqual(TOP)
    expect(t[1].top - t[0].top, `${size} pitch`).toBeCloseTo(tv.pitch, 5)
  })
  it.each(SIZES)('%s — label_up / label_down: the pointer tip on the anchor, the body beyond it', (size) => {
    const tv = TV[size]
    const u = paint('label_up', size, 'Su', { Su: tv.up.textW })
    near(bodyBox(u), tv.up.box, BOX, `${size} up`)
    expect(Math.abs(tops(u)[0].top - tv.up.textTop), `${size} up text top`).toBeLessThanOrEqual(TOP)
    const d = paint('label_down', size, 'Sd', { Sd: tv.down.textW })
    near(bodyBox(d), tv.down.box, BOX, `${size} down`)
    expect(Math.abs(tops(d)[0].top - tv.down.textTop), `${size} down text top`).toBeLessThanOrEqual(TOP)
  })
  // ⚠️ held to 2 px: at size.huge TradingView's right-pointing body read 2 px wider than its left-pointing
  // one (70 against 68) for a text narrower than the body's minimum; one reading, not a rule to copy
  it.each(SIZES)('%s — label_left / label_right (where the reading is unambiguous)', (size) => {
    const tv = TV[size]
    if (tv.left.box) near(bodyBox(paint('label_left', size, 'Sl', { Sl: tv.left.textW })), tv.left.box, 2, `${size} left`)
    if (tv.right.box) near(bodyBox(paint('label_right', size, 'Sr', { Sr: tv.right.textW })), tv.right.box, 2, `${size} right`)
    expect(tv.left.box || tv.right.box, 'at least one side is read at every size').toBeTruthy()
  })
})

describe('⭐⭐ text without a body', () => {
  it.each(SIZES)('%s — style_none ENDS at the anchor (TradingView: above it); text_outline is centred', (size) => {
    const tv = TV[size]
    expect(Math.abs(tops(paint('none', size, 'Sn'))[0].top - tv.none.textTop)).toBeLessThanOrEqual(TOP)
    expect(Math.abs(tops(paint('none', size, 'Mn\nNn'))[0].top - tv.none.multiTextTop)).toBeLessThanOrEqual(TOP)
    expect(Math.abs(tops(paint('text_outline', size, 'So'))[0].top - tv.outline.textTop)).toBeLessThanOrEqual(TOP)
    expect(Math.abs(tops(paint('text_outline', size, 'Mo\nNo'))[0].top - tv.outline.multiTextTop)).toBeLessThanOrEqual(TOP)
  })
})

describe('⭐⭐ a glyph: its box, and its text ABOVE it whichever way it points', () => {
  const GLYPHS = { ci: 'circle', sq: 'square', di: 'diamond', tu: 'triangleup', td: 'triangledown', au: 'arrowup',
    ad: 'arrowdown', xx: 'xcross', cr: 'cross', fl: 'flag' }
  it.each(SIZES)('%s — every glyph style\'s text, one line and two', (size) => {
    const tv = TV[size]
    for (const [code, style] of Object.entries(GLYPHS)) {
      expect(Math.abs(tops(paint(style, size, 'S' + code))[0].top - tv.glyphText[code]), `${size} ${style}`).toBeLessThanOrEqual(TOP)
      expect(Math.abs(tops(paint(style, size, `M${code}\nN${code}`))[0].top - tv.glyphTextMulti[code]), `${size} ${style} two lines`)
        .toBeLessThanOrEqual(TOP)
    }
  })
  it.each(SIZES)('%s — the measured glyphs\' boxes (circle, square, diamond, triangles, flag)', (size) => {
    const tv = TV[size]
    for (const [code, style] of Object.entries({ ci: 'circle', sq: 'square', di: 'diamond', tu: 'triangleup', td: 'triangledown', fl: 'flag' })) {
      const want = tv.glyphBox[code]
      const got = glyphBox(paint(style, size, ''))
      near(got, { x0: -(want.x1 - want.x0) / 2, x1: (want.x1 - want.x0) / 2, y0: want.y0, y1: want.y1 }, BOX, `${size} ${style}`)
      expect(GLYPH_BOX[style][size].slice(0, 2)).toEqual([want.x1 - want.x0, want.y1 - want.y0])
    }
  })
  it('⭐ RS Rating\'s dots: a size.tiny circle is 18 px across (TradingView), not 6', () => {
    const got = glyphBox(paint('circle', 'tiny', ''))
    expect(got.x1 - got.x0).toBe(18)
  })
})

describe('⭐⭐ RS Rating\'s own pair, at TradingView\'s distance', () => {
  it('the rating\'s top is 19 px below the title\'s (TradingView, captured on RDDT and on the probe)', () => {
    const title = tops(paint('label_center', 'normal', '                RS Rating'))[0]
    const rating = tops(paint('label_center', 'large', '\n\n       99'))
    expect(rating).toHaveLength(1)
    expect(Math.abs((rating[0].top - title.top) - 19)).toBeLessThanOrEqual(TOP)
  })
})

describe('⛔ NOT A LABEL: boxes, lines and fills are byte-identical to their golden (box text moved only by Q-LB3)', () => {
  it('every case of the matrix hashes to the golden', () => {
    const cases = nonLabelCases()
    expect(cases.length).toBe(NON_LABEL.cases)
    const moved = cases.filter((c) => shaOf(recordNonLabel(c.state)) !== NON_LABEL.hashes[c.key]).map((c) => c.key)
    expect(moved).toEqual([])
  })
  it('⭐ CONTROL — the golden can fail: a moved box changes its hash', () => {
    const c = nonLabelCases()[1]
    const moved = { boxes: [{ ...c.state.boxes[0], left: c.state.boxes[0].left + 1 }] }
    expect(shaOf(recordNonLabel(moved))).not.toBe(NON_LABEL.hashes[c.key])
  })
})
