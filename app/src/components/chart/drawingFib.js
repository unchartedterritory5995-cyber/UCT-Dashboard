/* The Fibonacci level system — one model, two tools.
 *
 * ─── THE DATA MODEL, AND WHY IT IS SPARSE ───────────────────────────────────
 *
 * ⛔ A DRAWING STORES ONLY WHAT DIFFERS FROM THE CANONICAL TABLE. Not an array
 * of eleven level objects; a map of the handful the user actually changed:
 *
 *     levels: { '0.382': { visible: false }, '0.618': { color: '#ff5b5b' } }
 *     fills:  { '0.5>0.618': { enabled: true, color: '#3f7fe033' } }
 *
 * ⭐ THE ALTERNATIVE — materialising every level onto every drawing — fails in
 * four ways at once, and all four are the kind that only show up later:
 *
 *   • ADDING A CANONICAL LEVEL becomes a migration. With an array, a Fib saved
 *     today has 7 entries and the app expects 9; with a map, a drawing that
 *     never mentioned 0.886 simply inherits it.
 *   • CHANGING A DEFAULT COLOUR stops working. Every drawing would be carrying
 *     a frozen copy of the old palette, so the table would no longer be the
 *     source of truth for anything.
 *   • ORDER LEAVES THE CENTRE. Levels would render in each drawing's stored
 *     order, which drifts between drawings made in different builds.
 *   • EVERY SAVED FIB TRIPLES IN SIZE, in localStorage, in the Tracings
 *     document and in the synced preference blob, to record defaults.
 *
 * ⛔ AND THE KEY IS A CANONICAL STRING, NEVER A FLOAT. `0.1 + 0.2` is not `0.3`,
 * and a level looked up by float equality would silently miss and read as
 * "unconfigured" — the user's override would vanish and reappear depending on
 * how the number was arrived at. `levelKey` rounds to a fixed precision and
 * strips trailing zeros, so 0.5, 0.50 and 0.4999999999 all resolve to `'0.5'`.
 *
 * ─── BANDS BELONG TO PAIRS, NOT TO LINES ────────────────────────────────────
 *
 * ⭐ A FILL IS BETWEEN TWO LEVELS, so it is keyed by both of them — and it is
 * INDEPENDENT OF WHETHER EITHER LINE IS VISIBLE. Hiding the 0.382 line is a
 * statement about a line; it must not silently destroy a 0.236→0.382 band the
 * user configured. Line visibility and band visibility are separate facts about
 * separate things, and conflating them makes a styling click destructive.
 */

// ─── The canonical tables ───────────────────────────────────────────────────
//
// ⚰️ THESE MOVED OUT OF `drawingRenderers.js`, which re-exports them so nothing
// that imports them from there had to change. They are data, not painting, and
// the settings menu, the hit test and the alert anchors all need them now.

export const FIB_LEVELS = Object.freeze([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1])
export const FIB_COLORS = Object.freeze(['#ef4444', '#fb923c', '#c9a84c', '#a8a290', '#4ade80', '#60a5fa', '#a78bfa'])

export const FIB_EXT_LEVELS = Object.freeze([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618, 2, 2.618])
export const FIB_EXT_COLORS = Object.freeze(['#ef4444', '#fb923c', '#c9a84c', '#a8a290', '#4ade80', '#60a5fa', '#a78bfa', '#e879f9', '#f472b6', '#22d3ee', '#818cf8'])

export const isFib = (type) => type === 'fib' || type === 'fibext'

export const levelsFor = (type) => (type === 'fibext' ? FIB_EXT_LEVELS : FIB_LEVELS)
export const colorsFor = (type) => (type === 'fibext' ? FIB_EXT_COLORS : FIB_COLORS)

// ─── Keys ───────────────────────────────────────────────────────────────────

/** The canonical string for a level value. Deterministic for any arithmetic
 *  that lands within 1e-6 of a table entry. */
export function levelKey(v) {
  // ⛔ REJECT THE EMPTIES BEFORE COERCING. `Number(null)` is 0 and `Number('')`
  // is 0, so a missing level would resolve to the key for level ZERO — and an
  // alert or an override meant for nothing would land on the swing high.
  if (v === null || v === undefined || v === '') return ''
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  // 6dp is well inside the spacing of any level anyone has ever used (0.146
  // between 0.236 and 0.382) and well outside float noise.
  return String(+n.toFixed(6))
}

/** The canonical key for the band between two levels. Sorted, so `0.5>0.618`
 *  and `0.618>0.5` are the same band however the caller arrived at it. */
export function bandKey(a, b) {
  const x = Number(a), y = Number(b)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return ''
  return x <= y ? `${levelKey(x)}>${levelKey(y)}` : `${levelKey(y)}>${levelKey(x)}`
}

/** The adjacent pairs a tool's table defines — the bands a user can fill. */
export function bandsFor(type) {
  const ls = levelsFor(type)
  const out = []
  for (let i = 0; i < ls.length - 1; i++) out.push([ls[i], ls[i + 1]])
  return out
}

// ─── Resolution ─────────────────────────────────────────────────────────────

/**
 * ⚰️ THE DASH PATTERN IS THE SHIPPED LADDER, PRESERVED EXACTLY. Retracement drew
 * the 0 and 1 lines solid and everything between them `[4,3]`; extension added
 * `[6,3]` for anything past 1. It is not configurable in this phase and it is
 * not worth changing — a solid pair of bookends with dashed interior levels is
 * how every Fib on every platform reads.
 */
export function dashForLevel(type, level) {
  if (type === 'fibext' && level > 1) return [6, 3]
  return (level === 0 || level === 1) ? [] : [4, 3]
}

/**
 * The effective style of every level on one drawing, resolved ONCE.
 *
 * ⛔ ONCE PER RENDER, NOT ONCE PER LEVEL PER FRAME. A Fib is up to eleven lines,
 * eleven labels and ten bands; looking each of them up individually would mean
 * ~30 map reads and as many key formats inside the paint loop of a tool that
 * often appears half a dozen times on a chart.
 *
 * A drawing with no overrides returns exactly the canonical table, which is what
 * makes an existing Fib render byte-identically.
 */
export function resolveLevels(drawing) {
  const type = drawing?.type
  const table = levelsFor(type)
  const colors = colorsFor(type)
  const over = (drawing && drawing.levels) || null
  return table.map((level, i) => {
    const o = over ? over[levelKey(level)] : null
    return {
      level,
      key: levelKey(level),
      visible: o && o.visible === false ? false : true,
      color: (o && o.color) || colors[i] || '#a8a290',
      dash: dashForLevel(type, level),
    }
  })
}

/** The bands that should actually be painted, in table order. Empty for a
 *  drawing that has configured none — which is every Fib drawn before Phase 7,
 *  because the shipped tool had no band fill at all. */
export function resolveBands(drawing) {
  const fills = (drawing && drawing.fills) || null
  if (!fills) return []
  const out = []
  for (const [a, b] of bandsFor(drawing?.type)) {
    const k = bandKey(a, b)
    const f = fills[k]
    if (f && f.enabled && f.color) out.push({ from: a, to: b, key: k, color: f.color })
  }
  return out
}

/** One band's stored state, for the editor. */
export function bandState(drawing, a, b) {
  const f = ((drawing && drawing.fills) || {})[bandKey(a, b)]
  return { enabled: !!(f && f.enabled), color: (f && f.color) || DEFAULT_BAND_COLOR }
}

/**
 * ⭐ THE DEFAULT BAND COLOUR IS DERIVED FROM THE LOWER LEVEL'S OWN LINE, at a low
 * alpha — so switching a band on gives an immediate, obviously-related result
 * rather than a grey rectangle the user then has to colour. Same reasoning as
 * Text Note's default plate: a toggle that appears to do nothing reads as broken.
 */
export const DEFAULT_BAND_ALPHA = '26'   // 15%
export const DEFAULT_BAND_COLOR = '#60a5fa26'

export function defaultBandColor(drawing, a) {
  const lv = resolveLevels(drawing).find((l) => l.level === a)
  const base = (lv && lv.color) || '#60a5fa'
  return /^#[0-9a-f]{6}$/i.test(base) ? base + DEFAULT_BAND_ALPHA : DEFAULT_BAND_COLOR
}

// ─── Prices ─────────────────────────────────────────────────────────────────

/**
 * The price a level sits at, for one pair of anchor prices.
 *
 * ⛔ THE TWO TOOLS MEASURE DIFFERENT THINGS AND THIS IS WHERE THAT LIVES.
 * A RETRACEMENT is read from the high of the swing downward: level 0 is the
 * high whichever way the user dragged, so the numbers do not flip when they
 * draw bottom-up. An EXTENSION is directional: level 0 is where they started
 * and level 1 where they ended, because "162% of this move" is meaningless
 * without knowing which way the move went.
 *
 * ⭐ ONE FUNCTION, so the painter, the hit test and the alert anchor cannot
 * disagree about where 0.618 is.
 */
export function fibLevelPrice(type, level, priceA, priceB) {
  // Same trap: an unresolved anchor coerces to 0, and a retracement measured
  // from a swing low of zero prices every level at a plausible-looking number.
  for (const v of [level, priceA, priceB]) if (v === null || v === undefined || v === '') return null
  const a = Number(priceA), b = Number(priceB)
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(Number(level))) return null
  if (type === 'fibext') {
    const range = b - a
    if (range === 0) return null
    return a + range * level
  }
  const high = Math.max(a, b), low = Math.min(a, b)
  const range = high - low
  if (range <= 0) return null
  return high - range * level
}

/** The level price for a drawing, straight from its stored anchors. */
export function levelPriceOf(drawing, level) {
  const pts = drawing?.points || []
  if (pts.length < 2) return null
  return fibLevelPrice(drawing.type, Number(level), pts[0]?.price, pts[1]?.price)
}

// ─── Editing ────────────────────────────────────────────────────────────────

/** A new `levels` map with one level's property changed. Returns a fresh object
 *  (the store is treated as immutable) and drops an override that has become
 *  identical to the default, so the sparse map stays sparse. */
export function withLevel(drawing, level, patch) {
  const k = levelKey(level)
  const next = { ...((drawing && drawing.levels) || {}) }
  const merged = { ...(next[k] || {}), ...patch }
  // `visible: true` and a null colour ARE the defaults — storing them would grow
  // the object to say nothing.
  if (merged.visible === true) delete merged.visible
  if (merged.color === null || merged.color === undefined) delete merged.color
  if (Object.keys(merged).length === 0) delete next[k]
  else next[k] = merged
  return Object.keys(next).length ? next : null
}

/** A new `fills` map with one band changed. */
export function withBand(drawing, a, b, patch) {
  const k = bandKey(a, b)
  const next = { ...((drawing && drawing.fills) || {}) }
  const merged = { ...(next[k] || {}), ...patch }
  if (merged.enabled === false) delete next[k]
  else next[k] = merged
  return Object.keys(next).length ? next : null
}

/**
 * ⭐ RESET REMOVES OVERRIDES; IT DOES NOT MATERIALISE DEFAULTS. Writing the
 * canonical table onto the drawing would "reset" it into exactly the frozen-copy
 * state this model exists to avoid — and the next palette change would leave it
 * behind. Setting both maps to `null` returns the drawing to inheriting.
 *
 * ⛔ AND IT TOUCHES NOTHING ELSE. Not the anchors, not the colour, not the
 * width, and — see Phase 8 — not the alerts. It is a style reset, and a user who
 * has an alert on 0.618 must not lose it by tidying up their colours.
 */
export const RESET_FIB_STYLE = Object.freeze({ levels: null, fills: null })

/** Has this drawing been customised at all? Drives whether Reset is offered. */
export const hasFibOverrides = (d) =>
  !!(d && ((d.levels && Object.keys(d.levels).length) || (d.fills && Object.keys(d.fills).length)))
