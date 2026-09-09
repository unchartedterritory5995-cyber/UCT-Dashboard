// app/src/components/chart/engine/__tests__/textLayout.test.js
//
// ─── R0.1 — THE TEXT ENGINE, TESTED AGAINST FIXED FONT METRICS ───────────────
//
// ⛔ EVERY WRAP ASSERTION USES AN INVENTED MEASURER, NOT A REAL FONT. A test that
// measured with the machine's actual `-apple-system` stack would assert a number
// that differs between this box, CI, and a reviewer's laptop — so it would either
// be loosened until it proved nothing, or be red for everyone but its author.
// With a monospace fiction (10px per character) the wrap points are arithmetic
// and each test states exactly which rule fired.
//
// ⭐ AND THE SIZE TABLE IS DERIVED FROM THE SPEC, NOT TYPED HERE. Retyping
// `0/8/10/14/20/36` in a second place is the defect this repo keeps paying for:
// two authorities over one value, drifting on the first edit. The paragraph in
// `docs/pine/pine-presentation-spec.md` that warns the two tables "must not be
// crossed" is parsed, and `SIZE_PX` is checked against what it says.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  SIZE_PX,
  SIZE_UNMAPPED,
  AUTO_FALLBACK,
  ALIGN,
  sizeToPx,
  fontString,
  wrapText,
  layoutText,
  snapToDevicePixel,
  resolveOverlap,
} from '../textLayout'

const SRC = path.resolve(__dirname, '../../../..')                 // app/src
const REPO = path.resolve(SRC, '../..')                            // repo root
const SPEC = path.join(REPO, 'docs/pine/pine-presentation-spec.md')
const MODULE = path.join(SRC, 'components/chart/engine/textLayout.js')

/** A monospace fiction: every glyph 10px wide, ascent 8, descent 2.
 *  Nothing here depends on a real font, which is the entire point. */
function fixedMeasurer(charWidth = 10, ascent = 8, descent = 2) {
  return (text) => ({ width: String(text).length * charWidth, ascent, descent })
}
const measure = fixedMeasurer()
const font = fontString(12)

// ─────────────────────────────────────────────────────────────────────────────
describe('the size to px tables are derived from the spec, not typed in the module', () => {
  const spec = fs.readFileSync(SPEC, 'utf8')

  /** The six numbers on one of the spec's two table lines, in reference order:
   *  auto · tiny · small · normal · large · huge (spec §4.3.1 verbatim quote). */
  function tableAfter(label) {
    const m = new RegExp(`${label}:\\s*([^.]*)\\.`).exec(spec)
    if (!m) throw new Error(`the spec no longer states a "${label}:" size table — ${SPEC}`)
    return (m[1].match(/\d+/g) || []).map(Number)
  }

  it('the spec still states both tables, six sizes each', () => {
    // ⭐ THE NON-VACUITY CONTROL. Without it, a regex that silently matched
    // nothing would make every comparison below `[] === []` and pass.
    expect(tableAfter('Labels')).toHaveLength(6)
    expect(tableAfter('Boxes and tables')).toHaveLength(6)
  })

  it('the label table in the module is the label table in the spec', () => {
    const [auto, tiny, small, normal, large, huge] = tableAfter('Labels')
    expect(SIZE_PX.label).toEqual({ auto, tiny, small, normal, large, huge })
  })

  it('the box and cell tables in the module are the spec box/table table', () => {
    const [auto, tiny, small, normal, large, huge] = tableAfter('Boxes and tables')
    const expected = { auto, tiny, small, normal, large, huge }
    expect(SIZE_PX.box).toEqual(expected)
    expect(SIZE_PX.table).toEqual(expected)
  })

  it('the two tables genuinely disagree, so one shared table cannot be correct', () => {
    // ⛔ This is the assertion that stops a well-meaning refactor into a single
    // size map. If they ever coincide, the whole per-consumer split is dead
    // weight and someone should say so out loud rather than discover it.
    expect(SIZE_PX.label.normal).not.toBe(SIZE_PX.box.normal)
    expect(tableAfter('Labels')).not.toEqual(tableAfter('Boxes and tables'))
  })

  it('the spec is why plotshape and plotchar have no pixel mapping', () => {
    expect(spec).toMatch(/`plotshape`\/`plotchar` accept \*\*no int at all\*\*/)
    expect([...SIZE_UNMAPPED].sort()).toEqual(['plotchar', 'plotshape'])
  })

  it('the module names its provenance, so the numbers can be re-checked', () => {
    // A number nobody can trace is a number nobody will re-measure.
    expect(fs.readFileSync(MODULE, 'utf8')).toContain('pine-presentation-spec.md')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('sizeToPx', () => {
  it('size.normal is 12 on a label and 14 in a box or cell', () => {
    expect(sizeToPx('normal', 'label')).toBe(12)
    expect(sizeToPx('normal', 'box')).toBe(14)
    expect(sizeToPx('normal', 'table')).toBe(14)
  })

  it('refuses plotshape and plotchar by name instead of substituting a label size', () => {
    for (const consumer of SIZE_UNMAPPED) {
      expect(() => sizeToPx('normal', consumer)).toThrow(new RegExp(consumer))
    }
  })

  it('size.auto resolves to the consumer normal, never to 0px', () => {
    expect(AUTO_FALLBACK).toBe('normal')
    expect(sizeToPx('auto', 'label')).toBe(SIZE_PX.label.normal)
    expect(sizeToPx('auto', 'table')).toBe(SIZE_PX.table.normal)
    // The table still RECORDS auto as 0 — that is the vendor's value, and the
    // resolution to `normal` is ours and is stated. Both facts stay visible.
    expect(SIZE_PX.label.auto).toBe(0)
  })

  it('names an unknown constant and an unknown consumer', () => {
    expect(() => sizeToPx('gigantic', 'label')).toThrow(/gigantic/)
    expect(() => sizeToPx('normal', 'legend')).toThrow(/legend/)
  })

  it('accepts a pine version without changing the answer today', () => {
    // The parameter exists so a vendor-measured per-version table lands here
    // and not in every caller. It is not a claim that versions differ yet.
    for (const v of [1, 2, 3, 4, 5, 6]) {
      expect(sizeToPx('huge', 'label', v)).toBe(SIZE_PX.label.huge)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('wrapText', () => {
  it('breaks at an explicit newline even when the line would fit', () => {
    expect(wrapText('ab\ncd', { measure, font, maxWidth: 1000 })).toEqual(['ab', 'cd'])
  })

  it('keeps a blank line between two paragraphs', () => {
    expect(wrapText('a\n\nb', { measure, font, maxWidth: 1000 })).toEqual(['a', '', 'b'])
  })

  it('wraps at a word boundary when the next word would overflow', () => {
    // 'aaa bbb' = 7 glyphs = 70px, exactly maxWidth. Adding ' ccc' = 110px.
    expect(wrapText('aaa bbb ccc', { measure, font, maxWidth: 70 })).toEqual(['aaa bbb', 'ccc'])
  })

  it('breaks a single token that cannot fit, rather than letting it overflow', () => {
    // ⛔ The alternative is a label drawn across the candles it annotates.
    expect(wrapText('abcdefgh', { measure, font, maxWidth: 30 })).toEqual(['abc', 'def', 'gh'])
  })

  it('does not wrap at all when maxWidth is absent, zero or not finite', () => {
    for (const maxWidth of [0, -1, undefined, NaN, Infinity]) {
      expect(wrapText('aaa bbb ccc', { measure, font, maxWidth })).toEqual(['aaa bbb ccc'])
    }
  })

  it('actually consults the measurer', () => {
    // ⭐ THE CONTROL. Every assertion above is compatible with a wrapper that
    // ignored `measure` and split on some fixed character count. Widening the
    // glyph must change the answer.
    const wide = wrapText('aaa bbb ccc', { measure: fixedMeasurer(30), font, maxWidth: 70 })
    expect(wide).toEqual(['aa', 'a', 'bb', 'b', 'cc', 'c'])
    expect(wide).not.toEqual(wrapText('aaa bbb ccc', { measure, font, maxWidth: 70 }))
  })

  it('treats null and undefined text as empty, not as the string "null"', () => {
    expect(wrapText(null, { measure, font, maxWidth: 100 })).toEqual([''])
    expect(wrapText(undefined, { measure, font, maxWidth: 100 })).toEqual([''])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('layoutText', () => {
  const opts = { measure, font, maxWidth: 70 }

  it('measures the block by its widest line', () => {
    const l = layoutText('aaa bbb ccc', opts)
    expect(l.lines).toEqual(['aaa bbb', 'ccc'])
    expect(l.width).toBe(70)
    expect(l.ascent).toBe(8)
    expect(l.descent).toBe(2)
    expect(l.lineHeight).toBe(10)
    expect(l.height).toBe(20)
  })

  it('offsets each line for the requested alignment', () => {
    expect(layoutText('aaa bbb ccc', { ...opts, align: ALIGN.left }).offsets).toEqual([0, 0])
    expect(layoutText('aaa bbb ccc', { ...opts, align: ALIGN.center }).offsets).toEqual([0, 20])
    expect(layoutText('aaa bbb ccc', { ...opts, align: ALIGN.right }).offsets).toEqual([0, 40])
  })

  it('adds lineGap to the line height, not to the ascent', () => {
    const l = layoutText('aaa bbb ccc', { ...opts, lineGap: 4 })
    expect(l.lineHeight).toBe(14)
    expect(l.height).toBe(28)
    expect(l.ascent).toBe(8)
  })

  it('lays out empty text without producing NaN', () => {
    const l = layoutText('', opts)
    expect(l.lines).toEqual([''])
    expect(l.width).toBe(0)
    expect(Number.isFinite(l.height)).toBe(true)
  })

  it('refuses to guess when no measurer is supplied', () => {
    expect(() => layoutText('x', { font })).toThrow(/measure/)
    expect(() => layoutText('x')).toThrow(/measure/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('snapToDevicePixel', () => {
  it('snaps to the device grid at DPR 2', () => {
    expect(snapToDevicePixel(10.3, 2)).toBe(10.5)
    expect(snapToDevicePixel(10.1, 2)).toBe(10)
  })

  it('snaps to whole pixels at DPR 1', () => {
    expect(snapToDevicePixel(10.3, 1)).toBe(10)
    expect(snapToDevicePixel(10.7, 1)).toBe(11)
  })

  it('passes a value through untouched rather than returning NaN', () => {
    expect(snapToDevicePixel(NaN, 2)).toBeNaN()
    expect(snapToDevicePixel(10.3, 0)).toBe(10.3)
    expect(snapToDevicePixel(10.3, NaN)).toBe(10.3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('resolveOverlap', () => {
  const overlapping = () => [
    { y: 100, height: 20 },
    { y: 105, height: 20 },   // overlaps the first
    { y: 200, height: 20 },   // clears both
  ]

  it('leaves overlapping labels overlapping, because Pine does', () => {
    // ⛔ TradingView documents no collision handling anywhere. A renderer that
    // tidied these apart would draw a different chart from the one the author
    // wrote and sees on TradingView.
    const out = resolveOverlap(overlapping())
    expect(out.map((i) => i.y)).toEqual([100, 105, 200])
    expect(out.map((i) => i.shifted)).toEqual([0, 0, 0])
  })

  it('THE CONTROL: the same fixture does move under stack mode', () => {
    // ⭐ Without this, the assertion above passes for a fixture with no overlap
    // in it at all — the classic gate that cannot fail.
    const out = resolveOverlap(overlapping(), { mode: 'stack' })
    expect(out.map((i) => i.y)).toEqual([100, 120, 200])
    expect(out.map((i) => i.shifted)).toEqual([0, 15, 0])
  })

  it('stack moves only what actually collides', () => {
    const out = resolveOverlap(overlapping(), { mode: 'stack' })
    expect(out[2].shifted).toBe(0)   // 200 already cleared 140
  })

  it('stack honours a gap between stacked rows', () => {
    const out = resolveOverlap(overlapping(), { mode: 'stack', gap: 5 })
    expect(out.map((i) => i.y)).toEqual([100, 125, 200])
  })

  it('stack sorts internally but returns items in input order', () => {
    // The caller's array index is its handle on the row — reordering it would
    // silently re-label every cell in a table.
    const out = resolveOverlap([{ y: 105, height: 20 }, { y: 100, height: 20 }], { mode: 'stack' })
    expect(out[1].y).toBe(100)
    expect(out[0].y).toBe(120)
  })

  it('does not mutate the items it was given', () => {
    const items = overlapping()
    resolveOverlap(items, { mode: 'stack' })
    expect(items.map((i) => i.y)).toEqual([100, 105, 200])
  })

  it('handles nothing to lay out', () => {
    expect(resolveOverlap([])).toEqual([])
    expect(resolveOverlap(undefined)).toEqual([])
  })

  it('names an unknown mode instead of silently picking one', () => {
    expect(() => resolveOverlap([], { mode: 'tidy' })).toThrow(/tidy/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('fontString', () => {
  it('puts the pixel size first and always supplies a fallback stack', () => {
    expect(fontString(12)).toMatch(/^12px .+,.+/)
    expect(fontString(14, 'mono')).toMatch(/monospace$/)
    expect(fontString(14, 'sans')).not.toMatch(/monospace/)
  })

  it('carries an optional weight ahead of the size', () => {
    expect(fontString(12, 'sans', 'bold')).toMatch(/^bold 12px /)
  })
})
