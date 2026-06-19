// Column formatters + heat-map classifiers for the results table.
// NOTE: margins / growth / roe / roa / dividend_yield are stored as PERCENT
// numbers by the snapshot builder (e.g. 25.0 == 25%), so format directly.
const pct = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
const pctPlain = (d = 0) => v => v == null ? '—' : `${v.toFixed(d)}%`
const usd = v => v == null ? '—' : `$${v.toFixed(2)}`
const cap = v => v == null ? '—'
  : v >= 1e12 ? `$${(v / 1e12).toFixed(1)}T`
  : v >= 1e9 ? `$${(v / 1e9).toFixed(0)}B`
  : `$${(v / 1e6).toFixed(0)}M`
const num = (d = 1) => v => v == null ? '—' : v.toFixed(d)
const heatPos = v => v == null ? '' : v > 2 ? 'g' : v < -2 ? 'r' : ''
const heatRs = v => v == null ? '' : v >= 80 ? 'g' : v >= 60 ? 'g1' : ''

export const COLUMN_DEFS = {
  ticker: { label: 'Ticker', fmt: v => v },
  company: { label: 'Company', fmt: v => (v || '').slice(0, 24) || '—' },
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
}
