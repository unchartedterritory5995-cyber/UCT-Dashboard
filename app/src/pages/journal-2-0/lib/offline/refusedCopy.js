/**
 * ⭐⭐ I-A FIX ROUND 3 — A `(conflicted copy)` THE SERVER REFUSED TO CREATE.
 *
 * A queued copy (`noteCopy.js`) is words a member's own swap pushed out of a
 * note's durable record. The sweep turns it into a NEW note with
 * `forkConflictedCopy`. When the server refuses that create FOR GOOD, the words
 * stay on this device and the member decides what happens to them. This module
 * is the ONE place that decides "refused for good" and writes that decision; its
 * display half (`refusedCopyDisplay.js`, see below) carries out the member's
 * choice. The drain (`outboxDrain.js`) and the durable layer (`useDurableNote.js`)
 * both call it.
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
 *
 * ⭐⭐ I-A FIX ROUND 4 (review I-6, I-7): THE OFFER SHOWS THE WORDS AND SPEAKS FOR ITSELF.
 *   · The view carries the copy's words as plain text (`bodyText`), so the offer and the
 *     Discard confirm can show them and "Copy text" can put them on the clipboard.
 *     Nobody is asked to delete words they cannot see.
 *   · After a CONTENT refusal (413, or a 400/422 whose reason is the body) the create
 *     can never succeed as it is, so the offer is "Save as plain text": the same fork,
 *     the same title and subtitle, the body flattened to plain paragraphs. The stored
 *     copy keeps its ORIGINAL words until a create lands.
 *   · The server's refusal sentence is never shown. It was written for the note's own
 *     editor ("Move part of it out a level", "it wasn't saved"). The offer picks its own
 *     sentence by refusal class; the server's detail stays in the stored record only,
 *     for diagnosis.
 *
 * ⭐⭐ I-A FIX ROUND 5 (review C-4, I-8, M-18).
 *   · ⛔⛔ A PLAIN SAVE NEVER DELETES THE COPY. Plain text cannot hold everything a
 *     body can, so after "Save as plain text" lands the stored copy is KEPT, with its
 *     original words, and marked `copyRefused.plainSaved`. Only an explicit Discard
 *     removes it. ("Save as a separate note" sends the FULL body, so its landing may
 *     still clear the copy.)
 *   · The plain-text walk (preview, Copy text, the plain body) carries the words held
 *     in node ATTRIBUTES too: the app's own leaf text (`citationLeafText`, the table
 *     search and Ask read) and, for what that table does not read, a per-type list.
 *   · A 400/422 that names no reason is `other`, not `content`.
 *
 * ⭐⭐ I-A BYTES — THIS IS THE DECISION HALF, AND IT STAYS STATIC. The drain
 * (`outboxDrain.js`) and the durable layer (`useDurableNote.js`) run it on every open:
 * "refused for good" (`copyRefusedForGood`), holding the copy with every word
 * (`holdRefusedCopy`), and which held copies a note has (`refusedCopiesOf`). Everything
 * reached only from the offer — the plain-text walk, the refusal class and sentence, the
 * view, Save and Discard — is the DISPLAY half, `refusedCopyDisplay.js`, which rides in
 * the offer's own chunk and loads only when an offer exists. Nothing here may import it
 * (rail: `components/notebook/RefusedCopyOffer.lazy.test.js`).
 */
import { putOutboxEntryIfPresent } from './notebookDb'
import { isNoteCopy } from './noteCopy'

/** Which request of the fork failed: the source-note read or the create. */
export const READ_PHASE = 'read'
export const CREATE_PHASE = 'create'
export const COPY_REFUSED_STATUSES = Object.freeze([400, 413, 422])

/** The one predicate. Anything else is transient and retried. */
export const copyRefusedForGood = (err) => (
  err?.phase === CREATE_PHASE && COPY_REFUSED_STATUSES.includes(err?.status)
)

/** `plain`: the refused create was the plain-text one ("Save as plain text"). */
function refusalOf(err, { plain = false } = {}) {
  // ⛔ Review I-7: the server's sentence is kept HERE, for diagnosis, and never shown.
  const detail = typeof err?.detail === 'string' && err.detail.trim() ? err.detail.trim() : null
  return {
    status: err?.status ?? null, error: String(err?.message || err), detail, at: Date.now(),
    ...(plain ? { plain: true } : {}),
  }
}

/**
 * Mark a copy refused, keeping every word. ⛔ Only if it is still there (one
 * transaction): a refusal coming back after a Discard must not resurrect it.
 * `permanent` stays so a bundle that predates copies skips it instead of
 * sending it as a note update. ⛔ `entry` is the STORED copy: a refused plain-text
 * create re-marks the copy with its original words, never the flattened ones.
 */
export async function holdRefusedCopy(db, entry, err, { plain = false } = {}) {
  const message = String(err?.message || err)
  return putOutboxEntryIfPresent(db, {
    ...entry,
    permanent: true,
    copyRefused: refusalOf(err, { plain }),
    lastError: message,
    lastStatus: err?.status ?? null,
    attempts: (entry.attempts || 0) + 1,
  })
}

export const isRefusedCopy = (entry) => isNoteCopy(entry) && Boolean(entry?.copyRefused)

/** The refusal classes (`refusedCopyDisplay.copyRefusalClass` decides which one applies). */
export const COPY_TOO_LARGE = 'too-large'
export const COPY_CONTENT = 'content'
export const COPY_OTHER = 'other'

/**
 * The refused copies of `noteId`, newest refusal first: the STORED records, each holding
 * every word. This is how a note knows it has an offer to show; the offer builds its view
 * of each one (`refusedCopyDisplay.refusedCopyView`) in its own chunk.
 */
export function refusedCopiesOf(entries, noteId) {
  return (entries || [])
    .filter((e) => isRefusedCopy(e) && e.copyOf === noteId)
    .sort((a, b) => (b.copyRefused?.at || b.queuedAt || 0) - (a.copyRefused?.at || a.queuedAt || 0))
}
