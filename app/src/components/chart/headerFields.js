// Catalog for the chart's "Info Row" — the strip of fields above the chart. The user
// picks which of these to show (stored as `header.fields`, an array of keys); ChartPane
// resolves each field's value from the fundamental snapshot + the perf batch and
// ChartMetaRow renders the label/value pairs.
//
// `colorKey` (when present) is the header.colors override key + its settings swatch id, so
// the three legacy fields keep their color customization. `dflt` is the fallback color;
// `null` means "green/red by sign" (the perf fields).

export const HEADER_FIELDS = [
  { key: 'mcap', label: 'Market Cap', colorKey: 'marketCap', swatch: 'hdrMarketCap', dflt: '#c9a84c' },
  { key: 'earn', label: 'Next Earnings', colorKey: 'nextEarnings', swatch: 'hdrNextEarnings', dflt: '#6ba3be' },
  { key: 'rating', label: 'UCT Rating', colorKey: 'uctRating', swatch: 'hdrUctRating', dflt: '#1ae51a' },
  { key: 'sector', label: 'Sector', colorKey: null, dflt: '#9b9684' },
  { key: 'industry', label: 'Industry', colorKey: null, dflt: '#9b9684' },
  { key: 'perf5d', label: '5-Day Change', colorKey: null, dflt: null },
  { key: 'perf30d', label: '30-Day Change', colorKey: null, dflt: null },
  { key: 'perf60d', label: '60-Day Change', colorKey: null, dflt: null },
  { key: 'perf90d', label: '90-Day Change', colorKey: null, dflt: null },
]

export const HEADER_FIELD_BY_KEY = Object.fromEntries(HEADER_FIELDS.map(f => [f.key, f]))

// perf field key → its period in the /api/watchlist-performance response.
export const PERF_HEADER_PERIOD = { perf5d: '5d', perf30d: '30d', perf60d: '60d', perf90d: '90d' }
export const PERF_HEADER_KEYS = new Set(Object.keys(PERF_HEADER_PERIOD))

// What the old three toggles showed — the default before any pick.
export const DEFAULT_HEADER_FIELDS = ['mcap', 'earn', 'rating']

/** The selected field keys for a header blob — migrating a legacy show* blob once. */
export function headerFieldKeys(header) {
  if (Array.isArray(header?.fields)) return header.fields.filter(k => HEADER_FIELD_BY_KEY[k])
  const f = []
  if (header?.showMarketCap !== false) f.push('mcap')
  if (header?.showNextEarnings !== false) f.push('earn')
  if (header?.showUctRating !== false) f.push('rating')
  return f
}
