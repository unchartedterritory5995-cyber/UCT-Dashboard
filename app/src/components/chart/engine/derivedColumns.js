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
// ⛔ PURE and dependency-light: `readoutSchema` for the one condition evaluator,
// nothing else. `defSchema.validateDerives` holds the grammar fail-closed.

import { readoutConditionOpen } from './readoutSchema'

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
    const col = deriveColumn(columns[d.from], columns[d.where])
    if (!col) continue
    if (!out) out = { ...columns }
    out[p.key] = col
  }
  return out || columns
}
