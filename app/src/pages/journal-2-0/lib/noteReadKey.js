/**
 * The SWR key of ONE note's read: what `useJ2Note` (`hooks/useJ2Notes.js`) fetches and caches.
 *
 * Final fix pass, item 1: the list's outbox drain drops this key after it changes the server copy
 * of a note (`lib/offline/useOutboxDrain.js`), so a reopen loads the server copy instead of the
 * cached read from before those words. Both read the key from here, so it is written once.
 */
export function noteReadKey(noteId) {
  return noteId ? `/api/j2/notes/${noteId}` : null
}
