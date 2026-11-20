// tools/vendor_harness/history_claim.mjs
//
// ─── ⭐⭐ ONE AUTHORITY: DOES A CAPTURE'S HISTORY START AT THE LISTING? ──────────────────────
//
// A capture states it as `history.startsAtBar0: true` (its loaded history stopped growing AND began on the
// listing day). Every grader that leans on it reads it HERE: the lane context's `historyFromListing`
// (`ourSide.js`), the warm-bars supplier index and the bar-0 shortcut (`ourSide.js`), the no-warm-up rule
// (`compare.mjs`), the paint warm-up (`paintColours.js`) and [B-START] method (a) (`strategyHarness.js`).
//
// ⛔⛔ THE CLAIM IS REFUTED BY THE CAPTURE'S OWN DATA (coordinator ruling 2026-11-19, the GATE-BLIND follow-up).
// A capture whose OWN `plot(bar_index, …)` control row does not read 0, 1, 2 … has NOT started at TradingView's
// bar 0, whatever its metadata says, and the claim is read as FALSE. The receipt is untouched: nothing in the
// capture is edited; the grader declines to believe a statement the capture's own numbers contradict.
// ⚰️ The case: twelve captures of the 2026-09-27 vocabulary wave carried `startsAtBar0: true` with a boilerplate
// `why` naming another symbol ("NYSE:RDDT listed 2024-03-21 …") on charts that start in 2022 and 2025; their own
// bar_index rows read 8172, 7432, 11158 … on the first bar. Believed, the claim made BOTH lanes count from 0, and
// vw-int-cast / vw-nvi-pvi-truncated graded DIVERGE on every lane over an engine that is right (re-graded with the
// claim refuted: 12/12 and 9/9 MATCH). A capture with no control row keeps its claim: there is nothing to refute it.

/** The bar_index control row's title (`I00_bar_index_CONTROL`, `M00_bar_index_CONTROL`, `P00_bar_index`, …). */
export const BAR_INDEX_CONTROL = /^[A-Za-z]\d\d_bar_index(_CONTROL)?$/

/** The capture's own bar_index control row, `{id, values}`, or null when it has none (or no plot values). */
export function barIndexControlRow(capture) {
  const plots = (capture && capture.study && capture.study.plots) || []
  const control = plots.find((p) => BAR_INDEX_CONTROL.test(p.title || ''))
  const pv = capture && capture.plotValues
  if (!control || !pv || !Array.isArray(pv.fields) || !Array.isArray(pv.rows) || !pv.rows.length) return null
  const at = pv.fields.indexOf(control.id)
  if (at < 0) return null
  return { id: control.id, values: pv.rows.map((r) => r[at]) }
}

/** Why the capture's `startsAtBar0` claim is refuted by its own bar_index row, or null (no claim, no row, or
 *  the row reads 0, 1, 2 …). */
export function startsAtBar0Refuted(capture) {
  if (!(capture && capture.history && capture.history.startsAtBar0 === true)) return null
  const row = barIndexControlRow(capture)
  if (!row) return null
  const at = row.values.findIndex((v, i) => v !== i)
  if (at < 0) return null
  return `history.startsAtBar0 is REFUTED by the capture's own bar_index control row, which reads `
    + `${JSON.stringify(row.values[at])} on its bar ${at} (it must read ${at}): its history does not start at TradingView's bar 0`
}

/** ⭐ The claim as every grader must read it: asserted, and not refuted by the capture's own numbers. */
export function startsAtBar0Holds(capture) {
  return !!(capture && capture.history && capture.history.startsAtBar0 === true) && !startsAtBar0Refuted(capture)
}
