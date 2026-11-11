import { fmtPct } from './scanDeckModel'
import styles from './GroupHeader.module.css'

// One section header in the grouped drill list (owner pick, "Option A"): the
// group's full name, how many stocks, their average move, and a bar showing its
// share of the list in the group's colour. Click opens it — and closes whichever
// group was open (accordion, like Theme Tracker).
export default function GroupHeader({ name, count, total, avgPct, color, expanded, onToggle }) {
  const share = total ? Math.max(2, (count / total) * 100) : 0
  return (
    <button type="button" className={styles.head} data-open={expanded || undefined}
      aria-expanded={expanded} onClick={onToggle}
      title={`${name}: ${count} of ${total} stocks${Number.isFinite(avgPct) ? `, average ${fmtPct(avgPct, 2)}` : ''}`}>
      <span className={styles.line}>
        <span className={styles.chev} aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <span className={styles.name}>{name}</span>
        <span className={styles.count}>{count}</span>
        {Number.isFinite(avgPct) && (
          <span className={`${styles.avg} ${avgPct >= 0 ? styles.up : styles.dn}`}>avg {fmtPct(avgPct, 2)}</span>
        )}
      </span>
      <span className={styles.bar}><i style={{ width: `${share}%`, background: color }} /></span>
    </button>
  )
}
