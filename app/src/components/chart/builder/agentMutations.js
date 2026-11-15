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
//   setInputs  → `instanceControls.setInstanceInput` / `setIndicatorInput` (the settings rows' own two
//                doors, routed as `indicatorRegistry.applyRowPatch` routes them) — Gate C, in-place edit
// This file only RECORDS what the writer changed, so the change can be verified after
// persistence and undone exactly.
//
// ⛔ PURE. No React, no network, no persistence. The caller persists the returned
// settings through the chart's one persist path and hands the read-back to
// `confirmIndicatorMutation`; nothing here claims a save it did not see.

import { addInstance, removeInstance, setInstanceHidden, findInstance, groupMemberIds, setInstanceInput, setIndicatorInput, checkInstanceInput, inputSpecOf,
  setInstanceAppearance, setInstancePlotStyle, setInstanceCandleColor, setInstanceDisplayTarget, duplicateInstance, isValidColorValue,
  setInstanceVisibility, setInstanceDotSize, dotPlotsOf, instanceDotSizeReading } from '../engine/instanceControls'
import { setInstanceCalculationTimeframe } from '../engine/instanceControls'
import { normalizeVisibility, visibilitySummary, VISIBILITY_PRESETS } from '../engine/instanceTimeframe'
import { CALC_TIMEFRAMES, calcTimeframeOf, calcTimeframeLabel, frameRelation, gatedReason } from '../engine/instanceTimeframe'
import { calcTimeframeCapability, CAPABILITY_WORDS } from '../engine/calcTimeframeCapability'
import { displayTargetOptions, automaticTargetOf, resolveDisplayTarget, paneOwnerOf } from '../engine/displayTarget'
import { movePane as movePaneWriter, movePaneTo, resolvePaneOrder, storedPaneOrder } from '../engine/paneOrder'
import { setPaneSize as setPaneSizeWriter, clearPaneSize, storedPaneSizes } from '../engine/paneSizes'
import { LINE_WIDTH_CHOICES, LINE_STYLE_CHOICES, DEFAULT_LINE_WIDTH_CHOICE, DEFAULT_LINE_STYLE_CHOICE, resolveSignColors, resolvePlotStyle,
  DOT_SIZES, DEFAULT_DOT_SIZE, storedDotSize } from '../engine/presentation'
import { styleChoicesFor } from '../engine/styleCapability'
import { paneArrangeArgs } from './agentPanes'
import { captureIndicatorTemplate, applyIndicatorTemplate } from './indicatorTemplates'
import { legacyInstanceId } from '../engine/instances'
import { sourceInputsOf, sourceDependsOn, instanceLabel } from '../engine/sourceRef'
import { infoValuesOf } from '../engine/infoValues'
import { adoptOverlayAverages } from '../maAdoption'
import { mergeChartSettings } from '../chartDefaults'
import { isInstanceTombstone } from '../instanceShape'
import { STUDIO_PREVIEW_DEF_ID } from './studio/chartPreview'
import { instancesOf, instanceFingerprint } from './agentSeams'
import { canon, same, changeRecord, holds, revertRecord, setAt, clone } from '../engine/settingsRecord'
// ⭐ Agent Charts family (Volume Profile, 2026-11-12, owner-approved): the carved-out row's own writer + field table (see the end of this file)
import { listAllIndicators, applyRowPatch } from '../indicatorRegistry'
import { CARVED_OUT_ROWS } from '../indicatorCatalog'

export const MUTATION_CONTRACT = 'uct.indicators.mutation/1'
/** ⭐ I-1…I-8 (2026-10-27, ADDITIVE — the first four ops are unchanged): presentation and
 *  placement of ONE instance, the pane stack, and creating copies. */
// ⭐ PACKAGE 3 seam (Agent, 2026-11-04 — docs/indicators/AGENT-CONTRACT-P2-2026-10-27.md §8 (I-14)): `setVisibility` — the
// Inspector's "Show on" (which CHART timeframes the instance draws on), through `setInstanceVisibility`, the writer the
// settings row uses. Presentation only; per instance; exact Undo like every style op.
// ⭐ UCT RS Phase 2a (unit 2a-12): `setDotSize` — the Inspector's / dialog's "Dot size" control, through
// `setInstanceDotSize`. `{instanceId, size: 'small'|'medium'|'large', plotKey?}`; the instance level unless an
// output is named; only for a definition that draws dots. Appended, so the earlier ops keep their positions.
// ⭐ Agent Charts family (calc TF, 2026-11-12, owner-approved): `setCalculationTimeframe` — the Inspector's "Timeframe"
// control (WHICH BARS compute the instance; never the chart's timeframe, never `visibility`), through
// `setInstanceCalculationTimeframe`. `{instanceId, timeframe: CALC_TIMEFRAMES code | null (= Chart), chartTf}`. Appended.
export const STYLE_OPS = Object.freeze(['setAppearance', 'setPlotStyle', 'setColor', 'setDisplayTarget', 'setVisibility', 'setDotSize', 'setCalculationTimeframe'])
export const PANE_OPS = Object.freeze(['movePane', 'setPaneSize'])
export const CREATE_OPS = Object.freeze(['duplicate', 'copyFrom'])
export const MUTATION_OPS = Object.freeze(['add', 'remove', 'setVisible', 'setInputs', ...STYLE_OPS, ...PANE_OPS, ...CREATE_OPS])
const EXT_OPS = new Set([...STYLE_OPS, ...PANE_OPS, ...CREATE_OPS])

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
  BAD_INPUT: 'bad-input',                         // an `add`'s `inputs` names a setting the indicator lacks, or a value it refuses
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

/**
 * ⭐⭐ AGENT PHASE 2.5 — "ADD A 20 EMA": an add WITH SETTINGS, through the canonical
 * writers only. `addInstance` makes the instance (its declared defaults), then EACH
 * requested setting is asked of `checkInstanceInput` (the settings dialog's own
 * validation: declared key, coerced type, the definition's bounds/options) and written by
 * `setInstanceInput` (the dialog's own writer). ⛔ Every requested setting lands or the
 * whole add is refused, naming the first that cannot (`bad-input`, with the input's
 * declared type / range / options) — never a default kept in place of a value asked for,
 * never a partly-configured indicator. One write, so one receipt and one Undo.
 * @returns `{ok:true, cs, ids, inputs}` (`inputs`: the values as stored) | refusal
 */
function addWithInputs(view, defId, inputs, registry) {
  const next0 = addInstance(view, defId, registry)
  if (next0 === view) return refuse(REASONS.UNSUPPORTED_DEFINITION)
  const before = new Set((view.indicatorInstances || []).map((i) => i && i.instanceId))
  const ids = (next0.indicatorInstances || []).filter((i) => i && !before.has(i.instanceId)).map((i) => i.instanceId).sort()
  if (inputs === undefined || inputs === null) return { ok: true, cs: next0, ids, inputs: null }
  if (!isObj(inputs) || ids.length !== 1) return refuse(REASONS.BAD_REQUEST)
  const def = getDefOf(registry)(defId)
  let next = next0
  for (const [key, value] of Object.entries(inputs)) {
    const checked = checkInstanceInput(def, key, value)
    if (!checked.ok) return refuse(REASONS.BAD_INPUT, { key, value, why: checked.why, input: inputSpecOf(checked.spec) })
    next = setInstanceInput(next, ids[0], key, checked.value, registry)
    if ((findInstance(next, ids[0]).inputs || {})[key] !== checked.value) {
      return refuse(REASONS.BAD_INPUT, { key, value, why: 'the settings writer refused it', input: inputSpecOf(checked.spec) })
    }
  }
  const stored = findInstance(next, ids[0]).inputs || {}
  return { ok: true, cs: next, ids, inputs: Object.fromEntries(Object.keys(inputs).map((k) => [k, stored[k]])) }
}

/**
 * ⭐ GATE C — "MAKE IT A 9" / "CHANGE THAT TO AN EMA": edit ONE live instance's inputs in place,
 * through the canonical writers only, routed exactly as the settings rows route them
 * (`indicatorRegistry.applyRowPatch`): a user-added instance (`inst:<defId>:<n>`) through
 * `setInstanceInput`; the fold's `legacy:<defId>` through `setIndicatorInput` (which keeps the
 * `cs.indicators.<defId>` mirror in step). Each value is first asked of `checkInstanceInput` (declared
 * key, coerced type, bounds, `options` for every enum input). ⛔ Every key lands or the whole edit is
 * refused (`bad-input`, naming the first that cannot); a request that changes nothing is `no-change`.
 * Per INSTANCE (never the group); visibility is never touched.
 * @returns `{ok:true, cs, before, after}` (the requested keys, as they were / as stored) | refusal
 */
function setInputsWith(view, instanceId, inputs, registry) {
  const inst = findInstance(view, instanceId)
  if (!inst || isInstanceTombstone(inst)) return refuse(REASONS.NOT_FOUND)
  if (!isObj(inputs) || !Object.keys(inputs).length) return refuse(REASONS.BAD_REQUEST)
  const def = getDefOf(registry)(inst.defId)
  if (!def) return refuse(REASONS.UNKNOWN_DEFINITION)
  const declaredDefault = (key) => ((def.inputs || []).find((i) => i && i.key === key) || {}).default
  const current = (key) => { const v = (inst.inputs || {})[key]; return v === undefined ? declaredDefault(key) : v }
  const checked = []
  for (const [key, value] of Object.entries(inputs)) {
    const c = checkInstanceInput(def, key, value)
    if (!c.ok) return refuse(REASONS.BAD_INPUT, { key, value, why: c.why, input: inputSpecOf(c.spec) })
    checked.push([key, c])
  }
  if (checked.every(([key, c]) => same(current(key), c.value))) return refuse(REASONS.NO_CHANGE)
  const legacy = instanceId === legacyInstanceId(inst.defId)
  let next = view
  for (const [key, c] of checked) {
    next = legacy ? setIndicatorInput(next, inst.defId, key, c.value, registry) : setInstanceInput(next, instanceId, key, c.value, registry)
    if (((findInstance(next, instanceId) || {}).inputs || {})[key] !== c.value) {
      return refuse(REASONS.BAD_INPUT, { key, value: inputs[key], why: 'the settings writer refused it', input: inputSpecOf(c.spec) })
    }
  }
  const stored = findInstance(next, instanceId).inputs || {}
  return { ok: true, cs: next,
    before: Object.fromEntries(checked.map(([k]) => [k, current(k)])),
    after: Object.fromEntries(checked.map(([k]) => [k, stored[k]])) }
}

/** Which definitions an edit may touch — the SAME rule as `add`: built-ins and the member's own saved
 *  definitions; never the studio preview, never an `econp:` companion. */
function checkEditableDefinition(defId, instanceId, ctx) {
  if (typeof defId !== 'string' || !defId) return refuse(REASONS.BAD_REQUEST)
  if (defId.includes(STUDIO_PREVIEW_DEF_ID) || String(instanceId || '').includes(STUDIO_PREVIEW_DEF_ID)) return refuse(REASONS.UNKNOWN_DEFINITION)
  if (defId.startsWith('econp:') || String(instanceId || '').startsWith('econp:')) return refuse(REASONS.UNKNOWN_DEFINITION)
  if (!getDefOf(ctx && ctx.registry)(defId)) return refuse(REASONS.UNKNOWN_DEFINITION)
  if (USER_DEF.test(defId)) {
    const ids = ctx && ctx.ownedDefinitionIds
    const owned = new Set(Array.isArray(ids) ? ids : [...(ids || [])])
    if (!owned.has(defId)) return refuse(REASONS.UNKNOWN_DEFINITION)
  }
  return { ok: true }
}


// ─── canonical JSON, fingerprints ─────────────────────────────────────────────

const fnv = (text) => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}

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

// ─── the change record ─────────────────────────────────────────────────────────
//
// ⭐ A1.0: `changeRecord` / `holds` / `setAt` / the never-partial revert live in
// `engine/settingsRecord.js`, shared with the Indicators undo stack. This file keeps its
// exports and its refusal shape exactly (`settingsRecordParity.test.js`).

/** `{ paths: [{path, before, after}] }` — every leaf `next` differs from `prev` on. */
export { changeRecord }

/** Apply `before` at every recorded path, only if every path still holds `after`. */
function revert(cs, record) {
  const r = revertRecord(cs, record)
  return r.ok ? r : refuse(REASONS.RESTORE_CONFLICT, { path: r.path })
}

// ─── ⭐ WS3 (2026-10-30): EXACT Undo of the stored settings ───────────────────────
//
// Agent Phase 2 measured "add rsi" → "undo" on a default-preset chart leaving three stored
// differences the member could not see: a tombstone in `indicatorInstances`, an
// `indicators.rsi = {enabled:false}` mirror that was not there, and `preset: 'custom'`
// where it was 'classic'. Undo-of-add ran the product's DELETE (`removeInstance`), which
// is right for a member's delete and wrong for an Undo: an Undo puts back what was.
//
// `preset` is a STAMP ("changed since a style preset was applied"), not a value any op
// chose. So it is never a conflict path, and Undo restores it only when the whole chart
// is then exactly what it was before the op (`stateFingerprint`): an unrelated change
// made since keeps the chart 'custom', and a preset applied since is kept.

const LIST = 'indicatorInstances'
const isPresetPath = (p) => Array.isArray(p.path) && p.path.length === 1 && p.path[0] === 'preset'
const withoutPreset = (record) => ({ ...record, paths: record.paths.filter((p) => !isPresetPath(p)) })

/** The whole chart as it reads back after a save. `sf:<fnv1a>`. Pins an op's PRE-state
 *  on its Undo token (`stateFingerprintBefore`) so Undo can tell "exactly as before". */
export function stateFingerprint(cs) {
  const n = normOf(cs)
  return n ? `sf:${fnv(canon(n))}` : null
}

/** `next` (the Undo's result, preset untouched) with the op's preset stamp settled. */
function settlePreset(current, next, record, fpBefore) {
  const e = record.paths.find(isPresetPath)
  if (!e) return next
  if (typeof fpBefore !== 'string') return holds(current, e) ? setAt(next, ['preset'], e.before) : next   // a token minted before WS3
  if (!same(current.preset, e.after)) return next        // a preset applied since is the member's
  const back = setAt(next, ['preset'], e.before)
  return stateFingerprint(back) === fpBefore ? back : next
}

/** The record's revert with the preset stamp settled rather than compared. */
function revertExact(view, undo) {
  const r = revert(view, withoutPreset(undo.record))
  return r.ok ? { ok: true, cs: settlePreset(view, r.cs, undo.record, undo.stateFingerprintBefore) } : r
}

const idsIn = (arr) => (Array.isArray(arr) ? arr.map((e) => (isObj(e) && typeof e.instanceId === 'string' ? e.instanceId : null)) : [])

/**
 * ⭐ THE UNDO OF A CREATE (add, duplicate, copyFrom): the instances the op created are
 * taken OUT — no tombstone, no `enabled:false` mirror, ids free again — and every other
 * leaf it wrote is put back. Nothing changed since ⇒ the list exactly as it was. Something
 * changed since ⇒ only what the op created goes; a pre-existing instance the op itself
 * rewrote gets its old value back only if it still holds what the op left (else refused).
 * `null` when the record is not a create's (the caller keeps the product delete).
 */
function undoCreated(view, undo) {
  const paths = undo.record.paths
  const list = paths.find((p) => !p.order && p.path.length === 1 && p.path[0] === LIST)
  if (!list || paths.some((p) => p.order || (p !== list && p.path[0] === LIST))) return null
  const beforeIds = new Set(idsIn(list.before))
  const created = new Set(idsIn(list.after).filter((id) => id && !beforeIds.has(id)))
  if (!created.size || !(undo.ids || []).every((id) => created.has(id))) return null
  const cur = Array.isArray(view[LIST]) ? view[LIST] : []
  let next
  if (same(cur, list.after)) {
    next = setAt(view, [LIST], list.before)
  } else {
    const beforeById = new Map((list.before || []).filter(isObj).map((e) => [e.instanceId, e]))
    const afterById = new Map((list.after || []).filter(isObj).map((e) => [e.instanceId, e]))
    let out = []
    for (const e of cur) {
      const id = isObj(e) ? e.instanceId : null
      if (created.has(id)) continue
      if (beforeById.has(id) && afterById.has(id) && !same(beforeById.get(id), afterById.get(id))) {
        if (!same(e, afterById.get(id))) return refuse(REASONS.RESTORE_CONFLICT, { path: [LIST, { instanceId: id }] })
        out.push(clone(beforeById.get(id)))
      } else out.push(e)
    }
    // the pre-existing instances' relative order as before, if the op re-sorted them and
    // nothing re-ordered them since; anything added since keeps its place
    const was = idsIn(list.before).filter((id) => id)
    const left = idsIn(list.after).filter((id) => id && !created.has(id))
    const kept = new Set(was)
    const now = idsIn(out).filter((id) => kept.has(id))
    if (!same(was, left) && same(now, left.filter((id) => now.includes(id)))) {
      const byId = new Map(out.map((e) => [e.instanceId, e]))
      const seq = was.filter((id) => byId.has(id))
      let k = 0
      out = out.map((e) => (kept.has(e.instanceId) ? byId.get(seq[k++]) : e))
    }
    next = { ...view, [LIST]: out }
  }
  for (const p of paths) {
    if (p === list || isPresetPath(p)) continue
    if (!holds(view, p)) return refuse(REASONS.RESTORE_CONFLICT, { path: p.path })
    next = setAt(next, p.path, p.before)
  }
  return { ok: true, cs: settlePreset(view, next, undo.record, undo.stateFingerprintBefore) }
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

/** `restoreRemoved` with the preset stamp settled rather than compared (WS3). */
function restoreRemovedExact(view, undo) {
  const r = restoreRemoved(view, withoutPreset(undo.record))
  return r.ok ? { ok: true, cs: settlePreset(normOf(view), r.cs, undo.record, undo.stateFingerprintBefore) } : r
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
export function resolveIndicatorTarget(cs, registry, { instanceId, name, defId, inputs, ordinal } = {}) {
  const rows = instancesOf(cs, registry).filter((r) => !r.setting)
  if (typeof instanceId === 'string' && instanceId) {
    const hit = rows.find((r) => r.instanceId === instanceId)
    return hit ? { ok: true, instanceId: hit.instanceId, name: hit.name } : refuse(REASONS.NOT_FOUND)
  }
  // ⭐ I-10 (2026-10-27): STRUCTURED — `{defId?, inputs?, ordinal?}` (and an optional `name`
  // to narrow). "the 20 EMA" is `{defId:'movingAverage', inputs:{period:20, maType:'ema'}}`.
  if ((typeof defId === 'string' && defId) || isObj(inputs) || Number.isInteger(ordinal)) {
    return resolveStructured(rows, registry, { name, defId, inputs, ordinal })
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

/**
 * I-10 — match on the definition, on the EFFECTIVE input values (stored, else the declared
 * default; each requested value coerced by `checkInstanceInput`, so `'20'` matches `20`),
 * and optionally a legend `name`. `ordinal` (1-based, stored order; `-1` = the last) picks
 * one of several matches; without it, more than one match is `ambiguous` with candidates.
 */
function resolveStructured(rows, registry, { name, defId, inputs, ordinal }) {
  const defOf = getDefOf(registry)
  const want = typeof name === 'string' && name.trim() ? name.trim().toLowerCase() : null
  const hits = rows.filter((r) => {
    if (typeof defId === 'string' && defId && r.defId !== defId) return false
    if (want && r.name.toLowerCase() !== want) return false
    if (isObj(inputs)) {
      const def = defOf(r.defId)
      for (const [key, value] of Object.entries(inputs)) {
        const c = checkInstanceInput(def, key, value)
        if (!c.ok) return false
        const declared = ((def && def.inputs) || []).find((i) => i && i.key === key)
        const stored = (r.inputs || {})[key]
        const current = stored === undefined ? (declared || {}).default : stored
        if (!same(current, c.value)) return false
      }
    }
    return true
  })
  const candidates = () => hits.map((h) => ({ instanceId: h.instanceId, name: h.name, defId: h.defId, inputs: { ...(h.inputs || {}) } }))
  if (Number.isInteger(ordinal) && ordinal !== 0) {
    const pick = ordinal > 0 ? hits[ordinal - 1] : hits[hits.length + ordinal]
    return pick ? { ok: true, instanceId: pick.instanceId, name: pick.name } : refuse(REASONS.NOT_FOUND, { matches: hits.length })
  }
  if (hits.length === 1) return { ok: true, instanceId: hits[0].instanceId, name: hits[0].name }
  if (hits.length > 1) return refuse(REASONS.AMBIGUOUS, { candidates: candidates() })
  return refuse(REASONS.NOT_FOUND)
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
  if (EXT_OPS.has(req.op)) return planExt(view, req, ctx, base)

  if (req.op === 'add') {
    const made = addWithInputs(view, req.defId, req.inputs, registry)
    if (!made.ok) return made
    const def = getDefOf(registry)(req.defId)
    // ⭐ the preview names what WILL be drawn ("EMA 20"), not the definition ("Moving Average")
    const label = made.inputs ? instanceLabel(def, findInstance(made.cs, made.ids[0])) : null
    return { ok: true, plan: { ...base, args: { defId: req.defId, ...(made.inputs ? { inputs: { ...req.inputs } } : {}) },
      target: { ids: [], defId: req.defId },
      pins: { defVersion: defVersionOf(registry, req.defId) },
      preview: { name: label || (def.meta && def.meta.name) || req.defId, severs: [], ...(made.inputs ? { inputs: made.inputs } : {}) } } }
  }

  const t = resolveIndicatorTarget(view, registry, { instanceId: req.instanceId })
  if (!t.ok) return t
  if (req.op === 'setInputs') {
    // per INSTANCE: pins, record and Undo cover this instance only (never its group)
    const inst = findInstance(view, t.instanceId)
    const editable = checkEditableDefinition(inst.defId, t.instanceId, ctx)
    if (!editable.ok) return editable
    const made = setInputsWith(view, t.instanceId, req.inputs, registry)
    if (!made.ok) return made
    const one = [t.instanceId]
    const deps = dependentsOf(view, one, registry)
    // the name is the legend's own, read AFTER the change (maType drives it: "EMA 20" → "SMA 20")
    const nameAfter = instanceLabel(getDefOf(registry)(inst.defId), findInstance(made.cs, t.instanceId)) || t.name
    return { ok: true, plan: { ...base, args: { instanceId: t.instanceId, inputs: { ...req.inputs } },
      target: { ids: one, defId: inst.defId },
      pins: { groupFingerprint: groupFingerprint(view, one), dependents: deps },
      preview: { name: t.name, nameAfter, inputs: { before: made.before, after: made.after }, severs: [], dependents: deps } } }
  }
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
  if (plan.op === 'setInputs') {
    const editable = checkEditableDefinition(plan.target.defId, plan.args.instanceId, ctx)
    if (!editable.ok) return refuse(REASONS.PERMISSION_CHANGED, { was: editable.reason })
  } else if (!same(groupOf(view, plan.args.instanceId), ids)) return refuse(REASONS.CHANGED_WHILE_WORKING, { what: 'group' })
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
  // ⭐ WS3: the whole chart BEFORE this op — the Undo token carries it (`settlePreset`)
  stateBefore: stateFingerprint(view),
})

/**
 * APPLY — re-check permission and pins NOW, then run the canonical writer.
 * @returns `{ok:true, cs, pending}` — `cs` is what to persist (through the chart's one
 *          persist path); `pending` is handed to `confirmIndicatorMutation` with the
 *          read-back. ⛔ Nothing is "done" yet. | refusal (nothing to write).
 */
export function applyIndicatorMutation(cs, plan, ctx) {
  return withRestorePoint(applyInner(cs, plan, ctx), cs, ctx)
}

/**
 * ⭐ WS3 — THE RESTORE POINT. Every applied change carries the exact settings it was made
 * on, so an Undo with NOTHING changed since (`stateFingerprintAfter`) hands them back
 * VERBATIM — byte-identical, key order included — instead of a rebuilt equivalent.
 * `ctx.storedSettings`, when the caller passes it (an own property, `null` allowed), is
 * the chart's STORED pref, and is what comes back: a chart that stored nothing (`null`)
 * stores nothing again. Without it, the `cs` handed to apply comes back.
 */
function withRestorePoint(r, cs, ctx) {
  if (!r || !r.ok || !isObj(r.pending)) return r
  const c = ctx || {}
  const hasStored = Object.prototype.hasOwnProperty.call(c, 'storedSettings')
  const raw = hasStored ? c.storedSettings : cs
  const point = raw === null || raw === undefined ? null : (isObj(raw) ? clone(raw) : undefined)
  if (point === undefined) return r
  return { ...r, pending: { ...r.pending, restorePoint: { cs: point } } }
}

function applyInner(cs, plan, ctx) {
  const view = viewOf(cs)
  if (!view || !isObj(plan) || plan.contract !== MUTATION_CONTRACT || !MUTATION_OPS.includes(plan.op)) return refuse(REASONS.BAD_REQUEST)
  const c = ctx || {}
  if (EXT_OPS.has(plan.op)) return applyExt(view, plan, c)
  const ok = revalidate(view, plan, c)
  if (!ok.ok) return ok
  const registry = c.registry

  if (plan.op === 'add') {
    const made = addWithInputs(view, plan.args.defId, plan.args.inputs, registry)
    if (!made.ok) return made.reason === REASONS.UNSUPPORTED_DEFINITION ? refuse(REASONS.WRITER_REFUSED) : made
    const next = made.cs
    const ids = made.ids
    // the record holds every leaf the add wrote — the instance AND each `inputs.<key>` — so
    // the read-back proves the values landed, and Undo (remove the instance) is exact
    const record = recordOf(ids, view, next)
    return { ok: true, cs: next, pending: pendingFor('add', plan, view, next, record, registry,
      { name: nameOf(next, registry, ids[0]), ...(made.inputs ? { inputs: made.inputs } : {}) }) }
  }
  if (plan.op === 'remove') {
    const r = removeInstanceWithRecord(view, plan.args.instanceId, registry)
    if (!r.ok) return r
    return { ok: true, cs: r.cs, pending: pendingFor('remove', plan, view, r.cs, r.record, registry, { name: plan.preview.name, severed: plan.preview.severs }) }
  }
  if (plan.op === 'setInputs') {
    const made = setInputsWith(view, plan.args.instanceId, plan.args.inputs, registry)
    if (!made.ok) return made
    const record = recordOf(plan.target.ids, view, made.cs)
    return { ok: true, cs: made.cs, pending: pendingFor('setInputs', plan, view, made.cs, record, registry,
      { name: plan.preview.nameAfter || plan.preview.name, inputs: { before: made.before, after: made.after } }) }
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
    ...(pending.op === 'add' && pending.inputs && !pending.undoOf ? { inputs: { ...pending.inputs } } : {}),
    ...(pending.op === 'setInputs' && pending.inputs ? { inputs: { before: { ...pending.inputs.before }, after: { ...pending.inputs.after } } } : {}),
    ...(pending.op === 'remove' && !pending.undoOf ? { severed: (pending.severed || []).map((d) => ({ ...d })) } : {}),
    ...(pending.restored ? { restored: pending.restored.map((d) => ({ ...d })) } : {}),
    // ⭐ I-1…I-8 (additive): what changed, the pane it was, what a copy made
    ...(pending.change ? { change: JSON.parse(JSON.stringify(pending.change)) } : {}),
    ...(pending.paneKey ? { paneKey: pending.paneKey } : {}),
    ...(pending.copied && !pending.undoOf ? { copied: pending.copied.map((d) => ({ ...d })), already: (pending.already || []).map((d) => ({ ...d })) } : {}),
    chartId: (ctx && ctx.chartId) ?? null,
  })
  // ⭐ WS3: an Undo that put back "stored nothing" lands as a read-back of nothing
  if (pending.expectAbsent) {
    if (persisted !== null && persisted !== undefined) return { status: REASONS.NOT_LANDED, reason: REASONS.NOT_LANDED, receipt: receipt(REASONS.NOT_LANDED), mismatch: { path: [] } }
    return { status: 'confirmed', receipt: { ...receipt('confirmed'), instanceFingerprintAfter: null }, undo: null }
  }
  const view = normOf(persisted)
  if (!view) return { status: REASONS.UNCONFIRMED, reason: REASONS.UNCONFIRMED, receipt: receipt(REASONS.UNCONFIRMED) }
  const mismatch = pending.record.paths.find((e) => !holds(view, e))
  if (mismatch) return { status: REASONS.NOT_LANDED, reason: REASONS.NOT_LANDED, receipt: receipt(REASONS.NOT_LANDED), mismatch: { path: mismatch.path } }
  // ⭐ I-12: the receipt pins the POST-change state, read from the persisted copy
  const done = { ...receipt('confirmed'), instanceFingerprintAfter: instanceFingerprint(view) }
  if (pending.undoOf) return { status: 'confirmed', receipt: done, undo: null }
  return {
    status: 'confirmed', receipt: done,
    undo: { contract: MUTATION_CONTRACT, kind: 'undo', op: pending.op, ids: pending.ids.slice(), defId: pending.defId,
      name: pending.name, chartId: done.chartId, record: pending.record, severed: (pending.severed || []).map((d) => ({ ...d })),
      groupFingerprintAfter: groupFingerprint(view, pending.ids),
      ...(typeof pending.stateBefore === 'string' ? { stateFingerprintBefore: pending.stateBefore } : {}),
      ...(isObj(pending.restorePoint) ? { restorePoint: pending.restorePoint, stateFingerprintAfter: stateFingerprint(view) } : {}),
      ...(PANE_OPS.includes(pending.op) ? { paneKey: pending.paneKey, paneFingerprintAfter: paneFingerprint(view, ctx && ctx.registry, ctx && ctx.volumeOpts) } : {}) },
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
  const r = undoInner(cs, undo, ctx)
  // ⭐ WS3: every guard above ran and passed. If the chart is EXACTLY as the change left it,
  // the settings it was made on come back verbatim (or "stored nothing").
  if (!r.ok || !isObj(undo.restorePoint) || typeof undo.stateFingerprintAfter !== 'string') return r
  if (stateFingerprint(cs) !== undo.stateFingerprintAfter) return r
  const back = undo.restorePoint.cs
  if (back === null) return { ok: true, cs: null, pending: { ...r.pending, record: { ...r.pending.record, paths: [] }, expectAbsent: true } }
  if (!isObj(back) || !normOf(back)) return r
  return { ok: true, cs: clone(back), pending: { ...r.pending, record: recordOf(r.pending.ids, cs, back), instanceFingerprintAfter: instanceFingerprint(back) } }
}

function undoInner(cs, undo, ctx) {
  const view = normOf(cs)
  const c = ctx || {}
  if (!view || !isObj(undo) || undo.contract !== MUTATION_CONTRACT || undo.kind !== 'undo' || !isObj(undo.record)) return refuse(REASONS.BAD_REQUEST)
  if (c.chartId !== undefined && undo.chartId !== null && c.chartId !== undo.chartId) return refuse(REASONS.BAD_REQUEST)
  if (c.canManage !== true) return refuse(REASONS.PERMISSION_CHANGED, { was: REASONS.READONLY })
  const plan = { target: { defId: undo.defId } }
  if (EXT_OPS.has(undo.op)) return undoExt(view, undo, c, plan)

  if (undo.op === 'setInputs') {
    // exact or refused: the instance must still be exactly as the edit left it
    if (groupFingerprint(view, undo.ids) !== undo.groupFingerprintAfter) return refuse(REASONS.RESTORE_CONFLICT, { path: ['indicatorInstances'] })
    const r = revertExact(view, undo)
    if (!r.ok) return r
    const record = recordOf(undo.ids, view, r.cs)
    return { ok: true, cs: r.cs, pending: pendingFor('setInputs', plan, view, r.cs, record, c.registry, { name: undo.name, undoOf: 'setInputs' }) }
  }
  if (undo.op === 'remove' || undo.op === 'setVisible') {
    if (undo.op === 'setVisible' && groupFingerprint(view, undo.ids) !== undo.groupFingerprintAfter) {
      return refuse(REASONS.RESTORE_CONFLICT, { path: ['indicatorInstances'] })
    }
    const r = undo.op === 'remove' ? restoreRemovedExact(view, undo) : revertExact(view, undo)
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
    // ⭐ WS3: the add taken back out exactly; the product delete only for a record that is
    // not a create's (never minted by this file, kept so an odd token is still undone)
    const exact = undoCreated(view, undo)
    if (exact && !exact.ok) return exact
    const r = exact || removeInstanceWithRecord(view, id, c.registry)
    if (!r.ok) return r
    const record = exact ? recordOf(undo.ids, view, r.cs) : r.record
    return { ok: true, cs: r.cs, pending: pendingFor('remove', plan, view, r.cs, record, c.registry, { name: undo.name, undoOf: 'add' }) }
  }
  return refuse(REASONS.BAD_REQUEST)
}

// ─── ⭐ I-1…I-8 — PRESENTATION, PLACEMENT, PANES, DUPLICATE, COPY (2026-10-27) ───────
//
// The same plan → apply → confirm → undo shape, token, REASONS and permission answer as
// the four ops above. ⛔ NO SECOND WRITER — each wraps the writer the product UI uses:
//   setAppearance    → setInstanceAppearance     (Inspector: Line width / Line style / Overlap)
//   setPlotStyle     → setInstancePlotStyle      (Inspector: Plot style; offers = `styleChoicesFor`)
//   setColor         → `setInputsWith` (the settings rows' colour lane: setInstanceInput /
//                      setIndicatorInput) or setInstanceCandleColor (the Up/Down swatches)
//   setDisplayTarget → setInstanceDisplayTarget  (Inspector: Display in; offers = `displayTargetOptions`)
//   setDotSize       → setInstanceDotSize        (Inspector / dialog: Dot size; offers = `DOT_SIZES` words, 2a-12)
//   movePane         → movePane / movePaneTo     (Chart Data Arrange: arrows / drag)
//   setPaneSize      → setPaneSize / clearPaneSize (the pane divider / its reset)
//   duplicate        → duplicateInstance         (legend popover / Inspector Duplicate)
//   copyFrom         → captureIndicatorTemplate + applyIndicatorTemplate (Indicator templates)
// Edits are per INSTANCE (never its group); Undo is the exact revert of the recorded leaves,
// refused when anything moved since. A copy's Undo removes what it created (refused while
// something else reads it), as `add`'s does.

const APPEARANCE_SPEC = Object.freeze({
  lineWidth: { dflt: DEFAULT_LINE_WIDTH_CHOICE, options: LINE_WIDTH_CHOICES, valid: (v) => LINE_WIDTH_CHOICES.includes(Number(v)) && v !== '' && v !== null, coerce: (v) => Number(v) },
  lineStyle: { dflt: DEFAULT_LINE_STYLE_CHOICE, options: LINE_STYLE_CHOICES, valid: (v) => LINE_STYLE_CHOICES.includes(v), coerce: (v) => v },
  overlap: { dflt: false, options: [true, false], valid: (v) => typeof v === 'boolean', coerce: (v) => v },
})
// the member's words for a key: a refusal is read by a person, and these keys are the store's
const APPEARANCE_WORDS = Object.freeze({ lineWidth: 'line width', lineStyle: 'line style', overlap: 'overlap', offset: 'offset' })
const appearanceWord = (key) => APPEARANCE_WORDS[key] || 'style'
const nameOfDef = (def) => (def && def.meta && def.meta.name) || (def && def.id) || 'This indicator'
/** A write that changed nothing but `preset` changed nothing the member can see. */
const noChange = (view, next) => next === view
  || !changeRecord(normOf(view), normOf(next)).paths.some((p) => !(p.path.length === 1 && p.path[0] === 'preset'))
const plain = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v))

/**
 * A fingerprint of the PANE STACK: the resolved order, the stored order and the stored
 * sizes. `pf:<n>:<fnv1a>`. Pins `movePane` / `setPaneSize` plans and their Undo.
 */
export function paneFingerprint(cs, registry, volumeOpts = null) {
  const view = viewOf(cs)
  if (!view) return 'pf:0:00000000'
  const { paneKeys, opts } = paneArrangeArgs(view, registry, volumeOpts)
  const order = resolvePaneOrder(view, paneKeys, opts)
  return `pf:${order.length}:${fnv(canon([order, storedPaneOrder(view), storedPaneSizes(view)]))}`
}

/** The live, editable instance a style/create op names. */
function editableInstance(view, req, ctx) {
  const t = resolveIndicatorTarget(view, ctx.registry, { instanceId: req.instanceId })
  if (!t.ok) return t
  const inst = findInstance(view, t.instanceId)
  const editable = checkEditableDefinition(inst.defId, t.instanceId, ctx)
  if (!editable.ok) return editable
  return { ok: true, t, inst, def: getDefOf(ctx.registry)(inst.defId) }
}

/** The colour targets one instance offers (what the settings row shows). */
function colorTargetsOf(view, inst, def) {
  const out = []
  for (const i of (def && def.inputs) || []) {
    if (i && i.type === 'color') out.push({ target: `input:${i.key}`, label: i.label || i.key, current: ((inst.inputs || {})[i.key] ?? i.default) ?? null })
  }
  const candles = (view && view.candles) || null
  for (const plot of (Array.isArray(def && def.plots) ? def.plots : [])) {
    const style = resolvePlotStyle(inst, plot, {})
    if (!(style === 'histogram' || (!style && plot.style === 'histogram'))) continue
    const sign = resolveSignColors(inst, plot, candles)
    if (!sign) continue
    out.push({ target: 'sign:up', plotKey: plot.key, label: `Up color · ${plot.label || plot.key}`, current: sign.up ?? null })
    out.push({ target: 'sign:down', plotKey: plot.key, label: `Down color · ${plot.label || plot.key}`, current: sign.down ?? null })
  }
  return out
}

/**
 * ⭐ WHAT ONE INSTANCE MAY BE CHANGED TO — the choices the Inspector offers, as data. The
 * Agent reads this to phrase a proposal ("thicker" → the next `lineWidth`) and to refuse
 * an impossible one before asking; every value it lists is one the op accepts.
 * @returns `{ok:true, instanceId, defId, name, appearance, plotStyles, colors, displayTargets}` | refusal
 */
export function styleOptionsOf(cs, registry, instanceId) {
  const view = viewOf(cs)
  if (!view) return refuse(REASONS.BAD_REQUEST)
  const t = resolveIndicatorTarget(view, registry, { instanceId })
  if (!t.ok) return t
  const inst = findInstance(view, t.instanceId)
  const def = getDefOf(registry)(inst.defId)
  if (!def) return refuse(REASONS.UNKNOWN_DEFINITION)
  const pres = isObj(inst.presentation) ? inst.presentation : {}
  const declared = (def.meta && Array.isArray(def.meta.appearance) ? def.meta.appearance : []).filter((k) => APPEARANCE_SPEC[k])
  let targets = []
  try { targets = displayTargetOptions(inst, view, getDefOf(registry)).filter((o) => !o.missing).map((o) => ({ value: o.value, label: o.label })) } catch { targets = [] }
  return {
    ok: true, instanceId: t.instanceId, defId: inst.defId, name: t.name,
    appearance: declared.map((key) => ({ key, current: pres[key] === undefined ? APPEARANCE_SPEC[key].dflt : pres[key], options: [...APPEARANCE_SPEC[key].options] })),
    plotStyles: styleChoicesFor(def, inst, view).map((c) => ({ plotKey: c.key, label: c.label, current: c.current, options: [...c.choices] })),
    colors: colorTargetsOf(view, inst, def),
    displayTarget: { current: resolveDisplayTarget(inst, view), options: targets.length ? [{ value: 'auto', label: 'Automatic' }, ...targets] : [] },
    // ⭐ 2a-12: `null` for a definition that draws no dots; else the instance-level word and the outputs it covers
    dotSize: dotPlotsOf(def).length
      ? { current: instanceDotSizeReading(inst, def), options: Object.keys(DOT_SIZES),
          plots: dotPlotsOf(def).map((p) => ({ plotKey: p.key, label: p.label || p.key, current: storedDotSize(inst, p) || DEFAULT_DOT_SIZE })) }
      : null,
  }
}

/** Run one STYLE op's writer. `{ok:true, cs, change}` | refusal (nothing written). */
function writeStyle(view, req, inst, def, registry) {
  const id = inst.instanceId
  const pres = isObj(inst.presentation) ? inst.presentation : {}
  if (req.op === 'setAppearance') {
    const declared = (def.meta && Array.isArray(def.meta.appearance) ? def.meta.appearance : []).filter((k) => APPEARANCE_SPEC[k])
    if (!declared.includes(req.key)) return refuse(REASONS.BAD_INPUT, { key: req.key ?? null, why: `${nameOfDef(def)} has no ${appearanceWord(req.key)} setting`, options: declared.map(appearanceWord) })
    const spec = APPEARANCE_SPEC[req.key]
    if (!spec.valid(req.value)) return refuse(REASONS.BAD_INPUT, { key: req.key, value: req.value ?? null, why: `that isn't a ${appearanceWord(req.key)} it offers`, options: [...spec.options] })
    const value = spec.coerce(req.value)
    const before = pres[req.key] === undefined ? spec.dflt : pres[req.key]
    if (same(before, value)) return refuse(REASONS.NO_CHANGE)
    const next = setInstanceAppearance(view, id, req.key, value, registry)
    if (noChange(view, next)) return refuse(REASONS.WRITER_REFUSED)
    return { ok: true, cs: next, change: { what: 'appearance', key: req.key, before, after: value } }
  }
  if (req.op === 'setPlotStyle') {
    const choices = styleChoicesFor(def, inst, view)
    if (!choices.length) return refuse(REASONS.BAD_INPUT, { why: `${nameOfDef(def)} has no plot style control`, options: [] })
    const entry = typeof req.plotKey === 'string' && req.plotKey ? choices.find((c) => c.key === req.plotKey) : (choices.length === 1 ? choices[0] : null)
    if (!entry) return refuse(REASONS.BAD_REQUEST, { why: 'name the output to restyle', plots: choices.map((c) => ({ plotKey: c.key, label: c.label })) })
    if (!entry.choices.includes(req.style)) return refuse(REASONS.BAD_INPUT, { plotKey: entry.key, value: req.style ?? null, why: `"${entry.label}" can be drawn as ${entry.choices.join(', ')}`, options: [...entry.choices] })
    if (entry.current === req.style) return refuse(REASONS.NO_CHANGE)
    const next = setInstancePlotStyle(view, id, req.style, registry, entry.plotKey || undefined)
    if (noChange(view, next)) return refuse(REASONS.WRITER_REFUSED)
    return { ok: true, cs: next, change: { what: 'plotStyle', plotKey: entry.key, before: entry.current, after: req.style } }
  }
  if (req.op === 'setColor') {
    const color = req.color !== undefined ? req.color : req.hex
    const offered = colorTargetsOf(view, inst, def)
    const options = offered.map((o) => ({ target: o.target, ...(o.plotKey && o.target.startsWith('sign:') ? { plotKey: o.plotKey } : {}), label: o.label }))
    if (!isValidColorValue(color)) return refuse(REASONS.BAD_INPUT, { value: color ?? null, why: 'a colour is a hex value such as #22c55e, or a theme colour such as token:bull', options })
    const target = typeof req.target === 'string' ? req.target : ''
    if (target.startsWith('input:')) {
      const key = target.slice('input:'.length)
      if (!offered.some((o) => o.target === target)) return refuse(REASONS.BAD_INPUT, { target, why: `${nameOfDef(def)} has no such colour setting`, options })
      const made = setInputsWith(view, id, { [key]: color }, registry)
      if (!made.ok) return made
      return { ok: true, cs: made.cs, change: { what: 'color', target, before: made.before[key] ?? null, after: made.after[key] } }
    }
    if (target === 'sign:up' || target === 'sign:down') {
      const signs = offered.filter((o) => o.target === target)
      const pick = typeof req.plotKey === 'string' && req.plotKey ? signs.find((o) => o.plotKey === req.plotKey) : signs[0]
      if (!pick) return refuse(REASONS.BAD_INPUT, { target, why: `${nameOfDef(def)} has no up/down colours${req.plotKey ? ` on "${req.plotKey}"` : ''}`, options })
      const which = target === 'sign:up' ? 'upColor' : 'downColor'
      // ⭐ the swatch's own call: instance level unless an output is named; the chart's
      // own candle colour is the default, so choosing it DELETES the key (follows the theme)
      const fallback = (view.candles && view.candles[which]) || null
      const next = setInstanceCandleColor(view, id, which, color, registry, typeof req.plotKey === 'string' && req.plotKey ? req.plotKey : undefined, fallback)
      if (noChange(view, next)) return refuse(REASONS.NO_CHANGE)
      return { ok: true, cs: next, change: { what: 'color', target, ...(req.plotKey ? { plotKey: req.plotKey } : {}), before: pick.current, after: color } }
    }
    return refuse(REASONS.BAD_INPUT, { target: target || null, why: 'name a colour target', options })
  }
  if (req.op === 'setVisibility') {
    // `visibility`: null / 'all' = every timeframe (the absent key); else the stored policy shape
    // ({preset:'intraday'} | {preset:'dailyUp'} | {preset:'custom', tfs:[chart timeframe codes]})
    const all = req.visibility === null || req.visibility === 'all'
    const want = all ? null : normalizeVisibility(req.visibility)
    if (!all && !want) {
      return refuse(REASONS.BAD_INPUT, { value: req.visibility ?? null, why: 'show it on all timeframes, intraday only, daily & above, or a list of chart timeframes',
        options: VISIBILITY_PRESETS.map((p) => ({ value: p.value, label: p.label })) })
    }
    const before = normalizeVisibility(inst.visibility)
    if (same(before, want)) return refuse(REASONS.NO_CHANGE)
    const next = setInstanceVisibility(view, id, want, registry)
    if (noChange(view, next)) return refuse(REASONS.WRITER_REFUSED)
    return { ok: true, cs: next, change: { what: 'visibility', before: visibilitySummary(before), after: visibilitySummary(want) } }
  }
  if (req.op === 'setCalculationTimeframe') return writeCalcTimeframe(view, req, inst, def, registry)
  if (req.op === 'setDotSize') {
    // `size`: one of the three words the store takes; `plotKey` (optional) names ONE dot output,
    // absent = the instance level, as the Dot size control writes it
    const dots = dotPlotsOf(def)
    const words = Object.keys(DOT_SIZES)
    if (!dots.length) return refuse(REASONS.BAD_INPUT, { why: `${nameOfDef(def)} draws no dots to size`, options: [] })
    if (!words.includes(req.size)) return refuse(REASONS.BAD_INPUT, { value: req.size ?? null, why: `a dot size is ${words.join(', ')}`, options: words })
    const plot = typeof req.plotKey === 'string' && req.plotKey ? dots.find((p) => p.key === req.plotKey) : null
    if (req.plotKey !== undefined && req.plotKey !== null && !plot) {
      return refuse(REASONS.BAD_INPUT, { plotKey: req.plotKey, why: `${nameOfDef(def)} draws no dots on "${req.plotKey}"`, options: dots.map((p) => ({ plotKey: p.key, label: p.label || p.key })) })
    }
    // ⭐ U8 #11 (2026-11-07): with no plotKey, `before` is what the Dot size control reads,
    // 'mixed' while a per-dot size disagrees, so "default dots" after Stress is a real change
    // (the setter deletes the per-dot sizes) rather than a no-change refusal.
    const before = plot ? (storedDotSize(inst, { key: plot.key }) || DEFAULT_DOT_SIZE) : instanceDotSizeReading(inst, def)
    if (before === req.size) return refuse(REASONS.NO_CHANGE)
    const next = setInstanceDotSize(view, id, req.size, registry, plot ? plot.key : undefined)
    if (noChange(view, next)) return refuse(REASONS.WRITER_REFUSED)
    return { ok: true, cs: next, change: { what: 'dotSize', ...(plot ? { plotKey: plot.key } : {}), before, after: req.size } }
  }
  // setDisplayTarget
  let options = []
  try { options = displayTargetOptions(inst, view, getDefOf(registry)).filter((o) => !o.missing) } catch { options = [] }
  if (!options.length) return refuse(REASONS.BAD_INPUT, { why: `${nameOfDef(def)} can only draw where it is`, options: [] })
  const target = req.target === 'auto' ? automaticTargetOf(view, inst) : req.target
  if (req.target !== 'auto' && !options.some((o) => o.value === target)) {
    return refuse(REASONS.BAD_INPUT, { value: req.target ?? null, why: 'not a place this indicator can draw', options: [{ value: 'auto', label: 'Automatic' }, ...options.map((o) => ({ value: o.value, label: o.label }))] })
  }
  const before = resolveDisplayTarget(inst, view)
  const next = setInstanceDisplayTarget(view, id, target, registry)
  if (noChange(view, next)) return refuse(REASONS.NO_CHANGE)
  const after = resolveDisplayTarget(findInstance(next, id), next)
  // the series drawing INSIDE this one's pane (they travel with their host — or lose it)
  const guests = instancesOf(view, registry).filter((r) => !r.setting && r.instanceId !== id && (() => {
    try { return paneOwnerOf(findInstance(view, r.instanceId), view) === id } catch { return false }
  })()).map((r) => ({ instanceId: r.instanceId, name: r.name }))
  return { ok: true, cs: next, change: { what: 'displayTarget', before, after, ...(req.target === 'auto' ? { automatic: true } : {}), guests } }
}

/**
 * ⭐ CALCULATION TIMEFRAME (Agent Charts family, 2026-11-12) — the Inspector's "Timeframe" select, through ITS writer.
 * `timeframe`: a `CALC_TIMEFRAMES` code, or null / 'chart' = CHART (the absent key). `chartTf`: the chart's timeframe now.
 *
 * ⛔ THE WRITER REFUSES SILENTLY (`cs` back unchanged) for a definition `calcTimeframeCapability` says no to and for an
 * instance that inherits its source's frame. So the capability is asked FIRST and its own reason returned
 * (`detail.capability` + `CAPABILITY_WORDS`), and a writer that still changed nothing is `writer-refused` — never success.
 * ⛔ LOWER / STRADDLING frames are refused with the product's own words (`gatedReason`): the authoring door refuses them
 * (`applyPatch` `calc-tf:lower`); the settings select stores one but the chart then computes on its own bars and shows
 * the same note — so storing it would read as a change that draws nothing different.
 * ⛔ ONE LEAF: the write may change only `indicatorInstances[id].calculationTimeframe` (never the chart's timeframe,
 * never `visibility`); anything else is refused as `writer-refused`.
 */
const CALC_OPTIONS = () => [{ value: null, label: 'Chart' }, ...CALC_TIMEFRAMES.map((c) => ({ value: c, label: calcTimeframeLabel(c) }))]
const stripDot = (s) => String(s || '').replace(/\.$/, '')
function writeCalcTimeframe(view, req, inst, def, registry) {
  const id = inst.instanceId
  const raw = req.timeframe
  const want = raw === null || raw === undefined || raw === 'chart' ? null : raw
  if (want !== null && !(typeof want === 'string' && CALC_TIMEFRAMES.includes(want))) {
    return refuse(REASONS.BAD_INPUT, { value: raw ?? null, why: 'a calculation timeframe is one the chart can fetch bars at, or the chart\'s own', options: CALC_OPTIONS() })
  }
  const before = calcTimeframeOf(inst)
  if (before === want) return refuse(REASONS.NO_CHANGE)
  if (want !== null) {
    const cap = calcTimeframeCapability(def, inst)
    if (!cap.ok) return refuse(REASONS.BAD_INPUT, { capability: cap.reason, why: stripDot(CAPABILITY_WORDS[cap.reason] || CAPABILITY_WORDS.unknown), options: [] })
    if (cap.inherits) {
      return refuse(REASONS.BAD_INPUT, { capability: 'inherits', from: nameOf(view, registry, cap.inherits) || null,
        why: `it is calculated on the same timeframe as its source${nameOf(view, registry, cap.inherits) ? ` (${nameOf(view, registry, cap.inherits)})` : ''} — change that one instead`, options: [] })
    }
    const chartTf = typeof req.chartTf === 'string' && req.chartTf ? req.chartTf : null
    const relation = chartTf ? frameRelation(want, chartTf) : 'higher'
    if (relation === 'lower' || relation === 'straddle') {
      return refuse(REASONS.BAD_INPUT, { relation, chartTf, why: stripDot(gatedReason(relation, want, chartTf)), options: [] })
    }
  }
  const next = setInstanceCalculationTimeframe(view, id, want, registry)
  if (noChange(view, next)) return refuse(REASONS.WRITER_REFUSED)
  const leaf = (p) => p.path.length === 3 && p.path[0] === LIST && isObj(p.path[1]) && p.path[1].instanceId === id && p.path[2] === 'calculationTimeframe'
  const paths = changeRecord(normOf(view), normOf(next)).paths.filter((p) => !(p.path.length === 1 && p.path[0] === 'preset'))
  if (!paths.length || !paths.every(leaf) || calcTimeframeOf(findInstance(next, id)) !== want) return refuse(REASONS.WRITER_REFUSED)
  return { ok: true, cs: next, change: { what: 'calcTimeframe', before, after: want, chartTf: typeof req.chartTf === 'string' ? req.chartTf : null } }
}

/** Run one PANE op's writer. `{ok:true, cs, change, paneKey, ids}` | refusal. */
function writePane(view, req, registry, volumeOpts) {
  const { panes, paneKeys, opts } = paneArrangeArgs(view, registry, volumeOpts)
  const pane = panes.find((p) => p.paneKey === req.paneKey)
  if (!pane) return refuse(REASONS.NOT_FOUND, { panes: panes.map((p) => ({ paneKey: p.paneKey, label: p.label })) })
  const ids = [...pane.ownerInstanceIds].sort()
  if (req.op === 'movePane') {
    const before = resolvePaneOrder(view, paneKeys, opts)
    let next
    if (req.delta === 1 || req.delta === -1) next = movePaneWriter(view, paneKeys, pane.paneKey, req.delta, opts)
    else if (Object.prototype.hasOwnProperty.call(req, 'beforeKey') && (req.beforeKey === null || panes.some((p) => p.paneKey === req.beforeKey))) {
      next = movePaneTo(view, paneKeys, pane.paneKey, req.beforeKey, opts)
    } else return refuse(REASONS.BAD_REQUEST, { why: 'say where: delta ±1, or beforeKey (a pane key, or null for the bottom)', panes: panes.map((p) => ({ paneKey: p.paneKey, label: p.label })) })
    if (noChange(view, next)) return refuse(REASONS.NO_CHANGE)
    return { ok: true, cs: next, paneKey: pane.paneKey, ids, change: { what: 'paneOrder', paneKey: pane.paneKey, label: pane.label, before, after: resolvePaneOrder(next, paneKeys, opts) } }
  }
  // setPaneSize — `share: null` is "back to automatic"
  const before = pane.share
  let next
  if (req.share === null) next = clearPaneSize(view, pane.paneKey)
  else if (Number.isFinite(req.share) && req.share >= 0.04 && req.share <= 0.9) next = setPaneSizeWriter(view, pane.paneKey, req.share)
  else return refuse(REASONS.BAD_INPUT, { value: req.share ?? null, why: 'a pane share is between 0.04 and 0.9 of the chart height, or null for automatic', min: 0.04, max: 0.9 })
  if (noChange(view, next)) return refuse(REASONS.NO_CHANGE)
  const after = storedPaneSizes(next)[pane.paneKey] ?? null
  return { ok: true, cs: next, paneKey: pane.paneKey, ids, change: { what: 'paneSize', paneKey: pane.paneKey, label: pane.label, before, after } }
}

/** Run one CREATE op. `{ok:true, cs, ids, copied?, already?, template?}` | refusal. */
function writeCreate(view, req, registry, template) {
  if (req.op === 'duplicate') {
    const before = new Set((view.indicatorInstances || []).map((i) => i && i.instanceId))
    const next = duplicateInstance(view, req.instanceId, registry)
    if (next === view) return refuse(REASONS.WRITER_REFUSED)
    const ids = (next.indicatorInstances || []).filter((i) => i && !before.has(i.instanceId)).map((i) => i.instanceId).sort()
    if (ids.length !== 1) return refuse(REASONS.WRITER_REFUSED)
    return { ok: true, cs: next, ids }
  }
  const r = applyIndicatorTemplate(view, template, registry)
  if (!r.ok) return refuse(REASONS.BAD_REQUEST, { why: r.detail || r.reason })
  if (r.unavailable.length) return refuse(REASONS.UNKNOWN_DEFINITION, { unavailable: r.unavailable.map((u) => ({ defId: u.defId, name: u.label })) })
  if (!r.added.length) return refuse(REASONS.NO_CHANGE, { already: r.already.map((a) => ({ instanceId: a.instanceId, name: a.label })) })
  return {
    ok: true, cs: r.cs, ids: r.added.map((a) => a.instanceId).sort(),
    copied: r.added.map((a) => ({ instanceId: a.instanceId, name: a.label })),
    already: r.already.map((a) => ({ instanceId: a.instanceId, name: a.label })),
  }
}

/** I-8: the copy body, captured from the SOURCE chart at plan time (the template layer's rule). */
function captureCopy(req, ctx) {
  const ids = Array.isArray(req.instanceIds) ? [...new Set(req.instanceIds.filter((x) => typeof x === 'string' && x))] : []
  const src = viewOf(req.sourceCs)
  if (!src || !ids.length) return refuse(REASONS.BAD_REQUEST, { why: 'copyFrom needs sourceCs and instanceIds' })
  for (const id of ids) {
    const t = resolveIndicatorTarget(src, ctx.registry, { instanceId: id })
    if (!t.ok) return refuse(REASONS.NOT_FOUND, { instanceId: id, where: 'source' })
    const inst = findInstance(src, id)
    const editable = checkEditableDefinition(inst.defId, id, ctx)
    if (!editable.ok) return { ...editable, detail: { instanceId: id, defId: inst.defId } }
  }
  const cap = captureIndicatorTemplate(src, ctx.registry, { name: 'Agent copy', id: 'agent-copy', now: 0, onlyIds: ids })
  if (!cap.ok) return refuse(REASONS.BAD_REQUEST, { why: cap.reason })
  if (cap.template.instances.length !== ids.length) return refuse(REASONS.BAD_REQUEST, { why: 'too many indicators to copy at once', max: cap.template.instances.length })
  return { ok: true, template: plain(cap.template) }
}

function planExt(view, req, ctx, base) {
  const registry = ctx.registry
  if (STYLE_OPS.includes(req.op)) {
    const e = editableInstance(view, req, ctx)
    if (!e.ok) return e
    const made = writeStyle(view, req, e.inst, e.def, registry)
    if (!made.ok) return made
    const one = [e.t.instanceId]
    const args = { ...plain(req) }
    return { ok: true, plan: { ...base, args, target: { ids: one, defId: e.inst.defId },
      pins: { groupFingerprint: groupFingerprint(view, one) },
      preview: { name: e.t.name, nameAfter: nameOf(made.cs, registry, e.t.instanceId) || e.t.name, change: made.change, severs: [] } } }
  }
  if (PANE_OPS.includes(req.op)) {
    const made = writePane(view, req, registry, ctx.volumeOpts)
    if (!made.ok) return made
    return { ok: true, plan: { ...base, args: plain(req), target: { ids: made.ids, defId: null, paneKey: made.paneKey },
      pins: { paneFingerprint: paneFingerprint(view, registry, ctx.volumeOpts) },
      preview: { name: made.change.label, change: made.change, severs: [] } } }
  }
  if (req.op === 'duplicate') {
    const e = editableInstance(view, req, ctx)
    if (!e.ok) return e
    const made = writeCreate(view, { op: 'duplicate', instanceId: e.t.instanceId }, registry)
    if (!made.ok) return made
    return { ok: true, plan: { ...base, args: { instanceId: e.t.instanceId }, target: { ids: [], defId: e.inst.defId, sourceId: e.t.instanceId },
      pins: { defVersion: defVersionOf(registry, e.inst.defId), groupFingerprint: groupFingerprint(view, [e.t.instanceId]) },
      preview: { name: nameOf(made.cs, registry, made.ids[0]) || e.t.name, from: e.t.name, severs: [] } } }
  }
  // copyFrom
  const cap = captureCopy(req, ctx)
  if (!cap.ok) return cap
  const made = writeCreate(view, req, registry, cap.template)
  if (!made.ok) return made
  const defIds = [...new Set(cap.template.instances.map((i) => i.defId))].sort()
  return { ok: true, plan: { ...base, args: { instanceIds: [...req.instanceIds], template: cap.template, ...(req.sourceChartId !== undefined ? { sourceChartId: req.sourceChartId } : {}) },
    target: { ids: [], defId: defIds.length === 1 ? defIds[0] : null, defIds },
    pins: { defVersions: Object.fromEntries(defIds.map((d) => [d, defVersionOf(registry, d)])), already: made.already.map((a) => a.instanceId) },
    preview: { name: made.copied.map((c) => c.name).join(', '), copied: made.copied.map((c) => ({ name: c.name })), already: made.already, severs: [] } } }
}

function revalidateExt(view, plan, ctx) {
  const op = plan.op
  if (ctx.canManage !== true) return refuse(REASONS.PERMISSION_CHANGED, { was: REASONS.READONLY })
  if (plan.boardRevision !== null && ctx.boardRevision !== undefined && ctx.boardRevision !== plan.boardRevision) return refuse(REASONS.CHANGED_WHILE_WORKING, { what: 'board' })
  if (PANE_OPS.includes(op)) {
    if (paneFingerprint(view, ctx.registry, ctx.volumeOpts) !== plan.pins.paneFingerprint) return refuse(REASONS.CHANGED_WHILE_WORKING, { what: 'panes' })
    return { ok: true }
  }
  if (op === 'copyFrom') {
    for (const [d, v] of Object.entries(plan.pins.defVersions || {})) {
      const editable = checkEditableDefinition(d, null, ctx)
      if (!editable.ok) return refuse(REASONS.PERMISSION_CHANGED, { was: editable.reason })
      if (defVersionOf(ctx.registry, d) !== v) return refuse(REASONS.CHANGED_WHILE_WORKING, { what: 'definition' })
    }
    return { ok: true }
  }
  const id = plan.args.instanceId
  if (!findInstance(view, id) || isInstanceTombstone(findInstance(view, id))) return refuse(REASONS.NOT_FOUND)
  const editable = checkEditableDefinition(plan.target.defId, id, ctx)
  if (!editable.ok) return refuse(REASONS.PERMISSION_CHANGED, { was: editable.reason })
  if (groupFingerprint(view, [id]) !== plan.pins.groupFingerprint) return refuse(REASONS.CHANGED_WHILE_WORKING, { what: 'indicator' })
  if (op === 'duplicate' && defVersionOf(ctx.registry, plan.target.defId) !== plan.pins.defVersion) return refuse(REASONS.CHANGED_WHILE_WORKING, { what: 'definition' })
  return { ok: true }
}

function applyExt(view, plan, ctx) {
  const ok = revalidateExt(view, plan, ctx)
  if (!ok.ok) return ok
  const registry = ctx.registry
  if (STYLE_OPS.includes(plan.op)) {
    const inst = findInstance(view, plan.args.instanceId)
    const made = writeStyle(view, plan.args, inst, getDefOf(registry)(inst.defId), registry)
    if (!made.ok) return made
    const record = recordOf(plan.target.ids, view, made.cs)
    return { ok: true, cs: made.cs, pending: pendingFor(plan.op, plan, view, made.cs, record, registry,
      { name: plan.preview.nameAfter || plan.preview.name, change: made.change }) }
  }
  if (PANE_OPS.includes(plan.op)) {
    const made = writePane(view, plan.args, registry, ctx.volumeOpts)
    if (!made.ok) return made
    const record = recordOf(made.ids, view, made.cs)
    return { ok: true, cs: made.cs, pending: pendingFor(plan.op, plan, view, made.cs, record, registry,
      { name: made.change.label, change: made.change, paneKey: made.paneKey }) }
  }
  const made = writeCreate(view, plan.op === 'duplicate' ? { op: 'duplicate', instanceId: plan.args.instanceId } : plan, registry, plan.args.template)
  if (!made.ok) return made
  if (plan.op === 'copyFrom' && !same(made.already.map((a) => a.instanceId), plan.pins.already)) return refuse(REASONS.CHANGED_WHILE_WORKING, { what: 'chart' })
  const record = recordOf(made.ids, view, made.cs)
  const name = plan.op === 'duplicate' ? (nameOf(made.cs, registry, made.ids[0]) || plan.preview.name) : made.copied.map((c) => c.name).join(', ')
  return { ok: true, cs: made.cs, pending: pendingFor(plan.op, plan, view, made.cs, record, registry,
    { name, ...(plan.op === 'copyFrom' ? { copied: made.copied, already: made.already } : { from: plan.preview.from }) }) }
}

function undoExt(view, undo, ctx, plan) {
  const registry = ctx.registry
  if (STYLE_OPS.includes(undo.op) || PANE_OPS.includes(undo.op)) {
    if (PANE_OPS.includes(undo.op)) {
      if (paneFingerprint(view, registry, ctx.volumeOpts) !== undo.paneFingerprintAfter) return refuse(REASONS.RESTORE_CONFLICT, { path: ['paneOrder'] })
    } else if (groupFingerprint(view, undo.ids) !== undo.groupFingerprintAfter) return refuse(REASONS.RESTORE_CONFLICT, { path: ['indicatorInstances'] })
    const r = revertExact(view, undo)
    if (!r.ok) return r
    const record = recordOf(undo.ids, view, r.cs)
    return { ok: true, cs: r.cs, pending: pendingFor(undo.op, plan, view, r.cs, record, registry,
      { name: undo.name, undoOf: undo.op, ...(undo.paneKey ? { paneKey: undo.paneKey } : {}) }) }
  }
  // duplicate / copyFrom → remove what was created (the product's own delete), exact or refused
  const ids = undo.ids || []
  if (!ids.length || !ids.every((id) => findInstance(view, id) && !isInstanceTombstone(findInstance(view, id)))) return refuse(REASONS.RESTORE_CONFLICT, { path: null })
  if (groupFingerprint(view, ids) !== undo.groupFingerprintAfter) return refuse(REASONS.RESTORE_CONFLICT, { path: ['indicatorInstances'] })
  if (dependentsOf(view, ids, registry).length) return refuse(REASONS.DEPENDENT_EXISTS)
  // ⭐ WS3: what the copy created taken back out exactly (see `undoCreated`)
  const exact = undoCreated(view, undo)
  if (exact && !exact.ok) return exact
  if (exact) {
    return { ok: true, cs: exact.cs, pending: pendingFor('remove', plan, view, exact.cs, recordOf(ids, view, exact.cs), registry, { name: undo.name, undoOf: undo.op }) }
  }
  let next = view
  for (const id of ids) {
    const after = removeInstance(next, id, registry)
    if (after === next) return refuse(REASONS.WRITER_REFUSED)
    next = after
  }
  const record = recordOf(ids, view, next)
  return { ok: true, cs: next, pending: pendingFor('remove', plan, view, next, record, registry, { name: undo.name, undoOf: undo.op }) }
}

/**
 * ⭐ "APPLY IT TO ALL MY CHARTS" — plan ONE request on each of several charts. Pure: every
 * chart keeps its own plan, its own persist, its own confirmation and its own Undo token
 * (Agent applies and confirms them one chart at a time through each chart's persist path).
 * A chart that refuses does not stop the others — its refusal is returned in its slot.
 * @param {{chartId: string, cs: object, ctx: object}[]} charts   `ctx` as for `planIndicatorMutation`
 * @param {object|function} request   one request for every chart, or `(chart) => request`
 * @returns {{chartId, ok: true, plan} | {chartId, ok: false, reason, detail?}}[]
 */
export function planAcrossCharts(charts, request) {
  return (Array.isArray(charts) ? charts : []).map((chart) => {
    const chartId = chart && chart.chartId !== undefined ? chart.chartId : null
    try {
      const req = typeof request === 'function' ? request(chart) : request
      const p = planIndicatorMutation(chart && chart.cs, req, { ...((chart && chart.ctx) || {}), chartId })
      return { chartId, ...p }
    } catch {
      return { chartId, ...refuse(REASONS.BAD_REQUEST) }
    }
  })
}

export { inputSpecOf }

// ─── ⭐ VOLUME PROFILE — the carved-out canvas overlay (Agent Charts family, 2026-11-12, owner-approved, ADDITIVE) ───────────
//
// `volumeProfile` is `nativeRegistry.CARVED_OUT_INDICATOR_KEYS`' one member: NO definition, NO instance, and none is ever made
// here. Its settings slice `cs.indicators.volumeProfile` IS its existence (chartDefaults' ⛔ comment), and StockChart's canvas
// effect reads exactly that slice.
//
// ⛔ NO SECOND WRITER. The write is Chart Settings → Indicators' own row writer, `indicatorRegistry.applyRowPatch`, over the
// carved-out row `listAllIndicators` lists (the modal's `setRow`): the row's toggle patches `{enabled}` — the same shape the
// library's `toggledRow` makes for a carved-out row — and its Bins / Color / Point of control fields patch `{[key]: value}`.
// ⛔ THE BOUNDS ARE THE ROW'S OWN (`CARVED_OUT_ROWS` fields: bins 8–50, step 1). A value outside them is REFUSED, never
// clamped. A colour is what the canvas can paint: hex (#rgb / #rrggbb / #rrggbbaa, the colour picker's) or rgb()/rgba() (the
// defaults); a theme token is not (a 2D context cannot resolve one).
// ⛔ ONE LEAF: the write may change only `indicators.volumeProfile.*` — anything else is `writer-refused`.
export const VOLUME_PROFILE_KEY = 'volumeProfile'
export const VOLUME_PROFILE_REASONS = Object.freeze({ BAD_VALUE: 'bad-value', NO_CHANGE: 'no-change', WRITER_REFUSED: 'writer-refused' })
const vpCatalogRow = () => CARVED_OUT_ROWS.find((r) => r.id === VOLUME_PROFILE_KEY)
const VP_HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const VP_FN = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i
/** The row's own fields (`{key, label, type, min?, max?, step?}`), as Chart Settings renders them. */
export function volumeProfileFields() {
  return vpCatalogRow().fields.map((f) => ({ ...f }))
}
/** The Volume Profile as the chart reads it: `{enabled, bins, color, pocColor}` (the stored slice over the shipped defaults). */
export function volumeProfileOf(cs) {
  const vp = (mergeChartSettings(cs || null)?.indicators || {})[VOLUME_PROFILE_KEY] || {}
  return { enabled: vp.enabled === true, bins: vp.bins, color: vp.color, pocColor: vp.pocColor }
}
/** Validate a patch against the row's own fields. `{ok:true, patch}` | `{ok:false, reason:'bad-value', key, why, field?}`. */
export function checkVolumeProfilePatch(patch) {
  if (!isObj(patch)) return { ok: false, reason: VOLUME_PROFILE_REASONS.BAD_VALUE, key: null, why: 'nothing to change' }
  const fields = new Map(volumeProfileFields().map((f) => [f.key, f]))
  const out = {}
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'enabled') {
      if (typeof value !== 'boolean') return { ok: false, reason: VOLUME_PROFILE_REASONS.BAD_VALUE, key, why: 'it is on or off' }
      out.enabled = value
      continue
    }
    const f = fields.get(key)
    if (!f) return { ok: false, reason: VOLUME_PROFILE_REASONS.BAD_VALUE, key, why: 'Volume Profile has no such setting' }
    if (f.type === 'number') {
      const n = typeof value === 'number' ? value : NaN
      const whole = f.step === 1
      if (!Number.isFinite(n) || n < f.min || n > f.max || (whole && !Number.isInteger(n))) {
        return { ok: false, reason: VOLUME_PROFILE_REASONS.BAD_VALUE, key, field: { ...f }, why: `${f.label} is a ${whole ? 'whole number' : 'number'} from ${f.min} to ${f.max}` }
      }
      out[key] = n
    } else if (f.type === 'color') {
      const s = typeof value === 'string' ? value.trim() : ''
      if (!(VP_HEX.test(s) || VP_FN.test(s))) return { ok: false, reason: VOLUME_PROFILE_REASONS.BAD_VALUE, key, field: { ...f }, why: `${f.label} needs a hex colour such as #2962ff` }
      out[key] = VP_HEX.test(s) ? s.toLowerCase() : s
    } else {
      return { ok: false, reason: VOLUME_PROFILE_REASONS.BAD_VALUE, key, why: 'Volume Profile has no such setting' }
    }
  }
  if (!Object.keys(out).length) return { ok: false, reason: VOLUME_PROFILE_REASONS.BAD_VALUE, key: null, why: 'nothing to change' }
  return { ok: true, patch: out }
}
/**
 * Write a Volume Profile patch through the settings row's own writer.
 * `{ok:true, cs, before, after, changed}` | `{ok:false, reason, …}` — `no-change` when it already reads that way (nothing written).
 */
export function writeVolumeProfile(cs, patch, registry) {
  const chk = checkVolumeProfilePatch(patch)
  if (!chk.ok) return chk
  const before = volumeProfileOf(cs)
  const changed = Object.keys(chk.patch).filter((k) => before[k] !== chk.patch[k])
  if (!changed.length) return { ok: false, reason: VOLUME_PROFILE_REASONS.NO_CHANGE, before }
  const row = listAllIndicators(cs, registry).find((r) => r && r.id === VOLUME_PROFILE_KEY && r.engineOwned === false && r.path && r.path.kind === 'indicator')
  if (!row) return { ok: false, reason: VOLUME_PROFILE_REASONS.WRITER_REFUSED }
  const want = Object.fromEntries(changed.map((k) => [k, chk.patch[k]]))
  const next = applyRowPatch(row, want, cs, registry)
  if (!next || next === cs) return { ok: false, reason: VOLUME_PROFILE_REASONS.WRITER_REFUSED }
  // ONE LEAF: everything outside `indicators.volumeProfile` is byte-identical, and the slice reads what was asked
  const outside = (s) => JSON.stringify({ ...s, preset: null, indicators: { ...((s && s.indicators) || {}), [VOLUME_PROFILE_KEY]: null } })
  const after = volumeProfileOf(next)
  if (outside(cs) !== outside(next) || changed.some((k) => after[k] !== want[k])) return { ok: false, reason: VOLUME_PROFILE_REASONS.WRITER_REFUSED }
  return { ok: true, cs: next, before, after, changed }
}
/** Read-back: does the persisted blob's Volume Profile read every value of `want`? */
export function confirmVolumeProfile(persisted, want) {
  if (!isObj(want)) return false
  const now = volumeProfileOf(persisted)
  return Object.entries(want).every(([k, v]) => now[k] === v)
}
