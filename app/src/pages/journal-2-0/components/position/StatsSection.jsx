/** RH-style Stats grid — the CLOSED stats list from statsModel. */
import styles from './PositionDetailPage.module.css'

export default function StatsSection({ rows }) {
  if (!rows?.length || rows.every((r) => r.value === '—')) return null
  return (
    <section className={styles.section} aria-label="Stats">
      <h2 className={styles.sectionTitle}>Stats</h2>
      <div className={styles.statsGrid}>
        {rows.map((r) => (
          <div key={r.label} className={styles.statCell}>
            <div className={styles.statLabel}>{r.label}</div>
            <div className={styles.statValue}>{r.value}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
