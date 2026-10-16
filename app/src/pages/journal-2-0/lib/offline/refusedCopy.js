/**
 * ⭐⭐ I-A FIX ROUND 3 — A `(conflicted copy)` THE SERVER REFUSED TO CREATE.
 *
 * A queued copy (`noteCopy.js`) is words a member's own swap pushed out of a
 * note's durable record. The sweep turns it into a NEW note with
 * `forkConflictedCopy`. When the server refuses that create FOR GOOD, the words
 * stay on this device and the member decides what happens to them. This module
 * is the ONE place that decides "refused for good", writes that decision, and
 * carries out the member's choice. The drain (`outboxDrain.js`) and the editor
 * (`NoteEditorPage.jsx`) both call it.
 *
 * ⛔⛔ REVIEW C-3: A REFUSED COPY IS NEVER RESTORED INTO ITS SOURCE NOTE. Round
 * 2 offered it through the crash-draft Restore, and that PUT the copy over the
 * note's current server text, which no layer kept. Its only offers are:
 *   · "Save as a separate note": the same create again, as a new note;
 *   · "Discard": delete it from this device, after an in-page confirm.
 *
 * ⛔ REVIEW I-3: REFUSED FOR GOOD MEANS 400, 413 OR 422 FROM THE CREATE ITSELF.
 * Every failure of the source-note read, and 403/404/405/409 from anywhere,
 * describes the request (an edge, a session, a missing route, a switch), not
 * the copy. Those are transient and the next sweep tries again.
 *
 * ⛔ REVIEW I-4: A REFUSED COPY IS NOT A BLOCKED NOTE. Its source note's own
 * writes sync normally. It is not in `listBlockedNoteIds` and gets none of the
 * blocked surfaces; it is its own offer on that note.
 */
import { clearOutboxEntry, getOutboxEntry, putOutboxEntryIfPresent } from './notebookDb'
import { isNoteCopy } from './noteCopy'

/** Which request of the fork failed: the source-note read or the create. */
export const READ_PHASE = 'read'
export const CREATE_PHASE = 'create'
export const COPY_REFUSED_STATUSES = Object.freeze([400, 413, 422])

/** The one predicate. Anything else is transient and retried. */
export const copyRefusedForGood = (err) => (
  err?.phase === CREATE_PHASE && COPY_REFUSED_STATUSES.includes(err?.status)
)

function refusalOf(err) {
  const detail = typeof err?.detail === 'string' && err.detail.trim() ? err.detail.trim() : null
  return { status: err?.status ?? null, error: String(err?.message || err), detail, at: Date.now() }
}

/**
 * Mark a copy refused, keeping every word. ⛔ Only if it is still there (one
 * transaction): a refusal coming back after a Discard must not resurrect it.
 * `permanent` stays so a bundle that predates copies skips it instead of
 * sending it as a note update.
 */
export async function holdRefusedCopy(db, entry, err) {
  const message = String(err?.message || err)
  return putOutboxEntryIfPresent(db, {
    ...entry,
    permanent: true,
    copyRefused: refusalOf(err),
    lastError: message,
    lastStatus: err?.status ?? null,
    attempts: (entry.attempts || 0) + 1,
  })
}

export const isRefusedCopy = (entry) => isNoteCopy(entry) && Boolean(entry?.copyRefused)

/** The plain-words reason the offer shows (sentence case, no jargon). */
export function refusedCopyReason(entry) {
  const detail = entry?.copyRefused?.detail
  const said = detail ? ` The server said: ${detail.replace(/[.\s]+$/, '')}.` : ''
  return 'A copy of this note’s words couldn’t be saved as a separate note, so it’s kept on this device.'
    + `${said} Save as a separate note tries again. Discard deletes the copy from this device.`
}

/** What the editor needs to offer one refused copy. */
export function refusedCopyView(entry) {
  return {
    mutationId: entry.mutationId,
    title: entry.patch?.title ?? '',
    subtitle: entry.patch?.subtitle ?? '',
    bodyJson: entry.patch?.bodyJson ?? null,
    reason: refusedCopyReason(entry),
  }
}

/** The refused copies of `noteId`, newest refusal first. */
export function refusedCopiesOf(entries, noteId) {
  return (entries || [])
    .filter((e) => isRefusedCopy(e) && e.copyOf === noteId)
    .sort((a, b) => (b.copyRefused?.at || b.queuedAt || 0) - (a.copyRefused?.at || a.queuedAt || 0))
    .map(refusedCopyView)
}

/**
 * "Save as a separate note": the create again, through the same `fork`.
 * @returns {Promise<{outcome: 'saved'|'refused'|'failed'|'gone', copy?: object}>}
 *   saved   — the new note exists and the copy is gone from this device;
 *   refused — refused for good again: kept, re-marked, still offered (`copy`);
 *   failed  — a transient failure: kept exactly as it was;
 *   gone    — it was no longer on this device.
 */
export async function saveRefusedCopy(db, mutationId, { fork }) {
  const entry = await getOutboxEntry(db, mutationId)
  if (!isNoteCopy(entry)) return { outcome: 'gone' }
  try {
    await fork({ ...entry, noteId: entry.copyOf })
  } catch (err) {
    if (!copyRefusedForGood(err)) return { outcome: 'failed' }
    await holdRefusedCopy(db, entry, err)
    const now = await getOutboxEntry(db, mutationId)
    return { outcome: 'refused', copy: now ? refusedCopyView(now) : null }
  }
  await clearOutboxEntry(db, mutationId)
  return { outcome: 'saved' }
}

/** "Discard", confirmed: the copy is deleted from this device. */
export async function discardRefusedCopy(db, mutationId) {
  await clearOutboxEntry(db, mutationId)
}
