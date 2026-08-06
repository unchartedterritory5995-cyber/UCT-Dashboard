// app/src/components/research-kit/charts/ReactionBars.jsx
import EmptyState from '../EmptyState'
import EyebrowLabel from '../EyebrowLabel'
import styles from './ReactionBars.module.css'

/** Internal SVG coordinate space. The element scales to its container with
 *  preserveAspectRatio="xMidYMid meet" so the dots stay CIRCLES — the shape
 *  channel that §3.3 requires would be destroyed by non-uniform scaling. */
export const VIEWBOX = { width: 320, height: 132 }

/** §3.4 skeleton size contract. */
export const SIZE = { width: '100%', height: VIEWBOX.height }

const PAD_TOP = 10
const PAD_BOTTOM = 18   // room for the quarter labels
const DOT_GAP = 7

const num = (v) => {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * 'beat' | 'miss' | 'inline' | null for one earnings-history row.
 * Prefers the eps pair when present, falls back to `surprise_pct`. null means
 * there is nothing to state — the dot is then omitted, never guessed.
 */
export function outcomeOf(row) {
  if (!row || row.reported === false) return null
  const est = num(row.eps_estimate)
  const act = num(row.eps_actual)
  if (est != null && act != null) return act > est ? 'beat' : act < est ? 'miss' : 'inline'
  const s = num(row.surprise_pct)
  if (s == null) return null
  return s > 0 ? 'beat' : s < 0 ? 'miss' : 'inline'
}

/**
 * All of the strip's geometry, in VIEWBOX units. Pure and DOM-free (the house
 * `sparkPaths` / `positionPct` pattern) so every rectangle is unit-testable.
 *
 * The scale spans the largest |reaction| AND the implied magnitude, so the gold
 * bracket can never fall outside the plot — a bracket clipped off the top would
 * read as "the market is pricing less than it ever moves", the exact opposite
 * of the truth.
 */
export function reactionGeometry(rows, { width = VIEWBOX.width, height = VIEWBOX.height, impliedPct = null } = {}) {
  const list = rows || []
  const implied = num(impliedPct)
  const magnitudes = list.map((r) => Math.abs(num(r?.reaction_pct) ?? 0))
  if (implied != null) magnitudes.push(Math.abs(implied))
  const peak = Math.max(0, ...magnitudes)
  const scaleMax = (peak > 0 ? peak : 1) * 1.15

  const plotH = height - PAD_TOP - PAD_BOTTOM
  const halfH = plotH / 2
  const baselineY = PAD_TOP + halfH
  const n = Math.max(list.length, 1)
  const slot = width / n
  const barW = Math.min(18, slot * 0.42)

  const bars = list.map((r, i) => {
    const cx = slot * (i + 0.5)
    const v = num(r?.reaction_pct)
    const outcome = outcomeOf(r)
    if (v == null) {
      return {
        key: r?.quarter ?? String(i), label: r?.quarter ?? '', value: null, outcome,
        dir: 0, cx, x: cx - barW / 2, w: barW, y: baselineY, h: 0, dotY: baselineY, diverged: false,
      }
    }
    const dir = v >= 0 ? 1 : -1
    const h = Math.min(halfH, (Math.abs(v) / scaleMax) * halfH)
    return {
      key: r?.quarter ?? String(i),
      label: r?.quarter ?? '',
      value: v,
      outcome,
      dir,
      cx,
      x: cx - barW / 2,
      w: barW,
      y: dir > 0 ? baselineY - h : baselineY,
      h,
      dotY: dir > 0 ? baselineY - h - DOT_GAP : baselineY + h + DOT_GAP,
      // The pattern this strip exists to surface: beat the number, sold off anyway.
      diverged: outcome === 'beat' && v < 0,
    }
  })

  const bracket = implied == null ? null : {
    top: baselineY - (Math.abs(implied) / scaleMax) * halfH,
    bottom: baselineY + (Math.abs(implied) / scaleMax) * halfH,
    pct: Math.abs(implied),
  }

  return { bars, baselineY, scaleMax, bracket, width, height, labelY: height - 5 }
}

/**
 * The four numbers of the §4.3.2 caption row. Exported so P2's StatTile row
 * reads exactly what the chart drew:
 *
 *   const s = reactionStats(quarters)
 *   <StatTile label="AVG MOVE"   value={`±${s.avgAbs.toFixed(1)}%`} />
 *   <StatTile label="CLOSED UP"  value={`${s.upCount} / ${s.total}`} />
 *   <StatTile label="BEST"  value={`+${s.best.pct.toFixed(1)}%`}  sub={s.best.quarter} />
 *   <StatTile label="WORST" value={`${s.worst.pct.toFixed(1)}%`}  sub={s.worst.quarter} />
 */
export function reactionStats(rows) {
  const vals = (rows || [])
    .map((r) => ({ quarter: r?.quarter ?? '', pct: num(r?.reaction_pct) }))
    .filter((r) => r.pct != null)
  if (!vals.length) return { total: 0, upCount: 0, avgAbs: null, best: null, worst: null }
  const avgAbs = vals.reduce((a, r) => a + Math.abs(r.pct), 0) / vals.length
  const best = vals.reduce((a, r) => (r.pct > a.pct ? r : a))
  const worst = vals.reduce((a, r) => (r.pct < a.pct ? r : a))
  return { total: vals.length, upCount: vals.filter((r) => r.pct > 0).length, avgAbs, best, worst }
}

/**
 * How this name TRADES after it reports (spec §4.3.2; dataviz pattern 6).
 *
 * Sits directly under `LollipopChart` on the SAME quarter axis: EPS story above,
 * price story below, one section. Pass the identical `quarters` array.
 *
 * ENCODINGS (§3.3 — hue is never alone):
 *   • bar direction  = sign of the next-day move (signed, not colour-coded)
 *   • dot fill       = EPS outcome, SOLID disc on a beat / HOLLOW ring on a miss
 *   • ★              = beat-but-closed-down, the divergence worth noticing
 *   • gold dashed pair = tonight's implied ±move. This is the ONE gold
 *     data-highlight on this canvas (§3.1) — do not add another. Stamped
 *     `data-rk-gold` (I6) once on the enclosing `<g>`, not per line, so the
 *     audit hook in `testing/restraint.js` counts the pair as one highlight.
 */
export default function ReactionBars({
  quarters,
  impliedPct = null,
  impliedLabel,
  label = 'Next-day move',
  info,
  height = SIZE.height,
  className = '',
  ariaLabel,
}) {
  const rows = Array.isArray(quarters) ? quarters : []
  const stats = reactionStats(rows)

  if (!stats.total) {
    return (
      <EmptyState
        icon="chart"
        title="No post-earnings reactions yet"
        hint="Reactions appear once this name has reported with price history behind it."
        className={className}
      />
    )
  }

  const geo = reactionGeometry(rows, { impliedPct })
  const impliedText = geo.bracket ? ` Implied ±${geo.bracket.pct.toFixed(1)}%${impliedLabel ? ` ${impliedLabel}` : ''}.` : ''
  const built = ariaLabel
    || `Next-day move after each report: closed up ${stats.upCount} of ${stats.total}, average move ${stats.avgAbs.toFixed(1)}%.${impliedText}`

  return (
    <div className={`${styles.wrap} ${className}`}>
      {label && <EyebrowLabel info={info}>{label}</EyebrowLabel>}
      <svg
        className={styles.svg}
        viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ height }}
        role="img"
        aria-label={built}
        data-testid="rk-reaction"
      >
        {geo.bracket && (
          // I6: the pair of dashed lines is ONE gold data-highlight (§3.1),
          // so the audit attribute is stamped once on the enclosing group —
          // stamping it on each <line> would double-count a single highlight.
          <g data-rk-gold="">
            <line
              className={styles.bracket}
              data-testid="rk-reaction-bracket"
              x1="0" y1={geo.bracket.top} x2={geo.width} y2={geo.bracket.top}
            />
            <line
              className={styles.bracket}
              data-testid="rk-reaction-bracket"
              x1="0" y1={geo.bracket.bottom} x2={geo.width} y2={geo.bracket.bottom}
            />
          </g>
        )}

        <line className={styles.baseline} x1="0" y1={geo.baselineY} x2={geo.width} y2={geo.baselineY} />

        {geo.bars.map((b) => (
          <g key={b.key}>
            {b.h > 0 && (
              <rect
                className={b.dir > 0 ? styles.barUp : styles.barDown}
                data-testid="rk-reaction-bar"
                x={b.x} y={b.y} width={b.w} height={b.h} rx="1"
              />
            )}
            {b.outcome && b.value != null && (
              <circle
                className={b.outcome === 'beat' ? styles.dotBeat : styles.dotMiss}
                data-testid="rk-reaction-dot"
                fill={b.outcome === 'beat' ? 'currentColor' : 'none'}
                cx={b.cx} cy={b.dotY} r="3"
              />
            )}
            {b.diverged && (
              <text
                className={styles.star}
                data-testid="rk-reaction-star"
                data-rk-star=""
                x={b.cx} y={b.dotY - 6}
                textAnchor="middle"
              >
                ★
              </text>
            )}
            <text className={styles.qlabel} x={b.cx} y={geo.labelY} textAnchor="middle">
              {b.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
