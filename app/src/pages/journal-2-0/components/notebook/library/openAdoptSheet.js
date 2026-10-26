// Notebook widgets phase 2, wave 11 (Task 11.17): the adoption sheet's door.
//
// `openAdoptSheet({galleryId, kind, editor?, onDone, navigate?}) -> close()` mounts "Make it yours"
// on its OWN root, one at a time (the openSharePreview pattern): a call while one is open returns the open one's close
// and opens nothing new, so a double press cannot stack two sheets, send two previews or make two notes.
//   * `galleryId`: the listed item; `kind`: 'template' | 'widget' | 'routine' | 'tracker'.
//   * `editor`: the editor the door was opened from, handed back to `onDone` as it came.
//   * `onDone(answer)`: once the item is the member's (`{kind, editor, ...the server's answer}`). A template's Use has
//     made the note and the sheet opens it (through `navigate` when given, else in place through history).
//   * The credit line is the server's own `credit` from the preview answer (W11-R24); nothing here builds one.
//   * `mode: 'update'` + `copyId` (Task 11.19, My tools' "Update from the library" when the new version asks a
//     question): Use takes the listed version into the member's copy `copyId` (`updateTool`), never a new copy.
//
// ⛔ LAZY. Only dynamic imports reach this file (the template detail's "Use this template", Task 11.16). A static
// import from anything on the Notebook's first open would put the adoption sheet on that first open (the bytes gate).
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import AdoptSheet from './AdoptSheet'

let _open = null

export function openAdoptSheet({ galleryId, kind, editor = null, onDone, navigate, mode = 'adopt', copyId = null } = {}) {
  if (_open) return _open.close
  const host = document.createElement('div')
  host.setAttribute('data-adopt-sheet-root', '')
  document.body.appendChild(host)
  const root = createRoot(host)
  const close = () => {
    if (_open?.close !== close) return
    _open = null
    // After the closing event has finished: a root is never unmounted from inside its own update.
    setTimeout(() => { root.unmount(); host.remove() }, 0)
  }
  _open = { close }
  root.render(createElement(AdoptSheet, {
    galleryId, kind, editor, mode, copyId,
    navigate: typeof navigate === 'function' ? navigate : null,
    onClose: close, onDone: typeof onDone === 'function' ? onDone : undefined,
  }))
  return close
}
