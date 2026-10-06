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
  'opacity', 'displace', 'displaceFrom', 'fill', 'fillColor', 'fillOpacity'])

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

export { LEVELS_PLOT_KEY }
