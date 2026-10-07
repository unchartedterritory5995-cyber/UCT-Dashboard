// ── UCT Agent PLANNER: validate ALL → compose → receipt lines ───────────────
//
// PURE and capability-generic: it knows no feature. For each target named by
// the ops it reads the target's state through its registered target kind,
// runs every op's capability check + apply in request order, and returns the
// composed final state per target with deterministic receipt lines computed
// from BEFORE → AFTER. One refused op refuses the whole request — no target is
// ever left half-transformed.
//
//   op = { action, target, args }      target = a real ref from the host, or a
//                                      transaction-local ALIAS declared earlier in
//                                      the same plan by a capability's creates()
//   targets = Map<ref, { kind, snap }>
//
// ⭐ COMPOUND CREATION. A capability may declare `creates(args)` (e.g. widget.add
// with `as: "new1"`). The planner gives that alias a VIRTUAL target (the kind's
// `virtual()` defaults) so every op aimed at it is validated before anything is
// written. The runtime resolves aliases to real refs after creating them; an
// alias never leaves the transaction.

import { getCapability, getTargetKind, shapeError } from './capabilities'

export const MAX_OPS = 24

export function planOps(targets, ops, env = {}, ctx = null) {
  const refusals = []
  if (!Array.isArray(ops) || ops.length === 0) {
    return { ok: false, refusals: [{ index: -1, reason: 'There was nothing to change.' }] }
  }
  if (ops.length > MAX_OPS) {
    return { ok: false, refusals: [{ index: -1, reason: `That's more than ${MAX_OPS} changes at once — split it up.` }] }
  }

  // ── pre-pass: aliases created by this plan become virtual targets ──
  const all = new Map(targets)
  const created = []                                   // [{ alias, kind, index, op }]
  ops.forEach((op, index) => {
    const cap = getCapability(op?.action)
    const c = cap?.creates && op?.args ? cap.creates(op.args) : null
    if (!c) return
    if (all.has(c.alias)) {
      refusals.push({ index, action: op.action, target: op.target, reason: `“${c.alias}” is used twice in one request.` })
      return
    }
    const kind = getTargetKind(c.kind)
    if (!kind?.virtual) {
      refusals.push({ index, action: op.action, target: op.target, reason: 'That new widget cannot be configured in the same request yet.' })
      return
    }
    created.push({ alias: c.alias, kind: c.kind, index, op })
    all.set(c.alias, { kind: c.kind, snap: kind.virtual({ alias: c.alias, n: created.length, spec: c.spec }), virtual: true, createdBy: index })
  })

  const order = []
  const groups = new Map()
  ops.forEach((op, index) => {
    const t = op && op.target
    if (!groups.has(t)) { groups.set(t, []); order.push(t) }
    groups.get(t).push({ op, index })
  })
  for (const t of order) {
    const tgt = all.get(t)
    if (tgt?.virtual && groups.get(t).some(({ index }) => index < tgt.createdBy)) {
      refusals.push({ index: -1, target: t, reason: `“${t}” is used before it is created.` })
    }
  }

  // How many new resources the WHOLE plan creates (capabilities may phrase a
  // refusal for the request as a whole, not for the op being checked).
  const resourcesInPlan = ops.filter(op => getCapability(op?.action)?.createsResource).length

  const plans = []
  for (const ref of order) {
    const items = groups.get(ref)
    const tgt = all.get(ref)
    if (!tgt) {
      for (const { op, index } of items) refusals.push({ index, action: op?.action, target: ref, reason: 'That target is not on the workspace.' })
      continue
    }
    const kind = getTargetKind(tgt.kind)
    const before = kind.stateOf(tgt.snap)
    const opEnv = { ...env, target: tgt.snap, resourcesInPlan }
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
    plans.push({ ref, kind: tgt.kind, snap: tgt.snap, virtual: !!tgt.virtual, before, after: st, items, noops, env: opEnv })
  }

  // A creating plan may only touch its creators and what it creates: mixing in
  // changes to EXISTING targets would need a general rollback to compensate.
  if (created.length) {
    const creatorRefs = new Set(created.map(c => c.op.target))
    const mixed = plans.filter(p => !p.virtual && !creatorRefs.has(p.ref))
    if (mixed.length) {
      refusals.push({ index: -1, reason: 'Adding widgets and changing existing ones in one request isn’t supported yet — do it in two steps.' })
    }
  }
  if (refusals.length) return { ok: false, refusals }

  // Creation-time flags the created kind asks for (e.g. unlink a new chart that
  // gets its own symbol), handed to the creator plan through its after-state.
  for (const c of created) {
    const vp = plans.find(p => p.ref === c.alias)
    const kind = getTargetKind(c.kind)
    const flags = vp && kind.createFlags ? kind.createFlags(vp.items.map(i => i.op)) : {}
    const creator = plans.find(p => p.ref === c.op.target)
    if (creator?.after?.creates) {
      creator.after = { ...creator.after, creates: creator.after.creates.map(x => (x.alias === c.alias ? { ...x, flags } : x)) }
    }
  }

  let changed = false
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
    p.changed = !!p.patch || p.virtual
    if (p.changed) changed = true
  }
  return { ok: true, plans, lines: summarize(plans), changed, noops: plans.flatMap(p => p.noops) }
}

/**
 * Receipt/proposal lines. Real targets: their own lines (prefixed by label when
 * several are touched). Created targets: a line every one of them shares is said
 * ONCE for the group; anything else is said per new target. Deterministic.
 */
export function summarize(plans, labelOf = (p) => p.snap.label) {
  const real = plans.filter(p => !p.virtual)
  const virt = plans.filter(p => p.virtual)
  const lines = []
  const multiReal = real.filter(p => p.lines.length).length > 1
  for (const p of real) for (const l of p.lines) lines.push(multiReal ? `${labelOf(p)}: ${l}` : l)
  if (virt.length === 1) {
    for (const l of virt[0].lines) lines.push(`${labelOf(virt[0])}: ${l}`)
  } else if (virt.length > 1) {
    const shared = virt[0].lines.filter(l => virt.every(p => p.lines.includes(l)))
    for (const l of shared) lines.push(`All ${virt.length} new: ${l}`)
    for (const p of virt) for (const l of p.lines) if (!shared.includes(l)) lines.push(`${labelOf(p)}: ${l}`)
  }
  return lines
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
  // Targets that already exist (new ones are counted as resources instead).
  const targets = plan.plans.filter(p => p.changed && !p.virtual).length
  const ops = plan.plans.reduce((n, p) => n + p.items.length, 0)
  // New things this plan brings into existence (capabilities mark themselves).
  const resources = plan.plans.reduce((n, p) => n + p.items.filter(i => getCapability(i.op.action)?.createsResource).length, 0)
  const confirm = plan.plans.some(p => p.items.some(i => getCapability(i.op.action)?.risk === 'confirm'))
  const irreversible = plan.plans.some(p => p.items.some(i => getCapability(i.op.action)?.reversible === false))
  return { targets, ops, resources, confirm, irreversible }
}
