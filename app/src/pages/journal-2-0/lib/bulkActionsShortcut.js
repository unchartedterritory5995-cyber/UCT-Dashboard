/**
 * Wave 13, lane 13Q-5 — a keyboard shortcut that jumps focus straight into the
 * bulk-action bar once a selection exists, instead of a member paying the
 * Tab-walk the click-budget instrument measured: 167-179 real Tab presses to
 * reach "Tags" / "Move to select" from a just-ticked row, because the bar sits
 * above a notes list that can hold far more rows than the member just selected
 * (docs/notebook/evidence/wave13-13q3/run-remeasure-final/clicks.json, Q11).
 *
 * Same convention as `dailyNote.js`'s `isDailyShortcut` (Ctrl+Alt+D): a
 * physical-KEY check (`e.code`, never `e.key` — Option changes what a Mac
 * types, so `e.key` for Option+B is "∫", not "b"), Ctrl OR Cmd so one check
 * covers both platforms, and the AltGr guard (several layouts spell AltGr as
 * Ctrl+Alt, and AltGr+B types a real character a member meant to type).
 */
export function isBulkActionsShortcut(e) {
  if (!e || !e.altKey || e.shiftKey) return false
  if (!(e.ctrlKey || e.metaKey)) return false
  if (typeof e.getModifierState === 'function' && e.getModifierState('AltGraph')) return false
  return e.code === 'KeyB'
}

/** The chord as a member reads it — the visible hint and the shortcuts sheet. */
export function bulkActionsChordLabel() {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || '')
  return mac ? 'Cmd+Option+B' : 'Ctrl+Alt+B'
}
