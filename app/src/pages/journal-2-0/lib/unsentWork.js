// Follow-up A (first-open bytes): the one piece of lib/noteBatch.js the editor needs on first open, apart from the
// bulk actions' library (which the notes list now fetches on demand). noteBatch.js re-exports it, so there is one copy.

/** The RAW "words not yet on the server" answer from a `noteHasUnsentWork`
 *  verdict, whatever the door-guard mode: in DOOR_GUARD_UNKNOWN_ONLY a dirty or
 *  queued note answers `unsent: false` with `why: 'guard-unknown-only'`. */
export function holdsUnsentWork(verdict) {
  return Boolean(verdict?.unsent) || verdict?.why === 'guard-unknown-only'
}
