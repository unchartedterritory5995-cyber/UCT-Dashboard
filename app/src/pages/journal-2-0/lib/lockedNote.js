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

/** Is this note payload locked? Only an explicit `true` locks. */
export const noteIsLocked = (note) => note?.locked === true

/** PATCH /api/j2/notes/{id}/lock — resolves on success, throws on anything else. */
export async function setNoteLock(noteId, locked, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(`/api/j2/notes/${encodeURIComponent(noteId)}/lock`, {
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
  return res
}
