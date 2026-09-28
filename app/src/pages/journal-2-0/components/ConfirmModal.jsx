/** Generic destructive-action confirm modal.
 *  Used for Position delete (formerly window.confirm), and across the
 *  Notebook: a note's Delete, a folder's and a saved view's Delete, the bulk
 *  Move to Trash, a version restore. Cleaner UX, Esc-closes, focus-traps
 *  inside the modal.
 *
 *  ⛔⛔ F4 / A2R-05 (WCAG 2.4.3), from lane 10E-2's keyboard walk. The dialog
 *  opened with focus on the DESTRUCTIVE button, and Tab walked out of it into
 *  the page behind an `aria-modal` dialog (the comment above claimed a trap
 *  there was none). Now, and for every caller at once:
 *   · focus opens on the SAFE action (Cancel), so a stray Enter cancels;
 *   · Tab and Shift+Tab wrap inside the dialog (`useFocusTrap`, the ONE trap);
 *   · Escape closes it;
 *   · on close, focus goes back to the control that opened it -- but only when
 *     focus was LOST with the dialog. A caller that has already put focus
 *     somewhere on purpose (the Notebook puts it on the next row after a
 *     delete) keeps it, and an opener that no longer exists is left alone.
 *  ⛔ The mount work runs ONCE. It used to depend on `onClose`, which every
 *  caller passes as a fresh arrow, so each re-render of the page behind the
 *  dialog re-ran it and pulled focus back to the confirm button.
 *  Rail: ConfirmModal.test.jsx ("keyboard" block).
 */

import { useEffect, useId, useRef } from 'react'
import useFocusTrap from '../../../components/mobile/useFocusTrap'
import shellStyles from './ModalShell.module.css'

export default function ConfirmModal({
  title,
  body,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  tone = 'danger',  // 'danger' | 'primary'
  onConfirm,
  onClose,
}) {
  const titleId = useId()
  const dialogRef = useRef(null)
  const cancelRef = useRef(null)
  // The latest onClose, read by the listeners below without re-subscribing them.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    const invoker = document.activeElement
    cancelRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current?.() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      // By now the dialog's nodes are gone: focus that was inside it fell to <body>.
      const active = document.activeElement
      const lost = !active || active === document.body
      if (lost && invoker && invoker !== document.body && invoker.isConnected
          && typeof invoker.focus === 'function') {
        invoker.focus()
      }
    }
  }, [])

  useFocusTrap(true, dialogRef)

  return (
    <div
      className={shellStyles.backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className={shellStyles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={shellStyles.header}>
          <h2 id={titleId} className={shellStyles.title}>{title}</h2>
          <button
            type="button"
            className={shellStyles.xBtn}
            onClick={onClose}
            aria-label="Close"
          >×</button>
        </div>
        <div className={shellStyles.body}>
          {typeof body === 'string' ? <p>{body}</p> : body}
        </div>
        <div className={shellStyles.footer}>
          <button
            ref={cancelRef}
            type="button"
            className={shellStyles.ghostBtn}
            onClick={onClose}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === 'danger' ? shellStyles.dangerBtn : shellStyles.primaryBtn}
            onClick={async () => {
              await onConfirm?.()
              onClose?.()
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
