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

/** The capture's own bar_index control row, `{id, values, times}`, or null when it has none (or no plot values). */
export function barIndexControlRow(capture) {
  const plots = (capture && capture.study && capture.study.plots) || []
  const control = plots.find((p) => BAR_INDEX_CONTROL.test(p.title || ''))
  const pv = capture && capture.plotValues
  if (!control || !pv || !Array.isArray(pv.fields) || !Array.isArray(pv.rows) || !pv.rows.length) return null
  const at = pv.fields.indexOf(control.id)
  if (at < 0) return null
  return { id: control.id, values: pv.rows.map((r) => r[at]), times: pv.rows.map((r) => r[0]) }
}

/** Why the capture's `startsAtBar0` claim is refuted by its own bar_index row, or null (no claim, no row, or the
 *  row's FIRST value is its own bar's position in the capture's bars, or 0: where TradingView began counting).
 *  ⛔ BY TIME, NOT BY ROW: a row's value is held to the POSITION of its bar (its time) in `capture.bars`. The plot
 *  values can cover only part of the bars: a capture joined onto the listing's history (`c38Joined.js`) carries
 *  every bar from the listing but the vendor's rows only for its own window, where the control row reads 8172 on
 *  bar 8172, which is exactly right. (First version compared each value to its ROW number and refuted those.) */
export function startsAtBar0Refuted(capture) {
  if (!(capture && capture.history && capture.history.startsAtBar0 === true)) return null
  const row = barIndexControlRow(capture)
  if (!row) return null
  const bars = (capture.bars && Array.isArray(capture.bars.rows)) ? capture.bars.rows : []
  const position = new Map(bars.map((r, i) => [r[0], i]))
  // ⛔ THE FIRST BAR THE ROW SPEAKS FOR, NOT EVERY BAR: where a history starts is one fact, read where the row begins.
  // A later bar that disagrees is a wrong NUMBER, and grading it DIVERGE is the grader's job: C45's control moves one
  // value by one bar and must read DIVERGE, never a refuted claim (`vendorHarness.c45BarIndex.test.js`).
  for (let k = 0; k < row.values.length; k += 1) {
    const i = position.get(row.times[k])
    if (i === undefined) continue
    // ⭐ 0 is TradingView's own start of counting, never evidence against the listing: a `calc_bars_count` script
    // counts bar_index from the first bar it calculates (vw-cs1-calc-bars-rddt-1d: its 100 rows read 0, 1, 2 … on
    // the chart's last 100 bars of a capture that does start at the listing). Only a NON-ZERO count that is not
    // the bar's position says the history began elsewhere (vw-int-cast: 8172 on its bar 0).
    if (row.values[k] === i || row.values[k] === 0) return null
    return `history.startsAtBar0 is REFUTED by the capture's own bar_index control row, which reads `
      + `${JSON.stringify(row.values[k])} on its bar ${i} (it must read ${i}): its history does not start at TradingView's bar 0`
  }
  return null
}

/** ⭐ The claim as every grader must read it: asserted, and not refuted by the capture's own numbers. */
export function startsAtBar0Holds(capture) {
  return !!(capture && capture.history && capture.history.startsAtBar0 === true) && !startsAtBar0Refuted(capture)
}
