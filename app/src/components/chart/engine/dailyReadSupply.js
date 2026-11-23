// app/src/components/chart/engine/dailyReadSupply.js
//
// ─── ⭐⭐ U-DAILY (e96, part A) — THE DAILY BARS A DAILY READ IS COMPUTED ON ─────────────────────────────────────
//
// A formula that reads `tf(x, 'D')` on a chart below a day computes `x` on the symbol's DAILY bars and shows, on each
// chart bar, THE LAST FINISHED DAY (`ast/interpret.js::interpretDailyReads`). This module is the chart's half:
//   · which (frame, symbol) windows such a document needs (`dailyReadNeeds`, asked by `useCalcFrames`): the chart
//     symbol's own daily bars, and each other symbol a daily read's child names (`tf(sym('SPY', close), 'D')`);
//   · the supply handed to the interpreter (`dailyReadSupplyFor`, asked by the binder): those bars, whether the newest
//     one is proven finished, and `place`, which is the chart's own projection (`mtfProjection.projectFrameColumns`,
//     the ONE rule over which daily value a chart bar shows; a whole indicator calculated on daily bars is placed by
//     the same call). The interpreter imports none of this: it is handed `place`, so it stays pure.
// ⛔ NOT A SECOND BARS SYSTEM: the windows are `useCalcFrames`' (the `secondaryBars` cache, one fetch per symbol and
// frame for the whole chart), keyed by `frameKey('D', symbol)`.
// ⛔ PENDING IS NOT A REFUSAL: until the chart symbol's daily bars are in hand the document is not computable yet (the
// binder skips it, exactly as an instance calculated on daily bars waits for its frame); an OTHER symbol's daily bars
// not in hand are simply not handed, and the reads of them are withheld by name there.

import { treeReadsDaily, dailyReadSymbols, isBelowADay } from './ast/interpret'
import { projectFrameColumns, frameKey, frameBarsUsable } from './mtfProjection'
import { SOURCE_STATUS } from './secondaryBars'

/** Every tree a stored formula document holds: its one tree, or its per-plot trees. */
function treesOf(def) {
  const c = def && def.compute
  if (!c || typeof c !== 'object') return []
  const out = []
  if (c.ast && typeof c.ast === 'object') out.push(c.ast)
  if (c.trees && typeof c.trees === 'object') for (const k of Object.keys(c.trees)) out.push(c.trees[k])
  return out
}

/** Does this document read a daily value (`tf` of D) in any of its trees? */
export function defReadsDaily(def) {
  return treesOf(def).some((t) => treeReadsDaily(t))
}

/** The symbols whose DAILY bars this document's daily reads need on `sym`'s chart: the chart symbol first, then every
 *  other symbol a daily read's child names. `[]` when it reads none. */
export function dailyReadNeeds(def, sym) {
  if (!sym || !defReadsDaily(def)) return []
  const out = [String(sym).toUpperCase()]
  for (const t of treesOf(def)) for (const s of dailyReadSymbols(t)) if (!out.includes(s)) out.push(s)
  return out
}

let _serial = 1
const _serials = new WeakMap()
const serialOf = (bars) => {
  if (!bars || typeof bars !== 'object') return 0
  let s = _serials.get(bars)
  if (!s) { s = _serial++; _serials.set(bars, s) }
  return s
}

const usableEntry = (entry) => !!entry && entry.status === SOURCE_STATUS.AVAILABLE && Array.isArray(entry.bars)
  && entry.bars.length > 0 && frameBarsUsable(entry.bars, 'D')

/**
 * The supply a daily read is computed with on this chart, or null when the document reads none (or the chart is not
 * below a day, where the interpreter refuses the read by name).
 * @returns {null | {pending: true} | {frame: {bars, symbols, newestFinal, place, stale}, sig: string}}
 *   `frame.stale` turns true when the projection found the chart showing a day the daily bars do not know has finished
 *   (the binder asks for a refresh, as it does for a calculated frame).
 */
export function dailyReadSupplyFor(def, frames, sym, chartTf) {
  if (!isBelowADay(chartTf)) return null
  const needs = dailyReadNeeds(def, sym)
  if (!needs.length) return null
  const map = frames && typeof frames.get === 'function' ? frames : null
  const own = map ? map.get(frameKey('D', needs[0])) : null
  if (!usableEntry(own)) return { pending: true }
  const symbols = {}
  const parts = [`${needs[0]}#${serialOf(own.bars)}`]
  for (const s of needs.slice(1)) {
    const e = map.get(frameKey('D', s))
    if (usableEntry(e)) { symbols[s] = e.bars; parts.push(`${s}#${serialOf(e.bars)}`) }
  }
  const newestFinal = own.newestBarIsForming === false
  const frame = {
    bars: own.bars,
    symbols,
    newestFinal,
    stale: false,
    place(column, chartBars, tf) {
      const p = projectFrameColumns(own.bars, { v: column }, 'D', chartBars, tf, { newestFinal })
      if (p.stale) frame.stale = true
      return p.columns.v
    },
  }
  return { frame, sig: `${parts.join(',')}:${newestFinal ? 'f' : '?'}` }
}
