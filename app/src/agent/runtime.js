// ── UCT Agent RUNTIME: commit → ACK → undo (capability-generic) ─────────────
//
// The only module that WRITES, and only through each target kind's registered
// `commit` — the feature's own canonical writer.
//
// ⭐ ACK IS READ BACK, NOT ASSUMED. After committing, wait a frame and re-read
// every target through its kind; only state that is actually there is reported
// as done.
// ⭐ FRESHNESS + STALE-UNDO ARE REVISION-CHECKED with the kind's `fingerprint`
// (or `fingerprintFor`, when a kind can narrow it to what one item owns): a plan
// composed against state that moved is refused, and an undo is refused if the
// member has changed the target since the Agent wrote it.
// ⭐ COMPOUND CREATION. Creators commit first (they may be async and return
// `{ created: { alias: realRef } }`); every op aimed at an alias is then
// RE-PLANNED against the real new target and committed through its own writer.
// If anything fails after the first write, everything this transaction did is
// undone (newest first) and the failure is reported — never a half-built board.

import { getTargetKind } from './capabilities'
import { planOps, summarize } from './executor'
import { mark } from './trace'

const nextFrame = () => new Promise(r => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(r, 0))
  else setTimeout(r, 0)
})

/** Wait (a bounded TIME, not a frame count — several heavy widgets may be
 *  mounting at once) for a freshly created target to be readable. */
async function waitForTarget(kind, host, ref, budgetMs = 8000) {
  const t0 = Date.now()
  for (;;) {
    const snap = kind.read(host, ref)
    if (snap) return snap
    if (Date.now() - t0 > budgetMs) return null
    await nextFrame()
  }
}

const fpOf = (kind, host, snap, item) => (kind.fingerprintFor ? kind.fingerprintFor(host, snap, item) : kind.fingerprint(snap))

let _seq = 0

/** Reverse already-landed items, newest first. Returns true if all reversed. */
async function compensate(host, landed) {
  let ok = true
  // A kind may take back a step differently from a member's Undo (`compensatePatch`):
  // a list this transaction CREATED is removed again, though Undo never deletes one.
  const backOf = (kind, it) => (kind.compensatePatch ? kind.compensatePatch(it) : kind.undoPatch(it))
  for (const it of [...landed].reverse()) {
    const kind = getTargetKind(it.kind)
    const back = backOf(kind, it)
    if (!back) { ok = false; continue }
    try {
      await kind.commit(host, it.ref, back)
    } catch { ok = false }
  }
  await nextFrame()
  for (const it of landed) {
    const kind = getTargetKind(it.kind)
    const back = backOf(kind, it)
    if (back && !kind.landed(kind.read(host, it.ref), back)) ok = false
  }
  return ok
}

export async function commitPlan(host, plan, { env = {}, ctx = null } = {}) {
  const real = plan.plans.filter(p => p.changed && !p.virtual)
  const virt = plan.plans.filter(p => p.virtual)
  if (!real.length && !virt.length) return { ok: true, lines: [], failed: [], undo: null }

  // Freshness gate: the plan was composed against `before`; if a real target
  // moved under it (the member edited while the model was thinking), refuse
  // rather than overwrite their edit with a plan built on stale state.
  for (const p of real) {
    const kind = getTargetKind(p.kind)
    const cur = kind.read(host, p.ref)
    if (!cur || kind.fingerprint(cur) !== kind.fingerprint(p.snap)) {
      return { ok: false, lines: [], failed: [{ ref: p.ref, label: p.snap.label, reason: 'changed while I was working — ask again' }], undo: null }
    }
  }

  const landed = []
  const aliases = {}
  const fail = async (label, reason) => {
    const restored = await compensate(host, landed)
    return {
      ok: false, lines: [], undo: null, compensated: restored,
      failed: [{ label, reason: restored ? `${reason} — nothing was left changed` : `${reason} — and some changes could not be reversed` }],
    }
  }

  // 1 — real targets (creators included), in plan order
  for (const p of real) {
    const kind = getTargetKind(p.kind)
    let res
    try { res = await kind.commit(host, p.ref, p.patch) } catch (e) { return fail(p.snap.label, `failed (${e?.message || 'error'})`) }
    if (res && res.created) Object.assign(aliases, res.created)
    await nextFrame()
    const snap = kind.read(host, p.ref)
    if (!kind.landed(snap, p.patch)) {
      // A creator may have made some of its resources before failing; its result
      // says which, so compensation closes exactly those.
      if (res && res.created && Object.keys(res.created).length) {
        landed.push({ ref: p.ref, kind: p.kind, label: p.snap.label, lines: [], before: p.snap, after: snap, patch: p.patch, partial: res.created })
      }
      return fail(p.snap.label, 'did not take effect')
    }
    landed.push({ ref: p.ref, kind: p.kind, label: p.snap.label, lines: p.lines, before: p.snap, after: snap, patch: p.patch, created: res?.created || null })
  }

  // 2 — created targets: resolve the alias, re-plan on the REAL target, commit
  const vlanded = []
  for (const p of virt) {
    const kind = getTargetKind(p.kind)
    const realRef = aliases[p.ref]
    if (!realRef) return fail(p.snap.label, 'was not created')
    mark(`target:wait`, p.ref)
    const snap = await waitForTarget(kind, host, realRef)
    mark(`target:ready`, p.ref)
    if (!snap) return fail(p.snap.label, 'never became available')
    const ops = p.items.map(i => ({ ...i.op, target: realRef }))
    const re = planOps(new Map([[realRef, { kind: p.kind, snap }]]), ops, env, ctx)
    if (!re.ok) return fail(p.snap.label, re.refusals[0]?.reason || 'could not be configured')
    const rp = re.plans[0]
    if (rp.patch) {
      try { await kind.commit(host, realRef, rp.patch) } catch (e) { return fail(p.snap.label, `failed (${e?.message || 'error'})`) }
      await nextFrame()
      mark(`target:committed`, p.ref)
      if (!kind.landed(kind.read(host, realRef), rp.patch)) return fail(p.snap.label, 'did not take effect')
    }
    // The target did not exist before this request, so its receipt is what was
    // PLANNED for it — every chart op is "set to X", so after the re-planned
    // commit landed, the real target is in exactly that state.
    vlanded.push(p)
  }

  // One logical receipt from what actually landed.
  const lines = summarize([...landed.map(it => ({ virtual: false, kind: it.kind, lines: it.lines, snap: { label: it.label } })), ...vlanded])

  // Stale-undo fingerprints are taken at the END of the whole transaction, so the
  // Agent's own configuration of a new target never reads as a later edit.
  const items = landed.map(it => {
    const kind = getTargetKind(it.kind)
    const cur = kind.read(host, it.ref)
    const done = { ...it, after: cur || it.after }
    return { ...done, afterFp: fpOf(kind, host, cur || it.after, done) }
  })
  // A kind may say a change has no Undo (undoPatch → null): then the receipt offers none.
  const undoable = items.length && items.every(it => getTargetKind(it.kind).undoPatch(it) != null)
  // Board identity matters only for targets that live ON the board (a saved watchlist
  // is the same list whichever layout is open).
  const boardBound = items.some(it => getTargetKind(it.kind).boardScoped !== false)
  const epoch = boardBound && typeof host.epoch === 'function' ? host.epoch() : null
  const undo = undoable ? { id: `u${Date.now().toString(36)}${(_seq++).toString(36)}`, at: Date.now(), lines, items, epoch } : null
  return { ok: true, lines, failed: [], undo }
}

/** All-or-nothing: if ANY target changed since the Agent wrote it, nothing is restored. */
export async function undoEntry(host, entry) {
  if (!entry) return { ok: false, lines: [], reason: 'There is nothing of mine to undo.' }
  // Never across a board change: after a layout switch the same refs can name
  // widgets on a DIFFERENT board.
  if (entry.epoch != null && typeof host.epoch === 'function' && host.epoch() !== entry.epoch) {
    return { ok: false, lines: [], reason: 'A different layout is open now, so undoing that could change the wrong board. Nothing was undone.' }
  }
  for (const it of entry.items) {
    const kind = getTargetKind(it.kind)
    const cur = kind.read(host, it.ref)
    if (!cur) return { ok: false, lines: [], reason: `${it.label} is no longer on the workspace, so I can't undo that.` }
    if (fpOf(kind, host, cur, it) !== it.afterFp) {
      return { ok: false, lines: [], reason: `${it.label} has changed since I made that change, so undoing it would overwrite your newer edits. Nothing was undone.` }
    }
  }
  const restores = []
  for (const it of [...entry.items].reverse()) {
    const kind = getTargetKind(it.kind)
    const patch = kind.undoPatch(it)
    await kind.commit(host, it.ref, patch)
    restores.push({ it, kind, patch })
  }
  await nextFrame()
  for (const { it, kind, patch } of restores) {
    if (!kind.landed(kind.read(host, it.ref), patch)) return { ok: false, lines: [], reason: `${it.label} did not return to its previous state.` }
  }
  return { ok: true, lines: entry.lines.length ? [`Undid: ${entry.lines.join(' · ')}`] : ['Undid my last change'] }
}
