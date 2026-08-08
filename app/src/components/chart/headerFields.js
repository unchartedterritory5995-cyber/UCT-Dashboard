// Catalog + value resolver for the chart's "Info Row" (the stat strip above the chart).
// The user picks fields (stored as `header.fields`, an array of keys). ChartPane feeds the
// resolver its data context (fundamentals + live quote + meta + perf + theme) and passes
// the resulting label/value/color items to ChartMetaRow.
//
// `colorKey` (+ `swatch`) is the header.colors override key + its settings swatch id, so the
// legacy market-cap / next-earnings / UCT-rating fields keep their color customization.
// `dflt` is the fallback color (absent = inherit the row's text color).

export const HEADER_FIELDS = [
  { key: 'price', label: 'Price' },
  { key: 'vol', label: 'Volume' },
  { key: 'chg', label: '% Change' },
  { key: 'rvol', label: 'RVOL' },
  { key: 'ipoDate', label: 'IPO Date' },
  { key: 'mcap', label: 'Market Cap', colorKey: 'marketCap', swatch: 'hdrMarketCap', dflt: '#c9a84c' },
  { key: 'earn', label: 'Next Earnings', colorKey: 'nextEarnings', swatch: 'hdrNextEarnings', dflt: '#6ba3be' },
  { key: 'rating', label: 'UCT Rating', colorKey: 'uctRating', swatch: 'hdrUctRating', dflt: '#1ae51a' },
  { key: 'dchg', label: '$ Change' },
  { key: 'fromopen', label: '% from Open' },
  { key: 'fromhigh', label: '% from High' },
  { key: 'fromlow', label: '% from Low' },
  { key: 'dcr', label: 'Daily Closing Range' },
  { key: 'dolvol', label: 'Dollar Volume' },
  { key: 'sector', label: 'Sector', dflt: '#9b9684' },
  { key: 'industry', label: 'Industry', dflt: '#9b9684' },
  { key: 'theme', label: 'Theme', dflt: '#9b9684' },
  { key: 'perf5d', label: '5-Day Change' },
  { key: 'perf30d', label: '30-Day Change' },
  { key: 'perf60d', label: '60-Day Change' },
  { key: 'perf90d', label: '90-Day Change' },
]

export const HEADER_FIELD_BY_KEY = Object.fromEntries(HEADER_FIELDS.map((f) => [f.key, f]))

// perf field key → its period in the /api/watchlist-performance response.
export const PERF_HEADER_PERIOD = { perf5d: '5d', perf30d: '30d', perf60d: '60d', perf90d: '90d' }
export const PERF_HEADER_KEYS = new Set(Object.keys(PERF_HEADER_PERIOD))
// Which fields need which single-symbol data source (so ChartPane only fetches what's shown).
export const QUOTE_HEADER_KEYS = new Set(['price', 'chg', 'vol', 'dchg', 'fromopen', 'fromhigh', 'fromlow', 'dcr', 'dolvol', 'rvol'])
export const META_HEADER_KEYS = new Set(['rvol', 'ipoDate'])
export const THEME_HEADER_KEYS = new Set(['theme'])

// What the old three toggles showed — the default before any pick.
export const DEFAULT_HEADER_FIELDS = ['mcap', 'earn', 'rating']

/** The selected field keys for a header blob — migrating a legacy show* blob once. */
export function headerFieldKeys(header) {
  if (Array.isArray(header?.fields)) return header.fields.filter((k) => HEADER_FIELD_BY_KEY[k])
  const f = []
  if (header?.showMarketCap !== false) f.push('mcap')
  if (header?.showNextEarnings !== false) f.push('earn')
  if (header?.showUctRating !== false) f.push('rating')
  return f
}

// ── formatters (kept in sync with the watchlist columns) ──────────────────────
const GREEN = '#1ae51a'
const RED = '#ff3b47'
const num = (v) => (typeof v === 'number' && Number.isFinite(v))
const signColor = (v) => (num(v) ? (v >= 0 ? GREEN : RED) : null)
const pct = (v) => (num(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : null)
function fmtVol(v) {
  if (!num(v)) return null
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return String(Math.round(v))
}
function fmtDolVol(v) {
  if (!num(v)) return null
  const a = Math.abs(v)
  if (a >= 1e12) return `$${(v / 1e12).toFixed(1)}T`
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}
function fmtIpo(ymd) {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(ymd == null ? '' : String(ymd))
  return m ? `${+m[2]}/${+m[3]}/${m[1].slice(2)}` : null
}
function fmtEarn(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? `${+m[2]}/${+m[3]}/${m[1]}` : null
}

/** Resolve one field → { value, color }. `color` is set only for sign-tinted fields;
 *  ChartPane applies the per-field default/override otherwise. */
export function resolveHeaderField(key, ctx) {
  const { fund, quote, meta, perf, theme } = ctx || {}
  const q = quote || {}
  const m = meta || {}
  const p = q.price
  switch (key) {
    case 'mcap': return { value: fund?.metrics?.market_cap || null }
    case 'earn': return { value: fmtEarn(fund?.next_earnings) }
    case 'rating': return { value: num(fund?.composite) ? String(fund.composite) : null }
    case 'sector': return { value: fund?.sector || null }
    case 'industry': return { value: fund?.industry || null }
    case 'theme': return { value: theme || null }
    case 'price': return { value: num(p) ? p.toFixed(2) : null }
    case 'chg': return { value: pct(q.change_pct), color: signColor(q.change_pct) }
    case 'vol': return { value: fmtVol(q.volume) }
    case 'dolvol': return { value: (num(p) && num(q.volume)) ? fmtDolVol(p * q.volume) : null }
    case 'dchg': {
      const d = num(q.change) ? q.change : ((num(p) && num(q.prev_close)) ? p - q.prev_close : null)
      return { value: num(d) ? `${d >= 0 ? '+' : ''}${d.toFixed(2)}` : null, color: signColor(d) }
    }
    case 'fromopen': {
      const o = q.day_open
      const v = (num(o) && o > 0 && num(p)) ? ((p - o) / o) * 100 : null
      return { value: pct(v), color: signColor(v) }
    }
    case 'fromhigh': {
      const h = q.day_high
      const v = (num(h) && h > 0 && num(p)) ? ((p - h) / h) * 100 : null
      return { value: pct(v), color: signColor(v) }
    }
    case 'fromlow': {
      const l = q.day_low
      const v = (num(l) && l > 0 && num(p)) ? ((p - l) / l) * 100 : null
      return { value: pct(v), color: signColor(v) }
    }
    case 'dcr': {
      const h = q.day_high, l = q.day_low
      const v = (num(h) && num(l) && num(p) && h > l) ? Math.max(0, Math.min(100, ((p - l) / (h - l)) * 100)) : null
      return { value: num(v) ? `${v.toFixed(0)}%` : null }
    }
    case 'rvol': {
      const av = m.avg_vol_20d, v = q.volume
      const r = (num(av) && av > 0 && num(v)) ? v / av : null
      return { value: num(r) ? `${r.toFixed(1)}x` : null }
    }
    case 'ipoDate': return { value: fmtIpo(m.ipo_date) }
    default:
      if (PERF_HEADER_KEYS.has(key)) {
        const v = perf?.[PERF_HEADER_PERIOD[key]]
        return { value: pct(v), color: signColor(v) }
      }
      return { value: null }
  }
}
