// View Holdings — the draggable, resizable floating window that lists an ETF's
// holdings as a live mini-watchlist (EtfHoldingsResults). Chrome mirrors the
// Custom-Period Sort panel (grab dots, colour dot, gold corner resize, close);
// reuses PeriodSortPanel.module.css so the two windows look identical.
import { useState, useCallback } from 'react'
import EtfHoldingsResults from './EtfHoldingsResults'
import UIcon from '../../../components/ui/UIcon'
import styles from '../PeriodSortPanel.module.css'

const DEF_W = 520, DEF_H = 560, MIN_W = 180, MIN_H = 40
const COLORS = ['A', 'B', 'C', 'D', 'N']
const COLOR_HEX = { A: '#c9a84c', B: '#60a5fa', C: '#4ade80', D: '#c084fc', N: '#6b7280' }

export default function EtfHoldingsPanel({ sym, onClose, centerOn = null, themeVars = null }) {
  const [pos, setPos] = useState(() => {
    const vw = window.innerWidth, vh = window.innerHeight
    // Center on the chart widget when we were handed its center; else the viewport.
    let x = centerOn ? centerOn.cx - DEF_W / 2 : (vw - DEF_W) / 2
    let y = centerOn ? centerOn.cy - DEF_H / 2 : 96
    x = Math.max(8, Math.min(x, vw - DEF_W - 8))    // keep fully on-screen horizontally
    y = Math.max(8, Math.min(y, vh - 80))           // keep at least the header on-screen
    return { x: Math.round(x), y: Math.round(y) }
  })
  const [size, setSize] = useState({ w: DEF_W, h: DEF_H })
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
    <div className={styles.panel} style={{ left: pos.x, top: pos.y, width: size.w, height: size.h, ...(themeVars || {}) }}>
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
          <button type="button" className={styles.close} onClick={onClose} title="Close" aria-label="Close"><UIcon name="x" size={13} gold={false} /></button>
        </div>
      </div>
      <div className={styles.panelBody}>
        <EtfHoldingsResults sym={sym} color={panelColor === 'N' ? null : panelColor} />
      </div>
      <span className={`${styles.corner} ${styles.cornerNW}`} onPointerDown={startResize('nw')} />
      <span className={`${styles.corner} ${styles.cornerNE}`} onPointerDown={startResize('ne')} />
      <span className={`${styles.corner} ${styles.cornerSW}`} onPointerDown={startResize('sw')} />
      <span className={`${styles.corner} ${styles.cornerSE}`} onPointerDown={startResize('se')} />
    </div>
  )
}
