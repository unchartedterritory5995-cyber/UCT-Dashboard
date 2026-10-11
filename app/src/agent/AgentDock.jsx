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

import { useEffect, useRef, useState } from 'react'
import styles from './AgentPanel.module.css'

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
    <div className={`${styles.dock} ${phase === 'leaving' ? styles.dockGone : ''}`} data-phase={phase}>
      <div ref={slideRef} className={styles.dockSlide}>{children}</div>
    </div>
  )
}
