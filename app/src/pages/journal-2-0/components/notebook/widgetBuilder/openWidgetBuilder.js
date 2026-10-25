// Notebook widgets phase 2 (wave 8, Task 8.15): the widget builder's door.
//
// `openWidgetBuilder({editor, from?, start?, uid?, returnFocus?}) -> close()` mounts the builder sheet on its OWN
// root, one at a time (the SetsDialog.openSetsDialog pattern): a second call while one is open returns the open
// one's close.
//   * `from: {defId, getPos}` edits a saved widget ("Edit widget" in a placed widget's ⋯ menu); a `shelf:` id, or
//     `from: {shelfId, getPos}`, edits a ready-made one as a copy that replaces the placed widget.
//   * no `from` builds a new widget (/build), inserted at the caret when `editor` is a note's editor.
//   * `start`: 'examples' | 'blank' | 'resume' ('resume' reopens the kept draft straight away).
//   * `navigate`: the app router's navigate, when the door has one (My tools). The sample banner's Link broker and
//     Log a trade go through it; without it their links follow their own href (Task 8.16 fix 1, R-45).
//   * `returnFocus`: where focus goes when the builder closes without placing anything (the ⋯ button, or the
//     widget's own element). After an insert or a replace, focus goes to the placed widget instead.
//
// It closes itself when the note's editor is destroyed (the member left the note) or on browser navigation, and an
// error inside the builder closes it rather than leaving a dead sheet that blocks the next open.
//
// ⛔ LAZY. Only dynamic imports reach this file (BuiltWidgetEmbed's ⋯ menu; the / menu's /build). A static import
// from anything on the Notebook's first open would put the whole builder on that first open (the bytes gate).
import { Component, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import WidgetBuilderSheet from './WidgetBuilderSheet'

let _open = null

/** An error inside the builder unmounts it (and frees the door) instead of leaving a broken sheet on screen. */
class BuilderBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onError()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

export function openWidgetBuilder({ editor = null, from = null, start, uid, returnFocus = null, navigate = null } = {}) {
  if (_open) return _open
  const host = document.createElement('div')
  host.setAttribute('data-widget-builder-root', '')
  document.body.appendChild(host)
  const root = createRoot(host)
  let detach = () => {}
  let leave = null      // the sheet's "keep unsaved edits as a draft", asked before an unplanned unmount (R-38)
  const close = (focusTo) => {
    if (_open !== close) return
    _open = null
    detach()
    // After the closing event has finished: a root is never unmounted from inside its own update. Focus is placed
    // AFTER the unmount, because the Sheet restores focus to where it opened from as it unmounts.
    setTimeout(() => {
      root.unmount()
      host.remove()
      const to = focusTo && focusTo.isConnected ? focusTo : returnFocus
      if (to && to.isConnected && typeof to.focus === 'function') to.focus()
    }, 0)
  }
  _open = close
  const onLeave = () => {
    try { leave?.() } catch { /* a draft that cannot be written never blocks leaving */ }
    close()
  }
  if (editor && typeof editor.on === 'function') editor.on('destroy', onLeave)
  window.addEventListener('popstate', onLeave)
  detach = () => {
    if (editor && typeof editor.off === 'function') editor.off('destroy', onLeave)
    window.removeEventListener('popstate', onLeave)
  }
  // The signed-in member keys the kept draft (`uct.nb.widgetDraft.<uid>`), as the slash menu's caches are keyed.
  root.render(createElement(BuilderBoundary, { onError: () => close() }, createElement(WidgetBuilderSheet, {
    editor, from, start, uid: uid ?? editor?.storage?.uctJournalWidgets?.uid, onClose: close,
    navigate: typeof navigate === 'function' ? navigate : null,
    registerLeave: (fn) => { leave = fn },
  })))
  return close
}
