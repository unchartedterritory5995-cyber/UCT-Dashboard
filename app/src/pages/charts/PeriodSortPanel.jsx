// Custom-Period Sort — the draggable, resizable floating "sort window". Its body is the
// real scanner/watchlist table (PeriodSortResults) for the highlighted [start, end]; its
// chrome mirrors a workspace widget (compact header, grab dots, clickable colour dot,
// gold corner resize on all four corners) and can dock into the grid or become a tab.
import { useState, useCallback } from 'react'
import PeriodSortResults from './widgets/PeriodSortResults'
import UIcon from '../../components/ui/UIcon'
import styles from './PeriodSortPanel.module.css'

// Default size fits the default columns with no blank filler. Stocks (flag18 + sym96 +
// periodchg84 + price62 + vol56 ≈ 316 + chrome) → 364. Groups have a wide name column
// (flag18 + sym250 + periodchg84 + count60 ≈ 412 + chrome) → 450, so full names fit.
// MIN is tiny — the header (grab dots, colour dot, buttons) stays; the table just clips.
const DEF_H = 560, MIN_W = 150, MIN_H = 40
const stockDefW = 364, groupDefW = 450
const COLORS = ['A', 'B', 'C', 'D', 'N']
const COLOR_HEX = { A: '#c9a84c', B: '#60a5fa', C: '#4ade80', D: '#c084fc', N: '#6b7280' }

export default function PeriodSortPanel({ start, end, onClose, onDock, onAddAsTab, tabTargets = [], group = null, symbolsFilter = null, titlePrefix = null, offset = 0 }) {
  // Group panels open wider so the theme/sector/industry names fit; stock panels stay snug.
  const defW = group ? groupDefW : stockDefW
  // Open centered over the workspace (i.e. over the chart), not pinned to the left. A drill
  // window (offset) opens beside its parent so both are visible.
  const [pos, setPos] = useState(() => ({ x: Math.max(12, Math.round((window.innerWidth - defW) / 2)) + offset, y: 96 + (offset ? 24 : 0) }))
  const [size, setSize] = useState({ w: defW, h: DEF_H })
  const [tabMenuOpen, setTabMenuOpen] = useState(false)
  const [panelColor, setPanelColor] = useState('A')

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

  // Resize from any corner: e/s grow width/height; w/n also shift the panel's origin.
  const startResize = (corner) => (e) => {
    e.preventDefault(); e.stopPropagation()
    const sx = e.clientX, sy = e.clientY
    const o = { x: pos.x, y: pos.y, w: size.w, h: size.h }
    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy
      let { x, y, w, h } = o
      if (corner.includes('e')) w = Math.max(MIN_W, o.w + dx)
      if (corner.includes('s')) h = Math.max(MIN_H, o.h + dy)
      if (corner.includes('w')) { const nw = Math.max(MIN_W, o.w - dx); x = o.x + (o.w - nw); w = nw }
      if (corner.includes('n')) { const nh = Math.max(MIN_H, o.h - dy); y = o.y + (o.h - nh); h = nh }
      setPos({ x, y }); setSize({ w, h })
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className={styles.panel} style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}>
      <div className={styles.header} onPointerDown={onHeaderPointerDown}>
        <span className={styles.grip} aria-hidden="true" />
        <button
          type="button"
          data-no-drag
          className={styles.colorDot}
          style={{ background: COLOR_HEX[panelColor] }}
          onClick={() => setPanelColor((c) => COLORS[(COLORS.indexOf(c) + 1) % COLORS.length])}
          title={`Colour group: ${panelColor === 'N' ? 'not linked' : panelColor} (click to change)`}
          aria-label="Colour group"
        />
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
          <button type="button" className={styles.close} onClick={onClose} title="Close" aria-label="Close"><UIcon name="x" size={13} gold={false} /></button>
        </div>
      </div>
      <div className={styles.panelBody}>
        <PeriodSortResults start={start} end={end} color={panelColor} group={group} symbolsFilter={symbolsFilter} titlePrefix={titlePrefix} />
      </div>
      {/* Gold resize corners — grab any of the four to resize. */}
      <span className={`${styles.corner} ${styles.cornerNW}`} onPointerDown={startResize('nw')} />
      <span className={`${styles.corner} ${styles.cornerNE}`} onPointerDown={startResize('ne')} />
      <span className={`${styles.corner} ${styles.cornerSW}`} onPointerDown={startResize('sw')} />
      <span className={`${styles.corner} ${styles.cornerSE}`} onPointerDown={startResize('se')} />
    </div>
  )
}
