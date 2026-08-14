// Catalog + value resolver for the chart's "Info Row" (the stat strip above the chart).
// The user picks fields (stored as `header.fields`, an array of keys). ChartPane feeds the
// resolver its data context (fundamentals + live quote + meta + perf + theme) and passes
// the resulting label/value/color items to ChartMetaRow.
//
// `colorKey` is the header.colors override key for that field (every field has one, so any
// selected field can be recolored). The three legacy fields keep their original keys so a
// stored color isn't lost. `dflt` is the fallback color; null = "auto" (sign-tinted green/
// red for change fields, or inherit the row's text color otherwise) unless the user overrides.
//
// `signed: true` marks a plus/minus field (% change, $ change, % from open/high/low, N-day
// change). These get TWO color overrides — one for positive values, one for negative — stored
// under `<colorKey>:pos` / `<colorKey>:neg` in header.colors, defaulting to green / red.

// `short` is the abbreviated label shown when the pane narrows enough that the
// info row would collide with the timeframe bar (see headerFit.js). Values are
// never abbreviated — only these labels. Keep them terse + unambiguous.
export const HEADER_FIELDS = [
  { key: 'name', label: 'Company Name', short: 'NAME', colorKey: 'name', dflt: '#9b9684' },
  { key: 'price', label: 'Price', short: 'PX', colorKey: 'price', dflt: null },
  { key: 'vol', label: 'Volume', short: 'VOL', colorKey: 'vol', dflt: null },
  { key: 'chg', label: '% Change', short: '%CHG', colorKey: 'chg', dflt: null, signed: true },
  { key: 'rvol', label: 'RVOL', short: 'RVOL', colorKey: 'rvol', dflt: null },
  { key: 'ipoDate', label: 'IPO Date', short: 'IPO', colorKey: 'ipoDate', dflt: null },
  { key: 'mcap', label: 'Market Cap', short: 'MC', colorKey: 'marketCap', dflt: '#c9a84c' },
  { key: 'earn', label: 'Next Earnings', short: 'NE', colorKey: 'nextEarnings', dflt: '#6ba3be' },
  { key: 'rating', label: 'UCT Rating', short: 'UCT', colorKey: 'uctRating', dflt: '#1ae51a' },
  { key: 'dchg', label: '$ Change', short: '$CHG', colorKey: 'dchg', dflt: null, signed: true },
  { key: 'fromopen', label: '% from Open', short: '%OPEN', colorKey: 'fromopen', dflt: null, signed: true },
  { key: 'fromhigh', label: '% from High', short: '%HIGH', colorKey: 'fromhigh', dflt: null, signed: true },
  { key: 'fromlow', label: '% from Low', short: '%LOW', colorKey: 'fromlow', dflt: null, signed: true },
  { key: 'dcr', label: 'Daily Closing Range', short: 'DCR', colorKey: 'dcr', dflt: null },
  { key: 'dolvol', label: 'Dollar Volume', short: '$VOL', colorKey: 'dolvol', dflt: null },
  { key: 'sector', label: 'Sector', short: 'SECT', colorKey: 'sector', dflt: '#9b9684' },
  { key: 'industry', label: 'Industry', short: 'IND', colorKey: 'industry', dflt: '#9b9684' },
  { key: 'theme', label: 'Theme', short: 'THEME', colorKey: 'theme', dflt: '#9b9684' },
  { key: 'perf5d', label: '5-Day Change', short: '5D', colorKey: 'perf5d', dflt: null, signed: true },
  { key: 'perf30d', label: '30-Day Change', short: '30D', colorKey: 'perf30d', dflt: null, signed: true },
  { key: 'perf60d', label: '60-Day Change', short: '60D', colorKey: 'perf60d', dflt: null, signed: true },
  { key: 'perf90d', label: '90-Day Change', short: '90D', colorKey: 'perf90d', dflt: null, signed: true },
]

export const HEADER_FIELD_BY_KEY = Object.fromEntries(HEADER_FIELDS.map((f) => [f.key, f]))

// Default plus/minus tints for signed fields (green up / red down).
export const SIGN_POS = '#1ae51a'
export const SIGN_NEG = '#ff3b47'

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
const num = (v) => (typeof v === 'number' && Number.isFinite(v))
const signColor = (v) => (num(v) ? (v >= 0 ? SIGN_POS : SIGN_NEG) : null)
const signOf = (v) => (num(v) ? (v >= 0 ? 'pos' : 'neg') : null)
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
  const { fund, quote, meta, perf, theme, name } = ctx || {}
  const q = quote || {}
  const m = meta || {}
  const p = q.price
  switch (key) {
    case 'name': return { value: name || m.name || fund?.name || null }
    case 'mcap': return { value: fund?.metrics?.market_cap || null }
    case 'earn': return { value: fmtEarn(fund?.next_earnings) }
    case 'rating': return { value: num(fund?.composite) ? String(fund.composite) : null }
    case 'sector': return { value: fund?.sector || null }
    case 'industry': return { value: fund?.industry || null }
    case 'theme': return { value: theme || null }
    case 'price': return { value: num(p) ? p.toFixed(2) : null }
    case 'chg': return { value: pct(q.change_pct), color: signColor(q.change_pct), sign: signOf(q.change_pct) }
    case 'vol': return { value: fmtVol(q.volume) }
    case 'dolvol': return { value: (num(p) && num(q.volume)) ? fmtDolVol(p * q.volume) : null }
    case 'dchg': {
      const d = num(q.change) ? q.change : ((num(p) && num(q.prev_close)) ? p - q.prev_close : null)
      return { value: num(d) ? `${d >= 0 ? '+' : ''}${d.toFixed(2)}` : null, color: signColor(d), sign: signOf(d) }
    }
    case 'fromopen': {
      const o = q.day_open
      const v = (num(o) && o > 0 && num(p)) ? ((p - o) / o) * 100 : null
      return { value: pct(v), color: signColor(v), sign: signOf(v) }
    }
    case 'fromhigh': {
      const h = q.day_high
      const v = (num(h) && h > 0 && num(p)) ? ((p - h) / h) * 100 : null
      return { value: pct(v), color: signColor(v), sign: signOf(v) }
    }
    case 'fromlow': {
      const l = q.day_low
      const v = (num(l) && l > 0 && num(p)) ? ((p - l) / l) * 100 : null
      return { value: pct(v), color: signColor(v), sign: signOf(v) }
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
        return { value: pct(v), color: signColor(v), sign: signOf(v) }
      }
      return { value: null }
  }
}
