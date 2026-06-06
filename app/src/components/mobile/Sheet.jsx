import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useIsTouch } from '../../hooks/useBreakpoint'
import styles from './Sheet.module.css'

/* Sheet — responsive modal / drawer primitive.
 *
 * Desktop: centered modal. Touch: bottom-sheet (default) or fullscreen.
 * Use for ALL new modals/drawers/popovers so they behave on mobile.
 *
 * Props:
 *   open               boolean
 *   onClose            () => void
 *   variant            'auto' | 'modal' | 'bottom-sheet' | 'fullscreen'
 *                      'auto' = modal on desktop, bottom-sheet on touch
 *   title              string | node — sticky header w/ 44px close button
 *   footer             node — sticky footer (optional)
 *   dismissOnBackdrop  default true
 *   lockScroll         default true — locks body scroll while open
 *   maxWidth           desktop modal max width (px or css), default 520
 *   ariaLabel          accessible label when no title
 *   className          applied to the panel
 */
export default function Sheet({
  open,
  onClose,
  variant = 'auto',
  title,
  footer,
  children,
  dismissOnBackdrop = true,
  lockScroll = true,
  maxWidth = 520,
  ariaLabel,
  className = '',
}) {
  const isTouch = useIsTouch()
  const panelRef = useRef(null)
  const restoreFocusRef = useRef(null)
  const startY = useRef(0)
  const draggingRef = useRef(false)
  const [dragY, setDragY] = useState(0)

  // Resolve effective variant
  const resolved =
    variant === 'auto' ? (isTouch ? 'bottom-sheet' : 'modal') : variant
  const isBottomSheet = resolved === 'bottom-sheet'

  // Body scroll lock (mirrors MobileNav pattern)
  useEffect(() => {
    if (!open || !lockScroll) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open, lockScroll])

  // Escape to close + focus management
  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.() }
    }
    document.addEventListener('keydown', onKey, true)
    // Focus the panel for screen readers / Escape handling
    const t = requestAnimationFrame(() => panelRef.current?.focus())
    return () => {
      document.removeEventListener('keydown', onKey, true)
      cancelAnimationFrame(t)
      const el = restoreFocusRef.current
      if (el && typeof el.focus === 'function') el.focus()
    }
  }, [open, onClose])

  // Reset drag offset whenever opened
  useEffect(() => { if (open) setDragY(0) }, [open])

  // Drag-to-dismiss for bottom sheet (dampened, reuses PullToRefresh math)
  const onHandlePointerDown = useCallback((e) => {
    if (!isBottomSheet) return
    draggingRef.current = true
    startY.current = e.clientY
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }, [isBottomSheet])

  const onHandlePointerMove = useCallback((e) => {
    if (!draggingRef.current) return
    const diff = e.clientY - startY.current
    setDragY(diff > 0 ? diff : diff * 0.25) // resist upward
  }, [])

  const onHandlePointerUp = useCallback(() => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragY((d) => {
      if (d > 110) { onClose?.(); return 0 }
      return 0
    })
  }, [onClose])

  if (!open) return null

  const panelStyle = isBottomSheet
    ? { transform: dragY ? `translateY(${dragY}px)` : undefined,
        transition: draggingRef.current ? 'none' : undefined }
    : { maxWidth: typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth }

  return createPortal(
    <div
      className={`${styles.backdrop} ${styles[resolved]}`}
      onMouseDown={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        ref={panelRef}
        className={`${styles.panel} ${styles[`panel_${resolved}`]} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={!title && ariaLabel ? ariaLabel : undefined}
        tabIndex={-1}
        style={panelStyle}
      >
        {isBottomSheet && (
          <div
            className={styles.grip}
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
          >
            <span className={styles.gripBar} />
          </div>
        )}
        {title != null && (
          <div className={styles.header}>
            <div className={styles.title}>{title}</div>
            <button className={styles.close} onClick={onClose} aria-label="Close">×</button>
          </div>
        )}
        <div className={styles.body}>{children}</div>
        {footer != null && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
