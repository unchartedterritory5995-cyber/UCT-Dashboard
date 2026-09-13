/* One measurement language, for the three tools that measure.
 *
 * ─── WHY THIS MODULE EXISTS ─────────────────────────────────────────────────
 *
 * Measure, Bars & Time and Price Move ask overlapping questions — how far did
 * price move, how many bars, how long — and before this file they answered them
 * in three different places with three different rules:
 *
 *   • `renderMeasure` computed `(diff / p1Price) * 100` inline and printed
 *     `toFixed(2)`, and read a bar count the OVERLAY had stored at creation.
 *   • `computeAdvancePct` used a completely different basis (low→high for an
 *     advance, high→low for a decline) and lived in `drawingGeometry`.
 *   • Elapsed time did not exist anywhere.
 *
 * ⛔ THE POINT IS NOT DE-DUPLICATION, IT IS AGREEMENT. Two tools dropped on the
 * SAME two anchors must not print different numbers. That is a bug a user finds
 * instantly and cannot un-see, and no amount of per-tool testing catches it,
 * because each tool is self-consistently wrong. So the shared question is asked
 * once, here, and the tools differ only in WHICH questions they ask and how they
 * lay the answers out.
 *
 * ⭐ AND THE THINGS THAT ARE GENUINELY NOT SHARED STAY UNSHARED. Price Move
 * measures a candle's low→high (the size of a run), while Measure measures
 * anchor→anchor (what the user pointed at). Those are different questions with
 * different right answers, and collapsing them would break both.
 */
import { PERIOD_SECONDS } from './barTime'
import { formatDelta, formatPercent } from './drawingLabels'

// ─── Bars ───────────────────────────────────────────────────────────────────

/**
 * How many bars between two chart anchors.
 *
 * ⛔ THE CONVENTION IS **DISTANCE**, NOT INCLUSIVE COUNT: anchors on bar 100 and
 * bar 125 are `25 bars`, not 26. That is the arithmetic the shipped Measure tool
 * already stored (`Math.abs(idx1 - idx0)` at creation), so it is the number
 * every existing Measure drawing on every chart is showing right now, and
 * changing it would silently restate all of them.
 *
 * It is also the answer the question wants. "How many bars is this move?" is
 * asking how far the market travelled, and a move that starts and ends on the
 * same bar has travelled zero bars, not one. Bars & Time uses this same
 * function, so the two tools cannot disagree on the same two points.
 */
export function barSpan(idxA, idxB) {
  if (!Number.isFinite(idxA) || !Number.isFinite(idxB)) return null
  return Math.abs(idxB - idxA)
}

// ─── Time ───────────────────────────────────────────────────────────────────

/** Seconds per bar for a NAMED timeframe. Kept for callers that have the
 *  timeframe string to hand; `inferBarSeconds` is preferred where they do not. */
export const barSecondsFor = (tf) =>
  PERIOD_SECONDS[tf] || (tf === 'W' ? 604800 : tf === 'M' ? 2592000 : 86400)

/**
 * Seconds per bar, read off the BARS THEMSELVES.
 *
 * ⭐ THE DATA ALREADY KNOWS, SO NOBODY HAS TO BE TOLD. The alternative was
 * threading a `timeframe` prop through five mount sites to a layer that has
 * never needed one — and then keeping it correct. The median gap between
 * consecutive bars answers the same question from what is already in hand.
 *
 * ⛔ MEDIAN, NOT MEAN, because the gaps are full of weekends, holidays and
 * overnights. On a daily chart roughly two thirds of the gaps are 1 day and the
 * rest are 3; the mean of that is 1.6 days and the median is exactly 1. The
 * outliers are the very thing that makes calendar time worth showing separately,
 * so the estimator must be the one they cannot move.
 *
 * Only ever used to extrapolate into EMPTY future space, where by definition
 * there is no real timestamp to prefer.
 */
export function inferBarSeconds(bars) {
  const n = bars ? bars.length : 0
  if (n < 2) return 86400
  // A bounded sample off the end: recent spacing is the spacing that matters,
  // and a 13,000-bar history should not cost a full scan every frame.
  const gaps = []
  for (let i = Math.max(1, n - 200); i < n; i++) {
    const a = toSeconds(bars[i - 1]?.t), b = toSeconds(bars[i]?.t)
    if (a != null && b != null && b > a) gaps.push(b - a)
  }
  if (!gaps.length) return 86400
  gaps.sort((x, y) => x - y)
  return gaps[Math.floor(gaps.length / 2)] || 86400
}

/**
 * An anchor's timestamp, in seconds, honouring future-bar anchors.
 *
 * ⛔ A DRAWING CAN BE ANCHORED WHERE THERE IS NO BAR. Phase 0 kept `futureBars`
 * — an anchor dragged into the empty right-pad stores the last real bar's time
 * plus a count of bars past it, because there is no timestamp to store. Asking
 * such an anchor "what time are you?" has to extrapolate from the timeframe's
 * spacing, and the result is flagged so the caller knows it did.
 *
 * ⭐ THE FLAG IS DELIBERATELY NOT SHOWN TO THE USER. Someone measuring into
 * hypothetical bars already knows they are hypothetical; a "~" on the number
 * would explain something nobody asked and would appear on a value that is, for
 * the purpose they are using it for, exactly right.
 */
export function anchorSeconds(point, { bars = [], barSeconds = null } = {}) {
  if (!point) return { seconds: null, extrapolated: false }
  const fb = Number.isFinite(point.futureBars) ? point.futureBars : 0
  if (fb > 0 && bars.length) {
    const last = toSeconds(bars[bars.length - 1]?.t)
    if (last == null) return { seconds: null, extrapolated: true }
    const step = Number.isFinite(barSeconds) && barSeconds > 0 ? barSeconds : inferBarSeconds(bars)
    return { seconds: last + fb * step, extrapolated: true }
  }
  return { seconds: toSeconds(point.time), extrapolated: false }
}

/**
 * A bar time → seconds. Handles both shapes the chart carries: a numeric epoch
 * (intraday, and daily on most feeds) and a `YYYY-MM-DD` string (daily/weekly/
 * monthly on others).
 *
 * ⭐ THE INTRADAY ET SHIFT IS NOT UNDONE HERE, AND DOES NOT NEED TO BE. Every
 * caller subtracts two of these, and a constant offset applied to both cancels.
 * Undoing it would need the offset threaded through four more call sites to
 * produce an identical answer.
 */
export function toSeconds(t) {
  if (typeof t === 'number' && Number.isFinite(t)) return t
  if (typeof t === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], 0, 0, 0) / 1000
  }
  return null
}

/**
 * Calendar seconds between two anchors.
 *
 * ⛔ CALENDAR TIME, NEVER `bars × timeframe`. Ten daily bars can span fourteen
 * calendar days; ten 5-minute bars across a session boundary can span sixteen
 * hours. Multiplying the bar count by the frame produces a number that looks
 * authoritative and is wrong every weekend, every holiday and every overnight —
 * which is precisely when a trader is most likely to be asking.
 *
 * Bars answers "how many chart bars?". Time answers "how much time passed?".
 * They are different questions and this tool shows both.
 */
export function elapsedBetween(a, b, ctx) {
  const A = anchorSeconds(a, ctx), B = anchorSeconds(b, ctx)
  if (A.seconds == null || B.seconds == null) return { seconds: null, extrapolated: false }
  return {
    seconds: Math.abs(B.seconds - A.seconds),
    extrapolated: A.extrapolated || B.extrapolated,
  }
}

// ─── Duration formatting ────────────────────────────────────────────────────

const MIN = 60, HOUR = 3600, DAY = 86400
// Calendar-average lengths. ⭐ ONLY the coarse buckets use these, where "8mo"
// is a shape and not a claim about a specific 8 months.
const MONTH = 30.44 * DAY, YEAR = 365.25 * DAY

/**
 * A duration as chart chrome: compact, deterministic, no prose.
 *
 * ⛔ THIS IS A LADDER, NOT A BREAKDOWN. A breakdown ("6 weeks, 2 days, 3 hours
 * and 15 minutes") is correct and useless: it is four numbers where the reader
 * wanted one, it changes width constantly, and at chart scale it is noise
 * wrapped around a fact. Each rung shows the ONE unit that carries the meaning
 * at that magnitude, plus at most one subordinate unit, and drops the
 * subordinate entirely when it is zero — so `6w` and `6w 2d` are both possible
 * and `6w 0d` never is.
 *
 *   < 1 min   → `<1m`     (a duration, not a rounding artefact)
 *   < 1 hour  → `45m`
 *   < 1 day   → `6h 30m`  → `6h` when the minutes are zero
 *   < 14 days → `9d`
 *   < 10 wks  → `6w 2d`   → `6w`
 *   < 24 mos  → `8mo`
 *   else      → `2y 3mo`  → `2y`
 */
export function formatDuration(seconds) {
  // ⛔ REJECT THE EMPTIES BEFORE COERCING. `Number(null)` is 0 and `Number('')`
  // is 0, so a missing duration would print `<1m` — a real-looking answer to a
  // question nobody could answer.
  if (seconds === null || seconds === undefined || seconds === '') return ''
  const s = Number(seconds)
  if (!Number.isFinite(s) || s < 0) return ''
  if (s < MIN) return '<1m'
  if (s < HOUR) return `${Math.floor(s / MIN)}m`
  if (s < DAY) {
    const h = Math.floor(s / HOUR)
    const m = Math.floor((s % HOUR) / MIN)
    return m ? `${h}h ${m}m` : `${h}h`
  }
  const days = Math.floor(s / DAY)
  if (days < 14) return `${days}d`
  if (days < 70) {
    const w = Math.floor(days / 7)
    const d = days % 7
    return d ? `${w}w ${d}d` : `${w}w`
  }
  // ⛔ ROUNDED, NOT FLOORED, FROM HERE UP. A month is 30.44 days, so two years
  // is 23.998 months — floored, that is `23mo`, and a chart would report a span
  // of exactly two years as twenty-three months. At this magnitude the number is
  // a shape rather than a claim, and rounding is the shape a reader expects.
  const months = Math.round(s / MONTH)
  if (months < 24) return `${months}mo`
  let y = Math.floor(s / YEAR)
  let mo = Math.round((s - y * YEAR) / MONTH)
  if (mo >= 12) { y += 1; mo = 0 }      // 11.6 months rounds up into the next year
  return mo ? `${y}y ${mo}mo` : `${y}y`
}

// ─── Price ──────────────────────────────────────────────────────────────────

/**
 * The move between two anchor prices, in the order the user placed them.
 *
 * ⛔ ANCHOR ORDER, NEVER NORMALISED BOUNDS. `boundsOf` sorts the corners, so a
 * measurement read off it prints `+8.31%` whether the user dragged up or down —
 * the direction, which is the single most important thing about a move, is
 * thrown away by the very helper that makes the box easy to draw.
 */
export function priceMove(from, to) {
  // ⛔ `Number(null)` IS 0, so an unresolved anchor would measure a move from
  // zero — an infinite percentage on a real-looking line. Reject first.
  for (const v of [from, to]) if (v === null || v === undefined || v === '') return null
  const a = Number(from), b = Number(to)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  const delta = b - a
  const pct = Math.abs(a) > 0 ? (delta / Math.abs(a)) * 100 : null
  return { delta, pct }
}

// ─── Which fields does this drawing show? ───────────────────────────────────

/**
 * ⛔ THE DEFAULT IS PER TYPE, WHICH IS WHY IT CANNOT LIVE IN `DRAWING_DEFAULTS`.
 *
 * `drawingProp` resolves one flat default per property name, and that is right
 * for `lineWidth` — but "does this drawing show a dollar change?" has FOUR
 * correct answers depending on what the drawing is. A legacy Measure shows
 * dollar and percent and bars; a legacy Price Move shows percent alone; the
 * half-landed dateRange showed bars alone. A single flat `showDollar: false`
 * would have blanked the dollar figure off every Measure ever drawn.
 *
 * So this table IS the legacy appearance, transcribed from `renderMeasure` and
 * `renderAdvance`, and it only ever applies to a drawing that carries no
 * explicit answer of its own. New drawings are stamped at creation
 * (`newDrawingProps`), so they never reach this table.
 */
export const LEGACY_FIELDS = Object.freeze({
  //                dollar  percent  bars   time
  measure:    Object.freeze({ dollar: true, percent: true, bars: true, time: false }),
  priceRange: Object.freeze({ dollar: true, percent: true, bars: false, time: false }),
  dateRange:  Object.freeze({ dollar: false, percent: false, bars: true, time: false }),
  advance:    Object.freeze({ dollar: false, percent: true, bars: false, time: false }),
})

const NO_FIELDS = Object.freeze({ dollar: false, percent: false, bars: false, time: false })
const PROP_OF = { dollar: 'showDollar', percent: 'showPercent', bars: 'showBars', time: 'showTime' }

/** What this drawing displays: its own answer where it has one, the legacy
 *  appearance of its type where it does not. */
export function fieldsFor(drawing) {
  const legacy = LEGACY_FIELDS[drawing?.type] || NO_FIELDS
  const out = {}
  for (const k of ['dollar', 'percent', 'bars', 'time']) {
    const own = drawing ? drawing[PROP_OF[k]] : undefined
    out[k] = own === undefined || own === null ? legacy[k] : !!own
  }
  return out
}

/** One field, for a menu toggle that must show what the canvas is showing. */
export const fieldOn = (drawing, prop) => {
  const key = Object.keys(PROP_OF).find((k) => PROP_OF[k] === prop)
  return key ? fieldsFor(drawing)[key] : false
}

// ─── Label position ─────────────────────────────────────────────────────────

export const LABEL_POSITIONS = Object.freeze(['top', 'center', 'bottom'])
export const DEFAULT_LABEL_POS = 'center'

export const labelPosOf = (drawing) => {
  const v = drawing && drawing.labelPos
  return LABEL_POSITIONS.includes(v) ? v : DEFAULT_LABEL_POS
}

/**
 * Where a label of height `h` sits inside a band, honouring the request but
 * never leaving the pane.
 *
 * ⛔ FLIP, DON'T CLIP. A measurement whose text is cut in half is worse than one
 * a few pixels from where it was asked for — the number is the entire product of
 * the tool. So Top that would not fit tries Bottom, Bottom that would not fit
 * tries Top, and Center is the answer when neither end has room. Nothing is ever
 * truncated and nothing is ever suppressed.
 */
export function resolveLabelY(pos, band, h, bounds, pad = 4) {
  const { y0, y1 } = band
  const mid = (y0 + y1) / 2 - h / 2
  const at = { top: y0 + pad, center: mid, bottom: y1 - h - pad }
  const fits = (y) => !bounds || (y >= bounds.y0 && y + h <= bounds.y1)
  const order = pos === 'top' ? ['top', 'bottom', 'center']
    : pos === 'bottom' ? ['bottom', 'top', 'center']
      : ['center', 'top', 'bottom']
  for (const key of order) if (fits(at[key])) return at[key]
  return mid
}

// ─── The lines a measurement label shows ────────────────────────────────────

/**
 * Build the label for a measurement, as an array of lines.
 *
 * ⭐ TWO LINES, AND THE SPLIT IS BY QUESTION, NOT BY LENGTH. Price lives on the
 * first line and time on the second, always, so the reader's eye learns one
 * place to look — "what did it do" above, "over what" below. A single line
 * carrying all four fields reads as a run-on
 * (`+50.68 (+18.90%) · 25 bars · 6w 2d`) and gets wide enough to overflow the
 * box it is measuring; four separate lines is a paragraph. When only one row has
 * anything in it, only one row is drawn, so a bars-only ruler is one line tall.
 *
 * Returns `[]` when the drawing has nothing to say, which is the caller's cue to
 * draw no chip at all rather than an empty one.
 */
export function measureLines(drawing, values, fmt) {
  const f = fieldsFor(drawing)
  const price = []
  if (f.dollar && values.delta != null) price.push(formatDelta(values.delta, { fmt }))
  if (f.percent && values.pct != null) {
    // Parenthesised only when it is the SECOND thing on the row — on its own it
    // is the statement, not an aside.
    price.push(price.length ? `(${formatPercent(values.pct)})` : formatPercent(values.pct))
  }
  const span = []
  if (f.bars && values.bars != null) span.push(`${values.bars} ${values.bars === 1 ? 'bar' : 'bars'}`)
  if (f.time && values.duration) span.push(values.duration)

  const lines = []
  if (price.length) lines.push(price.join(' '))
  if (span.length) lines.push(span.join(' · '))
  return lines
}

// ─── The whole measurement, in one call ─────────────────────────────────────

/**
 * Everything the three tools might want to show, for one pair of anchors.
 *
 * ⭐ ONE CALL, SO TWO TOOLS CANNOT DISAGREE. Dropping a Measure and a Bars &
 * Time on the same two candles must give the same bar count and the same
 * duration; the only way to guarantee that is for both of them to be reading
 * the same return value of the same function.
 *
 * ⛔ IT IS DERIVED EVERY FRAME, NEVER STORED.
 *
 * ⚰️ The shipped Measure stored `barCount` at creation and printed it forever.
 * Resize the box and the count stayed put. Switch from daily to weekly and a
 * 25-bar measurement went on claiming 25 bars while spanning five. Drag one
 * endpoint across a month and nothing moved. The number was a fossil of the
 * moment the drawing was made, and it was wrong the first time anybody touched
 * the drawing again. Deriving it costs two map lookups.
 *
 * @param {object[]} points   the drawing's stored anchors
 * @param {object[]} pixels   the same anchors resolved (for rawPrice)
 * @param {object} ctx        { bars, indexOf, barSeconds }
 */
export function measurementFor(points, pixels, { bars = [], indexOf = null, barSeconds = null } = {}) {
  const pts = points || []
  const a = pts[0], b = pts[pts.length - 1]
  const px = pixels || []
  const pa = px[0], pb = px[px.length - 1]

  // ⛔ THE FUTURE-BAR OFFSET IS PART OF THE INDEX. An anchor in the empty
  // right-pad stores the LAST bar's time plus a count; asking `indexOf` for its
  // time would return the last bar for both ends of a span that is entirely in
  // future space, and report 0 bars for a real distance.
  const last = bars.length - 1
  const idx = (p) => {
    if (!p) return null
    const fb = Number.isFinite(p.futureBars) ? p.futureBars : 0
    if (fb > 0) return last + fb
    const i = indexOf ? indexOf(p.time) : null
    return i == null ? null : i
  }

  const move = priceMove(pa?.rawPrice, pb?.rawPrice)
  const el = elapsedBetween(a, b, { bars, barSeconds })
  return {
    delta: move ? move.delta : null,
    pct: move ? move.pct : null,
    bars: barSpan(idx(a), idx(b)),
    seconds: el.seconds,
    duration: el.seconds == null ? '' : formatDuration(el.seconds),
    extrapolated: el.extrapolated,
  }
}

/**
 * Price Move's label, as lines.
 *
 * ⛔ THE PERCENTAGE STAYS ROUNDED TO A WHOLE NUMBER, WITH ITS THOUSANDS
 * SEPARATOR. `+1,156%` is what this tool has always printed and it is the right
 * voice for it: Price Move answers "how big was that run", where the second
 * decimal is noise and the comma is what makes a four-figure move readable. Two
 * decimals here would also silently restate every Price Move label already on a
 * chart, which the brief rules out. Measure keeps full precision — it answers a
 * different, finer question.
 *
 * ⛔ AND NO CURRENCY SYMBOL, for the same reason Measure has never had one: the
 * amount is written by the SERIES' own formatter, which knows the instrument's
 * precision and says nothing about its denomination. Prefixing `$` here would be
 * this layer asserting something it does not know, on the one surface where a
 * non-USD instrument would make it wrong.
 *
 * Returns one line, because the two figures are one statement.
 */
export function advanceLines(drawing, fmt) {
  const f = fieldsFor(drawing)
  const parts = []
  if (f.dollar && drawing && drawing.advDelta != null && Number.isFinite(drawing.advDelta)) {
    parts.push(formatDelta(drawing.advDelta, { fmt }))
  }
  if (f.percent && drawing && drawing.advPct != null && Number.isFinite(drawing.advPct)) {
    const n = Math.round(drawing.advPct)
    const pct = `${n >= 0 ? '+' : ''}${n.toLocaleString('en-US')}%`
    parts.push(parts.length ? `(${pct})` : pct)
  }
  return parts.length ? [parts.join(' ')] : []
}
