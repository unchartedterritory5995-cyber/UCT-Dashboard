// app/src/components/chart/engine/rescale.js
//
// ─── SCALE A SERVER LINE TO A RATING — the definition's `rescale` (2026-11-12) ──
//
// Deepvue's RS line has a "Rating Period" input: the line is multiplied by one
// number so that it reads like the stock's RS rating for that period (TGTX ends
// at 90, its 6-month rating). The SHAPE is unchanged: every point is multiplied
// by the same factor, so every ratio between two points, every new high and every
// cross of the average is exactly where it was. Only the numbers on the scale move.
//
//   k = target / anchorValue
//
//   target       the rating the member picked, read from the envelope's payload
//                (`to[<choice>]`, a `scalar:` path such as `scalar:rating.m6`)
//   anchorValue  the SERVER's value of the `anchor` column on the bar the rating
//                is dated (`at`, `scalar:rating.asof`): the newest envelope time on
//                or before that date. On a daily chart that is the rating's own
//                session; on a weekly chart, the week holding it.
//
// ⭐⭐ THE ANCHOR IS THE RATING'S DATE, NOT THE LAST BAR, AND k IS FIXED PER
// ENVELOPE. The rating is computed nightly from the session's close, so it
// describes that session: the line equals the rating on the bar the rating
// belongs to. During the session the forming bar's live point (`liveTail.js`) is
// raw `close / benchClose` and is multiplied by the same k, so it moves with
// price, above or below the rating, as the RS line should. Anchoring on the live
// last bar instead would re-pin the line's end to the rating on every tick and
// move the whole history with it, which is the one thing this must never do.
//
// ⛔ FAIL CLOSED, AND SAY SO. Not on a listed timeframe (intraday), no rating (a
// young listing, an ETF without one, a dark pod), no finite positive line value
// on the rating's date: the RAW line is drawn and the summary scalar says why, in
// words the readout prints. Never a guess, never a zero.
//
// ⭐ PRESENTATION, NOT COMPUTE. The choice is never a server input (it is not in
// `meta.serverInputs`), so it does not key the fetch, costs no request and cannot
// change what an alert, a scan or the server reads: they read the raw columns on
// the server. The scaled copy exists only between `serverColumnsFor` and the binder.
//
// PURE. It names no definition: the declaration says which input, which columns
// and which payload paths. `defSchema.validateRescale` holds the grammar.

import { readoutSourceValue } from './readoutSchema'
import { RESCALE_FIELDS, RESCALE_TIMEFRAMES } from './rescaleSchema'

/** The grammar, from its leaf (`rescaleSchema.js`): one import for every reader. */
export { RESCALE_FIELDS, RESCALE_TIMEFRAMES }
/** The payload key the client adds the scale's state under (`scalar:rescale.summary`). */
export const RESCALE_SCALAR = 'rescale'

/** The states `rescaleFactor` answers. Only `applied` multiplies anything. */
export const RESCALE_STATES = Object.freeze(['off', 'applied', 'timeframe', 'unrated', 'noAnchor'])

/** What the readout says when the line is drawn unscaled, by state. */
export const RESCALE_FALLBACK_WORDS = Object.freeze({
  timeframe: 'Daily and weekly charts only: showing the RS line unscaled',
  unrated: 'Not yet rated: showing the RS line unscaled',
  noAnchor: 'No RS line value on the rating\'s date: showing the RS line unscaled',
})

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The definition's `rescale` declaration, or null. */
export function rescaleOf(def) {
  const r = def && typeof def === 'object' ? def.rescale : null
  return isPlainObject(r) ? r : null
}

/** The member's choice for the scale input (stored over the declared default), or undefined. */
export function rescaleChoice(def, inputs) {
  const spec = rescaleOf(def)
  if (!spec || typeof spec.input !== 'string') return undefined
  return readoutSourceValue(`input:${spec.input}`, null, def, inputs || {})
}

/** Is the scale switched on for these inputs (whatever the data then allows)? */
export function rescaleRequested(def, inputs) {
  const spec = rescaleOf(def)
  if (!spec) return false
  const choice = rescaleChoice(def, inputs)
  return choice !== undefined && choice !== spec.off
}

/**
 * The axis format a scaled plot reads in while the scale is chosen, or null.
 * `rescale.precision` decimals (a rating reads `79.25`, not the ratio's `79.2500`),
 * and ONLY while the scale is applied (`scalars.rescale.state`, `withRescaleScalars`):
 * a line left unscaled (intraday, not yet rated) is a ratio near 0.47 and keeps the
 * declared `plots[].precision`, as it does with the scale Off. Measured on a 5m
 * chart 2026-11-12: two decimals printed the raw axis as "0.47 / 0.47".
 */
export function rescalePriceFormat(def, instance, plotKey, scalars) {
  const spec = rescaleOf(def)
  if (!spec || !Number.isInteger(spec.precision)) return null
  if (!Array.isArray(spec.plots) || !spec.plots.includes(plotKey)) return null
  if (!rescaleRequested(def, instance && instance.inputs)) return null
  const state = isPlainObject(scalars) && isPlainObject(scalars[RESCALE_SCALAR]) ? scalars[RESCALE_SCALAR].state : null
  if (state !== 'applied') return null
  return { type: 'price', precision: spec.precision, minMove: Number(`1e-${spec.precision}`) }
}

function tfCode(tf) {
  return String(tf == null ? 'D' : tf).toUpperCase()
}

/**
 * The scale for one envelope, or null for a definition that declares none.
 *
 * @param {object} def
 * @param {{times?: ArrayLike<unknown>, columns?: object, payload?: object}|null} parsed the
 *   landed envelope (`columnsFromWire`): the SERVER's own cells, never the aligned
 *   or live-tailed copy, so k is one number per envelope
 * @param {object} inputs the instance's inputs (declared defaults under the stored)
 * @param {unknown} tf the chart's timeframe code
 * @param {(t: unknown) => number} timeKey the lane's time join (`serverCompute.barTimeKey`)
 * @returns {null|{state: string, choice?: unknown, k?: number, target?: number, asof?: string}}
 */
export function rescaleFactor(def, parsed, inputs, tf, timeKey) {
  const spec = rescaleOf(def)
  if (!spec) return null
  const choice = rescaleChoice(def, inputs)
  if (choice === undefined || choice === spec.off) return { state: 'off' }
  const tfs = Array.isArray(spec.timeframes) ? spec.timeframes : []
  if (!tfs.includes(tfCode(tf))) return { state: 'timeframe', choice }
  const payload = parsed && isPlainObject(parsed.payload) ? parsed.payload : null
  const to = isPlainObject(spec.to) ? spec.to[choice] : undefined
  const target = typeof to === 'string' ? readoutSourceValue(to, payload, def, inputs || {}) : undefined
  if (!isNum(target) || target <= 0) return { state: 'unrated', choice }
  const asof = readoutSourceValue(spec.at, payload, def, inputs || {})
  const key = typeof timeKey === 'function' && asof != null ? timeKey(asof) : NaN
  const times = parsed && parsed.times && typeof parsed.times.length === 'number' ? parsed.times : null
  const col = parsed && isPlainObject(parsed.columns) ? parsed.columns[spec.anchor] : null
  if (!isNum(key) || !times || !col || col.length !== times.length) return { state: 'noAnchor', choice, target }
  // The newest envelope time on or before the rating's date that carries a line
  // value. ⭐ A blank cell is skipped, not fatal: measured in the sandbox
  // 2026-11-12, the rating was dated Nov 11 while the benchmark had no Nov 11 bar
  // yet, so the line ended on Nov 10 ("No SPY bar for Nov 11 yet") and the scale
  // anchors where the line actually ends.
  let anchorValue = NaN
  for (let i = times.length - 1; i >= 0; i -= 1) {
    const t = timeKey(times[i])
    if (!isNum(t) || t > key) continue
    if (isNum(col[i]) && col[i] > 0) { anchorValue = col[i]; break }
  }
  if (!isNum(anchorValue)) return { state: 'noAnchor', choice, target }
  return { state: 'applied', choice, k: target / anchorValue, target, asof: String(asof) }
}

/**
 * The columns with every declared `rescale.plots` column multiplied by k.
 * Returns the SAME object unless the scale is applied (identity, so a memo keyed
 * on it still hits); otherwise a shallow copy with COPIED columns: the aligned
 * columns of a cached envelope are never mutated.
 */
export function withRescale(def, columns, factor) {
  const spec = rescaleOf(def)
  if (!spec || !factor || factor.state !== 'applied' || !isNum(factor.k) || factor.k <= 0) return columns
  if (!columns || typeof columns !== 'object') return columns
  const keys = Array.isArray(spec.plots) ? spec.plots : []
  let out = null
  for (const key of keys) {
    const col = columns[key]
    if (!col || typeof col.length !== 'number') continue
    const copy = new Float64Array(col.length)
    for (let i = 0; i < col.length; i += 1) {
      const v = col[i]
      copy[i] = isNum(v) ? v * factor.k : NaN
    }
    if (!out) out = { ...columns }
    out[key] = copy
  }
  return out || columns
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `'2026-11-11'` (or `20261111`) → `'Nov 11'`; string surgery, never a `Date`. */
export function shortSessionDate(v) {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(String(v == null ? '' : v).trim())
  if (!m) return null
  const month = MONTHS[Number(m[2]) - 1]
  return month ? `${month} ${Number(m[3])}` : null
}

/** The label the definition gives a choice (`[value, label]` options), else the value. */
function choiceLabel(def, spec, choice) {
  const input = def && Array.isArray(def.inputs) ? def.inputs.find((i) => i && i.key === spec.input) : null
  const opts = input && Array.isArray(input.options) ? input.options : []
  for (const o of opts) {
    if (Array.isArray(o) && o[0] === choice && typeof o[1] === 'string') return o[1]
  }
  return String(choice)
}

/**
 * The scale's state as readout scalars, `{state, summary, k?, target?, asof?}`, or
 * null while the scale is off (the readout row then prints nothing at all).
 */
export function rescaleScalars(def, factor) {
  const spec = rescaleOf(def)
  if (!spec || !factor || factor.state === 'off') return null
  if (factor.state === 'applied') {
    const day = shortSessionDate(factor.asof)
    const label = choiceLabel(def, spec, factor.choice)
    return {
      state: 'applied', k: factor.k, target: factor.target, asof: factor.asof,
      summary: `Scaled to ${label}: ${factor.target}${day ? ` on ${day}` : ''}`,
    }
  }
  return {
    state: factor.state, unscaled: true,
    summary: RESCALE_FALLBACK_WORDS[factor.state] || RESCALE_FALLBACK_WORDS.noAnchor,
  }
}

/**
 * The payload with the scale's state beside it under `rescale`, or the payload
 * itself (by identity) when the definition declares no scale or it is off.
 * ⛔ THE SERVER WINS: a payload that already carries the key is returned as sent.
 */
export function withRescaleScalars(def, payload, factor) {
  const extra = rescaleScalars(def, factor)
  if (!extra) return payload
  const base = isPlainObject(payload) ? payload : {}
  if (Object.prototype.hasOwnProperty.call(base, RESCALE_SCALAR)) return payload
  return { ...base, [RESCALE_SCALAR]: extra }
}
