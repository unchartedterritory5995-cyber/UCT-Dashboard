/** RH-style Earnings section — quarterly EPS estimate vs actual. */
import styles from './PositionDetailPage.module.css'

const MAX_ROWS = 8
const num = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—')

export default function EarningsSection({ quarterly }) {
  const rows = (quarterly || []).filter((q) => q?.label).slice(-MAX_ROWS)
  if (!rows.length) return null
  return (
    <section className={styles.section} aria-label="Earnings">
      <h2 className={styles.sectionTitle}>Earnings</h2>
      <table className={styles.earnTable}>
        <thead>
          <tr>
            <th>Quarter</th>
            <th>EPS est</th>
            <th>EPS actual</th>
            <th>Surprise</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((q) => (
            <tr key={q.label}>
              <td>{q.label}</td>
              <td>{num(q.eps_estimate)}</td>
              <td>{num(q.eps_actual)}</td>
              <td className={
                q.eps_surprise_pct > 0 ? styles.pos : q.eps_surprise_pct < 0 ? styles.neg : ''
              }>
                {Number.isFinite(q.eps_surprise_pct)
                  ? `${q.eps_surprise_pct > 0 ? '+' : ''}${q.eps_surprise_pct.toFixed(1)}%`
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
