// ── The Agent's slot beside the workspace: instant open and close ───────────────
//
// Owner's call (10-10): no slide — clicking UCT AGENT snaps the panel in or out and the charts
// snap to their new width in the same moment, close the exact mirror of open.
//   • The board's grid normally ANIMATES its widgets to a new width (react-grid-layout's 200 ms
//     item transition). While the Agent toggles, that transition is switched off (an attribute
//     on <html> for a moment), so the charts snap instead of sliding.
//   • The grid re-measures its width a frame after the click. On CLOSE the slot is given back at
//     once and the panel is hidden in the VERY frame the charts have re-tiled underneath it —
//     caught by a ResizeObserver on the charts, not a delay — so it never lingers and no empty
//     strip shows.
//   • RESIZE (10-12): the slot's LEFT edge is a separator the member drags (or moves with the arrow
//     keys; double-click / Enter resets). The width lives in ONE CSS variable (`--agent-w`, read by
//     the dock, the slide and the panel); during a drag it is written straight onto the dock (no
//     React render per move) and the board re-tiles through its own ResizeObserver. Limits and
//     persistence: agentWidth.js.

import { useEffect, useRef, useState } from 'react'
import styles from './AgentPanel.module.css'
import { AGENT_W_DEFAULT, AGENT_W_MIN, KEY_STEP, KEY_STEP_BIG, clampAgentWidth, maxAgentWidth, readAgentWidth, writeAgentWidth } from './agentWidth'

const SNAP_MS = 320          // grid transitions off: covers its re-measure + any queued item move
const MAX_HOLD_MS = 100      // closing fallback: never hold the panel longer than this

function snapGrid() {
  const root = document.documentElement
  root.setAttribute('data-agent-toggling', '')
  clearTimeout(snapGrid.t)
  snapGrid.t = setTimeout(() => root.removeAttribute('data-agent-toggling'), SNAP_MS)
}

// The right edge of the board's widgets: it moves the moment the grid has re-tiled.
const boardEdge = () => {
  let r = 0
  for (const el of document.querySelectorAll('.react-grid-item')) r = Math.max(r, el.getBoundingClientRect().right)
  return Math.round(r)
}

export default function AgentDock({ open, children }) {
  // 'closed' (unmounted) → 'open' → 'leaving' (slot given back, panel painted) → 'closed'
  const [phase, setPhase] = useState(open ? 'open' : 'closed')
  const [wasOpen, setWasOpen] = useState(open)
  const slideRef = useRef(null)
  const edgeRef = useRef(0)
  const dockRef = useRef(null)
  const dragRef = useRef(null)
  const [chosen, setChosen] = useState(readAgentWidth)        // the member's width (storage)
  const [rowW, setRowW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 0))
  const mounted = phase !== 'closed'
  const rowWidth = () => dockRef.current?.parentElement?.getBoundingClientRect().width || rowW
  // the row the dock sits in: re-clamp when the WINDOW changes (the chosen width is kept)
  useEffect(() => {
    const el = dockRef.current?.parentElement
    if (!el) return undefined
    const measure = () => { if (!dragRef.current) setRowW(Math.round(el.getBoundingClientRect().width) || window.innerWidth) }
    const raf = requestAnimationFrame(measure)      // the first measure, wherever it runs
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure)
      ro.observe(el)
      return () => { cancelAnimationFrame(raf); ro.disconnect() }
    }
    window.addEventListener('resize', measure)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', measure) }
  }, [mounted])
  const width = clampAgentWidth(chosen, rowW)
  const commit = (w) => {
    const row = rowWidth()
    const v = clampAgentWidth(w, row)
    snapGrid()
    setRowW(Math.round(row))
    setChosen(v)
    writeAgentWidth(v)
  }
  const onPointerDown = (e) => {
    if (e.button !== 0) return
    e.preventDefault()                // no text selection, no chart pan / drawing underneath
    e.stopPropagation()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* jsdom */ }
    dragRef.current = { x: e.clientX, w: width, row: rowWidth(), last: width }
    document.documentElement.setAttribute('data-agent-resizing', '')
    document.documentElement.setAttribute('data-agent-toggling', '')
  }
  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d) return
    e.preventDefault()
    const w = clampAgentWidth(d.w + (d.x - e.clientX), d.row)     // left = wider
    if (w === d.last) return
    d.last = w
    dockRef.current?.style.setProperty('--agent-w', `${w}px`)
  }
  const endDrag = (e) => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* jsdom */ }
    document.documentElement.removeAttribute('data-agent-resizing')
    if (d.last !== d.w) commit(d.last)
    else snapGrid()
  }
  const onKeyDown = (e) => {
    const step = e.shiftKey ? KEY_STEP_BIG : KEY_STEP
    let w = null
    if (e.key === 'ArrowLeft') w = width + step
    else if (e.key === 'ArrowRight') w = width - step
    else if (e.key === 'Home') w = AGENT_W_MIN
    else if (e.key === 'End') w = maxAgentWidth(rowWidth())
    else if (e.key === 'Enter') w = AGENT_W_DEFAULT
    if (w == null) return
    e.preventDefault()
    e.stopPropagation()               // never a chart shortcut
    commit(w)
  }
  if (open !== wasOpen) {             // derive the change during render (no effect → setState)
    setWasOpen(open)
    setPhase(open ? 'open' : 'leaving')
  }
  useEffect(() => { snapGrid() }, [open])
  // Remember where the charts end while the panel is open (the close compares against it).
  useEffect(() => { if (phase === 'open') edgeRef.current = boardEdge() })
  useEffect(() => {
    if (phase !== 'leaving') return undefined
    // The browser reports a resize after layout and BEFORE paint, so hiding the panel here lands
    // in the very frame the charts take their new width — the exact mirror of opening.
    const hide = () => {
      if (slideRef.current) slideRef.current.style.visibility = 'hidden'
      setPhase('closed')
    }
    const items = [...document.querySelectorAll('.react-grid-item')]
    const ro = typeof ResizeObserver !== 'undefined' && items.length
      ? new ResizeObserver(() => { if (boardEdge() !== edgeRef.current) { ro.disconnect(); hide() } })
      : null
    items.forEach(el => ro?.observe(el))
    const fallback = setTimeout(hide, ro ? MAX_HOLD_MS : 0)   // no grid / no change: never linger
    return () => { ro?.disconnect(); clearTimeout(fallback) }
  }, [phase])

  if (phase === 'closed') return null
  return (
    <div ref={dockRef} className={`${styles.dock} ${phase === 'leaving' ? styles.dockGone : ''}`} data-phase={phase}
      style={{ '--agent-w': `${width}px` }}>
      {phase === 'open' && (
        <div
          className={styles.resizer} role="separator" aria-orientation="vertical" tabIndex={0}
          aria-label="Resize UCT Agent" aria-valuenow={width} aria-valuemin={AGENT_W_MIN} aria-valuemax={maxAgentWidth(rowW)}
          title="Drag to resize · double-click to reset"
          data-testid="agent-resizer"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onDoubleClick={() => commit(AGENT_W_DEFAULT)} onKeyDown={onKeyDown}
        />
      )}
      <div ref={slideRef} className={styles.dockSlide}>{children}</div>
    </div>
  )
}
