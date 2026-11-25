// app/src/components/chart/engine/knobBind.js
//
// ─── ⭐⭐ e95 unit 2b — THE DOCUMENT ONE BINDING DRAWS: every knob's unpicked arm pruned away ─────────────────────
//
// A member's `input.string` setting that drives a `switch` (or a ternary chain) is a LIVE knob: the member door builds
// every arm (`pine.js::Resolver.enumSwitch`, `enumCompare`), each test the knob compared with an option's index. The
// coordinator's ruling (2026-11-22): PRUNE AT BIND TIME. One binding (its inputs) fixes every knob, so the bound tree
// keeps only the arm the knob picks (`ast/bind.js::pruneKnobArms`, inside `foldBound`), and EVERYTHING the chart lane
// decides per binding reads the bound document, never the saved one:
//   · the other-symbol / corporate-event decisions (`otherSymbolsDecision`) and their per-plot refusals,
//   · the static gates (`chartStaticRefusals`: period, lower timeframe, current-only scalars),
//   · the block-run check and the evaluator itself.
// So an arm the knob does not pick never withholds or refuses the chart: an event read refused on an intraday chart,
// a field UCT does not hold, or an arm the translator refused (`refusedArm(k)`), refuses only when the knob picks it.
// ⛔ The SAVED document keeps every arm (its formula text, its trees): only the bound copy is pruned, and a document
// with no knob ternary binds to ITSELF (the same object), so nothing else moves.

import { pruneKnobArms, REFUSED_ARM_CALL, bindConstsFor, knobTestValue } from './ast/bind.js'
import { resolveInputs, treeScalars } from './knobInputs.js'
import { symTickersOf } from './otherSymbols.js'

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/** Every tree inside `value` (a tree, an array of them, or a plain object holding them) pruned for this binding; the
 *  same object when nothing in it changed. */
function pruneDeep(value, consts, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 32) return value
  if (Array.isArray(value)) {
    let changed = false
    const out = value.map((v) => {
      const w = pruneDeep(v, consts, depth + 1)
      if (w !== v) changed = true
      return w
    })
    return changed ? out : value
  }
  if (typeof value.type === 'string') return pruneKnobArms(value, consts)
  let changed = false
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    const w = pruneDeep(v, consts, depth + 1)
    if (w !== v) changed = true
    out[k] = w
  }
  return changed ? out : value
}

/** The lower-timeframe codes the trees of `def` read (`ltf` nodes). */
function ltfCodesRead(def) {
  const out = new Set()
  const stack = [def && def.compute, def && def.objects]
  const seen = new Set()
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object' || seen.has(n)) continue
    seen.add(n)
    if (n.type === 'ltf' && n.value != null) out.add(String(n.value))
    for (const v of Object.values(n)) if (v && typeof v === 'object') stack.push(v)
  }
  return out
}

/**
 * ⭐⭐ THE BOUND DOCUMENT: `def` with every knob ternary in its plot trees (`compute.trees` / `compute.ast`) and its
 * object trees (`objects`) replaced by the arm `consts` picks, and its stamps of what it reads (`meta.otherSymbols`,
 * `meta.lowerTf`) narrowed by exactly what the pruned arms alone read. `def` itself when nothing prunes.
 *
 * @param {object} def     an installed definition
 * @param {object} consts  the binding's constants (`bind.js::bindConstsFor`): its inputs are the knobs
 */
export function boundDocument(def, consts) {
  if (!isPlainObject(def) || !isPlainObject(def.compute)) return def
  const compute = pruneDeep(def.compute, consts)
  const objects = def.objects ? pruneDeep(def.objects, consts) : def.objects
  if (compute === def.compute && objects === def.objects) return def
  const out = { ...def, compute, ...(def.objects !== undefined ? { objects } : {}) }
  const meta = isPlainObject(def.meta) ? def.meta : null
  if (meta) {
    const narrowed = { ...meta }
    let moved = false
    if (Array.isArray(meta.otherSymbols) && meta.otherSymbols.length) {
      const before = new Set(symTickersOf(def))
      const after = new Set(symTickersOf(out))
      const gone = (t) => before.has(t) && !after.has(t)
      const kept = meta.otherSymbols.filter((r) => !(r && typeof r.ticker === 'string' && gone(r.ticker.trim().toUpperCase())))
      if (kept.length !== meta.otherSymbols.length) { narrowed.otherSymbols = kept; moved = true }
    }
    if (Array.isArray(meta.lowerTf) && meta.lowerTf.length) {
      const before = ltfCodesRead(def)
      const after = ltfCodesRead(out)
      const kept = meta.lowerTf.filter((c) => !(before.has(String(c)) && !after.has(String(c))))
      if (kept.length !== meta.lowerTf.length) { narrowed.lowerTf = kept; moved = true }
    }
    if (moved) out.meta = narrowed
  }
  return out
}

/** `def` bound at an INSTANCE's knobs (its stored inputs over the declared defaults, a text option read as its index,
 *  `knobInputs.js::treeScalars`): what that instance's chart draws, and therefore all it fetches
 *  (`symbolInputs.js::instanceDocumentForFetch`). With `{}`, the defaults (`astColumns.js::defaultBoundDocument`). */
export function boundAtInputs(def, inputs) {
  if (!isPlainObject(def) || !isPlainObject(def.compute)) return def
  return boundDocument(def, bindConstsFor({ inputs: treeScalars(def, resolveInputs(def, inputs || {})) }))
}

/** ⭐⭐ e97 U6 — IS THIS PLOT HIDDEN FOR THIS INSTANCE? The ONE answer every binder site asks (a source rail holds every
 *  `plots[].hidden` read to this function): `plot.hidden === true` (computed, never drawn: the author's literal
 *  `display.none`, a display off the pane at every setting), or `plot.hiddenWhen` (a knob tree, true = hidden,
 *  `pine.js::outputDisplayOf`) evaluated at the instance's inputs over the declared defaults, the same constants the
 *  chart lane binds its trees with (`boundAtInputs`). A document saved before `hiddenWhen` existed reads exactly as it
 *  always did: `hidden === true` and nothing else.
 *  ⛔ A `hiddenWhen` this binding cannot evaluate (a tree that is not a knob test any more) is HIDDEN: never guessed
 *  as drawn.
 *  @param {object} plot  a `def.plots[]` entry
 *  @param {object} def   its definition (for the declared inputs and their defaults)
 *  @param {object} [inputs]  the instance's stored inputs */
/** ⭐ e97 U6 — the binding constants `plotHiddenAt` evaluates a `hiddenWhen` with, memoised per definition and inputs
 *  inputs CONTENT (the binder asks per plot and per site on every sync: measured 2.7 µs a call unmemoised).
 *  A runtime document declares a yes/no setting as a `bool` (true / false); a knob test reads numbers, as the host
 *  lane's `int` 0 / 1 already are. */
const DISPLAY_CONSTS = new WeakMap()
function displayConstsFor(def, inputs) {
  const given = inputs && typeof inputs === 'object' ? inputs : EMPTY_INPUTS
  // ⛔ keyed by the inputs' CONTENT, never their object identity: an inputs object changed in place must not read stale
  let sig
  try { sig = JSON.stringify(given) } catch { sig = null }
  let byInputs = DISPLAY_CONSTS.get(def)
  if (!byInputs) { byInputs = new Map(); DISPLAY_CONSTS.set(def, byInputs) }
  let consts = sig === null ? null : byInputs.get(sig)
  if (!consts) {
    const scalars = { ...treeScalars(def, resolveInputs(def, given)) }
    for (const [k, v] of Object.entries(scalars)) if (typeof v === 'boolean') scalars[k] = v ? 1 : 0
    consts = bindConstsFor({ inputs: scalars })
    if (sig !== null) {
      if (byInputs.size >= 16) byInputs.clear()
      byInputs.set(sig, consts)
    }
  }
  return consts
}
const EMPTY_INPUTS = Object.freeze({})

/** ⭐ e97 U6 (shared since e98 E1) — THE VALUE OF ONE KNOB TEST FOR THIS INSTANCE: the tree (the grammar
 *  `defSchema.hiddenWhenProblem` checks) evaluated by `knobTestValue` at the instance's inputs over the declared
 *  defaults (`displayConstsFor`); a bare number is itself. null when this binding cannot evaluate it. The ONE evaluator
 *  `hiddenWhen` (`plotHiddenAt`) and `lineStyleWhen` (`plotLineStyleAt`) are asked through. */
export function knobTestAt(tree, def, inputs) {
  if (!tree || typeof tree !== 'object') return null
  if (tree.type === 'num') return typeof tree.value === 'number' && Number.isFinite(tree.value) ? tree.value : null
  return knobTestValue(tree, displayConstsFor(def, inputs))
}

export function plotHiddenAt(plot, def, inputs) {
  if (!plot || typeof plot !== 'object') return false
  if (plot.hidden === true) return true
  const when = plot.hiddenWhen
  if (!when || typeof when !== 'object') return false
  const v = knobTestAt(when, def, inputs)
  if (v === null) return true
  return !!v
}

/** ⭐⭐ e98 E1 — THE LINE STYLE THIS INSTANCE DRAWS A PLOT WITH: the first `plots[].lineStyleWhen` arm whose knob test
 *  holds at the instance's inputs (`knobTestAt`, the evaluator `hiddenWhen` is asked through), else the plot's own
 *  `lineStyle` (the style at the settings' defaults, `pine.js::outputLineStyleOf`). A plot with no `lineStyleWhen` is
 *  returned AS IS (the same object), so every document saved before it draws exactly as it did.
 *  ⛔ An arm this binding cannot evaluate is skipped, never taken: the defaults' style stands.
 *  @returns {object} the plot, or a copy whose `lineStyle` is the instance's */
export function plotLineStyleAt(plot, def, inputs) {
  if (!plot || typeof plot !== 'object' || !Array.isArray(plot.lineStyleWhen) || !plot.lineStyleWhen.length) return plot
  const hit = plot.lineStyleWhen.find((a) => a && typeof a.lineStyle === 'string' && !!knobTestAt(a.when, def, inputs))
  const lineStyle = hit ? hit.lineStyle : plot.lineStyle
  return lineStyle === plot.lineStyle ? plot : { ...plot, lineStyle }
}

/** ⭐ e97 U6 — a `hiddenWhen` tree decided at its settings' DEFAULTS (the non-enumerable `inputDefault` each knob leaf
 *  of a translation carries): true = hidden. ⛔ A tree it cannot evaluate is HIDDEN (never guessed as drawn). */
export function hiddenAtLeafDefaults(tree) {
  const consts = {}
  const stack = [tree]
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object') continue
    if (n.type === 'series' && typeof n.inputDefault === 'number' && Number.isFinite(n.inputDefault)) consts[n.name] = n.inputDefault
    if (Array.isArray(n.args)) for (const a of n.args) stack.push(a)
  }
  const v = knobTestValue(tree, consts)
  return v === null ? true : !!v
}

/** The refused knob arm a BOUND tree still holds (the member's setting picked it): `{guard, message}` quoting the
 *  translator's own refusal (`meta.knobArmRefusals`, stamped by the member door), or null. ⛔ A leaf with no entry
 *  (a document saved without the stamp) is left to the evaluator, which refuses it by its own sentence
 *  (`interpret.js::FN.refusedArm`, `interpret:refused-arm`). */
export function armRefusalOfTree(tree, def) {
  const stack = [tree]
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object') continue
    if (n.type === 'call' && n.name === REFUSED_ARM_CALL) {
      const k = n.args && n.args[0] && n.args[0].type === 'num' ? Number(n.args[0].value) : NaN
      const list = def && isPlainObject(def.meta) && Array.isArray(def.meta.knobArmRefusals) ? def.meta.knobArmRefusals : []
      const entry = Number.isInteger(k) && k >= 1 ? list[k - 1] : null
      if (entry && typeof entry.guard === 'string' && typeof entry.message === 'string') {
        return { guard: entry.guard, message: entry.message }
      }
      return null
    }
    if (Array.isArray(n.args)) for (const a of n.args) stack.push(a)
  }
  return null
}
