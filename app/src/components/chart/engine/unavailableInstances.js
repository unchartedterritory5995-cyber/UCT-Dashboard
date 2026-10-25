// app/src/components/chart/engine/unavailableInstances.js
//
// ⭐ A1.4 — "⚠ 2 indicators can't be shown". Pure; Indicators-owned.
//
// A stored instance that `normalizeInstances` refuses is DROPPED from the chart silently
// today: a deleted formula, a formula whose new version no longer passes the gates, an input
// the definition stopped declaring, a value now out of range. The member sees nothing — or,
// worse, the legacy projection draws a DEFAULT copy under the same name (PA3 §6.1). This
// reader names each such record and why, so the chart can say so and offer Remove / Keep /
// Repair / Open in Builder. It reads the STORED list only (`cs.indicatorInstances`), and it
// does not edit `engine/instances.js`.

import { normalizeInstances } from './instances'
import { checkInstanceInput } from './instanceControls'
import { STUDIO_PREVIEW_DEF_ID } from '../builder/studio/chartPreview'

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const USER_DEF = /^u_/

export const UNAVAILABLE_REASONS = Object.freeze({
  DEFINITION_MISSING: 'definition-missing',
  DEFINITION_REFUSED: 'definition-refused',
  INPUT_REMOVED: 'input-removed',
  INPUT_INVALID: 'input-invalid',
  MALFORMED: 'malformed',
})

const resolver = (registry) => (id) => {
  try {
    if (typeof registry === 'function') return registry(id) || null
    if (registry && typeof registry.getDefinition === 'function') return registry.getDefinition(id) || null
  } catch { /* an unreadable registry resolves nothing */ }
  return null
}

/**
 * @param {object} cs merged chart settings
 * @param {object|Function} registry
 * @param {{userDefsReady?: boolean, storeDefIds?: Set<string>|null, nameOf?: (defId)=>string|null}} [opts]
 *   userDefsReady — false while the member's formulas are still installing: a `u_…` record that
 *   does not resolve YET is NOT reported (no false flash before they arrive).
 *   storeDefIds — the formula ids the store returned; a non-resolving id the store HAS was
 *   refused by today's gates (`definition-refused`), one it lacks was deleted (`-missing`).
 * @returns {{instanceId, defId, reason, name, keys?: string[], detail: string}[]}
 */
export function unavailableInstances(cs, registry, opts = {}) {
  const { userDefsReady = true, storeDefIds = null, nameOf = null } = opts
  const list = isObj(cs) && Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : []
  if (!list.length) return []
  const defOf = resolver(registry)
  const out = []
  for (const d of normalizeInstances(list, registry).dropped) {
    const inst = d.inst
    if (!isObj(inst) || typeof inst.instanceId !== 'string' || !inst.instanceId) continue
    const defId = typeof inst.defId === 'string' ? inst.defId : null
    if ((defId && defId.includes(STUDIO_PREVIEW_DEF_ID)) || inst.instanceId.includes(STUDIO_PREVIEW_DEF_ID)) continue
    if ((defId && defId.startsWith('econp:')) || inst.instanceId.startsWith('econp:')) continue
    const def = defId ? defOf(defId) : null
    const display = isObj(inst.display) && typeof inst.display.name === 'string' ? inst.display.name : null
    const name = display || (def && def.meta && def.meta.name) || (def && def.name) || (defId && nameOf && nameOf(defId))
      || (defId && USER_DEF.test(defId) ? `Formula ${defId}` : defId) || 'Indicator'
    const row = { instanceId: inst.instanceId, defId, name, detail: d.reason }
    if (!def) {
      if (defId && USER_DEF.test(defId) && !userDefsReady) continue
      row.reason = defId && storeDefIds && storeDefIds.has(defId) ? UNAVAILABLE_REASONS.DEFINITION_REFUSED : UNAVAILABLE_REASONS.DEFINITION_MISSING
      out.push(row)
      continue
    }
    const declared = new Set((Array.isArray(def.inputs) ? def.inputs : []).map((i) => i && i.key).filter(Boolean))
    const inputs = isObj(inst.inputs) ? inst.inputs : {}
    const removed = Object.keys(inputs).filter((k) => !declared.has(k))
    if (removed.length) { out.push({ ...row, reason: UNAVAILABLE_REASONS.INPUT_REMOVED, keys: removed }); continue }
    const invalid = Object.keys(inputs).filter((k) => { try { return !checkInstanceInput(def, k, inputs[k]).ok } catch { return true } })
    if (invalid.length) { out.push({ ...row, reason: UNAVAILABLE_REASONS.INPUT_INVALID, keys: invalid }); continue }
    out.push({ ...row, reason: UNAVAILABLE_REASONS.MALFORMED })
  }
  return out
}

/** What the member reads for each reason (the popover / settings row sentence). */
export function unavailableSentence(row) {
  const keys = (row.keys || []).join(', ')
  switch (row.reason) {
    case UNAVAILABLE_REASONS.DEFINITION_MISSING: return "This formula was deleted or isn't installed on this account."
    case UNAVAILABLE_REASONS.DEFINITION_REFUSED: return 'This formula no longer passes checks.'
    case UNAVAILABLE_REASONS.INPUT_REMOVED: return `This indicator's setting ${keys} no longer exists.`
    case UNAVAILABLE_REASONS.INPUT_INVALID: return `The setting ${keys} is out of range.`
    default: return 'This saved indicator is damaged.'
  }
}

/** Which actions a row offers (`canEdit` = the host has an edit-formula launcher). */
export function unavailableActions(row, { canEdit = false } = {}) {
  switch (row.reason) {
    case UNAVAILABLE_REASONS.DEFINITION_MISSING: return ['remove', 'keep']
    case UNAVAILABLE_REASONS.DEFINITION_REFUSED: return [...(canEdit ? ['openInBuilder'] : []), 'remove', 'keep']
    case UNAVAILABLE_REASONS.INPUT_REMOVED:
    case UNAVAILABLE_REASONS.INPUT_INVALID: return ['repair', 'remove', 'keep']
    default: return ['remove', 'keep', 'copy']
  }
}
