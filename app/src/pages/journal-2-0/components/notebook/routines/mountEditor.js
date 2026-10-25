// Notebook widgets phase 2, wave 9 (Task 9.16): the routine and tracker editors' shared door.
//
// `mountEditor({rootAttr, Sheet, props, editor, announce, returnFocus}) -> close(focusTo?, say?)` mounts ONE editor on
// its OWN root (the SetsDialog.openSetsDialog pattern). ONE at a time across both kinds: while an editor is open, a
// call answers the open one's close and opens nothing.
//   * `returnFocus`: where focus goes when the editor closes (default: what had focus when it opened, the opener).
//   * `announce(sentence)`: the opener's own live line (a placed block's feedback line). When given, a routine or
//     tracker that cannot be read closes the editor and the line says why (`handOff`), rather than an empty sheet.
// It closes itself when the note's editor is destroyed (the member left the note) or on browser navigation, and an
// error inside the editor closes it rather than leaving a dead sheet that blocks the next open.
// ⚠️ Ruling W9-R47 (M-7), an OWNER FOLLOW-UP, not built: Back and leaving the note close WITHOUT asking, so a dirty
// draft is lost there (Escape, Cancel, ×, the backdrop and drag all ask). Asking, or keeping a session draft, is the
// owner's call.
//
// ⛔ LAZY. Only the two openers import this file, and only dynamic imports reach the openers.
import { Component, createElement } from 'react'
import { createRoot } from 'react-dom/client'

let _open = null

class EditorBoundary extends Component {
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

export function mountEditor({ rootAttr, Sheet, props = {}, editor = null, announce = null, returnFocus = null }) {
  if (_open) return _open
  const from = returnFocus || (typeof document !== 'undefined' ? document.activeElement : null)
  const host = document.createElement('div')
  host.setAttribute(rootAttr, '')
  document.body.appendChild(host)
  const root = createRoot(host)
  let detach = () => {}
  const close = (focusTo, say) => {
    if (_open !== close) return
    _open = null
    detach()
    // After the closing event has finished: a root is never unmounted from inside its own update. Focus is placed
    // AFTER the unmount, because the Sheet restores focus to where it opened from as it unmounts.
    setTimeout(() => {
      root.unmount()
      host.remove()
      const to = focusTo && focusTo.isConnected ? focusTo : from
      if (to && to.isConnected && to !== document.body && typeof to.focus === 'function') to.focus()
      if (typeof say === 'string' && say && typeof announce === 'function') {
        try { announce(say) } catch { /* the opener's line is its own */ }
      }
    }, 0)
  }
  _open = close
  const onLeave = () => close()
  if (editor && typeof editor.on === 'function') editor.on('destroy', onLeave)
  if (typeof window !== 'undefined') window.addEventListener('popstate', onLeave)
  detach = () => {
    if (editor && typeof editor.off === 'function') editor.off('destroy', onLeave)
    if (typeof window !== 'undefined') window.removeEventListener('popstate', onLeave)
  }
  const handOff = typeof announce === 'function' ? (sentence) => close(null, sentence) : null
  root.render(createElement(EditorBoundary, { onError: () => close() },
    createElement(Sheet, { ...props, onClose: close, handOff })))
  return close
}

/** Test seam: forget an editor left open by a test that never closed it. */
export function __resetEditorDoor() {
  _open = null
}
