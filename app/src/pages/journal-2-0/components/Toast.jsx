/** Simple toast primitive — single in-flight toast, auto-dismiss 4s. */

import { useEffect } from 'react'
import styles from './Toast.module.css'

export default function Toast({ message, tone = 'info', onDismiss }) {
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => onDismiss?.(), 4000)
    return () => clearTimeout(t)
  }, [message, onDismiss])

  if (!message) return null

  return (
    <div
      className={`${styles.toast} ${styles[`tone_${tone}`]}`}
      role="status"
      aria-live="polite"
    >
      <span className={styles.msg}>{message}</span>
      <button
        type="button"
        className={styles.dismiss}
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
