// app/src/components/chart/builder/agentDefinitions.js
//
// ─── ⭐ uct.indicators.definitions/1 — WHAT AN INDICATOR *IS*, FOR UCT AGENT ──────────
//
// `mutation/1` changes what ONE chart draws; this file answers questions about the
// DEFINITIONS themselves and manages the member's own saved ones:
//
//   searchDefinitions(query, ctx)            built-ins + the member's own formulas, ranked
//   describeDefinition(defId, ctx)           name, settings, outputs, placement, capabilities
//   findDefinitionUsage(defId, charts, reg)  which charts/instances draw a definition
//   planDefinitionAction(request, ctx)       op 'duplicate' | 'delete' — validate and pin
//   executeDefinitionAction(plan, ctx, deps) run it through the product's own doors
//   undoDefinitionAction(undo, ctx, deps)    exact or refused
//   discardDraft                              re-exported from `authoring/1` (unsaved drafts)
//
// ⛔ NO SECOND WRITER. Duplicate is `definitionActions.createCustomCopy` (the "Create
// custom copy" verb the legend, the Inspector and the "Your indicators" list share: a
// server FORK of a member's formula, or a formula copy of a parity-approved built-in).
// Delete is `deleteUserDefinition` (the server's SOFT delete — a tombstone version, history
// kept). Undo of a delete re-saves the exact stored document under the SAME id (the PUT
// route's documented resurrect), so every instance that names it draws again.
//
// ⛔ SAFE BY DEFAULT. A delete is refused (`dependent-exists`) while any chart the caller
// names still draws the definition, unless the request says `allowInUse: true` — which the
// Agent sets only after the member approved a proposal that listed that usage. Usage is
// pinned at plan time and re-checked at execution.
//
// The network doors are injectable (`deps`) for tests; their defaults are the hooks the
// product already uses. Nothing here persists chart settings.

import { forkUserDefinition, saveUserDefinition, deleteUserDefinition, readUserDefinition } from '../../../hooks/useUserDefinitions'
import { catalogRows, userCatalogRows } from '../indicatorCatalog'
import { evaluability, LANES } from '../engine/evaluability'
import { inputSpecOf } from '../engine/instanceControls'
import { instancesOf } from './agentSeams'
import { kindOf, copyVerdict, createCustomCopy } from './definitionActions'
import { canon } from '../engine/settingsRecord'
import { REASONS } from './agentMutations'
import { engineStampOf } from '../engine/scriptEngineVersion'
import { isScriptDocument } from './memberPane/savedScriptUpgrade'

export { discardDraft } from './agentAuthoring'

export const DEFINITIONS_CONTRACT = 'uct.indicators.definitions/1'
export const DEFINITION_OPS = Object.freeze(['duplicate', 'delete'])

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const USER_DEF = /^u_[0-9a-f]{12}$/
const refuse = (reason, detail) => (detail === undefined ? { ok: false, reason } : { ok: false, reason, detail })
const getDef = (registry, id) => {
  try { return (registry && typeof registry.getDefinition === 'function' && registry.getDefinition(id)) || null } catch { return null }
}
const ownedSet = (ctx) => {
  const ids = ctx && ctx.ownedDefinitionIds
  return new Set(Array.isArray(ids) ? ids : [...(ids || [])])
}
const fnv = (text) => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}

/** May this caller see / act on `defId`? Built-ins always; a saved formula only if owned. */
function visible(defId, ctx) {
  if (typeof defId !== 'string' || !defId || defId.includes('studio-preview') || defId.startsWith('econp:')) return false
  return !USER_DEF.test(defId) || ownedSet(ctx).has(defId)
}

// ─── reads ────────────────────────────────────────────────────────────────────

const outputsOf = (def) => [
  ...(Array.isArray(def.plots) ? def.plots : []).filter((p) => p && p.key && p.hidden !== true).map((p) => ({ key: p.key, label: p.label || p.key, kind: 'plot', style: p.style || null })),
  ...(Array.isArray(def.events) ? def.events : []).filter((e) => e && e.key).map((e) => ({ key: e.key, label: e.label || e.key, kind: 'event' })),
]

/** Per output, can it alert / scan? The evaluability gate's own answer, never a guess. */
function capabilitiesOf(def) {
  const out = {}
  for (const o of outputsOf(def)) {
    const one = {}
    for (const lane of [LANES.ALERT, LANES.SCAN]) {
      try { one[lane] = (evaluability(def, o.key, lane, {}) || {}).status || null } catch { one[lane] = null }
    }
    out[o.key] = one
  }
  return out
}

/**
 * ⭐ ONE DEFINITION, AS DATA.
 * @returns `{ok:true, definition: {defId, name, shortName, kind, category, description,
 *   version, placement, inputs, outputs, capabilities, copyable}}` | refusal
 */
export function describeDefinition(defId, ctx = {}) {
  if (!visible(defId, ctx)) return refuse(REASONS.UNKNOWN_DEFINITION)
  const def = getDef(ctx.registry, defId)
  if (!def) return refuse(REASONS.UNKNOWN_DEFINITION)
  const meta = def.meta || {}
  const kind = kindOf(def)
  const verdict = copyVerdict(def, {})
  return {
    ok: true,
    definition: {
      contract: DEFINITIONS_CONTRACT,
      defId, name: meta.name || defId, shortName: meta.shortName || null,
      kind: USER_DEF.test(defId) ? 'custom' : (kind === 'builtin' ? 'builtin' : 'other'),
      category: meta.category || null, description: meta.description || '',
      version: Number.isInteger(def.version) ? def.version : null,
      placement: (def.placement && def.placement.target) || 'pane',
      inputs: (Array.isArray(def.inputs) ? def.inputs : []).map(inputSpecOf).filter(Boolean),
      outputs: outputsOf(def),
      capabilities: capabilitiesOf(def),
      copyable: verdict.ok ? { ok: true } : { ok: false, why: verdict.reason },
    },
  }
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim()

/**
 * ⭐ SEARCH — built-ins (the library's own rows) and the member's own formulas.
 * Ranked: exact name / short name / id, then prefix, then every query word found in
 * name, short name, tags, category or description. An empty query lists everything.
 * @param {string} query
 * @param {{registry, ownedDefinitionIds, limit?, kind?: 'builtin'|'custom'}} ctx
 * @returns {{defId, name, shortName, kind, category, placement, inputs, score}[]}
 */
export function searchDefinitions(query, ctx = {}) {
  const registry = ctx.registry
  const owned = ownedSet(ctx)
  let rows = []
  try {
    rows = [
      ...catalogRows(registry).filter((r) => r.engineOwned && !r.carvedOut).map((r) => ({ ...r, kind: 'builtin' })),
      ...userCatalogRows(registry).filter((r) => owned.has(r.id)).map((r) => ({ ...r, kind: 'custom' })),
    ]
  } catch { rows = [] }
  const q = norm(query)
  const words = q ? q.split(' ') : []
  const scored = []
  for (const r of rows) {
    if (ctx.kind && r.kind !== ctx.kind) continue
    if (!visible(r.id, ctx)) continue
    const name = norm(r.name); const short = norm(r.shortName); const id = norm(r.id)
    const hay = [name, short, id, norm(r.category), norm(r.description), ...(r.tags || []).map(norm)].join(' ')
    let score = 0
    if (!q) score = 1
    else if (q === name || q === short || q === id) score = 100
    else if (name.startsWith(q) || short.startsWith(q)) score = 60
    else if (words.every((w) => hay.includes(w))) score = 20 + words.filter((w) => name.includes(w) || short.includes(w)).length
    if (score > 0) scored.push({ r, score })
  }
  scored.sort((a, b) => b.score - a.score || a.r.name.localeCompare(b.r.name))
  const limit = Number.isInteger(ctx.limit) && ctx.limit > 0 ? ctx.limit : 25
  return scored.slice(0, limit).map(({ r, score }) => ({
    defId: r.id, name: r.name, shortName: r.shortName, kind: r.kind, category: r.category,
    placement: r.target, inputs: r.inputs || [], score,
  }))
}

/**
 * Which charts draw `defId`, and through which instances.
 * @param {{chartId, cs}[]} charts
 * @returns {{chartId, instances: {instanceId, name, hidden}[]}[]} — only charts that use it
 */
export function findDefinitionUsage(defId, charts, registry) {
  const out = []
  for (const c of (Array.isArray(charts) ? charts : [])) {
    const rows = instancesOf(c && c.cs, registry).filter((r) => !r.setting && r.defId === defId)
    if (rows.length) out.push({ chartId: c.chartId ?? null, instances: rows.map((r) => ({ instanceId: r.instanceId, name: r.name, hidden: r.hidden })) })
  }
  return out
}
const usageFingerprint = (usage) => `du:${fnv(canon(usage.map((u) => [u.chartId, u.instances.map((i) => i.instanceId)])))}`

// ─── plan → execute → (undo) ──────────────────────────────────────────────────

/**
 * PLAN — validate and pin. Writes nothing.
 * @param request `{op:'duplicate', defId, inputs?}` | `{op:'delete', defId, allowInUse?}`
 * @param ctx     `{registry, ownedDefinitionIds, canManage, charts?: [{chartId, cs}]}` — `charts`
 *                are every chart the Agent can see; a delete names the ones that use it
 */
export function planDefinitionAction(request, ctx = {}) {
  const req = isObj(request) ? request : {}
  if (!DEFINITION_OPS.includes(req.op) || typeof req.defId !== 'string' || !req.defId) return refuse(REASONS.BAD_REQUEST)
  if (ctx.canManage !== true) return refuse(REASONS.READONLY)
  if (!visible(req.defId, ctx)) return refuse(REASONS.UNKNOWN_DEFINITION)
  const def = getDef(ctx.registry, req.defId)
  if (!def) return refuse(REASONS.UNKNOWN_DEFINITION)
  const name = (def.meta && def.meta.name) || req.defId
  const base = { contract: DEFINITIONS_CONTRACT, op: req.op, defId: req.defId, pins: { version: Number.isInteger(def.version) ? def.version : null } }

  if (req.op === 'duplicate') {
    const inputs = isObj(req.inputs) ? { ...req.inputs } : {}
    const verdict = copyVerdict(def, inputs)
    if (!verdict.ok) return refuse(REASONS.UNSUPPORTED_DEFINITION, { why: verdict.reason })
    return { ok: true, plan: { ...base, args: { inputs }, preview: { name, kind: kindOf(def) } } }
  }
  // delete — only a member's own saved formula
  if (!USER_DEF.test(req.defId)) return refuse(REASONS.UNSUPPORTED_DEFINITION, { why: 'Built-in indicators cannot be deleted.' })
  const usage = findDefinitionUsage(req.defId, ctx.charts, ctx.registry)
  if (usage.length && req.allowInUse !== true) return refuse(REASONS.DEPENDENT_EXISTS, { usage })
  return { ok: true, plan: { ...base, args: { allowInUse: req.allowInUse === true },
    pins: { ...base.pins, usage: usageFingerprint(usage) },
    preview: { name, usage } } }
}

const receiptOf = (plan, status, extra = {}) => ({ contract: DEFINITIONS_CONTRACT, op: plan.op, status, defId: plan.defId, name: (plan.preview && plan.preview.name) || plan.defId, ...extra })

/**
 * EXECUTE — re-check permission and pins NOW, then run the product's own door.
 * @param deps `{fork, save, remove, read}` — default to the `useUserDefinitions` doors
 * @returns `{status:'confirmed', receipt, undo}` | `{status:'unconfirmed'|'did-not-land', reason, receipt, error?}` | refusal
 */
export async function executeDefinitionAction(plan, ctx = {}, deps = {}) {
  if (!isObj(plan) || plan.contract !== DEFINITIONS_CONTRACT || !DEFINITION_OPS.includes(plan.op)) return refuse(REASONS.BAD_REQUEST)
  if (ctx.canManage !== true) return refuse(REASONS.PERMISSION_CHANGED, { was: REASONS.READONLY })
  if (!visible(plan.defId, ctx)) return refuse(REASONS.PERMISSION_CHANGED, { was: REASONS.UNKNOWN_DEFINITION })
  const def = getDef(ctx.registry, plan.defId)
  if (!def) return refuse(REASONS.NOT_FOUND)
  if ((Number.isInteger(def.version) ? def.version : null) !== plan.pins.version) return refuse(REASONS.CHANGED_WHILE_WORKING, { what: 'definition' })
  const read = deps.read || readUserDefinition

  if (plan.op === 'duplicate') {
    const made = await createCustomCopy({ def, inputs: plan.args.inputs || {}, settings: null, registry: ctx.registry,
      ...(deps.fork ? { fork: deps.fork } : { fork: forkUserDefinition }), ...(deps.save ? { save: deps.save } : { save: saveUserDefinition }) })
    if (!made.ok) return { status: REASONS.NOT_LANDED, reason: REASONS.NOT_LANDED, receipt: receiptOf(plan, REASONS.NOT_LANDED), error: made.error }
    const newDefId = made.row.def_id
    const back = await read(newDefId)
    if (!back.ok || !getDef(ctx.registry, newDefId)) return { status: REASONS.UNCONFIRMED, reason: REASONS.UNCONFIRMED, receipt: receiptOf(plan, REASONS.UNCONFIRMED, { newDefId }) }
    const newName = (made.row.definition && made.row.definition.meta && made.row.definition.meta.name) || newDefId
    return {
      status: 'confirmed',
      receipt: receiptOf(plan, 'confirmed', { newDefId, newName, version: back.row.version ?? null }),
      // ⭐ the new definition's id must reach `ctx.ownedDefinitionIds` before `mutation/1`
      // will add it to a chart — the caller re-reads `useUserDefinitions` (it revalidates on save)
      undo: { contract: DEFINITIONS_CONTRACT, kind: 'undo', op: 'duplicate', defId: newDefId, name: newName, sourceDefId: plan.defId },
    }
  }

  // delete
  const usage = findDefinitionUsage(plan.defId, ctx.charts, ctx.registry)
  if (usageFingerprint(usage) !== plan.pins.usage) return refuse(REASONS.CHANGED_WHILE_WORKING, { what: 'usage', usage })
  if (usage.length && plan.args.allowInUse !== true) return refuse(REASONS.DEPENDENT_EXISTS, { usage })
  // ⛔ READ FIRST: without the stored document there is no exact Undo, so nothing is deleted
  // ⭐ F-15 — and WITH its stored Pine script (`?source=1`). A Pine import is the document
  // PLUS the script it was translated from, and its engine stamp (`meta.engineVersion`) is
  // only kept by a save that carries that script (`saveUserDefinition`). Reading the
  // document alone made Undo restore the maths and silently drop both.
  const before = await read(plan.defId, { withSource: true })
  // ⛔ F-15 follow-up — a read that fails BEFORE the delete is a REFUSAL: nothing was written.
  // As `unconfirmed` it reached the member as "UCT could not read it back" plus "some changes
  // could not be reversed" (`commit` marks `unconfirmed` as `unreverted`), both false here.
  if (!before.ok || !before.row.definition) return refuse(REASONS.UNSUPPORTED_DEFINITION, { why: DELETE_REFUSALS.unreadBefore })
  const pineSource = scriptOf(before.row)
  const refused = deleteRefusal(before.row, pineSource)
  // ⛔ EXACT OR NOTHING — and said as a REFUSAL (nothing was written), in the sentence that
  // is true of THIS row. An `unconfirmed` status here reached the member as "could not read
  // it back" plus "some changes could not be reversed", neither of which was true.
  if (refused) return refuse(REASONS.UNSUPPORTED_DEFINITION, { why: refused })
  const remove = deps.remove || deleteUserDefinition
  const gone = await remove(plan.defId)
  if (!gone.ok) return { status: REASONS.NOT_LANDED, reason: REASONS.NOT_LANDED, receipt: receiptOf(plan, REASONS.NOT_LANDED), error: gone.error }
  const after = await read(plan.defId)
  if (after.ok || after.status !== 404) return { status: REASONS.UNCONFIRMED, reason: REASONS.UNCONFIRMED, receipt: receiptOf(plan, REASONS.UNCONFIRMED) }
  return {
    status: 'confirmed',
    receipt: receiptOf(plan, 'confirmed', { usage }),
    undo: { contract: DEFINITIONS_CONTRACT, kind: 'undo', op: 'delete', defId: plan.defId, name: receiptOf(plan, '').name,
      definition: JSON.parse(JSON.stringify(before.row.definition)), repaint: !!before.row.repaint,
      ...(pineSource ? { pineSource } : {}) },
  }
}

/** The stored Pine script on a row read with `{withSource: true}`, or null. */
function scriptOf(row) {
  return row && typeof row.pine_source === 'string' && row.pine_source.trim() ? row.pine_source : null
}

/** Is this document marked as hand-edited by the save door (L2, `meta.scriptEdited`)? */
const editedMark = (def) => !!(isObj(def) && isObj(def.meta) && def.meta.scriptEdited === true)

/** Would a save WITHOUT a script mark this document `scriptEdited` (the save door's L2)? */
const wouldMarkEdited = (def) => isScriptDocument(def) && !editedMark(def)

/** Why a delete of this row could not be undone exactly — each sentence true of the row it
 *  names — so the Agent refuses it. Exported for the tests that rail the words.
 *  ⛔ Each is a CAUSE clause, said once: the Agent shows it as "That can’t be done: <why>" and
 *  the runtime then adds "nothing was left changed", so "nothing was deleted" is not repeated. */
export const DELETE_REFUSALS = Object.freeze({
  unreadBefore: 'could not read this indicator’s saved definition before deleting it, so a delete could not be undone exactly',
  scriptUnread: 'could not read this indicator’s saved script, so a delete could not be undone exactly',
  sharedCopy: 'this indicator is a copy shared with you, and a shared copy never carries the author’s Pine script, so a delete could not be undone exactly',
  stampWithoutScript: 'this indicator is marked as translated from a Pine script that is not stored with it, so a delete could not be undone exactly',
  legacyImport: 'this indicator was imported from Pine before its script was kept, so a delete could not be undone exactly',
})

/**
 * ⛔ F-15 — the sentence for a delete whose Undo could not be exact, or null.
 *
 * Undo re-saves the deleted document through `saveUserDefinition`. Without a script, that
 * door drops the engine stamp (`withoutEngineStamp`) and marks a script-shaped document
 * `meta.scriptEdited` (L2). So a row that changes under either rule, or one that holds a
 * script we did not get back, is not deleted. Which sentence is true depends on the row:
 *   • it HOLDS a script (`has_pine_source`) that the read did not return;
 *   • it is a copy installed from someone else's share (`origin`): `install_share` never
 *     stores the author's script, so there is none to read — "could not read" would be false;
 *   • it carries a stamp with no script beside it (no other door writes this today);
 *   • a LEGACY Pine import (ruling 2026-11-10): script-shaped, unstamped, no script, not yet
 *     marked — the restore would come back marked and never be offered its upgrade again.
 * ⭐ Decided 2026-11-11 (N1): an `origin` copy is still REFUSED, with its own sentence, not
 * restored without its stamp. Today that restore would behave the same (`upgradeKindOf` gives
 * 'current' or 'none', both drawn as stored; the server reads the stamp only on a row holding
 * a script), but it would not be the stored document, and "confirmed" here means exact.
 */
function deleteRefusal(row, pineSource) {
  if (pineSource) return null
  const def = row.definition
  if (row.has_pine_source === true) return DELETE_REFUSALS.scriptUnread
  const stamped = engineStampOf(def) !== null
  if (!stamped && !wouldMarkEdited(def)) return null
  if (isObj(def.origin)) return DELETE_REFUSALS.sharedCopy
  return stamped ? DELETE_REFUSALS.stampWithoutScript : DELETE_REFUSALS.legacyImport
}

/** What came back different after an Undo save, in words; empty when it is exact. */
function restoreDifferences(back, undo, pineSource) {
  const out = []
  const script = scriptOf(back.row)
  if (script !== pineSource) out.push(script === null ? 'without its saved script' : (pineSource === null ? 'with a script it did not have' : 'with a different saved script'))
  const stamp = engineStampOf(back.row.definition)
  if (stamp !== engineStampOf(undo.definition)) out.push(stamp === null ? 'without its engine version' : 'with a different engine version')
  const marked = editedMark(back.row.definition)
  if (marked !== editedMark(undo.definition)) out.push(marked ? 'marked as hand-edited' : 'no longer marked as hand-edited')
  // ⛔ F-15 N4 — and the same share provenance (`origin`). An unstamped, non-script-shaped
  // shared copy deletes, and its Undo re-PUTs a document carrying `origin`. The store keeps
  // the document's keys as sent (`json.dumps(..., sort_keys=True)`), so an exact restore reads
  // `origin` back unchanged; compared with `canon` (key order is not a difference).
  const origin = originOf(back.row.definition)
  const was = originOf(undo.definition)
  if (origin !== was) out.push(origin === null ? 'without the details of the share it was copied from' : (was === null ? 'with share details it did not have' : 'with different details of the share it was copied from'))
  return out
}

/** A document's share provenance (`origin`), canonical, or null when it has none. */
const originOf = (def) => (isObj(def) && def.origin != null ? canon(def.origin) : null)

/**
 * UNDO — exact or refused.
 *   delete    → the stored document re-saved under the SAME id (the server's resurrect);
 *               refused if something live already holds the id
 *   duplicate → the copy soft-deleted, refused while any named chart still draws it
 */
export async function undoDefinitionAction(undo, ctx = {}, deps = {}) {
  if (!isObj(undo) || undo.contract !== DEFINITIONS_CONTRACT || undo.kind !== 'undo' || !DEFINITION_OPS.includes(undo.op)) return refuse(REASONS.BAD_REQUEST)
  if (ctx.canManage !== true) return refuse(REASONS.PERMISSION_CHANGED, { was: REASONS.READONLY })
  const read = deps.read || readUserDefinition
  const base = { contract: DEFINITIONS_CONTRACT, op: 'undo', undoOf: undo.op, defId: undo.defId, name: undo.name || undo.defId }
  if (undo.op === 'delete') {
    const now = await read(undo.defId)
    if (now.ok) return refuse(REASONS.RESTORE_CONFLICT, { why: 'the definition is live again' })
    // ⛔ F-15 follow-up — only a 404 says the id is free. Any other answer (no answer, a 5xx, a
    // 403, or a 200 whose body held no definition: `readUserDefinition` returns that as not ok)
    // leaves it unknown, and nothing has been written yet, so this is a REFUSAL. As `unconfirmed`
    // the member read "UCT could not read it back", which named a read-back that never happened.
    if (now.status !== 404) return refuse(REASONS.RESTORE_CONFLICT, { why: 'UCT could not check whether that indicator already exists' })
    // ⭐ F-15 — a stamped document is only restored WITH its script: the save door drops a
    // stamp it cannot check against one. An undo record without the script (made before
    // this fix, or edited) cannot be exact, so it is refused before anything is written.
    const pineSource = typeof undo.pineSource === 'string' && undo.pineSource.trim() ? undo.pineSource : null
    // ⚠️ N3 — "was not kept" is true only of a record whose row HELD a script. It would be false
    // for a stamped row that never held one (a shared copy, or a stamp with no script beside
    // it), and the record cannot tell those apart (it carries no `has_pine_source`). No such
    // record reaches this line: the delete above refuses every stamped row it cannot read a
    // script for, so a stamped record always carries `pineSource`; and Undo records live only
    // in the tab's memory (`useAgent` `undoRef`), so a record made by pre-F-15 code is undone
    // by pre-F-15 code. Only a hand-edited record can arrive here (the tests make one).
    if (engineStampOf(undo.definition) !== null && !pineSource) {
      return refuse(REASONS.RESTORE_CONFLICT, { why: 'the indicator’s saved script was not kept' })
    }
    // ⛔ F-15 N2 — the delete's own legacy rule, asked again of the RECORD: without a script
    // the save door marks a script-shaped document `scriptEdited` (L2), so this restore
    // could not be exact either. Refused before anything is written. (The delete never
    // makes such a record; this guards one made before F-15, or edited.)
    if (!pineSource && wouldMarkEdited(undo.definition)) {
      return refuse(REASONS.RESTORE_CONFLICT, { why: 'it was imported from Pine before its script was kept' })
    }
    const save = deps.save || saveUserDefinition
    const options = {
      ...(undo.repaint ? { previewAcked: true } : {}),
      ...(pineSource ? { pineSource } : {}),
    }
    const res = await save(undo.definition, undo.defId, null, Object.keys(options).length ? options : null)
    if (!res.ok) return { status: REASONS.NOT_LANDED, reason: REASONS.NOT_LANDED, receipt: { ...base, status: REASONS.NOT_LANDED }, error: res.error }
    const back = await read(undo.defId, { withSource: true })
    if (!back.ok) return { status: REASONS.UNCONFIRMED, reason: REASONS.UNCONFIRMED, receipt: { ...base, status: REASONS.UNCONFIRMED } }
    // ⛔ CONFIRMED MEANS EXACT. The read-back must hold the same script, the same engine
    // stamp, the same hand-edited mark (`meta.scriptEdited`, N2) and the same share
    // provenance (`origin`, N4) the deleted row held;
    // anything else is reported, in words that name what differs, never called confirmed.
    const differs = restoreDifferences(back, undo, pineSource)
    if (differs.length) {
      return { status: REASONS.NOT_LANDED, reason: REASONS.NOT_LANDED, receipt: { ...base, status: REASONS.NOT_LANDED },
        error: `The indicator came back, but ${differs.join(' and ')}, so it is not exactly as it was.` }
    }
    return { status: 'confirmed', receipt: { ...base, status: 'confirmed', version: back.row.version ?? null }, undo: null }
  }
  // undo duplicate
  if (!USER_DEF.test(undo.defId)) return refuse(REASONS.BAD_REQUEST)
  const usage = findDefinitionUsage(undo.defId, ctx.charts, ctx.registry)
  if (usage.length) return refuse(REASONS.DEPENDENT_EXISTS, { usage })
  const remove = deps.remove || deleteUserDefinition
  const gone = await remove(undo.defId)
  if (!gone.ok) return { status: REASONS.NOT_LANDED, reason: REASONS.NOT_LANDED, receipt: { ...base, status: REASONS.NOT_LANDED }, error: gone.error }
  const after = await read(undo.defId)
  if (after.ok || after.status !== 404) return { status: REASONS.UNCONFIRMED, reason: REASONS.UNCONFIRMED, receipt: { ...base, status: REASONS.UNCONFIRMED } }
  return { status: 'confirmed', receipt: { ...base, status: 'confirmed' }, undo: null }
}
