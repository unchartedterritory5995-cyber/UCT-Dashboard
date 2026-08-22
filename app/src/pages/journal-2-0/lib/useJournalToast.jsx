// Journal Widgets — ONE toast for every Send-to-Journal door. The five
// hand-rolled copies of this (state + 2200ms timeout + a per-widget CSS
// block) had already drifted on top/right/z-index/accent-var by the time the
// design review counted them — the exact "second copy of the flow" drift
// sendToJournal.js warns about, one layer up.
//
// a11y: the chip is a permanent role="status" container whose TEXT toggles —
// transient mount-with-text is silent to screen readers, which made
// "Capture failed — try again" a silent failure (review finding).
import { useEffect, useState } from 'react'
import styles from './useJournalToast.module.css'

export function useJournalToast() {
  const [journalMsg, setJournalMsg] = useState(null)
  useEffect(() => {
    if (!journalMsg) return undefined
    const t = setTimeout(() => setJournalMsg(null), 2200)
    return () => clearTimeout(t)
  }, [journalMsg])
  return [journalMsg, setJournalMsg]
}

/** The chip. Render it unconditionally near the door button; position via
 *  `style` when the host's header needs a different anchor. */
export function JournalToast({ msg, style }) {
  return (
    <span role="status" className={styles.toast} style={style} data-empty={!msg}>
      {msg || ''}
    </span>
  )
}
