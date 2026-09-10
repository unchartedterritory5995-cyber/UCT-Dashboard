/**
 * Wave Q1 — THE ONE PLACE THAT DECIDES WHAT COUNTS AS A BASELINE.
 *
 * ⚰️ THE DEFECT THIS EXISTS TO KILL. The baseline (`updatedAt` / `baseUpdatedAt`)
 * IS the compare-and-set. It was CHOSEN with `??` in eight places and CONSUMED
 * with truthiness in three:
 *
 *     producers:  saved?.updatedAt ?? entry.baseUpdatedAt ?? null      // nullish
 *     consumers:  ...(entry.baseUpdatedAt ? { baseUpdatedAt } : {})    // truthy
 *                 if (last.updatedAt) patch.baseUpdatedAt = ...
 *
 * `??` falls back only on `null`/`undefined`, so an **empty string survives as a
 * baseline** — and is then silently dropped at send time, producing a PUT with
 * no compare-and-set at all. Worse, in `commitSave` an ack carrying `''`
 * OVERWRITES a perfectly good baseline (`saved?.updatedAt ?? last.updatedAt`),
 * so every later save in that session goes out unguarded too.
 *
 * ⛔ MEASURED, NOT REASONED. `NoteEditorPage.nullbaseline.test.jsx` drove the
 * real page with a PUT that acks `updatedAt: ''` while the member keeps typing,
 * and read `baseUpdatedAt: ""` back out of the outbox. It passed in isolation
 * and failed in the full suite — the ordering of the coalescing durable write
 * against `markSynced` decides it, so under load it flips. An intermittent red
 * that is a real ordering-dependent defect, not a flaky test.
 *
 * ⛔ ONE AUTHORITY, ON PURPOSE. The same coalescing repeated at eight call sites
 * cannot be mutation-proved — delete every copy but one
 * (`lesson_a_guard_repeated_is_a_guard_unproved`). Every baseline choice in this
 * wave goes through `usableBaseline`.
 */

/**
 * The first candidate that is actually usable as a compare-and-set, or `null`.
 *
 * ⛔ `null` and `''` are the SAME answer here — "there is no baseline" — and
 * this normalises them to one, so a stored record can never carry a value that
 * reads as present to a producer and absent to a consumer.
 *
 * @param  {...unknown} candidates in preference order
 * @returns {string|null}
 */
export function usableBaseline(...candidates) {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() !== '') return c
  }
  return null
}

/** Is this value safe to send as a compare-and-set? The consumers' predicate,
 *  named once so it cannot drift from the producers' above. */
export const isUsableBaseline = (v) => usableBaseline(v) !== null

/**
 * ⭐ THE LANDED BASELINE — the one authority for "a save this browser has
 * already got the server to accept for this note".
 *
 * ⛔ ONLY A CLEAN RECORD WITNESSES A LANDED SAVE. A dirty record's baseline is
 * what its next send will *claim*, not what the server has acknowledged; reading
 * one as the other would let a queued entry vouch for itself.
 */
export function landedBaseline(record) {
  if (!record || record.dirty) return null
  return usableBaseline(record.baseUpdatedAt)
}

/**
 * Is `entryBaseline` older than a save this browser already landed?
 *
 * ⛔⛔ THE INVARIANT THIS EXISTS FOR: an entry never leaves the drain carrying a
 * baseline older than a save this same browser has already landed for that
 * note. Sending one cannot succeed — the server has moved past it — so it can
 * only 409 and fork, which is how a member with ONE device ends up with a
 * `(conflicted copy)` of their own note (2026-09-10).
 *
 * ⛔ PARSED, NOT STRING-COMPARED. ISO timestamps only sort lexicographically
 * while every one of them carries the same offset, and "it has always been
 * +00:00" is an assumption about a producer, not a property of the format.
 * Unparseable on either side ⇒ false: this decision DELETES queued member work,
 * so it refuses unless it is certain.
 */
export function isSupersededBaseline(entryBaseline, landed) {
  const a = usableBaseline(entryBaseline)
  const b = usableBaseline(landed)
  if (a === null || b === null) return false
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false
  return ta < tb
}
