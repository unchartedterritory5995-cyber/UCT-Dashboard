// app/src/components/research-kit/RatingChangeList.jsx
import EyebrowLabel from './EyebrowLabel'
import EmptyState from './EmptyState'
import VerdictChip from './VerdictChip'
import styles from './RatingChangeList.module.css'

/* Longest-intent-first: every key is tested with `includes`, and no key is a
   substring of another ('downgrade'.includes('upgrade') === false). */
const ACTION_TONES = [
  ['upgrade', 'positive'],
  ['raised', 'positive'],
  ['downgrade', 'negative'],
  ['lowered', 'negative'],
  ['initiated', 'neutral'],
  ['reiterated', 'neutral'],
  ['maintained', 'neutral'],
]

/**
 * Analyst action → VERDICT_TONES. Pure, case-insensitive, whitespace-tolerant;
 * anything unrecognised is 'neutral' (never a guess dressed as a signal).
 */
export function actionTone(action) {
  const a = String(action ?? '').trim().toLowerCase()
  if (!a) return 'neutral'
  for (const [needle, tone] of ACTION_TONES) if (a.includes(needle)) return tone
  return 'neutral'
}

/**
 * THE shared rating-change rendering (spec §3.4/§5.3).
 *
 * This ONE component replaces the three variants that exist today:
 * AnalystPanel's ActionRow, CallRecapSection's RatingChanges, and EstimatesTab's
 * `.rcrow`. P2/P3 point all three at this; do not add a fourth.
 *
 * `rows`: [{ date, firm, from, to, action, pt }]. `cap` limits what renders and
 * the remainder is REPORTED ("+3 more"), never silently dropped — an audit
 * trail that quietly truncates is not an audit trail.
 */
export default function RatingChangeList({
  rows,
  cap = 5,
  label,
  info,
  className = '',
}) {
  const all = Array.isArray(rows) ? rows : []

  if (all.length === 0) {
    return (
      <EmptyState
        compact
        icon="document"
        title="No rating changes"
        hint="Analyst actions appear here as firms update coverage."
        className={className}
      />
    )
  }

  const shown = all.slice(0, Math.max(0, cap))
  const overflow = all.length - shown.length

  return (
    <div className={`${styles.wrap} ${className}`}>
      {label && <EyebrowLabel info={info}>{label}</EyebrowLabel>}

      <ul className={styles.list}>
        {shown.map((r, i) => (
          <li key={`${r.date ?? ''}-${r.firm ?? ''}-${i}`} className={styles.row} data-testid="rk-rc-row">
            <span className={`${styles.date} t-num`} data-testid="rk-rc-date">
              {r.date || '—'}
            </span>
            <span className={styles.firm} title={typeof r.firm === 'string' ? r.firm : undefined}>
              {r.firm || '—'}
            </span>
            <span className={styles.grades} data-testid="rk-rc-grades">
              <span className={styles.from}>{r.from || '—'}</span>
              <span className={styles.arrow} aria-hidden="true">
                →
              </span>
              {/* M3: the arrow is aria-hidden with no text alternative, so a
                  screen reader reads "Equal-Weight Overweight" with no
                  relationship between them — insert the visually-hidden word
                  it stands in for. */}
              <span className={styles.srOnly}>to</span>
              <span className={styles.to}>{r.to || '—'}</span>
            </span>
            <span className={styles.action}>
              <VerdictChip size="sm" tone={actionTone(r.action)} label={r.action || 'Update'} />
            </span>
            <span className={`${styles.pt} t-num`} data-testid="rk-rc-pt">
              {r.pt || ''}
            </span>
          </li>
        ))}
      </ul>

      {overflow > 0 && (
        <div className={styles.more} data-testid="rk-rc-more">
          +{overflow} more
        </div>
      )}
    </div>
  )
}
