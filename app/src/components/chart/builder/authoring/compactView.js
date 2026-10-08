// app/src/components/chart/builder/authoring/compactView.js
//
// ─── ⭐⭐ P2 — THE COMPACT INDICATOR VIEW: THE MODEL'S WHOLE KNOWLEDGE PER TURN ──
//
// The chat transcript is not the source of truth; this view is what the model
// is shown about the indicator each turn. It is DERIVED from the canonical
// definition and the authoring state, deterministic (stable key order), DATA
// ONLY and SIZE-BOUNDED:
//   • every member- or import-authored string is wrapped `{untrusted_text}` and
//     cut — a name or description is data, never an instruction;
//   • foreign source text (PCF / thinkScript / Pine) is never shown — only the
//     canonical formula (`printFormula`) and the tree;
//   • types are `outputTypeOf`'s and lanes are the shared gate's.

import { printFormula } from '../../engine/ast/pine'
import { sentenceFor } from '../../engine/ast/sentence'
import { declaredInputs } from '../../engine/ast/lint'
import { outputsOf, outputTreeOf } from '../../engine/outputType'
import { evaluability, LANES, STATUS } from '../../engine/evaluability'
import { signalAlertGate, TRIGGER_POLICIES } from '../../engine/triggerPolicy'
import { INFO_VALUE_FORMATS } from '../../engine/infoValues'
import { MARKER_SHAPES, MARKER_POSITIONS, PLOT_LINE_STYLES } from '../../engine/defSchema'
import { typeWords, intentReadback, INTENTS, NO_PAINT } from '../authoringIntent'
import { slotsOfTree, clausesOfTree } from './slots'
import { OP_NAMES, PATCH_LIMITS, PATCH_CONTRACT } from './patchValidate'
import { NUMERIC_CONDITIONS } from '../../engine/triggerPolicy'
import { helpersOfDefinition, plotColorRule, plotFillRule, COLOR_RULES } from './colorRules'
import CROSS from './crossContext.json'
import { tableSpecOfDefinition, TABLE_POSITIONS, TABLE_FORMATS } from './tables'

export const VIEW_CONTRACT = 'uct.authoring.view/1'
export const VIEW_MAX_CHARS = 24000
export const VIEW_MAX_OUTPUTS = PATCH_LIMITS.maxOutputs
const UNTRUSTED_MAX = 80

const untrusted = (s) => ({ untrusted_text: String(s == null ? '' : s).slice(0, UNTRUSTED_MAX) })
const laneWord = (v) => (!v ? 'unknown'
  : v.status === STATUS.REFUSED ? (v.pending ? 'pending' : `refused:${v.guard || 'refused'}`) : v.status)

function resolveRef(def, v) {
  if (typeof v !== 'string' || !v.startsWith('$')) return v
  const spec = (def.inputs || []).find((s) => s && s.key === v.slice(1))
  return spec ? spec.default : v
}

function outputView(def, o, scope, gateCtx, chartVerdict, primary, helpers) {
  const plot = (def.plots || []).find((p) => p && p.key === o.key) || {}
  const tree = outputTreeOf(def, o.key)
  // ⭐ PHASE 5 — a colour rule's / cloud's hidden column is shown as WHAT IT IS, with
  // no slots or clauses of its own: it is re-derived from its owner, never edited.
  const helper = helpers.get(o.key)
  if (helper) {
    return { key: o.key, role: helper.kind === 'rising' ? 'colour-rule-column' : 'cloud-column', of: helper.owner,
      type: o.type, typeWords: typeWords(o.type), primary: false }
  }
  const colorRule = plotColorRule(def, plot, helpers)
  const fillRule = plotFillRule(def, plot, helpers)
  let formula = null
  let sentence = null
  try { formula = printFormula(tree) } catch { formula = null }
  try { sentence = sentenceFor(tree, scope) } catch { sentence = null }
  const paints = (def.paints || []).filter((p) => p && p.colorMode === `column:${o.key}`)
    .map((p) => ({ channel: p.kind, color: p.colorUp || p.color || null, own: p.colorDown === NO_PAINT }))
  return {
    key: o.key,
    label: untrusted(plot.label || o.key),
    type: o.type,
    typeWords: typeWords(o.type),
    primary: o.key === primary,
    tree: tree || null,
    formula,
    readback: sentence,
    slots: tree ? slotsOfTree(o.key, tree).map(({ id, kind, role, value, label }) => ({ id, kind, role, value, label })) : [],
    clauses: tree ? clausesOfTree(o.key, tree).map(({ id, join, node }) => {
      let s = null
      try { s = sentenceFor(node, scope) } catch { s = null }
      return { id, join, readback: s }
    }) : [],
    presentation: {
      style: plot.style || 'line',
      color: resolveRef(def, plot.color),
      width: resolveRef(def, plot.width),
      hidden: plot.hidden === true,
      ...(plot.marker ? { marker: { shape: plot.marker.shape, position: plot.marker.position } } : {}),
      // ⭐ P3 — only when the plot says so, so every other view is unchanged.
      ...(typeof plot.lineStyle === 'string' ? { lineStyle: plot.lineStyle } : {}),
      ...(fillRule ? { fill: fillRule } : {}),
      // ⭐ PHASE 5 — the per-bar colour rule, only when the plot has one.
      ...(colorRule ? { colorRule } : {}),
      paints,
    },
    lanes: {
      chart: laneWord(chartVerdict),
      signal: laneWord(evaluability(def, o.key, LANES.SIGNAL, gateCtx)),
      alert: laneWord(signalAlertGate(def, o.key, gateCtx)),
      'info-value': laneWord(evaluability(def, o.key, LANES.INFO_VALUE, gateCtx)),
    },
  }
}

const CAPABILITIES = Object.freeze({
  contract: PATCH_CONTRACT,
  ops: OP_NAMES,
  markerShapes: MARKER_SHAPES,
  markerPositions: MARKER_POSITIONS,
  paintChannels: ['barcolor', 'bgcolor'],
  styles: ['line', 'stepline', 'histogram', 'area', 'baseline'],
  // ⭐ P3 — set_style.lineStyle, set_levels, set_fill / remove_fill.
  lineStyles: PLOT_LINE_STYLES,
  maxLevels: PATCH_LIMITS.maxLevels,
  triggerPolicies: Object.values(TRIGGER_POLICIES),
  // ⭐ PHASE 5 — cross-context and expressive outputs.
  numericAlertConditions: NUMERIC_CONDITIONS,
  colorRules: COLOR_RULES,
  scopeTimeframes: CROSS.tfCodes,
  calculationTimeframes: CROSS.calculationTimeframes,
  maxOtherSymbols: CROSS.maxOtherSymbols,
  // ⭐ OVERNIGHT D — set_table / remove_table.
  tablePositions: TABLE_POSITIONS,
  tableFormats: Object.keys(TABLE_FORMATS),
  infoValueFormats: INFO_VALUE_FORMATS,
  maxOutputs: PATCH_LIMITS.maxOutputs,
  maxOpsPerPatch: PATCH_LIMITS.maxOps,
})

/** ⭐ P3 — the definition's horizontal levels (its one `hlines` guide), only when it has any. */
function levelsView(def) {
  const guide = (def.plots || []).find((p) => p && p.style === 'hlines' && Array.isArray(p.levels))
  return guide && guide.levels.length ? { levels: [...guide.levels] } : {}
}

/**
 * @param {object|null} def the working definition
 * @param {object} [state] authoring state (revision, intent, requests, assumptions, questions)
 * @param {object} [gateCtx]
 */
export function compactView(def, state = {}, gateCtx = {}) {
  const base = {
    contract: VIEW_CONTRACT,
    revision: Number.isInteger(state.revision) ? state.revision : 0,
    empty: !def,
    definition: null,
    intent: state.intent || null,
    requests: {
      alerts: ((state.requests && state.requests.alerts) || []).map((a) => (typeof a.condition === 'string'
        ? { plotKey: a.plotKey, condition: a.condition, threshold: a.threshold }
        : { plotKey: a.plotKey, triggerPolicy: a.triggerPolicy })),
      infoValues: ((state.requests && state.requests.infoValues) || []).map((a) => ({ plotKey: a.plotKey, format: a.format })),
      ...(state.requests && typeof state.requests.calculationTimeframe === 'string'
        ? { calculationTimeframe: state.requests.calculationTimeframe } : {}),
    },
    assumptions: (state.assumptions || []).map((a) => (a.label !== undefined
      ? { output: a.output, label: a.label, value: a.value }
      : { output: a.output || null, text: untrusted(a.text) })),
    openQuestions: (state.questions || []).map((q) => ({ id: q.id, text: untrusted(q.text) })),
    capabilities: CAPABILITIES,
    truncated: false,
  }
  if (!def) return base
  const scope = declaredInputs(def)
  const all = outputsOf(def)
  const rb = intentReadback(def, INTENTS.PLOT, { ctx: gateCtx })
  const chartOf = new Map(rb.outputs.map((o) => [o.key, o.verdict]))
  const primary = (def.compute && def.compute.scanPlot) || (all[0] && all[0].key) || null
  const helpers = helpersOfDefinition(def)
  const shown = all.slice(0, VIEW_MAX_OUTPUTS)
  const chrome = new Set((def.plots || []).flatMap((p) => [p.color, p.width])
    .filter((v) => typeof v === 'string' && v.startsWith('$')).map((v) => v.slice(1)))
  const view = {
    ...base,
    definition: {
      name: untrusted(def.meta && def.meta.name),
      kind: def.compute && def.compute.kind,
      placement: def.placement && def.placement.target === 'price' ? 'price' : 'pane',
      ...levelsView(def),
      // ⭐ OVERNIGHT D — the chart table, as the spec set_table takes (or "imported").
      ...(def.objects ? { table: (() => { const t = tableSpecOfDefinition(def); return t === 'imported' ? { imported: true } : t })() } : {}),
      primary,
      outputs: shown.map((o) => outputView(def, o, scope, gateCtx, chartOf.get(o.key), primary, helpers)),
      ...(all.length > shown.length ? { omittedOutputs: all.length - shown.length } : {}),
      memberInputs: (def.inputs || []).filter((s) => s && !chrome.has(s.key))
        .map((s) => ({ key: s.key, type: s.type, default: s.default, label: untrusted(s.label || s.key) })),
    },
    truncated: all.length > shown.length,
  }
  // ⛔ SIZE BOUND, deterministic: drop trees, then read-backs, then clauses.
  if (JSON.stringify(view).length > VIEW_MAX_CHARS) {
    view.truncated = true
    for (const o of view.definition.outputs) delete o.tree
    if (JSON.stringify(view).length > VIEW_MAX_CHARS) for (const o of view.definition.outputs) delete o.readback
    if (JSON.stringify(view).length > VIEW_MAX_CHARS) for (const o of view.definition.outputs) if (o.clauses) o.clauses = []
  }
  return view
}
