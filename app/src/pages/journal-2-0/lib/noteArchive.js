/**
 * Wave 6 (lane E, item 1) — archive and unarchive ONE note.
 *
 * `PATCH /api/j2/notes/{id}/archive` with `{archived}` answers with the note.
 * Archive is not trash: nothing is deleted, the note keeps its folder, and it
 * still opens — it only leaves the default list, search, the quick switcher and
 * the graph, and is listed under the sidebar's Archived entry.
 *
 * ⛔ The server never advances the revision for this (a visibility flag, like a
 * favourite — `notes.set_note_archived` says why), so there is no NEW revision
 * to land. The returned note is settled anyway: landing the revision the server
 * reports is correct whatever it is, it costs one ring write, and it keeps the
 * rule "every note write goes through settleNoteWrite" true without an
 * exception anybody has to remember.
 */
import { settleNoteWrite } from './offline/settleNoteWrite'

export const ARCHIVED_FOLDER = '__archived__'

/** Is this note archived? */
export const noteIsArchived = (note) => Boolean(note?.archivedAt)

/**
 * Archive (`archived = true`) or unarchive one note. Resolves with the note the
 * server returned; throws (with `.status`) on anything but success.
 */
export async function setNoteArchived(noteId, archived, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(`/api/j2/notes/${encodeURIComponent(noteId)}/archive`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived: Boolean(archived) }),
  })
  if (!res || !res.ok) {
    const err = new Error(`archive request failed (${res?.status ?? 'network'})`)
    err.status = res?.status
    throw err
  }
  const note = (await res.json().catch(() => ({})))?.note ?? null
  await settleNoteWrite(noteId, note)
  return note
}
