// The chart header's info strip. The host (ChartPane) resolves which fields to show and
// their values/colors from `header.fields`; this is presentational only.
// `styles` is injected so this renders with the caller's CSS-module classes (CSS-module
// names are hashed per source file; a local copy of the rules would silently drift).

// `abbrev` (set by ChartPane's width fit) swaps each label for its terse form
// (MARKET CAP → MC) once the row would collide with the timeframe bar. The full
// label is kept in `title` so a hover still reads it. Values are never abbreviated.
export default function ChartMetaRow({ items = [], abbrev = false, styles }) {
  if (!items.length) return null
  return (
    <div className={styles.chartMeta}>
      {items.map((it) => {
        const label = abbrev ? (it.short || it.label) : it.label
        return (
          <span key={it.key} className={styles.chartMetaItem}>
            <span className={styles.chartMetaLabel} title={it.label}>{label}</span>
            <span className={styles.chartMetaVal} style={it.color ? { color: it.color } : undefined}>
              {it.value != null && it.value !== '' ? it.value : '—'}
            </span>
          </span>
        )
      })}
    </div>
  )
}
