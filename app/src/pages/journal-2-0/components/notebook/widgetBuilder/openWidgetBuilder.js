// Notebook widgets phase 2 (wave 8, Task 8.15): the widget builder's door.
//
// `openWidgetBuilder({editor, from?, start?}) -> close()` mounts the builder sheet on its OWN root, one at a time
// (the SetsDialog.openSetsDialog pattern): a second call while one is open returns the open one's close.
//   * `from: {defId, getPos}` edits a saved widget ("Edit widget" in a placed widget's ⋯ menu); a `shelf:` id, or
//     `from: {shelfId, getPos}`, edits a ready-made one as a copy that replaces the placed widget.
//   * no `from` builds a new widget (/build), inserted at the caret when `editor` is a note's editor.
//   * `start`: 'examples' | 'blank' | 'resume' ('resume' reopens the kept draft straight away).
//
// ⛔ LAZY. Only dynamic imports reach this file (BuiltWidgetEmbed's ⋯ menu; the / menu's /build). A static import
// from anything on the Notebook's first open would put the whole builder on that first open (the bytes gate).
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import WidgetBuilderSheet from './WidgetBuilderSheet'

let _open = null

export function openWidgetBuilder({ editor = null, from = null, start, uid } = {}) {
  if (_open) return _open
  const host = document.createElement('div')
  host.setAttribute('data-widget-builder-root', '')
  document.body.appendChild(host)
  const root = createRoot(host)
  const close = () => {
    if (_open !== close) return
    _open = null
    // After the closing event has finished: a root is never unmounted from inside its own update.
    setTimeout(() => { root.unmount(); host.remove() }, 0)
  }
  _open = close
  // The signed-in member keys the kept draft (`uct.nb.widgetDraft.<uid>`), as the slash menu's caches are keyed.
  root.render(createElement(WidgetBuilderSheet, {
    editor, from, start, uid: uid ?? editor?.storage?.uctJournalWidgets?.uid, onClose: close,
  }))
  return close
}
