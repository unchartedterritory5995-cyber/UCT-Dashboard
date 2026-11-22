// Tier 2 fix round 1 (review Important 1): on the phone Notebook the Journal header's tools (Log Trade, Help,
// account, report, settings, More) fold away, and their one door is a "Journal tools" row in the Notebook's own ⋯
// menu -- never a control laid over the section strip (that hid Insights and Compass, undoing D2).
//
// The header may fold only while a page offers that door, so the tools are never stranded: the Notebook list
// registers the door while its ⋯ toolbar is on screen; Home, an open note and the research page do not, and there
// the folded "Journal tools" toggle stays in the header as before. Module state, read with useSyncExternalStore.
let doors = 0
const listeners = new Set()
const emit = () => { for (const fn of Array.from(listeners)) fn() }

export const OPEN_JOURNAL_TOOLS_EVENT = 'uct:open-journal-tools'

export function subscribeJournalToolsDoor(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const journalToolsDoorMounted = () => doors > 0

/** A page's "Journal tools" door is on screen: returns the release. */
export function registerJournalToolsDoor() {
  doors += 1
  emit()
  let released = false
  return () => {
    if (released) return
    released = true
    doors -= 1
    emit()
  }
}

/** Open the Journal header's tools (JournalLayout listens), focus moving into them. */
export function openJournalTools() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OPEN_JOURNAL_TOOLS_EVENT))
}

/** Final polish: an OPEN NOTE's address on the Notebook route (`?note=`). The note's ⋯ carries the "Journal tools"
 *  row too (NoteEditorPage), so the phone header folds there from the first paint, as on the list. */
export function isNotebookNoteAddress(pathname, search, notebookPath) {
  if (String(pathname || '').replace(/\/+$/, '').toLowerCase() !== notebookPath.toLowerCase()) return false
  return Boolean(new URLSearchParams(search || '').get('note'))
}

/** The Notebook LIST's own address (the page that offers the door): the Notebook route itself, no note open, and
 *  not the Daily brief (`?view=today`). Notebook simplify, Task 5: the Notebook opens on the list, so the bare address,
 *  `?view=all`, a view mode, `?view=home` (Research home's old address) and a folder, tag or ticker filter are all the
 *  list. JournalLayout folds the header on it from the FIRST paint, before the list has mounted and registered (a
 *  header painted and then folded moved the strip and the notes up 57 px: a 0.05 layout shift, measured with
 *  lib/clsDebug.js). A view this build does not know opens the list too, so it folds as well. (⚰️ It also took the
 *  view mode ids and the member's chosen landing; neither changes the answer any more.) */
export function isNotebookListAddress(pathname, search, notebookPath) {
  if (String(pathname || '').replace(/\/+$/, '').toLowerCase() !== notebookPath.toLowerCase()) return false
  const sp = new URLSearchParams(search || '')
  if (sp.get('note')) return false
  const filtered = Boolean(sp.get('folder') || sp.get('tag') || sp.get('ticker'))
  return filtered || sp.get('view') !== 'today'
}
