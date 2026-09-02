import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useIsTouch } from '../../hooks/useBreakpoint'
import Sheet from './Sheet'
import useFocusTrap, { focusableWithin } from './useFocusTrap'
import styles from './ContextPopover.module.css'

/* ContextPopover — action menu that adapts to input.
 *
 * Touch: bottom-sheet (44px rows, easy to tap).
 * Desktop: floating menu anchored at {x,y}, clamped to viewport.
 *
 * Provide either `items` (declarative) or `children` (custom content).
 *
 *   <ContextPopover open={open} onClose={close} anchor={{x,y}} title="AAPL"
 *     items={[
 *       { label: 'Flag', icon: '⚑', onClick: ... },
 *       { label: 'Remove', danger: true, onClick: ... },
 *     ]} />
 */
export default function ContextPopover({
  open,
  onClose,
  anchor,
  items,
  title,
  children,
  width = 220,
  // Theme class forwarded to the touch bottom-sheet — it portals to <body>,
  // escaping any scoped theme tokens (the chart's Sunrise), exactly like every
  // other Sheet. Desktop's anchored menu ignores it (menu-dark by design).
  sheetClassName = '',
}) {
  const isTouch = useIsTouch()
  const menuRef = useRef(null)
  const [pos, setPos] = useState(null)
  const focusedOnce = useRef(false)

  // Desktop: clamp the anchored menu inside the viewport after it mounts
  useEffect(() => {
    if (!open || isTouch || !anchor) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const el = menuRef.current
    const h = el?.offsetHeight ?? 200
    const w = el?.offsetWidth ?? width
    setPos({
      left: Math.min(anchor.x, vw - w - 8),
      top: Math.min(anchor.y, vh - h - 8),
    })
  }, [open, isTouch, anchor, width])

  // Desktop: keyboard containment. The touch branch is a `Sheet`, which
  // already traps, focuses its panel and restores — this is the OTHER branch,
  // an anchored `role="menu"` portalled to <body> with no focus management at
  // all: focus stayed on the trigger, so Tab walked the page BEHIND an open
  // menu and a screen-reader user was never told the menu existed.
  useFocusTrap(open && !isTouch, menuRef)

  // ⛔ LATCHED, AND GATED ON `pos`. The menu renders `visibility: hidden` until
  // it has been measured and clamped, and focusing a hidden node is a no-op
  // that silently leaves focus on the trigger. But `pos` settling is a RENDER,
  // so an unlatched effect would re-run, tear down, and hand focus back to the
  // trigger the instant the menu finished positioning — the bug this shape
  // exists to avoid.
  useEffect(() => {
    if (!open || isTouch) { focusedOnce.current = false; return undefined }
    if (!pos || focusedOnce.current) return undefined
    focusedOnce.current = true
    const restoreTo = document.activeElement
    const el = menuRef.current
    const first = el ? focusableWithin(el)[0] : null
    ;(first || el)?.focus?.()
    // ⛔ NO `isConnected` CHECK, AND THAT IS MEASURED, NOT ASSUMED. The
    // trigger can genuinely be gone by now (a menu whose action deleted the row
    // it was opened from), and the obvious guard is to skip the restore for a
    // detached node. Deleting that guard changes NOTHING — focusing a detached
    // element is a silent no-op in jsdom and in browsers, not a throw — so the
    // test written for it could not fail, and a test that cannot fail reads as
    // coverage while providing none. Optional chaining is the whole guard: it
    // handles `restoreTo` being null, which IS distinguishable.
    return () => { restoreTo?.focus?.() }
  }, [open, isTouch, pos])

  // Desktop: dismiss on outside click / Escape
  useEffect(() => {
    if (!open || isTouch) return
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose?.()
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, isTouch, onClose])

  if (!open) return null

  const renderItems = () =>
    items?.map((it, i) =>
      it.separator ? (
        <div key={`sep${i}`} className={styles.separator} />
      ) : (
        <button
          key={it.key ?? it.label ?? i}
          className={`${styles.item} ${it.danger ? styles.danger : ''}`}
          disabled={it.disabled}
          onClick={(e) => { it.onClick?.(e); if (!it.keepOpen) onClose?.() }}
        >
          {it.icon != null && <span className={styles.icon}>{it.icon}</span>}
          <span className={styles.label}>{it.label}</span>
        </button>
      ),
    )

  // Touch → bottom sheet
  if (isTouch) {
    return (
      <Sheet open={open} onClose={onClose} variant="bottom-sheet" title={title} className={sheetClassName}>
        <div className={styles.sheetList}>
          {children ?? renderItems()}
        </div>
      </Sheet>
    )
  }

  // Desktop → anchored floating menu
  return createPortal(
    <div
      ref={menuRef}
      className={styles.menu}
      style={{
        left: pos?.left ?? anchor?.x ?? 0,
        top: pos?.top ?? anchor?.y ?? 0,
        width,
        visibility: pos ? 'visible' : 'hidden',
      }}
      role="menu"
      tabIndex={-1}
    >
      {title != null && <div className={styles.menuTitle}>{title}</div>}
      {children ?? renderItems()}
    </div>,
    document.body,
  )
}
