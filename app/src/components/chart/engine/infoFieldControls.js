import {
  newInfoFieldId, normaliseInfoFields, validateInfoFormula,
  INFO_FORMATS, MAX_DECIMALS, MAX_LABEL, isInfoFieldId,
} from './infoFields'
import { headerFieldKeys } from '../headerFields'

// ─── THE WRITE DOOR FOR INFO FIELDS ─────────────────────────────────────────
//
// ⭐ THE SHAPE `instanceControls.js` AND `conditionControls.js` ALREADY USE:
// pure, settings in / settings out, the caller's object never mutated, and the
// SAME object back on a refusal so `if (next !== settings)` is the whole of a
// caller's error handling.
//
// ⛔⛔ AND EVERY WRITE HERE EXCEPT TWO IS PRESENTATION. Only `formula` and
// `bindings` are inputs to the maths; label, format, decimals, colour, suffix and
// position are not, and none of them appears in the evaluator's memo key. That
// is why changing them runs no arithmetic — not because anything checks, but
// because they are not what the calculation reads.

const withFields = (cs, list, fields) => ({
  ...cs,
  header: {
    ...(cs.header || {}),
    infoFormulas: list,
    ...(fields ? { fields } : {}),
  },
  preset: 'custom',
})

export function infoFieldsOf(cs) {
  return normaliseInfoFields(cs)
}

/**
 * The keys shown in the row, in order.
 *
 * ⛔⛔ IT MATERIALISES THE LEGACY SHAPE, and it has to. `header.fields` is ABSENT
 * on a default blob — `headerFieldKeys` derives `['mcap','earn','rating']` from
 * the three legacy `show*` booleans on every read. Appending to a null list
 * silently did nothing: the field was created, the row never showed it, and
 * nothing said why. Writing the derived list once is the same migration
 * `headerFieldKeys` performs, made permanent at the moment a member first
 * reorders the row.
 */
function keysOf(cs) {
  return headerFieldKeys(cs && cs.header)
}

/**
 * Create a formula field AND put it in the row.
 *
 * ⭐ TWO WRITES, ONE ACTION. A definition nobody selected would be invisible with
 * no way to find it; a key in `fields` with no definition would be a slot that
 * renders nothing. They are created together so neither state is reachable.
 */
export function addInfoField(cs, { label, formula, bindings, format, decimals, color, suffix } = {}) {
  if (!cs || typeof cs !== 'object') return cs
  if (!validateInfoFormula(formula, bindings).ok) return cs
  const list = infoFieldsOf(cs)
  const id = newInfoFieldId()
  list.push({
    id,
    label: typeof label === 'string' && label.trim() ? label.trim().slice(0, MAX_LABEL) : 'Value',
    formula,
    bindings: bindings && typeof bindings === 'object' ? { ...bindings } : {},
    format: INFO_FORMATS.includes(format) ? format : 'number',
    decimals: Number.isInteger(decimals) ? Math.max(0, Math.min(MAX_DECIMALS, decimals)) : 2,
    color: typeof color === 'string' && color ? color : null,
    suffix: typeof suffix === 'string' ? suffix.slice(0, 4) : '',
  })
  return withFields(cs, list, [...keysOf(cs), id])
}

/**
 * Delete a formula field.
 *
 * ⛔ IT TOUCHES NOTHING ELSE (Part 48): not the source indicators it read, not a
 * condition that happens to bind the same output, not another header field. A
 * field is a consumer and owns none of its inputs.
 */
export function removeInfoField(cs, id) {
  const list = infoFieldsOf(cs)
  const next = list.filter((f) => f.id !== id)
  if (next.length === list.length) return cs
  return withFields(cs, next, keysOf(cs).filter((k) => k !== id))
}

/**
 * Patch one field.
 *
 * ⚠️ `formula` AND `bindings` ARE THE ONLY KEYS THAT INVALIDATE, and a formula
 * that does not yield a NUMBER is refused rather than stored — the mirror of the
 * condition door, asked through the same resolver.
 */
export function setInfoField(cs, id, patch) {
  if (!patch || typeof patch !== 'object') return cs
  const list = infoFieldsOf(cs)
  const i = list.findIndex((f) => f.id === id)
  if (i < 0) return cs
  const cur = list[i]
  const next = { ...cur }
  let changed = false

  if (typeof patch.label === 'string' && patch.label.trim()) {
    const lbl = patch.label.trim().slice(0, MAX_LABEL)
    if (lbl !== cur.label) { next.label = lbl; changed = true }
  }
  if (typeof patch.formula === 'string' && patch.formula !== cur.formula) {
    if (!validateInfoFormula(patch.formula, cur.bindings).ok) return cs
    next.formula = patch.formula; changed = true
  }
  if (INFO_FORMATS.includes(patch.format) && patch.format !== cur.format) {
    next.format = patch.format; changed = true
  }
  if (Number.isInteger(patch.decimals)) {
    const d = Math.max(0, Math.min(MAX_DECIMALS, patch.decimals))
    if (d !== cur.decimals) { next.decimals = d; changed = true }
  }
  if ('color' in patch) {
    const c = typeof patch.color === 'string' && patch.color ? patch.color : null
    if (c !== cur.color) { next.color = c; changed = true }
  }
  if (typeof patch.suffix === 'string') {
    const sfx = patch.suffix.slice(0, 4)
    if (sfx !== cur.suffix) { next.suffix = sfx; changed = true }
  }
  if (!changed) return cs
  list[i] = next
  return withFields(cs, list)
}

/**
 * Bind (or clear) one named series — the SAME `'@instanceId::plotKey'` string a
 * condition and a Moving Average take. One reference language; this is not a
 * second reader of it.
 */
export function setInfoFieldBinding(cs, id, key, ref) {
  if (typeof key !== 'string' || !/^[a-z][a-z0-9]*$/.test(key)) return cs
  const list = infoFieldsOf(cs)
  const i = list.findIndex((f) => f.id === id)
  if (i < 0) return cs
  const bindings = { ...list[i].bindings }
  if (!ref) {
    if (!(key in bindings)) return cs
    delete bindings[key]
  } else {
    if (bindings[key] === ref) return cs
    bindings[key] = ref
  }
  list[i] = { ...list[i], bindings }
  return withFields(cs, list)
}

/**
 * Move a field within the Info Row.
 *
 * ⭐ IT MOVES THE KEY IN `header.fields`, WHICH IS THE ONE ORDER. A custom field
 * sits among the built-ins and is reordered by the same list — there is no
 * second custom-field row and therefore no second ordering to keep in step.
 */
export function moveInfoRowField(cs, key, delta) {
  const keys = keysOf(cs)
  const i = keys.indexOf(key)
  if (i < 0) return cs
  const j = i + (delta < 0 ? -1 : 1)
  if (j < 0 || j >= keys.length) return cs
  const next = [...keys]
  const [row] = next.splice(i, 1)
  next.splice(j, 0, row)
  return { ...cs, header: { ...(cs.header || {}), fields: next }, preset: 'custom' }
}

export { isInfoFieldId }
