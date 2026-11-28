// ⭐ (2026-11-27, review of #2934, U1) THE TICKER WAS TAKEN: a switch the handoff is still holding (its rows do not cover
// the view yet: useSymbolHandoff) shows, after PENDING_CUE_MS, a thin line and a small "-> TICKER" chip over the chart.
// The header, the legend, the watermark and the candles stay the outgoing symbol's until the new one paints whole
// (#2934: never a new name over old candles); the cue only tells the member the key was not lost. Most switches commit
// well inside PENDING_CUE_MS and never show it. Its line animates a few times and rests (never an endless animation:
// styles/endlessAnimations.test.js).
import { useEffect, useState } from 'react'
import styles from './PendingSwitchCue.module.css'

/** How long a held switch waits before its cue shows. */
export const PENDING_CUE_MS = 250

/** The symbol a held switch is waiting on, once it has waited PENDING_CUE_MS; null otherwise. */
export function usePendingCue(requestedSym, shownSym, delayMs = PENDING_CUE_MS) {
  const pending = requestedSym && shownSym && requestedSym !== shownSym ? String(requestedSym) : null
  const [cue, setCue] = useState(null)
  useEffect(() => {
    if (!pending) { setCue((c) => (c === null ? c : null)); return undefined }
    const t = setTimeout(() => setCue(pending), delayMs)
    return () => clearTimeout(t)
  }, [pending, delayMs])
  return cue && cue === pending ? cue : null
}

export default function PendingSwitchCue({ sym }) {
  if (!sym) return null
  return (
    <div className={styles.cue} role="status" aria-live="polite" data-testid="pending-switch-cue">
      <span className={styles.line} aria-hidden="true" />
      <span className={styles.chip}>{'→'} {sym}</span>
    </div>
  )
}
