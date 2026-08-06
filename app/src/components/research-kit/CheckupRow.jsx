// app/src/components/research-kit/CheckupRow.jsx
import UIcon from '../ui/UIcon'
import styles from './CheckupRow.module.css'

const STATUSES = new Set(['pass', 'fail', 'neutral'])

/**
 * The backend's third state is `neutral` (api/services/research/ratings.py
 * `_chk`), not `na`. Accept `na` as an alias, normalise anything unknown to
 * neutral, never throw.
 */
export function normalizeStatus(status) {
  const s = typeof status === 'string' ? status.trim().toLowerCase() : ''
  if (s === 'na' || s === 'n/a') return 'neutral'
  return STATUSES.has(s) ? s : 'neutral'
}

/**
 * One Stock Checkup line (spec §5.3): requirement, outcome, and the ACTUAL
 * number that produced it — "ROE 28.4% vs 17% req ✓". A pass/fail with no
 * number is an assertion; with the number it is an audit trail (§2.2).
 *
 * SHAPE, NOT COLOUR (§3.3): the outcome is a UIcon check/x — the tint is the
 * redundant channel. The neutral state is a text marker, because "no icon" is
 * itself the signal that nothing was measured.
 */
export default function CheckupRow({ label, status, value, threshold, className = '' }) {
  const s = normalizeStatus(status)

  return (
    <div className={`${styles.row} ${styles[s]} ${className}`} data-status={s} data-testid="rk-checkup">
      <span className={styles.glyph} data-testid="rk-checkup-glyph" aria-hidden="true">
        {s === 'pass' ? <UIcon name="check" size={13} gold={false} />
          : s === 'fail' ? <UIcon name="x" size={13} gold={false} />
            : '—'}
      </span>
      <span className={styles.label}>{label}</span>
      <span className={`${styles.value} t-num`} data-testid="rk-checkup-value">
        {value == null || value === '' ? '—' : value}
      </span>
      {threshold != null && threshold !== '' && (
        <span className={`${styles.threshold} t-num`} data-testid="rk-checkup-threshold">
          vs {threshold}
        </span>
      )}
      <span className={styles.srOnly} data-testid="rk-checkup-sr">{s}</span>
    </div>
  )
}
