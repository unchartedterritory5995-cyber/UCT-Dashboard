// ── The Agent's slot beside the workspace: instant open and close ───────────────
//
// Owner's call (10-10): no slide — clicking UCT AGENT snaps the panel in or out and the charts
// snap to their new width in the same moment.
//   • The board's grid normally ANIMATES its widgets to a new width (react-grid-layout's 200 ms
//     item transition). While the Agent toggles, that transition is switched off (an attribute
//     on <html> for a moment), so the charts snap instead of sliding.
//   • The grid re-measures its width a frame or two after the click. On CLOSE the panel stays
//     painted (its slot already given back) until the charts have snapped wider underneath it,
//     so no empty strip ever shows.

import { useEffect, useState } from 'react'
import styles from './AgentPanel.module.css'

const SNAP_MS = 320          // grid transitions off: covers its re-measure + any queued item move
const LEAVE_HOLD_MS = 90     // closing: the panel stays painted until the charts have re-tiled

function snapGrid() {
  const root = document.documentElement
  root.setAttribute('data-agent-toggling', '')
  clearTimeout(snapGrid.t)
  snapGrid.t = setTimeout(() => root.removeAttribute('data-agent-toggling'), SNAP_MS)
}

export default function AgentDock({ open, children }) {
  // 'closed' (unmounted) → 'open' → 'leaving' (slot given back, panel still painted) → 'closed'
  const [phase, setPhase] = useState(open ? 'open' : 'closed')
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {             // derive the change during render (no effect → setState)
    setWasOpen(open)
    setPhase(open ? 'open' : 'leaving')
  }
  useEffect(() => { if (open !== undefined) snapGrid() }, [open])
  useEffect(() => {
    if (phase !== 'leaving') return undefined
    const t = setTimeout(() => setPhase('closed'), LEAVE_HOLD_MS)
    return () => clearTimeout(t)
  }, [phase])

  if (phase === 'closed') return null
  return (
    <div className={`${styles.dock} ${phase === 'leaving' ? styles.dockGone : ''}`} data-phase={phase}>
      <div className={styles.dockSlide}>{children}</div>
    </div>
  )
}
