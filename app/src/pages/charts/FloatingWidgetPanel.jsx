// A generic draggable/resizable floating panel that hosts ANY workspace widget on
// top of the canvas (e.g. a Watchlist floating over a Chart, TC2000-style). It owns
// only the position/size + drag/resize; the body is supplied via a render-prop so
// ChartsWorkspace can drop a real <WidgetHost floating .../> inside with all its
// normal wiring. The WidgetHost's own header (in floating mode) provides the drag
// grip + dock / move-to-tab / close controls, so `onDragPointerDown` is handed back
// to the render-prop for that grip. Chrome (border/corners) is reused verbatim from
// the proven Custom-Period-Sort panel so the two floats look identical.
import { useState, useCallback } from 'react'
import styles from './PeriodSortPanel.module.css'

const MIN_W = 180, MIN_H = 120

export default function FloatingWidgetPanel({ children, initialW = 460, initialH = 440, offset = 0 }) {
  const [pos, setPos] = useState(() => ({
    x: Math.max(12, Math.round((window.innerWidth - initialW) / 2)) + offset,
    y: 84 + offset,
  }))
  const [size, setSize] = useState({ w: initialW, h: initialH })

  const onDragPointerDown = useCallback((e) => {
    if (e.target.closest?.('[data-no-drag]')) return
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
    <div className={styles.panel} style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}>
      <div className={styles.panelBody}>
        {children({ onDragPointerDown })}
      </div>
      {/* Gold resize corners — grab any of the four. */}
      <span className={`${styles.corner} ${styles.cornerNW}`} onPointerDown={startResize('nw')} />
      <span className={`${styles.corner} ${styles.cornerNE}`} onPointerDown={startResize('ne')} />
      <span className={`${styles.corner} ${styles.cornerSW}`} onPointerDown={startResize('sw')} />
      <span className={`${styles.corner} ${styles.cornerSE}`} onPointerDown={startResize('se')} />
    </div>
  )
}
