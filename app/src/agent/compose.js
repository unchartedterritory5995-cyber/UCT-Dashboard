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
// A consumer may also EXPAND (capability.expand): once its input is a concrete
// ticker list, it is replaced by the ordinary ops it stands for (widget.addCharts →
// widget.add + chart.setSymbol per ticker), so building runs through the SAME
// creators, placement, compensation and Undo as any request — never a second path.
//
// Before approval: references are validated and shown as pending ("the top 20
// results"); nothing runs. At APPLY: producers run fresh, the actual symbols replace
// the references, and the plan is re-planned and committed like any other — no model
// call, and nothing is written if a producer fails or a reference comes back empty.

import { getCapability, getOutputSource, isRef, allCapabilityNames } from './capabilities'
import { mark } from './trace'

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

/**
 * A reference may name a context TARGET instead of a producer's alias — e.g.
 * {from: "<a saved watchlist's ref>"}: the production model does this (measured
 * 2026-10-07). It is bound here to that target kind's own READ-ONLY producer
 * (watchlist.show for a list), so the source is read fresh at apply exactly as if
 * the model had written the producer itself. Nothing else is accepted: the target
 * must be one the context listed (refMap), and its kind must register a query
 * capability that produces the input's type. → ops (producers first)
 */
export function bindSourceRefs(ops, refMap) {
  const aliases = new Set((ops || []).filter(o => getCapability(o?.action)?.produces && o.args?.as).map(o => String(o.args.as)))
  const added = new Map()
  const out = []
  for (const op of ops || []) {
    const cap = getCapability(op?.action)
    let args = op.args
    for (const [arg, type] of Object.entries(cap?.inputs || {})) {
      const v = args?.[arg]
      if (!isRef(v) || aliases.has(v.from)) continue
      const t = refMap?.[v.from]
      if (!t) continue
      const prod = allCapabilityNames().map(getCapability).find(c => c.target === t.kind && c.produces === type && c.query)
      if (!prod) continue
      const alias = `src_${v.from}`
      if (!added.has(alias)) {
        const blank = Object.fromEntries(Object.keys(prod.args?.properties || {}).map(k => [k, null]))
        added.set(alias, { action: prod.name, target: t.ref, args: { ...blank, as: alias } })
      }
      args = { ...args, [arg]: { from: alias, top: v.top } }
    }
    out.push(args === op.args ? op : { ...op, args })
  }
  return [...added.values(), ...out]
}

/** A sentence if any reference is malformed or points at nothing it may use. */
export function checkRefs(ops, host = null) {
  // Producers count wherever they sit in the plan (they always run before any
  // consumer at apply) — the model sometimes lists the consumer first.
  const seen = new Map()                                // alias → produced type
  for (const op of ops || []) {
    const cap = getCapability(op?.action)
    if (cap?.produces && op.args?.as) seen.set(String(op.args.as), cap.produces)
  }
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
  }
  // A producer's own arguments are checked BEFORE anything is proposed (a screen
  // with an unknown field never reaches a proposal, let alone a write).
  for (const p of consumedProducers(ops)) {
    const why = getCapability(p.action).validateProduce?.(p.args, p.target, host)
    if (why) return why
  }
  return null
}

/** What will run, said before anything runs (for the proposal). */
export function pendingLines(ops, host = null) {
  const lines = []
  for (const p of consumedProducers(ops)) {
    const cap = getCapability(p.action)
    lines.push(cap.describeProduce ? cap.describeProduce(p.args, p.target, host) : `Run ${p.action}`)
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
  const bad = checkRefs(ops, host)
  if (bad) return { ok: false, reason: bad }
  const producers = consumedProducers(ops)
  const outputs = new Map()
  const lines = []
  for (const p of producers) {
    const cap = getCapability(p.action)
    let res
    // The producer's own TARGET (e.g. which saved watchlist) travels with it.
    mark(`produce:${p.action}`)
    try { res = await cap.produce(p.args, host, p.target) } catch (e) { return { ok: false, reason: e?.message || 'that source could not be read' } }
    mark(`produced:${p.action}`, (res?.symbols || []).length)
    outputs.set(String(p.args.as), res)
    lines.push(res.summary)
  }
  for (const r of refsOf(ops)) {
    if (outputs.has(r.ref.from)) continue
    const src = getOutputSource(r.ref.from)
    let res
    mark(`resolve:${r.ref.from}`)
    try { res = await src.resolve(host) } catch (e) { return { ok: false, reason: e?.message || 'that result is not available' } }
    mark(`resolved:${r.ref.from}`, (res?.symbols || []).length)
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
    const asked = {}                                    // arg → the `top` the member asked for
    for (const [arg] of Object.entries(cap?.inputs || {})) {
      const v = args?.[arg]
      if (!isRef(v)) continue
      const res = outputs.get(v.from)
      const picked = (res?.symbols || []).slice(0, v.top ?? MAX_TOP)
      if (!picked.length) empty = true
      args = { ...args, [arg]: picked }
      asked[arg] = v.top
      trusted = true
    }
    out.push(trusted ? { ...op, args, trusted: true, asked } : op)
  }
  return { ok: true, empty, ops: out, lines, outputs }
}

/**
 * Replace every op whose capability can EXPAND (and whose inputs are concrete)
 * with the ordinary ops it stands for. → { ok:false, reason } | { ok:true, ops, lines }
 * `lines` are the expansions' own receipt lines (used only once the ops landed).
 */
export function expandOps(ops) {
  const out = []
  const lines = []
  const proposal = []
  let k = 0
  for (const op of ops || []) {
    const cap = getCapability(op?.action)
    const pending = Object.keys(cap?.inputs || {}).some(a => isRef(op.args?.[a]))
    if (!cap?.expand || pending) { out.push(op); continue }
    k += 1
    const r = cap.expand(op.args || {}, { key: k, asked: op.asked || {}, target: op.target })
    if (r.error) return { ok: false, reason: r.error }
    // `fromExpand` groups the ops one request stands for (the planner's op budget
    // counts the REQUEST, not its expansion); `trusted` carries over (symbols that
    // came from UCT's own Screener / saved list are not looked up again).
    out.push(...r.ops.map(o => ({ ...o, fromExpand: k, ...(op.trusted ? { trusted: true } : {}) })))
    if (r.line) lines.push(r.line)
    if (r.proposal) proposal.push(r.proposal)
  }
  return { ok: true, ops: out, lines, proposal, expanded: k > 0 }
}
