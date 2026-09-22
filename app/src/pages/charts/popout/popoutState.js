// S1 CP3 SHOULD (gate fc609961a): `popout(panel)` as a named, stable wrapper
// over the existing, already-working PopoutWindow/PopoutShell/PoppedLayout
// mechanism. ChartsWorkspace.jsx's own pop-out/dock state transitions were
// three inline `setPoppedWidgetIds` callbacks with no shared name a future
// caller (a chart widget's context menu, a keyboard shortcut) could call
// without re-deriving the exact list semantics (append-if-absent, filter-out).
//
// These are pure functions over the `poppedWidgetIds` array — ChartsWorkspace
// still owns the `useState`/`useCallback` wiring (the array itself, and the
// side effect of also removing the underlying widget on
// popoutRemoveWidgetIds). Zero behavior change: each function is the exact
// body the inline callback used to run, extracted so it has one name and one
// test, per GATE-S1-CP3 §2's "stable call signature added on top of what
// already ships."

/** Pop `id` onto its own window. Append-if-absent — popping an already-popped
 *  widget a second time is a no-op, never a duplicate entry. */
export function popoutAddWidgetId(poppedWidgetIds, id) {
  return poppedWidgetIds.includes(id) ? poppedWidgetIds : [...poppedWidgetIds, id]
}

/** Dock `id` back into the main board — a popped widget stays in
 *  layout.widgets throughout (its grid position is never lost), so docking is
 *  purely removing it from the popped-id list. */
export function popoutRemoveWidgetId(poppedWidgetIds, id) {
  return poppedWidgetIds.filter((x) => x !== id)
}
