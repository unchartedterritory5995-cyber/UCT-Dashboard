// app/src/pages/journal/components/StatCard.jsx
import styles from './StatCard.module.css'

function formatValue(value, format) {
  if (value == null || value === '') return '--'
  switch (format) {
    case 'pct':
      return `${value >= 0 ? '+' : ''}${Number(value).toFixed(1)}%`
    case 'dollar':
      return `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    case 'ratio':
      return Number(value).toFixed(2)
    case 'r':
      return `${value >= 0 ? '+' : ''}${Number(value).toFixed(2)}R`
    case 'score':
      return Math.round(value)
    default:
      return String(value)
  }
}

function accentClass(value, accent) {
  if (accent === 'gain') return styles.accentGain
  if (accent === 'loss') return styles.accentLoss
  if (accent === 'auto') {
    if (value > 0) return styles.accentGain
    if (value < 0) return styles.accentLoss
  }
  return ''
}

export default function StatCard({ label, value, format = 'number', accent = 'neutral', suffix }) {
  const formatted = formatValue(value, format)
  const cls = accentClass(value, accent)

  return (
    <div className={styles.card}>
      <div className={styles.label}>{label}</div>
      <div className={`${styles.value} ${cls}`}>
        {formatted}
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </div>
    </div>
  )
}
