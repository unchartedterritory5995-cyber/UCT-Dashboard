import { useCallback, useEffect, useState } from 'react'
import { settleNoteWrite } from './offline/settleNoteWrite'
import { BLOCKED_TITLE } from './offline/unsyncedCopy'

/**
 * ⛔⛔ THE ONE WAY A VIEW SETS A PROPERTY ON A NOTE.
 *
 * The board (drag a card between columns) and the calendar (drag a note to
 * another day) do the same thing to the same field through the same endpoint.
 * That is exactly the shape this repo has been burned by: a guard copied twice
 * is a guard that can be mutation-proved in neither copy, because killing one
 * leaves the other green (`lesson_a_guard_repeated_is_a_guard_unproved`). So
 * there is one implementation, and its rails kill BOTH consumers at once.
 *
 * ⛔⛔ EVERY WRITE RECORDS ITS REVISION. A `PUT /notes/{id}` that advances
 * `updatedAt` and tells the durable layer nothing makes guard 2's
 * `serverCopyIsOurs` answer "not ours" about this browser's own write, and the
 * drain FORKS the note. Five of the first six doors shipped without recording;
 * that is measured and it was live in production. `settleNoteWrite` is not
 * optional politeness, and it must stay INSIDE this hook so a future third
 * consumer cannot forget it.
 *
 * ⛔⛔ AN OVERRIDE EXPIRES WHEN THE SERVER SPEAKS, NOT WHEN IT AGREES.
 * The optimistic value is keyed on the note's `updatedAt` at the moment of the
 * write. Once the revision advances the override is dropped unconditionally —
 * whether the new value is the one we sent (our save landed) or a different one
 * (somebody edited it in the editor). Dropping only on AGREEMENT keeps the
 * stale value in precisely the case that matters, which is the bug this
 * replaced: a map nothing ever cleared, under a comment claiming the parent's
 * re-fetch cleared it.
 *
 * ⛔ A BLOCKED NOTE IS REFUSED, OUT LOUD. A note whose words have not reached
 * the server is the one a member must not be told they have filed, and the
 * refusal carries the wave's own sentence rather than a new one.
 *
 * @param notes          the notes currently on screen (the expiry signal)
 * @param blockedNoteIds Set of note ids with unsent work
 * @param onChanged      called after a write lands, so the parent can re-fetch
 */
export function useOptimisticNoteProperty({ notes, blockedNoteIds, onChanged }) {
  const [overrides, setOverrides] = useState({})
  const [busy, setBusy] = useState({})
  const [error, setError] = useState('')

  // Retire every override whose note has since moved on. Keyed on the notes the
  // parent handed us, so it fires exactly when new server truth arrives.
  useEffect(() => {
    setOverrides((m) => {
      const ids = Object.keys(m)
      if (!ids.length) return m
      const next = {}
      let dropped = false
      for (const id of ids) {
        const note = (notes || []).find((n) => n.id === id)
        if (note && note.updatedAt !== m[id].at) { dropped = true; continue }
        next[id] = m[id]
      }
      return dropped ? next : m
    })
  }, [notes])

  /**
   * Write one property on one note.
   * @returns true when it landed, false when it was refused or failed.
   */
  const setProperty = useCallback(async (note, propertyId, value) => {
    if (!note || !propertyId) return false
    const blocked = blockedNoteIds || new Set()
    if (blocked.has?.(note.id)) {
      setError(BLOCKED_TITLE)
      return false
    }
    setError('')
    setOverrides((m) => ({ ...m, [note.id]: { value, at: note.updatedAt } }))
    setBusy((b) => ({ ...b, [note.id]: true }))
    try {
      const res = await fetch(`/api/j2/notes/${note.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // ⛔ MERGE (`properties`), never `propertiesReplace` — a view must not
        // clobber properties it never displayed.
        body: JSON.stringify({ properties: { [propertyId]: value } }),
      })
      if (!res.ok) throw new Error(`save failed (${res.status})`)
      // ⛔⛔ THE LINE THAT STOPS A FORK.
      await settleNoteWrite(note.id, res)
      if (onChanged) onChanged()
      return true
    } catch (e) {
      // ⛔ Roll back to where it CAME FROM by dropping the override entirely.
      // Rolling forward to a default would be a value the member never chose.
      setOverrides((m) => {
        const next = { ...m }
        delete next[note.id]
        return next
      })
      setError('That did not save. The note has been put back.')
      return false
    } finally {
      setBusy((b) => {
        const next = { ...b }
        delete next[note.id]
        return next
      })
    }
  }, [blockedNoteIds, onChanged])

  /** The optimistic value for a note, or undefined when the server's stands. */
  const overrideFor = useCallback((noteId) => overrides[noteId]?.value, [overrides])

  return {
    setProperty,
    overrideFor,
    isBusy: useCallback((noteId) => Boolean(busy[noteId]), [busy]),
    error,
    clearError: useCallback(() => setError(''), []),
  }
}

export default useOptimisticNoteProperty
