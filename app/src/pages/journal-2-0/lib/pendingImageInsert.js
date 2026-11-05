/**
 * S12 (audit 2026-11-05, M9): the phone "+" sheet's "Photo / chart screenshot" row. The member picks an image on the
 * list (the file input must open inside the tap, iOS allows no later picker), a new note is made, and the image is
 * handed to THAT note's editor, which places it through its own image door (`handleImageInsert`: the same upload and
 * `setImage` a paste or the Insert menu's Image uses). So the image reaches the note through the editor's own
 * transaction -- autosave, compare-and-set, the outbox -- and never through a write of its own (R-12).
 *
 * One file, for one note id, taken once. A note opened later that is not that id never receives it.
 */
let pending = null

export function holdImageForNote(noteId, file) {
  pending = noteId && file ? { noteId, file } : null
}

export function takeImageForNote(noteId) {
  if (!pending || pending.noteId !== noteId) return null
  const { file } = pending
  pending = null
  return file
}
