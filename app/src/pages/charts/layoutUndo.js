// app/src/pages/charts/layoutUndo.js
//
// ⭐ A1.3b (owner Q7) — Undo for opening a layout, with the UCT Agent's `layout.open` rules
// (agent/capabilities/layout.js `undoPatch` / `fingerprintFor`), so a member's click and the
// Agent behave the same:
//  · Undo REOPENS the previous layout — the same open the Layout Dock does. A saved layout is
//    restored exactly as it was stored (your own layouts are flushed before a switch).
//  · ⛔ It is REFUSED when the switch discarded unsaved board state (UCT Default, a prebuilt
//    or a blank board with edits): that state is gone and cannot be restored accurately, so
//    the toast says so — it never claims the unsaved work was recovered.
//  · It is refused when there was no previous layout, when another layout has been opened
//    since, when the layout list changed, or when this board now has unsaved edits that a
//    switch back would discard.
// Pure: no React, no storage. The snapshot is the workspace's own (`agentLayoutsRef`).

const sigOf = (entries) => JSON.stringify((Array.isArray(entries) ? entries : []).map((e) => [e && e.id, e && e.name]))

/** What to remember when the member opens `to` from the board described by `snap`. */
export function planLayoutUndo(snap, to) {
  const s = snap || {}
  return {
    to: to ? { id: to.id, name: to.name || null } : null,
    from: s.active ? { id: s.active.id, name: s.active.name || null } : null,
    discarded: !!s.unsaved,
    entriesSig: sigOf(s.entries),
  }
}

export const LAYOUT_UNDO_SENTENCES = Object.freeze({
  'no-previous': "Can't undo: there was no saved layout open before.",
  discarded: "Can't undo: the previous board had unsaved changes that weren't kept, so it can't be restored.",
  changed: "Can't undo: the layouts changed since.",
  'unsaved-now': "Can't undo: this board has unsaved changes that switching back would discard.",
})

/** May the remembered open be undone NOW? `{ok:true, open}` | `{ok:false, reason, sentence}`. */
export function layoutUndoDecision(plan, snapNow) {
  const refuse = (reason) => ({ ok: false, reason, sentence: LAYOUT_UNDO_SENTENCES[reason] })
  if (!plan || !plan.to) return refuse('changed')
  if (!plan.from || plan.from.id === plan.to.id) return refuse('no-previous')
  if (plan.discarded) return refuse('discarded')
  const s = snapNow || {}
  if (!s.active || s.active.id !== plan.to.id) return refuse('changed')
  if (sigOf(s.entries) !== plan.entriesSig) return refuse('changed')
  if (!(Array.isArray(s.entries) && s.entries.some((e) => e && e.id === plan.from.id))) return refuse('changed')
  if (s.unsaved) return refuse('unsaved-now')
  return { ok: true, open: plan.from }
}
