/**
 * Wave 6 item 8 — a LOCKED note (the editor's half; lane E owns the field).
 * (Not the offline layer's per-note owner lock, which is a Web Lock.)
 *
 * Lane E adds `locked: boolean` to the note payload and
 * `PATCH /api/j2/notes/{id}/lock` with `{ locked }`. A lock prevents ACCIDENTAL
 * edits, as Notion's does: the editor is read-only and says so, and one button
 * turns it off. The server stores the flag but does NOT refuse body writes (a
 * queued offline edit must never become a conflict), so this is enforced here,
 * in the editor, and nowhere else.
 *
 * ⛔ The lock is `editable = false`, never a transaction filter. Every surface
 * that changes the note already asks `editor.isEditable` (find-and-replace, the
 * Ask insert, the table/callout/image/math controls, the block grip); a filter
 * refusing their transactions instead would let a surface believe it had placed
 * something it had not — the capture tray consumes its inbox row once placed,
 * so a silent refusal there would LOSE the capture.
 */
import { settleNoteWrite } from './offline/settleNoteWrite'

/** Is this note payload locked? Only an explicit `true` locks. */
export const noteIsLocked = (note) => note?.locked === true

/**
 * PATCH /api/j2/notes/{id}/lock — resolves with the note the server returned
 * (null when it returned none), throws on anything else.
 *
 * ⛔⛔ A LOCK CHANGE IS A NOTE WRITE, SO THIS IS A DOOR AND IT LANDS ITS REVISION.
 * ⚰️ Wave 6 fix round 1, I1 (wave6-D-review.md): the endpoint advances the
 * note's `updatedAt` like every metadata writer in `notes.py`, and this used to
 * throw the answer away. The member's first save after Unlock then went out on
 * the pre-unlock revision (a 409 on their own write), and a drain later asked
 * "is the server's revision ours?", found nothing recorded, and FORKED the note.
 * `settleNoteWrite` is the ONE way a revision is landed (`offline/settleNoteWrite.js`
 * header ledger); it reads the answer, `{note}` envelope or bare note, and never
 * throws. The editor settles its own durable copy on top (NoteEditorPage
 * `unlockNote`), exactly as `useJ2Note.update` lands a PUT and the editor's
 * `settleMetadataRevision` settles it.
 *
 * ⛔ A LITERAL `fetch(` WITH THE ROUTE IN IT, on purpose: the door-enumeration
 * rail (`offline/doorEnumeration.test.js` ③) finds every client write by exactly
 * that shape, and a write it cannot see is a write nobody checks lands. (It used
 * to be an injected `fetchImpl(`, invisible to it.)
 */
export async function setNoteLock(noteId, locked) {
  const res = await fetch(`/api/j2/notes/${encodeURIComponent(noteId)}/lock`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locked: Boolean(locked) }),
  })
  if (!res || !res.ok) {
    const err = new Error(`lock request failed (${res?.status ?? 'network'})`)
    err.status = res?.status
    throw err
  }
  let body = null
  try { body = await res.json() } catch { body = null }
  await settleNoteWrite(noteId, body)
  const note = body && typeof body === 'object' && body.note && typeof body.note === 'object' ? body.note : body
  return note && typeof note === 'object' ? note : null
}
