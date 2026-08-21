// A generic draggable/resizable floating panel that hosts ANY workspace widget on
// top of the canvas (e.g. a Watchlist over a Chart, TC2000-style). It owns only the
// position/size; the body is supplied via a render-prop so ChartsWorkspace can drop
// a real <WidgetHost floating .../> inside with all its normal wiring.
//
// ⚠️ CRITICAL — drag/resize write the DOM DIRECTLY (via panelRef) and commit to
// React state only on pointer-UP. They must NOT setState on every pointermove.
// Reason: a per-move setState re-renders the panel, which re-invokes the `children`
// render-prop, which (in ChartsWorkspace) rebuilds fresh inline callbacks each time.
// Those unstable callbacks flowing into the heavy hosted widget fed a re-render loop
// back through ChartsWorkspace → React #185 "Maximum update depth exceeded" (the
// crash when dragging a floated watchlist). Writing to el.style during the gesture
// keeps the React tree — and the hosted widget — completely still while you drag.
import { useState, useRef, useEffect, useCallback } from 'react'
import styles from './PeriodSortPanel.module.css'

const MIN_W = 180, MIN_H = 120

export default function FloatingWidgetPanel({ children, initialW = 460, initialH = 440, offset = 0, initialX = null, initialY = null }) {
  const panelRef = useRef(null)
  const [box, setBox] = useState(() => ({
    // initialX/initialY (the right-click point) win when given — the panel lands
    // under the cursor; otherwise it centers horizontally with the cascade offset.
    x: initialX != null ? initialX : Math.max(12, Math.round((window.innerWidth - initialW) / 2)) + offset,
    y: initialY != null ? initialY : 84 + offset,
    w: initialW,
    h: initialH,
  }))
  // Latest committed box, read at gesture start (state can be stale inside the
  // long-lived pointer listeners; a ref is always current).
  const boxRef = useRef(box)
  useEffect(() => { boxRef.current = box }, [box])

  // Drag by the header grip — DOM-only during the move, one setState on release.
  const onDragPointerDown = useCallback((e) => {
    if (e.target.closest?.('[data-no-drag]')) return
    e.preventDefault()
    const sx = e.clientX, sy = e.clientY
    const base = boxRef.current
    const el = panelRef.current
    let latest = base
    const move = (ev) => {
      latest = { ...base, x: Math.max(0, base.x + (ev.clientX - sx)), y: Math.max(0, base.y + (ev.clientY - sy)) }
      if (el) { el.style.left = `${latest.x}px`; el.style.top = `${latest.y}px` }
    }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      boxRef.current = latest; setBox(latest)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [])

  // Resize from a corner — same DOM-only-during-gesture rule.
  const startResize = (corner) => (e) => {
    e.preventDefault(); e.stopPropagation()
    const sx = e.clientX, sy = e.clientY
    const base = boxRef.current
    const el = panelRef.current
    let latest = base
    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy
      let { x, y, w, h } = base
      if (corner.includes('e')) w = Math.max(MIN_W, base.w + dx)
      if (corner.includes('s')) h = Math.max(MIN_H, base.h + dy)
      if (corner.includes('w')) { const nw = Math.max(MIN_W, base.w - dx); x = base.x + (base.w - nw); w = nw }
      if (corner.includes('n')) { const nh = Math.max(MIN_H, base.h - dy); y = base.y + (base.h - nh); h = nh }
      latest = { x, y, w, h }
      if (el) { el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.width = `${w}px`; el.style.height = `${h}px` }
    }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      boxRef.current = latest; setBox(latest)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div ref={panelRef} className={styles.panel} style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
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
