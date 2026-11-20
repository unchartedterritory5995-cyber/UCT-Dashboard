// app/src/components/chart/engine/runtime/overnightTail.js
//
// ─── ⭐⭐ THE OVERNIGHT TAIL (coordinator ruling 2026-11-20, (ii) + (iii)) ──────────────────────────────────────────
//
// ⚰️ MEASURED on production e87 (2026-11-20, 02:17Z, Fred RS on NYSE:RDDT, smoke@): the 30m chart's newest bar was
// 21:00 ET and the 5m chart's 21:15 ET. These are OVERNIGHT bars the chart builds in the browser from live overnight
// trades: the stored series has none, `/api/bars/RDDT?tf=5` ends at 19:55 ET, with 0 of 202 days holding a bar
// outside 04:00-20:00. Our SP:SPX supply ended at 19:30 / 19:55 ET. The run REFUSED the whole chart on 5m and 30m
// (`runtime:request-lag`) and waited on 1h, saying SPX's newest bars "have not arrived ... until they arrive". They
// do not arrive: SP:SPX has no overnight session, and TradingView's chart shows no bar after 20:00 ET at all. Every
// evening and weekend the member's 5m / 30m panes were blank.
//
// THE RULE: where every bar the chart holds past a requested series' last bar is an OVERNIGHT bar (outside the
// 04:00-20:00 ET session TradingView shows a US listing in, or on a day the exchange is closed: `sessionAt` 'closed'),
// the run is CUT at the first of them. Everything before draws exactly as it did; the overnight bars are withheld BY
// NAME (`REQUEST_OVERNIGHT_GUARD`, `overnightSentence`).
// ⛔ It is NOT #2076's tail lag: a bar inside 04:00-20:00 that the series lacks is a bar due inside its session, which
//    keeps the wait / lag rule (`requestSupply.js`). A tail that mixes the two keeps the wait / lag rule as well.
// ⛔ Nothing is carried onto the overnight bars: TradingView has no picture there for anyone to check.

import { sessionAt } from '../../../../lib/marketClock/sessionCalendar.js'

/** The code the overnight tail is withheld under (and a supply's cut carries). */
export const REQUEST_OVERNIGHT_GUARD = 'runtime:request-overnight'

/** Where the overnight-tail record rides on a column map (non-enumerable, like every record here). */
export const RUNTIME_OVERNIGHT_KEY = '__runtimeOvernightTail'

/** Is a chart bar opening at `t` (unix seconds) an overnight bar: outside 04:00-20:00 ET, or on a closed day? A
 *  bar whose session cannot be read is NOT overnight (the wait / lag rule keeps it). */
export function overnightBar(t) {
  if (typeof t !== 'number' || !Number.isFinite(t)) return false
  try {
    return sessionAt(t * 1000) === 'closed'
  } catch {
    return false
  }
}

/** The first index of the chart's tail past `lastHeld` when EVERY bar of that tail is an overnight bar, else 0 (no tail,
 *  a tail with any in-session bar, or a chart that is all tail). */
export function overnightTailFrom(rows, lastHeld) {
  const n = Array.isArray(rows) ? rows.length : 0
  if (!n || typeof lastHeld !== 'number') return 0
  let from = n
  while (from > 0 && rows[from - 1] && typeof rows[from - 1].t === 'number' && rows[from - 1].t > lastHeld) from -= 1
  if (from >= n || from < 1) return 0
  for (let i = from; i < n; i += 1) if (!overnightBar(rows[i].t)) return 0
  return from
}

/** The member's sentence for an overnight tail, naming the series the script reads. */
export function overnightSentence(series) {
  const names = [...new Set((Array.isArray(series) ? series : [series]).filter(Boolean))].map((s) => `\`${s}\``)
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || 'another symbol'
  return `The newest bars are overnight trading, which ${who} ${names.length > 1 ? "don't" : "doesn't"} have and `
    + "TradingView's chart doesn't show, so this script isn't drawn on them."
}

/** The overnight-tail record a column map carries (`{from, bars, series, rows}`), or null. */
export function runtimeOvernightOf(columns) {
  const r = columns && typeof columns === 'object' ? columns[RUNTIME_OVERNIGHT_KEY] : null
  return r && typeof r === 'object' ? r : null
}

/**
 * The run over `rows.slice(0, from)`, as the chart reads it: every column widened to `n` with `NaN` on the overnight
 * bars, every record kept (a drawing's bar indices are unchanged: the run starts where the chart does), and the
 * overnight record added for the strip (`astColumns.js::chartClockReport`).
 */
export function withOvernightTail(cols, n, from, series) {
  const out = {}
  for (const [k, col] of Object.entries(cols || {})) {
    if (!col || typeof col.length !== 'number') { out[k] = col; continue }
    const padded = new Array(n)
    for (let i = 0; i < n; i += 1) padded[i] = i < col.length ? col[i] : NaN
    out[k] = padded
  }
  for (const key of Object.getOwnPropertyNames(cols || {})) {
    if (Object.hasOwn(out, key)) continue
    Object.defineProperty(out, key, { value: cols[key], enumerable: false, configurable: true })
  }
  const names = [...new Set((series || []).filter(Boolean))]
  Object.defineProperty(out, RUNTIME_OVERNIGHT_KEY, {
    value: Object.freeze({ from, bars: n - from, series: Object.freeze(names),
      rows: Object.freeze([Object.freeze({ code: REQUEST_OVERNIGHT_GUARD, reason: overnightSentence(names) })]) }),
    enumerable: false, configurable: true,
  })
  return out
}
