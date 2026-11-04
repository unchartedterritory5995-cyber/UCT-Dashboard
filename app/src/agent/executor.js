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

import { getCapability, getTargetKind, shapeError, normalizeArgs } from './capabilities'

// The CLIENT planner's ceiling, for every plan (fast path, references, expansions included): 24 units,
// an expansion counting once, 96 raw ops at most. A MODEL plan is held to 12 ops before it gets here
// (server turn.py MAX_OPS = contract/manifest.contract.json limits.maxOps; agentContracts.test.js).
export const MAX_OPS = 24

export const MIXED_REFUSAL = 'I can’t add new widgets and change existing ones in the same request here — ask in two steps: the new widgets first, then the change to the ones you already have.'

// Target kinds whose changes re-tile, replace or re-point the board itself: a request mixing them with new widgets keeps
// the refusal (the new widgets' placement depends on them, so neither order can be rolled back exactly).
const SPLIT_DENY_KINDS = new Set(['board', 'workspace', 'layouts'])

/**
 * ⭐ MISSION 3: "add a QQQ chart and change the SPY chart to weekly" — the ops of a plan refused ONLY as add + change-existing,
 * split into the part that creates (every creator op and every op aimed at what it creates) and the part that changes
 * targets that already exist. Each part is an ordinary plan of its own. Pure; null when the request can't be split safely:
 * an exclusive op (opening a layout), a change to the board / workspace / layouts themselves, or a change to an existing
 * target that names a new widget (its alias) in its arguments — those keep the refusal.
 * → { parts: [{ side: 'create'|'change', ops }] } in the member's order (the part whose first op came first runs first).
 */
export function splitMixedOps(opsIn) {
  if (!Array.isArray(opsIn) || opsIn.length < 2) return null
  const aliases = new Set()
  for (const op of opsIn) {
    const c = getCapability(op?.action)?.creates?.(op?.args || {})
    if (c?.alias) aliases.add(String(c.alias))
  }
  if (!aliases.size) return null
  const create = [], change = []
  let firstCreate = -1, firstChange = -1
  opsIn.forEach((op, i) => {
    const cap = getCapability(op?.action)
    const creating = !!cap?.creates?.(op?.args || {}) || aliases.has(String(op?.target))
    if (creating) { create.push(op); if (firstCreate < 0) firstCreate = i } else { change.push(op); if (firstChange < 0) firstChange = i }
  })
  if (!create.length || !change.length) return null
  // ⭐ CG-3 (corpus #769): new widgets + exactly ONE re-tile of the WHOLE board (widget.arrange, widgets null) is the one
  // board change allowed beside creation — run after the adds, so it arranges them too; one grouped Undo reverses both
  const arrangeAfter = change.length === 1 && change[0]?.action === 'widget.arrange' && change[0]?.args?.widgets == null
    && create.every(o => o?.action === 'widget.add' || o?.action === 'widget.addCharts' || aliases.has(String(o?.target)))
  for (const op of opsIn) if (getCapability(op?.action)?.exclusive && !getCapability(op?.action)?.sequential) return null
  for (const op of change) {
    const cap = getCapability(op?.action)
    if (!cap || cap.query || (SPLIT_DENY_KINDS.has(cap.target) && !arrangeAfter)) return null
    const args = JSON.stringify(op?.args ?? null)
    for (const a of aliases) if (args.includes(`"${a}"`)) return null
  }
  // CG-3: "put four charts on my screen" planned as new charts + ONE even re-tile of the whole board — the adds first, THEN
  // the re-tile of what is on the board then (its own plan, of the real widgets), whatever order the model wrote them in
  const parts = [{ side: 'create', ops: create, at: arrangeAfter ? -1 : firstCreate }, { side: 'change', ops: change, at: firstChange }]
    .sort((a, b) => a.at - b.at).map(({ side, ops }) => ({ side, ops }))
  return { parts }
}

export function planOps(targets, opsIn, env = {}, ctx = null) {
  const refusals = []
  if (!Array.isArray(opsIn) || opsIn.length === 0) {
    return { ok: false, refusals: [{ index: -1, reason: 'There was nothing to change.' }] }
  }
  // W1.1 R-01: the capability's declared args tolerance (capabilities.normalizeArgs — the browser half of the
  // server's turn.normalize_args) applies on EVERY path before the shape gate; the op objects given are never mutated
  const ops = opsIn.map(op => (op && op.args && typeof op.args === 'object' ? { ...op, args: normalizeArgs(op.action, op.args).args } : op))
  // An expanded request (compose.expandOps, e.g. "chart these 8") counts once.
  const units = new Set(ops.map((o, i) => (o?.fromExpand != null ? `x${o.fromExpand}` : `#${i}`))).size
  if (units > MAX_OPS || ops.length > MAX_OPS * 4) {
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
      // An action UCT Agent does not have says so (not "target missing" — it has no target kind at all).
      for (const { op, index } of items) refusals.push({ index, action: op?.action, target: ref, reason: (getCapability(op?.action) ? null : shapeError(op?.action, op?.args, ctx)) || 'That target is not on the workspace.' })
      continue
    }
    const kind = getTargetKind(tgt.kind)
    const before = kind.stateOf(tgt.snap)
    // `peer(ref)`: another target of this plan's kinds, READ ONLY, as the plan sees it (Charts operator P1:
    // "make this chart look like that one" reads the other chart). Only targets collected for this plan.
    const opEnv = { ...env, target: tgt.snap, resourcesInPlan, peer: (r) => (all.get(r)?.virtual ? null : all.get(r)?.snap || null) }
    let st = before
    const noops = []
    let confirm = false
    for (const { op, index } of items) {
      const bad = shapeError(op?.action, op?.args, ctx)
      if (bad) { refusals.push({ index, action: op?.action, target: ref, reason: bad }); continue }
      const cap = getCapability(op.action)
      if (cap.target !== tgt.kind) { refusals.push({ index, action: op.action, target: ref, reason: `${op.action} doesn't apply to that.` }); continue }
      // `trusted`: this op's symbols came from UCT itself (a screen, a saved list) — not model text.
      // `explicit`: the member's own words asked for this op (fast path / a capability's screen) — policy.js
      // `copy`: the member's own words asked for ANOTHER one (a capability's screen) — never the model's
      const oenv = op.trusted || op.explicit || op.copy ? { ...opEnv, ...(op.trusted ? { trusted: true } : {}), ...(op.explicit === true ? { explicit: true } : {}), ...(op.copy === true ? { copy: true } : {}) } : opEnv
      const why = cap.check(st, op.args, oenv)
      if (why) { refusals.push({ index, action: op.action, target: ref, reason: why }); continue }
      if (cap.confirmIf && cap.confirmIf(st, op.args, oenv)) confirm = true
      const next = cap.apply(st, op.args, oenv)
      // hotfix 2026-11-03 (live T1: "Already Daily · Already Daily" for two charts that did not exist yet): a NEW target's
      // defaults are only the planner's stand-in — an op that matches them is still carried into its creation
      // (createFlags), so it is never reported as "already" so
      if (next === st && cap.noop && !tgt.virtual) noops.push(cap.noop(st, st, op.args, oenv))
      st = next
    }
    // ⭐ PHASE 3 (receipts): how many targets of this kind the board has — one chart's change on a board of several
    // names the chart ("Chart (NVDA): Switched timeframe to Weekly"), as a change on several charts already does
    const siblings = [...targets.values()].filter(t => t.kind === tgt.kind && !t.virtual).length
    plans.push({ ref, kind: tgt.kind, snap: tgt.snap, virtual: !!tgt.virtual, before, after: st, items, noops, env: opEnv, confirm, siblings })
  }

  // A creating plan may only touch its creators and what it creates: mixing in
  // changes to EXISTING targets would need a general rollback to compensate.
  // ⭐ MISSION 3 (W2): `code: 'mixed'` — the runtime (useAgent) may instead run the request as TWO executions of this same
  // planner, in the member's order, with one grouped Undo (splitMixedOps); where it can't, this refusal stands.
  if (created.length) {
    const creatorRefs = new Set(created.map(c => c.op.target))
    const mixed = plans.filter(p => !p.virtual && !creatorRefs.has(p.ref))
    if (mixed.length) {
      refusals.push({ index: -1, code: 'mixed', reason: MIXED_REFUSAL })
    }
  }
  // An EXCLUSIVE capability (e.g. opening another layout) replaces what every other
  // target refers to, so it can't share a request with changes to other targets.
  const exclusive = ops.find(op => getCapability(op?.action)?.exclusive)
  if (exclusive && plans.some(p => p.ref !== exclusive.target)) {
    refusals.push({ index: -1, reason: getCapability(exclusive.action).exclusiveReason || 'Do that in two steps.' })
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
  const out = { ok: true, plans, lines: summarize(plans), changed, noops: plans.flatMap(p => p.noops) }
  // W1.1 review NB-3: the NORMALIZED ops (canonical arg keys) for the guards that run after planning
  // (protectionRefusal); non-enumerable, so a plan's shape and equality are unchanged
  Object.defineProperty(out, 'normalizedOps', { value: ops, enumerable: false })
  return out
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
  // A kind whose lines already name their target ("Added AMD to “Momentum”") is
  // never prefixed with its label again.
  const named = (p) => !!getTargetKind(p.kind)?.selfDescribing
  const multiReal = real.filter(p => p.lines.length).length > 1
  // ⭐ PHASE 3: a CHART's lines don't say which chart — on a board of several, the one change still names it
  const soloChart = (p) => p.kind === 'chart' && (p.siblings || 0) > 1
  for (const p of real) for (const l of p.lines) lines.push((multiReal || soloChart(p)) && !named(p) ? `${labelOf(p)}: ${l}` : l)
  if (virt.length === 1) {
    for (const l of virt[0].lines) lines.push(named(virt[0]) ? l : `${labelOf(virt[0])}: ${l}`)
  } else if (virt.length > 1) {
    const shared = virt[0].lines.filter(l => virt.every(p => p.lines.includes(l)))
    for (const l of shared) lines.push(`All ${virt.length} new: ${l}`)
    for (const p of virt) for (const l of p.lines) if (!shared.includes(l)) lines.push(named(p) ? l : `${labelOf(p)}: ${l}`)
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
  for (const [c, list] of byCap) {
    // Two capabilities may look up the same thing (every ticker check fills
    // `unknownSymbols`): Sets are UNIONED, never overwritten by the later one.
    for (const [k, v] of Object.entries(await c.prepare(list) || {})) {
      env[k] = v instanceof Set && env[k] instanceof Set ? new Set([...env[k], ...v]) : v
    }
  }
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
  // A kind may say which underlying thing its target is (`groupOf`: a chart's indicators → that chart).
  const targets = new Set(plan.plans.filter(p => p.changed && !p.virtual).map(p => getTargetKind(p.kind)?.groupOf?.(p.ref) ?? p.ref)).size
  const ops = plan.plans.reduce((n, p) => n + p.items.length, 0)
  // New things this plan brings into existence (capabilities mark themselves).
  const resources = plan.plans.reduce((n, p) => n + p.items.filter(i => getCapability(i.op.action)?.createsResource).length, 0)
  // `explicitOk` (policy.js): an op the member's own words asked for (op.explicit, set only by
  // deterministic checks of their text) does not count as confirm / irreversible on its own —
  // its capability's `confirmIf` (p.confirm) still does.
  const flagged = (i) => !(getCapability(i.op.action)?.explicitOk && i.op.explicit === true)
  const confirm = plan.plans.some(p => p.confirm || p.items.some(i => getCapability(i.op.action)?.risk === 'confirm' && flagged(i)))
  const irreversible = plan.plans.some(p => p.items.some(i => getCapability(i.op.action)?.reversible === false && flagged(i)))
  return { targets, ops, resources, confirm, irreversible }
}

// ── APPROVAL BINDING (Gate C safety fix, 2026-10-16) ──────────────────────────────────────────
// A proposal is approved for EXACTLY what it would do, on EXACTLY the state it was made from.
// Structured, not the card's wording: for every real target, its kind + id, its MATERIAL STATE
// (the kind's `approvalState`, else its `fingerprint`) and the planned PATCH (the canonical change
// the kind's own writer receives); for every target this plan creates, the ops aimed at it.
// "Do it" re-plans the stored ops against the state as it is then (useAgent) and runs only if the
// binding is identical — anything material that differs refuses the old approval.
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])]))
  return v === undefined ? null : v
}
export const canonicalJson = (v) => JSON.stringify(canon(v))
const stateOfTarget = (kind, p, host) => {
  try { return kind.approvalState ? kind.approvalState(p.snap, p.patch ?? null, host) : kind.fingerprint(p.snap) } catch { return '#unreadable' }
}
/** → { targets: { 'kind|ref': state }, change: canonical string } for an ok plan. */
export function approvalBinding(plan, host = null) {
  const targets = {}
  const change = []
  for (const p of plan?.plans || []) {
    if (p.virtual) { change.push(['new', p.ref, p.items.map(i => [i.op.action, i.op.args ?? null])]); continue }
    const kind = getTargetKind(p.kind)
    targets[`${p.kind}|${p.ref}`] = canonicalJson(stateOfTarget(kind, p, host))
    // `approvalPatch`: a kind whose patch at approval also carries the approval itself (a seal) drops it
    change.push([p.kind, p.ref, (kind.approvalPatch ? kind.approvalPatch(p.patch ?? null) : p.patch) ?? null])
  }
  return { targets, change: canonicalJson(change) }
}
/** Why `now` (the plan at approval) is not what `then` (the approved binding) was — or null.
 *  `subset` ("do the first two"): the ops are a prefix of the approved ones, so the change itself
 *  differs by construction; every target it touches must still be in exactly the approved state. */
export function bindingDrift(then, now, { subset = false } = {}) {
  if (!then || !now) return 'it can no longer be checked against what you approved'
  for (const [key, state] of Object.entries(now.targets)) {
    if (!(key in then.targets)) return 'it now touches something the proposal did not'
    if (then.targets[key] !== state) return 'what it acts on has changed since I showed it to you'
  }
  if (!subset && then.change !== now.change) return 'what it would do is no longer what I showed you'
  return null
}

/**
 * Honest receipts: when an applied plan offers NO Undo, the notes say how to reverse it — each
 * capability's own `undoNote` (e.g. the email digest). A receipt never implies an Undo that
 * isn't there; when Undo exists, nothing is added.
 */
export function undoNotesFor(plan, res) {
  if (!res?.ok || res.undo) return []
  return [...new Set(plan.plans.flatMap(p => p.items.map(i => getCapability(i.op.action)?.undoNote).filter(Boolean)))]
}
