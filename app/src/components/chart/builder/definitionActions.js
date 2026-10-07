// app/src/components/chart/builder/definitionActions.js
//
// ─── ⭐⭐ PHASE 4 — DEFINITION-LEVEL ACTIONS, IN ONE PLACE ────────────────────────
//
// DEFINITION = the indicator itself (maths, outputs, presentation) — `defId`.
// INSTANCE   = one placement of a definition on one chart — `instanceId`.
//
// The legend menu, the Indicators inspector and the "Your indicators" list all reach
// the SAME three definition-level verbs through here, so the three surfaces cannot
// disagree about what they mean:
//
//   kindOf(def)            what the definition is — 'user' (editable) | 'builtin' | 'other'
//   createCustomCopy(...)  DUPLICATE AS A NEW INDICATOR: a new, independent, user-owned
//                          definition (a user definition is forked by the server; a
//                          parity-approved built-in is copied as a formula). The source
//                          and every instance of it are untouched; the copy is added to
//                          this chart as its own instance.
//
// ⛔ The chart-instance "Duplicate" is NOT here: it stays `instanceControls
// .duplicateInstance` — another instance of the SAME definition.

import { forkUserDefinition, saveUserDefinition } from '../../../hooks/useUserDefinitions'
import { addInstance } from '../engine/instanceControls'
import { withStoredSemantics } from '../engine/definitionSemantics'
import { addedInstanceId } from './infoValueDoor'
import { customizability } from './builtinForks'

const USER_ID_RE = /^u_[0-9a-f]{12}$/

/** 'user' — a stored formula the member owns; 'builtin' — a UCT native; 'other'. */
export function kindOf(def) {
  if (!def || !def.compute) return 'other'
  if (def.compute.kind === 'native') return 'builtin'
  if (def.compute.kind === 'ast' && USER_ID_RE.test(String(def.id || ''))) return 'user'
  return 'other'
}

/** Can this definition get a custom copy? `{ok}` or `{ok: false, reason}` (member words). */
export function copyVerdict(def, inputs = {}) {
  const k = kindOf(def)
  if (k === 'user') return { ok: true }
  if (k === 'builtin') return customizability(def, inputs)
  return { ok: false, reason: 'Not customizable yet — this indicator is computed in a form that can’t be copied as your own.' }
}

/**
 * DUPLICATE AS A NEW INDICATOR.
 * @param {object} p
 * @param {object} p.def        the source definition (registry)
 * @param {object} [p.inputs]   the source instance's current input values (a built-in
 *                              copy starts from the member's own settings)
 * @param {object|null} p.settings the chart's STORED settings (the copy is added to it)
 * @param {object} p.registry   the engine registry
 * @returns {Promise<{ok: true, row: {def_id, version, definition}, settings, instanceId}
 *                  | {ok: false, error: string}>}
 */
export async function createCustomCopy({ def, inputs = {}, settings = null, registry,
  fork = forkUserDefinition, save = saveUserDefinition }) {
  const verdict = copyVerdict(def, inputs)
  if (!verdict.ok) return { ok: false, error: verdict.reason }
  let stored
  if (kindOf(def) === 'user') {
    const res = await fork(def.id)
    if (!res.ok) return { ok: false, error: res.error }
    if (!res.row.definition) return { ok: false, error: 'The copy was made; reopen the indicator list to see it.' }
    stored = withStoredSemantics(res.row.definition, res.row)
  } else {
    let doc
    // ⭐ Loaded on demand: the copy's assembly reaches the Builder, which the legend
    // and the toolbar must not import while rendering (an import cycle through the chart).
    try {
      const { customCopyOf } = await import('./builtinCopy')
      doc = customCopyOf(def, inputs)
    } catch (e) { return { ok: false, error: String(e.message || e) } }
    const res = await save(doc, null)
    if (!res.ok) return { ok: false, error: res.error }
    const row = res.row || {}
    stored = withStoredSemantics({
      ...doc,
      id: row.def_id || doc.id,
      ...(Number.isInteger(row.version) ? { version: row.version } : {}),
      compute: { ...doc.compute, ...(Number.isInteger(row.rev) ? { rev: row.rev } : {}) },
    }, row)
  }
  const { installed } = registry.installUserDefinitions([stored])
  if (installed.length !== 1) return { ok: false, error: 'The copy was saved but could not be drawn.' }
  let next = settings
  let instanceId = null
  if (settings) {
    next = addInstance(settings, stored.id, registry)
    instanceId = addedInstanceId(settings, next, stored.id)
  }
  return { ok: true, row: { def_id: stored.id, version: stored.version, definition: stored }, settings: next, instanceId }
}
