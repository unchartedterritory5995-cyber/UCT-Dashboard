// Notebook widgets phase 2 (wave 8, Task 8.17): the My tools door.
//
// `openMyTools({editor, tab = 'widgets', defId, uid}) -> close()` mounts My tools on its OWN root, one at a time (the
// SetsDialog.openSetsDialog pattern): a second call while it is open returns the open one's close.
//   * `editor`: the note's editor when opened from a note ("Manage…" in a placed widget's ⋯ menu); it only names the
//     signed-in member (`editor.storage.uctJournalWidgets.uid`). My tools never writes into a note.
//   * `tab`: 'widgets' | 'routines' | 'trackers' | 'templates'.
//   * `defId`: the widget to show first (its row takes focus; an archived one opens the Archived list). Called again
//     while open, the open sheet switches to the new widget.
//   * `navigate`: the app router's navigate, when the door has one (BuiltWidgetEmbed). A note link then moves the
//     router directly; without it, My tools (on its own root, outside the router) makes the router's own history
//     move and tells it with `popstate`.
//
// ⛔ LAZY. Only dynamic imports reach this file (BuiltWidgetEmbed's ⋯ menu, and later the / menu's "Manage my tools"
// and Notebook settings). A static import from anything on the Notebook's first open would put My tools on that first
// open (the bytes gate).
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import MyToolsSheet from './MyToolsSheet'

let _open = null

/** Mount My tools. While it is open, a call is a new ask of the open sheet: it takes this call's tab, widget, editor
 *  and navigate, and shows that tab (and that widget, focused, even when it is the same widget asked for again after
 *  the member moved to another tab or list). */
export function openMyTools({ editor = null, tab = 'widgets', defId = null, uid, navigate } = {}) {
  const id = typeof defId === 'string' && defId ? defId : null
  if (_open) {
    _open.show({ editor, tab, defId: id, navigate })
    return _open.close
  }
  const host = document.createElement('div')
  host.setAttribute('data-my-tools-root', '')
  document.body.appendChild(host)
  const root = createRoot(host)
  const close = () => {
    if (_open?.close !== close) return
    _open = null
    // After the closing event has finished: a root is never unmounted from inside its own update.
    setTimeout(() => { root.unmount(); host.remove() }, 0)
  }
  const props = {
    editor, tab, defId: id, uid: uid ?? editor?.storage?.uctJournalWidgets?.uid ?? null,
    navigate: typeof navigate === 'function' ? navigate : null, onClose: close, seek: 0,
  }
  const render = () => root.render(createElement(MyToolsSheet, { ...props }))
  _open = {
    close,
    show: (next) => {
      props.tab = next.tab
      props.defId = next.defId
      props.seek += 1
      if (next.editor) props.editor = next.editor
      if (typeof next.navigate === 'function') props.navigate = next.navigate
      render()
    },
  }
  render()
  return close
}
