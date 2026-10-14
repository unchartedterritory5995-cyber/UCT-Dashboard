import styles from './FocusScreener.module.css'

// Only kind 'check' earns a tick. 'pool' and 'note' (including a checkable
// filter whose row value was missing) get the open circle: we never claim a
// pass we did not verify on this row.
export default function WhyItsHere({ items, more, onMore }) {
  if (!items?.length) return null
  return (
    <div className={styles.why}>
      <span className={styles.whyLabel} id="why-label">Why it&apos;s here</span>
      <ul className={styles.whyList} aria-labelledby="why-label" aria-label="Why it's here">
        {items.map((it, i) => (
          <li key={i} className={styles.whyItem}>
            <span aria-hidden="true" className={it.kind === 'check' ? styles.whyCheck : styles.whyPool}>
              {it.kind === 'check' ? '✓' : '○'}
            </span>
            <span className="sr-only">{it.kind === 'check' ? 'Passes: ' : ''}</span>
            <span className={styles.whyText}>{it.label}</span>
            {it.value && <span className={styles.whyValue}>{it.value}</span>}
          </li>
        ))}
        {more > 0 && <li><button type="button" className={styles.linkBtn} onClick={onMore}>+{more} more</button></li>}
      </ul>
    </div>
  )
}
