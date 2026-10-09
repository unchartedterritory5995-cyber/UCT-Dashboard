// UCT Terminal — SCAT's arguments: which universe, and which metric on each axis (wave 9, lane 2).
//
//   SCAT [UNIVERSE] [Y-METRIC] [X-METRIC]
//   SCAT NDX                     the Nasdaq 100 on the default axes
//   SCAT NDX CHG_1M RS_RANK      the Nasdaq 100, 1-month % (up) against RS rating (across)
//   SCAT RS_RANK DIST_52W_HIGH   the default universe; Y first, then X
//
// The panel writes every pick back through its own command (usePanelRerun), so `?cmd=`, history
// and a reload keep the view. A metric is its catalog key; a universe is a short name.
//
// ⛔ BOTH TABLES MIRROR THE SERVER, and a rail reads api/services/scatter.py to keep them equal
// (scatterArgs.test.js): METRICS mirrors `METRICS`, and the universes mirror `_INDEX_SETS`,
// `_ETF_SETS`, `_SCANNERS` and `_BREADTH_SETS` (keys and labels). A key the server does not serve is refused at the
// command line ("not applied"), never sent to draw an empty axis.
//
// ⚠️ A member's own lists (a watchlist, a tag, a theme, an industry) are not written into the
// command: their ids are not safe as one upper-cased command word. Picking one keeps it for the
// open panel and says it is not saved.

/** The axis catalog: [key, label], the order /api/scatter/metrics serves. */
export const SCAT_METRICS = Object.freeze([
  ['chg_today', '% Change Today'], ['gap', 'Gap %'], ['from_open', '% From Open'],
  ['range_pos', 'Day Range Pos %'], ['rvol', 'Run Rate'], ['price', 'Price'],
  ['dvol_today', '$ Volume Today'], ['vol_today', 'Volume Today'],
  ['rs_rank', 'RS Rating'], ['chg_1w', '1-Week %'], ['chg_1m', '1-Month %'], ['chg_3m', '3-Month %'],
  ['chg_6m', '6-Month %'], ['chg_1y', '1-Year %'], ['chg_ytd', 'YTD %'],
  ['pct_vs_sma50', '% vs 50-SMA'], ['pct_vs_sma200', '% vs 200-SMA'],
  ['dist_52w_high', '% Off 52w High'], ['dist_52w_low', '% Off 52w Low'], ['rsi14', 'RSI (14)'],
  ['adr_pct', 'ADR %'], ['atr_pct', 'ATR %'], ['beta', 'Beta'],
  ['avg_vol_30d', 'Avg Vol (30d)'], ['dollar_vol_30d', 'Avg $ Vol (30d)'],
  ['market_cap', 'Market Cap'], ['pe_ttm', 'P/E (TTM)'], ['short_float', 'Short Float %'],
  ['div_yield', 'Dividend Yield %'],
])
const METRIC_LABEL = Object.fromEntries(SCAT_METRICS)

/** The default view: the S&P 500, RS rating (Y) against % off the 52-week high (X). */
export const SCAT_DEFAULT = Object.freeze({ source: 'index', value: 'sp500', yKey: 'rs_rank', xKey: 'dist_52w_high' })

// ── universes ──
/** `_INDEX_SETS`: value → [label, the word written back, other spellings]. */
export const SCAT_INDEXES = Object.freeze({
  sp500: ['S&P 500', 'SP500', ['SPX', 'SPY']],
  ndx: ['Nasdaq 100', 'NDX', ['NASDAQ100', 'QQQ']],
  dow: ['Dow 30', 'DOW', ['DJIA', 'DIA']],
  r2k: ['Russell 2000', 'R2K', ['RUSSELL2000', 'IWM']],
})
/** `_ETF_SETS`: the equity ETFs offered as universes (the ticker is the word). */
export const SCAT_ETFS = Object.freeze(['OEF', 'XLV', 'XLE', 'XLF', 'XLK', 'XLI', 'XLU', 'XLB', 'XLY', 'XLP', 'XLC', 'XLRE'])
/** `_SCANNERS`: key → label, written `SCAN:KEY`. */
export const SCAT_SCANNERS = Object.freeze({
  volume: 'Volume Surge', nhnl: 'New Highs / Lows', movers: 'Movers', catalysts: 'Catalysts', candidates: 'Scanner Candidates',
})
/** `_BREADTH_SETS`: key → label, written `BREADTH:KEY`. */
export const SCAT_BREADTH = Object.freeze({
  up_4pct_today: 'Up 4%+ Today', down_4pct_today: 'Down 4%+ Today', up_from_open: 'Up From Open',
  down_from_open: 'Down From Open', up_on_volume: 'Up On Volume', down_on_volume: 'Down On Volume',
  new_52w_highs: 'New 52w Highs', new_52w_lows: 'New 52w Lows', up_25pct_quarter: 'Up 25% / Qtr',
  up_50pct_month: 'Up 50% / Mo', stage2_count: 'Stage 2 (MA stack)', stage4_count: 'Stage 4 (MA stack)',
})
/** Sources with no value. */
const PLAIN = Object.freeze({ MARKET: ['market', 'UCT Universe'], SECTORS: ['sectors', 'Sector'], FLAGGED: ['flagged', 'Flagged'], UCT20: ['uct20', 'UCT 20'] })

const universe = (source, value, label, token) => Object.freeze({ source, value, label, token })

/** Parse one command word as a universe, or null. */
export function parseScatUniverse(tok) {
  const t = String(tok ?? '').trim().toUpperCase().replace(/^\$/, '')
  if (!t) return null
  for (const [value, [label, word, alts]] of Object.entries(SCAT_INDEXES)) {
    if (t === word || alts.includes(t)) return universe('index', value, label, word)
  }
  if (PLAIN[t]) return universe(PLAIN[t][0], '', PLAIN[t][1], t)
  if (t === 'ALL') return universe('market', '', PLAIN.MARKET[1], 'MARKET')
  if (SCAT_ETFS.includes(t)) return universe('etf', t, t, t)
  const m = t.match(/^(SCAN|BREADTH):([A-Z0-9_]+)$/)
  if (m) {
    const key = m[2].toLowerCase()
    if (m[1] === 'SCAN' && SCAT_SCANNERS[key]) return universe('scanner', key, SCAT_SCANNERS[key], t)
    if (m[1] === 'BREADTH' && SCAT_BREADTH[key]) return universe('breadth', key, SCAT_BREADTH[key], t)
  }
  return null
}

/** The command word for a universe pick, or null when it cannot be written (a member's own list). */
export function scatUniverseToken({ source, value } = {}) {
  const v = String(value ?? '')
  if (source === 'index') return SCAT_INDEXES[v.toLowerCase()]?.[1] ?? null
  if (source === 'etf') return SCAT_ETFS.includes(v.toUpperCase()) ? v.toUpperCase() : null
  if (source === 'scanner') return SCAT_SCANNERS[v.toLowerCase()] ? `SCAN:${v.toUpperCase()}` : null
  if (source === 'breadth') return SCAT_BREADTH[v.toLowerCase()] ? `BREADTH:${v.toUpperCase()}` : null
  const plain = Object.entries(PLAIN).find(([, [src]]) => src === source)
  return plain ? plain[0] : null
}

/** Parse one command word as an axis metric key, or null. */
export function parseScatMetric(tok) {
  const k = String(tok ?? '').trim().toLowerCase()
  return METRIC_LABEL[k] ? k : null
}

/** A metric's label (the catalog's), or the key itself. */
export const scatMetricLabel = (k) => METRIC_LABEL[k] || k

/**
 * Pure: the command a view is written back as, or null when the universe cannot be written.
 * Defaults are left out (`SCAT` alone is the default view); the axes are written as a pair,
 * Y then X, whenever either differs from the default.
 */
export function scatCommand({ source, value, yKey, xKey }) {
  const parts = ['SCAT']
  const isDefaultUniverse = source === SCAT_DEFAULT.source && String(value ?? '') === SCAT_DEFAULT.value
  if (!isDefaultUniverse) {
    const tok = scatUniverseToken({ source, value })
    if (!tok) return null
    parts.push(tok)
  }
  if (yKey !== SCAT_DEFAULT.yKey || xKey !== SCAT_DEFAULT.xKey) parts.push(yKey.toUpperCase(), xKey.toUpperCase())
  return parts.join(' ')
}
