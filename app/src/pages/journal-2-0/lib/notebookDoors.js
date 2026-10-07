/**
 * Finish program, lane KEYS3: the Notebook's doors, for the command palette.
 *
 * A keyboard member with the caret in a note was many Tab stops from the note's own actions:
 * the header is above the body and the chart tools below it (docs/notebook/fin-clicks.md,
 * Q9, Q12, Q22). The command palette (Ctrl+K) is the app's keyboard door, and it is one chord
 * from anywhere. A palette command names a door here; the surface that owns the action listens
 * and does what its own button does. The palette never imports that surface (it is app-wide
 * chrome and must not pull Notebook code into its chunk): this file is the whole contract.
 *
 * One event, one payload. The FIRST listener that takes a door claims it, so two charts in one
 * note do not both open a sheet. `openNotebookDoor` answers whether anything took it.
 *
 * Not a key listener: nothing here reads a key. The palette's own chord is declared in
 * pages/command/shortcutRegistry.js.
 */
export const NOTEBOOK_DOOR_EVENT = 'uct:notebook-door'

/** The doors. A name here is only a name: each owner decides what its door does. */
export const NOTEBOOK_DOORS = Object.freeze({
  VISUAL_PLAYBOOK: 'visual-playbook',     // FingerprintPanel: the chart's own "Visual playbook"
  EXPORT: 'export',                       // NoteExportControls: the note's Export menu
  ASK: 'ask',                             // AskPanel (scope "note"): Ask about the open note
})

/**
 * The door to the New note sheet (the template picker). It is a HASH on the notes list, like
 * lib/notebookSearchDoor.js, not an event: the sheet is mounted only in the list view, so the
 * palette goes there and the Notebook (tabs/NotebookTab.jsx) opens the sheet when it arrives.
 */
export const NOTEBOOK_TEMPLATES_HASH = '#templates'
export const NOTEBOOK_TEMPLATES_TO = `/journal/notebook?view=all${NOTEBOOK_TEMPLATES_HASH}`

/** Ask for a door. Returns true when a mounted surface took it. */
export function openNotebookDoor(door, extra = {}) {
  if (typeof window === 'undefined') return false
  const detail = { ...extra, door, claimed: false }
  window.dispatchEvent(new CustomEvent(NOTEBOOK_DOOR_EVENT, { detail }))
  if (!detail.claimed && door === NOTEBOOK_DOORS.VISUAL_PLAYBOOK && !detail.anyChart) {
    // No chart with a setup tag took it: any chart's panel may (see FingerprintPanel).
    return openNotebookDoor(door, { ...extra, anyChart: true })
  }
  return detail.claimed
}

/**
 * Listen for one door. `handler(detail)` returning `false` declines it (the next listener may
 * take it); anything else claims it. Returns the cleanup, so it sits in a useEffect.
 */
export function onNotebookDoor(door, handler) {
  if (typeof window === 'undefined') return () => {}
  const fn = (e) => {
    const d = e.detail
    if (!d || d.door !== door || d.claimed) return
    if (handler(d) !== false) d.claimed = true
  }
  window.addEventListener(NOTEBOOK_DOOR_EVENT, fn)
  return () => window.removeEventListener(NOTEBOOK_DOOR_EVENT, fn)
}

/** Is a note open at this location? (`/journal/notebook?note=<id>`, wide and phone alike.) */
export function noteOpenAt(location) {
  if (!location || !/^\/journal\/notebook\/?$/.test(location.pathname || '')) return false
  return new URLSearchParams(location.search || '').has('note')
}
