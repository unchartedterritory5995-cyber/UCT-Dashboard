// app/src/components/research-kit/EmptyState.jsx
import UIcon from '../ui/UIcon'
import styles from './EmptyState.module.css'

/**
 * THE empty-state idiom (spec §3.4) — one component, both surfaces. The old
 * research page used five different idioms for "nothing here" (spinner box,
 * a 280px `.soon` block, `.fnote` text, skeleton rows, an ellipsis); this
 * replaces all of them.
 *
 * Copy rule (§4.4): the title says what is missing, the hint says WHEN it will
 * arrive or what to do — "No transcript yet" / "Typically posts within 2h of
 * the call." Never a bare "No data".
 *
 * `action` is for the fetch-failure case: §4.4 requires a failed section to
 * render with a retry link rather than a blank canvas.
 *
 * Iconography is UIcon — no emoji, ever (see the icon names in
 * components/ui/UIcon.jsx; 'document', 'search', 'clock', 'warning', 'chart'
 * and 'noEntry' are the useful ones here).
 */
export default function EmptyState({
  icon = 'document',
  title,
  hint,
  compact = false,
  action,
  className = '',
}) {
  return (
    <div className={`${styles.wrap} ${compact ? styles.compact : ''} ${className}`}>
      <UIcon name={icon} size={compact ? 16 : 22} className={styles.icon} />
      <div className={styles.title} data-testid="rk-empty-title">
        {title}
      </div>
      {hint != null && hint !== '' && (
        <div className={styles.hint} data-testid="rk-empty-hint">
          {hint}
        </div>
      )}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  )
}
