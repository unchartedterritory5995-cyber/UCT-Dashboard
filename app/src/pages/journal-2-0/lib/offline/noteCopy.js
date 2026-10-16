/**
 * ⭐⭐ I-A FIX ROUND 1 — A QUEUED `(conflicted copy)`: the durable home for unsent
 * words a member's own swap pushed out of the durable record.
 *
 * When a crash-draft Restore, or an Undo or Redo across one, puts a page on
 * screen that does not carry the record's unsent words, `persist` writes those
 * words here in the SAME transaction as the record (`swapCaptureSpills`,
 * `recoverLocalState.js`). The entry sits in the outbox like any other — durable,
 * counted as pending — and the sweep (`drainOutbox`) turns it into a sibling note
 * with the same `fork` that makes every other `(conflicted copy)`. It is a NEW
 * note, so no editor owns it and nothing has to wait for the note to close.
 *
 * ⛔ ITS `noteId` IS NOT THE NOTE'S. Every per-note reader keys on the note id:
 * `putNoteWithIntent` deletes a note's entries through the `byNote` index when the
 * record settles clean, recovery finds "the note's queued entry" by note id, and
 * the door guard counts a note's entries. A copy is none of those things, so it is
 * keyed `copy:<note>:<digest>` and names its source in `copyOf`. A settle of the
 * note can never delete it, and it can never be mistaken for the note's own work.
 *
 * ⭐ Keyed by a digest of the words, so spilling the same words twice (an Undo,
 * a Redo, an Undo) queues ONE copy while it is still waiting.
 */
import { authoredDigest } from './recoverLocalState'

export const NOTE_COPY = 'note-copy'

export const isNoteCopy = (entry) => entry?.kind === NOTE_COPY

/** The server's `MAX_TITLE_CHARS` (`api/services/journal_two/notes.py`). ⛔ A
 *  mirror, so `noteCopy.test.js` PARSES the server constant and fails if the two
 *  ever differ — never restate it anywhere else. */
export const MAX_NOTE_TITLE_CHARS = 300
export const CONFLICTED_COPY_SUFFIX = ' (conflicted copy)'

/**
 * ⭐⭐ I-A fix round 3 (review C-3's cause): the title of a `(conflicted copy)`.
 * The server refuses a title over `MAX_NOTE_TITLE_CHARS` (after trimming,
 * counted in characters), and appending the suffix to a long title made every
 * such copy refused for good. The BASE title is shortened, never the suffix, and
 * it is cut by character (`[...s]`, as Python's `len` counts), never inside one.
 */
export function conflictedCopyTitle(title) {
  const base = String(title ?? '').trim() || 'Untitled note'
  const room = MAX_NOTE_TITLE_CHARS - [...CONFLICTED_COPY_SUFFIX].length
  const chars = [...base]
  const kept = chars.length > room ? chars.slice(0, room).join('').trimEnd() : base
  return `${kept}${CONFLICTED_COPY_SUFFIX}`
}

/**
 * @param noteId    the note the words were pushed out of
 * @param words     { title, subtitle, bodyJson } — the record's words
 * @param writtenSchema  the level of the editor that wrote them (B1), travels as is
 * @param sessionId the tab that queued it
 */
export function copyEntryFor({ noteId, words, writtenSchema, sessionId }) {
  const key = `copy:${noteId}:${authoredDigest(words)}`
  return {
    mutationId: key,
    noteId: key,
    copyOf: noteId,
    kind: NOTE_COPY,
    patch: {
      title: words?.title ?? '',
      subtitle: words?.subtitle ?? '',
      bodyJson: words?.bodyJson ?? null,
    },
    writtenSchema,
    sessionId,
    queuedAt: Date.now(),
  }
}
