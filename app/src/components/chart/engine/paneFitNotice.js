// app/src/components/chart/engine/paneFitNotice.js
//
// ─── ⭐ R-R — "A TABLE WAS SCALED" HAS TO CROSS ONE SUBTREE ─────────────────
//
// The object layer decides whether a table had to be scaled to fit a phone; the
// disclosure strip (`AttachedPineDisclosures`) is the surface that tells a member
// about it. They are different React subtrees, and the condition is a RUNTIME
// property of the viewport rather than of the saved document — so it cannot ride
// on `meta.disclosures` the way the alert and fold notes do.
//
// ⛔ SO IT IS A ONE-VALUE STORE, NOT A SECOND AUTHORITY OVER THE SENTENCE. What
// is published here is only WHETHER the condition holds; the words come from
// `closedTable.json::_tables_fit.memberNote`, like every other member note.
//
// ⛔ AND IT IS SESSION STATE, NOT PERSISTED. A viewport is not a document
// property; writing this anywhere durable would tell a member on a desktop that
// their tables were scaled because a phone once opened them.

const scaled = new Set()
const listeners = new Set()

const emit = () => { for (const fn of [...listeners]) { try { fn() } catch { /* a bad listener is not the store's problem */ } } }

/** Record whether THIS instance's tables are currently scaled. */
export function setPaneScaled(instanceId, isScaled) {
  if (!instanceId) return
  const had = scaled.has(instanceId)
  if (isScaled) scaled.add(instanceId)
  else scaled.delete(instanceId)
  if (had !== scaled.has(instanceId)) emit()
}

/** Is any attached pane currently scaling its tables? */
export function anyPaneScaled() { return scaled.size > 0 }

/** ⭐ Subscribe; returns the unsubscribe. The strip re-reads on change rather
 *  than polling, so a still chart costs nothing. */
export function onPaneScaleChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** ⛔ TEST SEAM. Module state that survives between cases is a test that passes
 *  because of the one before it. */
export function resetPaneScaled() { scaled.clear(); listeners.clear() }
