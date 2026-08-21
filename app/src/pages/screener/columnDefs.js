// Column formatters + heat-map classifiers for the results table.
// NOTE: margins / growth / roe / roa / dividend_yield are stored as PERCENT
// numbers by the snapshot builder (e.g. 25.0 == 25%), so format directly.
const pct = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
const pctPlain = (d = 0) => v => v == null ? '—' : `${v.toFixed(d)}%`
const usd = v => v == null ? '—'
  : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const cap = v => v == null ? '—'
  : v >= 1e12 ? `$${(v / 1e12).toFixed(1)}T`
  : v >= 1e9 ? `$${(v / 1e9).toFixed(0)}B`
  : `$${(v / 1e6).toFixed(0)}M`
const num = (d = 1) => v => v == null ? '—' : v.toFixed(d)
const heatPos = v => v == null ? '' : v > 2 ? 'g' : v < -2 ? 'r' : ''
const heatRs = v => v == null ? '' : v >= 80 ? 'g' : v >= 60 ? 'g1' : ''
const bool = v => v == null ? '—' : v ? '✓' : '—'
const dollarVol = v => v == null ? '—'
  : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B`
  : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M`
  : `$${(v / 1e3).toFixed(0)}K`
// shares, not dollars — avg_volume_30d is a descriptive filter, not a $ column
const shares = v => v == null ? '—'
  : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M`
  : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K`
  : `${v}`

export const COLUMN_DEFS = {
  ticker: { label: 'Ticker', fmt: v => v },
  company: { label: 'Company', fmt: v => !v ? '—' : v.length > 24 ? `${v.slice(0, 23).trimEnd()}…` : v },
  sector: { label: 'Sector', fmt: v => v || '—' },
  market_cap: { label: 'Mkt Cap', fmt: cap },
  price: { label: 'Price', fmt: usd },
  chg_pct_1d: { label: 'Chg%', fmt: pct, heat: heatPos },
  vol_ratio: { label: 'Vol×', fmt: v => v == null ? '—' : `${v.toFixed(1)}×` },
  rs_rank: { label: 'RS', fmt: num(0), heat: heatRs },
  uct_composite: { label: 'UCT', fmt: num(0), heat: heatRs },
  rs_return: { label: 'RS Ret', fmt: num(2) },
  accdis: { label: 'A/D', fmt: v => v ?? '—' },
  pe_ttm: { label: 'P/E', fmt: num(1) },
  pe_fwd: { label: 'Fwd P/E', fmt: num(1) },
  peg: { label: 'PEG', fmt: num(2) },
  ps: { label: 'P/S', fmt: num(1) },
  pb: { label: 'P/B', fmt: num(1) },
  dividend_yield: { label: 'Div', fmt: pctPlain(1) },
  eps_growth: { label: 'EPS Gr', fmt: pctPlain(0), heat: v => v == null ? '' : v > 0 ? 'g' : 'r' },
  rev_growth: { label: 'Rev Gr', fmt: pctPlain(0) },
  op_margin: { label: 'Op Mgn', fmt: pctPlain(0) },
  gross_margin: { label: 'Gr Mgn', fmt: pctPlain(0) },
  net_margin: { label: 'Net Mgn', fmt: pctPlain(0) },
  roe: { label: 'ROE', fmt: pctPlain(0) },
  roa: { label: 'ROA', fmt: pctPlain(0) },
  debt_to_equity: { label: 'D/E', fmt: num(1) },
  rsi14: { label: 'RSI', fmt: num(0) },
  pct_vs_sma50: { label: 'vs50', fmt: pct, heat: heatPos },
  pct_vs_sma200: { label: 'vs200', fmt: pct, heat: heatPos },
  pct_vs_ema20: { label: 'EMA20', fmt: pct },
  adr_pct: { label: 'ADR%', fmt: num(1) },
  gap_pct: { label: 'Gap%', fmt: pct, heat: heatPos },
  dist_52w_high_pct: { label: '52WH', fmt: pct },
  candle_type: { label: 'Candle', fmt: v => v && v !== 'none' ? v : '—' },
  patterns: { label: 'Pattern', fmt: v => v ? v.split(',')[0] : '—' },
  // exposed-existing (previously filterable-but-undisplayable or dark)
  beta: { label: 'Beta', fmt: num(2) },
  current_ratio: { label: 'Curr Ratio', fmt: num(1) },
  close_position: { label: 'Close Pos', fmt: num(2) },
  atr_pct: { label: 'ATR%', fmt: num(1) },
  pct_vs_sma20: { label: 'vs20', fmt: pct, heat: heatPos },
  dist_52w_low_pct: { label: '52WL', fmt: pct },
  inst_pct: { label: 'Inst%', fmt: pctPlain(0) },
  industry: { label: 'Industry', fmt: v => v || '—' },
  pattern_conf_max: { label: 'Pat Conf', fmt: num(2) },
  consecutive_down: { label: 'Down Run', fmt: num(0) },
  body_pct: { label: 'Body', fmt: num(2) },
  upper_wick_pct: { label: 'U Wick', fmt: num(2) },
  lower_wick_pct: { label: 'L Wick', fmt: num(2) },
  chg_pct_1w: { label: '1W%', fmt: pct, heat: heatPos },
  chg_pct_1m: { label: '1M%', fmt: pct, heat: heatPos },
  // Wave 1 performance
  chg_pct_3m: { label: '3M%', fmt: pct, heat: heatPos },
  chg_pct_6m: { label: '6M%', fmt: pct, heat: heatPos },
  chg_pct_1y: { label: '1Y%', fmt: pct, heat: heatPos },
  chg_pct_ytd: { label: 'YTD%', fmt: pct, heat: heatPos },
  chg_from_open_pct: { label: 'FromOpen', fmt: pct, heat: heatPos },
  adr_pct_1w: { label: 'ADR 1W', fmt: num(1) },
  dist_20d_high_pct: { label: '20DH', fmt: pct },
  dist_20d_low_pct: { label: '20DL', fmt: pct },
  dist_ath_pct: { label: 'ATH', fmt: pct },
  new_ath: { label: 'New ATH', fmt: bool },
  dollar_vol_30d: { label: '$Vol 30d', fmt: dollarVol },
  // Wave 1 momentum mechanics
  pole_pct: { label: 'Pole%', fmt: pctPlain(0) },
  vol_nweek_low: { label: 'Vol Low', fmt: v => v === 20 ? '4w' : v === 15 ? '3w' : v === 10 ? '2w' : '—' },
  vol_updown_ratio: { label: 'U/D Vol', fmt: v => v == null ? '—' : `${v.toFixed(2)}×`,
    heat: v => v == null ? '' : v > 1.1 ? 'g' : v < 0.85 ? 'r' : '' },
  close_cv_pct: { label: 'CV%', fmt: num(1) },
  avg_body_pct_5: { label: 'Body5', fmt: num(2) },
  ema_touch_count: { label: 'EMA Touch', fmt: num(0) },
  ema10_rising: { label: 'E10↑', fmt: bool },
  ema20_rising: { label: 'E20↑', fmt: bool },
  ema_stack_intact: { label: 'Stack', fmt: bool },
  candle_score: { label: 'Score', fmt: num(0),
    heat: v => v == null ? '' : v >= 70 ? 'g' : v >= 55 ? 'g1' : '' },
  atr_ext_sma50: { label: 'ATR Ext', fmt: num(1) },
  rs_line_trend: { label: 'RS Line', fmt: v => v || '—' },
  prev_day_open: { label: 'PD O', fmt: usd },
  prev_day_high: { label: 'PDH', fmt: usd },
  prev_day_low: { label: 'PDL', fmt: usd },
  prev_day_close: { label: 'PDC', fmt: usd },
  // Wave 1 context
  theme: { label: 'Theme', fmt: v => v || '—' },
  in_uct20: { label: 'UCT20', fmt: bool },
  index_sp500: { label: 'SPX', fmt: bool },
  index_ndx: { label: 'NDX', fmt: bool },
  index_dow: { label: 'DOW', fmt: bool },
  index_r2k: { label: 'R2K', fmt: bool },
  is_etf: { label: 'ETF', fmt: bool },
  is_leveraged: { label: 'Lev', fmt: bool },
  stage2: { label: 'Stg2', fmt: bool },
  stage4: { label: 'Stg4', fmt: bool },
  hvc_52w: { label: 'HVC', fmt: bool },
  // pre-Wave-1 filters that were also filterable-but-undisplayable — same gap
  // class, caught by the same rail (filters.py unchanged since 5d7b16033)
  exchange: { label: 'Exch', fmt: v => v || '—' },
  avg_volume_30d: { label: 'Avg Vol 30d', fmt: shares },
  above_50sma: { label: 'Abv 50', fmt: bool },
  ma_stack: { label: 'MA Stack', fmt: v => v || '—' },
  new_52w_high: { label: 'New 52WH', fmt: bool },
  wide_bar: { label: 'Wide Bar', fmt: bool },
  narrow_bar: { label: 'Narrow Bar', fmt: bool },
  tight_consolidation: { label: 'Tight', fmt: bool },
  nr7: { label: 'NR7', fmt: bool },
  inside_bar_run: { label: 'IB Run', fmt: num(0) },
  higher_lows_run: { label: 'HL Run', fmt: num(0) },
  pullback_depth_pct: { label: 'Pullback%', fmt: pctPlain(1) },
  consecutive_up: { label: 'Up Run', fmt: num(0) },
  // Wave 2 — FMP bulk: six unread ratio fields + ipo_date/country
  quick_ratio: { label: 'Quick', fmt: num(1) },
  p_fcf: { label: 'P/FCF', fmt: num(1) },
  p_ocf: { label: 'P/OCF', fmt: num(1) },
  payout_ratio: { label: 'Payout', fmt: pctPlain(0) },
  roic: { label: 'ROIC', fmt: pctPlain(0) },
  lt_debt_to_capital: { label: 'LTD/Cap', fmt: num(2) },
  ipo_date: { label: 'IPO', fmt: v => v ? String(v).slice(0, 10) : '—' },
  ipo_age_days: { label: 'IPO Age', fmt: num(0) },
  country: { label: 'Country', fmt: v => v || '—' },
}
