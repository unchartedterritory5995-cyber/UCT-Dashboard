// app/src/components/research-kit/charts/HeatGrid.jsx
import EmptyState from '../EmptyState'
import EyebrowLabel from '../EyebrowLabel'
import styles from './HeatGrid.module.css'

/** The tokenised Breadth ladder (§3.1). 'a' is available for metrics with a
 *  genuine caution band; the default diverging ladder does not use it. */
export const HEAT_TIERS = ['g3', 'g2', 'g1', 'a', 'r1', 'r2', 'r3']

/** [extreme, strong, flat] on a diverging percent metric. */
export const DEFAULT_HEAT_STOPS = [50, 20, 0]

/**
 * Heat tier for one value. Pure.
 *
 * A flat 0 returns null ON PURPOSE: an untinted cell reading "0.0%" is the
 * honest rendering of "nothing happened", and tinting it would put a colour on
 * a non-event. Anything unmeasured is also null — never a tier.
 */
export function heatTier(value, stops = DEFAULT_HEAT_STOPS) {
  const n = Number(value)
  if (!Number.isFinite(n) || value === null || value === '' || value === undefined) return null
  const [extreme, strong] = stops
  if (n >= extreme) return 'g3'
  if (n >= strong) return 'g2'
  if (n > 0) return 'g1'
  if (n === 0) return null
  if (n <= -extreme) return 'r3'
  if (n <= -strong) return 'r2'
  return 'r1'
}

/** "+12.4%" — the sign is ALWAYS visible (§3.3). Em-dash for nothing. */
export function formatSigned(value, { unit = '', decimals = 1 } = {}) {
  const n = Number(value)
  if (!Number.isFinite(n) || value === null || value === '' || value === undefined) return '—'
  const sign = n > 0 ? '+' : ''
  // Proper rounding to handle floating point precision (e.g., 12.35 should be 12.4)
  const factor = Math.pow(10, decimals)
  const rounded = Math.round(n * factor) / factor
  return `${sign}${rounded.toFixed(decimals)}${unit}`
}

/**
 * Heat-shaded metric grid (spec §5.3 Financials; dataviz pattern 24) — a real
 * `<table>`, because DOM cells give hover, click and a11y for free and a
 * chart-library heatmap gives none of them.
 *
 * THE BREADTH RULE, INHERITED (§3.3): the cell BACKGROUND carries intensity and
 * the TEXT stays uniform ink with the signed number always visible. Dark
 * saturated = extreme, light tint = mild. Never colour-only, never hover-to-read.
 *
 * `rows`: `[{ key, label, values: [], unit?, decimals?, stops? }]` — `values`
 * is positional against `columns` and short rows are PADDED, never shifted.
 * `onRowChart(key)` turns the row header into a real button (§5.3: click any
 * row → inline MetricTrendChart); without it the label is plain text, because a
 * clickable-looking row that does nothing is worse than a static one.
 */
export default function HeatGrid({
  columns,
  rows,
  onRowChart,
  activeRowKey = null,
  caption,
  label,
  info,
  className = '',
}) {
  const cols = Array.isArray(columns) ? columns : []
  const list = Array.isArray(rows) ? rows : []

  if (!cols.length || !list.length) {
    return (
      <EmptyState
        icon="document"
        title="No financial history"
        hint="This grid fills in once quarterly statements are available for this ticker."
        className={className}
      />
    )
  }

  return (
    <div className={`${styles.wrap} ${className}`}>
      {label && <EyebrowLabel info={info}>{label}</EyebrowLabel>}
      <div className={styles.scroll}>
        <table className={styles.table}>
          <caption className={styles.caption}>{caption || label || 'Financial grid'}</caption>
          <thead>
            <tr>
              <th scope="col" className={styles.corner}>Metric</th>
              {cols.map((c) => (
                <th scope="col" className={`${styles.colHead} t-num`} key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((row) => {
              const values = Array.isArray(row.values) ? row.values : []
              return (
                <tr key={row.key}>
                  <th scope="row" className={styles.rowHead}>
                    {onRowChart ? (
                      <button
                        type="button"
                        className={styles.rowButton}
                        aria-expanded={activeRowKey === row.key}
                        onClick={() => onRowChart(row.key)}
                      >
                        {row.label}
                        <span className={styles.rowButtonHint} aria-hidden="true">›</span>
                      </button>
                    ) : row.label}
                  </th>
                  {cols.map((c, i) => {
                    const v = values[i]
                    const tier = heatTier(v, row.stops || DEFAULT_HEAT_STOPS)
                    return (
                      <td
                        key={c}
                        className={`${styles.cell} ${tier ? styles[tier] : ''}`}
                        data-testid="rk-heat-cell"
                        data-tier={tier || ''}
                      >
                        <span className={`${styles.value} t-num`} data-testid="rk-heat-value">
                          {formatSigned(v, { unit: row.unit ?? '', decimals: row.decimals ?? 1 })}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
