import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import styles from './Modal.module.css'

/**
 * Canonical modal. Promoted from journal-2-0 ModalShell so every modal shares
 * one backdrop / panel / header / footer with standardized radius + shadow.
 *
 * Props:
 *   open       — render when truthy (default true)
 *   onClose    — called on Esc, backdrop click, and × button
 *   title      — header text (omit for a chromeless panel)
 *   footer     — node rendered in the footer row (omit to hide footer)
 *   width      — CSS width override (default min(520px, 100%))
 *   elevated   — stack above other modals (chart-launched Add-to-Portfolio case)
 */
export default function Modal({
  open = true,
  onClose,
  title,
  footer,
  width,
  elevated = false,
  className = '',
  children,
}) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className={[styles.backdrop, elevated ? styles.elevated : ''].filter(Boolean).join(' ')}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div
        className={[styles.modal, className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        style={width ? { width } : undefined}
      >
        {title != null && (
          <div className={styles.header}>
            <h2 className={styles.title}>{title}</h2>
            {onClose && (
              <button type="button" className={styles.xBtn} onClick={onClose} aria-label="Close">×</button>
            )}
          </div>
        )}
        <div className={styles.body}>{children}</div>
        {footer != null && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
