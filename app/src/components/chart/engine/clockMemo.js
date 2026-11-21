// app/src/components/chart/engine/clockMemo.js
//
// ⭐ PERF (Fred RS filled chart, C4, coordinator ruling 2026-11-19) — THE CLOCK, ONCE PER BARS.
//
// Every tree that reads a clock name computes all thirteen clock columns (`indicators.js::computeClock`) over its
// bars, so a run whose columns read the clock five times computed it five times (Fred RS's run half: ~39 ms a run on
// 11,520 5m bars, its `Intl` session maths included). `computeClock` reads the bars' `t` and count alone
// (`barOpenInstants`), the timeframe and the forming tri-state, so its columns are kept here per bars ARRAY and per
// those two, with the times they came from: a bars array whose times are not those any more is computed again. Each
// caller is handed its OWN copy, so nothing one caller does to a column can reach another's. Exact by construction.
//
// ⛔ OUTSIDE THE INTERPRETER, ON PURPOSE. `ast/interpret.js` is pure arithmetic (its AST rail, `interpret.test.js` "the
// interpreter is PURE": no globals, no state), so the memo is not in it: a caller hands `clockColumnsOf` in as
// `opts.clockOf`, and the interpreter calls it with ITS OWN bars, timeframe and tri-state (absent, it calls
// `computeClock` itself). A function and not a precomputed array, because the runtime lane's recorder replays a
// column's options over NEW bars (`runtime/runtimeColumns.js::columnsOver`): an array handed in would be the old
// bars' clock there, and this is asked for the bars it is handed.
import { computeClock } from '../indicators.js'

const _clockMemo = new WeakMap()
let _clockMemoOff = false
/** Tests: compute the clock on every ask, as before (the identity rails compare both). */
export function __clockMemoOffForTests(off) { _clockMemoOff = !!off }
const copyClock = (cols) => {
  const out = {}
  for (const k of Object.keys(cols)) out[k] = Float64Array.from(cols[k])
  return out
}
/** `computeClock(bars, tf, forming)`, computed once per bars array, timeframe and tri-state; a fresh copy each ask. */
export function clockColumnsOf(bars, tf, forming) {
  if (_clockMemoOff || !Array.isArray(bars)) return computeClock(bars, tf, forming)
  let byKey = _clockMemo.get(bars)
  if (!byKey) { byKey = new Map(); _clockMemo.set(bars, byKey) }
  const key = `${typeof tf}:${tf}|${typeof forming}:${forming}`
  const hit = byKey.get(key)
  if (hit && hit.ts.length === bars.length && hit.ts.every((t, i) => Object.is(t, bars[i] ? bars[i].t : undefined))) {
    return copyClock(hit.cols)
  }
  const cols = computeClock(bars, tf, forming)
  byKey.set(key, { ts: bars.map((b) => (b ? b.t : undefined)), cols: copyClock(cols) })
  return cols
}
