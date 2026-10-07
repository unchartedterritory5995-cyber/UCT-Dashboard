// app/src/components/chart/builder/authoring/model.js
//
// ─── ⭐⭐ P2 — THE BUILDER ROW MODEL OF A DEFINITION, AND BACK ─────────────────
//
// ONE DEFINITION ARCHITECTURE. A conversational edit does not write a document
// of its own: it edits the SAME rows the Builder's `openForEdit` restores and
// `save()` builds from, and the document is `buildDefinition(...)` — the one
// function that decides what a user definition looks like. So an AI-authored
// document is exactly what a manual Builder save of the same rows would store.
//
// ⛔ FIDELITY BEFORE ANY EDIT. `modelOf(def)` → `buildFromModel(model)` must
// reproduce `def` on every path the Builder authors. A document it cannot
// reproduce (a field `buildDefinition` would drop) is REFUSED for patching with
// the paths named — never rebuilt with the field silently gone.
//
// ⛔ CARRIED, NOT AUTHORED: the server-owned stamps (`id`, `version`,
// `compute.rev`, `compute.paramState`, `meta.semantics`) and the document meta
// `buildDefinition` does not write (`category`, `tags`, `tier`, and any other
// key such as `recurrenceOrigin`). They are copied verbatim from the input and
// NO op can set them — `meta.semantics` in particular is the store's decision
// (`user_definitions.decide_semantics`), never the engine's.

import {
  buildDefinition, dataPlotDefs, storedSourceFor, chipName, isUntouchedRow, DEFAULT_PLOT1_LABEL, PANE_PLACEMENT,
  LEVELS_PLOT_KEY,
} from '../BuilderSheet'
import { BUILDER_INPUTS, chromeInputKeys, chromeInputsFor } from '../builderInputs'
import { evaluateFormula } from '../FormulaField'
import { declaredInputs } from '../../engine/ast/lint'
import { astHash } from '../../engine/ast/parse'

export class AuthoringError extends Error {
  constructor(code, message, extra = {}) {
    super(message)
    this.code = code
    Object.assign(this, extra)
  }
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

/** The meta keys `buildDefinition` DERIVES. Every other meta key is carried. */
export const DERIVED_META = Object.freeze(['name', 'shortName', 'description', 'repaint', 'freshness'])
/** Server-owned compute stamps, carried verbatim. */
export const CARRIED_COMPUTE = Object.freeze(['rev', 'paramState'])

/** The presentation fields a plot row carries through `buildDefinition`. */
const ROW_PRESENTATION = Object.freeze(['colorMode', 'colorUp', 'colorDown', 'colorPalette', 'colorGradient',
  'opacity', 'displace', 'displaceFrom', 'fill', 'fillColor', 'fillOpacity',
  // ⭐ P3 — a plot's line style (`buildDefinition` projects it from the row).
  'lineStyle'])

const isDefaultPane = (p) => JSON.stringify(p) === JSON.stringify(PANE_PLACEMENT())

/** Evaluate one row's text the way the Builder does (`evaluateFormula` under the
 *  document's own declared scope). Throws AuthoringError when it refuses. */
export function evaluateRowSource(source, scope, key) {
  const ev = evaluateFormula(source, scope)
  if (!ev.ok || !ev.ast || !ev.verdict) {
    throw new AuthoringError(`tree:${ev.guard || ev.status || 'refused'}`,
      `${key}: ${ev.error || 'this formula does not evaluate'}`, { output: key })
  }
  return ev
}

/**
 * The Builder row model of a stored `ast` definition.
 * @returns {{defId, version, rev, name, rows, scanKey, placement, levels, paints, objects,
 *   paramManifest, memberInputs, carried}}
 */
export function modelOf(def) {
  if (!isObj(def) || !isObj(def.compute) || def.compute.kind !== 'ast') {
    throw new AuthoringError('authoring:kind',
      'Only formula definitions can be edited by conversation; this one is computed another way.')
  }
  const compute = def.compute
  const scope = declaredInputs(def)
  const plots = Array.isArray(def.plots) ? def.plots : []
  const dataDefs = dataPlotDefs(def)
  if (!dataDefs.length) throw new AuthoringError('authoring:no-output', 'This definition declares no output.')
  const guide = plots.find((p) => p && p.style === 'hlines' && Array.isArray(p.levels))
  const inputsByKey = new Map((Array.isArray(def.inputs) ? def.inputs : []).map((s) => [s && s.key, s]))
  const metaShort = chipName(String((def.meta && def.meta.name) || ''))
  const multi = isObj(compute.trees)

  const rows = dataDefs.map((p, i) => {
    const source = storedSourceFor(compute, p.key, i)
    if (source === null) {
      throw new AuthoringError('authoring:no-source', `${p.key}: this output was stored without its formula text.`, { output: p.key })
    }
    const keys = chromeInputKeys(p, i)
    const colorSpec = inputsByKey.get(keys.color)
    const widthSpec = inputsByKey.get(keys.width)
    const derived = i === 0 ? DEFAULT_PLOT1_LABEL(metaShort) : p.key
    const ev = evaluateRowSource(source, scope, p.key)
    const stored = multi ? compute.trees[p.key] : compute.ast
    // ⭐ BYTE IDENTITY: an untouched row keeps the STORED tree object when it is
    // the same tree (same astHash) the text re-reads to.
    let tree = ev.ast
    try { if (stored && astHash(stored) === astHash(ev.ast)) tree = stored } catch { /* fidelity reports it */ }
    const row = {
      key: p.key,
      label: (typeof p.label === 'string' && p.label !== derived) ? p.label : '',
      style: typeof p.style === 'string' ? p.style : 'line',
      color: (colorSpec && typeof colorSpec.default === 'string' && colorSpec.default) ? colorSpec.default : BUILDER_INPUTS[0].default,
      width: (widthSpec && Number.isFinite(widthSpec.default)) ? widthSpec.default : BUILDER_INPUTS[1].default,
      hidden: p.hidden === true,
      ...(p.style === 'markers' && p.marker && p.marker.shape ? { marker: clone(p.marker) } : {}),
      source,
      ast: tree,
      mode: ev.verdict.mode,
      readback: ev.readback,
      dialect: ev.dialect || 'native',
    }
    for (const f of ROW_PRESENTATION) if (p[f] !== undefined) row[f] = clone(p[f])
    return row
  })
  const chromeKeys = new Set(chromeInputsFor(rows).map((s) => s.key))
  const memberInputs = (Array.isArray(def.inputs) ? def.inputs : [])
    .filter((s) => s && typeof s.key === 'string' && !chromeKeys.has(s.key)).map(clone)
  const scanKey = rows.some((r) => r.key === compute.scanPlot) ? compute.scanPlot : rows[0].key

  const meta = isObj(def.meta) ? def.meta : {}
  const carried = {
    id: def.id,
    version: def.version,
    compute: Object.fromEntries(CARRIED_COMPUTE.filter((k) => compute[k] !== undefined).map((k) => [k, clone(compute[k])])),
    meta: Object.fromEntries(Object.keys(meta).filter((k) => !DERIVED_META.includes(k)).map((k) => [k, clone(meta[k])])),
  }
  return {
    defId: def.id,
    version: def.version,
    rev: Number.isInteger(compute.rev) ? compute.rev : 1,
    name: String(meta.name || ''),
    rows,
    scanKey,
    placement: isObj(def.placement) ? clone(def.placement) : null,
    levels: guide ? [...guide.levels] : null,
    paints: Array.isArray(def.paints) && def.paints.length ? clone(def.paints) : null,
    objects: isObj(def.objects) ? clone(def.objects) : null,
    paramManifest: isObj(compute.paramManifest) && Object.keys(compute.paramManifest).length
      ? clone(compute.paramManifest) : null,
    memberInputs,
    carried,
  }
}

/** Does this row model take the Builder's byte-identical schema-1 path? The
 *  Builder's own `plain` test (`documentFor`): ONE untouched row, own pane, no
 *  levels, no paints — plus no presentation the schema-1 body cannot carry. */
export function isPlainModel(model) {
  const r = model.rows[0]
  return model.rows.length === 1
    && isUntouchedRow(r)
    && !r.marker && ROW_PRESENTATION.every((f) => r[f] === undefined)
    && (model.placement === null || isDefaultPane(model.placement))
    && !(model.levels && model.levels.length)
    && !(model.paints && model.paints.length)
    && !(model.objects && Array.isArray(model.objects.ops) && model.objects.ops.length)
}

/** Reorder `next`'s keys to follow `like`'s where both have them (new keys
 *  last), recursively through objects and keyed arrays — so an unchanged
 *  sub-document is byte-identical, not merely deep-equal. */
export function orderLike(like, next) {
  // ⭐ An unchanged sub-document is returned AS THE INPUT'S OWN OBJECT (structural
  // sharing): byte-identical by construction, and identity-equal for callers.
  if (like !== undefined && like !== null && typeof like === 'object' && stableJson(like) === stableJson(next)) return like
  if (Array.isArray(like) && Array.isArray(next)) {
    const byKey = (arr) => new Map(arr.filter((x) => isObj(x) && typeof x.key === 'string').map((x) => [x.key, x]))
    const lk = byKey(like)
    return next.map((x, i) => (isObj(x) && typeof x.key === 'string' && lk.has(x.key)
      ? orderLike(lk.get(x.key), x)
      : orderLike(like[i], x)))
  }
  if (!isObj(like) || !isObj(next)) return next
  const out = {}
  for (const k of Object.keys(like)) if (k in next) out[k] = orderLike(like[k], next[k])
  for (const k of Object.keys(next)) if (!(k in out)) out[k] = next[k]
  return out
}

/** `buildDefinition` over the row model, then the carried stamps — the document
 *  a manual Builder save of the same rows would store (before the store's own
 *  semantics / rev decision). */
export function buildFromModel(model, { like = null } = {}) {
  const rows = model.rows
  const r0 = rows[0]
  const plain = isPlainModel(model)
  const doc = buildDefinition({
    defId: model.defId,
    version: model.version,
    rev: model.rev,
    name: model.name,
    source: r0.source,
    ast: r0.ast,
    mode: r0.mode,
    readback: r0.readback,
    inputs: [...BUILDER_INPUTS, ...model.memberInputs],
    paramManifest: model.paramManifest,
    objects: model.objects,
    ...(plain ? {} : {
      plots: rows.map((r) => { const out = { ...r }; delete out.dialect; return out }),
      scanPlot: model.scanKey,
      placement: model.placement && !isDefaultPane(model.placement) ? model.placement : null,
      levels: model.levels && model.levels.length ? model.levels : null,
    }),
    ...(model.paints && model.paints.length ? { paints: model.paints } : {}),
  })
  const c = model.carried || { compute: {}, meta: {} }
  if (c.id !== undefined) doc.id = c.id
  if (c.version !== undefined) doc.version = c.version
  Object.assign(doc.compute, clone(c.compute))
  doc.meta = { ...doc.meta, ...clone(c.meta) }
  return like ? orderLike(like, doc) : doc
}

/** Canonical JSON (sorted keys) — the fidelity comparison. */
export function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`
  return JSON.stringify(v)
}

/** The paths where `a` and `b` differ (keyed arrays by key). */
export function diffPaths(a, b, at = '', out = []) {
  if (stableJson(a) === stableJson(b)) return out
  if (Array.isArray(a) && Array.isArray(b)) {
    const keyed = (arr) => arr.every((x) => isObj(x) && typeof x.key === 'string')
    if (keyed(a) && keyed(b)) {
      const ka = new Map(a.map((x) => [x.key, x]))
      const kb = new Map(b.map((x) => [x.key, x]))
      for (const k of new Set([...ka.keys(), ...kb.keys()])) diffPaths(ka.get(k), kb.get(k), `${at}[${k}]`, out)
      if (stableJson(a.map((x) => x.key)) !== stableJson(b.map((x) => x.key)) && !out.length) out.push(`${at}(order)`)
      return out
    }
    out.push(at || '(root)')
    return out
  }
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], at ? `${at}.${k}` : k, out)
    return out
  }
  out.push(at || '(root)')
  return out
}

/** ⛔ THE FIDELITY GUARD: the paths a Builder round trip of `def` would change. */
export function fidelityResidual(def, model) {
  return diffPaths(def, buildFromModel(model))
}

// ─── ⭐⭐ PHASE 4 — PRESERVE WHAT THE CONVERSATION CANNOT AUTHOR ─────────────────
//
// THE AI DOES NOT NEED TO UNDERSTAND EVERY FIELD IN ORDER TO PRESERVE EVERY FIELD.
// A residual path (a field `buildFromModel` would not reproduce — an imported
// plot's legend decimals, column geometry, packed per-bar colours, a band, a share
// install's `origin` …) used to refuse the WHOLE definition. It is now split:
//
//   CARRIED  — valid presentation/document state outside the model's vocabulary.
//              Kept out of model ownership and grafted back VERBATIM (the stored
//              value, by path) onto every patched document.
//   BLOCKING — maths and structure (`compute.*`, `inputs`, a whole plot the row
//              model does not hold, plot order). Still refused, by name: carrying
//              maths the model cannot see would desynchronise what it edits.
//
// ⛔ A CONFLICT IS REFUSED, NEVER RESOLVED: when a patch changes a setting in the
// SAME group as a carried field of the same output (its colour while a per-bar
// colour is carried, its style while column geometry is carried …), the request
// needs a field the conversation cannot read, so the turn is refused truthfully.

/** Top-level keys whose residual is never carried (the maths and the identity). */
const BLOCKING_TOP = Object.freeze(['compute', 'inputs', 'schemaVersion', 'id', 'version'])

/** Per-output setting groups: a carried field conflicts with a change in its group. */
const PLOT_GROUPS = Object.freeze([
  Object.freeze(['color', 'colorMode', 'colorUp', 'colorDown', 'colorPalette', 'colorGradient', 'colorPacked', 'opacity']),
  Object.freeze(['style', 'bar', 'band', 'edges', 'marker', 'lineStyle', 'sparse', 'width', 'base']),
  Object.freeze(['fill', 'fillColor', 'fillOpacity']),
  Object.freeze(['legend']),
  Object.freeze(['precision']),
  Object.freeze(['displace', 'displaceFrom']),
])

/** `'plots[value].legend.decimals'` → `[{k:'plots'}, {key:'value'}, {k:'legend'}, {k:'decimals'}]`. */
export function parsePath(p) {
  const out = []
  const re = /([^.[\]]+)|\[([^\]]*)\]/g
  let m
  while ((m = re.exec(p))) out.push(m[2] !== undefined ? { key: m[2] } : { k: m[1] })
  return out
}

const NOT_FOUND = Symbol('not-found')
function step(v, seg) {
  if (seg.key !== undefined) {
    if (!Array.isArray(v)) return NOT_FOUND
    const hit = v.find((x) => isObj(x) && x.key === seg.key)
    return hit === undefined ? NOT_FOUND : hit
  }
  if (!isObj(v) || !(seg.k in v)) return NOT_FOUND
  return v[seg.k]
}
export function getPath(doc, p) {
  let v = doc
  for (const seg of parsePath(p)) { v = step(v, seg); if (v === NOT_FOUND) return NOT_FOUND }
  return v
}

/** Is a residual path one the conversation may CARRY (never maths/structure)? */
export function isCarryablePath(p) {
  if (!p || p === '(root)' || p.includes('(order)')) return false
  const segs = parsePath(p)
  if (!segs.length || segs[0].k === undefined || BLOCKING_TOP.includes(segs[0].k)) return false
  // A FIELD of a keyed output — never the whole output (the row model would have
  // to hold it) and never an un-keyed array position.
  if (segs[0].k === 'plots') return segs.length >= 3 && segs[1].key !== undefined && segs[2].k !== undefined
  return true
}

/** Is a residual path one `buildDefinition` DERIVES (`meta.name`, `meta.shortName`,
 *  `meta.description`, `meta.repaint`, `meta.freshness`)? Those are re-derived from the
 *  model on every save — never carried (a stale short name would override the new one)
 *  and never blocking (the Builder re-derives them too). */
const isDerivedMetaPath = (p) => {
  const segs = parsePath(p)
  return segs.length >= 2 && segs[0].k === 'meta' && DERIVED_META.includes(segs[1].k)
}

/** The residual of a stored definition, split into carried and blocking paths
 *  (derived meta, re-derived on save, is neither). */
export function fidelityPlan(def, model) {
  const residual = fidelityResidual(def, model).filter((p) => !isDerivedMetaPath(p))
  const carry = []
  const blocking = []
  for (const p of residual) (isCarryablePath(p) ? carry : blocking).push(p)
  return Object.freeze({ residual, carry, blocking })
}

/** The group of settings a carried path belongs to: `{plotKey, fields}` for an
 *  output field, `{top}` for a document key. */
function groupOf(p) {
  const segs = parsePath(p)
  if (segs[0].k === 'plots') {
    const field = segs[2].k
    const fields = PLOT_GROUPS.find((g) => g.includes(field)) || Object.freeze([field])
    return { plotKey: segs[1].key, fields }
  }
  return { top: segs[0].k }
}

function plotOf(doc, key) {
  return (Array.isArray(doc && doc.plots) ? doc.plots : []).find((x) => isObj(x) && x.key === key) || null
}

function setPath(doc, p, value) {
  const segs = parsePath(p)
  let v = doc
  for (let i = 0; i < segs.length - 1; i += 1) {
    const seg = segs[i]
    const nxt = step(v, seg)
    if (nxt === NOT_FOUND) {
      if (seg.key !== undefined || !isObj(v)) return false
      v[seg.k] = {}
      v = v[seg.k]
    } else {
      v = nxt
    }
  }
  const last = segs[segs.length - 1]
  if (last.k === undefined || !isObj(v)) return false
  v[last.k] = clone(value)
  return true
}

/** The model field a document top-level key is authored through (a carried field
 *  under it conflicts when the patch moved that model field). */
const TOP_MODEL_FIELD = Object.freeze({ placement: 'placement', paints: 'paints', objects: 'objects', meta: 'name' })

/**
 * Graft the CARRIED residual of `stored` back onto `next` (a fresh document; it is
 * copied, never mutated). `before` / `after` are the ROW MODEL before and after the
 * patch — the record of what the patch changed: a carried field conflicts when the
 * patch moved anything in its group (an output's colour while a per-bar colour is
 * carried …). ⛔ The model, not two built documents: the Builder's projection writes
 * some presentation only in some shapes, so comparing built documents would see
 * movement the member never asked for.
 * @returns {{doc, conflicts: {path, output, fields}[], dropped: string[]}}
 */
export function graftCarried(next, stored, before, after, carry) {
  const doc = clone(next)
  const conflicts = []
  const dropped = []
  const rowIn = (m, key) => (m && Array.isArray(m.rows) ? m.rows.find((r) => r && r.key === key) : null) || null
  for (const p of carry) {
    const value = getPath(stored, p)
    if (value === NOT_FOUND) continue
    const g = groupOf(p)
    if (g.plotKey !== undefined) {
      if (!plotOf(doc, g.plotKey) || !rowIn(after, g.plotKey)) { dropped.push(p); continue }   // removed on purpose
      const b = rowIn(before, g.plotKey)
      const a = rowIn(after, g.plotKey)
      const moved = g.fields.some((f) => stableJson(b ? b[f] : undefined) !== stableJson(a[f]))
      if (moved) { conflicts.push({ path: p, output: g.plotKey, fields: g.fields }); continue }
    } else {
      const mf = TOP_MODEL_FIELD[g.top]
      if (mf && stableJson(before ? before[mf] : undefined) !== stableJson(after ? after[mf] : undefined)) {
        conflicts.push({ path: p, output: null, fields: [g.top] })
        continue
      }
    }
    if (!setPath(doc, p, value)) dropped.push(p)
  }
  return { doc, conflicts, dropped }
}

export { LEVELS_PLOT_KEY }
