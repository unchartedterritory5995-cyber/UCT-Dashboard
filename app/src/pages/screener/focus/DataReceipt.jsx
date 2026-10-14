import { useEffect, useRef, useState } from 'react'
import styles from './FocusScreener.module.css'

export function coverageHasDrop(c) {
  return !!c && ((c.dropped || 0) > 0 || (c.not_computable || 0) > 0)
}
const day = iso => {
  if (!iso) return 'latest close'
  const d = new Date(`${iso}T12:00:00`)
  return `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()} close`
}
const n = v => (Number.isFinite(v) ? v.toLocaleString('en-US') : '—')

export default function DataReceipt({ snapshotDate, live, coverage }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = e => { if (!box.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  return (
    <span className={styles.menuWrap} ref={box}>
      <button type="button" className={styles.receiptBtn} aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className={live ? styles.liveDot : styles.idleDot} aria-hidden="true" />
        {live ? 'Live · ' : ''}{day(snapshotDate)}
        <span className={styles.infoMark} aria-hidden="true">i</span>
      </button>
      {open && (
        <div role="dialog" aria-label="About this data" className={`${styles.menu} ${styles.menuRight} ${styles.receipt}`}
          onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}>
          <p className={styles.receiptHead}>Nightly data from {day(snapshotDate)}.{live ? ' Prices near the top of the list are live.' : ''}</p>
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
