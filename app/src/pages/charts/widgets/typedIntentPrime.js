// app/src/pages/charts/widgets/typedIntentPrime.js — a typed ticker's device reads, started when the typed text settles.
//
// ⭐ (2026-11-23, the typed ticker; owner's bar: under 40 ms from key press to pixels for every stock) A ticker picked in
// a list paints in the key task: the list's own warms have already read its rows from the on-device store, so the
// press's device read (handoffGroups.primeGroup, called by the board's setGroupSym) lands synchronously from the device
// client's recently-read cache, every linked chart can show it now, and the group takes ONE render (the decision). A
// TYPED ticker's device read started only in the Enter task, landed after it, and the linked group took the round: a
// second render after the worker's answer (measured: Enter to both charts drawn ~20 ms slower than a list jump, with
// the bars already on the device).
// So when the typed text SETTLES (SymbolSearch TYPED_INTENT_SETTLE_MS: the moment the chart's own typed warm already
// runs, never per keystroke), the chart's host starts the SAME reads now: primeGroup for this chart's board and colour,
// i.e. every chart of the linked group, each on the key its own switch reads, each latest-only (useSymbolHandoff's
// member prime). By Enter the copies are in the store and the client's cache, and Enter can show the typed ticker in its
// own task, exactly as a list pick does.
// ⛔ IT DECIDES NOTHING AND SHOWS NOTHING: no decision, no group symbol, no settle-clock request, no network (device
// reads only: with the device store off the member prime does nothing). What Enter selects is unchanged.
import { chartGroupKey, primeGroup } from '../../../hooks/handoffGroups'

/** Start the linked group's device reads for `sym` (the settled typed text) on board `scope` (its groupSymsStore),
 *  colour `color` (ChartWidget's active colour). No board, colour or symbol: nothing. Never throws. */
export function primeTypedIntent(scope, color, sym) {
  if (!scope || !color || !sym) return
  try { primeGroup(scope, chartGroupKey(color), String(sym)) } catch { /* a warm only */ }
}
