// Shown once usePendingReask has spent its tries and the server still answers "pending".
// Replaces the server's "this fills in by itself" promise, which is no longer true.
import styles from './Depth.module.css'

export default function PendingGaveUp({ exhausted, onRetry, what = 'This' }) {
  if (!exhausted) return null
  return (
    <p className={styles.note} data-testid="pending-gave-up">
      {what} is still being built after several minutes, so automatic checking has stopped.{' '}
      <button type="button" onClick={onRetry}>Check again</button>
    </p>
  )
}
