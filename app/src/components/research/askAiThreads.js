// app/src/components/research/askAiThreads.js
//
// Per-symbol store for the Ask AI panel's conversation, so it survives a
// remount but not a company change.
//
// The modal UNMOUNTS inactive panels on purpose (GATE c — an ECharts instance
// that mounts at zero width never recovers), so clicking News and coming back to
// Ask AI is a remount. Without this, an answer the reader was halfway through
// would simply be gone.
//
// Module-level rather than a ref, because a ref dies with the component — which
// is precisely the remount this exists to survive. Not persisted: a thread is
// worth keeping while the modal is open, not across sessions.
//
// This is a LOCKER, not a second copy of the conversation. `AiSearchWidget` is
// the only thing that builds a turn; this hands the widget's own output back to
// it unchanged and never inspects or reshapes it.
const THREADS = new Map()

export function getThread(sym) {
  return sym ? THREADS.get(sym) || null : null
}

export function setThread(sym, thread) {
  if (sym) THREADS.set(sym, thread)
}

/** Test seam — a suite that asserts the restore must be able to start clean. */
export function resetThreads() {
  THREADS.clear()
}
