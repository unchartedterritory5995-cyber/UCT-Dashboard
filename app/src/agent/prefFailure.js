// ⛔ INV2 (2026-11-23): a preference write the server refused keeps its OPTIMISTIC value in this tab's cache (usePreferences'
// settle contract — MOB-09), so a kind whose write failed may still SHOW the change until a reload. "Nothing was left changed"
// (runtime.js commitPlan.fail) may be said only when a READ-BACK proves the old value is what this tab holds now; otherwise
// the failure carries `keptNote`, which says exactly that instead.
export const MAY_SHOW_UNTIL_RELOAD = 'this tab may keep showing it until you reload, but it is NOT saved'

/** The error a kind throws for a failed preference write. `unchanged`: a read-back proved the old value is back. */
export function prefWriteFailed(message, { unchanged = false, note = MAY_SHOW_UNTIL_RELOAD } = {}) {
  const e = new Error(message)
  if (!unchanged) e.keptNote = note
  return e
}

/** A read-back that never throws: true only when `read()` answers and equals `expected` (compared as JSON). */
export function readsBack(read, expected) {
  try { return JSON.stringify(read() ?? null) === JSON.stringify(expected ?? null) } catch { return false }
}
