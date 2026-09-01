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
 *   zIndex             optional: inline-style override for THIS instance's
 *                      backdrop, above the shared --z-modal rung (1000) that
 *                      every other Sheet caller (TickerHubSheet, MoreSheet,
 *                      FiltersSheet, ...) relies on — that rung is the whole
 *                      mobile stack's contract and must NOT move globally.
 *                      Omitted by default, so every existing caller is
 *                      byte-identical. See ChartContextMenu.jsx for why its
 *                      touch bottom-sheet needs one (it can open from inside
 *                      TickerPopup, whose overlay now sits above --z-modal).
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
  zIndex,
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
    // ⛔ THE TOPMOST OPEN SHEET ANSWERS, AND ONLY IT. Sheets nest (a chart
    // pop-out inside the phone earnings modal), every one listens here on the
    // same node, and stopPropagation cannot stop a sibling listener — the
    // OUTER sheet, registered first, would close the whole report. The portals
    // append to <body> in mount order, so the last panel is the top. Both the
    // Escape close and the Tab trap below share this test; two copies of it is
    // how they would drift apart.
    const isTopmost = () => {
      const panels = document.querySelectorAll('[data-sheet-panel]')
      return !panels.length || panels[panels.length - 1] === panelRef.current
    }

    const FOCUSABLE = [
      'a[href]', 'button:not([disabled])', 'input:not([disabled])',
      'select:not([disabled])', 'textarea:not([disabled])', 'summary',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',')

    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (!isTopmost()) return
        e.stopPropagation()
        onClose?.()
        return
      }
      if (e.key !== 'Tab') return

      // ⛔⛔ WITHOUT THIS, TAB WALKS OUT OF THE DIALOG INTO THE PAGE BEHIND IT.
      // `aria-modal="true"` constrains a screen reader's virtual cursor and
      // does NOT constrain Tab — a keyboard user tabbed straight out of the
      // panel into content the modal is covering, with no way back but
      // Shift+Tab through everything. This file's own header and CLAUDE.md
      // both claimed a "focus-trap" that did not exist.
      const panel = panelRef.current
      if (!panel || !isTopmost()) return
      // ⛔ NOT `offsetParent !== null`. That is the obvious visibility test and
      // it is ALWAYS null in jsdom, which computes no layout — so the filter
      // removed every candidate, the "nothing focusable" branch fired, and the
      // trap did nothing while its tests said otherwise. Explicit hiding is
      // what actually matters here and is readable without a layout pass.
      const hidden = (n) =>
        n.hasAttribute('hidden') ||
        n.getAttribute('aria-hidden') === 'true' ||
        n.closest('[hidden],[aria-hidden="true"]') !== null ||
        n.style.display === 'none' ||
        n.style.visibility === 'hidden'
      const nodes = [...panel.querySelectorAll(FOCUSABLE)].filter(n => !hidden(n))
      if (!nodes.length) {
        // Nothing focusable inside: keep focus on the panel rather than
        // letting Tab escape to the page underneath.
        e.preventDefault()
        panel.focus()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      if (!panel.contains(active)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
        return
      }
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
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
      style={zIndex != null ? { zIndex } : undefined}
      onMouseDown={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        ref={panelRef}
        className={`${styles.panel} ${styles[`panel_${resolved}`]} ${className}`}
        role="dialog"
        aria-modal="true"
        // A title is a heading, not a name: the dialog has no aria-labelledby
        // wiring, so an ariaLabel names it whether or not a title is shown.
        aria-label={ariaLabel || undefined}
        data-sheet-panel=""
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
