// app/src/components/chart/engine/__tests__/labelMultiline.test.js
//
// ─── ⭐⭐ A LABEL'S TEXT IS ONE LINE PER `\n` (2026-11-17) ───────────────────────────────────
//
// ⚰️ `paintObjects` drew a label's text with ONE `fillText`, and a canvas ignores `\n`. RS Rating's
// rating is `'\n\n       ' + rating`, written to sit two lines below its "RS Rating" label at the
// same anchor; we drew it ON that line. Every label path now breaks at `\n` a PITCH apart (measured on
// TradingView, Q-LB2: `LABEL_GEOMETRY`), never paints an empty line, and keeps an empty line's height.
// The pixels themselves are held to TradingView's in `labelGeometry.test.js`; this file holds the
// STRUCTURE of a multi-line label, and the single-line matrix against its golden.
//
// ⭐ THE GOLDEN WAS RE-RECORDED with Q-LB2 (coordinator ruling 2026-11-17: TradingView's measured label
// geometry wins over the earlier "single-line labels byte-identical" condition, for LABELS only).
// Every group moved, and each traces to a measured number (the PR's per-group report). From here it is
// byte-identical again: a label that moves now moves on purpose.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { paintObjects, LABEL_GEOMETRY } from '../objectCanvas'
import { singleLineCases, recordOf, shaOf, recordingCanvas, mapping } from './labelSingleLine.cases'

const GOLDEN = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), 'src/components/chart/engine/__tests__/__fixtures__/labelSingleLine.golden.json'), 'utf8'))

const paint = (labels) => {
  const { ctx, log } = recordingCanvas()
  paintObjects(ctx, { labels }, mapping)
  return log
}
const texts = (log, name = 'fillText') => log.filter((c) => c[0] === name).map((c) => ({ t: c[1], x: c[2], y: c[3] }))
const rect = (log) => { const r = log.find((c) => c[0] === 'fillRect'); return r && { x: r[1], y: r[2], w: r[3], h: r[4] } }
// anchor (100, 200) on screen; text y is each line's TOP
const label = (style, text, extra = {}) => ({ id: 1, x: 100, y: 300, yloc: 'price', text, style,
  color: '#f00', textcolor: '#fff', size: 'normal', ...extra })
const G = LABEL_GEOMETRY

describe('⛔ a label with no \\n is painted exactly as the golden says (every call and state write)', () => {
  const cases = singleLineCases()
  it('the matrix is the one the golden was recorded over', () => {
    expect(cases.length).toBe(GOLDEN.cases)
    expect(cases.every((c) => !c.label.text.includes('\n'))).toBe(true)
  })
  it('each style × size group hashes to the golden', () => {
    const groups = {}
    for (const c of cases) {
      const [style, size] = c.key.split('|')
      const g = `${style}|${size}`
      groups[g] = (groups[g] || '') + c.key + '\n' + recordOf(c.label) + '\n'
    }
    const drift = Object.keys(GOLDEN.groups).filter((g) => shaOf(groups[g] || '') !== GOLDEN.groups[g])
    expect(drift, 'single-line labels changed').toEqual([])
    expect(Object.keys(groups).sort()).toEqual(Object.keys(GOLDEN.groups).sort())
  })
  it('⭐ CONTROL — the golden can fail: a one-pixel move in one case changes its group', () => {
    const c = singleLineCases().find((k) => k.key.startsWith('label_center|normal|left|"S"'))
    expect(shaOf(recordOf({ ...c.label, x: c.label.x + 1 }))).not.toBe(shaOf(recordOf(c.label)))
  })
})

describe('⭐⭐ RS Rating: the rating sits two lines below "RS Rating", as its script writes it', () => {
  const title = label('label_center', '                RS Rating', { color: '#00000000', textalign: 'left' })
  const rating = label('label_center', '\n\n       99', { color: '#00000000', textalign: 'left', size: 'large', id: 2 })

  it('the two empty lines are not painted; the rating is ONE fillText, a large pitch below the block\'s centre', () => {
    const t = texts(paint([rating]))
    expect(t.map((c) => c.t)).toEqual(['       99'])
    expect(t[0].y).toBeCloseTo(200 + G.large.centredTop + G.large.pitch, 6)
  })

  it('⚰️ the defect: it was drawn on the title\'s line; it is now below it', () => {
    const [titleLine] = texts(paint([title]))
    const [ratingLine] = texts(paint([rating]))
    expect(ratingLine.y).toBeGreaterThan(titleLine.y + G.normal.px)
  })

  it('the body is a large body plus two pitches tall; left-aligned lines share one x', () => {
    expect(rect(paint([rating])).h).toBeCloseTo(G.large.bodyH + 2 * G.large.pitch, 6)
    const log = paint([label('label_center', 'ab\nabcdef', { textalign: 'left' })])
    const t = texts(log)
    expect(t[0].x).toBe(t[1].x)
    expect(rect(log).w).toBeCloseTo(Math.max('abcdef'.length * 6 + G.normal.padW, G.normal.minW), 6)
  })
})

describe('⭐ every label path breaks at \\n, a pitch apart', () => {
  it('label body: the block is centred in the body', () => {
    const t = texts(paint([label('label_center', 'a\nb')]))
    expect(t.map((c) => c.t)).toEqual(['a', 'b'])
    expect(t[1].y - t[0].y).toBe(G.normal.pitch)
    expect(t[0].y).toBeCloseTo(200 + G.normal.centredTop - G.normal.pitch / 2, 6)
  })

  it('label_down: the taller body still ends at the pointer, ABOVE its anchor', () => {
    const log = paint([label('label_down', 'a\nb\nc')])
    const r = rect(log)
    expect(r.y + r.h).toBeLessThanOrEqual(200)
    for (const c of texts(log)) { expect(c.y).toBeGreaterThan(r.y); expect(c.y).toBeLessThan(r.y + r.h) }
  })

  it('style none: the block ENDS at the anchor (its last line\'s top at noneTop)', () => {
    const t = texts(paint([label('none', 'a\nb')]))
    expect(t.map((c) => [c.t, c.y])).toEqual([['a', 200 + G.normal.noneTop - G.normal.pitch], ['b', 200 + G.normal.noneTop]])
  })

  it('text_outline: each line ringed, then filled, at the same place, the block centred', () => {
    const log = paint([label('text_outline', 'a\nb')])
    const s = texts(log, 'strokeText')
    const f = texts(log)
    expect(s).toEqual(f)
    expect(f.map((c) => c.t)).toEqual(['a', 'b'])
    expect(f[0].y).toBeCloseTo(200 + G.normal.centredTop - G.normal.pitch / 2, 6)
    const order = log.filter((c) => c[0] === 'strokeText' || c[0] === 'fillText').map((c) => c[0])
    expect(order).toEqual(['strokeText', 'strokeText', 'fillText', 'fillText'])
  })

  it('a glyph (either way it points): the block ABOVE it grows upward, its last line at glyphTop', () => {
    for (const style of ['triangleup', 'triangledown', 'circle', 'arrowup']) {
      const t = texts(paint([label(style, 'a\nb')]))
      expect(t.map((c) => [c.t, c.y]), style).toEqual([['a', 200 + G.normal.glyphTop - G.normal.pitch], ['b', 200 + G.normal.glyphTop]])
    }
  })
})

describe('⛔ an empty line is never painted', () => {
  it('on any path, for text made only of breaks and blank lines', () => {
    for (const style of ['label_center', 'label_up', 'none', 'text_outline', 'circle', 'triangledown']) {
      for (const text of ['\n', '\n\n', 'a\n', '\na', 'a\n\nb']) {
        const log = paint([label(style, text)])
        const painted = log.filter((c) => c[0] === 'fillText' || c[0] === 'strokeText').map((c) => c[1])
        expect(painted.every((s) => s !== ''), `${style} ${JSON.stringify(text)}`).toBe(true)
        expect(painted.filter((s) => s === 'a' || s === 'b').length).toBe(painted.length)
      }
    }
  })

  it('and a blank line keeps its height (the line after it moves down by two pitches)', () => {
    const t = texts(paint([label('none', 'a\n\nb')]))
    expect(t[1].y - t[0].y).toBe(2 * G.normal.pitch)
  })
})
