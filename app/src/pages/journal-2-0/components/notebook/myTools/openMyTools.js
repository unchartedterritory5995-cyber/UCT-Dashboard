// Notebook widgets phase 2 (wave 8, Task 8.17): the My tools door.
//
// `openMyTools({editor, tab = 'widgets', defId, uid}) -> close()` mounts My tools on its OWN root, one at a time (the
// SetsDialog.openSetsDialog pattern): a second call while it is open returns the open one's close.
//   * `editor`: the note's editor when opened from a note ("Manage…" in a placed widget's ⋯ menu); it only names the
//     signed-in member (`editor.storage.uctJournalWidgets.uid`). My tools never writes into a note.
//   * `tab`: 'widgets' | 'routines' | 'trackers' | 'templates'.
//   * `defId`: the widget to show first (its row takes focus; an archived one opens the Archived list).
//
// ⛔ LAZY. Only dynamic imports reach this file (BuiltWidgetEmbed's ⋯ menu, and later the / menu's "Manage my tools"
// and Notebook settings). A static import from anything on the Notebook's first open would put My tools on that first
// open (the bytes gate).
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import MyToolsSheet from './MyToolsSheet'

let _open = null

export function openMyTools({ editor = null, tab = 'widgets', defId = null, uid } = {}) {
  if (_open) return _open
  const host = document.createElement('div')
  host.setAttribute('data-my-tools-root', '')
  document.body.appendChild(host)
  const root = createRoot(host)
  const close = () => {
    if (_open !== close) return
    _open = null
    // After the closing event has finished: a root is never unmounted from inside its own update.
    setTimeout(() => { root.unmount(); host.remove() }, 0)
  }
  _open = close
  root.render(createElement(MyToolsSheet, {
    editor, tab, defId: typeof defId === 'string' && defId ? defId : null,
    uid: uid ?? editor?.storage?.uctJournalWidgets?.uid ?? null, onClose: close,
  }))
  return close
}
