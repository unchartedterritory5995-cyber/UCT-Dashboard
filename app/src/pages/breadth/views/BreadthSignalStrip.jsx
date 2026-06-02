/**
 * Style-independent callout above the Breadth Views: the gold ★ "Signal of the
 * Day" and, when present, the ◆ "Notable" divergence (which also pulses). Both
 * are clickable when the metric supports drill-down. Renders null if neither
 * signal resolved.
 */
import styles from './signals.module.css'

function Chip({ kicker, kickerClass, metric, currentRow, reason, pulse, onDrill }) {
  if (!metric) return null
  const clickable = !!metric.drillKey
  return (
    <span
      className={`${styles.chip} ${clickable ? styles.chipClickable : ''} ${pulse ? styles.pulse : ''}`}
      role={clickable ? 'button' : undefined}
      aria-label={clickable ? `${metric.label} details` : undefined}
      onClick={clickable ? () => onDrill(metric) : undefined}
    >
      <span className={`${styles.kicker} ${kickerClass}`}>{kicker}</span>
      <span className={styles.chipLabel}>{metric.label}</span>
      <span className={styles.chipValue}>{metric.getFmt(currentRow)}</span>
      {reason && <span className={styles.chipReason}>· {reason}</span>}
    </span>
  )
}

export default function BreadthSignalStrip({
  signalMetric, signalReason, notableMetric, notableReason, currentRow, onDrill,
}) {
  if (!signalMetric && !notableMetric) return null
  return (
    <div className={styles.strip}>
      <Chip kicker="★ Signal of the Day" kickerClass={styles.kickerSignal}
            metric={signalMetric} currentRow={currentRow} reason={signalReason} onDrill={onDrill} />
      <Chip kicker="◆ Notable" kickerClass={styles.kickerNotable}
            metric={notableMetric} currentRow={currentRow} reason={notableReason} pulse onDrill={onDrill} />
    </div>
  )
}
