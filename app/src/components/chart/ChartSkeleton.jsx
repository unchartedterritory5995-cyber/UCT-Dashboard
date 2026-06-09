import styles from './ChartSkeleton.module.css'

// Cold-load placeholder shown while a chart with NO cached bars fetches.
// Renders a shimmer band over the chart frame instead of a spinner, and never
// shows another ticker's candles. prefers-reduced-motion drops the animation.
export default function ChartSkeleton({ label = 'Loading chart…' }) {
  return (
    <div className={styles.skeleton} role="status" aria-live="polite" aria-busy="true">
      <div className={styles.shimmer} aria-hidden="true" />
      <span className={styles.srOnly}>{label}</span>
    </div>
  )
}
