// ── UCT Agent RUNTIME: commit → ACK → undo (capability-generic) ─────────────
//
// The only module that WRITES, and only through each target kind's registered
// `commit` — the feature's own canonical writer.
//
// ⭐ ACK IS READ BACK, NOT ASSUMED. After committing, wait a frame and re-read
// every target through its kind; only state that is actually there is reported
// as done.
// ⭐ FRESHNESS + STALE-UNDO ARE REVISION-CHECKED with the kind's `fingerprint`:
// a plan composed against state that moved is refused, and an undo is refused
// if the member has changed the target since the Agent wrote it.

import { getTargetKind } from './capabilities'

const nextFrame = () => new Promise(r => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(r, 0))
  else setTimeout(r, 0)
})

let _seq = 0

export async function commitPlan(host, plan) {
  const work = plan.plans.filter(p => p.changed)
  if (!work.length) return { ok: true, lines: [], failed: [], undo: null }

  for (const p of work) {
    const kind = getTargetKind(p.kind)
    const cur = kind.read(host, p.ref)
    if (!cur || kind.fingerprint(cur) !== kind.fingerprint(p.snap)) {
      return { ok: false, lines: [], failed: [{ ref: p.ref, label: p.snap.label, reason: 'changed while I was working — ask again' }], undo: null }
    }
  }
  for (const p of work) getTargetKind(p.kind).commit(host, p.ref, p.patch)
  await nextFrame()

  const failed = []
  const landed = []
  for (const p of work) {
    const kind = getTargetKind(p.kind)
    const snap = kind.read(host, p.ref)
    if (kind.landed(snap, p.patch)) {
      landed.push({ ref: p.ref, kind: p.kind, label: p.snap.label, lines: p.lines, before: p.snap, after: snap, patch: p.patch, afterFp: kind.fingerprint(snap) })
    } else {
      failed.push({ ref: p.ref, label: p.snap.label, reason: 'did not take effect' })
    }
  }
  const multi = plan.plans.length > 1
  const lines = landed.flatMap(it => (multi ? it.lines.map(l => `${it.label}: ${l}`) : it.lines))
  const undo = landed.length ? { id: `u${Date.now().toString(36)}${(_seq++).toString(36)}`, at: Date.now(), lines, items: landed } : null
  return { ok: failed.length === 0, lines, failed, undo }
}

/** All-or-nothing: if ANY target changed since the Agent wrote it, nothing is restored. */
export async function undoEntry(host, entry) {
  if (!entry) return { ok: false, lines: [], reason: 'There is nothing of mine to undo.' }
  for (const it of entry.items) {
    const kind = getTargetKind(it.kind)
    const cur = kind.read(host, it.ref)
    if (!cur) return { ok: false, lines: [], reason: `${it.label} is no longer on the workspace, so I can't undo that.` }
    if (kind.fingerprint(cur) !== it.afterFp) {
      return { ok: false, lines: [], reason: `${it.label} has changed since I made that change, so undoing it would overwrite your newer edits. Nothing was undone.` }
    }
  }
  const restores = entry.items.map(it => {
    const kind = getTargetKind(it.kind)
    const patch = kind.undoPatch(it)
    kind.commit(host, it.ref, patch)
    return { it, kind, patch }
  })
  await nextFrame()
  for (const { it, kind, patch } of restores) {
    if (!kind.landed(kind.read(host, it.ref), patch)) return { ok: false, lines: [], reason: `${it.label} did not return to its previous state.` }
  }
  return { ok: true, lines: entry.lines.length ? [`Undid: ${entry.lines.join(' · ')}`] : ['Undid my last change'] }
}
