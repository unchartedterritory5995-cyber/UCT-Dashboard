// app/src/components/chart/builder/authoring/applyPatch.js
//
// ─── ⭐⭐ P2 — APPLY ONE CONVERSATIONAL PATCH: DETERMINISTIC, ATOMIC, PURE ────
//
// USER LANGUAGE → MODEL → STRUCTURED PATCH → **THIS** → CANONICAL DEFINITION.
//
// The model does not own the indicator; the canonical definition does. This
// function takes the current definition and the model's patch and either
// returns a NEW definition — built by `buildDefinition`, the Builder's one
// document function, over the Builder's own row model (`model.js`) — or refuses
// the WHOLE patch and returns the input object untouched.
//
// Every op is validated: the patch's shape (`patchSchema.json`), that its target
// exists, that every tree is canonical and round-trips through the printer and
// the Builder's own gate (`evaluateFormula`), the type of every output
// (`outputTypeOf` — a request for SIGNAL on a number is refused, never
// coerced), the shared gate per consumer (`evaluability`), the presentation
// primitives (`authoringIntent.presentationVerdict`, `defSchema` through
// `validateUserDefinitions`), budget (the same two doors) and the imported
// parameter controls (`reconcileParams`).
//
// ⛔ NOTHING HERE CALLS A MODEL. ⛔ NOTHING HERE WRITES `meta.semantics`.
// ⛔ PROSE (`note`, `*.text`) NEVER REACHES THE DEFINITION.

import { namingSnapshot, applyDerivedNaming } from './derivedName'
import { validatePatchShape, opIndexOf, PATCH_LIMITS } from './patchValidate'
import {
  modelOf, buildFromModel, fidelityPlan, graftCarried, orderLike, evaluateRowSource, AuthoringError, LEVELS_PLOT_KEY,
} from './model'
import {
  parseSlotId, nodeAt, replaceAt, slotsOfTree, clausesOfTree, parameterSlots, barFields,
} from './slots'
import { draftDefId } from '../BuilderSheet'
import { BUILDER_INPUTS, chromeInputsFor } from '../builderInputs'
import {
  INTENTS, intentReadback, markerRequestProblem, presentationVerdict, signalPaintsFor, NO_PAINT,
  SIGNAL_MARKER_DEFAULT,
} from '../authoringIntent'
import { printFormula } from '../../engine/ast/pine'
import { assertCanonical, astHash } from '../../engine/ast/parse'
import { declaredInputs } from '../../engine/ast/lint'
import { outputTypeOf, outputsOf, treeOutputType, OUTPUT_TYPES } from '../../engine/outputType'
import { evaluability, LANES, STATUS } from '../../engine/evaluability'
import { signalAlertGate, numericAlertGate, NUMERIC_CONDITIONS } from '../../engine/triggerPolicy'
import { infoValueOutputExists } from '../../engine/infoValueResolve'
import { validateUserDefinitions } from '../../engine/nativeRegistry'
import { reconcileParams, ATTACHED } from '../paramEdit'
import { symTickersOf, storeTickerOf } from '../../engine/otherSymbols'
import { calcTimeframeCapability } from '../../engine/calcTimeframeCapability'
import { frameRelation } from '../../engine/instanceTimeframe'
import CROSS from './crossContext.json'
import { COLOR_HELPER_SUFFIX, FILL_HELPER_SUFFIX, risingTree, aboveTree, sameTree } from './colorRules'

/** The node types a patch tree may use — the concierge's ADVERTISED union plus
 *  PHASE 5's three scope wrappers (`sym`, `tf`, `tf_live`; bounds in
 *  `crossContext.json`). ⛔ textop / str / symtext / ltf stay out. */
export const PATCH_NODE_TYPES = Object.freeze(['num', 'series', 'op', 'call', 'offset', 'sym', 'tf', 'tf_live'])

/** ⭐ PHASE 5 — the cross-context bounds, shared with the server (`crossContext.json`). */
export const CROSS_CONTEXT = Object.freeze({
  tickerRe: new RegExp(CROSS.tickerPattern),
  maxOtherSymbols: CROSS.maxOtherSymbols,
  ambiguous: Object.freeze(new Set(CROSS.ambiguousBare)),
  tfCodes: Object.freeze([...CROSS.tfCodes]),
  tfLiveCodes: Object.freeze([...CROSS.tfLiveCodes]),
  calculationTimeframes: Object.freeze([...CROSS.calculationTimeframes]),
})

export { COLOR_HELPER_SUFFIX, FILL_HELPER_SUFFIX, risingTree, aboveTree }

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const err = (code, message, extra) => new AuthoringError(code, message, extra)

export const EMPTY_REQUESTS = Object.freeze({ alerts: Object.freeze([]), infoValues: Object.freeze([]) })
/** ⭐ PHASE 5 — an alert request is a yes/no POLICY or a numeric CONDITION + threshold. */
const normAlert = (a) => (a && typeof a.condition === 'string'
  ? { plotKey: a.plotKey, condition: a.condition, threshold: a.threshold }
  : { plotKey: a.plotKey, triggerPolicy: a.triggerPolicy })
const normRequests = (r) => ({
  alerts: Array.isArray(r && r.alerts) ? r.alerts.map(normAlert) : [],
  infoValues: Array.isArray(r && r.infoValues) ? r.infoValues.map((a) => ({ plotKey: a.plotKey, format: a.format })) : [],
  // ⭐ PHASE 5 — the WHOLE indicator's calculation timeframe, applied to its instance
  // at save. Absent = the chart's own (and every request stored before stays identical).
  ...(r && typeof r.calculationTimeframe === 'string' ? { calculationTimeframe: r.calculationTimeframe } : {}),
})

/** The scope a new tree is read under: the chrome inputs of the rows plus the
 *  member's own inputs — the same declared scope a Builder save would carry. */
function scopeOf(model) {
  return declaredInputs({ inputs: [...chromeInputsFor(model.rows), ...model.memberInputs] })
}

/**
 * ⭐ THE TREE GATE. Canonical → advertised node types → printed → the Builder's
 * own `evaluateFormula` (parse, lint, budget, read-back, probe interpret) → the
 * reparse is the SAME tree (`astHash`) → not `repaints`.
 * @returns {{source, ast, mode, readback, dialect}}
 */
export function gateTree(tree, scope, key) {
  try { assertCanonical(tree) } catch (e) {
    throw err('tree:not-canonical', `${key}: the tree is not a canonical formula node (${e.message})`, { output: key })
  }
  const stack = [tree]
  while (stack.length) {
    const n = stack.pop()
    if (!PATCH_NODE_TYPES.includes(n.type)) {
      throw err('tree:unsupported-node', `${key}: a "${n.type}" node cannot be authored by conversation yet.`, { output: key })
    }
    // ⭐ PHASE 5 — THE SCOPE WRAPPERS' BOUNDS (the server's `_check_scopes`, same file).
    if (n.type === 'sym') {
      const t = typeof n.value === 'string' ? n.value : ''
      if (!CROSS_CONTEXT.tickerRe.test(t)) {
        throw err('tree:symbol-spelling', `${key}: "${String(n.value)}" is not a ticker UCT can load.`, { output: key })
      }
      if (CROSS_CONTEXT.ambiguous.has(t)) {
        throw err('tree:symbol-ambiguous', `${key}: ${t} also names a market index or commodity outside UCT's bar store, so which instrument it means can't be settled.`, { output: key })
      }
    }
    if (n.type === 'tf' && !CROSS_CONTEXT.tfCodes.includes(n.value)) {
      throw err('tree:timeframe', `${key}: a formula can read the weekly or monthly timeframe inside it, not "${String(n.value)}".`, { output: key })
    }
    if (n.type === 'tf_live' && !CROSS_CONTEXT.tfLiveCodes.includes(n.value)) {
      throw err('tree:timeframe', `${key}: a forming-period read names the weekly or monthly timeframe only, not "${String(n.value)}".`, { output: key })
    }
    if (Array.isArray(n.args)) stack.push(...n.args)
  }
  let text
  try { text = printFormula(tree) } catch (e) {
    throw err('tree:unprintable', `${key}: the tree cannot be written as a formula (${e.message})`, { output: key })
  }
  const ev = evaluateRowSource(text, scope, key)
  if (astHash(ev.ast) !== astHash(tree)) {
    throw err('tree:round-trip', `${key}: the formula does not read back as the same tree.`, { output: key })
  }
  if (ev.verdict.mode === 'repaints') {
    throw err('tree:repaints', `${key}: this formula reads future bars and would repaint; it cannot be saved.`, { output: key })
  }
  return { source: ev.source, ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback, dialect: 'native' }
}

function rowOf(st, key) {
  const row = st.model && st.model.rows.find((r) => r.key === key)
  if (!row) throw err('output:unknown', `There is no output "${key}".`, { output: key })
  return row
}

function setTree(st, row, tree, i, kind) {
  const g = gateTree(tree, scopeOf(st.model), row.key)
  if (row.dialect && row.dialect !== 'native') {
    st.changes.push({ op: i, kind: 'foreign-source-replaced', output: row.key, dialect: row.dialect,
      text: `The ${row.dialect} text of "${row.key}" is replaced by the edited formula; the edit is authoritative.` })
    st.replacedForeign[row.key] = { dialect: row.dialect, text: row.source }
  }
  const from = row.source
  const before = row.ast
  Object.assign(row, g)
  st.touched.add(row.key)
  st.changes.push({ op: i, kind, output: row.key, from, to: g.source })
  syncHelpers(st, row, before)
}

// ─── ⭐ PHASE 5 — colour-rule / cloud helpers ─────────────────────────────────
//
// A RISING rule and an ABOVE/BELOW cloud read a hidden 0/1 column the Builder's
// own way (`colorMode: 'column:<key>'`, `value_c`). Its tree is DERIVED from the
// output(s) it colours, so when one of those trees changes the helper is re-derived
// in the same patch: an EMA 20 → 50 edit keeps "green while rising" about the 50.
// A helper is recognised STRUCTURALLY (its tree is exactly the derivation of its
// owner's), never by a flag, so an imported or hand-edited column is never rewritten.

const helperRow = (m, key) => (m && m.rows.find((r) => r.key === key)) || null

/** Is `row` a helper this door derived (for an owner row of the model)? → owner | null. */
export function helperOwner(m, row) {
  if (!m || !row || row.hidden !== true || !row.ast) return null
  for (const o of m.rows) {
    if (o === row || !o.ast) continue
    if (o.colorMode === `column:${row.key}` && row.key === `${o.key}${COLOR_HELPER_SUFFIX}`
      && sameTree(row.ast, risingTree(o.ast))) return { owner: o, kind: 'rising' }
    if (o.fill && o.fill.colorMode === `column:${row.key}` && row.key === `${o.key}${FILL_HELPER_SUFFIX}`) {
      const w = helperRow(m, o.fill.with)
      if (w && w.ast && sameTree(row.ast, aboveTree(o.ast, w.ast))) return { owner: o, kind: 'cloud' }
    }
  }
  return null
}

function regate(st, row, tree) {
  Object.assign(row, gateTree(tree, scopeOf(st.model), row.key))
  st.touched.add(row.key)
}

/** After `row`'s tree moved from `before`, re-derive every helper derived from it. */
function syncHelpers(st, row, before) {
  const m = st.model
  if (!m || !before) return
  const own = helperRow(m, `${row.key}${COLOR_HELPER_SUFFIX}`)
  if (own && own !== row && row.colorMode === `column:${own.key}` && sameTree(own.ast, risingTree(before))) {
    regate(st, own, risingTree(row.ast))
  }
  for (const o of m.rows) {
    if (!o.fill || o.fill.colorMode !== `column:${o.key}${FILL_HELPER_SUFFIX}`) continue
    const h = helperRow(m, `${o.key}${FILL_HELPER_SUFFIX}`)
    const w = helperRow(m, o.fill.with)
    if (!h || !w || h === row) continue
    if (o === row && sameTree(h.ast, aboveTree(before, w.ast))) regate(st, h, aboveTree(row.ast, w.ast))
    else if (w === row && sameTree(h.ast, aboveTree(o.ast, before))) regate(st, h, aboveTree(o.ast, row.ast))
  }
}

/** Is any row / paint / request still reading column `key` (other than `except`)? */
function columnInUse(st, key, except) {
  const m = st.model
  const col = `column:${key}`
  if (m.scanKey === key) return true
  if (m.rows.some((r) => r !== except && (r.colorMode === col || (r.fill && (r.fill.with === key || r.fill.colorMode === col))))) return true
  if ((m.paints || []).some((p) => p && p.colorMode === col)) return true
  return st.requests.alerts.some((a) => a.plotKey === key) || st.requests.infoValues.some((a) => a.plotKey === key)
}

/** Drop a helper column nothing reads any more (only one this door derives). */
function dropHelper(st, key, i) {
  const m = st.model
  const h = helperRow(m, key)
  if (!h || h.hidden !== true || columnInUse(st, key, null)) return
  if (!key.endsWith(COLOR_HELPER_SUFFIX) && !key.endsWith(FILL_HELPER_SUFFIX)) return
  m.rows = m.rows.filter((r) => r !== h)
  st.touched.delete(key)
  st.removed.add(key)
  st.changes.push({ op: i, kind: 'helper-removed', output: key })
}

/** Add (or re-derive) the hidden helper `key` with `tree`. */
function putHelper(st, key, tree, owner, i) {
  const m = st.model
  const existing = helperRow(m, key)
  if (existing && !helperOwner(m, existing) && !(existing.hidden === true && !columnInUse(st, key, owner))) {
    throw err('color:key-taken', `An output "${key}" already exists, so the colour rule's helper cannot use that name.`, { output: owner.key })
  }
  if (!existing) {
    if (m.rows.length >= PATCH_LIMITS.maxOutputs) throw err('output:limit', `At most ${PATCH_LIMITS.maxOutputs} outputs (a colour rule needs one hidden column).`)
    m.rows.push(newRow(key, `${owner.key} colour rule`, true))
    st.changes.push({ op: i, kind: 'helper-added', output: key, of: owner.key })
  }
  regate(st, helperRow(m, key), tree)
}

/** The colour rule a row carries, in the conversation's words — or `foreign`. */
export function colorRuleOf(m, row) {
  if (!row || !row.colorMode) return { rule: 'none' }
  if (row.colorMode === 'sign' && row.colorUp && row.colorDown) return { rule: 'sign', up: row.colorUp, down: row.colorDown }
  if (String(row.colorMode).startsWith('column:') && row.colorUp && row.colorDown
    && !row.colorPalette && !row.colorGradient && !row.colorPacked) {
    const key = row.colorMode.slice('column:'.length)
    const h = helperRow(m, key)
    if (h) {
      const owned = helperOwner(m, h)
      if (owned && owned.owner === row && owned.kind === 'rising') return { rule: 'rising', up: row.colorUp, down: row.colorDown }
      return { rule: 'condition', when: key, up: row.colorUp, down: row.colorDown }
    }
  }
  return { rule: 'foreign' }
}

/** The cloud a row's fill carries — `plain`, `above` (helper), `condition`, or `foreign`. */
export function fillRuleOf(m, row) {
  const f = row && row.fill
  if (!f || typeof f.with !== 'string') return null
  const keys = Object.keys(f)
  if (keys.length === 1) return { rule: 'plain', with: f.with }
  if (keys.every((k) => ['with', 'colorMode', 'colorUp', 'colorDown'].includes(k))
    && String(f.colorMode || '').startsWith('column:') && f.colorUp && f.colorDown) {
    const key = f.colorMode.slice('column:'.length)
    const h = helperRow(m, key)
    if (h) {
      const owned = helperOwner(m, h)
      if (owned && owned.owner === row && owned.kind === 'cloud') return { rule: 'above', with: f.with, colorAbove: f.colorUp, colorBelow: f.colorDown }
      return { rule: 'condition', with: f.with, when: key, colorAbove: f.colorUp, colorBelow: f.colorDown }
    }
  }
  return { rule: 'foreign', with: f.with }
}

/** ⭐ P3 — the styles drawn as a LINE, so a line style is something they show
 *  (`pool`: a histogram has no line style, a markers plot has `lineWidth: 0`). */
export const LINE_DRAWN_STYLES = Object.freeze(['line', 'stepline', 'area', 'baseline'])

/** ⭐ P3 / PHASE 5 — a fill the conversation may replace or remove: the plain band
 *  `set_fill` writes, or a TWO-COLOUR conditional band over a column of this
 *  document (an import's included — first-class editable since Phase 5). A
 *  palette band stays the import's: not this door's to overwrite. */
const editableFill = (m, row) => { const r = fillRuleOf(m, row); return !!r && r.rule !== 'foreign' }

const ownPaintOf = (paints, key, channel) => (paints || []).findIndex((p) => p && p.kind === channel
  && p.colorMode === `column:${key}` && p.colorDown === NO_PAINT && typeof p.colorUp === 'string')

const newRow = (key, label, hidden) => ({
  key, label: label || '', style: 'line', color: BUILDER_INPUTS[0].default, width: BUILDER_INPUTS[1].default,
  hidden: hidden === true,
})

// ─── the op handlers ──────────────────────────────────────────────────────────

const OPS = {
  create(st, op, i) {
    if (st.model) throw err('create:exists', 'A definition is already being edited; change it instead of creating a new one.')
    const keys = op.outputs.map((o, j) => o.key || (j === 0 ? 'value' : null))
    if (keys.some((k) => !k)) throw err('create:key-required', 'Every output after the first needs a key.')
    if (new Set(keys).size !== keys.length) throw err('output:duplicate', 'Two outputs share one key.')
    if (keys.includes(LEVELS_PLOT_KEY)) throw err('output:reserved', `"${LEVELS_PLOT_KEY}" is reserved.`)
    if (op.primary && !keys.includes(op.primary)) throw err('output:unknown', `There is no output "${op.primary}".`)
    st.model = {
      defId: st.ctx.defId || draftDefId(), version: 1, rev: 1, name: op.name.trim(),
      rows: op.outputs.map((o, j) => newRow(keys[j], o.label, o.hidden)),
      scanKey: op.primary || keys[0],
      placement: op.placement === 'price' ? { target: 'price' } : null,
      levels: null, paints: null, objects: null, paramManifest: null, memberInputs: [],
      carried: { compute: {}, meta: {} },
    }
    const scope = scopeOf(st.model)
    op.outputs.forEach((o, j) => {
      Object.assign(st.model.rows[j], gateTree(o.tree, scope, keys[j]))
      st.touched.add(keys[j])
    })
    st.created = true
    st.changes.push({ op: i, kind: 'created', outputs: keys, name: st.model.name })
  },

  rename_definition(st, op, i) {
    if (!st.model) throw err('definition:none', 'There is no definition yet.')
    const from = st.model.name
    st.model.name = op.name.trim()
    st.renamedDefinition = true       // ⭐ an explicit name is CUSTOM (derivedName.js)
    st.changes.push({ op: i, kind: 'renamed', from, to: st.model.name })
  },

  add_output(st, op, i) {
    if (!st.model) throw err('definition:none', 'There is no definition yet.')
    if (st.model.rows.some((r) => r.key === op.key)) throw err('output:duplicate', `An output "${op.key}" already exists.`)
    if (op.key === LEVELS_PLOT_KEY) throw err('output:reserved', `"${LEVELS_PLOT_KEY}" is reserved.`)
    if (st.model.rows.length >= PATCH_LIMITS.maxOutputs) throw err('output:limit', `At most ${PATCH_LIMITS.maxOutputs} outputs.`)
    const row = newRow(op.key, op.label, op.hidden)
    st.model.rows.push(row)
    Object.assign(row, gateTree(op.tree, scopeOf(st.model), op.key))
    st.touched.add(op.key)
    st.changes.push({ op: i, kind: 'output-added', output: op.key, to: row.source })
  },

  remove_output(st, op, i) {
    const row = rowOf(st, op.output)
    const m = st.model
    if (m.rows.length === 1) throw err('output:last', 'A definition needs at least one output.')
    const col = `column:${row.key}`
    if (helperOwner(m, row)) {
      throw err('output:helper', `"${row.key}" is the hidden column of a colour rule; change or remove that rule instead.`, { output: row.key })
    }
    // ⭐ PHASE 5 — the helpers DERIVED from this output go with it (a rule / cloud of
    // its own); a band another output draws TO it still refuses below.
    const ownHelpers = [`${row.key}${COLOR_HELPER_SUFFIX}`, `${row.key}${FILL_HELPER_SUFFIX}`]
      .map((k) => helperRow(m, k)).filter((h) => h && helperOwner(m, h) && helperOwner(m, h).owner === row)
    const users = m.rows.filter((r) => r !== row && !ownHelpers.includes(r) && (r.colorMode === col
      || (r.fill && (r.fill.with === row.key || r.fill.colorMode === col))))
    if (users.length) {
      throw err('output:referenced', `"${row.key}" colours or fills ${users.map((r) => `"${r.key}"`).join(', ')}; change that first.`)
    }
    const foreign = (m.paints || []).filter((p, j) => p && p.colorMode === col && j !== ownPaintOf(m.paints, row.key, p.kind))
    if (foreign.length) throw err('output:referenced', `An imported paint reads "${row.key}"; it cannot be removed here.`)
    m.rows = m.rows.filter((r) => r !== row && !ownHelpers.includes(r))
    for (const h of ownHelpers) { st.removed.add(h.key); st.touched.delete(h.key) }
    const kept = (m.paints || []).filter((p) => !(p && p.colorMode === col))
    if (m.paints && kept.length !== m.paints.length) {
      st.changes.push({ op: i, kind: 'paint-removed', output: row.key, text: `Its own candle/background colours went with it.` })
    }
    m.paints = kept.length ? kept : null
    if (m.scanKey === row.key) m.scanKey = m.rows[0].key
    if (st.intent && st.intent.output === row.key) {
      st.intent = null
      st.changes.push({ op: i, kind: 'intent-cleared', output: row.key })
    }
    const before = st.requests.alerts.length + st.requests.infoValues.length
    st.requests.alerts = st.requests.alerts.filter((a) => a.plotKey !== row.key)
    st.requests.infoValues = st.requests.infoValues.filter((a) => a.plotKey !== row.key)
    if (st.requests.alerts.length + st.requests.infoValues.length !== before) {
      st.changes.push({ op: i, kind: 'requests-cleared', output: row.key })
    }
    st.removed.add(row.key)
    st.changes.push({ op: i, kind: 'output-removed', output: row.key })
  },

  rename_output(st, op, i) {
    const row = rowOf(st, op.output)
    const from = row.label
    row.label = op.label.trim()
    st.renamedOutputs.add(row.key)    // ⭐ an explicit label is CUSTOM (derivedName.js)
    st.changes.push({ op: i, kind: 'output-renamed', output: row.key, from, to: row.label })
  },

  set_output_tree(st, op, i) {
    setTree(st, rowOf(st, op.output), op.tree, i, 'tree-replaced')
  },

  set_slot(st, op, i) {
    const id = parseSlotId(op.slot)
    if (!id) throw err('slot:unknown', `"${op.slot}" is not a slot id.`)
    const row = rowOf(st, id.output)
    const slot = slotsOfTree(row.key, row.ast).find((s) => s.id === op.slot)
    if (!slot) throw err('slot:unknown', `"${op.slot}" names no parameter of "${row.key}".`, { output: row.key })
    let next
    if (slot.kind === 'symbol' || slot.kind === 'timeframe') {
      // ⭐ PHASE 5 — the wrapper's own field: SPY → QQQ, weekly → monthly.
      const want = slot.kind === 'symbol' ? op.symbol : op.timeframe
      if (want === undefined) {
        throw err('slot:kind', `"${op.slot}" is ${slot.kind === 'symbol' ? 'a symbol; give it a symbol' : 'a timeframe; give it a timeframe'}.`)
      }
      next = { ...nodeAt(row.ast, id.segs), value: want }
      const fromValue = slot.value
      setTree(st, row, replaceAt(row.ast, id.segs, next), i, 'slot-set')
      st.changes[st.changes.length - 1] = { ...st.changes[st.changes.length - 1], slot: op.slot,
        label: slot.label, fromValue, toValue: want }
      return
    }
    if (op.symbol !== undefined || op.timeframe !== undefined) {
      throw err('slot:kind', `"${op.slot}" is ${slot.kind === 'number' ? 'a number' : 'a price field'}, not a symbol or timeframe.`)
    }
    if (slot.kind === 'number') {
      if (op.value === undefined) throw err('slot:kind', `"${op.slot}" is a number; give it a value.`)
      if ((slot.window || slot.role === 'bars-ago') && (!Number.isInteger(op.value) || op.value < 1)) {
        throw err('slot:window', `${slot.label} must be a whole number of at least 1.`)
      }
      next = id.segs[id.segs.length - 1] === 'n' ? op.value : { ...nodeAt(row.ast, id.segs), value: op.value }
    } else {
      if (op.series === undefined) throw err('slot:kind', `"${op.slot}" reads a price field; give it a series.`)
      if (!barFields().includes(op.series)) throw err('slot:series', `"${op.series}" is not a price field.`)
      next = { ...nodeAt(row.ast, id.segs), name: op.series }
    }
    const fromValue = slot.value
    setTree(st, row, replaceAt(row.ast, id.segs, next), i, 'slot-set')
    st.changes[st.changes.length - 1] = { ...st.changes[st.changes.length - 1], slot: op.slot,
      label: slot.label, fromValue, toValue: slot.kind === 'number' ? op.value : op.series }
  },

  add_clause(st, op, i) {
    const row = rowOf(st, op.output)
    if (treeOutputType(row.ast).yields !== 'bool') {
      throw err('clause:numeric-operand', `"${row.key}" is a number, not a yes/no; compare it to something before adding a condition.`, { output: row.key })
    }
    const g = gateTree(op.tree, scopeOf(st.model), row.key)
    if (treeOutputType(g.ast).yields !== 'bool') {
      throw err('clause:numeric-operand', 'The added clause is a number, not a yes/no; compare it to something.', { output: row.key })
    }
    const joined = { type: 'op', name: op.join === 'and' ? '&&' : '||', args: [row.ast, g.ast] }
    setTree(st, row, joined, i, 'clause-added')
  },

  remove_clause(st, op, i) {
    const id = parseSlotId(op.clause)
    if (!id) throw err('clause:unknown', `"${op.clause}" is not a clause id.`)
    const row = rowOf(st, id.output)
    const clause = clausesOfTree(row.key, row.ast).find((c) => c.id === op.clause)
    if (!clause) throw err('clause:unknown', `"${op.clause}" names no clause of "${row.key}".`, { output: row.key })
    const parentSegs = id.segs.slice(0, -1)
    const parent = nodeAt(row.ast, parentSegs)
    const sibling = parent.args[1 - id.segs[id.segs.length - 1]]
    setTree(st, row, replaceAt(row.ast, parentSegs, sibling), i, 'clause-removed')
  },

  set_intent(st, op, i) {
    if (!st.model) throw err('definition:none', 'There is no definition yet.')
    if (op.output) rowOf(st, op.output)
    st.intent = { intent: op.intent, output: op.intent === INTENTS.PLOT ? null : (op.output || null) }
    st.intentTouched = true
    st.changes.push({ op: i, kind: 'intent-set', intent: op.intent, output: st.intent.output })
  },

  set_placement(st, op, i) {
    if (!st.model) throw err('definition:none', 'There is no definition yet.')
    const was = st.model.placement && st.model.placement.target === 'price' ? 'price' : 'pane'
    if (was === op.target) { st.changes.push({ op: i, kind: 'unchanged', what: 'placement' }); return }
    st.model.placement = op.target === 'price' ? { target: 'price' } : null
    st.changes.push({ op: i, kind: 'placement-set', from: was, to: op.target })
  },

  set_style(st, op, i) {
    const row = rowOf(st, op.output)
    if (op.style !== undefined && row.marker) {
      throw err('style:has-marker', `"${row.key}" is drawn as markers; remove the marker before changing its line style.`, { output: row.key })
    }
    if (op.lineStyle !== undefined) {
      const drawn = op.style !== undefined ? op.style : row.style
      if (!LINE_DRAWN_STYLES.includes(drawn)) {
        throw err('style:line-style-inert', `"${row.key}" is drawn as ${drawn === 'markers' ? 'markers' : `a ${drawn}`}, which has no line to make ${op.lineStyle}.`, { output: row.key })
      }
    }
    const look = () => ({ color: row.color, width: row.width, style: row.style, hidden: row.hidden,
      lineStyle: row.lineStyle || 'solid' })
    const from = look()
    for (const f of ['color', 'width', 'style', 'hidden']) if (op[f] !== undefined) row[f] = op[f]
    if (op.hidden !== undefined) st.hiddenSet.add(row.key)
    // ⭐ P3 — solid is the default and is written as NO field, so an undashed
    // plot stays byte-identical to one that never had a line style.
    if (op.lineStyle === 'solid') delete row.lineStyle
    else if (op.lineStyle !== undefined) row.lineStyle = op.lineStyle
    st.touched.add(row.key)
    st.changes.push({ op: i, kind: 'style-set', output: row.key, from, to: look() })
  },

  set_marker(st, op, i) {
    const row = rowOf(st, op.output)
    const marker = { shape: op.shape, position: op.position || SIGNAL_MARKER_DEFAULT.position,
      ...(op.text ? { text: op.text } : {}) }
    const problem = markerRequestProblem(marker)
    if (problem) throw err('marker:unrepresentable', problem, { output: row.key })
    if (!op.position) {
      st.engineAssumptions.push({ output: row.key, source: 'engine',
        text: `marker position was not given; it is drawn ${marker.position === 'belowBar' ? 'below the bar' : marker.position}` })
    }
    const from = row.marker || null
    row.style = 'markers'
    row.marker = marker
    // ⭐ P3S — markers are a request to DRAW: an output hidden (by the member, or by
    // `hidePaintedConditionLines`) would otherwise draw nothing at all.
    if (row.hidden === true) {
      row.hidden = false
      st.changes.push({ op: i, kind: 'line-shown', output: row.key, reason: 'marker' })
    }
    st.touched.add(row.key)
    st.changes.push({ op: i, kind: 'marker-set', output: row.key, from, to: marker })
  },

  remove_marker(st, op, i) {
    const row = rowOf(st, op.output)
    if (!row.marker) throw err('marker:none', `"${row.key}" has no marker.`, { output: row.key })
    const from = row.marker
    delete row.marker
    row.style = 'line'
    st.touched.add(row.key)
    st.changes.push({ op: i, kind: 'marker-removed', output: row.key, from })
  },

  set_paint(st, op, i) {
    const row = rowOf(st, op.output)
    const m = st.model
    const paints = m.paints ? m.paints.slice() : []
    const at = ownPaintOf(paints, row.key, op.channel)
    const foreign = paints.some((p, j) => j !== at && p && p.kind === op.channel && p.colorMode === `column:${row.key}`)
    if (foreign) throw err('paint:foreign', `An imported ${op.channel} paint already reads "${row.key}"; it is not overwritten.`, { output: row.key })
    const [paint] = signalPaintsFor(row.key, { [op.channel]: op.color })
    const from = at >= 0 ? paints[at].colorUp : null
    if (at >= 0) paints[at] = paint
    else { paints.push(paint); st.newPaints.add(row.key) }
    m.paints = paints
    st.touched.add(row.key)
    st.changes.push({ op: i, kind: 'paint-set', output: row.key, channel: op.channel, from, to: op.color })
  },

  remove_paint(st, op, i) {
    const row = rowOf(st, op.output)
    const m = st.model
    const at = ownPaintOf(m.paints, row.key, op.channel)
    if (at < 0) throw err('paint:none', `"${row.key}" has no ${op.channel} colour to remove.`, { output: row.key })
    const from = m.paints[at].colorUp
    const kept = m.paints.filter((_, j) => j !== at)
    m.paints = kept.length ? kept : null
    st.changes.push({ op: i, kind: 'paint-removed', output: row.key, channel: op.channel, from })
  },

  // ─── ⭐ P3 — levels and fills: presentation the Builder already writes ────

  set_levels(st, op, i) {
    if (!st.model) throw err('definition:none', 'There is no definition yet.')
    const values = op.values
    if (!values.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      throw err('levels:not-number', 'Levels are plain numbers.')
    }
    if (values.length > PATCH_LIMITS.maxLevels) throw err('levels:limit', `At most ${PATCH_LIMITS.maxLevels} levels.`)
    const from = st.model.levels && st.model.levels.length ? [...st.model.levels] : []
    // ⭐ THE BUILDER'S OWN SHAPE: the Levels box's list, in order; none = no guide.
    st.model.levels = values.length ? [...values] : null
    if (JSON.stringify(from) === JSON.stringify(values)) { st.changes.push({ op: i, kind: 'unchanged', what: 'levels' }); return }
    st.changes.push({ op: i, kind: values.length ? 'levels-set' : 'levels-removed', from, to: [...values] })
  },

  set_fill(st, op, i) {
    const m = st.model
    const row = rowOf(st, op.output)
    const other = rowOf(st, op.with)
    if (other === row) throw err('fill:self', `A fill between "${row.key}" and itself has no area.`, { output: row.key })
    if (row.fill && !editableFill(m, row)) {
      throw err('fill:foreign', `"${row.key}" already has an imported band with a colour palette; it is not overwritten.`, { output: row.key })
    }
    if (other.fill && other.fill.with === row.key) {
      throw err('fill:duplicate', `"${other.key}" is already shaded to "${row.key}".`, { output: row.key })
    }
    // ⭐ PHASE 5 — A CONDITIONAL CLOUD: both colours, or neither.
    const conditional = op.colorAbove !== undefined || op.colorBelow !== undefined || op.when !== undefined
    if (conditional && (op.colorAbove === undefined || op.colorBelow === undefined)) {
      throw err('fill:colours', 'A cloud that changes colour needs both colours: one where it is above (or true), one where below (or false).', { output: row.key })
    }
    if (conditional && op.color !== undefined) {
      throw err('fill:colours', 'A cloud that changes colour takes colorAbove and colorBelow, not one colour.', { output: row.key })
    }
    if (op.when !== undefined) {
      const w = rowOf(st, op.when)
      if (w === row || w === other) throw err('fill:when', `The cloud's condition must be a yes/no output other than its two edges.`, { output: row.key })
      if (treeOutputType(w.ast).type !== OUTPUT_TYPES.CONDITION) {
        throw err('fill:when', `"${w.key}" is a number, not a yes/no; a cloud's colour follows a yes/no output.`, { output: row.key })
      }
    }
    const rule = fillRuleOf(m, row)
    const from = row.fill ? { with: row.fill.with, color: row.fillColor || null, opacity: Number.isFinite(row.fillOpacity) ? row.fillOpacity : null,
      ...(rule && (rule.rule === 'above' || rule.rule === 'condition') ? { colorAbove: rule.colorAbove, colorBelow: rule.colorBelow, ...(rule.when ? { when: rule.when } : {}) } : {}) } : null
    const oldHelper = row.fill && row.fill.colorMode ? row.fill.colorMode.slice('column:'.length) : null
    row.fill = { with: other.key }
    delete row.fillColor
    delete row.fillOpacity
    if (op.color !== undefined) row.fillColor = op.color
    if (op.opacity !== undefined) row.fillOpacity = op.opacity
    if (conditional) {
      let key = op.when
      if (key === undefined) {
        key = `${row.key}${FILL_HELPER_SUFFIX}`
        putHelper(st, key, aboveTree(row.ast, other.ast), row, i)
      }
      row.fill = { with: other.key, colorMode: `column:${key}`, colorUp: op.colorAbove, colorDown: op.colorBelow }
    }
    if (oldHelper && oldHelper !== (row.fill.colorMode || '').slice('column:'.length)) dropHelper(st, oldHelper, i)
    st.touched.add(row.key)
    st.fills.add(row.key)
    st.changes.push({ op: i, kind: 'fill-set', output: row.key, from,
      to: { with: other.key, color: op.color || null, opacity: op.opacity !== undefined ? op.opacity : null,
        ...(conditional ? { colorAbove: op.colorAbove, colorBelow: op.colorBelow, ...(op.when ? { when: op.when } : {}) } : {}) } })
  },

  remove_fill(st, op, i) {
    const row = rowOf(st, op.output)
    if (!row.fill) throw err('fill:none', `"${row.key}" has no fill to remove.`, { output: row.key })
    if (!editableFill(st.model, row)) {
      throw err('fill:foreign', `"${row.key}" has an imported band with a colour palette; it is not removed here.`, { output: row.key })
    }
    const from = row.fill.with
    const oldHelper = row.fill.colorMode ? row.fill.colorMode.slice('column:'.length) : null
    delete row.fill
    delete row.fillColor
    delete row.fillOpacity
    if (oldHelper) dropHelper(st, oldHelper, i)
    st.touched.add(row.key)
    st.changes.push({ op: i, kind: 'fill-removed', output: row.key, from })
  },

  request_info_value(st, op, i) {
    rowOf(st, op.output)
    st.requests.infoValues = st.requests.infoValues.filter((r) => r.plotKey !== op.output)
    st.requests.infoValues.push({ plotKey: op.output, format: op.format })
    st.requested.add(`info:${op.output}`)
    st.changes.push({ op: i, kind: 'info-value-requested', output: op.output, format: op.format })
  },

  request_alert(st, op, i) {
    rowOf(st, op.output)
    if (op.condition !== undefined) {
      // ⭐ PHASE 5 — A NUMERIC ALERT on a number output: the existing alert
      // architecture's own conditions (`above` / `below` / `cross_above` / `cross_below`).
      if (!NUMERIC_CONDITIONS.includes(op.condition) || typeof op.threshold !== 'number' || !Number.isFinite(op.threshold)) {
        throw err('alert:numeric', 'A number alert needs above, below, cross above or cross below and a number to compare with.', { output: op.output })
      }
      if (!st.requests.alerts.some((r) => r.plotKey === op.output && r.condition === op.condition && r.threshold === op.threshold)) {
        st.requests.alerts.push({ plotKey: op.output, condition: op.condition, threshold: op.threshold })
      }
      st.requested.add(`alert:${op.output}`)
      st.changes.push({ op: i, kind: 'alert-requested', output: op.output, condition: op.condition, threshold: op.threshold })
      return
    }
    if (!st.requests.alerts.some((r) => r.plotKey === op.output && r.triggerPolicy === op.triggerPolicy)) {
      st.requests.alerts.push({ plotKey: op.output, triggerPolicy: op.triggerPolicy })
    }
    st.requested.add(`alert:${op.output}`)
    st.changes.push({ op: i, kind: 'alert-requested', output: op.output, triggerPolicy: op.triggerPolicy })
  },

  // ─── ⭐ PHASE 5 — per-bar colour and the whole-indicator timeframe ──────────

  set_color_rule(st, op, i) {
    const m = st.model
    const row = rowOf(st, op.output)
    if (helperOwner(m, row)) throw err('color:helper', `"${row.key}" is a hidden colour-rule column, not a line.`, { output: row.key })
    if (row.marker) throw err('color:marker', `"${row.key}" is drawn as markers; a per-bar colour rule needs a line or histogram.`, { output: row.key })
    if (treeOutputType(row.ast).type === OUTPUT_TYPES.CONDITION) {
      throw err('color:condition-output', `"${row.key}" is a yes/no; show it through candle or background colours, or a marker, instead.`, { output: row.key })
    }
    const was = colorRuleOf(m, row)
    if (was.rule === 'foreign') {
      throw err('color:foreign', `"${row.key}" carries an imported colour palette; it is not overwritten here.`, { output: row.key })
    }
    const needsColours = op.rule !== 'none'
    if (needsColours && (op.up === undefined || op.down === undefined)) {
      throw err('color:colours', 'A colour rule needs both colours: one for up (or true) and one for down (or false).', { output: row.key })
    }
    if (!needsColours && (op.up !== undefined || op.down !== undefined || op.when !== undefined)) {
      throw err('color:colours', 'Removing the colour rule takes no colours.', { output: row.key })
    }
    if (op.rule !== 'condition' && op.when !== undefined) {
      throw err('color:when', 'Only a condition rule names a yes/no output.', { output: row.key })
    }
    const oldKey = was.rule === 'rising' || was.rule === 'condition' ? row.colorMode.slice('column:'.length) : null
    delete row.colorMode
    delete row.colorUp
    delete row.colorDown
    if (op.rule === 'sign') {
      Object.assign(row, { colorMode: 'sign', colorUp: op.up, colorDown: op.down })
    } else if (op.rule === 'rising') {
      const key = `${row.key}${COLOR_HELPER_SUFFIX}`
      putHelper(st, key, risingTree(row.ast), row, i)
      Object.assign(row, { colorMode: `column:${key}`, colorUp: op.up, colorDown: op.down })
    } else if (op.rule === 'condition') {
      if (op.when === undefined) throw err('color:when', 'A condition colour rule names the yes/no output it follows.', { output: row.key })
      const w = rowOf(st, op.when)
      if (w === row) throw err('color:when', 'A line cannot be coloured by itself.', { output: row.key })
      if (treeOutputType(w.ast).type !== OUTPUT_TYPES.CONDITION) {
        throw err('color:when', `"${w.key}" is a number, not a yes/no; a condition colour follows a yes/no output.`, { output: row.key })
      }
      Object.assign(row, { colorMode: `column:${w.key}`, colorUp: op.up, colorDown: op.down })
    }
    if (oldKey && oldKey !== (row.colorMode || '').slice('column:'.length)) dropHelper(st, oldKey, i)
    st.touched.add(row.key)
    st.changes.push({ op: i, kind: op.rule === 'none' ? 'color-rule-removed' : 'color-rule-set', output: row.key,
      rule: op.rule, ...(needsColours ? { up: op.up, down: op.down } : {}), ...(op.when ? { when: op.when } : {}), from: was })
  },

  set_calculation_timeframe(st, op, i) {
    if (!st.model) throw err('definition:none', 'There is no definition yet.')
    const from = st.requests.calculationTimeframe || 'chart'
    if (op.timeframe === 'chart') delete st.requests.calculationTimeframe
    else st.requests.calculationTimeframe = op.timeframe
    st.calcTouched = true
    st.changes.push({ op: i, kind: from === op.timeframe ? 'unchanged' : 'calc-timeframe-set',
      ...(from === op.timeframe ? { what: 'calculation timeframe' } : { from, to: op.timeframe }) })
  },

  cancel_request(st, op, i) {
    const list = op.kind === 'alert' ? 'alerts' : 'infoValues'
    const kept = st.requests[list].filter((r) => r.plotKey !== op.output)
    if (kept.length === st.requests[list].length) {
      throw err('request:none', `There is no pending ${op.kind === 'alert' ? 'alert' : 'header value'} on "${op.output}".`)
    }
    st.requests[list] = kept
    st.changes.push({ op: i, kind: 'request-cancelled', what: op.kind, output: op.output })
  },
}

/** The ops this engine implements — a rail holds it equal to the schema's `OP_NAMES`. */
export const HANDLED_OPS = Object.freeze(Object.keys(OPS))

// ─── the whole-result checks ─────────────────────────────────────────────────

const guardOf = (v) => (v && (v.guard || (v.gate && v.gate.guard) || v.status)) || 'refused'

function finalChecks(st, input, gateCtx) {
  let def = buildFromModel(st.model, { like: input })
  // ⭐⭐ PHASE 4 — the CARRIED residual (fields outside the conversation's vocabulary)
  // goes back on verbatim; a patch that moved the same group of settings is refused.
  if (st.carry && st.carry.length) {
    const g = graftCarried(def, input, st.baseModel, st.model, st.carry)
    if (g.conflicts.length) {
      const c = g.conflicts[0]
      const what = c.output ? `"${c.output}"` : 'This indicator'
      throw err('authoring:opaque-conflict',
        `${what} carries ${c.fields[0] === 'legend' ? 'legend settings' : `${c.fields.join('/')} settings`} imported in a form UCT Intelligence can't change yet, so that change was not made. You can still edit it manually.`,
        { output: c.output || undefined, paths: g.conflicts.map((x) => x.path) })
    }
    def = orderLike(input, g.doc)
    for (const p of g.dropped) st.changes.push({ op: null, kind: 'carried-dropped', path: p })
  }
  const { errors } = validateUserDefinitions([def])
  if (errors.length) throw err('definition:invalid', errors.join('\n'))

  // ⭐ P3 — A BAND IS AREA BETWEEN TWO NUMBERS. Every fill this patch set, or
  // whose edge it changed, must join two SERIES outputs: a yes/no edge would
  // shade between 0 and 1 and call it a band.
  for (const row of st.model.rows) {
    if (!row.fill || typeof row.fill.with !== 'string') continue
    if (!(st.fills.has(row.key) || st.touched.has(row.key) || st.touched.has(row.fill.with))) continue
    for (const k of [row.key, row.fill.with]) {
      const t = outputTypeOf(def, k)
      if (!t || t.type !== OUTPUT_TYPES.SERIES) {
        throw err('fill:not-series', `"${k}" is ${t && t.type === OUTPUT_TYPES.CONDITION ? 'a yes/no, not a number' : 'not a number line'}; a fill shades between two number outputs.`, { output: row.key })
      }
    }
  }

  for (const key of st.touched) {
    const row = st.model.rows.find((r) => r.key === key)
    if (!row) continue
    if (row.marker) {
      const v = presentationVerdict(def, key, { marker: row.marker }, gateCtx)
      if (v.status === STATUS.REFUSED) throw err('marker:refused', `${key}: ${v.reason}`, { output: key })
    }
    const own = (def.paints || []).filter((p, j) => j === ownPaintOf(def.paints, key, p.kind))
    if (own.length) {
      const v = presentationVerdict(def, key, { paints: own }, gateCtx)
      if (v.status === STATUS.REFUSED) throw err('paint:refused', `${key}: ${v.reason}`, { output: key })
    }
  }

  if (st.intent) {
    const rb = intentReadback(def, st.intent.intent, { ctx: gateCtx, requestedKey: st.intent.output })
    if (rb.blocking) {
      const sel = rb.outputs.find((o) => o.selected)
      throw err(sel ? guardOf(sel.verdict) : 'intent:no-output', rb.blocking, { output: rb.selectedKey })
    }
    if (st.intent.intent !== INTENTS.PLOT && !st.intent.output) st.intent = { ...st.intent, output: rb.selectedKey }
  }

  // ⭐ PHASE 5 — THE FAN-OUT BOUND, over the whole RESULT: at most N other symbols
  // (counted as the store loads them). An imported definition already over it is
  // left alone; a patch that ADDS one more is refused.
  const named = new Set(symTickersOf(def).map(storeTickerOf))
  if (named.size > CROSS_CONTEXT.maxOtherSymbols) {
    const had = new Set((input ? symTickersOf(input) : []).map(storeTickerOf))
    if ([...named].some((t) => !had.has(t))) {
      throw err('symbol:fan-out', `An indicator made here may read at most ${CROSS_CONTEXT.maxOtherSymbols} other symbols; this one would read ${[...named].sort().join(', ')}.`)
    }
  }

  for (const r of st.requests.alerts) {
    // ⭐ PHASE 5 — a numeric condition is the ALERT lane's on a NUMBER output.
    const v = r.condition ? numericAlertGate(def, r.plotKey, gateCtx) : signalAlertGate(def, r.plotKey, gateCtx)
    if (v.status === STATUS.REFUSED && !v.pending) throw err(guardOf(v), `${r.plotKey}: ${v.reason}`, { output: r.plotKey })
  }

  // ⭐ PHASE 5 — THE WHOLE INDICATOR ON A HIGHER TIMEFRAME (`setInstanceCalculationTimeframe`
  // applies it at save). Refused here for what the instance control would refuse.
  const calc = st.requests.calculationTimeframe
  if (calc) {
    if (!CROSS_CONTEXT.calculationTimeframes.includes(calc)) throw err('calc-tf:unsupported', `"${calc}" is not a calculation timeframe.`)
    if (named.size) {
      throw err('calc-tf:other-symbol', 'An indicator that reads another symbol is calculated on the chart\'s own timeframe; use a weekly or monthly read inside the formula instead.')
    }
    const cap = calcTimeframeCapability(def, null)
    if (!cap.ok) throw err(`calc-tf:${cap.reason}`, 'This indicator is always calculated on the chart\'s own timeframe.')
    const chartTf = gateCtx && typeof gateCtx.tf === 'string' ? gateCtx.tf : null
    const rel = chartTf ? frameRelation(calc, chartTf) : 'higher'
    if (rel === 'lower' || rel === 'straddle') {
      throw err('calc-tf:lower', `A ${calc} calculation can't be drawn on this ${chartTf} chart — only a higher timeframe than the chart's.`)
    }
  }
  for (const r of st.requests.infoValues) {
    if (!infoValueOutputExists(def, r.plotKey)) throw err('info-value:output-missing', `There is no output "${r.plotKey}".`)
    const v = evaluability(def, r.plotKey, LANES.INFO_VALUE, gateCtx)
    if (v.status === STATUS.REFUSED && !v.pending) throw err(guardOf(v), `${r.plotKey}: ${v.reason}`, { output: r.plotKey })
  }

  if (input && input.compute && input.compute.paramManifest) {
    const before = reconcileParams(input)
    const after = reconcileParams(def)
    for (const [id, s] of Object.entries(before)) {
      if (s.state === ATTACHED && (!after[id] || after[id].state !== ATTACHED)) {
        const title = (input.compute.paramManifest[id] && input.compute.paramManifest[id].title) || id
        throw err('param:detached', `This edit would disconnect the "${title}" control (${after[id] ? after[id].reason : 'removed'}).`)
      }
    }
  }
  return def
}

/** Deterministic disclosures computed from the result (never errors). */
function disclosures(st, input, def, gateCtx) {
  const out = []
  const beforeTypes = new Map((input ? outputsOf(input) : []).map((o) => [o.key, o.type]))
  for (const o of outputsOf(def)) {
    if (beforeTypes.has(o.key) && beforeTypes.get(o.key) !== o.type) {
      out.push({ op: null, kind: 'type-changed', output: o.key, from: beforeTypes.get(o.key), to: o.type })
    }
    if (st.touched.has(o.key)) {
      const v = evaluability(def, o.key, LANES.CHART, gateCtx)
      // ⭐ PHASE 5 — a PENDING refusal is another symbol's bars still on their way
      // (the chart fetches them for the preview), not a fact about the result.
      if (v.status === STATUS.REFUSED && !v.pending) {
        out.push({ op: null, kind: 'refused-on-chart', output: o.key, guard: guardOf(v), text: v.reason })
      }
    }
  }
  return out
}

/**
 * ⭐ P3S — A YES/NO THAT A COLOUR SHOWS IS NOT ALSO A 0/1 LINE. When this patch
 * gives a CONDITION output its FIRST own paint (candles or background), the output
 * is still drawn with the default line, and the patch did not set its visibility,
 * the line is hidden. A hidden plot is COMPUTED, never drawn (`defSchema`), so the
 * paint — which reads the output's own column — is unchanged; only the flat 0/1
 * line under it goes (P3R: "RSI 28 > 70 0.00" drawn in the RSI pane). Only when
 * another output is drawn beside it. Disclosed;
 * `set_style hidden:false` draws it again, and a later colour change does not
 * re-hide it. ⛔ Presentation only: the tree, the type and the truth are untouched.
 */
function hidePaintedConditionLines(st) {
  for (const row of st.model.rows) {
    if (!st.newPaints.has(row.key) || st.hiddenSet.has(row.key)) continue
    if (row.hidden === true || row.marker || row.style !== 'line' || !row.ast) continue
    if (treeOutputType(row.ast).type !== OUTPUT_TYPES.CONDITION) continue
    // ⛔ ONLY WHERE NOTHING IS LEFT EMPTY: beside another drawn output (the P3R
    // shape: an RSI line + its yes/no), or ON THE PRICE CHART, where a lone 0/1 line
    // sits far off the price scale and the candles themselves carry the answer
    // (rollout polish). A lone painted condition IN ITS OWN PANE keeps its line, as
    // P2 accepted it: hiding it there would leave the pane empty.
    const onPrice = !!(st.model.placement && st.model.placement.target === 'price')
    if (!onPrice && !st.model.rows.some((o) => o !== row && o.hidden !== true)) continue
    row.hidden = true
    st.changes.push({ op: null, kind: 'line-hidden', output: row.key, reason: 'paint' })
    st.engineAssumptions.push({ output: row.key, source: 'engine',
      text: 'this yes/no shows through its colour, so it is not also drawn as a 0/1 line' })
  }
}

function runOps(input, ops, ctx) {
  const st = {
    model: null, ctx, changes: [], touched: new Set(), removed: new Set(), requested: new Set(),
    intent: ctx.intent ? { ...ctx.intent } : null, requests: normRequests(ctx.requests),
    engineAssumptions: [], replacedForeign: {}, created: false, intentTouched: false, fills: new Set(),
    renamedDefinition: false, renamedOutputs: new Set(),
    newPaints: new Set(), hiddenSet: new Set(), calcTouched: false,
  }
  let namingBefore = null
  if (input) {
    try {
      st.model = modelOf(input)
      namingBefore = namingSnapshot(st.model)
    } catch (e) {
      if (e instanceof AuthoringError) return { ok: false, errors: [{ op: null, code: e.code, message: e.message }] }
      throw e
    }
    // ⭐⭐ PHASE 4 — only MATHS/STRUCTURE the row model cannot hold refuses the
    // definition; every other residual field is carried (`fidelityPlan`).
    const plan = fidelityPlan(input, st.model)
    if (plan.blocking.length) {
      return { ok: false, errors: [{ op: null, code: 'authoring:unrepresentable',
        message: `This definition carries ${plan.blocking.length} field(s) the Builder cannot reproduce, so it is not edited here: ${plan.blocking.slice(0, 8).join(', ')}`,
        paths: plan.blocking }] }
    }
    st.carry = plan.carry
    // The row model BEFORE the patch — what a carried field's conflict is judged against.
    st.baseModel = plan.carry.length ? JSON.parse(JSON.stringify(st.model)) : null
  }
  for (let i = 0; i < ops.length; i += 1) {
    try {
      OPS[ops[i].op](st, clone(ops[i]), i)
    } catch (e) {
      if (e instanceof AuthoringError) return { ok: false, errors: [{ op: i, code: e.code, message: e.message, ...(e.output ? { output: e.output } : {}) }] }
      return { ok: false, errors: [{ op: i, code: 'engine:error', message: String(e && e.message ? e.message : e) }] }
    }
  }
  if (!st.model) return { ok: false, errors: [{ op: null, code: 'definition:none', message: 'There is no definition yet; the first turn must create one.' }] }
  hidePaintedConditionLines(st)
  // ⭐⭐ THE NAME DESCRIBES THE RESULT (derivedName.js): an auto name and auto
  // labels are re-derived from the patched trees; a custom one is kept.
  st.changes.push(...applyDerivedNaming(st.model, namingBefore,
    { renamedDefinition: st.renamedDefinition, renamedOutputs: st.renamedOutputs }))
  const gateCtx = ctx.gateCtx || {}
  let def
  try {
    def = finalChecks(st, input, gateCtx)
  } catch (e) {
    if (e instanceof AuthoringError) return { ok: false, errors: [{ op: null, code: e.code, message: e.message, ...(e.output ? { output: e.output } : {}) }] }
    return { ok: false, errors: [{ op: null, code: 'engine:error', message: String(e && e.message ? e.message : e) }] }
  }
  return { ok: true, st, def, changes: [...st.changes, ...disclosures(st, input, def, gateCtx)] }
}

function checkAssumptions(patchAssumptions, def) {
  const slots = new Map(parameterSlots(def).map((s) => [s.id, s]))
  const keys = new Set(outputsOf(def).map((o) => o.key))
  const out = []
  for (const a of patchAssumptions || []) {
    if (a.slot !== undefined) {
      const s = slots.get(a.slot)
      if (!s) throw err('assumption:unknown-slot', `The assumption names "${a.slot}", which is not a parameter of the result.`)
      out.push({ slot: a.slot, output: s.output, label: s.label, value: s.value, text: a.text, source: 'model' })
    } else if (a.output !== undefined) {
      if (!keys.has(a.output)) throw err('assumption:unknown-output', `The assumption names "${a.output}", which is not an output.`)
      out.push({ output: a.output, text: a.text, source: 'model' })
    } else {
      out.push({ text: a.text, source: 'model' })
    }
  }
  return out
}

/**
 * ⭐⭐ APPLY ONE PATCH.
 *
 * @param {object|null} definition the working canonical definition (null before a create)
 * @param {object} patch a `uct.authoring.patch/1` envelope
 * @param {{revision?, intent?, requests?, gateCtx?, defId?}} ctx
 * @returns {{ok, status: 'applied'|'question'|'refused', definition, changes[], errors[],
 *   assumptions[], intent, requests, questions[], wouldApplyAlone?, replacedForeign?}}
 *   On refusal `definition` IS the input object and nothing else moved.
 */
export function applyPatch(definition, patch, ctx = {}) {
  const input = definition || null
  const intent = ctx.intent ? { ...ctx.intent } : null
  const requests = normRequests(ctx.requests)
  const refused = (errors, extra = {}) => ({
    ok: false, status: 'refused', definition: input, changes: [], errors, assumptions: [], intent, requests,
    questions: [], ...extra,
  })

  const shape = validatePatchShape(patch)
  if (!shape.ok) {
    return refused(shape.errors.map((e) => ({ op: opIndexOf(e.at), code: e.code, message: e.message })))
  }
  if (Number.isInteger(ctx.revision) && patch.baseRevision !== ctx.revision) {
    return refused([{ op: null, code: 'patch:stale',
      message: `This change was written against revision ${patch.baseRevision}; the indicator is now at ${ctx.revision}.` }])
  }
  if (patch.questions && patch.questions.length) {
    return { ok: true, status: 'question', definition: input, changes: [], errors: [], assumptions: [], intent, requests,
      questions: patch.questions.map((q) => ({ id: q.id, text: q.text, ...(q.choices ? { choices: [...q.choices] } : {}) })) }
  }
  if (!patch.ops.length) {
    return refused([{ op: null, code: 'patch:empty', message: 'The change names nothing to do.' }])
  }

  const run = runOps(input, patch.ops, ctx)
  if (!run.ok) {
    const alone = patch.ops.length > 1
      ? patch.ops.map((op, i) => (runOps(input, [op], ctx).ok ? i : -1)).filter((i) => i >= 0)
      : []
    return refused(run.errors, { wouldApplyAlone: alone })
  }
  let assumptions
  try {
    assumptions = [...checkAssumptions(patch.assumptions, run.def), ...run.st.engineAssumptions]
  } catch (e) {
    if (e instanceof AuthoringError) return refused([{ op: null, code: e.code, message: e.message }])
    throw e
  }
  return {
    ok: true, status: 'applied', definition: run.def, changes: run.changes, errors: [], assumptions,
    intent: run.st.intent, requests: run.st.requests, questions: [],
    replacedForeign: run.st.replacedForeign, created: run.st.created,
  }
}

export { outputTypeOf }
