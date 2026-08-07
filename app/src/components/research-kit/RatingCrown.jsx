// app/src/components/research-kit/RatingCrown.jsx
import CoverageNote from './CoverageNote'
import EmptyState from './EmptyState'
import EyebrowLabel from './EyebrowLabel'
import InfoTip from './InfoTip'
import styles from './RatingCrown.module.css'

/** §3.4 skeleton size contract (full variant). */
export const SIZE = { width: '100%', height: 300 }

const DIAMETER = { full: 132, compact: 44 }
const STROKE = { full: 10, compact: 4 }
/** The scale is 0-99 (IBD-style), not 0-100. */
const MAX = 99

/** The seven components, in ONE fixed order. `kind` decides the chip's form. */
export const COMPONENT_ORDER = [
  { key: 'eps', label: 'EPS Strength', kind: 'score' },
  { key: 'rs', label: 'Relative Strength', kind: 'score' },
  { key: 'growth', label: 'Growth', kind: 'score' },
  { key: 'value', label: 'Value', kind: 'score' },
  { key: 'smr', label: 'SMR', kind: 'letter' },
  { key: 'accdis', label: 'Acc / Dis', kind: 'letter' },
  { key: 'sponsorship', label: 'Sponsorship', kind: 'letter' },
]

const TONE_CLASS = {
  elite: 'toneElite',
  strong: 'toneStrong',
  neutral: 'toneNeutral',
  weak: 'toneWeak',
  poor: 'tonePoor',
}

/**
 * SCORE_TONES band for a 0-99 score. These are the thresholds already shipping
 * in pages/research/tabs/RatingsTab.jsx — the crown REPLACES that function, it
 * does not recalibrate it. null (not 'poor') for a missing score: absent is not
 * the same as bad.
 */
export function scoreTier(v) {
  // Explicit null/undefined check: Number(null) === 0 is a phantom zero trap
  if (v == null) return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  if (n >= 80) return 'elite'
  if (n >= 60) return 'strong'
  if (n >= 40) return 'neutral'
  if (n >= 20) return 'weak'
  return 'poor'
}

/** SCORE_TONES band for an A-F letter component. */
export function letterTier(l) {
  // Explicit null/undefined check before string conversion
  if (l == null) return null
  const s = typeof l === 'string' ? l.trim().toUpperCase() : ''
  if (!s) return null
  if (s.startsWith('A')) return 'elite'
  if (s.startsWith('B')) return 'strong'
  if (s.startsWith('C')) return 'neutral'
  if (s.startsWith('D')) return 'weak'
  return 'poor'
}

/** Arc geometry for the ring. Pure — the dash length IS the score. */
export function ringGeometry(score, { diameter = DIAMETER.full, stroke = STROKE.full } = {}) {
  const r = (diameter - stroke) / 2
  const circumference = 2 * Math.PI * r
  const n = Number(score)
  const pct = Number.isFinite(n) ? Math.max(0, Math.min(MAX, n)) / MAX : 0
  return { r, cx: diameter / 2, cy: diameter / 2, diameter, stroke, circumference, dash: circumference * pct }
}

/**
 * The §5.3 basis pill, in plain English and DATA-DRIVEN so the percentile job
 * can land without a redesign. Percentile wording requires a universe count —
 * "ranked vs an unknown number of stocks" is not an audit trail.
 */
export function basisPill(basis, universeN) {
  const n = Number(universeN)
  if (basis === 'percentile' && Number.isFinite(n) && n > 0) {
    return {
      text: `Ranked vs ${n.toLocaleString('en-US')} stocks`,
      info: 'Each component is a percentile rank across the covered universe, refreshed nightly.',
    }
  }
  return {
    text: 'Scored against fixed thresholds — not ranked vs other stocks',
    info: 'Scores compare this stock against fixed thresholds. When percentile ranking is switched on, scores may shift.',
  }
}

/**
 * THE ratings rendering (spec §5.3) — composite ring + the seven component
 * chips. The page header's badge is this same component with
 * `variant="compact"`; there is no second ring and no third number style.
 *
 * IDENTITY (§4.2): the stock's rating is a RING; the event's Earnings Setup
 * Grade is a CHIP. This component stamps data-rk-identity="ring" and must never
 * render a VerdictChip — P2 asserts the two identities stay distinct.
 */
export default function RatingCrown({
  score,
  components,
  basis = 'absolute',
  universeN = null,
  method,
  coverage = null,
  variant = 'full',
  label = 'UCT Rating',
  info,
  className = '',
  ariaLabel,
}) {
  const comp = components || {}
  const tier = scoreTier(score)
  const hasAny = tier != null || COMPONENT_ORDER.some((c) => comp[c.key] != null)

  if (!hasAny) {
    return (
      <EmptyState
        icon="warning"
        title="Ratings unavailable for this ticker"
        hint="A rating needs fundamentals and price history; both are missing here."
        className={className}
      />
    )
  }

  const compact = variant === 'compact'
  const geo = ringGeometry(score, {
    diameter: compact ? DIAMETER.compact : DIAMETER.full,
    stroke: compact ? STROKE.compact : STROKE.full,
  })
  const pill = basisPill(basis, universeN)
  const built = ariaLabel
    || `${label} ${score ?? '—'} of ${MAX}${tier ? ` — ${tier}` : ''}. ${pill.text}.`

  return (
    <div
      className={`${styles.wrap} ${compact ? styles.compact : ''} ${className}`}
      data-rk-identity="ring"
    >
      {!compact && label && <EyebrowLabel info={info}>{label}</EyebrowLabel>}

      <div className={styles.ringWrap} role="img" aria-label={built}>
        <svg className={styles.ring} viewBox={`0 0 ${geo.diameter} ${geo.diameter}`} width={geo.diameter} height={geo.diameter}>
          <circle
            className={styles.track}
            cx={geo.cx} cy={geo.cy} r={geo.r}
            strokeWidth={geo.stroke}
            fill="none"
          />
          <circle
            className={`${styles.arc} ${tier ? styles[TONE_CLASS[tier]] : ''}`}
            cx={geo.cx} cy={geo.cy} r={geo.r}
            strokeWidth={geo.stroke}
            fill="none"
            strokeDasharray={`${geo.dash} ${geo.circumference - geo.dash}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${geo.cx} ${geo.cy})`}
          />
        </svg>
        <div className={`${styles.score} ${tier ? styles[TONE_CLASS[tier]] : ''} t-num`} data-testid="rk-crown-score">
          {score == null ? '—' : score}
        </div>
      </div>

      {!compact && (
        <>
          <div className={styles.chips}>
            {COMPONENT_ORDER.map((c) => {
              const raw = comp[c.key]
              const isScore = c.kind === 'score'
              const n = Number(raw)
              // A value is numeric ONLY if it's defined and finite. null/undefined/'' should not be numeric.
              const numeric = raw != null && raw !== '' && isScore && Number.isFinite(n)
              const t = isScore ? scoreTier(raw) : letterTier(raw)
              return (
                <div className={styles.chip} data-testid="rk-crown-chip" data-key={c.key} key={c.key}>
                  <div className={styles.chipLabel}>{c.label}</div>
                  <div className={`${styles.chipValue} ${t ? styles[TONE_CLASS[t]] : ''} t-num`}>
                    {raw == null || raw === '' ? '—' : raw}
                  </div>
                  {numeric && (
                    <div className={styles.meter} data-testid="rk-crown-meter">
                      <div
                        className={`${styles.meterFill} ${t ? styles[TONE_CLASS[t]] : ''}`}
                        style={{ width: `${Math.max(0, Math.min(MAX, n)) / MAX * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className={styles.basis} data-testid="rk-crown-basis">
            <span>{pill.text}</span>
            <InfoTip label="About this rating basis" text={pill.info} />
          </div>

          {/* How much of the intended composite this score measured. Distinct
              from the basis pill above, which is percentile-vs-absolute
              METHOD; this is INPUT COVERAGE. Renders nothing at full basis. */}
          <CoverageNote coverage={coverage} />

          {method && (
            <div className={styles.method} data-testid="rk-crown-method">{method}</div>
          )}
        </>
      )}
    </div>
  )
}
