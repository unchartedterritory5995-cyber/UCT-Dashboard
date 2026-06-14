// app/src/pages/calendar/WeekSummary.jsx
import styles from './Calendar.module.css'

export default function WeekSummary({ stats }) {
  if (!stats) return null
  const col = (lbl, val, cls = '') => (
    <div className={styles.scol}><span className={styles.scolLbl}>{lbl}</span>
      <b className={cls}>{val}</b></div>
  )
  return (
    <div className={styles.summary}>
      {col('Your reports this week', stats.mineCount, styles.gold)}
      {col('Total reporters', stats.total)}
      {stats.biggestMove && col('Biggest expected move', `${stats.biggestMove.sym} ±${stats.biggestMove.pct}%`, styles.gold)}
    </div>
  )
}
