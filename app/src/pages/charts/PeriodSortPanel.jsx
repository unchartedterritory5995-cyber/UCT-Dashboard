// Custom-Period Sort — the draggable floating results window. Wraps the shared
// PeriodSortTable (identical to the docked Period-Sort widget) in a movable panel whose
// header can dock the results into the grid as a widget or fold them into an existing
// widget as a Period-Sort tab.
import { useState, useCallback } from 'react'
import PeriodSortTable from './PeriodSortTable'
import styles from './PeriodSortPanel.module.css'

export default function PeriodSortPanel({ start, end, onClose, onPickSym, onDock, onAddAsTab, tabTargets = [] }) {
  const [pos, setPos] = useState({ x: 140, y: 96 })
  const [tabMenuOpen, setTabMenuOpen] = useState(false)
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
          {onAddAsTab && tabTargets.length > 0 && (
            <div style={{ position: 'relative' }}>
              <button type="button" className={styles.iconBtn} onClick={() => setTabMenuOpen((o) => !o)} title="Add as a tab in a widget" aria-label="Add as tab">⊞</button>
              {tabMenuOpen && (
                <div className={styles.tabMenu} onMouseLeave={() => setTabMenuOpen(false)}>
                  <div className={styles.tabMenuHead}>Add as tab in…</div>
                  {tabTargets.map((t) => (
                    <button key={t.id} type="button" className={styles.tabMenuItem} onClick={() => { setTabMenuOpen(false); onAddAsTab(t.id) }}>{t.label}</button>
                  ))}
                </div>
              )}
            </div>
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
