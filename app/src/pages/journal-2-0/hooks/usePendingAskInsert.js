import { useEffect } from 'react'
import { appendAskInsert, takePendingAskInsert } from '../lib/askInsert'

/**
 * G-064 — consume an Ask Notebook answer that was picked for THIS note on
 * another page (spec §5.2), once the note is ready to take it.
 *
 * `ready` is the caller's whole gate: the note is hydrated in the editor, the
 * async draft-recovery decision has settled, and no recovered draft is pending
 * (a restore calls setContent and would erase the insert).
 *
 * ⛔ TAKE — and so REMOVE — BEFORE inserting: a StrictMode double effect or a
 * reload must never insert the same answer twice.
 *
 * ⛔⛔ THE INSERT MUST HAPPEN BEFORE `onResult` IS CONSULTED, NEVER INLINE
 * INSIDE THE OPTIONAL CALL. `onResult?.(appendAskInsert(editor, entry.node))`
 * looks equivalent and is not: per the optional-chaining spec, `a?.(args)`
 * short-circuits the WHOLE expression — including evaluating `args` — the
 * moment `a` is nullish, so a caller that omits `onResult` (as this hook's own
 * StrictMode test does) would silently never call `appendAskInsert` at all.
 * Measured: the inline form left the StrictMode test's editor untouched (0
 * inserts, not the expected 1) with `onResult` absent, and passed the instant
 * `onResult` was supplied. The fix is evaluating the side effect first.
 */
export default function usePendingAskInsert({ noteId, editor, ready, onResult }) {
  useEffect(() => {
    if (!ready || !noteId || !editor || editor.isDestroyed) return
    const entry = takePendingAskInsert(noteId)
    if (!entry) return
    const ok = appendAskInsert(editor, entry.node)
    onResult?.(ok)
  }, [noteId, editor, ready]) // eslint-disable-line react-hooks/exhaustive-deps
}
