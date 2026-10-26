// Notebook widgets phase 2, wave 9 (Task 9.19): the tool picker's door, opened by the / menu's
// "Routine (remembered daily)" (/routine) and "Tracker (one value a day)" (/track).
//
// `openToolPicker({editor, kind, navigate?}) -> close()` mounts ONE picker on its own root:
//   * picking a routine (tracker) puts its block at the caret, bound to the note's day (lib/toolEmbed, the one insert);
//   * "New routine" ("New tracker") gives way to the editor (one sheet at a time: the picker unmounts first, so its
//     Sheet hands focus back to the note before the editor's Sheet takes it), and the editor's `onSaved` inserts the
//     new one at the caret. A cancelled editor inserts nothing.
// It closes itself when the note's editor is destroyed (the member left the note) or on browser navigation, and an
// error inside it closes it rather than leaving a dead sheet.
//
// ⛔ LAZY. Only dynamic imports reach this file (the / menu's two items): a static import from anything on the
// Notebook's first open would put the picker and the editors on that first open (lib/toolsCrud.lazy.test.js).
import { Component, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import ToolPicker from './ToolPicker'
import { openRoutineEditor } from './openRoutineEditor'
import { openTrackerEditor } from './openTrackerEditor'
import { TOOL_NOT_ADDED, TOOL_SAVED_NOT_ADDED, placeTool } from '../../../lib/toolEmbed'

let _open = null

class PickerBoundary extends Component {
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

export function openToolPicker({ editor = null, kind, navigate = null } = {}) {
  if (kind !== 'routine' && kind !== 'tracker') return () => {}
  if (_open) return _open
  const from = typeof document !== 'undefined' ? document.activeElement : null
  const host = document.createElement('div')
  host.setAttribute('data-tool-picker-root', '')
  document.body.appendChild(host)
  const root = createRoot(host)
  let detach = () => {}
  /** Close; `then` runs once the picker is gone (the editor's door), else focus goes back where it came from. */
  const close = (then) => {
    if (_open !== close) return
    _open = null
    detach()
    // After the closing event has finished: a root is never unmounted from inside its own update.
    setTimeout(() => {
      root.unmount()
      host.remove()
      if (typeof then === 'function') { then(); return }
      if (from && from.isConnected && from !== document.body && typeof from.focus === 'function') from.focus()
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
  const openEditor = kind === 'routine' ? openRoutineEditor : openTrackerEditor
  root.render(createElement(PickerBoundary, { onError: () => close() }, createElement(ToolPicker, {
    kind,
    onClose: () => close(),
    onPick: (tool) => {
      placeTool(editor, kind, tool, TOOL_NOT_ADDED)
      close(() => {})
    },
    onNew: () => close(() => {
      openEditor({
        editor,
        // m-2: a note that turned read-only while the editor was open keeps nothing, and says the tool was kept.
        onSaved: (tool) => { placeTool(editor, kind, tool, TOOL_SAVED_NOT_ADDED) },
        returnFocus: editor?.view?.dom || null,
        navigate: typeof navigate === 'function' ? navigate : null,
      })
    }),
  })))
  return close
}

/** Test seam: forget a picker left open by a test that never closed it. */
export function __resetToolPicker() {
  _open = null
}
