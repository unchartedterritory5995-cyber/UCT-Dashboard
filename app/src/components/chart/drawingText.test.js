/* Text Note geometry — the contract that stops a note moving.
 *
 * ⛔ WHAT THESE TESTS ARE REALLY ABOUT. A Text Note is laid out twice, by two
 * different engines: a DOM `<textarea>` while it is being written and a
 * `<canvas>` for the rest of its life. Before Phase 6 each was told about the
 * note separately, and they disagreed — different padding, different origin,
 * different font string, different colour. Every assertion here is about the two
 * of them being handed the SAME numbers, because that is the only version of
 * "the note does not move" that survives contact with a second renderer.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  BORDER_W, DEFAULT_FONT_SIZE, LINE_HEIGHT, PAD_X, PAD_Y,
  _clearTextCache,
  baselineOffset, editorTextStyle, fontLabelFor, fontSizeOf, fontStackOf,
  fontStringFor, hasBox, isBold, isItalic, textBoxFor, usesBoxOrigin,
  FONT_OPTIONS,
} from './drawingText'

/** A measuring stand-in: 6px per character, and a font ascent of 0.8em, so the
 *  arithmetic below is arithmetic rather than a font. */
const ctx = {
  font: '',
  measureText: (t) => ({ width: String(t).length * 6, fontBoundingBoxAscent: 0 }),
}
// ⛔ THE LAYOUT CACHE IS KEYED ON `ctx.font`, and these stand-in contexts share
// one. Clearing between tests is what stops a measurement taken under one
// fixture answering a question asked by the next — the same hazard the cache
// exists to exploit in production, where the key really is distinct per style.
beforeEach(() => _clearTextCache())

const wrap = (c, text, w) => {
  const s = String(text ?? '')
  if (!w) return s.split('\n')
  const out = []
  for (const para of s.split('\n')) {
    const per = Math.max(1, Math.floor(w / 6))
    for (let i = 0; i < para.length; i += per) out.push(para.slice(i, i + per))
    if (!para.length) out.push('')
  }
  return out
}

// ═══════════════════════════════════════════════════════════════════════════
describe('typography — one font string, both engines', () => {
  it('builds the shorthand in the grammar’s order: style, weight, size, family', () => {
    // ⛔ Canvas silently IGNORES a font string it cannot parse and keeps the
    // previous one — so a mis-ordered shorthand does not throw, it quietly draws
    // the last drawing's font.
    expect(fontStringFor({ bold: true, italic: true, fontSize: 18, fontFamily: 'Georgia, serif' }))
      .toBe('italic 700 18px Georgia, serif')
    expect(fontStringFor({ bold: true, fontSize: 18 })).toBe('700 18px Instrument Sans, sans-serif')
    expect(fontStringFor({ italic: true })).toBe(`italic ${DEFAULT_FONT_SIZE}px Instrument Sans, sans-serif`)
    expect(fontStringFor({})).toBe(`${DEFAULT_FONT_SIZE}px Instrument Sans, sans-serif`)
  })

  it('bold and italic together are both applied', () => {
    const f = fontStringFor({ bold: true, italic: true })
    expect(f).toContain('italic')
    expect(f).toContain('700')
  })

  it('the DOM style and the canvas string describe the same face', () => {
    const d = { bold: true, italic: true, fontSize: 20, fontFamily: 'Consolas, monospace' }
    const st = editorTextStyle(d)
    expect(st.fontFamily).toBe(fontStackOf(d))
    expect(st.fontSize).toBe('20px')
    expect(st.fontWeight).toBe(700)
    expect(st.fontStyle).toBe('italic')
    expect(st.lineHeight).toBe(LINE_HEIGHT)
    expect(st.padding).toBe(`${PAD_Y}px ${PAD_X}px`)
  })

  it('a legacy note has no family, no weight and no slant', () => {
    for (const d of [{}, null, { fontFamily: null }, { fontFamily: '' }]) {
      expect(fontStackOf(d)).toBe('Instrument Sans, sans-serif')
      expect(isBold(d)).toBe(false)
      expect(isItalic(d)).toBe(false)
    }
  })

  it('a nonsense size falls back rather than drawing an invisible note', () => {
    for (const bad of [0, -4, NaN, Infinity, '20', null]) {
      expect(fontSizeOf({ fontSize: bad }), String(bad)).toBe(DEFAULT_FONT_SIZE)
    }
    expect(fontSizeOf({ fontSize: 22 })).toBe(22)
  })

  it('the approved set is shared, and names itself back', () => {
    expect(FONT_OPTIONS.length).toBeGreaterThan(10)
    expect(FONT_OPTIONS[0]).toEqual({ label: 'Default', value: '' })
    expect(fontLabelFor('')).toBe('Default')
    expect(fontLabelFor(null)).toBe('Default')
    expect(fontLabelFor('Georgia, serif')).toBe('Georgia')
    // A stack from a future build reports itself rather than lying "Default".
    expect(fontLabelFor('"Some Face", sans-serif')).toBe('Some Face')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ THE ANCHOR IS THE BOX’S TOP-LEFT — for notes that say so', () => {
  const d = { text: 'hello', fontSize: 10, textOrigin: 'box' }

  it('the box starts exactly at the anchor', () => {
    const box = textBoxFor(ctx, d, 100, 200, wrap)
    expect(box.x).toBe(100)
    expect(box.y).toBe(200)
  })

  it('the text starts one padding and one border inside it', () => {
    const box = textBoxFor(ctx, d, 100, 200, wrap)
    expect(box.textX).toBe(100 + PAD_X + BORDER_W)
    expect(box.textTop).toBe(200 + PAD_Y + BORDER_W)
  })

  it('the box is the text plus padding, on both axes', () => {
    const box = textBoxFor(ctx, d, 0, 0, wrap)
    expect(box.w).toBe(5 * 6 + (PAD_X + BORDER_W) * 2)          // 'hello'
    expect(box.h).toBe(1 * 10 * LINE_HEIGHT + (PAD_Y + BORDER_W) * 2)
  })

  it('⛔ IT GROWS DOWN AND RIGHT FROM THE ANCHOR, never around its centre', () => {
    // The acceptance criterion behind "changing font size must not move it".
    const small = textBoxFor(ctx, { ...d, fontSize: 10 }, 100, 200, wrap)
    const big = textBoxFor(ctx, { ...d, fontSize: 40 }, 100, 200, wrap)
    expect(big.x).toBe(small.x)
    expect(big.y).toBe(small.y)
    expect(big.h).toBeGreaterThan(small.h)
    expect(big.textX).toBe(small.textX)      // padding is fixed, not em-scaled
    expect(big.textTop).toBe(small.textTop)
  })

  it('a taller note grows downward only', () => {
    const one = textBoxFor(ctx, d, 100, 200, wrap)
    const three = textBoxFor(ctx, { ...d, text: 'a\nb\nc' }, 100, 200, wrap)
    expect(three.y).toBe(one.y)
    expect(three.h).toBeCloseTo(one.h + 2 * 10 * LINE_HEIGHT, 6)
  })

  it('a stored wrap width sets the box width, whatever the text is', () => {
    const box = textBoxFor(ctx, { ...d, text: 'x', boxWidth: 120 }, 0, 0, wrap)
    expect(box.w).toBe(120 + (PAD_X + BORDER_W) * 2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⛔ A LEGACY NOTE KEEPS THE PLACEMENT IT HAS ALWAYS HAD', () => {
  const legacy = { text: 'hello', fontSize: 10 }

  it('its text is drawn where the shipped painter drew it', () => {
    // The shipped formula was exactly: x = anchor.x, first baseline =
    // anchor.y + fontSize * 1.4. Reproduced to the pixel, so no note on anyone's
    // chart slides when this ships.
    const box = textBoxFor(ctx, legacy, 100, 200, wrap)
    expect(box.textX).toBe(100)
    expect(box.firstBaseline).toBe(200 + 10 * LINE_HEIGHT)
  })

  it('…and later lines keep the same line height', () => {
    const box = textBoxFor(ctx, { ...legacy, text: 'a\nb' }, 100, 200, wrap)
    expect(box.lineH).toBe(10 * LINE_HEIGHT)
    expect(box.firstBaseline + box.lineH).toBe(200 + 2 * 10 * LINE_HEIGHT)
  })

  it('⭐ BUT IT STILL GETS A BOX, so it can be grabbed and boxed like any other', () => {
    // Derived backwards from where the ink is: the note does not move, it merely
    // becomes hit-testable and editable where it already sits.
    const box = textBoxFor(ctx, legacy, 100, 200, wrap)
    expect(box.x).toBe(100 - PAD_X - BORDER_W)
    expect(box.y).toBeLessThan(box.firstBaseline)
    expect(box.y + box.h).toBeGreaterThan(box.firstBaseline)
    expect(box.w).toBe(5 * 6 + (PAD_X + BORDER_W) * 2)
  })

  it('the two rules are told apart by one property, and only that', () => {
    expect(usesBoxOrigin({ textOrigin: 'box' })).toBe(true)
    for (const d of [{}, null, { textOrigin: null }, { textOrigin: 'legacy' }]) {
      expect(usesBoxOrigin(d)).toBe(false)
    }
  })

  it('⛔ AND THE TWO RULES DISAGREE, which is exactly why the marker exists', () => {
    const a = textBoxFor(ctx, { text: 'hi', fontSize: 13 }, 100, 200, wrap)
    const b = textBoxFor(ctx, { text: 'hi', fontSize: 13, textOrigin: 'box' }, 100, 200, wrap)
    expect(a.textX).not.toBe(b.textX)     // ~9px — the create-time jump, preserved
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('baselines — asked of the font, not guessed', () => {
  it('uses the font’s own ascent when the engine reports one', () => {
    const withMetrics = { font: 'a', measureText: () => ({ width: 10, fontBoundingBoxAscent: 12 }) }
    // half-leading + ascent
    expect(baselineOffset(withMetrics, 10, 14)).toBe(2 + 12)
  })

  it('falls back to 0.8em where there are no metrics (jsdom, old engines)', () => {
    expect(baselineOffset(ctx, 10, 14)).toBe(2 + 8)
    const throws = { font: 'b', measureText: () => { throw new Error('nope') } }
    expect(baselineOffset(throws, 10, 14)).toBe(2 + 8)
  })

  it('half-leading is CSS’s own rule — the extra splits above and below', () => {
    const tight = baselineOffset(ctx, 10, 10)
    const loose = baselineOffset(ctx, 10, 20)
    expect(loose - tight).toBe(5)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the box a note draws around itself', () => {
  it('is present when either the background or the border is on', () => {
    expect(hasBox({})).toBe(false)
    expect(hasBox({ bgEnabled: true })).toBe(true)
    expect(hasBox({ borderEnabled: true })).toBe(true)
    expect(hasBox({ bgEnabled: true, borderEnabled: true })).toBe(true)
    expect(hasBox(null)).toBe(false)
  })

  it('the box is the same size whether or not it is painted', () => {
    // ⭐ Turning a background on must not change where the text sits — the
    // padding is always there, the plate is just not drawn.
    const bare = textBoxFor(ctx, { text: 'hi', fontSize: 12, textOrigin: 'box' }, 10, 20, wrap)
    const boxed = textBoxFor(ctx, { text: 'hi', fontSize: 12, textOrigin: 'box', bgEnabled: true, borderEnabled: true }, 10, 20, wrap)
    expect(boxed).toEqual(bare)
  })
})
