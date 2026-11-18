// app/src/components/chart/engine/derivedColumns.js
//
// ─── CLIENT-DERIVED COLUMNS — `plots[].derive: {from, where, activeWhen?}` ───
//
// The server lane sends event columns as 0/1 (`crossUp`, `crossDown`). A glyph
// plot drawn `inBar` sits AT its column's value, so a 0/1 column would put a
// triangle at 1 on a scale near 0.25 and stretch the pane to fit it. A derived
// column carries `from`'s value on the bars where `where` fired and NaN on every
// other bar: a glyph exactly ON the line, exactly where the event fired. The
// server's own dots (`dotNH`, …) are built that way on the server; this is the
// same shape built on the client, for an event the server already sends, with no
// new wire column and no `compute.rev` bump.
//
// ⭐ PRESENTATION, NOT COMPUTE. `activeWhen` reads the member's own switch (the
// inputs' condition grammar, over stored values with the declared defaults
// under them). While it fails the column is ABSENT — the binder binds only the
// plots whose columns exist, so an absent column draws nothing and creates no
// series. The switch never keys the fetch (it is not a server input), so turning
// it on costs no request.
//
// ⛔ THE SERVER WINS. A key the envelope already carries is never overwritten: a
// later server that sends the column itself is the authority the moment it does.
// ⛔ PURE and dependency-light: `readoutSchema` for the one condition evaluator
// (and its `input:` reader), nothing else. `defSchema.validateDerives` holds the
// grammar fail-closed.
//
// ⭐ 2026-11-13 — a second form, `derive: {kind: 'ma', of, length, type, …}`: a
// moving average of a column the envelope carries, drawn as a LINE (the UCT RS
// Line's second average). Its section is below `withDerivedColumns`.

import { readoutConditionOpen, readoutSourceValue } from './readoutSchema'

/** The closed set of fields a `derive` block may carry. */
export const DERIVE_FIELDS = Object.freeze(['from', 'where', 'activeWhen'])

const len = (a) => (a && typeof a.length === 'number' ? a.length : 0)

/**
 * One derived column: `from[i]` where `where[i] > 0` and `from[i]` is finite,
 * NaN elsewhere. `null` when either source column is missing.
 */
export function deriveColumn(from, where) {
  const n = Math.min(len(from), len(where))
  if (!n || len(from) !== len(where)) return null
  const out = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    const w = where[i]
    const v = from[i]
    out[i] = (typeof w === 'number' && w > 0 && typeof v === 'number' && Number.isFinite(v)) ? v : NaN
  }
  return out
}

/**
 * The columns with every declared `derive` added. Returns the SAME object when
 * the definition declares none (identity, so a memo keyed on it still hits);
 * otherwise a shallow copy, never a mutation of what the caller passed (the
 * aligned columns of a cached envelope).
 *
 * @param {object} def a definition
 * @param {object} columns `{key: Float64Array}` as the lane aligned them
 * @param {object} [inputs] the instance's inputs (declared defaults under the stored)
 * @returns {object}
 */
export function withDerivedColumns(def, columns, inputs) {
  const plots = def && Array.isArray(def.plots) ? def.plots : []
  const derived = plots.filter((p) => p && p.derive && typeof p.derive === 'object' && typeof p.key === 'string')
  if (!derived.length || !columns || typeof columns !== 'object') return columns
  let out = null
  for (const p of derived) {
    const d = p.derive
    if (Object.prototype.hasOwnProperty.call(columns, p.key)) continue
    if (d.activeWhen !== undefined && !readoutConditionOpen(d.activeWhen, def, inputs || {})) continue
    const col = d.kind === DERIVE_KIND_MA
      ? derivedAverage(columns[d.of], resolveMaLength(d, def, inputs), resolveMaType(d, def, inputs))
      : deriveColumn(columns[d.from], columns[d.where])
    if (!col) continue
    if (!out) out = { ...columns }
    out[p.key] = col
  }
  return out || columns
}

// ─── ⭐ 2026-11-13 — A DERIVED AVERAGE: `derive: {kind: 'ma', of, length, type, activeWhen?, scalar?}` ──
//
// The UCT RS Line's SECOND average (Deepvue's MA2, Webster's 21 and 50 on the RS
// line): a moving average of a column the envelope already carries, built here so
// it costs no server input, no fetch key and no `compute.rev` bump, exactly like
// the event glyphs above. It is PRESENTATION: nothing on the server reads it, no
// alert binds to it, and the first average (`rsMa`) stays the server's.
//
// ⭐ THE SERVER'S ARITHMETIC, NOT A NEW ONE (`relative_strength.rs_moving_average`
// over `indicator_compute`): the average runs over the VALID values in order and
// maps back to their own bars (a gap stays NaN, never a zero fed into an EMA); the
// first `length − 1` valid bars are the warm-up pad; SMA re-sums its window; EMA
// seeds on the SMA of the first `length` values and steps `prev·(1−k) + v·k`,
// k = 2/(length+1). So the same series gives the same numbers on either side.
//
// ⭐ IT RUNS LAST (`serverCompute.serverColumnsFor`: live tail, then the rating
// scale, then derive), so it is the average of the line AS DRAWN: the forming
// bar's live ratio is in it, and under "Scale to rating" it is the average of the
// scaled line, which is k times the raw average because an average is linear.
// ⛔ A derived average is NOT listed in `rescale.plots`: it would be scaled twice.

/** The derive kind for a moving average; an event derive carries no `kind`. */
export const DERIVE_KIND_MA = 'ma'
/** The closed field set of an average derive. */
export const DERIVE_MA_FIELDS = Object.freeze(['kind', 'of', 'length', 'type', 'activeWhen', 'scalar'])
/** The average types, as the server's `maType` spells them. */
export const DERIVE_MA_TYPES = Object.freeze(['EMA', 'SMA'])

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v)

/** A literal whole number, or `input:<key>` read through the readout grammar. */
function resolveMaLength(d, def, inputs) {
  const v = typeof d.length === 'string' ? readoutSourceValue(d.length, null, def, inputs || {}) : d.length
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 ? n : NaN
}

/** A literal type word, or `input:<key>`; upper-cased; anything else is ''. */
function resolveMaType(d, def, inputs) {
  const v = typeof d.type === 'string' && d.type.startsWith('input:')
    ? readoutSourceValue(d.type, null, def, inputs || {}) : d.type
  const t = typeof v === 'string' ? v.toUpperCase() : ''
  return DERIVE_MA_TYPES.includes(t) ? t : ''
}

/**
 * The moving average of `values` aligned to it (NaN pad), or `null` when the
 * source is missing or the length or type is unreadable. Gaps are skipped and
 * stay NaN; fewer valid values than `length` is an all-NaN column (the server's
 * `rs_moving_average` returns all `None` there).
 */
export function derivedAverage(values, length, type) {
  const n = len(values)
  if (!n || !Number.isInteger(length) || length < 1 || !DERIVE_MA_TYPES.includes(type)) return null
  const out = new Float64Array(n).fill(NaN)
  const idx = []
  for (let i = 0; i < n; i += 1) if (isFiniteNum(values[i])) idx.push(i)
  if (idx.length < length) return out
  const vals = idx.map((i) => values[i])
  if (type === 'SMA') {
    for (let j = length - 1; j < vals.length; j += 1) {
      let s = 0
      for (let w = j - length + 1; w <= j; w += 1) s += vals[w]
      out[idx[j]] = s / length
    }
  } else {
    const k = 2 / (length + 1)
    let s = 0
    for (let w = 0; w < length; w += 1) s += vals[w]
    let prev = s / length
    out[idx[length - 1]] = prev
    for (let j = length; j < vals.length; j += 1) {
      prev = prev * (1 - k) + vals[j] * k
      out[idx[j]] = prev
    }
  }
  return out
}

/** `'20261104'` / `'2026-11-04'` → `'Nov 4'`, string surgery (the server's `_rs_short_date`). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function shortDate(v) {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(String(v == null ? '' : v).trim())
  const month = m ? MONTHS[Number(m[2]) - 1] : null
  return month ? `${month} ${Number(m[3])}` : null
}

/**
 * The reading of one derived average at the LAST BAR WITH A FINITE `of` value,
 * in the words the server's RS line row uses (`rs_provider._rs_legend`):
 * `above its 50 SMA by 2.1%` / `below its 50 EMA by 0.4%` / `at its 50 SMA`,
 * plus ` · as of Nov 4` when that bar is not the newest (the date is the server's
 * own `legend.asOf`, read at the same bar). `{pctFromMa, above, length, type,
 * summary}`; `summary` null when there is nothing to say.
 */
export function derivedAverageReading(values, ma, length, type, legend) {
  const n = Math.min(len(values), len(ma))
  const out = { pctFromMa: null, above: null, length, type, summary: null }
  if (!n) return out
  let i = n - 1
  while (i >= 0 && !isFiniteNum(values[i])) i -= 1
  if (i < 0) return out
  const v = values[i]
  const m = ma[i]
  if (!isFiniteNum(m) || m === 0) return out
  const pct = (v / m - 1) * 100
  out.pctFromMa = pct
  out.above = v >= m
  const avg = `its ${length} ${type}`
  const mag = Math.abs(pct).toFixed(1)
  let summary = Number(mag) === 0 ? `at ${avg}` : `${out.above ? 'above' : 'below'} ${avg} by ${mag}%`
  const legendAt = legend && typeof legend === 'object' ? legend : null
  if (i < len(values) - 1 && legendAt && legendAt.index === i && shortDate(legendAt.asOf)) {
    summary += ` · as of ${shortDate(legendAt.asOf)}`
  }
  out.summary = summary
  return out
}

/**
 * The scalars with every declared average's reading added under its `scalar`
 * key, read off the ENVELOPE's own columns (the server's line, before any live
 * tail or scale: the reading is a ratio and the RS line row beside it reads the
 * same cells). Returns the SAME object when nothing is added; never mutates.
 * A key the payload already carries is never overwritten (the server wins).
 */
export function withDerivedScalars(def, scalars, columns, inputs) {
  const plots = def && Array.isArray(def.plots) ? def.plots : []
  let out = null
  for (const p of plots) {
    const d = p && p.derive
    if (!d || d.kind !== DERIVE_KIND_MA || typeof d.scalar !== 'string' || !d.scalar) continue
    if (scalars && typeof scalars === 'object' && Object.prototype.hasOwnProperty.call(scalars, d.scalar)) continue
    if (d.activeWhen !== undefined && !readoutConditionOpen(d.activeWhen, def, inputs || {})) continue
    const length = resolveMaLength(d, def, inputs)
    const type = resolveMaType(d, def, inputs)
    const values = columns && typeof columns === 'object' ? columns[d.of] : null
    const ma = derivedAverage(values, length, type)
    if (!ma) continue
    const legend = scalars && typeof scalars === 'object' ? scalars.legend : null
    if (!out) out = { ...(scalars && typeof scalars === 'object' ? scalars : {}) }
    out[d.scalar] = derivedAverageReading(values, ma, length, type, legend)
  }
  return out || scalars
}
