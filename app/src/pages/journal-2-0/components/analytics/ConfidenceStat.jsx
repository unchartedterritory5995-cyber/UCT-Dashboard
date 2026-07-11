/**
 * ConfidenceStat — the shared n<10 confidence-shading cell for Journal 2.0
 * analytics.
 *
 * Factors out the ad-hoc "dim the value + explain why" idiom that lived inline
 * in EdgeScorecard (AnalyticsTab.jsx) and RiskExitsSection into ONE
 * presentational component every Playbook / Edge / cross-cut cell can reuse.
 *
 * Rules (Global Constraint: canonical confidence threshold = 10):
 *   - n >= min AND value present  → the formatted value, rendered normally.
 *   - n <  min (value present)    → the SAME value, DIMMED but still READABLE
 *     (it's an estimate, not hidden), plus a discoverable "n={n}, need {min}"
 *     title tooltip and an accessible low-confidence aria-label.
 *   - value == null / undefined   → an em-dash "—" with the same "need {min}"
 *     affordance.
 *
 * Presentational only — no data fetching, no hooks. No emoji.
 *
 * @param {object}   props
 * @param {*}        props.value   The stat value (any); null/undefined → em-dash.
 * @param {number}   [props.n]     Sample size behind the stat.
 * @param {number}   [props.min=10] Confidence threshold (canonical = 10).
 * @param {Function} [props.format] value → display string. Defaults to String(value).
 * @param {string}   [props.label] Optional small caption rendered above the value.
 */

import styles from './ConfidenceStat.module.css'

const EM_DASH = '—'

export default function ConfidenceStat({ value, n, min = 10, format, label }) {
  const hasValue = value !== null && value !== undefined
  const enough = typeof n === 'number' && n >= min
  const confident = hasValue && enough

  const display = hasValue ? (format ? format(value) : String(value)) : EM_DASH

  // The "why" affordance — surfaced only when we are NOT confident. Always names
  // the threshold; includes the actual sample size when we know it.
  const need = typeof n === 'number' ? `n=${n}, need ${min}` : `need ${min}`

  // aria-label conveys the low-confidence meaning to assistive tech; omitted
  // (undefined → React drops the attribute) when confident so the value reads
  // as-is.
  const ariaLabel = confident
    ? undefined
    : hasValue
      ? `${display} — low confidence, ${need}`
      : `Not enough data, ${need}`

  return (
    <span className={styles.wrap}>
      {label ? <span className={styles.label}>{label}</span> : null}
      <span
        className={confident ? styles.stat : `${styles.stat} ${styles.dim}`}
        title={confident ? undefined : need}
        aria-label={ariaLabel}
      >
        {display}
      </span>
    </span>
  )
}
