// app/src/components/ErrorState.jsx
import styles from './ErrorState.module.css'

export default function ErrorState({ message = 'Something went wrong', onRetry, compact = false }) {
  return (
    <div className={compact ? styles.wrapper : styles.wrapperFull}>
      <span className={styles.icon}>⚠</span>
      <p className={styles.message}>{message}</p>
      {onRetry && (
        <button className={styles.retryBtn} onClick={onRetry}>
          Tap to retry
        </button>
      )}
    </div>
  )
}
