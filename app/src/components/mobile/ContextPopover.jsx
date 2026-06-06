import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useIsTouch } from '../../hooks/useBreakpoint'
import Sheet from './Sheet'
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
}) {
  const isTouch = useIsTouch()
  const menuRef = useRef(null)
  const [pos, setPos] = useState(null)

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
      <Sheet open={open} onClose={onClose} variant="bottom-sheet" title={title}>
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
    >
      {title != null && <div className={styles.menuTitle}>{title}</div>}
      {children ?? renderItems()}
    </div>,
    document.body,
  )
}
