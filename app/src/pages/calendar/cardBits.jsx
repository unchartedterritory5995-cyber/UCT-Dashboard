// app/src/pages/calendar/cardBits.jsx
// Small presentational pieces shared by cards + the day table.
import styles from './Calendar.module.css'

// ── Beat/miss dot strip ──────────────────────────────────────────────────────
// Robinhood's most-copied earnings visualization: last N quarters as dots —
// gold = beat, muted red = miss, hollow = unknown. Color is never the sole
// carrier: the title carries the counts and per-quarter surprise.
export function BeatDots({ history, max = 8 }) {
  const items = (history || []).slice(0, max)
  if (!items.length) return null
  const beats = items.filter(b => b.beat === true).length
  const title = `Beat ${beats} of last ${items.length} quarters` +
    items.map(b => {
      const s = b.surprise != null ? ` ${b.surprise > 0 ? '+' : ''}${b.surprise}%` : ''
      return `\n${b.period || ''} ${b.beat === true ? 'beat' : b.beat === false ? 'miss' : '—'}${s}`
    }).join('')
  return (
    <span className={styles.beatDots} title={title} aria-label={`Beat ${beats} of last ${items.length} quarters`}>
      {[...items].reverse().map((b, i) => (
        <span
          key={i}
          className={
            b.beat === true ? styles.beatDotUp
            : b.beat === false ? styles.beatDotDown
            : styles.beatDotNone
          }
        />
      ))}
    </span>
  )
}

// ── Post-earnings reaction sparkline ─────────────────────────────────────────
// hist_stats.last_n = recent post-print moves (%), newest first. Tiny ±bars
// around a zero line: "how does this name trade on prints" in one glance.
export function ReactionSpark({ lastN, width = 44, height = 14 }) {
  const moves = (lastN || []).filter(v => v != null && Number.isFinite(v))
  if (moves.length < 2) return null
  const shown = moves.slice(0, 8).reverse()   // oldest → newest
  const maxAbs = Math.max(...shown.map(Math.abs), 1)
  const barW = Math.max(2, Math.floor(width / shown.length) - 2)
  const mid = height / 2
  const title = 'Recent post-earnings moves: ' +
    moves.slice(0, 8).map(v => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`).join(', ')
  return (
    <svg className={styles.reactSpark} width={width} height={height}
         role="img" aria-label={title}>
      <title>{title}</title>
      <line x1={0} y1={mid} x2={width} y2={mid} className={styles.sparkAxis} />
      {shown.map((v, i) => {
        const h = Math.max(1, Math.abs(v) / maxAbs * (mid - 1))
        const x = i * (barW + 2)
        return (
          <rect key={i} x={x} width={barW}
                y={v >= 0 ? mid - h : mid}
                height={h}
                className={v >= 0 ? styles.sparkUp : styles.sparkDown} />
        )
      })}
    </svg>
  )
}

// ── Implied vs realized expected-move pair ───────────────────────────────────
// The flagship differentiator: both numbers already ride the enrichment
// payload; no platform at any price puts the comparison on calendar entries.
export function ExpectedMovePair({ em, typical, big = false }) {
  if (em == null) return null
  const rich = typical != null && em > 1.3 * typical
  return (
    <div className={styles.emv}
         title={`The options market prices roughly a ±${em}% swing after this report${
           typical != null ? ` — this name typically moves ±${typical.toFixed(1)}%` : ''}${
           rich ? ' (options pricing is RICH vs history)' : ''}`}>
      <span className={styles.emvLbl}>Expected move{rich ? <span className={styles.emvRich}> · rich</span> : null}</span>
      <span className={big ? styles.emvBigger : styles.emvBig}>
        ±{em}%
        {typical != null && (
          <span className={styles.emvTypical}> · typ ±{typical.toFixed(1)}%</span>
        )}
      </span>
    </div>
  )
}
