// ── The Agent's slot beside the workspace: a smooth slide in and out ─────────────
//
// The board's grid already ANIMATES its widgets to a new width (react-grid-layout's 200 ms
// item transition, started ~40 ms later by its width measurement). The dock moves with it:
//   OPEN   the slot takes its width at once (the charts start shrinking) and the panel slides in
//          from the right edge, a step ahead of them, so it covers their edge — never a gap.
//   CLOSE  the slot gives its width back at once (the charts start growing) and the panel slides
//          out after the grid's ~40 ms start, so the growing charts stay under it — never a gap —
//          then unmounts.
// The slide is a CSS transform animation (GPU, no layout per frame, no JS per frame).

import { useEffect, useState } from 'react'
import styles from './AgentPanel.module.css'

export const DOCK_MS = 240
const LEAVE_DELAY_MS = 40

export default function AgentDock({ open, children }) {
  // 'closed' (unmounted) → 'open' (mounted; slides in on mount) → 'leaving' → 'closed'
  const [phase, setPhase] = useState(open ? 'open' : 'closed')
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {             // derive the transition during render (no effect → setState)
    setWasOpen(open)
    setPhase(open ? 'open' : 'leaving')
  }
  useEffect(() => {
    if (phase !== 'leaving') return undefined
    const t = setTimeout(() => setPhase('closed'), DOCK_MS + LEAVE_DELAY_MS)
    return () => clearTimeout(t)
  }, [phase])

  if (phase === 'closed') return null
  return (
    <div className={`${styles.dock} ${phase === 'leaving' ? styles.dockGone : ''}`} data-phase={phase}>
      <div className={`${styles.dockSlide} ${phase === 'leaving' ? styles.dockOut : ''}`}>{children}</div>
    </div>
  )
}
