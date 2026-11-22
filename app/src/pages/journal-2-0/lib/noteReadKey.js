/**
 * The SWR key of ONE note's read: what `useJ2Note` (`hooks/useJ2Notes.js`) fetches and caches.
 *
 * Final fix pass, item 1: the list's outbox drain drops this key after it changes the server copy
 * of a note (`lib/offline/useOutboxDrain.js`), so a reopen loads the server copy instead of the
 * cached read from before those words. The editor's read and the drain's clear build the key here.
 * Four other writers still spell it by hand (round 2, A2; left so, for first-open bytes and because
 * 124 suites mock `useJ2Notes`): `hooks/useJ2Notes.js` (a revalidation after a favorite toggle, about line 438),
 * `hooks/useJ2NoteVersions.js` (a revalidation after a restore, about line 83), `tabs/NotebookTab.jsx`
 * (the new note's cache prime, about line 2075) and `components/notebook/styles/StyleHost.jsx` (the
 * applied note's cache prime, about line 83). A change to the key here must change those four too.
 */
export function noteReadKey(noteId) {
  return noteId ? `/api/j2/notes/${noteId}` : null
}
