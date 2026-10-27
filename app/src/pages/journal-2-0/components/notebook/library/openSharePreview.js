// Notebook widgets phase 2, wave 11 (Task 11.15): the share preview's door.
//
// `openSharePreview({kind, id, onDone}) -> close()` mounts the share preview on its OWN root, one at a time (the
// openMyTools pattern): a call while one is open returns the open one's close and opens nothing new, so a double
// press cannot stack two sheets or send two previews.
//   * `kind`: 'widget' | 'routine' | 'tracker' | 'template'; `id` the member's own item (a template is its style id).
//   * `onDone(sentence)`: once the server took the item for review (the sheet stays open on its sent sentence).
//
// ⛔ LAZY. Only dynamic imports reach this file (My tools' Share action, Task 11.19). A static import from anything on
// the Notebook's first open would put the share preview on that first open (the bytes gate).
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import SharePreviewSheet from './SharePreviewSheet'

let _open = null

export function openSharePreview({ kind, id, onDone } = {}) {
  if (_open) return _open.close
  const host = document.createElement('div')
  host.setAttribute('data-share-preview-root', '')
  document.body.appendChild(host)
  const root = createRoot(host)
  const close = () => {
    if (_open?.close !== close) return
    _open = null
    // After the closing event has finished: a root is never unmounted from inside its own update.
    setTimeout(() => { root.unmount(); host.remove() }, 0)
  }
  _open = { close }
  root.render(createElement(SharePreviewSheet, {
    kind, id, onClose: close, onDone: typeof onDone === 'function' ? onDone : undefined,
  }))
  return close
}
