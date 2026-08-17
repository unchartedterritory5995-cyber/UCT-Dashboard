import styles from './ChartSkeleton.module.css'
// A skeleton is never content: mark it so a capture routine (the journal
// embed's self-archive) refuses to freeze it as the durable snapshot.
import { RENDER_UNAVAILABLE } from '../../lib/captureSafety'

// Cold-load placeholder shown while a chart with NO cached bars fetches.
// Renders a shimmer band over the chart frame instead of a spinner, and never
// shows another ticker's candles. prefers-reduced-motion drops the animation.
export default function ChartSkeleton({ label = 'Loading chart…' }) {
  return (
    <div className={styles.skeleton} role="status" aria-live="polite" aria-busy="true" {...RENDER_UNAVAILABLE}>
      <div className={styles.shimmer} aria-hidden="true" />
      <span className={styles.srOnly}>{label}</span>
    </div>
  )
}
