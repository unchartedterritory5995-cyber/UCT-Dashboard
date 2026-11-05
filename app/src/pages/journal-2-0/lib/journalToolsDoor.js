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
