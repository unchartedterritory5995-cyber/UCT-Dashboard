/** Generic destructive-action confirm modal.
 *  Used for Position delete (formerly window.confirm). Cleaner UX,
 *  Esc-closes, focus-traps inside the modal.
 */

import { useEffect, useId, useRef } from 'react'
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
  const confirmRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    confirmRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className={shellStyles.backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
      role="presentation"
    >
      <div
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
            type="button"
            className={shellStyles.ghostBtn}
            onClick={onClose}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
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
