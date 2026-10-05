// app/src/components/chart/engine/chartScalars.js
//
// ─── P0 0F — A CURRENT SCALAR IS NOT A HISTORICAL SERIES ─────────────────────
//
// `closedTable.json::scalars` declares per-symbol values (`market_cap`,
// `rs_rank`, …) that are ONE NUMBER PER SYMBOL from the nightly screener
// snapshot (`_scalars`). The screener reads them as today's values — that is
// their contract. The chart lane draws one value PER BAR and is offered no
// scalar map at all (`nativeRegistry.computeFor` passes `undefined`
// deliberately), so `interpret` seeds every declared scalar as a hole (`NaN`).
//
// The hole alone would be honest (a gap), but the comparison operators collapse
// a hole to 0 (`interpret.js::cmp`, both lanes, X23): `market_cap > 1e9` drew a
// CONFIDENT 0 ("false") on every bar of every chart, and `!(market_cap > 1e9)`
// a confident 1. That is a trading answer the engine never computed.
//
// ⛔ THE CHART CANNOT HAVE THE CURRENT VALUE EITHER: drawing today's market cap
// on every past bar (or comparing against it there) would fabricate a history
// that does not exist — the same reason `ast/pcf.js` refuses a bar offset on
// `market_cap` and `screener/backtest.py` refuses any scalar tree.
//
// ⭐ SO THE CONSUMER ASKS THE QUESTION BEFORE IT EVALUATES — the engine's own
// model (`ast_interpret.unresolved_scalars` / `unresolved_inputs`: the hole stays
// a hole in `interpret`, and every consumer that cannot supply a value refuses or
// drops BEFORE a comparison can launder it). The screener and the backtest ask it
// already; this is the chart lane's copy of that question, as a per-plot column
// refusal with a sentence (like `periodReads.js` / `blockRuns.js`), never a
// column of zeros. The alert lane asks it at arm
// (`api/services/alert_user_series.py`, gate `scalar`).

import { scalarsIn } from './ast/freshness'

/** The guard a chart plot carries when its tree reads a current-only scalar. */
export const CHART_SCALAR_GUARD = 'chart:scalar-current-only'

/** The sentence for a tree that reads a declared scalar on the chart lane, or
 *  null when it reads none. */
export function chartScalarRefusal(tree) {
  const names = [...scalarsIn(tree)].sort()
  if (!names.length) return null
  const list = names.map((n) => `\`${n}\``).join(', ')
  return `${list} ${names.length === 1 ? 'is' : 'are'} today's value from the nightly screener `
    + 'snapshot — one number per symbol, with no history behind it. A chart draws a value on '
    + 'every past bar, and using today\'s number there would invent a history that does not '
    + 'exist, so this plot is not drawn. It works as a screen, which reads the current value.'
}
