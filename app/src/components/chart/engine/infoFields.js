import { parseFormula } from './ast/parse'
import { treeYieldsBool } from './ast/pine'
import { interpret, maxLookback } from './ast/interpret'
import { parseSource, barFieldSeries } from './sourceRef'
import { bindingKey } from './pool'

// ─── THE THIRD CONSUMER OF ONE FORMULA ──────────────────────────────────────
//
// ⭐⭐ AN INFO FIELD IS NOT A SPECIAL INDICATOR AND IT IS NOT A CONDITION. The
// three differ in what they DO with a formula, not in what a formula is:
//
//   INDICATOR   numeric series → a historical plot
//   CONDITION   boolean series → visual actions
//   INFO FIELD  numeric series → the newest value
//
// The formula itself does not care where it ends up. Nothing in `ast/` knows
// these three exist, and this module adds no arithmetic of its own.
//
// ⛔ IT IS THE MIRROR IMAGE OF `conditions.js`, DELIBERATELY. A condition must
// yield BOOLEAN and refuses a numeric tree; an info field must yield NUMERIC and
// refuses a boolean one. Same resolver (`treeYieldsBool`), opposite verdict —
// so "typed intent" is one question asked twice rather than two rules that can
// drift apart.
//
// ⛔ AND IT PRODUCES NO INK. No pane, no scale, no series, no legend plot. An
// info field is a calculation whose only consumer is the header, which is why it
// never reaches `planBindings` and why `bindings()` will never mention one.

/** A stable id for a new field. Opaque, and never derived from the LABEL —
 *  renaming "ADR" to "ADR 21" must not orphan its format, colour or position. */
let _seq = 0
export function newInfoFieldId() {
  _seq += 1
  return `info:${Date.now().toString(36)}:${_seq}`
}

/** Is this key one of ours? `header.fields` mixes built-in catalogue keys with
 *  these, and the prefix is what tells them apart without a lookup. */
export function isInfoFieldId(key) {
  return typeof key === 'string' && key.startsWith('info:')
}

/** The five formats. ⭐ FORMATTING IS NOT CALCULATION: the stored numeric value
 *  is the same whichever of these is chosen, which is the whole reason changing
 *  one runs no maths. */
export const INFO_FORMATS = Object.freeze(['number', 'percent', 'currency', 'integer', 'compact'])
export const INFO_FORMAT_LABEL = Object.freeze({
  number: 'Number', percent: 'Percent', currency: 'Currency',
  integer: 'Integer', compact: 'Compact',
})

export const MAX_DECIMALS = 4

/** The list, normalised. A malformed row is DROPPED rather than thrown over —
 *  one bad entry in a settings blob must not take the header down with it. */
export function normaliseInfoFields(cs) {
  const raw = cs && cs.header && Array.isArray(cs.header.infoFormulas) ? cs.header.infoFormulas : []
  const out = []
  const seen = new Set()
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue
    if (!isInfoFieldId(f.id) || seen.has(f.id)) continue
    if (typeof f.formula !== 'string' || !f.formula.trim()) continue
    seen.add(f.id)
    const dec = Number.isInteger(f.decimals) ? Math.max(0, Math.min(MAX_DECIMALS, f.decimals)) : 2
    out.push({
      id: f.id,
      label: typeof f.label === 'string' && f.label.trim() ? f.label.trim() : 'Value',
      formula: f.formula,
      bindings: (f.bindings && typeof f.bindings === 'object' && !Array.isArray(f.bindings))
        ? { ...f.bindings } : {},
      format: INFO_FORMATS.includes(f.format) ? f.format : 'number',
      decimals: dec,
      color: typeof f.color === 'string' && f.color ? f.color : null,
      suffix: typeof f.suffix === 'string' ? f.suffix.slice(0, 4) : '',
    })
  }
  return out
}

/** id → field, for the header's per-key lookup. */
export function infoFieldsById(cs) {
  const map = new Map()
  for (const f of normaliseInfoFields(cs)) map.set(f.id, f)
  return map
}

// ─── VALIDATION ─────────────────────────────────────────────────────────────

/**
 * Does this text answer an info field's question — *what number is it?*
 *
 * ⛔⛔ A BOOLEAN FORMULA IS REFUSED, NOT RENDERED AS 1 / 0. `close > ema(close,
 * 20)` is a perfectly good CONDITION and a useless header value: a member who
 * typed it and saw "1" would reasonably read it as a price, a count or a ratio.
 * Typed intent is the whole point of having three consumers, and the refusal is
 * where it is enforced.
 *
 * @returns {{ok: true, ast: object} | {ok: false, reason: string}}
 */
export function validateInfoFormula(formula, bindings) {
  if (typeof formula !== 'string' || !formula.trim()) {
    return { ok: false, reason: 'an info field needs a formula' }
  }
  const parsed = parseFormula(formula)
  if (!parsed.ok || !parsed.ast) {
    return { ok: false, reason: parsed.error || 'this formula does not read back' }
  }
  let bool = false
  try { bool = !!treeYieldsBool(parsed.ast) } catch { bool = false }
  if (bool) {
    return {
      ok: false,
      reason: 'this answers true or false — an info field shows a number. '
        + 'Use it as a Condition instead, or compare it into a number.',
    }
  }
  if (bindings && typeof bindings === 'object') {
    for (const key of Object.keys(bindings)) {
      if (!parseSource(bindings[key])) {
        return { ok: false, reason: `the series bound to \`${key}\` cannot be read` }
      }
    }
  }
  return { ok: true, ast: parsed.ast }
}

// ─── EVALUATION ─────────────────────────────────────────────────────────────

/** Resolve bound series to columns — the same two kinds `sourceRef` knows, and
 *  the same `'@instanceId::plotKey'` string a condition and a Moving Average
 *  take. There is ONE reference language; this is not a second reader of it. */
function resolveBindings(field, bars, columnOf) {
  const series = {}
  const missing = []
  for (const [key, ref] of Object.entries(field.bindings || {})) {
    const parsed = parseSource(ref)
    if (!parsed) { missing.push(key); continue }
    if (parsed.kind === 'bar') { series[key] = barFieldSeries(bars, parsed.field); continue }
    const col = columnOf ? columnOf(bindingKey(parsed.instanceId, parsed.plotKey)) : null
    if (!col) { missing.push(key); continue }
    series[key] = col
  }
  return { series, missing }
}

/**
 * Compute one info field's NEWEST value.
 *
 * ⭐ LATEST, NOT HOVERED — and that is a consistency decision, not a shortcut.
 * Every built-in Info Row field (`price`, `% change`, `RVOL`, `% from High`) is
 * quote-driven and shows the CURRENT value; none of them follows the crosshair.
 * A custom formula that did would be the one field in the row that means
 * something different from its neighbours.
 *
 * ⛔ THE WARM-UP IS THE TREE'S, the same static `maxLookback` a condition uses,
 * and a value inside it is `null` — never 0, never NaN, never Infinity. The
 * header renders `—` for null, which is what "we cannot say yet" looks like.
 *
 * @returns {{value: number|null, error: string|null, missing: string[]}}
 */
export function evaluateInfoField(field, bars, columnOf) {
  const check = validateInfoFormula(field.formula, field.bindings)
  if (!check.ok) return { value: null, error: check.reason, missing: [] }

  const { series, missing } = resolveBindings(field, bars, columnOf)
  if (missing.length) return { value: null, error: 'Source unavailable', missing }

  let col
  try {
    col = interpret(check.ast, bars, series)
  } catch (err) {
    return { value: null, error: String(err && err.message ? err.message : err), missing: [] }
  }

  const n = col && typeof col.length === 'number' ? col.length : 0
  if (!n) return { value: null, error: null, missing: [] }

  let warm = 0
  try { warm = maxLookback(check.ast) } catch { warm = 0 }
  if (!Number.isInteger(warm) || warm < 0) warm = 0

  // ⛔ THE LAST FINITE VALUE, WALKING BACK — not `col[n - 1]` blindly. The
  // newest bar can be a whitespace pad (the load-anchor seed) or a developing
  // bar an indicator has not reached, and printing nothing for a field whose
  // answer is one bar back would read as "this is broken" rather than "this bar
  // has no value yet". The walk stops at the warm-up, so a formula with no
  // history returns null rather than a number from before it could know.
  for (let i = n - 1; i >= warm; i--) {
    const v = col[i]
    // `Number.isFinite` excludes Infinity as well as NaN: a division that blew
    // up is not a reading.
    if (Number.isFinite(v)) return { value: v, error: null, missing: [] }
  }
  return { value: null, error: null, missing: [] }
}
