import { expect, test } from 'vitest'
import { sortableColumns, isNumericColumn, columnTypes } from '../sortKeys'
import { COLUMN_DEFS } from '../../columnDefs'

// ⭐ CAPTURED 2026-10-14 from the server, not typed: `filters.VIEWS` (every view's columns) and,
// for every view column that has a filter, `FILTERS[col]['type']`. The meta entries built from
// these carry NO `column` field (filters.py `_build_shared_filters`), so neither does this.
const VIEWS = {
  overview: ["ticker", "company", "sector", "market_cap", "price", "chg_pct_1d", "vol_ratio", "rs_rank", "base_render"],
  valuation: ["ticker", "company", "market_cap", "pe_fwd", "peg", "price", "uct_composite"],
  financial: ["ticker", "eps_growth", "rev_growth", "op_margin", "roe", "rs_return", "accdis"],
  technical: ["ticker", "rsi14", "pct_vs_sma50", "pct_vs_sma200", "adr_pct", "dist_52w_high_pct", "vol_ratio", "gap_pct", "pct_vs_ema20", "candle_type"],
  uct_ratings: ["ticker", "uct_composite", "rs_rank", "rs_return", "accdis", "eps_growth", "op_margin", "roe"],
  charts: ["ticker", "company", "chg_pct_1d", "price"],
  performance: ["ticker", "company", "chg_pct_1d", "chg_pct_1w", "chg_pct_1m", "chg_pct_3m", "chg_pct_6m", "chg_pct_1y", "chg_pct_ytd", "dist_52w_high_pct", "dist_ath_pct"],
  momentum: ["ticker", "company", "candle_score", "pct_vs_ema20", "close_cv_pct", "avg_body_pct_5", "pole_pct", "adr_pct", "vol_nweek_low", "vol_updown_ratio", "rs_line_trend", "chg_pct_1d"],
  bases: ["ticker", "company", "base_render", "base_shape", "base_relation_count", "price", "chg_pct_1d", "candle_score", "pct_vs_sma50", "dist_52w_high_pct", "vol_ratio"],
  patterns: ["ticker", "company", "pattern_engine_ids", "pattern_engine_conf", "pattern_engine_dir", "pattern_expectancy_r", "pattern_entry_dist_pct", "pattern_stop_dist_pct", "pattern_engine_vcp", "pattern_engine_flat_base", "candle_score"],
  flow: ["ticker", "company", "price", "chg_pct_1d", "dp_notional_1d", "dp_prints_1d", "dp_notional_5d", "dp_level_dist_pct", "opt_net_premium_1d", "opt_bull_pct_1d", "opt_net_premium_5d"],
  ownership: ["ticker", "company", "shares_outstanding", "float_shares", "float_pct", "inst_pct", "inst_trans_pct", "insider_own_pct", "insider_trans_pct", "short_float_pct", "short_ratio", "optionable", "shortable"],
  events: ["ticker", "company", "next_earnings_date", "days_to_earnings", "earnings_session", "implied_move_pct", "last_report_move_pct", "earnings_setup_grade", "analyst_consensus", "pt_upside_pct", "upgrades_30d", "downgrades_30d"],
  context: ["ticker", "company", "theme", "in_uct20", "index_sp500", "index_ndx", "index_r2k", "is_etf", "is_leveraged", "stage2", "stage4", "hvc_52w"],
  candles: ["ticker", "company", "candle_type", "candle_trend", "bar_character", "candle_recent", "candle_recent_bars_ago", "candle_weekly", "candle_monthly", "body_pct", "upper_wick_pct", "lower_wick_pct", "close_position", "inside_bar_run", "nr7", "vol_ratio", "chg_pct_1d"],
}
const FILTER_TYPES = {"accdis": "enum", "adr_pct": "range", "analyst_consensus": "enum", "avg_body_pct_5": "range", "bar_character": "enum", "base_relation_count": "range", "body_pct": "range", "candle_monthly": "enum", "candle_recent": "enum", "candle_recent_bars_ago": "range", "candle_score": "range", "candle_trend": "enum", "candle_type": "enum", "candle_weekly": "enum", "chg_pct_1d": "range", "chg_pct_1m": "range", "chg_pct_1w": "range", "chg_pct_1y": "range", "chg_pct_3m": "range", "chg_pct_6m": "range", "chg_pct_ytd": "range", "close_cv_pct": "range", "close_position": "range", "days_to_earnings": "range", "dist_52w_high_pct": "range", "dist_ath_pct": "range", "downgrades_30d": "range", "dp_level_dist_pct": "range", "dp_notional_1d": "range", "dp_notional_5d": "range", "dp_prints_1d": "range", "earnings_session": "enum", "earnings_setup_grade": "enum", "eps_growth": "range", "float_pct": "range", "float_shares": "range", "gap_pct": "range", "hvc_52w": "bool", "implied_move_pct": "range", "in_uct20": "bool", "index_ndx": "bool", "index_r2k": "bool", "index_sp500": "bool", "inside_bar_run": "range", "insider_own_pct": "range", "insider_trans_pct": "range", "inst_pct": "range", "inst_trans_pct": "range", "is_etf": "bool", "is_leveraged": "bool", "last_report_move_pct": "range", "lower_wick_pct": "range", "market_cap": "range", "next_earnings_date": "range", "nr7": "bool", "op_margin": "range", "opt_bull_pct_1d": "range", "opt_net_premium_1d": "range", "opt_net_premium_5d": "range", "optionable": "bool", "pattern_engine_conf": "range", "pattern_engine_dir": "range", "pattern_engine_flat_base": "bool", "pattern_engine_vcp": "bool", "pattern_entry_dist_pct": "range", "pattern_expectancy_r": "range", "pattern_stop_dist_pct": "range", "pct_vs_ema20": "range", "pe_fwd": "range", "peg": "range", "pole_pct": "range", "price": "range", "pt_upside_pct": "range", "rev_growth": "range", "roe": "range", "rs_line_trend": "enum", "rs_rank": "range", "rs_return": "range", "rsi14": "range", "sector": "enum", "shares_outstanding": "range", "short_float_pct": "range", "short_ratio": "range", "shortable": "bool", "stage2": "bool", "stage4": "bool", "theme": "enum", "uct_composite": "range", "upgrades_30d": "range", "upper_wick_pct": "range", "vol_nweek_low": "range", "vol_ratio": "range", "vol_updown_ratio": "range"}
const META = { filters: Object.entries(FILTER_TYPES).map(([key, type]) => ({ key, label: key, category: 'x', type, presets: [], allow_custom: type === 'range', unit: null })) }
const ALL_VIEW_COLUMNS = [...new Set(Object.values(VIEWS).flat())]
const DEFAULT = 'uct_composite'

test('the fixture is the real shape: no column field on any meta entry', () => {
  expect(META.filters.some(f => 'column' in f)).toBe(false)
  expect(META.filters.length).toBeGreaterThan(50)
})
test('every numeric view column with NO range filter is still sortable (vs 50-day avg can appear)', () => {
  // the view columns meta has no filter for at all, derived from the capture
  const unfiltered = ALL_VIEW_COLUMNS.filter(c => !(c in FILTER_TYPES))
  // of those, the numeric ones: these are the ones a filter-only rule dropped
  const NUMERIC_UNFILTERED = ['pct_vs_sma50', 'pct_vs_sma200']
  expect(unfiltered.filter(c => NUMERIC_UNFILTERED.includes(c)).sort()).toEqual([...NUMERIC_UNFILTERED].sort())
  for (const c of NUMERIC_UNFILTERED) {
    expect(sortableColumns({ meta: META, columns: VIEWS.technical, defaultKey: DEFAULT })).toContain(c)
  }
  // and the rest of the unfiltered view columns are text, never offered
  const TEXT_UNFILTERED = unfiltered.filter(c => !NUMERIC_UNFILTERED.includes(c))
  expect(new Set(TEXT_UNFILTERED)).toEqual(new Set(['ticker', 'company', 'base_render', 'base_shape', 'pattern_engine_ids']))
  const types = columnTypes(META)
  for (const c of TEXT_UNFILTERED) expect(isNumericColumn(c, types)).toBe(false)
})
test('every range-filtered view column is sortable; no enum or bool column is', () => {
  const keys = sortableColumns({ meta: META, columns: ALL_VIEW_COLUMNS, defaultKey: DEFAULT })
  for (const [c, t] of Object.entries(FILTER_TYPES)) {
    if (t === 'range') expect(keys).toContain(c)
    else expect(keys).not.toContain(c)
  }
  for (const c of ['ticker', 'company', 'sector', 'base_render', 'base_shape']) expect(keys).not.toContain(c)
})
test('a meta enum or bool type wins over a heat scale', () => {
  const types = columnTypes({ filters: [{ key: 'pct_vs_sma50', type: 'enum', presets: [] }] })
  expect(isNumericColumn('pct_vs_sma50', types)).toBe(false)
})
test('every heat-scaled column definition is one the server does not type as text', () => {
  const types = columnTypes(META)
  for (const [k, d] of Object.entries(COLUMN_DEFS)) {
    if (typeof d.heat !== 'function') continue
    const t = types.get(k)
    if (t) expect(t).toBe('range')
  }
})
test('order: the default, the current sort, then the view; each once; default always offered', () => {
  const keys = sortableColumns({ meta: META, columns: ['ticker', 'price', 'rs_rank', 'sector', 'price'], sortKey: 'rs_rank', defaultKey: DEFAULT })
  expect(keys).toEqual([DEFAULT, 'rs_rank', 'price'])
  expect(sortableColumns({ meta: null, columns: [], defaultKey: DEFAULT })).toEqual([DEFAULT])
  // a text sort set elsewhere is not listed (the trigger still names it; Reverse still flips it)
  expect(sortableColumns({ meta: META, columns: [], sortKey: 'base_render', defaultKey: DEFAULT })).toEqual([DEFAULT])
})
