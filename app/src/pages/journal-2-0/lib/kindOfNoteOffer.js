// Kind of note is OFFERED only while journal styles are on (spec P1.7c: the switch gates creating, never
// rendering). EVERY client door that lists properties to offer one -- Add property, the board's group-by,
// the autofill suggestions -- asks this ONE predicate, so a dark feature cannot leak through a door that
// forgot to ask. Server twin: note_kinds.offered() (autofill and AI organise).
import { journalStylesEnabled } from './journalStylesFlag'
import { NOTE_KIND_PROPERTY } from './noteKinds'

/**
 * May this property be OFFERED right now? Any property but Kind of note: yes. Kind of note: only with the
 * switch on, or when `keepId` already names it (a saved board grouped by it is rendering, not offering).
 */
export function isOfferable(prop, keepId = null) {
  if (!prop || prop.id !== NOTE_KIND_PROPERTY) return true
  return journalStylesEnabled() || keepId === NOTE_KIND_PROPERTY
}
