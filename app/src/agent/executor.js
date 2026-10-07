// ── UCT Agent PLANNER: validate ALL → compose → receipt lines ───────────────
//
// PURE and capability-generic: it knows no feature. For each target named by
// the ops it reads the target's state through its registered target kind,
// runs every op's capability check + apply in request order, and returns the
// composed final state per target with deterministic receipt lines computed
// from BEFORE → AFTER. One refused op refuses the whole request — no target is
// ever left half-transformed.
//
//   op = { action, target, args }      target = a real ref from the host
//   targets = Map<ref, { kind, snap }>

import { getCapability, getTargetKind, shapeError } from './capabilities'

export const MAX_OPS = 12

export function planOps(targets, ops, env = {}, ctx = null) {
  const refusals = []
  if (!Array.isArray(ops) || ops.length === 0) {
    return { ok: false, refusals: [{ index: -1, reason: 'There was nothing to change.' }] }
  }
  if (ops.length > MAX_OPS) {
    return { ok: false, refusals: [{ index: -1, reason: `That's more than ${MAX_OPS} changes at once — split it up.` }] }
  }
  const order = []
  const groups = new Map()
  ops.forEach((op, index) => {
    const t = op && op.target
    if (!groups.has(t)) { groups.set(t, []); order.push(t) }
    groups.get(t).push({ op, index })
  })

  const plans = []
  for (const ref of order) {
    const items = groups.get(ref)
    const tgt = targets.get(ref)
    if (!tgt) {
      for (const { op, index } of items) refusals.push({ index, action: op?.action, target: ref, reason: 'That target is not on the workspace.' })
      continue
    }
    const kind = getTargetKind(tgt.kind)
    const before = kind.stateOf(tgt.snap)
    const opEnv = { ...env, target: tgt.snap }
    let st = before
    const noops = []
    for (const { op, index } of items) {
      const bad = shapeError(op?.action, op?.args, ctx)
      if (bad) { refusals.push({ index, action: op?.action, target: ref, reason: bad }); continue }
      const cap = getCapability(op.action)
      if (cap.target !== tgt.kind) { refusals.push({ index, action: op.action, target: ref, reason: `${op.action} doesn't apply to that.` }); continue }
      const why = cap.check(st, op.args, opEnv)
      if (why) { refusals.push({ index, action: op.action, target: ref, reason: why }); continue }
      const next = cap.apply(st, op.args, opEnv)
      if (next === st && cap.noop) noops.push(cap.noop(st, st, op.args, opEnv))
      st = next
    }
    plans.push({ ref, kind: tgt.kind, snap: tgt.snap, before, after: st, items, noops, env: opEnv })
  }
  if (refusals.length) return { ok: false, refusals }

  const lines = []
  let changed = false
  const multi = plans.length > 1
  for (const p of plans) {
    const kind = getTargetKind(p.kind)
    const seen = new Set()
    p.lines = []
    for (const { op } of p.items) {
      const key = `${op.action}:${JSON.stringify(op.args)}`
      if (seen.has(key)) continue
      seen.add(key)
      const line = getCapability(op.action).describe(p.before, p.after, op.args, p.env)
      if (line && !p.lines.includes(line)) p.lines.push(line)
    }
    p.patch = kind.patch(p.before, p.after)
    p.changed = !!p.patch
    if (p.changed) changed = true
    for (const l of p.lines) lines.push(multi ? `${p.snap.label}: ${l}` : l)
  }
  return { ok: true, plans, lines, changed, noops: plans.flatMap(p => p.noops) }
}

/** Run every capability's optional async `prepare` (lookups) before planning. */
export async function prepareOps(ops) {
  const byCap = new Map()
  for (const op of ops) {
    const c = getCapability(op?.action)
    if (c?.prepare) { if (!byCap.has(c)) byCap.set(c, []); byCap.get(c).push(op) }
  }
  const env = {}
  for (const [c, list] of byCap) Object.assign(env, await c.prepare(list))
  return env
}

/** Collect current targets of every kind the ops name, from the host. */
export function collectTargets(host, kinds) {
  const m = new Map()
  for (const k of kinds) {
    const kind = getTargetKind(k)
    if (!kind) continue
    for (const snap of kind.list(host)) m.set(snap.ref, { kind: k, snap })
  }
  return m
}

/** The plan's footprint and strictest risk, for the confirmation policy. */
export function planShape(plan) {
  const targets = plan.plans.filter(p => p.changed).length
  const ops = plan.plans.reduce((n, p) => n + p.items.length, 0)
  const confirm = plan.plans.some(p => p.items.some(i => getCapability(i.op.action)?.risk === 'confirm'))
  const irreversible = plan.plans.some(p => p.items.some(i => getCapability(i.op.action)?.reversible === false))
  return { targets, ops, confirm, irreversible }
}
