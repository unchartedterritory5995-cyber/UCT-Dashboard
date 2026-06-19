/**
 * ExpiredBanner — top-of-tab alert showing strategies whose legs have
 * expired but which are still marked status='open'. Offers one-click
 * "Mark all expired" for all detected.
 */

import { computeDaysToExpiration } from '../../lib/optionCalcs'
import UIcon from '../../../../components/ui/UIcon'
import styles from './ExpiredBanner.module.css'

export default function ExpiredBanner({ strategies, onMarkAll, onDismiss }) {
  if (!strategies || strategies.length === 0) return null
  const expired = strategies.filter((s) => {
    if (s.status !== 'open') return false
    const dte = computeDaysToExpiration(s.legs)
    return dte != null && dte < 0
  })
  if (expired.length === 0) return null

  return (
    <div className={styles.wrap} role="alert">
      <div className={styles.icon} aria-hidden="true"><UIcon name="warning" size={20} /></div>
      <div className={styles.body}>
        <div className={styles.title}>
          {expired.length} option {expired.length === 1 ? 'strategy has' : 'strategies have'} expired
        </div>
        <div className={styles.sub}>
          {expired.slice(0, 5).map((s) => s.underlying).join(', ')}
          {expired.length > 5 && ` + ${expired.length - 5} more`}
          {' '}— mark them closed to lock in P&L.
        </div>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.markAllBtn}
          onClick={() => onMarkAll?.(expired)}
        >
          Mark all expired
        </button>
        {onDismiss && (
          <button
            type="button"
            className={styles.dismissBtn}
            onClick={onDismiss}
            aria-label="Dismiss"
            title="Hide for this session"
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}
