// What every Breadth Monitor column means — ONE place, keyed by metric key (owner
// 2026-11-19). The top of the header's click menu and its screen-reader description read it.
//
// Reconciled with the engine's own definitions: `api/services/breadth_metrics.py`
// DESCRIPTIONS (windows and thresholds are the ones the code applies) and the notes
// in heatmapMetrics.js / Breadth.jsx. Definitions only — never real numbers.
// `breadth/columnInfo.test.js` fails if a column ships without a name and a description.
//
//   name   the column in plain words
//   desc   what it measures and how to read it (one or two short sentences)
//   weekly true for a weekly survey (the card says it updates weekly)
//   title  the column's medium-length name for a window title or a menu ("Down 4%+ today",
//          "Up 20% in 5 days"): written out, never the sheet's abbreviation, ≤ 24 characters.
//          Every column has one (columnInfo.test.js); `columnTitle()` reads it.
const MA = (n, kind = 'simple') => ({
  title: `Above ${n}-day average`,
  name: `Stocks above their ${n}-day average`,
  desc: `Share of stocks closing above their ${n}-day ${kind} moving average. High readings mean broad strength; very low readings mean a washed-out market.`,
})

const INFO = {
  // ── Score ──
  breadth_score: { name: 'Breadth health', desc: 'A 0–100 score of how healthy the market’s breadth is. It combines nine readings: how many stocks are above their 50-day average, the 5-day up/down ratio, new highs, the 13%/34-day movers, Stage 2 stocks, advancers vs. decliners, and three fear gauges (VIX, put/call and AAII), which count as healthier when fear is high. Higher is healthier.' },
  uct_exposure: { name: 'UCT Exposure', desc: 'The Morning Wire’s Exposure Rating for that day: how much of a full stock position UCT suggests, from 0% (all cash) to 100% (fully invested). Blank on days with no Morning Wire rating.' },

  // ── Primary breadth ──
  up_4pct_today: { name: 'Stocks up 4%+ today', desc: 'Stocks that closed up 4% or more from the prior close. Big counts are buying thrusts.' },
  down_4pct_today: { name: 'Stocks down 4%+ today', desc: 'Stocks that closed down 4% or more from the prior close. Big counts are selling pressure.' },
  ratio_5day: { name: '5-day up/down ratio', desc: 'Stocks up 4%+ divided by stocks down 4%+, each summed over the last 5 sessions. Above 1 means buyers lead; 2 or more is a strong thrust, 0.5 or less is heavy selling.' },
  ratio_10day: { name: '10-day up/down ratio', desc: 'Stocks up 4%+ divided by stocks down 4%+, each summed over the last 10 sessions. A slower read of the same balance as the 5-day ratio.' },
  up_20pct_5d: { name: 'Up 20% in 5 days', desc: 'Stocks up 20% or more over the last 5 sessions. Spikes mean momentum is running hot.' },
  down_20pct_5d: { name: 'Down 20% in 5 days', desc: 'Stocks down 20% or more over the last 5 sessions. Spikes mean sharp liquidation.' },
  up_25pct_quarter: { name: 'Up 25% in a quarter', desc: 'Stocks up 25% or more over the last quarter (65 sessions). Rising counts mean broad momentum.' },
  down_25pct_quarter: { name: 'Down 25% in a quarter', desc: 'Stocks down 25% or more over the last quarter (65 sessions). Rising counts mean broad damage.' },
  up_25pct_month: { name: 'Up 25% in a month', desc: 'Stocks up 25% or more over the last month (21 sessions). A faster momentum read than the quarter.' },
  down_25pct_month: { name: 'Down 25% in a month', desc: 'Stocks down 25% or more over the last month (21 sessions). A faster read of damage than the quarter.' },
  up_50pct_month: { name: 'Up 50% in a month', desc: 'Stocks up 50% or more over the last month (21 sessions). High counts mark speculative, hot markets.' },
  down_50pct_month: { name: 'Down 50% in a month', desc: 'Stocks down 50% or more over the last month (21 sessions). High counts mark crash-like conditions.' },
  magna_up: { name: 'Up 13% in 34 days', desc: 'Stocks up 13% or more over the last 34 sessions. A medium-term read of how many stocks are trending up.' },
  magna_down: { name: 'Down 13% in 34 days', desc: 'Stocks down 13% or more over the last 34 sessions. A medium-term read of how many stocks are trending down.' },
  universe_count: { name: 'Stocks in universe', desc: 'How many stocks were measured that session; the counts in the other columns are out of this many. UCT counts tradable U.S. stocks ($2+ price, 200K+ shares a day, $300M+ market cap, no pending buyouts). Nasdaq, NYSE and U.S. count every listed stock, including small caps.' },
  is_ftd: { name: 'Follow-Through Day', desc: 'Marks a Follow-Through Day session: a strong up day that confirms a new rally attempt. Also marked beside the date.' },

  // ── MA breadth ──
  spy_ma_stack: { name: 'SPY vs its moving averages', desc: 'Four dots for SPY against its 10, 20, 50 and 200-day averages, left to right. Filled means above that average; a ring means below.' },
  qqq_ma_stack: { name: 'QQQ vs its moving averages', desc: 'Four dots for QQQ against its 10, 20, 50 and 200-day averages, left to right. Filled means above that average; a ring means below.' },
  pct_above_5sma: MA(5),
  pct_above_10sma: MA(10),
  pct_above_20sma: MA(20),
  pct_above_40sma: MA(40),
  pct_above_50sma: MA(50),
  pct_above_100sma: MA(100),
  pct_above_150sma: MA(150),
  pct_above_200sma: MA(200),

  // ── Regime ──
  sp500_close: { name: 'S&P 500 close', desc: 'The S&P 500’s closing level. Its shading follows the day’s % change, so big up or down days stand out.' },
  qqq_close: { name: 'QQQ close', desc: 'QQQ’s closing price. Its shading follows the day’s % change, so big up or down days stand out.' },
  vix: { name: 'VIX volatility index', desc: 'The market’s expected 30-day volatility for the S&P 500. High readings mean fear; low readings mean calm.' },
  mcclellan_osc: { name: 'McClellan Oscillator', desc: 'The 19-day minus the 39-day exponential average of net advances (raw, not ratio-adjusted). Above zero means advancers lead; extremes mark overbought or oversold breadth.' },
  stage2_count: { name: 'Stocks in Stage 2', desc: 'Stocks in a Stage 2 uptrend by moving-average stack: price above the 50-day, above the 150-day, above the 200-day, with the 200-day rising. Not the full trend template.' },
  stage4_count: { name: 'Stocks in Stage 4', desc: 'Stocks in a Stage 4 downtrend by moving-average stack: price below the 50-day, below the 150-day, below the 200-day, with the 200-day falling.' },

  // ── Highs / lows ──
  new_52w_highs: { name: 'New 52-week highs', desc: 'Stocks trading above their 52-week high during the session. Expanding highs confirm an uptrend.' },
  new_52w_lows: { name: 'New 52-week lows', desc: 'Stocks trading below their 52-week low during the session. Expanding lows confirm a downtrend.' },
  new_20d_highs: { name: 'New 20-day highs', desc: 'Stocks trading above their 20-session high during the session. A short-term read of breakouts.' },
  new_20d_lows: { name: 'New 20-day lows', desc: 'Stocks trading below their 20-session low during the session. A short-term read of breakdowns.' },
  new_ath: { name: 'New all-time highs', desc: 'Stocks closing at an all-time high. The strongest leadership in the market.' },
  hvc_52w: { name: 'Highest-volume closes', desc: 'Stocks that traded their highest volume in 52 weeks today and closed above their 10-day moving average. Heavy buying rather than heavy selling. UCT universe only.' },
  atr_ext_7: { name: 'Extended 7+ ATRs', desc: 'Stocks more than 7 average true ranges above their 50-day moving average. High counts mean the market is stretched.' },

  net_new_high_low: { name: 'Net new highs minus lows', desc: 'New 52-week highs minus new 52-week lows for the session. Positive means highs lead; negative means lows dominate.' },
  near_52w_high: { name: 'Near 52-week highs', desc: 'Stocks within 5% of their 52-week high. Many names close to their highs means a healthy uptrend.' },
  hi_ratio: { name: 'New highs, % of universe', desc: 'New 52-week highs as a percent of the stocks measured. Comparable across days with different universe sizes.' },
  lo_ratio: { name: 'New lows, % of universe', desc: 'New 52-week lows as a percent of the stocks measured. Comparable across days with different universe sizes.' },

  // ── Volume / A-D ──
  adv_decline: { name: 'Advancers minus decliners', desc: 'Stocks that closed up minus stocks that closed down, versus the prior close. Positive means more stocks rose than fell.' },
  advancing: { name: 'Advancing stocks', desc: 'Stocks that closed above their prior close.' },
  declining: { name: 'Declining stocks', desc: 'Stocks that closed below their prior close.' },
  adv_decline_cum: { name: 'Advance/decline line', desc: 'A running total of each day’s advancers minus decliners. Its direction matters more than its level: a rising line confirms broad participation.' },
  up_vol_ratio: { name: 'Up volume ratio', desc: 'Volume in rising stocks divided by volume in falling stocks for the session. Above 1 means buyers carried more volume.' },

  // ── Regime (round 13) ──
  spy_dist_days: { name: 'S&P distribution days', desc: 'SPY distribution days in the last 26 sessions, counted through the prior session: a drop of 0.2% or more on above-average (50-day) volume, or an up or flat close in the bottom quarter of the day’s range on above-average volume. A day drops off once SPY is 5% above that close. Rising counts mean institutional selling.' },
  qqq_dist_days: { name: 'QQQ distribution days', desc: 'QQQ distribution days in the last 26 sessions, counted the same way as the S&P’s. Rising counts mean institutional selling in tech.' },
  rsp_spy_ratio: { name: 'Equal-weight vs cap-weight S&P', desc: 'RSP (equal-weight S&P 500) divided by SPY (cap-weight). Rising means the average stock is keeping up with the giants.' },
  iwm_qqq_ratio: { name: 'Small caps vs Nasdaq 100', desc: 'IWM (Russell 2000) divided by QQQ (Nasdaq 100). Rising means small caps are leading.' },
  vix_term_structure: { name: 'VIX term structure', desc: 'The 6-month VIX (VIX6M) divided by the VIX. Above 1 is the normal, calm shape; below 1 means near-term fear is higher than longer-term.' },

  // ── Sentiment ──
  cnn_fear_greed: { name: 'CNN Fear & Greed', desc: 'CNN’s Fear & Greed Index, from 0 (extreme fear) to 100 (extreme greed).' },
  aaii_bulls: { name: 'AAII bulls', desc: 'Share of AAII survey members who expect stocks to rise over the next six months.', weekly: true },
  aaii_neutral: { name: 'AAII neutral', desc: 'Share of AAII survey members who expect stocks to stay flat over the next six months.', weekly: true },
  aaii_bears: { name: 'AAII bears', desc: 'Share of AAII survey members who expect stocks to fall over the next six months.', weekly: true },
  aaii_spread: { name: 'AAII bull-bear spread', desc: 'AAII bulls minus bears. Deeply negative readings mark pessimism, often near lows.', weekly: true },
  naaim: { name: 'NAAIM Exposure Index', desc: 'How much stock exposure active investment managers report, on average. High means managers are fully invested.', weekly: true },
  cboe_putcall: { name: 'CBOE equity put/call', desc: 'Put volume divided by call volume on CBOE stock options. High readings mean traders are buying protection.' },
}

// The medium-length titles (window titles, the drill's metric switcher). Written out in full.
const TITLES = {
  breadth_score: 'Breadth health', uct_exposure: 'UCT Exposure',
  up_4pct_today: 'Up 4%+ today', down_4pct_today: 'Down 4%+ today',
  ratio_5day: '5-day up/down ratio', ratio_10day: '10-day up/down ratio',
  up_20pct_5d: 'Up 20% in 5 days', down_20pct_5d: 'Down 20% in 5 days',
  up_25pct_quarter: 'Up 25% in a quarter', down_25pct_quarter: 'Down 25% in a quarter',
  up_25pct_month: 'Up 25% in a month', down_25pct_month: 'Down 25% in a month',
  up_50pct_month: 'Up 50% in a month', down_50pct_month: 'Down 50% in a month',
  magna_up: 'Up 13% in 34 days', magna_down: 'Down 13% in 34 days',
  universe_count: 'Stocks in universe', is_ftd: 'Follow-Through Day',
  spy_ma_stack: 'SPY vs its averages', qqq_ma_stack: 'QQQ vs its averages',
  sp500_close: 'S&P 500 close', qqq_close: 'QQQ close', vix: 'VIX volatility index',
  mcclellan_osc: 'McClellan Oscillator', stage2_count: 'Stocks in Stage 2', stage4_count: 'Stocks in Stage 4',
  new_52w_highs: 'New 52-week highs', new_52w_lows: 'New 52-week lows',
  new_20d_highs: 'New 20-day highs', new_20d_lows: 'New 20-day lows',
  new_ath: 'New all-time highs', hvc_52w: 'Highest-volume closes', atr_ext_7: 'Extended 7+ ATRs',
  net_new_high_low: 'Net new highs − lows', near_52w_high: 'Near 52-week highs',
  hi_ratio: 'New highs, % of stocks', lo_ratio: 'New lows, % of stocks',
  adv_decline: 'Advancers − decliners', advancing: 'Advancing stocks', declining: 'Declining stocks',
  adv_decline_cum: 'Advance/decline line', up_vol_ratio: 'Up volume ratio',
  spy_dist_days: 'S&P distribution days', qqq_dist_days: 'QQQ distribution days',
  rsp_spy_ratio: 'Equal-weight vs S&P 500', iwm_qqq_ratio: 'Small caps vs Nasdaq 100',
  vix_term_structure: 'VIX term structure', cnn_fear_greed: 'CNN Fear & Greed',
  aaii_bulls: 'AAII bulls', aaii_neutral: 'AAII neutral', aaii_bears: 'AAII bears',
  aaii_spread: 'AAII bull-bear spread', naaim: 'NAAIM Exposure Index', cboe_putcall: 'CBOE equity put/call',
}

export const COLUMN_INFO = Object.freeze(Object.fromEntries(
  Object.entries(INFO).map(([k, v]) => [k, Object.freeze({ title: TITLES[k], ...v })]),
))

/** The column's medium-length title ("Down 4%+ today"), else `fallback`. */
export function columnTitle(key, fallback = null) {
  return COLUMN_INFO[key]?.title ?? fallback
}

/** The column's info, or null for an unknown key. */
export function columnInfo(key) {
  return COLUMN_INFO[key] ?? null
}
