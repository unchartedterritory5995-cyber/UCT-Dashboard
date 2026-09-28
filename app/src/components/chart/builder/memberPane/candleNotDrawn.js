// app/src/components/chart/builder/memberPane/candleNotDrawn.js
//
// ─── ⛔⛔ H14 (2026-09-28) — A CANDLE THE PANE CANNOT DRAW IS SAID, NOT DRAWN AS LINES ─
//
// `translatePine` expands `plotcandle` / `plotbar` into FOUR rows, one per role
// (`pine.js::MULTI_OUTPUT_CALLS`) — right for a screen, which needs `close > open`
// to have both columns. The host member door then drew every one of those rows
// that was not a bare price passthrough as an ordinary visible LINE. TradingView
// draws a candle; four lines is a picture it never shows, and it ignored a
// `display = cond ? display.all : display.none` on the candle as well. Live on
// production (`VITE_PINE_MEMBER_PANE_ENABLED` is armed on `web`), on two committed
// corpus scripts: `institutional-smc-order-flow-matrix-pro` and
// `smt-divergence-ict-01-tradingfinder-smart-money-technique`.
//
// ⭐ THE RUNTIME LANE'S ANSWER, MIRRORED WORD FOR WORD (owner-delegated,
// "refuse by name"). On `pine/runtime-walls-3`, `runtimeLaneDefinition.js::NOT_DRAWN`
// computes a candle's four values, draws none of them, and writes
// "This script's `plotcandle` (line N) draws candles, which this pane does not
// draw yet." The host door now says exactly that sentence, so a member reads the
// same words whichever engine answered. When the two branches meet, the runtime
// lane's `plotcandle`/`plotbar` entries should read THIS map rather than restate
// it — two copies of one sentence is the drift this file exists to avoid.
//
// ⛔ THE CALLS ARE NOT RETYPED. The set is `MULTI_OUTPUT_CALLS`'s keys, and
// `candleNotDrawn.test.jsx` fails by name if a multi-output call ever arrives
// without a sentence here.
import { MULTI_OUTPUT_CALLS } from '../../engine/ast/pine'

/** What each multi-output drawing call does that this pane does not. */
export const MULTI_OUTPUT_NOT_DRAWN = Object.freeze({
  plotcandle: 'draws candles, which this pane does not draw yet',
  plotbar: 'draws OHLC bars, which this pane does not draw yet',
})

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/** Is this translated output one row of a candle / OHLC bar that the pane would
 *  otherwise draw as a line?
 *
 *  ⚠️ A HIDDEN ROW IS LEFT ALONE, on purpose. A bare price passthrough
 *  (`plotcandle(open, high, low, close)`) and a static `display = display.none`
 *  already reach the door `hidden` and draw nothing — they were never the four
 *  lines, and their behaviour is unchanged. `own` rather than `in`: an output
 *  kind of `constructor` must not read as a candle. */
export function isUndrawnMultiOutput(output) {
  return !!output && typeof output.kind === 'string'
    && own(MULTI_OUTPUT_CALLS, output.kind) && !output.hidden
}

/** The disclosure, in the runtime lane's exact shape: `{ name, note }`. */
export function multiOutputNotDrawnNote(call, line) {
  const what = own(MULTI_OUTPUT_NOT_DRAWN, call) ? MULTI_OUTPUT_NOT_DRAWN[call]
    : 'draws something this pane does not draw yet'
  return {
    name: `\`${call}\``,
    note: `This script's \`${call}\`${Number.isInteger(line) ? ` (line ${line})` : ''} ${what}.`,
  }
}

/** ⭐ One note per candle STATEMENT (its four rows share a line), in source order.
 *  Rows that are not undrawn candle rows are ignored, so a caller may pass the
 *  whole output list or a pre-filtered one. */
export function multiOutputNotDrawnNotes(outputs) {
  const notes = []
  const seen = new Set()
  for (const o of outputs || []) {
    if (!isUndrawnMultiOutput(o)) continue
    const n = multiOutputNotDrawnNote(o.kind, o.line)
    const k = `${n.name} :: ${n.note}`
    if (seen.has(k)) continue
    seen.add(k)
    notes.push(n)
  }
  return notes
}

/** ⛔ The refusal when a candle was everything a script drew. ONE copy, read by the
 *  host member door (`memberPaneDefinition`) and the builder's Import door
 *  (`PineBox`) — H14's second site, 2026-09-28 — so the two cannot drift. */
export function multiOutputOnlyRefusal(notes) {
  return `${(notes || []).map((n) => n.note).join(' ')} It plots nothing else this pane can draw.`
}
