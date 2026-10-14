import { useEffect, useId, useRef, useState } from 'react'
import CoverageLine from '../../../components/provenance/CoverageLine'
import styles from './FocusScreener.module.css'

// eslint-disable-next-line react-refresh/only-export-components -- a pure helper the orchestrator shares with this receipt
export function coverageHasDrop(c) {
  return !!c && ((c.dropped || 0) > 0 || (c.not_computable || 0) > 0)
}
// Returns e.g. "Oct 12 close", or null when there is no usable date.
const dayOrNull = iso => {
  if (typeof iso !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.slice(0, 10))
  if (!m) return null
  const d = new Date(`${m[0]}T12:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()} close`
}
const day = iso => dayOrNull(iso) || 'latest close'

export default function DataReceipt({ snapshotDate, live, coverage }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  const btn = useRef(null)
  const id = useId()
  useEffect(() => {
    if (!open) return undefined
    const onDown = e => { if (!box.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])
  const onKeyDown = e => {
    if (e.key !== 'Escape' || !open) return
    e.preventDefault()
    e.stopPropagation()
    setOpen(false)
    btn.current?.focus()
  }
  const when = dayOrNull(snapshotDate)
  return (
    <span className={styles.menuWrap} ref={box} onKeyDown={onKeyDown}>
      <button ref={btn} type="button" className={styles.receiptBtn} aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => setOpen(o => !o)}>
        <span className={live ? styles.liveDot : styles.idleDot} aria-hidden="true" />
        {live ? 'Live · ' : ''}{day(snapshotDate)}
        <span className={styles.infoMark} aria-hidden="true">i</span>
      </button>
      {open && (
        <div id={id} role="region" aria-label="About this data" className={`${styles.menu} ${styles.menuRight} ${styles.receipt}`}>
          <p className={styles.receiptHead}>Nightly data from {when ? `the ${when}` : 'the latest close'}.{live ? ' Prices near the top of the list are live.' : ''}</p>
          {/* TERM-047: the scan's own four-count receipt, with its reasons and its
              "nothing could be answered" refusal, through the shared CoverageLine. */}
          <CoverageLine coverage={coverage ?? null} density="compact" />
        </div>
      )}
    </span>
  )
}
