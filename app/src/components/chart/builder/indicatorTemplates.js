// app/src/components/chart/builder/indicatorTemplates.js
//
// ─── ⭐ INDICATOR TEMPLATES — a member's saved indicator set, applied in one click ──
//
// FT-070 / COV-11. TradingView's "indicator templates": group the indicators on a chart
// into one named package and put the whole package on any other chart later. This is
// the Indicators-owned seam for it, beside `agentMutations.js` (the plan written into
// the completion ledger: a capture/apply seam here, an `indicator_templates` preference
// key, a dark flag).
//
// ─── THE TEMPLATE OBJECT IS `engine/alertSets.js`'s ─────────────────────────────
//
// `applyAlertTemplate` (Phase C, `421fcafb8`) already defines what a template IS —
// `{ id, name, instances: [{ key, defId, inputs, placement, hidden }], alerts: [] }` —
// and refuses a malformed one loudly. A saved indicator template is exactly that shape
// (plus the presentation fields an instance carries, and `sources` below), and APPLY
// runs it through `applyAlertTemplate` first, so the one definition of "a well-formed
// template" is the existing one. Alerts are not captured: an alert is a server row with
// its own lifecycle, and a template that silently armed alerts would be a surprise.
//
// ─── WHAT APPLY DOES, AND WHY IT IS ADDITIVE ────────────────────────────────────
//
// Each template indicator is added to the chart as its OWN new instance, configured
// exactly as it was saved (inputs, colours, style, display target, visibility), through
// the canonical writer `instanceControls.addInstanceCopy` — `duplicateInstance`'s rule
// for a body that is not on the chart. Nothing already on the chart is removed or
// edited. Applying the same template twice adds nothing the second time: an indicator
// configured identically to one already on the chart is reported "already on this
// chart" and skipped. A definition this browser no longer has (a deleted custom
// formula) is reported "unavailable", never guessed.
//
// A source input that read ANOTHER indicator in the template (an MA of the RSI) is
// re-pointed at that indicator's new copy (`setInstanceInput`, door eight) — the saved
// id named an instance on a different chart. A source that read something the template
// does not carry falls back to the definition's default.
//
// ⛔ PURE. No React, no network, no persistence. The caller persists the returned
// settings through the chart's one persist path (Chart Settings' `onChange`) and the
// template list through `setPrefMerged('indicator_templates', …)`.

import { applyAlertTemplate } from '../engine/alertSets'
import { addInstanceCopy, setInstanceInput } from '../engine/instanceControls'
import { sourceInputsOf, sourceDependsOn, parseSource, instanceSource } from '../engine/sourceRef'
import { adoptOverlayAverages } from '../maAdoption'
import { isInstanceTombstone } from '../instanceShape'
import { STUDIO_PREVIEW_DEF_ID } from './studio/chartPreview'
import { instancesOf } from './agentSeams'

export const INDICATOR_TEMPLATE_CONTRACT = 'uct.indicators.template/1'
/** The preference key the member's template list lives under (server-allowlisted). */
export const INDICATOR_TEMPLATES_PREF = 'indicator_templates'
export const MAX_INDICATOR_TEMPLATES = 25
export const MAX_TEMPLATE_INDICATORS = 40
export const TEMPLATE_NAME_MAX = 40

/**
 * Is the indicator-templates surface on in this build? Default OFF:
 * `VITE_INDICATOR_TEMPLATES_ENABLED === '1'`, read INSIDE the function (never at module
 * scope) so a test can flip it, and a build with no `import.meta.env` fails CLOSED.
 * ⛔ ONE READER: the name appears in this file only.
 */
export function indicatorTemplatesEnabled() {
  try {
    return import.meta.env.VITE_INDICATOR_TEMPLATES_ENABLED === '1'
  } catch {
    return false
  }
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const clone = (v) => JSON.parse(JSON.stringify(v))
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : isObj(v) ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
    : JSON.stringify(v === undefined ? null : v))
const isPreview = (inst) => (typeof inst.instanceId === 'string' && inst.instanceId.includes(STUDIO_PREVIEW_DEF_ID))
  || (typeof inst.defId === 'string' && inst.defId.includes(STUDIO_PREVIEW_DEF_ID))
const getDefOf = (registry) => (id) => {
  try {
    if (typeof registry === 'function') return registry(id) || null
    if (registry && typeof registry.getDefinition === 'function') return registry.getDefinition(id) || null
  } catch { /* an unreadable registry resolves nothing */ }
  return null
}

/** Fields that are an instance's IDENTITY or bookkeeping, never part of what a member
 *  configured — not captured, not compared. */
const IDENTITY_FIELDS = ['instanceId', 'scope', 'group', 'deleted', 'defVersion']

/** The configuration of an instance with its identity removed and the given source
 *  inputs dropped (they name other instances, so they never compare equal by value). */
function configOf(inst, dropInputs = []) {
  const out = {}
  for (const [k, v] of Object.entries(inst)) {
    if (IDENTITY_FIELDS.includes(k) || v === undefined) continue
    out[k] = v
  }
  const inputs = isObj(out.inputs) ? { ...out.inputs } : {}
  for (const k of dropInputs) delete inputs[k]
  out.inputs = inputs
  out.hidden = inst.hidden === true
  return out
}

/** The input keys of `inst` whose value reads another instance. */
function instanceSourceKeys(def, inst) {
  const keys = []
  for (const [key, value] of sourceInputsOf(def, inst)) {
    if (sourceDependsOn(value)) keys.push(key)
  }
  return keys
}

/** What "already on this chart" compares: the definition and every configured field,
 *  minus identity, minus source inputs that name another instance. */
function signature(defOf, inst) {
  const def = defOf(inst.defId)
  const cfg = configOf(inst, instanceSourceKeys(def, inst))
  delete cfg.hidden
  if (isObj(cfg.display)) {
    const { name: _name, ...restDisplay } = cfg.display
    cfg.display = Object.keys(restDisplay).length ? restDisplay : undefined
  }
  return canon(cfg)
}

function mintTemplateId() {
  return `it${Math.random().toString(36).slice(2, 10)}`
}

/** A template name as stored: trimmed, whitespace folded, capped. `null` when empty. */
export function cleanTemplateName(name) {
  if (typeof name !== 'string') return null
  const s = name.replace(/\s+/g, ' ').trim().slice(0, TEMPLATE_NAME_MAX).trim()
  return s || null
}

/**
 * ⭐ CAPTURE — the indicators on ONE chart, as a template. Writes nothing.
 *
 * Every live indicator instance is captured with its full configuration and a stable
 * `key` (`k1`, `k2` …, in the chart's stored order). Never the Create Indicator live
 * preview, never a removed instance's tombstone, never an instance whose definition
 * this browser cannot resolve, never the Volume pane (a chart setting, not an instance).
 *
 * @param {object} cs        the chart's settings blob
 * @param {object|function} registry  the engine registry (`nativeRegistry`)
 * @param {{name: string, id?: string, now?: number}} opts
 * @returns {{ok: true, template: object} | {ok: false, reason: 'bad-name'|'empty'}}
 */
export function captureIndicatorTemplate(cs, registry, { name, id, now } = {}) {
  const clean = cleanTemplateName(name)
  if (!clean) return { ok: false, reason: 'bad-name' }
  const view = isObj(cs) ? (adoptOverlayAverages(cs) || cs) : null
  const list = view && Array.isArray(view.indicatorInstances) ? view.indicatorInstances : []
  const defOf = getDefOf(registry)
  const names = new Map(instancesOf(view || {}, registry).filter((r) => !r.setting).map((r) => [r.instanceId, r.name]))

  const live = list.filter((inst) => isObj(inst) && typeof inst.instanceId === 'string'
    && !isInstanceTombstone(inst) && !isPreview(inst) && typeof inst.defId === 'string' && defOf(inst.defId))
    .slice(0, MAX_TEMPLATE_INDICATORS)
  if (!live.length) return { ok: false, reason: 'empty' }

  const keyOf = new Map(live.map((inst, i) => [inst.instanceId, `k${i + 1}`]))
  const instances = live.map((inst) => {
    const def = defOf(inst.defId)
    const sources = {}
    for (const [inputKey, value] of sourceInputsOf(def, inst)) {
      const target = sourceDependsOn(value)
      if (!target) continue
      const parsed = parseSource(value)
      if (keyOf.has(target) && parsed && parsed.plotKey) sources[inputKey] = { key: keyOf.get(target), plotKey: parsed.plotKey }
    }
    const cfg = clone(configOf(inst, instanceSourceKeys(def, inst)))
    return {
      key: keyOf.get(inst.instanceId),
      ...cfg,
      defId: inst.defId,
      ...(Object.keys(sources).length ? { sources } : {}),
      label: names.get(inst.instanceId) || (def.meta && def.meta.name) || inst.defId,
    }
  })
  return {
    ok: true,
    template: {
      contract: INDICATOR_TEMPLATE_CONTRACT,
      id: typeof id === 'string' && id ? id : mintTemplateId(),
      name: clean,
      savedAt: Number.isFinite(now) ? now : Date.now(),
      instances,
      alerts: [],
    },
  }
}

/**
 * ⭐ APPLY — put a template's indicators on ONE chart. Pure: returns the settings to
 * persist; writes nothing itself.
 *
 * @param {object} cs         the chart's current settings
 * @param {object} template   a saved template (see `captureIndicatorTemplate`)
 * @param {object|function} registry
 * @returns {{ok: true, cs: object, changed: boolean,
 *            added: Array<{key, label, instanceId}>,
 *            already: Array<{key, label, instanceId}>,
 *            unavailable: Array<{key, label, defId}>}
 *          | {ok: false, reason: 'bad-template', detail?: string}}
 */
export function applyIndicatorTemplate(cs, template, registry) {
  if (!isObj(cs)) return { ok: false, reason: 'bad-template', detail: 'no chart settings' }
  // The template object's own validator — a malformed template is refused here, loudly,
  // exactly as `applyAlertTemplate` refuses it everywhere else. The chart id only
  // namespaces ids that validator derives; nothing it returns is written.
  try {
    applyAlertTemplate(template, 'validate')
  } catch (err) {
    return { ok: false, reason: 'bad-template', detail: String(err && err.message || err) }
  }
  const defOf = getDefOf(registry)
  const declared = (Array.isArray(template.instances) ? template.instances : [])
    .filter((e) => isObj(e) && typeof e.defId === 'string' && e.defId)
    .slice(0, MAX_TEMPLATE_INDICATORS)

  let next = adoptOverlayAverages(cs) || cs
  const added = []
  const already = []
  const unavailable = []
  const idOfKey = new Map()

  const liveSignatures = () => {
    const out = new Map()
    for (const inst of (Array.isArray(next.indicatorInstances) ? next.indicatorInstances : [])) {
      if (!isObj(inst) || typeof inst.instanceId !== 'string' || isInstanceTombstone(inst) || isPreview(inst)) continue
      if (!defOf(inst.defId)) continue
      const sig = signature(defOf, inst)
      if (!out.has(sig)) out.set(sig, [])
      out.get(sig).push(inst.instanceId)
    }
    return out
  }
  const claimed = new Set()

  for (const entry of declared) {
    const label = typeof entry.label === 'string' && entry.label ? entry.label : entry.defId
    const key = typeof entry.key === 'string' && entry.key ? entry.key : null
    if (!defOf(entry.defId)) { unavailable.push({ key, label, defId: entry.defId }); continue }
    const { key: _k, label: _l, sources: _s, ...body } = entry
    // already on this chart, configured identically (and not already matched by an
    // earlier entry of this same template — two identical RSIs need two instances)
    const sig = signature(defOf, { ...body, instanceId: '_' })
    const match = (liveSignatures().get(sig) || []).find((id) => !claimed.has(id))
    if (match) {
      claimed.add(match)
      if (key) idOfKey.set(key, match)
      already.push({ key, label, instanceId: match })
      continue
    }
    const before = new Set((next.indicatorInstances || []).map((i) => i && i.instanceId))
    const after = addInstanceCopy(next, body, registry)
    if (after === next) { unavailable.push({ key, label, defId: entry.defId }); continue }
    const minted = (after.indicatorInstances || []).find((i) => i && !before.has(i.instanceId))
    next = after
    if (!minted) continue
    claimed.add(minted.instanceId)
    if (key) idOfKey.set(key, minted.instanceId)
    added.push({ key, label, instanceId: minted.instanceId })
  }

  // Re-point source inputs that read another indicator of this template at its copy.
  for (const entry of declared) {
    if (!isObj(entry.sources) || !entry.key) continue
    const self = added.find((a) => a.key === entry.key)
    if (!self) continue
    for (const [inputKey, ref] of Object.entries(entry.sources)) {
      const target = isObj(ref) ? idOfKey.get(ref.key) : null
      const value = target ? instanceSource(target, ref.plotKey) : null
      if (value) next = setInstanceInput(next, self.instanceId, inputKey, value, registry)
    }
  }

  return { ok: true, cs: next, changed: added.length > 0, added, already, unavailable }
}

// ─── the member's list (pref `indicator_templates`) ─────────────────────────────

/** The stored list, read defensively: only well-formed templates survive. */
export function parseIndicatorTemplates(raw) {
  let arr = raw
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw) } catch { return [] }
  }
  if (!Array.isArray(arr)) return []
  return arr.filter((t) => isObj(t) && typeof t.id === 'string' && t.id
    && typeof t.name === 'string' && t.name && Array.isArray(t.instances))
}

/** The list with `template` saved at the front; a same-named template (case-insensitive)
 *  is REPLACED (re-saving updates in place), and the list is capped. */
export function withTemplateSaved(current, template) {
  const list = parseIndicatorTemplates(current)
  const want = String(template.name).toLowerCase()
  const without = list.filter((t) => t.name.toLowerCase() !== want && t.id !== template.id)
  return [template, ...without].slice(0, MAX_INDICATOR_TEMPLATES)
}

/** The list without the template whose id is `id`. */
export function withoutTemplate(current, id) {
  return parseIndicatorTemplates(current).filter((t) => t.id !== id)
}

/** A one-line, member-facing account of an apply — the sentence the surface shows. */
export function applySummary(name, result) {
  if (!result || !result.ok) return `Couldn’t apply “${name}”: the saved template is damaged.`
  const n = result.added.length
  const parts = []
  if (n) parts.push(`Added ${n} indicator${n === 1 ? '' : 's'} from “${name}”.`)
  else parts.push(`Everything in “${name}” is already on this chart.`)
  if (n && result.already.length) parts.push(`${result.already.length} already on this chart.`)
  if (result.unavailable.length) {
    const u = result.unavailable.map((x) => x.label).slice(0, 3).join(', ')
    parts.push(`${result.unavailable.length} no longer available (${u}).`)
  }
  return parts.join(' ')
}
