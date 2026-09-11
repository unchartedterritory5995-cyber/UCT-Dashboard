import { newConditionId, normaliseConditions, validateConditionFormula } from './conditions'
import { ACTION_TYPES, ACTION_CHANNEL, MARKER_SHAPES, MARKER_POSITIONS } from './conditionActions'

// ─── THE WRITE DOOR FOR CONDITIONS ──────────────────────────────────────────
//
// ⭐ ONE MODULE, THE WAY `instanceControls.js` IS THE ONE DOOR FOR AN INSTANCE.
// Every writer here is PURE — settings in, settings out, the caller's object
// never mutated — and every one returns the SAME object when it refuses, so a
// caller's `if (next !== settings)` is the whole of its error handling.
//
// ⛔ AND A REFUSAL IS SILENT ON PURPOSE AT THIS LAYER. A formula that is not a
// condition is refused by `setConditionFormula` returning `cs`; the UI asks
// `validateConditionFormula` itself to SAY why, beside the box. Two places may
// ask the same question; only one may decide it.

const withConditions = (cs, list) => ({ ...cs, conditions: list, preset: 'custom' })

/** The list this settings blob holds, as objects safe to spread. */
export function conditionsOf(cs) {
  return normaliseConditions(cs)
}

/**
 * Add a condition.
 *
 * ⚠️ IT IS APPENDED, AND APPENDED MEANS LOWEST PRIORITY. The order shown in
 * settings IS the priority order (first matching enabled rule wins), so a new
 * rule cannot silently take a candle away from one that was already working.
 */
export function addCondition(cs, { name, formula, bindings, actions } = {}) {
  if (!cs || typeof cs !== 'object') return cs
  const check = validateConditionFormula(formula, bindings)
  if (!check.ok) return cs
  const list = conditionsOf(cs)
  list.push({
    id: newConditionId(),
    name: typeof name === 'string' && name.trim() ? name.trim() : 'Condition',
    formula,
    enabled: true,
    bindings: bindings && typeof bindings === 'object' ? { ...bindings } : {},
    actions: Array.isArray(actions) ? actions.map((a) => ({ ...a })) : [],
  })
  return withConditions(cs, list)
}

/** Remove a condition — and with it every action it owned (Part 41). Source
 *  indicators are untouched: a condition READS them and owns none of them. */
export function removeCondition(cs, id) {
  const list = conditionsOf(cs)
  const next = list.filter((c) => c.id !== id)
  if (next.length === list.length) return cs
  return withConditions(cs, next)
}

/** Rename. ⭐ The ID IS UNTOUCHED, which is the whole reason actions reference
 *  it rather than the display text (Part 45). */
export function renameCondition(cs, id, name) {
  if (typeof name !== 'string' || !name.trim()) return cs
  const list = conditionsOf(cs)
  const i = list.findIndex((c) => c.id === id)
  if (i < 0 || list[i].name === name.trim()) return cs
  list[i] = { ...list[i], name: name.trim() }
  return withConditions(cs, list)
}

/** Turn one condition on or off. Its configuration is kept — the engine simply
 *  stops evaluating it (`binder.evaluateConditions`) and every channel loses its
 *  ink at once. */
export function setConditionEnabled(cs, id, enabled) {
  const list = conditionsOf(cs)
  const i = list.findIndex((c) => c.id === id)
  if (i < 0) return cs
  const want = enabled !== false
  if (list[i].enabled === want) return cs
  list[i] = { ...list[i], enabled: want }
  return withConditions(cs, list)
}

/** Replace the formula. ⛔ REFUSED unless it answers true or false. */
export function setConditionFormula(cs, id, formula) {
  const list = conditionsOf(cs)
  const i = list.findIndex((c) => c.id === id)
  if (i < 0) return cs
  if (!validateConditionFormula(formula, list[i].bindings).ok) return cs
  if (list[i].formula === formula) return cs
  list[i] = { ...list[i], formula }
  return withConditions(cs, list)
}

/** Move one condition up or down — which is to say, change its PRIORITY. */
export function moveCondition(cs, id, delta) {
  const list = conditionsOf(cs)
  const i = list.findIndex((c) => c.id === id)
  if (i < 0) return cs
  const j = i + (delta < 0 ? -1 : 1)
  if (j < 0 || j >= list.length) return cs
  const [row] = list.splice(i, 1)
  list.splice(j, 0, row)
  return withConditions(cs, list)
}

/**
 * Bind (or clear) one named series on a condition.
 *
 * ⭐⭐ THIS IS THE WHOLE OF "A CONDITION READS ANOTHER INDICATOR". The value is
 * the SAME `'@instanceId::plotKey'` string the Moving Average takes for its
 * source — one reference language, built by `sourceRef.sourceOptions`, and the
 * dependency edge, the sort and the invalidation all come with it.
 *
 * ⚠️ CLEARING A BINDING IS A REAL WRITE, and it may leave the formula naming a
 * word that no longer resolves. That is refused at evaluation with the name in
 * the message rather than silently rewritten to `close` — the same rule the
 * Moving Average's missing source follows.
 */
export function setConditionBinding(cs, id, key, ref) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) return cs
  const list = conditionsOf(cs)
  const i = list.findIndex((c) => c.id === id)
  if (i < 0) return cs
  const bindings = { ...list[i].bindings }
  if (!ref) {
    if (!(key in bindings)) return cs
    delete bindings[key]
  } else {
    if (bindings[key] === ref) return cs
    bindings[key] = ref
  }
  list[i] = { ...list[i], bindings }
  return withConditions(cs, list)
}

/** The names a condition may bind. Short, so a formula reads like arithmetic
 *  (`a > b`) rather than like plumbing, and fixed so the UI needs no name box. */
export const BINDING_KEYS = Object.freeze(['a', 'b', 'c'])
const KEY_RE = /^[a-z][a-z0-9]*$/

// ─── ACTIONS ────────────────────────────────────────────────

/** A new action's shape, per type. Kept here rather than in the renderer so the
 *  persisted default and the drawn default are one answer. */
const ACTION_DEFAULTS = Object.freeze({
  candleColor: { color: '#e8a33d', target: 'price' },
  marker: { shape: 'dot', position: 'belowBar', color: '#3b82f6', target: 'price' },
  background: { color: 'rgba(34,168,94,0.14)', target: 'price' },
})

let _actionSeq = 0
export function addAction(cs, id, type) {
  if (!ACTION_TYPES.includes(type)) return cs
  const list = conditionsOf(cs)
  const i = list.findIndex((c) => c.id === id)
  if (i < 0) return cs
  _actionSeq += 1
  const actions = [...list[i].actions, {
    id: `act:${Date.now().toString(36)}:${_actionSeq}`,
    type,
    enabled: true,
    ...ACTION_DEFAULTS[type],
  }]
  list[i] = { ...list[i], actions }
  return withConditions(cs, list)
}

export function removeAction(cs, id, actionId) {
  const list = conditionsOf(cs)
  const i = list.findIndex((c) => c.id === id)
  if (i < 0) return cs
  const actions = list[i].actions.filter((a) => a.id !== actionId)
  if (actions.length === list[i].actions.length) return cs
  list[i] = { ...list[i], actions }
  return withConditions(cs, list)
}

/**
 * Patch one action's settings.
 *
 * ⭐ NOTHING HERE REACHES THE EVALUATOR. A marker's colour, a background's
 * alpha, a candle's swatch — none of them is in the condition's memo key, so
 * changing one costs a repaint and zero recalculations (Part 37). That is not a
 * promise this function keeps; it is a consequence of the action not being part
 * of what the formula reads.
 */
export function setActionSettings(cs, id, actionId, patch) {
  if (!patch || typeof patch !== 'object') return cs
  const list = conditionsOf(cs)
  const i = list.findIndex((c) => c.id === id)
  if (i < 0) return cs
  const j = list[i].actions.findIndex((a) => a.id === actionId)
  if (j < 0) return cs
  const clean = {}
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'shape' && !MARKER_SHAPES.includes(v)) continue
    if (k === 'position' && !MARKER_POSITIONS.includes(v)) continue
    if (k === 'type' || k === 'id') continue          // identity is not a setting
    clean[k] = v
  }
  if (!Object.keys(clean).length) return cs
  const actions = [...list[i].actions]
  actions[j] = { ...actions[j], ...clean }
  list[i] = { ...list[i], actions }
  return withConditions(cs, list)
}

/** Which channels a condition already draws in — so the UI can offer each type
 *  once and not invite a second candle colour that could never win. */
export function usedChannels(cond) {
  const out = new Set()
  for (const a of (cond && cond.actions) || []) {
    const ch = ACTION_CHANNEL[a && a.type]
    if (ch) out.add(ch)
  }
  return out
}
