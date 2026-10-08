// ── UCT Agent COMPOSITION: one capability's typed RESULT → another's ARGUMENT ──
//
// The narrow dataflow seam (see capabilities.js "TYPED OUTPUTS"). Generic: it knows
// no feature. A plan may contain
//   a PRODUCER   an op whose capability `produces` a type and that names its result
//                with `as` (e.g. a screen → an ordered ticker list), and
//   a CONSUMER   an op whose capability declares `inputs: { <arg>: <type> }`, with
//                that arg set to a reference { from, top } instead of a literal.
// `from` names a producer EARLIER in the same plan, or a registered standing source
// (the last screen). Nothing else can be referenced: no paths, no properties, no
// expressions — the only projection is "the first `top` items of that result".
//
// Before approval: references are validated and shown as pending ("the top 20
// results"); nothing runs. At APPLY: producers run fresh, the actual symbols replace
// the references, and the plan is re-planned and committed like any other — no model
// call, and nothing is written if a producer fails or a reference comes back empty.

import { getCapability, getOutputSource, isRef } from './capabilities'

const MAX_TOP = 100

/** [{ op, arg, ref, type }] for every typed reference in the ops. */
export function refsOf(ops) {
  const out = []
  for (const op of ops || []) {
    const cap = getCapability(op?.action)
    for (const [arg, type] of Object.entries(cap?.inputs || {})) {
      const v = op.args?.[arg]
      if (isRef(v)) out.push({ op, arg, ref: v, type })
    }
  }
  return out
}

/** Producer ops some later op references (by their `as`). */
export function consumedProducers(ops) {
  const wanted = new Set(refsOf(ops).map(r => r.ref.from))
  return (ops || []).filter(op => getCapability(op?.action)?.produces && op.args?.as && wanted.has(String(op.args.as)))
}

/** A sentence if any reference is malformed or points at nothing it may use. */
export function checkRefs(ops) {
  const seen = new Map()                                // alias → produced type, in plan order
  for (const op of ops || []) {
    const cap = getCapability(op?.action)
    for (const [arg, type] of Object.entries(cap?.inputs || {})) {
      const v = op.args?.[arg]
      if (!isRef(v)) continue
      const inPlan = seen.get(v.from)
      const src = getOutputSource(v.from)
      if (inPlan == null && !(src && src.type === type && src.available())) {
        return `“${v.from}” isn't a result I can use here.`
      }
      if (inPlan != null && inPlan !== type) return `“${v.from}” doesn't produce ${type}.`
      if (v.top !== null && (v.top < 1 || v.top > MAX_TOP)) return `“top” must be between 1 and ${MAX_TOP}.`
    }
    if (cap?.produces && op.args?.as) seen.set(String(op.args.as), cap.produces)
  }
  // A producer's own arguments are checked BEFORE anything is proposed (a screen
  // with an unknown field never reaches a proposal, let alone a write).
  for (const p of consumedProducers(ops)) {
    const why = getCapability(p.action).validateProduce?.(p.args)
    if (why) return why
  }
  return null
}

/** What will run, said before anything runs (for the proposal). */
export function pendingLines(ops) {
  const lines = []
  for (const p of consumedProducers(ops)) {
    const cap = getCapability(p.action)
    lines.push(cap.describeProduce ? cap.describeProduce(p.args) : `Run ${p.action}`)
  }
  for (const r of refsOf(ops)) {
    const src = getOutputSource(r.ref.from)
    if (src && !consumedProducers(ops).some(p => String(p.args.as) === r.ref.from)) lines.push(src.summary())
  }
  return [...new Set(lines)]
}

/**
 * Run the producers (fresh), substitute their actual symbols into the consumers.
 * → { ok:false, reason } | { ok:true, empty:boolean, ops, lines, outputs }
 * `ops` no longer contains the producers; substituted ops carry `trusted: true`
 * (their symbols came from UCT, not from model text).
 */
export async function resolveRefs(ops, host) {
  const bad = checkRefs(ops)
  if (bad) return { ok: false, reason: bad }
  const producers = consumedProducers(ops)
  const outputs = new Map()
  const lines = []
  for (const p of producers) {
    const cap = getCapability(p.action)
    let res
    try { res = await cap.produce(p.args, host) } catch (e) { return { ok: false, reason: e?.message || 'the screen did not run' } }
    outputs.set(String(p.args.as), res)
    lines.push(res.summary)
  }
  for (const r of refsOf(ops)) {
    if (outputs.has(r.ref.from)) continue
    const src = getOutputSource(r.ref.from)
    let res
    try { res = await src.resolve(host) } catch (e) { return { ok: false, reason: e?.message || 'that result is not available' } }
    outputs.set(r.ref.from, res)
    lines.push(res.summary)
  }
  let empty = false
  const out = []
  for (const op of ops) {
    if (producers.includes(op)) continue
    const cap = getCapability(op?.action)
    let args = op.args
    let trusted = false
    for (const [arg] of Object.entries(cap?.inputs || {})) {
      const v = args?.[arg]
      if (!isRef(v)) continue
      const res = outputs.get(v.from)
      const picked = (res?.symbols || []).slice(0, v.top ?? MAX_TOP)
      if (!picked.length) empty = true
      args = { ...args, [arg]: picked }
      trusted = true
    }
    out.push(trusted ? { ...op, args, trusted: true } : op)
  }
  return { ok: true, empty, ops: out, lines, outputs }
}
