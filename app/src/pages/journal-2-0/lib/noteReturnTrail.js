/**
 * Wave 10 lane D2, fix round 1 (review I-1): where the phone's "Back to notes" goes.
 *
 * ⛔ KEYED TO HISTORY ENTRIES, NEVER TO A NOTE ID. The first version remembered the
 * note `openNote` opened and went back one entry while that note was open. The editor
 * also pushes entries that keep the same `?note=` -- an Ask citation into this note's
 * own PDF (`?note=A&doc=D&page=N`, then a `replace` strips doc/page), a review
 * citation (`?note=A&review=R`) -- so one step back landed on the same note (a dead
 * tap) and the second tap closed to Research Home, losing the list.
 *
 * The trail is the run of history entries since the member left a list for a note:
 * `keys[0]` is the entry `openNote` pushed over the list, `at` is where the member is
 * in that run now. Every entry key comes from the router (`useLocation().key`) and
 * every step from its navigation type, so "Back to notes" goes back exactly `at + 1`
 * entries -- to the list, whatever was pushed or replaced inside the note.
 *
 * A trail exists only while it is TRUE: a POP to an entry it does not know, a note
 * reached with no list under it (a pasted link) or a list on screen clears it, and the
 * caller then closes the note instead (`closeNote`), which never navigates blind.
 *
 * Rail: tabs/NotebookTab.phoneNote.test.jsx and lib/noteReturnTrail.test.js.
 */

/**
 * The next trail after one navigation.
 * @param {null|{keys:string[], at:number}} trail
 * @param {{type:'PUSH'|'REPLACE'|'POP', key:string, noteOpen:boolean, fromList:boolean}} step
 *   `fromList`: this PUSH is `openNote` leaving a list (no note was open).
 */
export function stepTrail(trail, { type, key, noteOpen, fromList }) {
  if (!noteOpen) return null
  if (type === 'PUSH') {
    if (fromList) return { keys: [key], at: 0 }
    if (!trail) return null
    const keys = trail.keys.slice(0, trail.at + 1).concat(key)
    return { keys, at: keys.length - 1 }
  }
  if (!trail) return null
  if (type === 'REPLACE') {
    const keys = trail.keys.slice()
    keys[trail.at] = key
    return { keys, at: trail.at }
  }
  const at = trail.keys.indexOf(key)
  return at < 0 ? null : { keys: trail.keys, at }
}

/** How many entries back the list is from the entry `key` (0 = not known: close instead). */
export function stepsBackToList(trail, key) {
  if (!trail || trail.keys[trail.at] !== key) return 0
  return trail.at + 1
}
