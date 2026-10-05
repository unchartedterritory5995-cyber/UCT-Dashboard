// app/src/components/chart/builder/pineEditor/pineScripts.js
//
// ─── A2–A5 — THE PURE HALF OF "MY SCRIPTS" AND THE INPUTS PANEL ─────────────
//
// ⭐ A2 — a document saved from the Pine Editor carries the member's script in
// `meta.pineSource` (`meta` is ignore-and-preserve in `defSchema`, so the install
// door carries it unchanged). The SERVER owns the rules
// (`api/services/pine_authoring.py`): it is never compute, it is private to its
// owner, the list route serves a `pine_source` SUMMARY instead of the text, and a
// runtime/hybrid document's own source is never duplicated into it. This module
// only READS those answers — it re-derives none of them.
//
// ⭐ A5 — the inputs panel edits the PREVIEW through `applyParamEdit`, the one
// atomic editor of a knob (every locator round-trips or nothing changes). Values
// are keyed by the input's NAME in the script (`sourceName`), not by
// `__uct_param_<n>`: inserting an input above another renumbers the ids, and an
// override keyed by id would silently move onto the wrong knob.

import { applyParamEdit, reconcileParams, ATTACHED } from '../paramEdit'

export const PINE_SOURCE_FIELD = 'pineSource'
export const PINE_SOURCE_WITHHELD_FIELD = 'pineSourceWithheld'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The script a member would reopen: `meta.pineSource`, else the lane's own
 *  (a runtime document's `compute.source`, a hybrid's `objectsRun.source`). */
export function pineSourceOf(definition) {
  if (!isObj(definition)) return null
  const meta = isObj(definition.meta) ? definition.meta : {}
  const own = meta[PINE_SOURCE_FIELD]
  if (typeof own === 'string' && own.trim()) return own
  const compute = isObj(definition.compute) ? definition.compute : {}
  if (compute.kind === 'runtime' && typeof compute.source === 'string') return compute.source
  const run = definition.objectsRun
  if (compute.kind === 'ast' && isObj(run) && typeof run.source === 'string') return run.source
  return null
}

/** `definition` carrying `source` as its Pine (a copy; the input is untouched). */
export function withPineSource(definition, source) {
  const meta = isObj(definition && definition.meta) ? definition.meta : {}
  return { ...definition, meta: { ...meta, [PINE_SOURCE_FIELD]: source } }
}

/** `definition` renamed (a copy). The name is the document's `meta.name`. */
export function withName(definition, name) {
  const meta = isObj(definition && definition.meta) ? definition.meta : {}
  const clean = String(name || '').trim().slice(0, 40)
  return clean ? { ...definition, meta: { ...meta, name: clean } } : definition
}

/** A stored row's document as something to WRITE BACK (rename, restore): the
 *  server's served-only stamps removed — they describe a read, not the document
 *  (`runtime_definitions.stamp_served`). */
export function storableDefinition(definition) {
  const meta = { ...((definition && definition.meta) || {}) }
  delete meta.runtimeKilled
  delete meta.runtimeNotGraded
  delete meta[PINE_SOURCE_WITHHELD_FIELD]
  return { ...definition, meta }
}

/** The member's Pine scripts out of the store's LIST rows (newest first).
 *  A row is a script when the server says it has a source (`pine_source`), or —
 *  for a backend that predates the summary — when the document carries one. */
export function pineScriptsOf(rows) {
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.def_id || row.deleted_at) continue
    const summary = isObj(row.pine_source) ? row.pine_source : null
    const inline = pineSourceOf(row.definition)
    if (!summary && !inline) continue
    const meta = isObj(row.definition && row.definition.meta) ? row.definition.meta : {}
    out.push({
      defId: row.def_id,
      name: meta.name || 'Untitled script',
      version: row.version,
      savedAt: row.created_at || null,
      bytes: summary ? summary.bytes : new TextEncoder().encode(inline).length,
      licence: summary ? summary.licence : null,
    })
  }
  return out.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
}

const keyOf = (id, entry) => (entry && (entry.sourceName || entry.title)) || id

/**
 * The preview document with the member's input values applied.
 *
 * @param {object} definition the door's document (carries `compute.paramManifest`)
 * @param {Object<string, number>} values keyed by the input's name in the script
 * @returns {{ok: boolean, definition: object, error: string|null, applied: string[], stale: string[]}}
 *   ⛔ ATOMIC: on any refusal `definition` is the INPUT, unedited — never a
 *   half-applied preview. `stale` names values whose input the script no longer
 *   offers (it was removed, renamed or locked); they are skipped, not applied.
 */
export function applyInputValues(definition, values) {
  const manifest = (definition && definition.compute && definition.compute.paramManifest) || {}
  const byKey = new Map(Object.entries(manifest).map(([id, e]) => [keyOf(id, e), id]))
  let doc = definition
  const applied = []
  const stale = []
  for (const [key, value] of Object.entries(values || {})) {
    const id = byKey.get(key)
    if (!id) { stale.push(key); continue }
    if (manifest[id].default === value) continue
    const res = applyParamEdit(doc, id, value)
    if (!res.ok) return { ok: false, definition, error: res.error, applied: [], stale }
    doc = res.definition
    applied.push(key)
  }
  return { ok: true, definition: doc, error: null, applied, stale }
}

/** The non-default input values a STORED document carries (to reseed the panel
 *  when a saved script is reopened), keyed by input name. */
export function inputValuesOf(definition) {
  const manifest = (definition && definition.compute && definition.compute.paramManifest) || null
  if (!manifest) return {}
  let state = {}
  try { state = reconcileParams(definition) } catch { return {} }
  const out = {}
  for (const [id, entry] of Object.entries(manifest)) {
    const s = state[id]
    if (s && s.state === ATTACHED && s.value !== entry.default) out[keyOf(id, entry)] = s.value
  }
  return out
}

/** The values with `key` set (or cleared when it equals the default). */
export function withInputValue(values, key, value, defaultValue) {
  const next = { ...(values || {}) }
  if (value === defaultValue) delete next[key]
  else next[key] = value
  return next
}

export { keyOf as inputKeyOf }
