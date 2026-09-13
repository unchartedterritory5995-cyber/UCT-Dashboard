/**
 * Wave Q1 — WHICH NOTES ARE HOLDING WORDS THE SERVER WILL NEVER GET ON ITS OWN.
 *
 * `drainOutbox` settles such an entry by writing `permanent: true` on it and
 * leaving every word in place. That flag is the DECISION, already made and
 * already durable — this module reads it and does not re-derive it.
 *
 * ⛔ Do NOT re-classify here. A second copy of "what counts as blocked" (say,
 * re-testing the baseline) would silently disagree with the drain the day a
 * third block reason lands, and the surface would then contradict the queue
 * (`lesson_a_second_authority_over_one_value`). There is exactly one predicate,
 * it is `permanent === true`, and it is written in exactly one place
 * (`settleBlocked`).
 */
import { listOutbox } from './notebookDb'

/** The one predicate. Every BLOCKED outcome in `drainOutbox` persists this. */
export function isBlockedEntry(entry) {
  return entry?.permanent === true
}

/**
 * @returns {Promise<string[]>} note ids with at least one blocked entry.
 * The outbox is keyed `note:<id>`, so this is naturally one entry per note —
 * but it de-duplicates anyway rather than assuming a key shape it does not own.
 */
export async function listBlockedNoteIds(db) {
  const entries = await listOutbox(db)
  const ids = new Set()
  for (const e of entries) {
    if (isBlockedEntry(e) && e.noteId) ids.add(e.noteId)
  }
  return [...ids]
}
