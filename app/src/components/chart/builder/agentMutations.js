// app/src/components/chart/builder/agentMutations.js
//
// ─── ⭐ AGENT MILESTONE 2 — THE INDICATORS-OWNED MUTATION INTERFACE ─────────────────
//
// UCT Agent adds, removes, shows and hides indicators on ONE chart through this file
// and nothing else (`docs/indicators/AGENT-INTEGRATION-HANDOFF.md` §14–§15). Agent owns
// routing, chart selection, proposals, presentation and the persist call; Indicators
// owns what the change IS, who may make it, whether it is stale, whether it landed and
// how it is undone.
//
// ⛔ NO SECOND WRITER. Every change is made by the writer the product UI already uses:
//   add        → `instanceControls.addInstance`  (Add to Chart: `createFromResult` → addInstance)
//   remove     → `instanceControls.removeInstance` (Chart Settings ✕, legend chip Delete)
//   show/hide  → `instanceControls.setInstanceHidden` (Chart Settings eye, legend chip eye)
// This file only RECORDS what the writer changed, so the change can be verified after
// persistence and undone exactly.
//
// ⛔ PURE. No React, no network, no persistence. The caller persists the returned
// settings through the chart's one persist path and hands the read-back to
// `confirmIndicatorMutation`; nothing here claims a save it did not see.

import { addInstance, removeInstance, setInstanceHidden, findInstance, groupMemberIds } from '../engine/instanceControls'
import { sourceInputsOf, sourceDependsOn } from '../engine/sourceRef'
import { infoValuesOf } from '../engine/infoValues'
import { adoptOverlayAverages } from '../maAdoption'
import { mergeChartSettings } from '../chartDefaults'
import { isInstanceTombstone } from '../instanceShape'
import { STUDIO_PREVIEW_DEF_ID } from './studio/chartPreview'
import { instancesOf, instanceFingerprint } from './agentSeams'

export const MUTATION_CONTRACT = 'uct.indicators.mutation/1'
export const MUTATION_OPS = Object.freeze(['add', 'remove', 'setVisible'])

/** Every refusal this interface returns. Stable strings: receipts and tests pin them. */
export const REASONS = Object.freeze({
  BAD_REQUEST: 'bad-request',                     // malformed request / plan / token
  READONLY: 'readonly',                           // the chart cannot manage indicators
  PERMISSION_CHANGED: 'permission-changed',       // access lost between plan and execution
  UNKNOWN_DEFINITION: 'unknown-definition',       // not a built-in, not the member's own saved definition
  UNSUPPORTED_DEFINITION: 'unsupported-definition', // exists, but the Library does not add it through addInstance
  NOT_FOUND: 'not-found',                         // no live instance with that id on this chart
  AMBIGUOUS: 'ambiguous',                         // a name matched more than one instance
  WRITER_REFUSED: 'writer-refused',               // the canonical writer returned the settings unchanged
  NO_CHANGE: 'no-change',                         // already in the requested state
  CHANGED_WHILE_WORKING: 'changed-while-working', // the target, its dependents, its definition version or the board revision moved
  RESTORE_CONFLICT: 'restore-conflict',           // Undo can no longer be exact
  DEPENDENT_EXISTS: 'dependent-exists',           // Undo-add would sever something that now reads the instance
  UNCONFIRMED: 'unconfirmed',                     // no read-back to verify against
  NOT_LANDED: 'did-not-land',                     // the read-back does not show the change
})

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const USER_DEF = /^u_[0-9a-f]{12}$/
const refuse = (reason, detail) => (detail === undefined ? { ok: false, reason } : { ok: false, reason, detail })
const isPreview = (inst) => !!inst && ((typeof inst.instanceId === 'string' && inst.instanceId.includes(STUDIO_PREVIEW_DEF_ID))
  || (typeof inst.defId === 'string' && inst.defId.includes(STUDIO_PREVIEW_DEF_ID)))

/** The settings exactly as the chart's own settings rows read them (the classic
 *  averages adopted as instances — `maAdoption`, idempotent). */
const viewOf = (cs) => (isObj(cs) ? (adoptOverlayAverages(cs) || cs) : null)
/** The settings as the chart READS THEM BACK after a save: stored (JSON) and merged
 *  (`mergeChartSettings`, which also adopts). Records, confirmations and Undo all
 *  compare in this space, so a reload is never mistaken for a conflict. */
const normOf = (cs) => {
  if (!isObj(cs)) return null
  try { return mergeChartSettings(JSON.stringify(cs)) } catch { return null }
}
const recordOf = (ids, prev, next) => ({ contract: MUTATION_CONTRACT, ids, ...changeRecord(normOf(prev), normOf(next)) })

const getDefOf = (registry) => (id) => {
  try {
    if (typeof registry === 'function') return registry(id) || null
    if (registry && typeof registry.getDefinition === 'function') return registry.getDefinition(id) || null
  } catch { /* an unreadable registry resolves nothing */ }
  return null
}

// ─── canonical JSON, fingerprints ─────────────────────────────────────────────

const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : isObj(v) ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
    : JSON.stringify(v === undefined ? null : v))
const fnv = (text) => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}
const same = (a, b) => canon(a) === canon(b)
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

/**
 * ⭐ A fingerprint of ONE logical indicator: the stored objects of `ids` (tombstones
 * included — a removal is state), in id order. `gf:<n>:<fnv1a>`. Changes when any of
 * them is edited, hidden, removed or revived; unchanged by every other chart change.
 */
export function groupFingerprint(cs, ids) {
  const view = viewOf(cs)
  const list = view && Array.isArray(view.indicatorInstances) ? view.indicatorInstances : []
  const want = [...new Set(ids || [])].sort()
  const objs = want.map((id) => list.find((i) => isObj(i) && i.instanceId === id) || null)
  return `gf:${want.length}:${fnv(canon([want, objs]))}`
}

/** The ids that act with `instanceId` (its group; itself when ungrouped). */
function groupOf(cs, instanceId) {
  return [...groupMemberIds(cs, instanceId)].sort()
}

/**
 * ⭐ EVERYTHING A REMOVAL OF `ids` WOULD SEVER, as plain data — shown in the proposal
 * before the member approves, and pinned so Apply refuses if it grows.
 *  · `kind: 'source'`    — another live indicator's source input reads one of `ids`
 *  · `kind: 'infoValue'` — a header info value reads one of `ids`
 * Deterministic order. `name` is the dependent's legend name (display only).
 */
export function dependentsOf(cs, ids, registry) {
  const view = viewOf(cs)
  if (!view) return []
  const set = new Set(ids || [])
  const defOf = getDefOf(registry)
  const names = new Map(instancesOf(view, registry).map((s) => [s.instanceId, s.name]))
  const out = []
  for (const inst of (Array.isArray(view.indicatorInstances) ? view.indicatorInstances : [])) {
    if (!isObj(inst) || isInstanceTombstone(inst) || set.has(inst.instanceId) || isPreview(inst)) continue
    for (const [key, value] of sourceInputsOf(defOf(inst.defId), inst)) {
      const target = sourceDependsOn(value)
      if (target && set.has(target)) out.push({ kind: 'source', instanceId: inst.instanceId, key, reads: target, name: names.get(inst.instanceId) || inst.instanceId })
    }
  }
  infoValuesOf(view).forEach((o, index) => {
    if (o && !o.severed && set.has(o.instanceId)) out.push({ kind: 'infoValue', index, reads: o.instanceId, name: names.get(o.instanceId) || o.instanceId })
  })
  return out.sort((a, b) => canon([a.kind, a.instanceId || '', a.key || '', a.index ?? -1]).localeCompare(canon([b.kind, b.instanceId || '', b.key || '', b.index ?? -1])))
}

// ─── the change record: what a writer changed, path by path ───────────────────
//
// Arrays of objects with a unique string `instanceId` are KEYED (a path names the
// instance, not its index), so an edit to ANOTHER indicator never conflicts with
// this one. Any other array — or a keyed array whose ids or order changed — is one
// leaf, compared whole: coarser, never inexact.

const keyedIds = (arr) => {
  if (!Array.isArray(arr) || !arr.length) return null
  const ids = arr.map((e) => (isObj(e) && typeof e.instanceId === 'string' ? e.instanceId : null))
  return ids.every(Boolean) && new Set(ids).size === ids.length ? ids : null
}

function diffInto(a, b, path, out) {
  if (same(a, b)) return
  if (isObj(a) && isObj(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) diffInto(a[k], b[k], [...path, k], out)
    return
  }
  const ka = keyedIds(a); const kb = keyedIds(b)
  if (ka && kb && ka.length === kb.length && same([...ka].sort(), [...kb].sort())) {
    // same instances: compare each BY ID, and the order as its own entry (a removal's
    // tombstone re-sorts to the end — that must not make every later edit a conflict)
    for (const id of ka) diffInto(a.find((e) => e.instanceId === id), b.find((e) => e.instanceId === id), [...path, { instanceId: id }], out)
    if (!same(ka, kb)) out.push({ path, order: { before: ka, after: kb } })
    return
  }
  out.push({ path, before: clone(a), after: clone(b) })
}

/** The recorded ids' order as they appear NOW in the keyed array at `path`. */
const orderAt = (root, entry) => {
  const arr = getAt(root, entry.path)
  const want = new Set(entry.order.after)
  return Array.isArray(arr) ? arr.map((e) => (isObj(e) ? e.instanceId : null)).filter((id) => want.has(id)) : null
}
/** Put the recorded ids back in `order` relative order; anything added since keeps its
 *  relative place after them (deterministic). */
function reorderAt(root, entry, order) {
  const arr = getAt(root, entry.path)
  const byId = new Map(arr.map((e) => [e.instanceId, e]))
  const recorded = new Set(order)
  const extras = arr.filter((e) => !recorded.has(e.instanceId))
  return setAt(root, entry.path, [...order.filter((id) => byId.has(id)).map((id) => byId.get(id)), ...extras])
}
const holds = (root, entry) => (entry.order ? same(orderAt(root, entry), entry.order.after) : same(getAt(root, entry.path), entry.after))

/** `{ paths: [{path, before, after}] }` — every leaf `next` differs from `prev` on. */
export function changeRecord(prev, next) {
  const paths = []
  diffInto(prev, next, [], paths)
  return { paths }
}

const step = (node, seg) => {
  if (node === undefined || node === null) return undefined
  if (isObj(seg)) return Array.isArray(node) ? node.find((e) => isObj(e) && e.instanceId === seg.instanceId) : undefined
  return isObj(node) ? node[seg] : undefined
}
const getAt = (root, path) => path.reduce(step, root)

function setAt(root, path, value) {
  if (!path.length) return clone(value)
  const [seg, ...rest] = path
  if (isObj(seg)) {
    const arr = Array.isArray(root) ? root : []
    const i = arr.findIndex((e) => isObj(e) && e.instanceId === seg.instanceId)
    if (i < 0) throw new Error('missing keyed element')
    const copy = arr.slice()
    copy[i] = setAt(arr[i], rest, value)
    return copy
  }
  const obj = isObj(root) ? { ...root } : {}
  const v = setAt(obj[seg], rest, value)
  if (v === undefined) delete obj[seg]; else obj[seg] = v
  return obj
}

/** Apply `before` at every recorded path, only if every path still holds `after`. */
function revert(cs, record) {
  for (const p of record.paths) {
    if (!holds(cs, p)) return refuse(REASONS.RESTORE_CONFLICT, { path: p.path })
  }
  let next = cs
  try {
    for (const p of record.paths) if (!p.order) next = setAt(next, p.path, p.before)
    for (const p of record.paths) if (p.order) next = reorderAt(next, p, p.order.before)
  } catch {
    return refuse(REASONS.RESTORE_CONFLICT, { path: null })
  }
  return { ok: true, cs: next }
}

/**
 * ⭐ `removeInstance`, plus the record that undoes it exactly. The returned `cs` is
 * the writer's own result (identical to `removeInstance`); `record.paths` lists every
 * leaf it changed — the tombstones, every severed source input and info value, the
 * definition's enabled mirror, `preset`.
 */
export function removeInstanceWithRecord(cs, instanceId, registry) {
  const view = viewOf(cs)
  if (!view || !findInstance(view, instanceId)) return refuse(REASONS.NOT_FOUND)
  const ids = groupOf(view, instanceId)
  const next = removeInstance(view, instanceId, registry)
  if (next === view) return refuse(REASONS.WRITER_REFUSED)
  return { ok: true, cs: next, record: recordOf(ids, view, next) }
}

/**
 * ⭐ THE REVIVE. Restores a removal exactly — the same instance ids at the same
 * positions with the same definition, inputs, placement and presentation; every
 * severed source and info value re-attached; the mirror and `preset` as they were —
 * ONLY IF every recorded path still holds the value the removal left there.
 * Otherwise `{ok:false, reason:'restore-conflict', detail:{path}}` and nothing is written.
 */
export function restoreRemoved(cs, record) {
  if (!isObj(record) || !Array.isArray(record.paths) || !Array.isArray(record.ids)) return refuse(REASONS.BAD_REQUEST)
  const view = normOf(cs)
  if (!view) return refuse(REASONS.BAD_REQUEST)
  const r = revert(view, record)
  if (!r.ok) return r
  if (!record.ids.every((id) => findInstance(r.cs, id))) return refuse(REASONS.RESTORE_CONFLICT, { path: null })
  return r
}

// ─── permission ───────────────────────────────────────────────────────────────

/**
 * ⭐ THE ONE PERMISSION ANSWER for an Agent indicator mutation. Asked at PLAN time and
 * again at EXECUTION and at every UNDO — the caller passes a FRESH `ctx` each time:
 *   ctx.canManage            `ChartPane.canManageIndicators()` (the toolbar's own predicate)
 *   ctx.ownedDefinitionIds   the member's own saved definition ids (`useUserDefinitions` rows)
 *   ctx.registry             the engine registry (`nativeRegistry`)
 * The Agent's own gate (paid + admin-dark) is Agent's and is checked before this.
 */
export function checkIndicatorPermission(op, args, ctx) {
  const c = ctx || {}
  if (!MUTATION_OPS.includes(op)) return refuse(REASONS.BAD_REQUEST)
  if (c.canManage !== true) return refuse(REASONS.READONLY)
  if (op === 'add') {
    const defId = args && args.defId
    if (typeof defId !== 'string' || !defId) return refuse(REASONS.BAD_REQUEST)
    if (defId.includes(STUDIO_PREVIEW_DEF_ID)) return refuse(REASONS.UNKNOWN_DEFINITION)
    const def = getDefOf(c.registry)(defId)
    if (!def) return refuse(REASONS.UNKNOWN_DEFINITION)
    if (USER_DEF.test(defId)) {
      const owned = new Set(Array.isArray(c.ownedDefinitionIds) ? c.ownedDefinitionIds : [...(c.ownedDefinitionIds || [])])
      if (!owned.has(defId)) return refuse(REASONS.UNKNOWN_DEFINITION)
    }
  }
  return { ok: true }
}

/**
 * Which instance a member meant, on ONE chart. An `instanceId` is exact; a `name` is
 * matched against the legend names and refused as `ambiguous` (with the candidates)
 * when more than one instance carries it. Volume (a setting) and the live preview are
 * never targets.
 */
export function resolveIndicatorTarget(cs, registry, { instanceId, name } = {}) {
  const rows = instancesOf(cs, registry).filter((r) => !r.setting)
  if (typeof instanceId === 'string' && instanceId) {
    const hit = rows.find((r) => r.instanceId === instanceId)
    return hit ? { ok: true, instanceId: hit.instanceId, name: hit.name } : refuse(REASONS.NOT_FOUND)
  }
  if (typeof name === 'string' && name.trim()) {
    const want = name.trim().toLowerCase()
    const hits = rows.filter((r) => r.name.toLowerCase() === want)
    if (hits.length === 1) return { ok: true, instanceId: hits[0].instanceId, name: hits[0].name }
    if (hits.length > 1) return refuse(REASONS.AMBIGUOUS, { candidates: hits.map((h) => ({ instanceId: h.instanceId, name: h.name })) })
    return refuse(REASONS.NOT_FOUND)
  }
  return refuse(REASONS.BAD_REQUEST)
}

// ─── plan → apply → confirm → (undo → confirm) ────────────────────────────────

const defVersionOf = (registry, defId) => {
  const def = getDefOf(registry)(defId)
  return def && Number.isInteger(def.version) ? def.version : null
}
const nameOf = (cs, registry, id) => (instancesOf(cs, registry).find((r) => r.instanceId === id) || {}).name || null

/**
 * PLAN — validate and pin. Writes nothing.
 * @param cs       the chart's current settings
 * @param request  `{op:'add', defId}` | `{op:'remove', instanceId}` | `{op:'setVisible', instanceId, visible}`
 * @param ctx      see `checkIndicatorPermission`; plus optional `ctx.boardRevision`
 * @returns `{ok:true, plan}` | refusal. `plan` is plain JSON.
 */
export function planIndicatorMutation(cs, request, ctx) {
  const view = viewOf(cs)
  const req = isObj(request) ? request : {}
  if (!view || !MUTATION_OPS.includes(req.op)) return refuse(REASONS.BAD_REQUEST)
  const perm = checkIndicatorPermission(req.op, req, ctx)
  if (!perm.ok) return perm
  const registry = ctx.registry
  const base = { contract: MUTATION_CONTRACT, op: req.op, boardRevision: ctx.boardRevision ?? null, instanceFingerprint: instanceFingerprint(view) }

  if (req.op === 'add') {
    const next = addInstance(view, req.defId, registry)
    if (next === view) return refuse(REASONS.UNSUPPORTED_DEFINITION)
    const def = getDefOf(registry)(req.defId)
    return { ok: true, plan: { ...base, args: { defId: req.defId }, target: { ids: [], defId: req.defId },
      pins: { defVersion: defVersionOf(registry, req.defId) },
      preview: { name: (def.meta && def.meta.name) || req.defId, severs: [] } } }
  }

  const t = resolveIndicatorTarget(view, registry, { instanceId: req.instanceId })
  if (!t.ok) return t
  const ids = groupOf(view, t.instanceId)
  const inst = findInstance(view, t.instanceId)
  if (req.op === 'setVisible') {
    if (typeof req.visible !== 'boolean') return refuse(REASONS.BAD_REQUEST)
    if (ids.every((id) => (findInstance(view, id) || {}).hidden === !req.visible)) return refuse(REASONS.NO_CHANGE)
  }
  const severs = req.op === 'remove' ? dependentsOf(view, ids, registry) : []
  return { ok: true, plan: { ...base,
    args: req.op === 'remove' ? { instanceId: t.instanceId } : { instanceId: t.instanceId, visible: req.visible },
    target: { ids, defId: inst.defId },
    pins: { groupFingerprint: groupFingerprint(view, ids), dependents: req.op === 'remove' ? severs : dependentsOf(view, ids, registry) },
    preview: { name: t.name, severs } } }
}

/** Re-check permission and every pin against the CURRENT settings. */
function revalidate(view, plan, ctx) {
  const perm = checkIndicatorPermission(plan.op, plan.op === 'add' ? plan.args : {}, ctx)
  if (!perm.ok) return perm.reason === REASONS.BAD_REQUEST ? perm : refuse(REASONS.PERMISSION_CHANGED, { was: perm.reason })
  if (plan.boardRevision !== null && ctx.boardRevision !== undefined && ctx.boardRevision !== plan.boardRevision) {
    return refuse(REASONS.CHANGED_WHILE_WORKING, { what: 'board' })
  }
  if (plan.op === 'add') {
    if (defVersionOf(ctx.registry, plan.args.defId) !== plan.pins.defVersion) return refuse(REASONS.CHANGED_WHILE_WORKING, { what: 'definition' })
    return { ok: true }
  }
  const ids = plan.target.ids
  if (!findInstance(view, plan.args.instanceId)) return refuse(REASONS.NOT_FOUND)
  if (!same(groupOf(view, plan.args.instanceId), ids)) return refuse(REASONS.CHANGED_WHILE_WORKING, { what: 'group' })
  if (groupFingerprint(view, ids) !== plan.pins.groupFingerprint) return refuse(REASONS.CHANGED_WHILE_WORKING, { what: 'indicator' })
  if (!same(dependentsOf(view, ids, ctx.registry), plan.pins.dependents)) return refuse(REASONS.CHANGED_WHILE_WORKING, { what: 'dependents' })
  return { ok: true }
}

const pendingFor = (op, plan, view, next, record, registry, extra = {}) => ({
  contract: MUTATION_CONTRACT, kind: 'pending', op, ids: record.ids,
  defId: plan.target.defId, name: extra.name || null,
  // ⭐ the record IS the expectation: every leaf (and order) the persisted read-back must
  // hold — and the Undo token minted on confirmation carries it
  record,
  ...extra,
  instanceFingerprintAfter: instanceFingerprint(next),
})

/**
 * APPLY — re-check permission and pins NOW, then run the canonical writer.
 * @returns `{ok:true, cs, pending}` — `cs` is what to persist (through the chart's one
 *          persist path); `pending` is handed to `confirmIndicatorMutation` with the
 *          read-back. ⛔ Nothing is "done" yet. | refusal (nothing to write).
 */
export function applyIndicatorMutation(cs, plan, ctx) {
  const view = viewOf(cs)
  if (!view || !isObj(plan) || plan.contract !== MUTATION_CONTRACT || !MUTATION_OPS.includes(plan.op)) return refuse(REASONS.BAD_REQUEST)
  const c = ctx || {}
  const ok = revalidate(view, plan, c)
  if (!ok.ok) return ok
  const registry = c.registry

  if (plan.op === 'add') {
    const next = addInstance(view, plan.args.defId, registry)
    if (next === view) return refuse(REASONS.WRITER_REFUSED)
    const before = new Set((view.indicatorInstances || []).map((i) => i && i.instanceId))
    const ids = (next.indicatorInstances || []).filter((i) => i && !before.has(i.instanceId)).map((i) => i.instanceId).sort()
    const record = recordOf(ids, view, next)
    return { ok: true, cs: next, pending: pendingFor('add', plan, view, next, record, registry, { name: nameOf(next, registry, ids[0]) }) }
  }
  if (plan.op === 'remove') {
    const r = removeInstanceWithRecord(view, plan.args.instanceId, registry)
    if (!r.ok) return r
    return { ok: true, cs: r.cs, pending: pendingFor('remove', plan, view, r.cs, r.record, registry, { name: plan.preview.name, severed: plan.preview.severs }) }
  }
  const next = setInstanceHidden(view, plan.args.instanceId, !plan.args.visible, registry)
  if (next === view) return refuse(REASONS.WRITER_REFUSED)
  const record = recordOf(plan.target.ids, view, next)
  return { ok: true, cs: next, pending: pendingFor('setVisible', plan, view, next, record, registry, { name: plan.preview.name, visible: plan.args.visible }) }
}

/**
 * CONFIRM — the only door to "done". `persisted` is the chart's settings READ BACK
 * after the persist ACK (the board's stored copy as the chart reads it). Every leaf the
 * writer changed must hold its new value.
 * @returns
 *   `{status:'confirmed', receipt, undo}` — `undo` is the in-memory Undo token
 *   `{status:'unconfirmed', reason:'unconfirmed', receipt}` — no read-back; never report success
 *   `{status:'did-not-land', reason:'did-not-land', receipt, mismatch}` — the read-back disagrees
 */
export function confirmIndicatorMutation(persisted, pending, ctx) {
  if (!isObj(pending) || pending.contract !== MUTATION_CONTRACT || pending.kind !== 'pending') {
    return { status: REASONS.BAD_REQUEST, reason: REASONS.BAD_REQUEST, receipt: null }
  }
  const receipt = (status) => ({
    contract: MUTATION_CONTRACT, op: pending.undoOf ? 'undo' : pending.op, status, instanceIds: pending.ids.slice(),
    defId: pending.defId, name: pending.name,
    ...(pending.undoOf ? { undoOf: pending.undoOf } : {}),
    ...(pending.op === 'setVisible' ? { visible: pending.visible } : {}),
    ...(pending.op === 'remove' && !pending.undoOf ? { severed: (pending.severed || []).map((d) => ({ ...d })) } : {}),
    ...(pending.restored ? { restored: pending.restored.map((d) => ({ ...d })) } : {}),
    chartId: (ctx && ctx.chartId) ?? null,
  })
  const view = normOf(persisted)
  if (!view) return { status: REASONS.UNCONFIRMED, reason: REASONS.UNCONFIRMED, receipt: receipt(REASONS.UNCONFIRMED) }
  const mismatch = pending.record.paths.find((e) => !holds(view, e))
  if (mismatch) return { status: REASONS.NOT_LANDED, reason: REASONS.NOT_LANDED, receipt: receipt(REASONS.NOT_LANDED), mismatch: { path: mismatch.path } }
  const done = receipt('confirmed')
  if (pending.undoOf) return { status: 'confirmed', receipt: done, undo: null }
  return {
    status: 'confirmed', receipt: done,
    undo: { contract: MUTATION_CONTRACT, kind: 'undo', op: pending.op, ids: pending.ids.slice(), defId: pending.defId,
      name: pending.name, chartId: done.chartId, record: pending.record, severed: (pending.severed || []).map((d) => ({ ...d })),
      groupFingerprintAfter: groupFingerprint(view, pending.ids) },
  }
}

/**
 * UNDO — exact or refused. Re-checks permission with a fresh `ctx`.
 *   remove     → `restoreRemoved` (same ids, positions, inputs, dependents)
 *   setVisible → the recorded `hidden` leaves put back (the same writer's fields), exact
 *   add        → `removeInstance` of the created instance (the product's own delete;
 *                refused while anything reads it)
 * @returns `{ok:true, cs, pending}` (confirm it like any mutation) | refusal.
 */
export function undoIndicatorMutation(cs, undo, ctx) {
  const view = normOf(cs)
  const c = ctx || {}
  if (!view || !isObj(undo) || undo.contract !== MUTATION_CONTRACT || undo.kind !== 'undo' || !isObj(undo.record)) return refuse(REASONS.BAD_REQUEST)
  if (c.chartId !== undefined && undo.chartId !== null && c.chartId !== undo.chartId) return refuse(REASONS.BAD_REQUEST)
  if (c.canManage !== true) return refuse(REASONS.PERMISSION_CHANGED, { was: REASONS.READONLY })
  const plan = { target: { defId: undo.defId } }

  if (undo.op === 'remove' || undo.op === 'setVisible') {
    if (undo.op === 'setVisible' && groupFingerprint(view, undo.ids) !== undo.groupFingerprintAfter) {
      return refuse(REASONS.RESTORE_CONFLICT, { path: ['indicatorInstances'] })
    }
    const r = undo.op === 'remove' ? restoreRemoved(view, undo.record) : revert(view, undo.record)
    if (!r.ok) return r
    const record = recordOf(undo.ids, view, r.cs)
    return { ok: true, cs: r.cs, pending: pendingFor(undo.op, plan, view, r.cs, record, c.registry, {
      name: undo.name, undoOf: undo.op, ...(undo.op === 'remove' ? { restored: Array.isArray(undo.severed) ? undo.severed : [] } : {}), ...(undo.op === 'setVisible' ? { visible: findInstance(r.cs, undo.ids[0])?.hidden !== true } : {}) }) }
  }
  if (undo.op === 'add') {
    const id = undo.ids[0]
    if (!id || !findInstance(view, id)) return refuse(REASONS.RESTORE_CONFLICT, { path: null })
    if (groupFingerprint(view, undo.ids) !== undo.groupFingerprintAfter) return refuse(REASONS.RESTORE_CONFLICT, { path: ['indicatorInstances', { instanceId: id }] })
    if (dependentsOf(view, undo.ids, c.registry).length) return refuse(REASONS.DEPENDENT_EXISTS)
    const r = removeInstanceWithRecord(view, id, c.registry)
    if (!r.ok) return r
    return { ok: true, cs: r.cs, pending: pendingFor('remove', plan, view, r.cs, r.record, c.registry, { name: undo.name, undoOf: 'add' }) }
  }
  return refuse(REASONS.BAD_REQUEST)
}
