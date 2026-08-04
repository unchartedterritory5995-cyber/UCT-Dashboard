// app/src/components/research-kit/StatTile.jsx
import EyebrowLabel from './EyebrowLabel'
import styles from './StatTile.module.css'

const TONE_CLASS = {
  elite: 'toneElite',
  strong: 'toneStrong',
  neutral: 'toneNeutral',
  weak: 'toneWeak',
  poor: 'tonePoor',
}

/**
 * The kit's stat primitive: label → value → optional sub-line (spec §3.2, and
 * the dataviz "numbers get hierarchy from type scale, not decoration" rule).
 * No card-in-card border, no per-stat icon, no drop shadow on data.
 *
 * `tone` takes SCORE_TONES ('elite'|'strong'|'neutral'|'weak'|'poor') and
 * colours the value from the --score-* ramp. It is for GRADES AND SCORES only.
 * It is NOT the gain/loss channel — a red *number* reads as an error state; use
 * a VerdictChip beside the tile for a semantic delta. An unrecognised tone
 * (e.g. a VERDICT_TONES value passed by mistake) renders with no tone class at
 * all rather than guessing.
 *
 * The value always wears `.t-num` — a polling surface with proportional digits
 * jitters as the numbers change (§3.2).
 */
export default function StatTile({
  label,
  value,
  sub,
  tone,
  info,
  align = 'left',
  className = '',
}) {
  const toneCls = tone ? styles[TONE_CLASS[tone]] : undefined
  const alignCls = align === 'right' ? styles.alignRight : ''

  return (
    <div className={`${styles.tile} ${alignCls} ${className}`}>
      <EyebrowLabel info={info}>{label}</EyebrowLabel>
      <div
        className={`${styles.value} ${toneCls || ''} t-num`}
        data-testid="rk-stat-value"
      >
        {value == null || value === '' ? '—' : value}
      </div>
      {sub != null && sub !== '' && (
        <div className={`${styles.sub} t-num`} data-testid="rk-stat-sub">
          {sub}
        </div>
      )}
    </div>
  )
}
