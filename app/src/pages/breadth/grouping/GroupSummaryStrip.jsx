import styles from './GroupSummaryStrip.module.css'

// One-line leaderboard above a grouped list: which groups dominate today.
//   summary — [{ key, count, avgPct }] | null (from useBreadthGrouping)
//   onPick  — optional (key) => void  (e.g. collapse/expand that group)
export default function GroupSummaryStrip({ summary, dimension, onPick }) {
  if (!summary || !summary.length) return null
  const real = summary.filter(s => s.key !== 'Unclassified')
  if (!real.length) return null
  return (
    <div className={styles.strip}>
      <span className={styles.lead}>Top {dimension === 'sector' ? 'sectors' : 'industries'}</span>
      {real.map(s => (
        <button
          key={s.key}
          type="button"
          className={styles.chip}
          onClick={onPick ? () => onPick(s.key) : undefined}
          title={onPick ? 'Jump to this group' : undefined}
        >
          <span className={styles.name}>{s.key}</span>
          <span className={styles.count}>{s.count}</span>
          <span className={s.avgPct >= 0 ? styles.up : styles.dn}>
            {s.avgPct > 0 ? '+' : ''}{s.avgPct.toFixed(1)}%
          </span>
        </button>
      ))}
    </div>
  )
}
