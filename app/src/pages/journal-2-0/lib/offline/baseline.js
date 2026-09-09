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
