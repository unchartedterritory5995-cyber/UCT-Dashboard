// app/src/components/calendar/SentimentGauge.jsx
// Compact sentiment gauge bar for EarningsModal.
// Expects { score, label, rationale, drivers[] } from /api/earnings/sentiment/{ticker}.
// score: -1.0 to +1.0 range (−1 = very bearish, +1 = very bullish).
// Null-safe: returns null when data missing.
import useSentiment from '../../hooks/useSentiment'
import styles from './SentimentGauge.module.css'

function scoreToCss(score) {
  if (score == null) return styles.labelNeutral
  if (score >= 0.4) return styles.labelBull
  if (score <= -0.4) return styles.labelBear
  return styles.labelNeutral
}

function scoreToBarWidth(score) {
  // Map −1..+1 → 0..100 percent fill for a center-origin bar.
  if (score == null) return 50
  return Math.round(((score + 1) / 2) * 100)
}

function scoreToBarClass(score) {
  if (score == null) return styles.barNeutral
  if (score > 0.1) return styles.barBull
  if (score < -0.1) return styles.barBear
  return styles.barNeutral
}

/**
 * SentimentGauge — standalone component that fetches its own data.
 * Pass ticker only; handles loading/null internally.
 */
export default function SentimentGauge({ ticker }) {
  const { data } = useSentiment(ticker)
  if (!data) return null
  return <SentimentGaugeDisplay data={data} />
}

/**
 * SentimentGaugeDisplay — pure display component (also exported for tests).
 * Accepts { score, label, rationale, drivers[] } directly.
 */
export function SentimentGaugeDisplay({ data }) {
  if (!data) return null
  const { score, label, rationale, drivers } = data
  const barWidth = scoreToBarWidth(score)
  const labelCls = scoreToCss(score)
  const barCls = scoreToBarClass(score)

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>EARNINGS SENTIMENT</span>
        {label && <span className={`${styles.labelPill} ${labelCls}`}>{label.toUpperCase()}</span>}
        {score != null && (
          <span className={styles.scoreNum}>{score >= 0 ? '+' : ''}{score.toFixed(2)}</span>
        )}
      </div>

      {/* Gauge bar — center-anchored fill */}
      <div className={styles.barTrack}>
        <div className={styles.barCenter} />
        <div
          className={`${styles.barFill} ${barCls}`}
          style={{ width: `${Math.abs(barWidth - 50)}%`, [score >= 0 ? 'left' : 'right']: '50%' }}
        />
      </div>
      <div className={styles.barLabels}>
        <span>Bearish</span>
        <span>Neutral</span>
        <span>Bullish</span>
      </div>

      {rationale && (
        <p className={styles.rationale}>{rationale}</p>
      )}

      {drivers && drivers.length > 0 && (
        <ul className={styles.drivers}>
          {drivers.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      )}
    </div>
  )
}
