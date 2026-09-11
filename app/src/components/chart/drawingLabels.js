/* The label primitive every drawing tool will draw text through.
 *
 * ⛔ PHASE 1 BUILDS IT AND TURNS NOTHING ON. Seven later items want a label —
 * Horizontal Line price, Horizontal Ray price, Rectangle %, Measure's four
 * fields, Price Move's $ and %, Fib level readouts, Bars & Time — and today
 * there are three unrelated implementations of "put text on the canvas": a bare
 * `fillText` at a hard-coded offset (Horizontal Line, Horizontal Ray, Fib), a
 * rounded dark plate (`renderMeasure`'s `putLabel`), and a centred auto-ink
 * string (`renderAdvance`). Building the eighth one per tool is how a drawing
 * system ends up with eight fonts.
 *
 * ⭐ PHASE 1 SHIPPED IT UNUSED; PHASE 4 IS THE FIRST CALLER. The Horizontal
 * Line's and Horizontal Ray's price labels are drawn through `drawLabel` and
 * formatted through `priceFormatterFor`, and the Rectangle's percent label
 * through `drawLabel` + `formatPercent`. That is the point of the module: a tool
 * adds a label by choosing a PLACEMENT, and the choices that must agree across
 * tools — precision, padding, contrast, edge behaviour — stay decided once,
 * here, with tests.
 *
 * ⛔ IT IS A CANVAS PRIMITIVE, NOT A UI FRAMEWORK. No layout engine, no state, no
 * objects allocated per frame beyond the measurement cache. `redraw` runs on
 * every frame the visible range changes, so anything expensive here is paid ~60
 * times a second with 50 drawings on screen.
 */
import { colorLuminance } from './drawingColors'

// ─── text measurement cache ─────────────────────────────────────────────────
//
// ⛔ `measureText` IS THE EXPENSIVE CALL IN A CANVAS LABEL, and a label's text
// and font are stable across frames while the chart pans — the same string is
// re-measured every frame for the life of the drawing. Keyed by font + string,
// because a measurement is only valid for the font that produced it.
//
// Bounded and dropped wholesale rather than evicted one-by-one: an LRU costs
// more bookkeeping than the measurement it saves, and the cache refills in a
// frame. The cap exists so a chart that cycles through thousands of distinct
// price strings cannot grow it without limit.
const MAX_CACHE = 600
let _widths = new Map()

export function measuredWidth(ctx, text, font = ctx.font) {
  // The separator is an escape, not a literal NUL byte. A raw NUL in the source
  // makes git treat this file as BINARY — no diffs, no review, on the module every
  // label goes through. Same key at runtime, and still a character no font name
  // can contain.
  const key = `${font}\u0000${text}`
  const hit = _widths.get(key)
  if (hit !== undefined) return hit
  const prev = ctx.font
  if (font !== prev) ctx.font = font
  const w = ctx.measureText(text).width
  if (font !== prev) ctx.font = prev
  if (_widths.size >= MAX_CACHE) _widths = new Map()
  _widths.set(key, w)
  return w
}

/** Test seam + a door for a future font change. */
export function _clearLabelCache() { _widths = new Map() }

// ─── price formatting ───────────────────────────────────────────────────────

/**
 * A price as a trader reads it.
 *
 * ⚰️ EVERY EXISTING LABEL HARD-CODES `.toFixed(2)`, which is wrong in both
 * directions: it prints `0.00` for a sub-penny name and four meaningless zeros
 * on an index. This is the one rule, so Horizontal Line, Horizontal Ray,
 * Rectangle, Measure and Fib cannot disagree about what a price looks like.
 *
 * `tick` (the instrument's minimum increment) wins when the caller knows it;
 * otherwise the magnitude decides.
 */
export function formatPrice(value, { tick = null, maxDecimals = 6 } = {}) {
  // Number(null) is 0 and Number('') is 0, so a missing value would print a
  // real number nothing is actually at. Reject the empties BEFORE coercing.
  if (value === null || value === undefined || value === '') return ''
  const v = Number(value)
  if (!Number.isFinite(v)) return ''
  if (tick && Number.isFinite(tick) && tick > 0) {
    const dp = Math.min(maxDecimals, Math.max(0, Math.ceil(-Math.log10(tick) - 1e-9)))
    return v.toFixed(dp)
  }
  const a = Math.abs(v)
  if (a === 0) return '0.00'
  if (a < 1) return v.toFixed(4)
  if (a < 1000) return v.toFixed(2)
  return v.toFixed(2)
}

/**
 * ─── the tick table ─────────────────────────────────────────────────────────
 *
 * The minimum price increment, by price. It lives HERE, beside `formatPrice`, because this is
 * already the one place in the app that knows how a price is rendered — `formatPrice` has taken a
 * `tick` since it was written and nothing ever computed one, so every caller fell through to the
 * magnitude branch and every price input in the app stepped by a cent (deferred D-31).
 *
 * ⛔ NEVER A CALLER-SIDE SCALING HACK (owner ruling, A2). A second opinion about what a price step
 * means, living in a gesture handler, would be invisible: a wrong step still produces a plausible
 * number. Callers ASK; they do not decide.
 *
 * The rule is Reg NMS Rule 612 — the sub-penny rule — which is the actual regulation this app's
 * instruments quote under: $0.01 at or above $1.00, $0.0001 below it. So a $0.30 name stops
 * getting cent granularity that is coarse relative to its spread.
 *
 * ⚠️ WHAT THIS TABLE DELIBERATELY DOES NOT MODEL, stated rather than guessed:
 *   • The 2024 Rule 612 amendment's $0.005 tier applies to "tick-constrained" stocks named by a
 *     periodic SEC designation — a per-SYMBOL fact, not a function of price. Inferring it from
 *     price would be inventing a rule, which is the defect this row exists to prevent.
 *   • Futures/FX per-contract ticks. This app charts US equities and ETFs; `priceFormatterFor`
 *     already prefers the SERIES' own `priceFormat` wherever a chart knows better than we do.
 * A caller that genuinely knows an instrument's tick should pass it, exactly as before.
 *
 * Ordered low bound first; `below: null` is the open top.
 */
export const TICK_TABLE = Object.freeze([
  Object.freeze({ below: 1, tick: 0.0001 }),
  Object.freeze({ below: null, tick: 0.01 }),
])

/** The step for a caller with no price at all. The table's top row, never a restated literal. */
export const DEFAULT_TICK = TICK_TABLE[TICK_TABLE.length - 1].tick

/**
 * The minimum increment for a price.
 *
 * Reads the magnitude, so a short position quoted negative and a long one answer the same.
 * Returns `DEFAULT_TICK` for anything that is not a usable price — a missing price must not
 * silently become a sub-penny step.
 *
 * @param {*} price
 * @returns {number} a positive tick from TICK_TABLE
 */
export function tickSizeFor(price) {
  const v = Number(price)
  if (!Number.isFinite(v) || price === null || price === undefined || price === '') return DEFAULT_TICK
  const a = Math.abs(v)
  for (const row of TICK_TABLE) {
    if (row.below === null || a < row.below) return row.tick
  }
  return DEFAULT_TICK
}

/**
 * Snap a value onto a tick, at the tick's own precision.
 *
 * ⭐ The decimal count comes from the tick the SAME way `formatPrice` derives it, so the number a
 * caller stores and the string this module renders can never disagree about precision. Scaling by
 * `1 / tick` instead would reintroduce the float artefact the callers' own `round2` exists to
 * kill (178.10000000000002).
 *
 * @param {*} value
 * @param {number} [tick]
 * @returns {number|null} null when `value` is not a number
 */
export function roundToTick(value, tick = DEFAULT_TICK) {
  if (value === null || value === undefined || value === '') return null
  const v = Number(value)
  if (!Number.isFinite(v)) return null
  const t = Number.isFinite(Number(tick)) && Number(tick) > 0 ? Number(tick) : DEFAULT_TICK
  const dp = Math.max(0, Math.ceil(-Math.log10(t) - 1e-9))
  const scale = 10 ** dp
  return Math.round((v + Number.EPSILON) * scale) / scale
}

/**
 * The price formatter to use for a label — the SERIES' own if it has one.
 *
 * ⭐ THE CHART ALREADY KNOWS THE INSTRUMENT'S PRECISION AND WE SHOULD NOT GUESS
 * IT AGAIN. lightweight-charts builds an `IPriceFormatter` from the series'
 * `priceFormat` (`minMove`, `precision`), which is what paints the price axis
 * and the crosshair tag. Asking it means a drawing's price label reads EXACTLY
 * like the axis tag a few pixels to its right — same decimals, same separators —
 * on a $5,000 index, a $4 name and a sub-penny one alike. A second opinion here
 * would show up as two different prices for the same pixel row.
 *
 * `formatPrice` remains the fallback for every surface that has no series (the
 * Model Book index pane's line mode, a test rig, an older LWC build).
 */
export function priceFormatterFor(series, opts) {
  let fmt = null
  try { fmt = series && typeof series.priceFormatter === 'function' ? series.priceFormatter() : null } catch { fmt = null }
  if (fmt && typeof fmt.format === 'function') {
    return (v) => {
      if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return ''
      try {
        const s = fmt.format(Number(v))
        if (typeof s === 'string' && s) return s
      } catch { /* fall through to our own */ }
      return formatPrice(v, opts)
    }
  }
  return (v) => formatPrice(v, opts)
}

/** A signed percentage: always carries its sign, so +0.00% reads as "flat up". */
export function formatPercent(pct, dp = 2) {
  if (pct === null || pct === undefined || pct === '') return ''
  const v = Number(pct)
  if (!Number.isFinite(v)) return ''
  return `${v >= 0 ? '+' : ''}${v.toFixed(dp)}%`
}

/**
 * A signed price delta.
 *
 * ⭐ `opts.fmt` LETS A CALLER HAND IN THE SERIES' OWN FORMATTER, so a measured
 * move is written with the same precision as the price axis it was measured
 * against. Without it the magnitude default applies, as before. The sign is
 * added here and the magnitude by the formatter, so a formatter that emits its
 * own minus sign cannot produce `+-5.00`.
 */
export function formatDelta(value, opts) {
  if (value === null || value === undefined || value === '') return ''
  const v = Number(value)
  if (!Number.isFinite(v)) return ''
  const body = (opts && typeof opts.fmt === 'function') ? opts.fmt(Math.abs(v)) : formatPrice(Math.abs(v), opts)
  return `${v < 0 ? '-' : '+'}${body}`
}

// ─── ink contrast ───────────────────────────────────────────────────────────

/** Black or white, whichever reads on `bg`. Falls back to white — the drawing
 *  canvas is dark by default and an unreadable label is worse than a slightly
 *  low-contrast one. */
export function inkOn(bg) {
  const lum = colorLuminance(bg)
  if (lum == null) return '#ffffff'
  return lum > 0.5 ? '#000000' : '#ffffff'
}

// ─── the primitive ──────────────────────────────────────────────────────────

export const LABEL_FONT = '600 11px "Instrument Sans", sans-serif'
const PAD_X = 5
const PAD_Y = 3

/**
 * Measure a label without drawing it — the box a caller needs to decide
 * placement, collision or whether it fits at all.
 */
export function labelBox(ctx, text, {
  font = LABEL_FONT, x = 0, y = 0, align = 'left', baseline = 'top',
  padX = PAD_X, padY = PAD_Y, fontSize = 11,
} = {}) {
  const tw = measuredWidth(ctx, String(text ?? ''), font)
  const w = tw + padX * 2
  const h = fontSize + padY * 2
  let bx = x
  if (align === 'center') bx = x - w / 2
  else if (align === 'right') bx = x - w
  let by = y
  if (baseline === 'middle') by = y - h / 2
  else if (baseline === 'bottom') by = y - h
  return { x: bx, y: by, w, h, textW: tw }
}

/**
 * Draw a label, optionally on a chip, optionally nudged to stay inside a rect.
 *
 * @param {object} o
 * @param {string} o.text
 * @param {number} o.x, o.y            anchor
 * @param {string} [o.align]           left | center | right   (of the anchor)
 * @param {string} [o.baseline]        top | middle | bottom
 * @param {string} [o.color]           ink; when `bg` is set and this is omitted,
 *                                     contrast ink is chosen for you
 * @param {string|null} [o.bg]         chip fill; null = bare text
 * @param {number} [o.radius]          chip corner radius
 * @param {object|null} [o.bounds]     rect to keep the label inside
 * @param {boolean} [o.clampToBounds]  nudge into `bounds` instead of overflowing
 * @param {boolean} [o.skipIfOutside]  drop the label entirely when its ANCHOR is
 *                                     outside `bounds` — the right behaviour for
 *                                     a label whose subject has scrolled away,
 *                                     where clamping would pin it to the edge
 * @returns {object|null} the box actually drawn, or null if nothing was drawn
 */
export function drawLabel(ctx, o) {
  const {
    text, x, y, align = 'left', baseline = 'top',
    font = LABEL_FONT, fontSize = 11,
    color = null, bg = null, radius = 3,
    padX = PAD_X, padY = PAD_Y,
    bounds = null, clampToBounds = true, skipIfOutside = false,
    avoid = null,
  } = o || {}
  const str = String(text ?? '')
  if (!str) return null
  if (bounds && skipIfOutside && (x < bounds.x0 - 1 || x > bounds.x1 + 1 || y < bounds.y0 - 1 || y > bounds.y1 + 1)) return null

  const box = labelBox(ctx, str, { font, x, y, align, baseline, padX, padY, fontSize })
  if (bounds && clampToBounds) {
    // ⛔ NUDGE, NEVER SHRINK OR TRUNCATE. A measurement the user cannot finish
    // reading is worse than one that sits a few pixels from where it was asked
    // for. When the label is simply wider than the pane, the left edge wins so
    // the reading starts at a predictable place.
    box.x = Math.min(Math.max(box.x, bounds.x0), Math.max(bounds.x0, bounds.x1 - box.w))
    box.y = Math.min(Math.max(box.y, bounds.y0), Math.max(bounds.y0, bounds.y1 - box.h))
  }
  // Step aside from labels already placed this frame, then RESERVE this spot so
  // the next one steps aside from us. The caller owns the array (one per frame),
  // which is what keeps this a placement rule rather than a layout pass.
  if (avoid) { avoidOverlap(box, avoid, { gap: 2, bounds }); avoid.push(box) }

  ctx.save()
  ctx.font = font
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  if (bg) {
    ctx.fillStyle = bg
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') ctx.roundRect(box.x, box.y, box.w, box.h, radius)
    else ctx.rect(box.x, box.y, box.w, box.h)
    ctx.fill()
  }
  ctx.fillStyle = color || (bg ? inkOn(bg) : '#ffffff')
  ctx.fillText(str, box.x + padX, box.y + box.h / 2)
  ctx.restore()
  return box
}

// ─── multi-line readouts ────────────────────────────────────────────────────

/**
 * The plate a MEASUREMENT reads on.
 *
 * ⛔ TWO PLATE TREATMENTS, AND THE DIFFERENCE IS WHAT THE LABEL IS FOR.
 *
 *   • A PRICE TAG (Phase 4's horizontal line and ray) is painted ON the drawing's
 *     colour with contrast ink, because its whole job is "this line, at this
 *     price" — the colour is half the message and it has to be findable at a
 *     glance among a dozen levels.
 *
 *   • A READOUT (Measure, Bars & Time) sits on this neutral dark plate with the
 *     drawing's colour as the TEXT, because it is several numbers the user is
 *     reading, over their own translucent fill, and a saturated plate that size
 *     in the middle of the chart is a billboard. This exact value is the one
 *     `renderMeasure` has always used, so the shipped Measure look is unchanged.
 *
 * They share the font, the padding, the radius and the contrast rules — one
 * typographic language, two weights of emphasis.
 */
export const READOUT_BG = 'rgba(20, 22, 18, 0.82)'

/** Line height for a stacked readout. Tight enough that two rows still read as
 *  one object rather than as two labels that happen to be near each other. */
export const LINE_H = 14

/**
 * Draw N lines of text on ONE chip.
 *
 * ⚰️ WHAT THIS REPLACES: `renderMeasure`'s `putLabel`, called twice, which drew
 * TWO separate rounded plates four pixels apart. At a glance that reads as two
 * labels rather than one two-line readout, and the two plates were different
 * widths, so the measurement looked ragged. One chip sized to the widest line
 * fixes both and costs one fewer fill per frame.
 *
 * @param {string[]} lines      already-formatted; empty array draws nothing
 * @param {object} o
 * @param {number} o.x, o.y     anchor
 * @param {string} [o.align]    left | center | right
 * @param {string} [o.baseline] top | middle | bottom
 * @param {string} [o.bg]       plate; null for bare text
 * @param {object} [o.bounds]   pane rect to stay inside
 * @returns {object|null} the box drawn
 */
export function drawLabelBlock(ctx, lines, o = {}) {
  const rows = (lines || []).filter((l) => l != null && l !== '')
  if (!rows.length) return null
  const {
    x = 0, y = 0, align = 'center', baseline = 'middle',
    font = LABEL_FONT, color = null, bg = READOUT_BG, radius = 3,
    padX = PAD_X, padY = PAD_Y, lineH = LINE_H,
    bounds = null, clampToBounds = true,
  } = o
  let textW = 0
  for (const r of rows) textW = Math.max(textW, measuredWidth(ctx, r, font))
  const w = textW + padX * 2
  const h = rows.length * lineH + padY * 2
  let bx = x
  if (align === 'center') bx = x - w / 2
  else if (align === 'right') bx = x - w
  let by = y
  if (baseline === 'middle') by = y - h / 2
  else if (baseline === 'bottom') by = y - h
  const box = { x: bx, y: by, w, h, textW }
  if (bounds && clampToBounds) {
    box.x = Math.min(Math.max(box.x, bounds.x0), Math.max(bounds.x0, bounds.x1 - box.w))
    box.y = Math.min(Math.max(box.y, bounds.y0), Math.max(bounds.y0, bounds.y1 - box.h))
  }

  ctx.save()
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (bg) {
    ctx.fillStyle = bg
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') ctx.roundRect(box.x, box.y, box.w, box.h, radius)
    else ctx.rect(box.x, box.y, box.w, box.h)
    ctx.fill()
  }
  ctx.fillStyle = color || (bg ? inkOn(bg) : '#ffffff')
  const cx = box.x + box.w / 2
  rows.forEach((r, i) => ctx.fillText(r, cx, box.y + padY + lineH * i + lineH / 2))
  ctx.restore()
  return box
}

// ─── overlap avoidance ──────────────────────────────────────────────────────

/**
 * Nudge `box` vertically until it stops overlapping anything in `taken`.
 *
 * ⛔ RESTRAINED ON PURPOSE — THIS IS NOT A LAYOUT ENGINE. Two price labels at
 * the same level is the only collision that actually happens (two horizontal
 * lines a few cents apart), and the fix a reader wants is "move one of them a
 * row". So: try below, then above, then give up and draw anyway. A label drawn
 * slightly overlapping is a cosmetic problem; a label suppressed, or a solver
 * that reflows every label on every frame, are worse ones.
 *
 * ⭐ THE CHART'S OWN AXIS TAGS ARE NOT IN `taken`, AND DO NOT NEED TO BE. These
 * labels hug the INSIDE edge of the plot area; lightweight-charts draws its
 * last-price and crosshair tags on the axis itself, to the right of that edge.
 * They cannot overlap, which is a much better answer than arbitrating with them.
 *
 * Mutates and returns `box`; push it onto `taken` afterwards to reserve it.
 */
export function avoidOverlap(box, taken, { gap = 2, bounds = null } = {}) {
  if (!box || !taken || !taken.length) return box
  const hits = (b) => taken.filter((o) => !(b.y + b.h + gap <= o.y || o.y + o.h + gap <= b.y
    || b.x + b.w <= o.x || o.x + o.w <= b.x))
  const clash = hits(box)
  if (!clash.length) return box
  // ⛔ MOVE CLEAR OF WHAT IS ACTUALLY THERE, NOT BY A FIXED STEP. Stepping by
  // "one label height" only works when every label is the same height and lands
  // on the same grid; a `+10.00%` chip beside a `4,213.50` one is neither. So
  // the move is computed from the boxes it collided with: just under the lowest
  // of them, or just over the highest.
  const fits = (y) => (!bounds || (y >= bounds.y0 && y + box.h <= bounds.y1)) && !hits({ ...box, y }).length
  const below = (rows) => Math.max(...rows.map((o) => o.y + o.h)) + gap
  const above = (rows) => Math.min(...rows.map((o) => o.y)) - box.h - gap
  for (const y of [below(clash), above(clash)]) {
    if (fits(y)) { box.y = y; return box }
  }
  // One retry, for the common case where the first move landed on a THIRD label.
  // Then it stops: two labels in the same place is a cosmetic problem, and a
  // solver that keeps searching every frame is a performance one.
  for (const y of [below(clash), above(clash)]) {
    const next = hits({ ...box, y })
    if (!next.length) continue
    const y2 = below(next)
    if (fits(y2)) { box.y = y2; return box }
  }
  return box   // crowded: draw it anyway rather than hide a price
}
