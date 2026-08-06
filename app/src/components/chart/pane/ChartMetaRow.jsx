// The chart header's info strip: Market Cap / Next Earnings / UCT Rating.
// Presentational only — the host resolves the values and the visibility flags.
// `styles` is injected so this renders with the caller's CSS-module classes
// (CSS-module names are hashed per source file; a local copy of the rules
// would produce different class names and silently drift).

// Default = the price-candle up-green (CHART_DEFAULTS.candles.upColor), so the
// rating matches the candles out of the box.
const UCT_RATING_DEFAULT = '#1ae51a'

export default function ChartMetaRow({
  marketCap = null,
  nextEarnings = null,
  uctRating = null,
  show = {},
  colors = {},
  styles,
}) {
  if (!show.marketCap && !show.nextEarnings && !show.uctRating) return null
  return (
    <div className={styles.chartMeta}>
      {show.marketCap && (
        <span className={styles.chartMetaItem}>
          <span className={styles.chartMetaLabel}>Market Cap</span>
          <span className={styles.chartMetaVal} style={{ color: colors.marketCap || '#c9a84c' }}>{marketCap || '—'}</span>
        </span>
      )}
      {show.nextEarnings && (
        <span className={styles.chartMetaItem}>
          <span className={styles.chartMetaLabel}>Next Earnings</span>
          <span className={styles.chartMetaVal} style={{ color: colors.nextEarnings || '#6ba3be' }}>{nextEarnings || '—'}</span>
        </span>
      )}
      {show.uctRating && (
        <span className={styles.chartMetaItem}>
          <span className={styles.chartMetaLabel}>UCT Rating</span>
          <span className={styles.chartMetaVal} style={{ color: colors.uctRating || UCT_RATING_DEFAULT }}>{uctRating != null ? uctRating : '—'}</span>
        </span>
      )}
    </div>
  )
}
