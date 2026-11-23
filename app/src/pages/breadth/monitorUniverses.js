// The Breadth Monitor's UNIVERSE switcher (UCT / U.S. stocks / Nasdaq / NYSE).
//
// UCT is the collector's own sheet and is byte-for-byte what it always was. The other three
// read PRE-BUILT rows (api/services/breadth_universe_monitor.py): every per-universe column
// is that universe's own reading; the market-wide columns (VIX, sentiment, the index closes
// and MA dots, UCT Exp, distribution days, the ETF ratios, FTD) are the same reading on
// every universe, copied from UCT for the same date.

export const DEFAULT_UNIVERSE = 'uct'

export const MONITOR_UNIVERSES = [
  // `sub` is the plain-words kind of universe shown beside the name in the dropdown;
  // `hint` is the one-line explanation (owner 2026-11-19: UCT = "tradable stocks").
  { id: 'uct', label: 'UCT', sub: 'tradable stocks', name: 'UCT universe',
    hint: 'Tradable U.S. stocks: about 2,600 stocks and ADRs with a $2+ price, 200K+ shares a day and a $300M+ market cap. Excludes penny stocks, very thin names and stocks being bought out. Updated daily.' },
  { id: 'us', label: 'U.S. stocks', sub: 'all listed', name: 'U.S. stocks',
    hint: 'Every U.S.-listed common stock and ADR, including small caps, counted the way classic exchange breadth is.' },
  { id: 'nasdaq', label: 'Nasdaq', sub: 'all listed', name: 'Nasdaq',
    hint: 'Every Nasdaq-listed common stock and ADR, including small caps, counted the way classic exchange breadth is.' },
  { id: 'nyse', label: 'NYSE', sub: 'all listed', name: 'NYSE',
    hint: 'Every NYSE-listed common stock and ADR, including small caps, counted the way classic exchange breadth is.' },
]

const BY_ID = Object.fromEntries(MONITOR_UNIVERSES.map(u => [u.id, u]))

/** A known universe id, else UCT (an unknown `?universe=` never reaches the API). */
export function parseUniverse(v) {
  const id = String(v ?? '').trim().toLowerCase()
  return BY_ID[id] ? id : DEFAULT_UNIVERSE
}

export const universeLabel = (id) => BY_ID[id]?.label ?? BY_ID[DEFAULT_UNIVERSE].label

/** The `universe` query param for an API read: '' on UCT, so every UCT URL is unchanged. */
export const universeParam = (id, joiner = '&') => (id && id !== DEFAULT_UNIVERSE ? `${joiner}universe=${id}` : '')

// ⛔ EXACT localStorage key names (shared-origin rule): UCT keeps its historical keys; each
// other universe has its own pair, spelled out — never built from a prefix a peer could share.
export const MONITOR_LS_KEYS = {
  uct: { dates: 'uct.breadth.dates.v1', recent: 'uct.breadth.recent.v1' },
  us: { dates: 'uct.breadth.dates.v1.us', recent: 'uct.breadth.recent.v1.us' },
  nasdaq: { dates: 'uct.breadth.dates.v1.nasdaq', recent: 'uct.breadth.recent.v1.nasdaq' },
  nyse: { dates: 'uct.breadth.dates.v1.nyse', recent: 'uct.breadth.recent.v1.nyse' },
}

// A universe's key, ONE RETURN PER UNIVERSE (an unknown id gets UCT's): every key a storage call
// can be handed is then readable from the source, so the persistence census (TERM-076,
// tools/persistence_census.mjs) declares each one exactly, never as a `*`.
export function monitorDatesLsKey(universe) {
  if (universe === 'us') return MONITOR_LS_KEYS.us.dates
  if (universe === 'nasdaq') return MONITOR_LS_KEYS.nasdaq.dates
  if (universe === 'nyse') return MONITOR_LS_KEYS.nyse.dates
  return MONITOR_LS_KEYS.uct.dates
}
export function monitorRecentLsKey(universe) {
  if (universe === 'us') return MONITOR_LS_KEYS.us.recent
  if (universe === 'nasdaq') return MONITOR_LS_KEYS.nasdaq.recent
  if (universe === 'nyse') return MONITOR_LS_KEYS.nyse.recent
  return MONITOR_LS_KEYS.uct.recent
}

/** Columns that are the SAME reading on every universe (copied from UCT for the date). */
export const MARKET_WIDE_COLS = new Set([
  'uct_exposure', 'is_ftd', 'spy_ma_stack', 'qqq_ma_stack', 'sp500_close', 'qqq_close', 'vix',
  'spy_dist_days', 'qqq_dist_days', 'rsp_spy_ratio', 'iwm_qqq_ratio', 'vix_term_structure',
  'cnn_fear_greed', 'aaii_bulls', 'aaii_neutral', 'aaii_bears', 'aaii_spread', 'naaim', 'cboe_putcall',
])

/** Row keys behind the market-wide columns (mirrors breadth_universe_monitor.MARKET_WIDE). */
export const MARKET_WIDE_ROW_KEYS = [
  'vix', 'cnn_fear_greed', 'aaii_bulls', 'aaii_neutral', 'aaii_bears', 'aaii_spread',
  'naaim', 'cboe_putcall', 'avg_10d_cpc',
  'sp500_close', 'qqq_close', 'spy_close', 'spy_day_pct', 'qqq_day_pct',
  'spy_above_10sma', 'spy_above_20sma', 'spy_above_50sma', 'spy_above_200sma',
  'qqq_above_10sma', 'qqq_above_20sma', 'qqq_above_50sma', 'qqq_above_200sma',
  'uct_exposure', 'spy_dist_days', 'qqq_dist_days',
  'rsp_spy_ratio', 'iwm_qqq_ratio', 'vix_term_structure', 'is_ftd', 'manual_ftd',
  'aaii_survey_date', 'naaim_date',
]

/** Today's live row for a universe: its own columns, with UCT's live market-wide readings. */
export function withMarketWide(universeRow, uctRow) {
  if (!universeRow) return null
  const out = { ...universeRow }
  if (uctRow) {
    for (const k of MARKET_WIDE_ROW_KEYS) out[k] = uctRow[k] ?? null
    for (const k of Object.keys(uctRow)) {
      if (k.endsWith('_asof') && MARKET_WIDE_ROW_KEYS.includes(k.slice(0, -5))) out[k] = uctRow[k]
    }
  }
  return out
}

/** Columns with no per-universe source yet (Phase 3): "n/a" off UCT. */
export const UNAVAILABLE_COLS = new Set(['up_vol_ratio', 'hvc_52w', 'atr_ext_7', 'new_ath'])

/** Health: scored off UCT with that universe's own bands (breadth_health_bands, 2026-11-23). */
export const HEALTH_COL = 'breadth_score'

export const NOT_AVAILABLE_NOTE = 'Not available for this universe yet.'

/**
 * The header-menu note a column carries on this universe, or null (UCT: always null, so the
 * UCT menu is exactly what it was).
 */
export function universeColumnNote(key, universe) {
  if (!universe || universe === DEFAULT_UNIVERSE) return null
  const label = universeLabel(universe)
  if (key === HEALTH_COL) {
    return `Scored with ${label}’s own bands: each band edge sits at the same percentile of ${label}’s history as UCT’s does in UCT’s.`
  }
  if (UNAVAILABLE_COLS.has(key)) return NOT_AVAILABLE_NOTE
  if (MARKET_WIDE_COLS.has(key)) return 'Market-wide: the same reading on every universe.'
  if (key === 'mcclellan_osc') {
    return `Ratio-adjusted on ${label}: net advances as a share of advancers plus decliners, so it differs from UCT’s raw version.`
  }
  if (key === 'adv_decline_cum') {
    return `${label}’s own line, running from its first session; its level is not comparable to UCT’s.`
  }
  if (key === 'universe_count') return `The number of ${label} stocks measured that session.`
  return null
}

/** What a cell shows instead of its value on this universe ('n/a' / '—'), or null. */
export function universeCellOverride(key, universe) {
  if (!universe || universe === DEFAULT_UNIVERSE) return null
  if (UNAVAILABLE_COLS.has(key)) return 'n/a'
  return null
}

/**
 * The Columns menu's tag for a column on this universe (ColumnsMenu `columnTag`): null on UCT;
 * "Market-wide" for a column that is the same everywhere; "n/a for <universe>" (dimmed) for
 * the not-yet-available columns.
 */
export function columnTagFor(key, universe) {
  if (!universe || universe === DEFAULT_UNIVERSE) return null
  const label = universeLabel(universe)
  if (UNAVAILABLE_COLS.has(key)) {
    return { label: `n/a for ${label}`, title: universeColumnNote(key, universe), na: true }
  }
  if (MARKET_WIDE_COLS.has(key)) {
    return { label: 'Market-wide', title: 'The same reading on every universe.' }
  }
  return null
}
