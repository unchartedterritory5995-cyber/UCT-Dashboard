// app/src/components/chart/engine/ast/tickRound.js
//
// ─── `math.round_to_mintick(x)`, AS THE PINE BOTH LANES WRITE IT ────────────────
//
// THE REFERENCE (v4 `round_to_mintick`, v5 and v6 `math.round_to_mintick`, the same sentence in all
// three, read 2026-11-16 with `tools/pine_survey/pine_reference_extract.js --version 4|5|6`):
//
//     "Returns the value rounded to the symbol's mintick, i.e. the nearest value that can be divided
//      by syminfo.mintick, without the remainder, with ties rounding up."
//     Returns (v5, v6): "The `number` rounded to tick precision."
//
// ⛔ The reference says ties round UP. It does NOT say whether a "tie" is the DECIMAL value the script
// wrote (654.405 is a half tick at 0.01) or the BINARY double it holds (654.405 is
// 654.404999999999972715…, a hair under the half). That is the question this module answers, and it
// answers it on ONE witness:
//
//   `parabolic-sar-spy-1d-2026-11-15`: TradingView prints `tostring(round_to_mintick(sar))` as
//   "654.41" on the bar whose SAR is 654.405. We wrote the tick count as `x / tick` and printed
//   "654.4": 654.405 / 0.01 is 65440.49999999999 in binary. Written as `x * (1 / tick)` it is
//   65440.5 exactly, and rounds up as TradingView printed it.
//
// So both lanes write ONE expression, here:
//
//     math.round(x * (1 / syminfo.mintick)) * syminfo.mintick
//
// It is the reading consistent with that capture that moves NO other committed answer: every
// committed capture whose script calls `round_to_mintick` (26 of them) was re-graded on both lanes
// and only that one row moved (DIVERGE -> MATCH). It is NOT the only reading consistent with it: a
// tolerance on `x / tick` (the broker's fill rounding, B-ROUND, allows 1e-6 of a tick) or "round the
// shortest decimal, a tie up" print 654.41 too. They part on a value as plain as 1.005 at 0.01: this
// reading keeps it at 1.00 (1.005 * 100 is 100.49999999999999; TradingView's own `format.mintick`
// prints it "1.00", `vw-fmt-tie-readings` T08), the other two give 1.01. The capture that settles it is
// queued: `tools/visual_conformance/probes/vw-round-to-mintick-ties.pine`
// (`docs/pine/capture-queue-2026-11-16-tick-tie-and-htf-windows.md`, K01-K24).
//
// ⭐ `1 / tick` IS the vendor's `pricescale / minmov`, exact in binary for every tick this engine
// serves (0.01: `symbolScope.json::tick_size`, railed in `vendorHarness.sarTickTie.test.js`, which
// goes red the day a served tick's reciprocal is not exact). Of the ticks the committed captures hold
// (0.01, 0.0001, 0.00001, 0.25, 1), only 0.00001 has an inexact reciprocal (99999.99999999999). It
// moves ties only, never a value off a tie (2.8M six-decimal values: 236,783 ties moved, 0 others;
// 1M random doubles: 0 differ from the exact real-number rounding), and no served exchange has it.

/**
 * The raw parse tree of `math.round(x * (1 / syminfo.mintick)) * syminfo.mintick`.
 * `x` is the argument's parse tree, `tok` the call's token (every node is located at the call).
 * `pairedArgs`: the host lane's call arguments are `{ name, value }` pairs; the runtime lane's are bare trees.
 */
export function roundToMintickTree(x, tok, pairedArgs) {
  const tick = { type: 'name', name: 'syminfo.mintick', tok }
  const count = { type: 'binary', op: '*', tok, left: x,
    right: { type: 'binary', op: '/', tok, left: { type: 'number', value: 1, tok }, right: tick } }
  return { type: 'binary', op: '*', tok, right: tick,
    left: { type: 'call', name: 'math.round', tok, args: [pairedArgs ? { name: null, value: count } : count] } }
}
