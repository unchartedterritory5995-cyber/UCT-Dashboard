import { useEffect, useId, useRef, useState } from 'react'
import styles from './FocusScreener.module.css'

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
const n = v => (Number.isFinite(v) ? v.toLocaleString('en-US') : '—')

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
          {coverage && (
            <dl className={styles.receiptGrid}>
              <div><dt>checked</dt><dd>{n(coverage.evaluated)}</dd></div>
              <div><dt>answered</dt><dd>{n(coverage.answered)}</dd></div>
              <div><dt>dropped</dt><dd>{n(coverage.dropped)}</dd></div>
              <div><dt>not computable</dt><dd>{n(coverage.not_computable)}</dd></div>
            </dl>
          )}
        </div>
      )}
    </span>
  )
}
