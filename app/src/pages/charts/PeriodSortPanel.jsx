// Custom-Period Sort — the draggable, resizable floating "sort window". Its body is the
// real scanner/watchlist table (PeriodSortResults) for the highlighted [start, end]; its
// chrome mirrors a workspace widget (compact header, grab dots, colour dot, corner resize)
// and can dock into the grid as a widget or fold into a widget as a Period-Sort tab.
import { useState, useCallback } from 'react'
import PeriodSortResults from './widgets/PeriodSortResults'
import styles from './PeriodSortPanel.module.css'

export default function PeriodSortPanel({ start, end, onClose, onDock, onAddAsTab, tabTargets = [] }) {
  const [pos, setPos] = useState({ x: 140, y: 96 })
  const [size, setSize] = useState({ w: 500, h: 580 })
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

  const onResizePointerDown = useCallback((e) => {
    e.preventDefault(); e.stopPropagation()
    const sx = e.clientX, sy = e.clientY
    setSize((s) => {
      const ow = s.w, oh = s.h
      const move = (ev) => setSize({ w: Math.max(340, ow + (ev.clientX - sx)), h: Math.max(280, oh + (ev.clientY - sy)) })
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      return s
    })
  }, [])

  return (
    <div className={styles.panel} style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}>
      <div className={styles.header} onPointerDown={onHeaderPointerDown}>
        <span className={styles.grip} aria-hidden="true" />
        <span className={styles.colorDot} aria-hidden="true" />
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
      <div className={styles.panelBody}>
        <PeriodSortResults start={start} end={end} color="A" />
      </div>
      <span className={styles.resizeHandle} onPointerDown={onResizePointerDown} title="Resize" />
    </div>
  )
}
