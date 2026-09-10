/* Text Note geometry and typography — ONE source of truth for two renderers.
 *
 * ─── THE PROBLEM THIS FILE EXISTS TO SOLVE ──────────────────────────────────
 *
 * A Text Note is edited in a DOM `<textarea>` and displayed on a `<canvas>`.
 * Those are two completely different text engines, and before Phase 6 they were
 * each told about the note separately:
 *
 *   the editor            the painter
 *   ──────────            ──────────
 *   left/top = click pt   text drawn AT the stored anchor
 *   padding 6px 8px       no padding
 *   line-height 1.4       baseline at (i + 1) × 1.4em
 *   'Instrument Sans'     'Instrument Sans' (hard-coded, no family/weight)
 *   the TOOLBAR's colour  the DRAWING's colour
 *   the TOOLBAR's size    the DRAWING's size
 *
 * So the text you typed and the text you got were never in the same place, and
 * a note you double-clicked was edited in a box that had drifted from it.
 *
 * ⭐ EVERY NUMBER THAT AFFECTS LAYOUT IS NOW A CONSTANT IN THIS FILE, and both
 * surfaces read them. Changing the padding changes it in both, or in neither.
 *
 * ─── THE ANCHOR ─────────────────────────────────────────────────────────────
 *
 * ⛔ A NOTE'S STORED ANCHOR IS ITS BOX'S TOP-LEFT CORNER. Not the first
 * baseline, not the text's top-left inside the padding — the outer corner, the
 * one the `<textarea>`'s `left`/`top` sets. That is the only choice under which
 * "put the editor where the note is" and "put the note where the editor was"
 * are the same statement.
 *
 * ⚰️ AND IT ALWAYS WAS — the painter simply disagreed with it. Creation stored
 * the click point and placed the editor's top-left at that same click point, so
 * the intent was unambiguous; the painter then drew the text at the anchor with
 * no padding and a full line-height of vertical offset, landing it about 9px
 * left and a couple of pixels off vertically from where the user had just seen
 * it. That is the create-time jump.
 *
 * ⛔ WHICH IS WHY LEGACY NOTES KEEP THE OLD PLACEMENT. Fixing the painter is the
 * right change, but applied to notes that already exist it would slide every one
 * of them ~9px across somebody's chart — a silent restatement of hundreds of
 * deliberate placements, to correct an error they have long since eyeballed
 * around. So the note records which rule it was drawn under: new notes carry
 * `textOrigin: 'box'` and are laid out correctly; a note without it is laid out
 * exactly as it always has been. `textBoxFor` returns a box either way, so the
 * editor, the hit test, the background and the selection all agree in both
 * cases — nothing drifts under either rule.
 */
import { FONT_OPTIONS, fontLabelFor } from '../../utils/fontFamilies'

export { FONT_OPTIONS, fontLabelFor }

// ─── The constants both surfaces obey ───────────────────────────────────────

/** ⭐ 1.4 IS THE SHIPPED VALUE, in both the textarea's CSS and the painter's
 *  `(i + 1) * fs * 1.4`. It is the one number the two already agreed on. */
export const LINE_HEIGHT = 1.4
/** The textarea's `padding: 6px 8px`, now also the painter's. */
export const PAD_X = 8
export const PAD_Y = 6
/** The editor's 1px dashed bounds; a note with a border draws 1px too. */
export const BORDER_W = 1

export const DEFAULT_FONT_SIZE = 13
export const DEFAULT_STACK = 'Instrument Sans, sans-serif'

/**
 * The plate a note gets the moment its Background switch goes on.
 *
 * ⛔ A TOGGLE THAT DOES NOTHING IS A BROKEN TOGGLE. Switching Background on and
 * seeing no change — because no colour has been chosen yet — reads as a bug, and
 * the user's next move is to flip it back off rather than to go hunting for the
 * colour row that appeared underneath it. So "on" means something immediately,
 * and choosing a colour replaces it.
 *
 * ⭐ IT IS THE SAME NEUTRAL PLATE THE MEASUREMENT READOUTS USE. The drawing layer
 * already has one answer to "a dark, slightly transparent panel under text on a
 * chart"; a second, subtly different one would be a new colour in the system for
 * no reason.
 */
export const DEFAULT_TEXT_BG = 'rgba(20, 22, 18, 0.82)'

/** The plate actually painted: the user's choice, else the default. */
export const bgColorOf = (d) => (d && d.bgColor) || DEFAULT_TEXT_BG

// ─── Typography ─────────────────────────────────────────────────────────────

export const fontSizeOf = (d) => {
  const v = d && d.fontSize
  return (typeof v === 'number' && Number.isFinite(v) && v > 0) ? v : DEFAULT_FONT_SIZE
}

/** The CSS font-family stack for a note. `''`/absent = the drawing layer's own
 *  face, which is what every note drawn before Phase 6 is using. */
export const fontStackOf = (d) => (d && d.fontFamily) || DEFAULT_STACK

export const isBold = (d) => !!(d && d.bold)
export const isItalic = (d) => !!(d && d.italic)

/**
 * The shorthand both `ctx.font` and `style.font` accept.
 *
 * ⛔ ORDER IS PART OF THE GRAMMAR: style, then weight, then size, then family.
 * Canvas silently ignores a font string it cannot parse and keeps whatever was
 * set before — so a mis-ordered shorthand does not throw, it just quietly draws
 * the previous drawing's font, which is the hardest kind of bug to see.
 */
export function fontStringFor(drawing) {
  const parts = []
  if (isItalic(drawing)) parts.push('italic')
  if (isBold(drawing)) parts.push('700')
  parts.push(`${fontSizeOf(drawing)}px`)
  parts.push(fontStackOf(drawing))
  return parts.join(' ')
}

/** New notes are laid out from the box corner; notes without the marker keep
 *  the placement they were drawn with. */
export const usesBoxOrigin = (d) => (d && d.textOrigin) === 'box'

// ─── Measurement caches ─────────────────────────────────────────────────────
//
// ⛔ TEXT IS THE EXPENSIVE DRAWING, AND ALMOST NONE OF IT CHANGES PER FRAME.
// Laying out one note means wrapping it (a `measureText` per token, per
// candidate line), measuring every finished line to size the box, and asking the
// font for its ascent — and `redraw` runs on every frame the visible range
// moves. Measured with 60 notes on screen, that was ~29,000 `measureText` calls
// against 15,500 lines actually drawn: nearly two measurements per painted line,
// every frame, for an answer that had not changed since the last one.
//
// ⭐ THE LAYOUT IS A PURE FUNCTION OF (font, wrap width, text), so it is cached
// on exactly those three. Panning and zooming change none of them; editing the
// note, restyling it or resizing its box change one, and the entry is simply
// missed. Same bounded-and-dropped policy as `drawingLabels`: an LRU costs more
// bookkeeping than the measurement it saves, and the cache refills in a frame.
const MAX_CACHE = 400
let _layout = new Map()
let _ascent = new Map()

/** Test seam, and the door for a font-loading change. */
export function _clearTextCache() { _layout = new Map(); _ascent = new Map() }

// ─── Layout ─────────────────────────────────────────────────────────────────

/**
 * How far below a line box's top the baseline sits.
 *
 * ⭐ ASKED OF THE FONT, NOT GUESSED. `fontBoundingBoxAscent` is the same metric
 * the browser lays a CSS line box out with, so using it is what makes the canvas
 * and the textarea land on the same pixel rather than merely close. The `0.8em`
 * fallback is for jsdom and very old engines, where nothing is being displayed
 * to a person anyway.
 *
 * The half-leading term is CSS's own rule: a line box taller than the em box
 * splits the difference above and below.
 */
export function baselineOffset(ctx, fs, lineH) {
  // The ascent depends only on the font, so it is asked once per font per session
  // rather than once per note per frame.
  const key = ctx.font
  let ascent = _ascent.get(key)
  if (ascent === undefined) {
    ascent = fs * 0.8
    try {
      const m = ctx.measureText('M')
      if (m && Number.isFinite(m.fontBoundingBoxAscent) && m.fontBoundingBoxAscent > 0) {
        ascent = m.fontBoundingBoxAscent
      }
    } catch { /* no metrics — the fallback is fine */ }
    if (_ascent.size >= MAX_CACHE) _ascent = new Map()
    _ascent.set(key, ascent)
  }
  return (lineH - fs) / 2 + ascent
}

/**
 * Everything needed to draw — or to place an editor over — one note.
 *
 * ⛔ THE CALLER MUST HAVE SET `ctx.font` ALREADY (via `fontStringFor`), because
 * both the wrap and the ascent depend on it. Measuring under one font and
 * drawing under another is how a box ends up the wrong size for its own text.
 *
 * @returns {{x,y,w,h,textX,textTop,lineH,firstBaseline,lines}} box in canvas px
 */
export function textBoxFor(ctx, drawing, ax, ay, measureLine) {
  const fs = fontSizeOf(drawing)
  const lineH = fs * LINE_HEIGHT
  const wrapW = drawing && drawing.boxWidth ? drawing.boxWidth : null
  const text = String(drawing?.text ?? '')

  // ⭐ THE WRAP AND THE WIDTH TOGETHER, ON ONE KEY. They are computed from the
  // same three inputs and are always wanted together, so caching them
  // separately would double the lookups to save nothing.
  const key = `${ctx.font}\u0000${wrapW}\u0000${text}`
  let hit = _layout.get(key)
  if (hit === undefined) {
    const lines = measureLine(ctx, text, wrapW)
    let widest = 0
    for (const l of lines) widest = Math.max(widest, ctx.measureText(l).width)
    hit = { lines, contentW: wrapW || widest }
    if (_layout.size >= MAX_CACHE) _layout = new Map()
    _layout.set(key, hit)
  }
  const { lines, contentW } = hit

  if (usesBoxOrigin(drawing)) {
    // The corner IS the anchor. Text starts one padding + one border in.
    const textX = ax + PAD_X + BORDER_W
    const textTop = ay + PAD_Y + BORDER_W
    return {
      x: ax, y: ay,
      w: contentW + (PAD_X + BORDER_W) * 2,
      h: lines.length * lineH + (PAD_Y + BORDER_W) * 2,
      textX, textTop, lineH, lines,
      firstBaseline: textTop + baselineOffset(ctx, fs, lineH),
    }
  }

  // ⚰️ THE SHIPPED PLACEMENT, preserved exactly: text at the anchor's x, first
  // baseline a full line-height below its y. The BOX is derived backwards from
  // that so everything else (editor, hit test, background) still lines up with
  // the ink — the note does not move, it merely becomes grabbable where it is.
  const textX = ax
  const firstBaseline = ay + lineH
  const textTop = firstBaseline - baselineOffset(ctx, fs, lineH)
  return {
    x: textX - PAD_X - BORDER_W,
    y: textTop - PAD_Y - BORDER_W,
    w: contentW + (PAD_X + BORDER_W) * 2,
    h: lines.length * lineH + (PAD_Y + BORDER_W) * 2,
    textX, textTop, lineH, lines, firstBaseline,
  }
}

/** The `style` object for the editor, so it cannot drift from the painter. */
export function editorTextStyle(drawing) {
  return {
    fontFamily: fontStackOf(drawing),
    fontSize: `${fontSizeOf(drawing)}px`,
    fontWeight: isBold(drawing) ? 700 : 400,
    fontStyle: isItalic(drawing) ? 'italic' : 'normal',
    lineHeight: LINE_HEIGHT,
    padding: `${PAD_Y}px ${PAD_X}px`,
  }
}
