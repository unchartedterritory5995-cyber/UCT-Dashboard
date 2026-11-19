// What every Breadth Monitor column means — ONE place, keyed by metric key (owner
// 2026-11-19). The header's hover card and the top of its click menu read it.
//
// Reconciled with the engine's own definitions: `api/services/breadth_metrics.py`
// DESCRIPTIONS (windows and thresholds are the ones the code applies) and the notes
// in heatmapMetrics.js / Breadth.jsx. Definitions only — never real numbers.
// `breadth/columnInfo.test.js` fails if a column ships without a name and a description.
//
//   name   the column in plain words
//   desc   what it measures and how to read it (one or two short sentences)
//   weekly true for a weekly survey (the card says it updates weekly)
const MA = (n, kind = 'simple') => ({
  name: `Stocks above their ${n}-day average`,
  desc: `Share of stocks closing above their ${n}-day ${kind} moving average. High readings mean broad strength; very low readings mean a washed-out market.`,
})

export const COLUMN_INFO = Object.freeze({
  // ── Score ──
  breadth_score: { name: 'Breadth health', desc: 'UCT’s composite breadth score, built from the breadth readings on this sheet. Higher means healthier participation.' },
  uct_exposure: { name: 'UCT Exposure', desc: 'UCT’s recommended market exposure rating for the session. Higher means more exposure is warranted.' },

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
  universe_count: { name: 'Stocks in universe', desc: 'How many stocks were measured that session. The counts in the other columns are out of this many.' },
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
  hvc_52w: { name: 'Highest-volume closes', desc: 'Stocks closing above their 10-day average on their highest volume in 52 weeks. A sign of heavy accumulation.' },
  atr_ext_7: { name: 'Extended 7+ ATRs', desc: 'Stocks more than 7 average true ranges above their 50-day moving average. High counts mean the market is stretched.' },

  // ── Sentiment ──
  cnn_fear_greed: { name: 'CNN Fear & Greed', desc: 'CNN’s Fear & Greed Index, from 0 (extreme fear) to 100 (extreme greed).' },
  aaii_bulls: { name: 'AAII bulls', desc: 'Share of AAII survey members who expect stocks to rise over the next six months.', weekly: true },
  aaii_neutral: { name: 'AAII neutral', desc: 'Share of AAII survey members who expect stocks to stay flat over the next six months.', weekly: true },
  aaii_bears: { name: 'AAII bears', desc: 'Share of AAII survey members who expect stocks to fall over the next six months.', weekly: true },
  aaii_spread: { name: 'AAII bull-bear spread', desc: 'AAII bulls minus bears. Deeply negative readings mark pessimism, often near lows.', weekly: true },
  naaim: { name: 'NAAIM Exposure Index', desc: 'How much stock exposure active investment managers report, on average. High means managers are fully invested.', weekly: true },
  cboe_putcall: { name: 'CBOE put/call ratio', desc: 'Put volume divided by call volume on CBOE. High readings mean traders are buying protection.' },
})

/** The column's info, or null for an unknown key. */
export function columnInfo(key) {
  return COLUMN_INFO[key] ?? null
}
