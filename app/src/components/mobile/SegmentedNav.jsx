import styles from './SegmentedNav.module.css'

/* SegmentedNav — horizontal segmented control / scrollable chip strip for
 * sub-navigation (Markets chip sub-nav, Journal tabs, Breadth views, interior
 * tabs). Items: [{ key, label, icon? }]. Controlled via value/onChange.
 */
export default function SegmentedNav({
  items = [],
  value,
  onChange,
  ariaLabel = 'Views',
  scrollable = true,
  className = '',
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`${styles.bar} ${scrollable ? styles.scroll : ''} ${className}`}
    >
      {items.map((it) => {
        const active = it.key === value
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={`${styles.seg} ${active ? styles.active : ''}`}
            onClick={() => onChange?.(it.key)}
          >
            {it.icon != null && <span className={styles.icon} aria-hidden="true">{it.icon}</span>}
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
