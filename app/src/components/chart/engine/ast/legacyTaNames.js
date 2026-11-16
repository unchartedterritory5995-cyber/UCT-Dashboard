// app/src/components/chart/engine/ast/legacyTaNames.js
//
// ⭐⭐ COND-TA (engine 58) — THE PINE v1-v4 BARE SPELLINGS OF `ta.*` CALLS.
//
// Pine v5 moved these built-ins into the `ta.` namespace (`sum` into `math.`); v1-v4
// write them bare: `sma(close, 3)`. A bare call keeps the same per-call-site history
// as its namespaced twin, so every reader that asks "is this a call that keeps its
// own history?" (`objectFnInline.isTaCallName`: C48's block mark, the C45 arm walk,
// C42's one-run rewrite, the object pass) must hear it in a v1-v4 script too.
// Gap G-b (`docs/pine/capture-queue-2026-10-31-prod-ternary.md`) was exactly this
// roster missing: a v4 `if` block calling `sma` was drawn off the every-bar number.
//
// ⛔ THE SAME ROSTER AS THE SERVER'S `conditional-ta` DETECTOR
// (`api/services/pine_capabilities.py::_COND_TA_BARE`). `legacyTaNames.test.js`
// reads that file and fails by name when the two lists drift: one question, one
// answer on both sides of the wire.
// ⛔ Over-reporting is the safe direction: a v4 script's own function named after
// one of these (rare) is read as a history call, which can only withhold more.
export const LEGACY_TA_NAMES = Object.freeze(new Set([
  'sma', 'ema', 'rma', 'wma', 'vwma', 'swma', 'hma', 'alma', 'linreg', 'rsi', 'atr', 'tr', 'stdev', 'dev',
  'variance', 'highest', 'lowest', 'highestbars', 'lowestbars', 'change', 'mom', 'roc', 'cum', 'sum',
  'crossover', 'crossunder', 'cross', 'valuewhen', 'barssince', 'pivothigh', 'pivotlow', 'rising', 'falling',
  'correlation', 'percentrank', 'percentile_linear_interpolation', 'percentile_nearest_rank', 'median', 'mode',
  'range', 'stoch', 'cci', 'mfi', 'cmo', 'tsi', 'bb', 'bbw', 'kc', 'kcw', 'macd', 'dmi', 'sar', 'supertrend',
  'vwap', 'wpr', 'cog',
]))

/** The bare-name predicate for a script of Pine version `version` (`null`: no
 *  `//@version` line, which TradingView compiles as v1), or null for v5+. */
export function legacyTaCallFor(version) {
  if (version !== null && version !== undefined && !(Number(version) <= 4)) return null
  return (name) => LEGACY_TA_NAMES.has(String(name))
}
