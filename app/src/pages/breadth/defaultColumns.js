// The Breadth Monitor's DEFAULT column set (owner 2026-11-19): a focused core set,
// in this order, after the Date column. Every other metric stays available in
// Columns, unchecked by default. Members' own presets are untouched; a member on
// Default sees this set (Default is computed, never stored per member).
export const DEFAULT_COLUMNS = Object.freeze([
  'breadth_score',      // Health
  'uct_exposure',       // UCT Exp
  'up_4pct_today',      // Up 4%+
  'down_4pct_today',    // Dn 4%+
  'ratio_5day',         // 5D Ratio
  'ratio_10day',        // 10D Ratio
  'up_20pct_5d',        // Up20%/5d   (round 14: counts run short-term → long-term)
  'down_20pct_5d',      // Dn20%/5d
  'up_25pct_quarter',   // Up25%/Qtr
  'down_25pct_quarter', // Dn25%/Qtr
  'magna_up',           // Up13%/34d
  'magna_down',         // Dn13%/34d
  'net_new_high_low',   // Net NH-NL  (round 14: the internals before the index dots)
  'adv_decline',        // A/D
  'spy_ma_stack',       // SPY (dots)
  'qqq_ma_stack',       // QQQ (dots)
  'pct_above_20sma',    // >20SMA
  'pct_above_50sma',    // >50SMA
  'pct_above_200sma',   // >200SMA
  'vix',                // VIX
  'cnn_fear_greed',     // CNN F/G
  'universe_count',     // Universe   (round 14: at the end)
  // round 14: Up Vol and Dist Days left the default (still in Columns)
])

/** The hook's `defaults` for a column list: hidden = everything off the core set;
 *  order = the core set, then the rest in code order (so turning one on in Columns
 *  puts it back in its usual family position after the core). */
export function defaultsFor(allKeys) {
  const core = new Set(DEFAULT_COLUMNS)
  return Object.freeze({
    hidden: Object.freeze(allKeys.filter(k => !core.has(k))),
    order: Object.freeze([...DEFAULT_COLUMNS.filter(k => allKeys.includes(k)), ...allKeys.filter(k => !core.has(k))]),
  })
}
