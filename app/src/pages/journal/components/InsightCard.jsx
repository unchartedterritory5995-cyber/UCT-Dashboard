// app/src/pages/journal/components/InsightCard.jsx
import styles from './InsightCard.module.css'

const PRIORITY_COLORS = {
  5: '#c9a84c',
  4: '#3cb868',
  3: '#6ba3be',
  2: '#706b5e',
  1: '#4a4a4a',
}

export default function InsightCard({ insight, onAction }) {
  const accentColor = PRIORITY_COLORS[insight.priority] || PRIORITY_COLORS[3]

  return (
    <div className={styles.card} style={{ borderLeftColor: accentColor }}>
      <div className={styles.body}>
        <div className={styles.statement}>{insight.statement}</div>
        <div className={styles.evidence}>{insight.evidence}</div>
      </div>
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
