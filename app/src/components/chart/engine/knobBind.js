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

import { pruneKnobArms, REFUSED_ARM_CALL } from './ast/bind.js'
import { REFUSALS } from './ast/interpret'
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

/** The refused knob arm a BOUND tree still holds (the member's setting picked it): `{guard, message}` quoting the
 *  translator's own refusal (`meta.knobArmRefusals`, stamped by the member door), or null. ⛔ A leaf with no entry
 *  (a document saved without the stamp) still refuses, by the evaluator's own sentence. */
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
      return { guard: 'interpret:refused-arm', message: REFUSALS['interpret:refused-arm'] }
    }
    if (Array.isArray(n.args)) for (const a of n.args) stack.push(a)
  }
  return null
}
