// Custom-Period Sort — the draggable floating results window. Wraps the shared
// PeriodSortTable (identical to the docked Period-Sort widget) in a movable panel with a
// header that can dock the results into the grid, become a tab, or open settings.
import { useState, useCallback } from 'react'
import PeriodSortTable from './PeriodSortTable'
import styles from './PeriodSortPanel.module.css'

export default function PeriodSortPanel({ start, end, onClose, onPickSym, onDock, onAddAsTab, onSettings }) {
  // Draggable window (pointer-drag on the header bar).
  const [pos, setPos] = useState({ x: 140, y: 96 })
  const onHeaderPointerDown = useCallback((e) => {
    if (e.target.closest('[data-no-drag]')) return
    e.preventDefault()
    const sx = e.clientX, sy = e.clientY
    setPos((p) => {
      const ox = p.x, oy = p.y
      const move = (ev) => setPos({ x: Math.max(0, ox + (ev.clientX - sx)), y: Math.max(0, oy + (ev.clientY - sy)) })
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      return p
    })
  }, [])

  return (
    <div className={styles.panel} style={{ left: pos.x, top: pos.y }}>
      <div className={styles.header} onPointerDown={onHeaderPointerDown}>
        <span className={styles.grip} aria-hidden="true" />
        <span className={styles.title}>US Common Stocks</span>
        <div className={styles.headBtns} data-no-drag>
          {onSettings && (
            <button type="button" className={styles.iconBtn} onClick={onSettings} title="Settings" aria-label="Settings">⚙</button>
          )}
          {onAddAsTab && (
            <button type="button" className={styles.iconBtn} onClick={onAddAsTab} title="Add as a tab in a widget" aria-label="Add as tab">⊞</button>
          )}
          {onDock && (
            <button type="button" className={styles.iconBtn} onClick={onDock} title="Dock into the workspace as a widget" aria-label="Dock">⧉</button>
          )}
          <button type="button" className={styles.close} onClick={onClose} title="Close" aria-label="Close">✕</button>
        </div>
      </div>
      <PeriodSortTable start={start} end={end} onPickSym={onPickSym} />
    </div>
  )
}
