/**
 * Chart right-click context menu — Journal 2.0.
 * Spec §8.2.
 *
 * Three items: Reset Chart View / Add to Portfolio / Settings...
 * Positioned at (x, y) of the right-click event. Closes on outside
 * click or Esc.
 */

import { useEffect, useRef } from 'react'
import styles from './ChartContextMenu.module.css'

export default function ChartContextMenu({
  open,
  x,
  y,
  onReset,
  onAddToPortfolio,
  onSaveToNotebook,
  onOpenSettings,
  onClose,
}) {
  const menuRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e) => {
      if (menuRef.current?.contains(e.target)) return
      onClose?.()
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  const select = (fn) => {
    fn?.()
    onClose?.()
  }

  // Clamp to viewport so the menu stays on-screen
  const clampedX = Math.min(x, window.innerWidth - 200)
  const clampedY = Math.min(y, window.innerHeight - 140)

  // Items are conditionally rendered so the global (app-wide) menu can
  // hide Reset + Settings, while Journal 2.0's own ChartModal keeps them.
  const showReset = typeof onReset === 'function'
  const showSettings = typeof onOpenSettings === 'function'

  return (
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: clampedX, top: clampedY }}
      role="menu"
    >
      {showReset && (
        <button
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={() => select(onReset)}
        >
          Reset Chart View
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className={styles.itemPrimary}
        onClick={() => select(onAddToPortfolio)}
      >
        + Add to Portfolio
      </button>
      {typeof onSaveToNotebook === 'function' && (
        <button
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={() => select(onSaveToNotebook)}
        >
          📓 Save to Notebook
        </button>
      )}
      {showSettings && (
        <>
          <div className={styles.separator} />
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => select(onOpenSettings)}
          >
            Settings…
          </button>
        </>
      )}
    </div>
  )
}
