/**
 * Today surface — A2 PLACEHOLDER.
 *
 * The real Today flagship (3 session states + zero-data / no-sync /
 * All-Accounts variants, coach strip, week strip, goals) is built in B1 and
 * replaces this file's content. For A2 this is a designed placeholder so the
 * index route (`/journal`) resolves to a real component under the new shell.
 */

import styles from '../JournalLayout.module.css'

export default function TodaySurface() {
  return (
    <div className={styles.placeholder}>
      <p className={styles.placeholderTitle}>Today — coming in this release</p>
      <p className={styles.placeholderHint}>
        Your pre-market readiness, live positions, and end-of-day recap will
        land here. Head to Trades, Journal, or Insights in the meantime.
      </p>
    </div>
  )
}
