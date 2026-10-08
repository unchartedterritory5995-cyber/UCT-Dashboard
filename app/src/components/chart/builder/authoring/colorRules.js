// app/src/components/chart/builder/authoring/colorRules.js
//
// ─── ⭐ PHASE 5 — PER-BAR COLOUR RULES AND CONDITIONAL CLOUDS, AS DATA ─────────
//
// A RISING rule ("green while it rises") and an ABOVE/BELOW cloud ("green where the
// fast line is above the slow") each read a hidden 0/1 column, the Builder's own
// `colorMode: 'column:<key>'` idiom (`value_c`). That column's tree is DERIVED from
// the output(s) it colours, so it is recognised STRUCTURALLY — its tree IS the
// derivation — never by a flag. One module, read by the patch engine (which writes
// and re-derives them), the compact view and the read-back (which describe them).
//
// ⛔ AN UNKNOWN BAR TAKES NO RULE COLOUR. A conversation-made definition is
// semantics 2 (`binder.unknownColourRule`): an unknown condition is no condition,
// so the line keeps its own colour there and a cloud leaves the bar unshaded.

import { astHash } from '../../engine/ast/parse'
import { outputTreeOf } from '../../engine/outputType'

export const COLOR_HELPER_SUFFIX = '_c'
export const FILL_HELPER_SUFFIX = '_fc'
export const COLOR_RULES = Object.freeze(['sign', 'rising', 'condition', 'none'])

/** `x > x[1]` — the canonical spelling (an offset of an offset folds). */
export function risingTree(t) {
  const back = t && t.type === 'offset' && Number.isInteger(t.value)
    ? { type: 'offset', value: t.value + 1, args: t.args }
    : { type: 'offset', value: 1, args: [t] }
  return { type: 'op', name: '>', args: [t, back] }
}

/** `a > b`. */
export const aboveTree = (a, b) => ({ type: 'op', name: '>', args: [a, b] })

export function sameTree(a, b) {
  try { return !!a && !!b && astHash(a) === astHash(b) } catch { return false }
}

const plotOf = (def, key) => ((def && def.plots) || []).find((p) => p && p.key === key) || null

/**
 * The helper columns of a DEFINITION: `Map<helperKey, {owner, kind: 'rising'|'cloud'}>`.
 * A column is a helper only when its plot is hidden, its key is the owner's key +
 * the suffix, the owner's mode names it, and its tree is exactly the derivation.
 */
export function helpersOfDefinition(def) {
  const out = new Map()
  for (const p of (def && def.plots) || []) {
    if (!p || typeof p.key !== 'string') continue
    const own = outputTreeOf(def, p.key)
    if (!own) continue
    const ck = `${p.key}${COLOR_HELPER_SUFFIX}`
    if (p.colorMode === `column:${ck}`) {
      const h = plotOf(def, ck)
      if (h && h.hidden === true && sameTree(outputTreeOf(def, ck), risingTree(own))) out.set(ck, { owner: p.key, kind: 'rising' })
    }
    const fk = `${p.key}${FILL_HELPER_SUFFIX}`
    if (p.fill && p.fill.colorMode === `column:${fk}` && typeof p.fill.with === 'string') {
      const h = plotOf(def, fk)
      const w = outputTreeOf(def, p.fill.with)
      if (h && h.hidden === true && w && sameTree(outputTreeOf(def, fk), aboveTree(own, w))) out.set(fk, { owner: p.key, kind: 'cloud' })
    }
  }
  return out
}

/** A plot's colour rule in the conversation's words (definition-level). */
export function plotColorRule(def, plot, helpers = helpersOfDefinition(def)) {
  if (!plot || !plot.colorMode) return null
  if (plot.colorMode === 'sign' && plot.colorUp && plot.colorDown) return { rule: 'sign', up: plot.colorUp, down: plot.colorDown }
  if (String(plot.colorMode).startsWith('column:') && plot.colorUp && plot.colorDown
    && !plot.colorPalette && !plot.colorGradient && !plot.colorPacked) {
    const key = plot.colorMode.slice('column:'.length)
    const h = helpers.get(key)
    if (h && h.owner === plot.key && h.kind === 'rising') return { rule: 'rising', up: plot.colorUp, down: plot.colorDown }
    return { rule: 'condition', when: key, up: plot.colorUp, down: plot.colorDown }
  }
  return { rule: 'imported' }
}

/** A plot's fill in the conversation's words (definition-level). */
export function plotFillRule(def, plot, helpers = helpersOfDefinition(def)) {
  const f = plot && plot.fill
  if (!f || typeof f.with !== 'string') return null
  const base = {
    with: f.with,
    ...(typeof plot.fillColor === 'string' ? { color: plot.fillColor } : {}),
    ...(Number.isFinite(plot.fillOpacity) ? { opacity: plot.fillOpacity } : {}),
  }
  if (!f.colorMode) return base
  if (String(f.colorMode).startsWith('column:') && f.colorUp && f.colorDown && !f.colorPalette) {
    const key = f.colorMode.slice('column:'.length)
    const h = helpers.get(key)
    if (h && h.owner === plot.key && h.kind === 'cloud') return { ...base, colorAbove: f.colorUp, colorBelow: f.colorDown }
    return { ...base, when: key, colorAbove: f.colorUp, colorBelow: f.colorDown }
  }
  return { ...base, imported: true }
}

/** The helper columns of a Builder ROW MODEL (`{rows: [{key, ast, hidden, colorMode,
 *  fill}]}`): the same structural test as `helpersOfDefinition`, on rows. */
export function helperKeysOfRows(rows) {
  const out = new Set()
  const list = Array.isArray(rows) ? rows : []
  const at = (k) => list.find((r) => r && r.key === k) || null
  for (const o of list) {
    if (!o || !o.ast) continue
    const ck = `${o.key}${COLOR_HELPER_SUFFIX}`
    const h = at(ck)
    if (h && h.hidden === true && o.colorMode === `column:${ck}` && sameTree(h.ast, risingTree(o.ast))) out.add(ck)
    const fk = `${o.key}${FILL_HELPER_SUFFIX}`
    const f = at(fk)
    const w = o.fill && typeof o.fill.with === 'string' ? at(o.fill.with) : null
    if (f && w && w.ast && f.hidden === true && o.fill.colorMode === `column:${fk}` && sameTree(f.ast, aboveTree(o.ast, w.ast))) out.add(fk)
  }
  return out
}
