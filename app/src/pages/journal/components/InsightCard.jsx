// app/src/pages/journal/components/InsightCard.jsx
import styles from './InsightCard.module.css'

const PRIORITY_COLORS = {
  5: '#c9a84c',
  4: '#3cb868',
  3: '#6ba3be',
  2: '#706b5e',
  1: '#4a4a4a',
}

const CATEGORY_CLASS = {
  performance: styles.categoryPerformance,
  process:     styles.categoryProcess,
  psychology:  styles.categoryPsychology,
  risk:        styles.categoryRisk,
}

function TrendArrow({ trend }) {
  if (!trend) return null
  if (trend === 'improving') return <span className={`${styles.trendArrow} ${styles.trendUp}`}>▲ Improving</span>
  if (trend === 'worsening') return <span className={`${styles.trendArrow} ${styles.trendDown}`}>▼ Worsening</span>
  return <span className={`${styles.trendArrow} ${styles.trendStable}`}>→ Stable</span>
}

export default function InsightCard({ insight, onAction }) {
  const accentColor = PRIORITY_COLORS[insight.priority] || PRIORITY_COLORS[3]
  const catClass = insight.category ? CATEGORY_CLASS[insight.category] : null

  return (
    <div className={styles.card} style={{ borderLeftColor: accentColor }}>
      <div className={styles.body}>
        <div className={styles.statement}>
          {insight.statement}
          <TrendArrow trend={insight.trend} />
        </div>
        <div className={styles.evidence}>{insight.evidence}</div>
      </div>
      {catClass && (
        <span className={`${styles.categoryBadge} ${catClass}`}>
          {insight.category}
        </span>
      )}
      {insight.action_label && onAction && (
        <button
          className={styles.actionBtn}
          onClick={() => onAction(insight)}
        >
          {insight.action_label} &rarr;
        </button>
      )}
    </div>
  )
}
