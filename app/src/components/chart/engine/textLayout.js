// app/src/components/chart/engine/textLayout.js
//
// ─── R0.1 — THE TEXT ENGINE PINE NEEDS AND LIGHTWEIGHT-CHARTS DOES NOT HAVE ──
//
// Lightweight Charts hands a primitive a 2D canvas and nothing else. Every Pine
// visual that carries words — `label.new`, `box.new`'s text, every `table.cell`,
// `plotchar`'s glyph — has to be measured, wrapped, aligned and placed by us.
// The survey put a number on how load-bearing that is: **19 of 20 scripts in one
// case-study slice needed a text renderer**, and text was the single most-hit gap
// across all 100. So this is built ONCE, here, before any primitive that draws.
//
// ─── THE SHAPE: A PURE CORE AND A THIN SHELL (same as fillPrimitive) ─────────
//
// ⛔ CANVAS CODE CANNOT BE UNIT-TESTED, so the core takes a `measure` FUNCTION
// and never touches a canvas. `createCanvasMeasurer` is the only part that does,
// and it is four lines. Every wrap/align/stack decision is therefore testable
// against fixed, invented font metrics — which is also the only way to assert
// wrapping exactly, since real font metrics differ per machine and per browser.
//
// ─── WHAT IS MEASURED AND WHAT IS ASSUMED ───────────────────────────────────
//
// ⚠️ THE PIXEL SIZES BELOW ARE FROM THE SPEC, NOT FROM A LIVE PINE CHART. They
// come from `docs/pine/pine-presentation-spec.md`, which derived them from
// TradingView's own reference payload. The spec marks the `size.*`→px mapping as
// carrying UNVERIFIED items, and the R0 ruling asks for a vendor-measured table.
// **No vendor measurement exists yet** (it needs a live chart with study identity
// proven), so every entry here is tagged with its provenance and the verification
// debt is tracked in the spec's UNVERIFIED register. Do not quote these numbers
// as measured.

/** The `size.*` → pixel mapping, BY CONSUMER.
 *
 * ⭐⭐ THE SAME CONSTANT MEANS DIFFERENT PIXELS IN DIFFERENT PLACES, and this is
 * the single most surprising thing in the spec's text section: `size.normal` is
 * **12px on a label** and **14px in a box or table cell**. A shared table keyed
 * only by size name would be wrong for one of the two consumers on every render,
 * and wrong by an amount too small to notice in review and too large to miss on
 * a chart. `plotshape`/`plotchar` accept `size.*` but map it to no pixel value at
 * all — they are deliberately absent rather than defaulted, so asking for one
 * throws instead of quietly drawing at label sizes.
 *
 * Provenance: docs/pine/pine-presentation-spec.md §4 (reference payload). */
export const SIZE_PX = Object.freeze({
  label: Object.freeze({ auto: 0, tiny: 7, small: 10, normal: 12, large: 18, huge: 24 }),
  box: Object.freeze({ auto: 0, tiny: 8, small: 10, normal: 14, large: 20, huge: 36 }),
  table: Object.freeze({ auto: 0, tiny: 8, small: 10, normal: 14, large: 20, huge: 36 }),
})

/** Consumers that accept `size.*` as a NAME but have no pixel mapping. */
export const SIZE_UNMAPPED = Object.freeze(['plotshape', 'plotchar'])

/** `size.auto` is 0 in the table and means "the renderer picks", not "0px".
 *  What TradingView picks is undocumented — see the spec's UNVERIFIED register.
 *  We resolve it to the consumer's `normal` and SAY SO, rather than drawing
 *  nothing, because a 0px label is indistinguishable from a broken one. */
export const AUTO_FALLBACK = 'normal'

/**
 * @param {string} size   one of auto|tiny|small|normal|large|huge
 * @param {string} consumer  'label' | 'box' | 'table'
 * @param {number} [pineVersion]  1..6
 * @returns {number} pixel size
 *
 * ⚠️ `pineVersion` is accepted and currently ignored. The evolution survey
 * records that pre-v6 text size is an ENUM while v6 "may be absolute points" —
 * flagged UNVERIFIED. The parameter exists so the day that is measured, the fix
 * is a table lookup here and not a signature change through every caller. It is
 * NOT a claim that versions currently differ.
 */
export function sizeToPx(size, consumer, pineVersion = 6) {
  if (SIZE_UNMAPPED.includes(consumer)) {
    throw new Error(
      `size.${size} has no pixel mapping for ${consumer} — Pine accepts the constant ` +
      'there but does not map it to a text size. Do not substitute a label size.',
    )
  }
  const table = SIZE_PX[consumer]
  if (!table) throw new Error(`unknown text consumer: ${consumer}`)
  const key = size === 'auto' ? AUTO_FALLBACK : size
  const px = table[key]
  if (px === undefined) throw new Error(`unknown size constant: size.${size}`)
  return px
}

/** Pine's alignment constants, and which consumers accept which.
 *  `text.align_*` has five members but a LABEL accepts only three — top and
 *  bottom are box/table-only. Spec §4.3. */
export const ALIGN = Object.freeze({ left: 'left', center: 'center', right: 'right' })
export const VALIGN = Object.freeze({ top: 'top', center: 'center', bottom: 'bottom' })

/**
 * Build a measurer from a live canvas context. THE ONLY CANVAS-TOUCHING CODE.
 *
 * Returns `(text, font) => {width, ascent, descent}` in CSS pixels.
 * ⚠️ `actualBoundingBox*` is per-GLYPH ink, so it varies with the string; for
 * line spacing we want the FONT's box, which is what `fontBoundingBox*` gives.
 * We prefer the latter and fall back, because a line height that changes when
 * the text changes makes a multi-line label jitter as its content updates.
 */
export function createCanvasMeasurer(ctx) {
  return (text, font) => {
    ctx.font = font
    const m = ctx.measureText(text)
    const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? 0
    const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? 0
    return { width: m.width, ascent, descent }
  }
}

/** Compose a CSS font string. Pine's `text_font_family` is one of two values
 *  (default / monospace) — spec §4.3 — so this takes a stack, not a free name. */
export function fontString(px, family = 'sans', weight = '') {
  const stack = family === 'mono'
    ? "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    : "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  return `${weight ? `${weight} ` : ''}${px}px ${stack}`
}

/**
 * Wrap `text` to `maxWidth`, honouring explicit newlines.
 *
 * ⛔ EXPLICIT `\n` IS A HARD BREAK AND ALWAYS WINS. Pine labels carry multi-line
 * text and an author who typed a newline meant it; collapsing it into the wrap
 * would reflow their layout the moment the box got wider.
 *
 * A single token longer than `maxWidth` is broken mid-token rather than allowed
 * to overflow — a clipped label is a bug, and the alternative (let it run) draws
 * over the candles the label is annotating.
 *
 * `maxWidth <= 0` or a non-finite value means "no wrapping": only explicit
 * newlines split. That is the label case (Pine labels do not wrap).
 */
export function wrapText(text, { measure, font, maxWidth }) {
  const src = String(text ?? '')
  const paragraphs = src.split('\n')
  const unbounded = !Number.isFinite(maxWidth) || maxWidth <= 0
  if (unbounded) return paragraphs

  const out = []
  for (const para of paragraphs) {
    if (para === '') { out.push(''); continue }
    let line = ''
    for (const word of para.split(' ')) {
      const candidate = line === '' ? word : `${line} ${word}`
      if (measure(candidate, font).width <= maxWidth) { line = candidate; continue }
      if (line !== '') { out.push(line); line = '' }
      // The word alone may still not fit — break it by character.
      let chunk = ''
      for (const ch of word) {
        if (chunk !== '' && measure(chunk + ch, font).width > maxWidth) {
          out.push(chunk)
          chunk = ch
        } else {
          chunk += ch
        }
      }
      line = chunk
    }
    out.push(line)
  }
  return out
}

/**
 * Full layout for one text block: wrapped lines plus the box they occupy and the
 * per-line x offsets for the requested alignment.
 *
 * Returns `{lines, lineHeight, width, height, offsets, ascent, descent}` in CSS px.
 */
export function layoutText(text, {
  measure,
  font,
  maxWidth = 0,
  align = ALIGN.left,
  lineGap = 0,
} = {}) {
  if (typeof measure !== 'function') throw new Error('layoutText needs a measure function')
  const lines = wrapText(text, { measure, font, maxWidth })
  const metrics = lines.map((l) => measure(l, font))
  const ascent = metrics.length ? Math.max(...metrics.map((m) => m.ascent)) : 0
  const descent = metrics.length ? Math.max(...metrics.map((m) => m.descent)) : 0
  const lineHeight = ascent + descent + lineGap
  const width = metrics.length ? Math.max(...metrics.map((m) => m.width)) : 0
  const offsets = metrics.map((m) => {
    if (align === ALIGN.right) return width - m.width
    if (align === ALIGN.center) return (width - m.width) / 2
    return 0
  })
  return { lines, lineHeight, width, height: lineHeight * lines.length, offsets, ascent, descent }
}

/**
 * Snap a CSS-pixel coordinate to a device pixel so text renders crisp at DPR.
 *
 * ⚠️ Only meaningful in the BITMAP coordinate space. Lightweight Charts offers
 * both spaces to a renderer, and text drawn in media space at a fractional device
 * pixel is the usual cause of a "blurry on a retina display" report.
 */
export function snapToDevicePixel(value, dpr = 1) {
  if (!Number.isFinite(value) || !Number.isFinite(dpr) || dpr <= 0) return value
  return Math.round(value * dpr) / dpr
}

/**
 * Resolve vertical overlap between items sharing an x position.
 *
 * ⛔⛔ THE DEFAULT IS 'pine', AND 'pine' MEANS DO NOTHING. TradingView documents
 * no collision handling for labels anywhere — the spec searched the reference
 * payload and all 49 manual pages and found no statement, and every official
 * example leaves overlap to the script author. So a renderer that tidily spreads
 * overlapping labels is NOT more correct, it is a different chart from the one
 * the author wrote and the one they see on TradingView. Fidelity first.
 *
 * 'stack' exists because TABLES are laid out by us, not by the author — a table
 * has rows, and rows may not overlap. That is a layout we own, not a fidelity
 * question. Keeping both behind one function means the choice is made explicitly
 * at each call site rather than by whichever default someone reached for.
 *
 * @param {Array<{y:number, height:number}>} items — mutated? no, copies returned
 * @param {{mode?: 'pine'|'stack', gap?: number}} opts
 * @returns {Array<{y:number, height:number, shifted:number}>}
 */
export function resolveOverlap(items, { mode = 'pine', gap = 0 } = {}) {
  const list = (items || []).map((it) => ({ ...it, shifted: 0 }))
  if (mode === 'pine') return list
  if (mode !== 'stack') throw new Error(`unknown overlap mode: ${mode}`)

  const order = list
    .map((it, i) => ({ i, y: it.y }))
    .sort((a, b) => a.y - b.y || a.i - b.i)
  let cursor = -Infinity
  for (const { i } of order) {
    const it = list[i]
    const top = Math.max(it.y, cursor)
    it.shifted = top - it.y
    it.y = top
    cursor = top + it.height + gap
  }
  return list
}
