// app/src/components/research-kit/ConsensusBar.jsx
import EyebrowLabel from './EyebrowLabel'
import EmptyState from './EmptyState'
import styles from './ConsensusBar.module.css'

/** Minimum segment width (%) that can legibly hold its own count label. */
export const LABEL_MIN_PCT = 12

const SEG_CLASS = { buy: 'segBuy', hold: 'segHold', sell: 'segSell' }
const SEG_LABEL = { buy: 'Buy', hold: 'Hold', sell: 'Sell' }

/**
 * Buy/hold/sell distribution as width percentages.
 *
 * Pure and DOM-free so the geometry is unit-testable. Junk coerces to 0 rather
 * than producing NaN widths; zero total returns null so the caller can render
 * the kit EmptyState instead of an empty bar (an empty bar reads as "consensus
 * is nothing", which is a lie — there simply is no coverage).
 */
export function consensusSegments(buy, hold, sell) {
  const num = (v) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  const b = num(buy)
  const h = num(hold)
  const s = num(sell)
  const total = b + h + s
  if (total <= 0) return null
  return [
    { key: 'buy', count: b, pct: (b / total) * 100 },
    { key: 'hold', count: h, pct: (h / total) * 100 },
    { key: 'sell', count: s, pct: (s / total) * 100 },
  ]
}

/**
 * Segmented analyst-consensus bar (spec §3.3/§5.3; dataviz pattern 17).
 *
 * NEVER HUE-ONLY (§3.3, normative). Four redundant channels carry the meaning:
 *   1. position — buy always left, sell always right
 *   2. width    — the share of coverage
 *   3. a 2px surface-coloured divider between segments (the `gap` on .track)
 *   4. VISIBLE COUNTS — always in the legend, and additionally inside any
 *      segment at least LABEL_MIN_PCT wide
 * "12 buys, 1 sell" is the message; "consensus: buy" in a cell is not.
 */
export default function ConsensusBar({
  buy,
  hold,
  sell,
  compact = false,
  label,
  info,
  className = '',
}) {
  const segments = consensusSegments(buy, hold, sell)

  if (!segments) {
    return (
      <EmptyState
        compact
        icon="document"
        title="No analyst coverage"
        hint="Ratings appear here once firms publish on this name."
        className={className}
      />
    )
  }

  const a11y = `Analyst consensus: ${segments[0].count} buy, ${segments[1].count} hold, ${segments[2].count} sell`

  return (
    <div className={`${styles.wrap} ${compact ? styles.compact : ''} ${className}`}>
      {label && <EyebrowLabel info={info}>{label}</EyebrowLabel>}

      <div className={styles.track} data-testid="rk-consensus-track" role="img" aria-label={a11y}>
        {segments.map((s) =>
          s.pct > 0 ? (
            <span
              key={s.key}
              className={`${styles.seg} ${styles[SEG_CLASS[s.key]]}`}
              data-testid={`rk-seg-${s.key}`}
              style={{ width: `${s.pct}%` }}
            >
              {s.pct >= LABEL_MIN_PCT && (
                <span className={`${styles.segCount} t-num`} data-testid="rk-seg-count">
                  {s.count}
                </span>
              )}
            </span>
          ) : null,
        )}
      </div>

      <div className={styles.legend} data-testid="rk-consensus-legend">
        {segments.map((s) => (
          <span key={s.key} className={styles.legendItem}>
            <span className={`${styles.dot} ${styles[SEG_CLASS[s.key]]}`} aria-hidden="true" />
            {SEG_LABEL[s.key]}{' '}
            <span className={`${styles.legendCount} t-num`} data-testid="rk-legend-count">
              {s.count}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
