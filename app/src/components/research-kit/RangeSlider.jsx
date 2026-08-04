// app/src/components/research-kit/RangeSlider.jsx
import EyebrowLabel from './EyebrowLabel'
import styles from './RangeSlider.module.css'

const TONE_CLASS = {
  positive: 'tonePositive',
  negative: 'toneNegative',
  caution: 'toneCaution',
  neutral: 'toneNeutral',
  gold: 'toneGold',
}

/** Minimum distance (%) the floating value label keeps from either track end. */
export const LABEL_EDGE_CLAMP_PCT = 12

/**
 * Position of `v` on the `min…max` track, as a percentage in [0, 100].
 *
 * Pure and DOM-free so the geometry is unit-testable (the house `sparkPaths`
 * pattern). Degenerate range (min === max) centres at 50 rather than producing
 * NaN; a value outside the range clamps to the nearest edge; a reversed range
 * (min > max) is normalised. Any non-finite input returns null, and the caller
 * renders no marker rather than a marker at a lie.
 */
export function positionPct(min, max, v) {
  const a = Number(min)
  const b = Number(max)
  const x = Number(v)
  if (min === '' || max === '' || v === '' || min == null || max == null || v == null) return null
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(x)) return null
  if (a === b) return 50
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const pct = ((x - lo) / (hi - lo)) * 100
  return Math.max(0, Math.min(100, pct))
}

/**
 * Centre position (%) for the floating value label.
 *
 * THE COLLISION RULE: the value label lives on its own row ABOVE the track and
 * the min/max labels on their own row BELOW, so cross-label overlap is
 * structurally impossible. Within its row the label centre is clamped
 * LABEL_EDGE_CLAMP_PCT in from each end so it can never overflow the track. In
 * the outer 12% the label therefore sits slightly inboard of its marker — a
 * readable label beats a pixel-exact one.
 */
export function labelPct(pct) {
  if (pct == null) return null
  return Math.max(LABEL_EDGE_CLAMP_PCT, Math.min(100 - LABEL_EDGE_CLAMP_PCT, pct))
}

/** Minimum distance (%) an optional band-edge label must keep from either
 *  fixed end label before the end label suppresses it (§4.3.1a). */
export const BAND_LABEL_COLLISION_PCT = 14

/**
 * Resolves which labels render in the shared below-track row (§I2). The two
 * fixed end labels (min/max) always render when given; each optional
 * band-edge label (bandLo/bandHi) is suppressed when it falls within
 * `BAND_LABEL_COLLISION_PCT` of either end label's position — the end label
 * always wins a collision, never the band label.
 *
 * Pure and DOM-free: every `*Pct` argument is expected to already be resolved
 * through `labelPct` (or `null` when that edge isn't present), so this
 * compares in the same clamped space the labels actually render in — it does
 * not itself compute geometry.
 */
export function resolveBelowLabels({ minLabelPct, maxLabelPct, bandLoPct, bandHiPct }) {
  const collidesWithEnd = (pct) =>
    (minLabelPct != null && Math.abs(pct - minLabelPct) <= BAND_LABEL_COLLISION_PCT) ||
    (maxLabelPct != null && Math.abs(pct - maxLabelPct) <= BAND_LABEL_COLLISION_PCT)

  return {
    min: minLabelPct != null,
    max: maxLabelPct != null,
    bandLo: bandLoPct != null && !collidesWithEnd(bandLoPct),
    bandHi: bandHiPct != null && !collidesWithEnd(bandHiPct),
  }
}

/**
 * The ONE slider primitive (spec §3.4). Renders the 52-week range, the analyst
 * price-target range, and the expected-move dollar break-even strip. Do not
 * fork it — parameterise it.
 *
 * Pure CSS/SVG-free geometry: a track div plus absolutely-positioned band and
 * marker. The only inline styles are the computed `left`/`width` percentages,
 * which cannot be tokens; everything else is a module class.
 *
 * Props:
 *   min, max      — the track's numeric bounds (e.g. 52-week low/high)
 *   value         — the current-price marker
 *   lo, hi        — optional highlighted sub-range (e.g. PT low..high)
 *   minLabel, maxLabel, valueLabel — display strings; all get .t-num. Renamed
 *     from loLabel/hiLabel — they label the track ENDS (min/max), not the `lo`/
 *     `hi` band; no back-compat alias (dormant component, clean break).
 *   bandLoLabel, bandHiLabel — optional dollar labels at the `lo`/`hi` band
 *     edges (e.g. expected-move break-even prices, §4.3.1a). Positioned with
 *     the same `labelPct` clamp as the value label, sharing the end-label row
 *     below the track; suppressed via `resolveBelowLabels` when they'd collide
 *     with a fixed end label.
 *   tone          — VERDICT_TONES; colours the band + marker
 */
export default function RangeSlider({
  min,
  max,
  value,
  lo,
  hi,
  minLabel,
  maxLabel,
  valueLabel,
  bandLoLabel,
  bandHiLabel,
  tone = 'neutral',
  label,
  info,
  ariaLabel,
  className = '',
}) {
  const valuePct = positionPct(min, max, value)
  const loPct = positionPct(min, max, lo)
  const hiPct = positionPct(min, max, hi)
  const hasBand = loPct != null && hiPct != null
  const bandLeft = hasBand ? Math.min(loPct, hiPct) : 0
  const bandWidth = hasBand ? Math.abs(hiPct - loPct) : 0
  const toneCls = styles[TONE_CLASS[tone] || TONE_CLASS.neutral]
  const labelLeft = labelPct(valuePct)

  const bandLoLabelPct = bandLoLabel != null && bandLoLabel !== '' ? labelPct(loPct) : null
  const bandHiLabelPct = bandHiLabel != null && bandHiLabel !== '' ? labelPct(hiPct) : null
  const belowLabels = resolveBelowLabels({
    minLabelPct: labelPct(0),
    maxLabelPct: labelPct(100),
    bandLoPct: bandLoLabelPct,
    bandHiPct: bandHiLabelPct,
  })

  const a11y =
    ariaLabel ||
    [
      label,
      minLabel ? `low ${minLabel}` : '',
      valueLabel ? `current ${valueLabel}` : '',
      maxLabel ? `high ${maxLabel}` : '',
    ]
      .filter(Boolean)
      .join(', ')

  return (
    <div className={`${styles.wrap} ${className}`}>
      {label && <EyebrowLabel info={info}>{label}</EyebrowLabel>}

      <div className={styles.valueRow} data-testid="rk-range-valuerow">
        {valueLabel != null && valueLabel !== '' && labelLeft != null && (
          <span
            className={`${styles.valueLabel} t-num`}
            data-testid="rk-range-valuelabel"
            style={{ left: `${labelLeft}%` }}
          >
            {valueLabel}
          </span>
        )}
      </div>

      <div className={styles.track} data-testid="rk-range-track" role="img" aria-label={a11y}>
        {hasBand && (
          <span
            className={`${styles.band} ${toneCls}`}
            data-testid="rk-range-band"
            style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}
          />
        )}
        {valuePct != null && (
          <span
            className={`${styles.marker} ${toneCls}`}
            data-testid="rk-range-marker"
            style={{ left: `${valuePct}%` }}
          />
        )}
      </div>

      <div className={styles.endRow} data-testid="rk-range-endrow">
        <span className={`${styles.endLabel} t-num`} data-testid="rk-range-minlabel">
          {minLabel ?? ''}
        </span>
        <span className={`${styles.endLabel} t-num`} data-testid="rk-range-maxlabel">
          {maxLabel ?? ''}
        </span>
        {belowLabels.bandLo && (
          <span
            className={`${styles.bandLabel} t-num`}
            data-testid="rk-range-bandlolabel"
            style={{ left: `${bandLoLabelPct}%` }}
          >
            {bandLoLabel}
          </span>
        )}
        {belowLabels.bandHi && (
          <span
            className={`${styles.bandLabel} t-num`}
            data-testid="rk-range-bandhilabel"
            style={{ left: `${bandHiLabelPct}%` }}
          >
            {bandHiLabel}
          </span>
        )}
      </div>
    </div>
  )
}
