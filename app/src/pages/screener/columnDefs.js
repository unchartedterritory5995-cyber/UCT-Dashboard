// Column formatters + heat-map classifiers for the results table.
// NOTE: margins / growth / roe / roa / dividend_yield are stored as PERCENT
// numbers by the snapshot builder (e.g. 25.0 == 25%), so format directly.
//
// ── `desc` — the member-facing honesty text, and who renders it ──
// An OPTIONAL field on a column. It is the sentence that keeps a member from
// misreading the number: the $4M dark-pool block floor, the pattern-ENGINE vs
// cheap-heuristic scale split, the three-way-ambiguous blank, the
// classified-only denominator on options bull %, the ANALYST ESTIMATE
// disclosure on 5-year forward EPS.
//
// ⭐ ONE READER, TWO SURFACES: `shell/ColumnDesc.jsx`. It renders the results
// column header (`VirtualResults`) AND the filter control (`FilterControl`,
// joined on filter.key === column key), so the text a member reads while
// setting a threshold is byte-identical to the one beside the cell. Until
// 2026-08-23 the only consumer was a native `title` on the header — hover-only,
// keyboard-unreachable, and truncated by the OS on the long ones, which is to
// say these strings protected nobody.
//
// ⛔ A COLUMN WITHOUT ONE RENDERS NO AFFORDANCE. `ColumnDesc` returns null on a
// missing/blank `desc` rather than opening an empty box. Most columns have none
// (55 of 157 carry one at 2026-08-24, up from 18 — the accuracy wave wrote the
// fundamentals, valuation and bar-shape families) and that gap closes by
// writing the text HERE — never by having the surface improvise one.
// ⛔ `columnDescCoverage.test.js` is the RATCHET: it names the columns that
// must carry text and holds the count, so this number can only go up.

// `descFor` and the trigger's width live in this component-free module so both
// the affordance and the layout that reserves room for it read ONE value.
export const descFor = key => {
  const d = COLUMN_DEFS[key]?.desc
  return typeof d === 'string' && d.trim() ? d.trim() : null
}
export const DESC_TRIGGER_W = 20
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
// TRI-STATE, and the difference from `bool` is the whole point: `bool` renders 0
// and null identically (an em dash), which is correct only where "false" is not a
// fact worth stating. On a column where 0 means "we looked and the answer is no"
// and null means "we never looked", `bool` would print a confident no as a blank.
// Reach for `tri` on any nullable flag; reach for `bool` only when a 0 carries no
// information the reader needs.
const tri = v => v == null ? '—' : v ? '✓' : '✗'
const dollarVol = v => v == null ? '—'
  : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B`
  : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M`
  : `$${(v / 1e3).toFixed(0)}K`
// shares, not dollars — avg_volume_30d is a descriptive filter, not a $ column
const shares = v => v == null ? '—'
  : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M`
  : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K`
  : `${v}`
// signed dollars — opt_net_premium_* goes negative (bear premium exceeded
// bull); dollarVol above would print "$-2000K". Null stays an em dash.
const netUsd = v => {
  if (v == null) return '—'
  const a = Math.abs(v)
  const s = a >= 1e9 ? `$${(a / 1e9).toFixed(1)}B`
    : a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M`
    : `$${(a / 1e3).toFixed(0)}K`
  return `${v < 0 ? '-' : '+'}${s}`
}

export const COLUMN_DEFS = {
  ticker: { label: 'Ticker', fmt: v => v },
  company: { label: 'Company', fmt: v => !v ? '—' : v.length > 24 ? `${v.slice(0, 23).trimEnd()}…` : v },
  sector: { label: 'Sector', fmt: v => v || '—' },
  market_cap: { label: 'Mkt Cap', fmt: cap,
    desc: 'Shares outstanding times price, with dual-class share counts combined. ⚠️ It is computed from the latest close we hold, which on a row with a stale price used to be a DIFFERENT date from the price shown beside it. ⭐ CORRECTED 2026-08-24: that can no longer happen — a row whose price is more than ten sessions old is no longer given a price to multiply, so market cap on those rows is the provider\'s own current figure or is honestly blank. The two columns in a row share a clock now.' },
  price: { label: 'Price', fmt: usd },
  chg_pct_1d: { label: 'Chg%', fmt: pct, heat: heatPos },
  vol_ratio: { label: 'Vol×', fmt: v => v == null ? '—' : `${v.toFixed(1)}×`,
    desc: 'The newest session\'s volume against the average of the 30 sessions BEFORE it — today is deliberately excluded from its own baseline, or a big day would drag the average toward itself and hide the spike. ⚠️ On the current session the numerator is the volume we hold SO FAR, which for a name still trading is short of the official consolidated figure: measured against an independent source, the newest session runs a median 10% light. A ratio near 1.0 late in the day is the one to distrust. A genuine 0.00× means the stock did not trade.' },
  rs_rank: { label: 'RS', fmt: num(0), heat: heatRs },
  uct_composite: { label: 'UCT', fmt: num(0), heat: heatRs },
  rs_return: { label: 'RS Ret', fmt: num(2) },
  accdis: { label: 'A/D', fmt: v => v ?? '—' },
  pe_ttm: { label: 'P/E', fmt: num(1),
    desc: 'Price divided by trailing-twelve-month earnings per share. A loss-making company has NEGATIVE earnings and therefore a negative P/E — we publish it rather than blanking it, because "loses money" is information, but it means a plain "under 20" range will match a company earning nothing. Prefer a two-sided range with a floor above zero.' },
  pe_fwd: { label: 'Fwd P/E', fmt: num(1),
    desc: 'Price divided by the consensus forward earnings estimate. Negative means analysts expect a LOSS; the shipped "Under" presets are bounded below at zero so they cannot return those companies as cheap.' },
  peg: { label: 'PEG', fmt: num(2),
    desc: 'P/E divided by an earnings-growth rate — a valuation adjusted for how fast earnings grow, where lower is nominally cheaper. ⚠️ It is only meaningful when BOTH inputs are positive: a loss-maker with shrinking growth divides one negative by another and produces a small, attractive-looking positive. ⭐ CORRECTED 2026-08-24: that combination is now REFUSED outright — PEG is published only where the P/E it is built on is positive, which removed 508 companies from the shipped \'Under 1\' preset. A NEGATIVE PEG is still published and still means shrinking earnings against a positive P/E, and the presets are bounded below at zero so they cannot return one.' },
  ps: { label: 'P/S', fmt: num(1),
    desc: 'Price divided by trailing-twelve-month revenue per share. Revenue is never negative, so unlike the earnings and cash-flow multiples this one has no sign trap — but it says nothing about whether any of that revenue turns into profit.' },
  pb: { label: 'P/B', fmt: num(1),
    desc: 'Price divided by book value per share. A company that has burned through its equity has NEGATIVE book value and therefore a negative P/B; we publish it, because owing more than you own is information. ⚠️ That means a plain “under 1” range will match companies with no book value at all. Where the provider’s own P/B and its own book value disagree in sign, neither is published.' },
  dividend_yield: { label: 'Div', fmt: pctPlain(1),
    desc: 'TRAILING dividend yield — the last twelve months of declared dividends over the current price. Not a forward or indicated yield, so a company that has just raised or cut its dividend reads at the old rate until the change is twelve months old.' },
  eps_growth: { label: 'EPS Gr', fmt: pctPlain(0), heat: v => v == null ? '' : v > 0 ? 'g' : 'r',
    desc: 'Growth in earnings per share over the trailing twelve months against the prior twelve. ⚠️ Percentage growth from a NEGATIVE base is not meaningful — a company that lost less money than last year can print a large positive number.' },
  rev_growth: { label: 'Rev Gr', fmt: pctPlain(0),
    desc: 'Growth in revenue over the trailing twelve months against the prior twelve. Revenue cannot go negative, so this one reads as it looks.' },
  op_margin: { label: 'Op Mgn', fmt: pctPlain(0),
    desc: 'Operating income as a percentage of revenue — what is left after the cost of goods AND the cost of running the business, before interest and tax. A literal 0 is refused rather than published: every one measured came from a company with no revenue at all, where the ratio is undefined rather than zero.' },
  gross_margin: { label: 'Gr Mgn', fmt: pctPlain(0),
    desc: 'Gross profit as a percentage of revenue — what is left after the direct cost of the product alone. ⚠️ Banks and insurers do not report a cost-of-revenue line, so this number is not comparable across sectors and is best used within one. A value above 100% is refused, because it requires a negative cost of revenue.' },
  net_margin: { label: 'Net Mgn', fmt: pctPlain(0),
    desc: 'Net income as a percentage of revenue — the bottom line, after everything. Negative is common and is published as-is: a −264% margin means the company lost nearly three dollars for every dollar of revenue.' },
  roe: { label: 'ROE', fmt: pctPlain(0),
    desc: 'Trailing-twelve-month net income over shareholders’ equity. ⚠️ THE DENOMINATOR IS THE AVERAGE OF THE LAST FOUR QUARTERS’ EQUITY, not the latest balance sheet. That is the textbook definition and it is the provider’s, but it reads HIGH for a fast-growing company whose equity has been climbing all year — measured on one large-cap, 111.7% on average equity against 81.7% on ending equity, a thirty-point difference on the same company.' },
  roa: { label: 'ROA', fmt: pctPlain(0),
    desc: 'Trailing-twelve-month net income over total assets. ⚠️ Unlike ROE beside it, this one divides by the ENDING balance sheet rather than a four-quarter average, so the two are not on the same footing — ROE can legitimately read below ROA where a company’s assets shrank over the year.' },
  debt_to_equity: { label: 'D/E', fmt: num(1),
    desc: 'Total debt divided by shareholders’ equity. An uncorroborated 0 is refused: the provider writes 0 both for “no debt” and for “could not compute”, so a zero is published only when the other debt readings on the same row agree with it.' },
  rsi14: { label: 'RSI', fmt: num(0),
    desc: 'The 14-period Relative Strength Index, Wilder’s smoothing — the same definition this platform draws on the chart, so the screener and the chart cannot disagree. ⚠️ CHANGED 2026-08-24: this column previously used simple averages (Cutler’s RSI), which ran a median 6 points away from Wilder and put hundreds of rows on the wrong side of the 70/30 lines. A scan saved before that date will select a different set now.' },
  pct_vs_sma50: { label: 'vs50', fmt: pct, heat: heatPos },
  pct_vs_sma200: { label: 'vs200', fmt: pct, heat: heatPos },
  pct_vs_ema20: { label: 'EMA20', fmt: pct },
  adr_pct: { label: 'ADR%', fmt: num(1),
    desc: 'Average Daily Range as a percentage of price — the mean of each day’s high-to-low spread, a plain measure of how far a stock typically travels. ⚠️ This is NOT ATR: it ignores overnight gaps, where ATR (the column beside it) includes them, so a gappy stock reads calmer here than it trades.' },
  gap_pct: { label: 'Gap%', fmt: pct, heat: heatPos },
  dist_52w_high_pct: { label: '52WH', fmt: pct },
  candle_type: { label: 'Candle', fmt: v => v && v !== 'none' ? v : '—',
    desc: 'The shape of the most recent daily bar — hammer, doji, engulfing and so on. ⚠️ A bar that did not move at all has NO shape: its body and wicks are zero over a range of zero, which is undefined rather than small, so it is left blank instead of being called a doji. Roughly 80 names a night are in that state, most of them because they did not trade.' },
  patterns: { label: 'Pattern', fmt: v => v ? v.split(',')[0] : '—' },
  // exposed-existing (previously filterable-but-undisplayable or dark)
  beta: { label: 'Beta', fmt: num(2),
    desc: 'Sensitivity to the broad market: 1.0 moves with it, above 1.0 amplifies it, below 1.0 dampens it. Supplied by the fundamentals provider, not recomputed here.' },
  current_ratio: { label: 'Curr Ratio', fmt: num(1),
    desc: 'Current assets over current liabilities — whether a company can cover the next year’s bills with the next year’s cash. Below 1.0 is a company relying on refinancing. An uncorroborated 0 is refused rather than published as a value.' },
  close_position: { label: 'Close Pos', fmt: num(2),
    desc: 'Where the bar closed inside its own high-to-low range: 1.0 is the high, 0.0 is the low, 0.5 the middle. Blank when the bar has no range to sit inside — a session at a single price has no position to report, and a confident 0.0 there would read as “closed at the low”.' },
  atr_pct: { label: 'ATR%', fmt: num(1),
    desc: 'Average True Range as a percentage of price, Wilder’s definition — like ADR but INCLUDING overnight gaps, so it is the honest measure of a gappy stock’s real volatility. Use ATR% for risk and stop distance; ADR% describes intraday travel only.' },
  pct_vs_sma20: { label: 'vs20', fmt: pct, heat: heatPos },
  dist_52w_low_pct: { label: '52WL', fmt: pct },
  inst_pct: { label: 'Inst%', fmt: pctPlain(0) },
  industry: { label: 'Industry', fmt: v => v || '—' },
  pattern_conf_max: { label: 'Pat Conf', fmt: num(2) },
  consecutive_down: { label: 'Down Run', fmt: num(0) },
  body_pct: { label: 'Body', fmt: num(2),
    desc: 'How much of the bar’s high-to-low range the body (open to close) takes up: 1.0 is a bar with no wicks, near 0 is a doji. Together with the two wick fractions it sums to 1. Blank on a bar with no range, where all three are undefined.' },
  upper_wick_pct: { label: 'U Wick', fmt: num(2) },
  lower_wick_pct: { label: 'L Wick', fmt: num(2) },
  chg_pct_1w: { label: '1W%', fmt: pct, heat: heatPos },
  chg_pct_1m: { label: '1M%', fmt: pct, heat: heatPos },
  // Wave 1 performance
  chg_pct_3m: { label: '3M%', fmt: pct, heat: heatPos },
  chg_pct_6m: { label: '6M%', fmt: pct, heat: heatPos },
  chg_pct_1y: { label: '1Y%', fmt: pct, heat: heatPos },
  chg_pct_ytd: { label: 'YTD%', fmt: pct, heat: heatPos,
    desc: 'Percent change from the last close of the prior calendar year. ⚠️ Measured within our stored bar window, so a symbol whose history begins mid-window is measured from its first stored close, not from January.' },
  chg_from_open_pct: { label: 'FromOpen', fmt: pct, heat: heatPos,
    desc: 'Percent change from the session OPEN to the last price — the part of the move made after the opening print, with the overnight gap excluded. Gap and from-open compound to the full one-day change.' },
  adr_pct_1w: { label: 'ADR 1W', fmt: num(1),
    desc: 'Average daily range over the last 5 sessions, as a percent of price — how much this name typically travels in a day. A short window, so it reacts fast to a single volatile session.' },
  dist_20d_high_pct: { label: '20DH', fmt: pct },
  dist_20d_low_pct: { label: '20DL', fmt: pct },
  dist_ath_pct: { label: 'ATH', fmt: pct,
    desc: 'Percent below the all-time high, where all-time means the whole of the price history we store for this symbol — not a fixed lookback. For a long-listed name that is decades; for a recent IPO it is only since listing.' },
  new_ath: { label: 'New ATH', fmt: bool },
  dollar_vol_30d: { label: '$Vol 30d', fmt: dollarVol,
    desc: 'Price times 30-day average share volume — a liquidity measure, not an activity signal. Verified to hold exactly against price x avg volume on every row.' },
  // Wave 1 momentum mechanics
  pole_pct: { label: 'Pole%', fmt: pctPlain(0),
    desc: 'The prior advance: percent gained from the lowest low to the highest high within the last 22 sessions — the "pole" a flag or consolidation forms after.' },
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
  ma_stack: { label: 'MA Stack', fmt: v => v || '—',
    desc: 'How the moving averages are ordered. "full-bull" means price is above all three and they are stacked in ascending order; "bear" means price is below all three; "partial" is everything in between.' },
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
  quick_ratio: { label: 'Quick', fmt: num(1),
    desc: 'Current assets EXCLUDING inventory, over current liabilities — the current ratio for a business that cannot sell its stock in a hurry. An uncorroborated 0 is refused.' },
  p_fcf: { label: 'P/FCF', fmt: num(1),
    desc: 'Price divided by free cash flow per share. ⚠️ A company burning cash has negative free cash flow and therefore a negative P/FCF; we publish it, because cash burn is information — but it means a hand-typed “under 20” will return the biggest cash burners on the board. Put a floor above zero on the range.' },
  p_ocf: { label: 'P/OCF', fmt: num(1),
    desc: 'Price divided by operating cash flow per share — the same idea as P/FCF but before capital spending, so a heavy investor looks cheaper here. ⚠️ Goes negative on a company whose operations consume cash; the same floor-above-zero advice applies.' },
  payout_ratio: { label: 'Payout', fmt: pctPlain(0),
    desc: 'Dividends as a percent of earnings. Values above 100% are legitimate and common for REITs, which distribute against cash flow rather than accounting earnings — a REIT at 227% is not necessarily distressed.' },
  roic: { label: 'ROIC', fmt: pctPlain(0),
    desc: 'Return on invested capital — operating profit after tax over the debt and equity actually put to work. The measure least distorted by how a company is financed, and the one to prefer when comparing across capital structures.' },
  lt_debt_to_capital: { label: 'LTD/Cap', fmt: num(2),
    desc: 'Long-term debt as a share of total capital (long-term debt plus equity). A 0 here is a REAL zero and means exactly what it says: no long-term debt. It is published only when the row’s other debt readings corroborate it — before 2026-08-24 every one of these was blanked, so a “no long-term debt” screen excluded the very companies that qualified.' },
  ipo_date: { label: 'IPO', fmt: v => v ? String(v).slice(0, 10) : '—' },
  ipo_age_days: { label: 'IPO Age', fmt: num(0) },
  country: { label: 'Country', fmt: v => v || '—' },
  // ── ownership + events (Wave 2) ──
  shares_outstanding: { label: 'Shs Out', fmt: shares },
  float_shares: { label: 'Float', fmt: shares },
  float_pct: { label: 'Float%', fmt: pctPlain(0) },
  short_float_pct: { label: 'Short%', fmt: pctPlain(1) },
  short_ratio: { label: 'Days2Cvr', fmt: num(1) },
  insider_own_pct: { label: 'Insider%', fmt: pctPlain(0) },
  insider_cluster_days: { label: 'Cluster', fmt: v => v == null ? '—' : `${v}d` },
  next_earnings_date: { label: 'Earnings', fmt: v => v ? String(v).slice(5, 10) : '—' },
  earnings_session: { label: 'Session', fmt: v => v === 'bmo' ? 'BMO' : v === 'amc' ? 'AMC' : v ? 'TBD' : '—' },
  days_to_earnings: { label: 'Days→ER', fmt: num(0) },
  last_report_move_pct: { label: 'Last Move', fmt: pct },
  implied_move_pct: { label: 'Impl Move', fmt: pctPlain(1) },
  earnings_setup_grade: { label: 'ER Grade', fmt: v => v || '—' },
  analyst_consensus: { label: 'Consensus', fmt: v => v || '—' },
  pt_target: { label: 'PT', fmt: usd },
  pt_upside_pct: { label: 'PT Upside', fmt: pct, heat: heatPos },
  upgrades_30d: { label: 'Upgr 30d', fmt: num(0) },
  downgrades_30d: { label: 'Dngr 30d', fmt: num(0) },
  eps_next_y_growth: { label: 'EPS Next Y', fmt: pctPlain(0) },
  blended_growth: { label: 'Blend Gr', fmt: pctPlain(0) },
  sector_rs_pct: { label: 'Sect RS', fmt: num(0), heat: heatRs },
  rating_eps: { label: 'EPS Rt', fmt: num(0), heat: heatRs },
  rating_growth: { label: 'Gr Rt', fmt: num(0), heat: heatRs },
  rating_value: { label: 'Val Rt', fmt: num(0), heat: heatRs },
  rating_smr: { label: 'SMR', fmt: num(0), heat: heatRs },
  sponsorship: { label: 'Spons', fmt: v => v || '—' },
  // ── Wave 5: pattern engine + positioning & flow ──
  // `desc` is the member-facing honesty for each column (rendered by
  // `shell/ColumnDesc.jsx` on both the results header and the filter control —
  // see the contract at the top of this file): the D3 synthetic-expectancy
  // sentence, the D6 engine-vs-cheap-`patterns` scale split, the D7 $4M block
  // floor + three-way-ambiguous-blank coverage caveat, and the K3
  // classified-only denominator. A blank cell is an em dash, never a zero —
  // NULL here means "no active detection / no qualifying print / not in the
  // aggregate", three facts a fabricated 0 would silently overwrite.
  pattern_engine_ids: { label: 'Engine Pat', fmt: v => v ? v.split(',')[0] : '—',
    desc: 'Active pattern-engine detections (daily timeframe, 7-day window) from the 85-detector engine — a different instrument from the always-on patterns heuristic column, though five pattern names exist in both vocabularies. ⚠️ Capped at 10 ids and ordered MOST DISTINCTIVE FIRST, because the median symbol carries about 14: a detector that fires on nearly every stock tells you nothing and is ranked last. The cap still truncates, so this column is "the most distinctive detections", not the complete set — the per-pattern flag columns are the complete answer.' },
  pattern_engine_conf: { label: 'Eng Conf', fmt: num(0),
    desc: 'Confidence of the best active pattern-engine detection on a 0-100 scale — NOT the 0-1 scale of Pattern Confidence (pattern_conf_max) beside the cheap patterns column; the two engines share five pattern names but are different instruments. Blank = no active detection.' },
  pattern_engine_dir: { label: 'Eng Dir',
    fmt: v => v == null ? '—' : v > 0 ? 'Bull' : v < 0 ? 'Bear' : 'Neut',
    desc: 'Direction of the best active engine detection, encoded +1 bullish / -1 bearish / 0 neutral. Only detections carrying both entry and stop levels qualify as "best"; blank = none do.' },
  pattern_entry_dist_pct: { label: 'Entry Dist', fmt: pct,
    desc: 'Percent from the last close to the best active detection\'s entry level (positive = entry above price). Blank when no active detection carries both entry and stop levels.' },
  pattern_stop_dist_pct: { label: 'Stop Dist', fmt: pct,
    desc: 'Percent from the last close to the best active detection\'s stop level (negative = stop below price). Blank when no active detection carries both entry and stop levels.' },
  pattern_expectancy_r: { label: 'Expect R', fmt: v => v == null ? '—' : `${v.toFixed(2)}R`,
    desc: 'Synthetic expectancy for the best detection\'s pattern type: the historical hit rate applied at an assumed 2R-win / 1R-loss — an assumption, not measured realized R — and joined regime-blind (every measured stats row lives under the "unknown" regime bucket). Blank = no stats measured for that pattern yet.' },
  dp_notional_1d: { label: 'DP $ 1d', fmt: dollarVol,
    desc: 'Dark-pool BLOCK notional on the newest ingested session: off-exchange prints of $4M or more each — institutional block notional, NOT total dark-pool volume. Reads the session as the nightly ingest saw it (the T+1 flat-file backfill lands after the 03:00 build). Blank is three-way ambiguous: no qualifying blocks, sub-$4M prints only, or the ticker was never polled — coverage depends on which ingest writers are armed.' },
  dp_prints_1d: { label: 'DP Prints', fmt: num(0),
    desc: 'Count of qualifying dark-pool block prints ($4M+ each, off-exchange) on the newest ingested session. Blank is three-way ambiguous: no qualifying blocks, sub-$4M prints only, or the ticker was never polled.' },
  dp_notional_5d: { label: 'DP $ 5d', fmt: dollarVol,
    desc: 'Qualifying $4M+ block notional summed across the 5 newest ingested sessions (includes whatever contributed to the 1d figure). Same block floor and coverage caveats as the 1d columns.' },
  dp_level_dist_pct: { label: 'DPL Dist', fmt: pctPlain(1),
    desc: 'Percent distance from the last close to the nearest signature dark-pool level (the owner-tuned 0.25%-bin / $10M-floor clusterer). Blank = no signature levels exist for this name.' },
  opt_net_premium_1d: { label: 'Net Prem 1d', fmt: netUsd,
    heat: v => v == null ? '' : v > 0 ? 'g' : v < 0 ? 'r' : '',
    desc: 'Bullish minus bearish options premium on the newest flow-ledger session (T-1), single stocks only — ETF/index flow is out of scope. Direction math mirrors the flow board\'s conviction rules.' },
  opt_bull_pct_1d: { label: 'Bull %', fmt: pctPlain(0),
    desc: 'Bullish options premium as a percent of CLASSIFIED premium on the newest session, single stocks only — ETF/index flow is out of scope. Prints with no side recorded are directionless by honesty and sit outside both the numerator and the denominator, so this is a share of what could be classified, not of everything that traded.' },
  opt_net_premium_5d: { label: 'Net Prem 5d', fmt: netUsd,
    heat: v => v == null ? '' : v > 0 ? 'g' : v < 0 ? 'r' : '',
    desc: 'Bullish minus bearish options premium across the 5 newest flow-ledger sessions, single stocks only — ETF/index flow is out of scope.' },
  // ── Wave 6 (T6): finviz parity — transactions pair + option/short flags ──
  // The pair is SIGNED (net selling prints negative); a null is an em dash,
  // never a zero — the nightly pull simply never answered for that ticker.
  insider_trans_pct: { label: 'Ins Trans', fmt: pct },
  inst_trans_pct: { label: 'Inst Trans', fmt: pct },
  // tri-state on purpose: Finviz answers Yes(1)/No(0), and a confident No must
  // not render like never-answered (the shared `bool` collapses 0 into '—').
  optionable: { label: 'Optionable', fmt: tri },
  shortable: { label: 'Shortable', fmt: tri },
  // ── Wave 6 (parity2): finviz parity — the growth trio ──
  // SIGNED (a shrinking base prints negative); a null is an em dash, never a
  // zero — the nightly pull simply never answered for that ticker. EPS Q/Q /
  // Sales Q/Q are deliberately NOT here: eps_growth / rev_growth above
  // already carry those exact facts (one writer per fact).
  eps_past_5y_growth: { label: 'EPS 5Y', fmt: pct,
    desc: 'Annualized EPS growth over the past 5 years, from the nightly Finviz pull.' },
  eps_next_5y_growth: { label: 'EPS Next 5Y', fmt: pct,
    desc: 'ANALYST ESTIMATE — projected long-term annual EPS growth over the next 5 years, a forecast rather than a measurement. From the nightly Finviz pull.' },
  sales_past_5y_growth: { label: 'Sales 5Y', fmt: pct,
    desc: 'Annualized sales growth over the past 5 years, from the nightly Finviz pull.' },
  // ── Wave 6: per-pattern engine flags ──
  // `tri`, not `bool`, the `optionable`/`shortable` precedent: ✓ the engine
  // detected this pattern, ✗ the engine has active detections on this symbol
  // and none is this pattern, — the engine has no active detection for this
  // symbol at all. `bool` collapses 0 into an em dash and would render a
  // confident "no" identically to "never looked".
  pattern_engine_vcp: { label: 'VCP (Eng)', fmt: tri,
    desc: 'The pattern ENGINE has an active VCP detection on this symbol (daily timeframe, 7-day window) — a different instrument from the always-on patterns heuristic, which uses the same "vcp" key on far cheaper evidence. ✗ means the engine has active detections here and none of them is a VCP; a blank means the engine has no active detection for this symbol at all, which is not the same as "no".' },
  pattern_engine_flat_base: { label: 'Flat Base (Eng)', fmt: tri,
    desc: 'The pattern ENGINE has an active flat-base detection on this symbol (daily timeframe, 7-day window) — a different instrument from the always-on patterns heuristic, which uses the same "flat_base" key on far cheaper evidence. ✗ means the engine has active detections here and none of them is a flat base; a blank means the engine has no active detection for this symbol at all.' },
}
