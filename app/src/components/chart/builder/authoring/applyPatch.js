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
  modelOf, buildFromModel, fidelityResidual, evaluateRowSource, AuthoringError, LEVELS_PLOT_KEY,
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
import { signalAlertGate } from '../../engine/triggerPolicy'
import { infoValueOutputExists } from '../../engine/infoValueResolve'
import { validateUserDefinitions } from '../../engine/nativeRegistry'
import { reconcileParams, ATTACHED } from '../paramEdit'

/** The node types a patch tree may use — the concierge's ADVERTISED union
 *  (P0G: sym / tf / textop / str / symtext are not offered to the model). */
export const PATCH_NODE_TYPES = Object.freeze(['num', 'series', 'op', 'call', 'offset'])

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const err = (code, message, extra) => new AuthoringError(code, message, extra)

export const EMPTY_REQUESTS = Object.freeze({ alerts: Object.freeze([]), infoValues: Object.freeze([]) })
const normRequests = (r) => ({
  alerts: Array.isArray(r && r.alerts) ? r.alerts.map((a) => ({ plotKey: a.plotKey, triggerPolicy: a.triggerPolicy })) : [],
  infoValues: Array.isArray(r && r.infoValues) ? r.infoValues.map((a) => ({ plotKey: a.plotKey, format: a.format })) : [],
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
  Object.assign(row, g)
  st.touched.add(row.key)
  st.changes.push({ op: i, kind, output: row.key, from, to: g.source })
}

/** ⭐ P3 — the styles drawn as a LINE, so a line style is something they show
 *  (`pool`: a histogram has no line style, a markers plot has `lineWidth: 0`). */
export const LINE_DRAWN_STYLES = Object.freeze(['line', 'stepline', 'area', 'baseline'])

/** ⭐ P3 — a fill the conversation may replace or remove: exactly the shape
 *  `set_fill` writes (`{with}` and nothing else). A band carrying its own
 *  conditional colour (an import's) is not this door's to overwrite. */
const plainFill = (f) => !!f && typeof f === 'object' && Object.keys(f).length === 1 && typeof f.with === 'string'

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
    const users = m.rows.filter((r) => r !== row && (r.colorMode === col
      || (r.fill && (r.fill.with === row.key || r.fill.colorMode === col))))
    if (users.length) {
      throw err('output:referenced', `"${row.key}" colours or fills ${users.map((r) => `"${r.key}"`).join(', ')}; change that first.`)
    }
    const foreign = (m.paints || []).filter((p, j) => p && p.colorMode === col && j !== ownPaintOf(m.paints, row.key, p.kind))
    if (foreign.length) throw err('output:referenced', `An imported paint reads "${row.key}"; it cannot be removed here.`)
    m.rows = m.rows.filter((r) => r !== row)
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
    else paints.push(paint)
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
    const row = rowOf(st, op.output)
    const other = rowOf(st, op.with)
    if (other === row) throw err('fill:self', `A fill between "${row.key}" and itself has no area.`, { output: row.key })
    if (row.fill && !plainFill(row.fill)) {
      throw err('fill:foreign', `"${row.key}" already has an imported band with its own colours; it is not overwritten.`, { output: row.key })
    }
    if (other.fill && other.fill.with === row.key) {
      throw err('fill:duplicate', `"${other.key}" is already shaded to "${row.key}".`, { output: row.key })
    }
    const from = row.fill ? { with: row.fill.with, color: row.fillColor || null, opacity: Number.isFinite(row.fillOpacity) ? row.fillOpacity : null } : null
    row.fill = { with: other.key }
    delete row.fillColor
    delete row.fillOpacity
    if (op.color !== undefined) row.fillColor = op.color
    if (op.opacity !== undefined) row.fillOpacity = op.opacity
    st.touched.add(row.key)
    st.fills.add(row.key)
    st.changes.push({ op: i, kind: 'fill-set', output: row.key, from,
      to: { with: other.key, color: op.color || null, opacity: op.opacity !== undefined ? op.opacity : null } })
  },

  remove_fill(st, op, i) {
    const row = rowOf(st, op.output)
    if (!row.fill) throw err('fill:none', `"${row.key}" has no fill to remove.`, { output: row.key })
    if (!plainFill(row.fill)) {
      throw err('fill:foreign', `"${row.key}" has an imported band with its own colours; it is not removed here.`, { output: row.key })
    }
    const from = row.fill.with
    delete row.fill
    delete row.fillColor
    delete row.fillOpacity
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
    if (!st.requests.alerts.some((r) => r.plotKey === op.output && r.triggerPolicy === op.triggerPolicy)) {
      st.requests.alerts.push({ plotKey: op.output, triggerPolicy: op.triggerPolicy })
    }
    st.requested.add(`alert:${op.output}`)
    st.changes.push({ op: i, kind: 'alert-requested', output: op.output, triggerPolicy: op.triggerPolicy })
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
  const def = buildFromModel(st.model, { like: input })
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

  for (const r of st.requests.alerts) {
    const v = signalAlertGate(def, r.plotKey, gateCtx)
    if (v.status === STATUS.REFUSED && !v.pending) throw err(guardOf(v), `${r.plotKey}: ${v.reason}`, { output: r.plotKey })
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
      if (v.status === STATUS.REFUSED) {
        out.push({ op: null, kind: 'refused-on-chart', output: o.key, guard: guardOf(v), text: v.reason })
      }
    }
  }
  return out
}

function runOps(input, ops, ctx) {
  const st = {
    model: null, ctx, changes: [], touched: new Set(), removed: new Set(), requested: new Set(),
    intent: ctx.intent ? { ...ctx.intent } : null, requests: normRequests(ctx.requests),
    engineAssumptions: [], replacedForeign: {}, created: false, intentTouched: false, fills: new Set(),
    renamedDefinition: false, renamedOutputs: new Set(),
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
    const residual = fidelityResidual(input, st.model)
    if (residual.length) {
      return { ok: false, errors: [{ op: null, code: 'authoring:unrepresentable',
        message: `This definition carries ${residual.length} field(s) the Builder cannot reproduce, so it is not edited here: ${residual.slice(0, 8).join(', ')}`,
        paths: residual }] }
    }
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
