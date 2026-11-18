// app/src/components/chart/engine/hostLaneCost.js
//
// ─── ⭐⭐ ROUTE BY COST (Engine 73 (#1711)): WHAT A HOST DOCUMENT COSTS THE MAIN THREAD — ONE AUTHORITY ──
//
// docs/pine/evidence/2026-11-17-host-lane-cost/EVIDENCE.md. The host (formula) lane computes a
// member's document SYNCHRONOUSLY, on the page's main thread, inside the chart's paint
// (`StockChart.updateChart` -> `binder.sync` -> `nativeRegistry.computeFor` -> `astLaneColumns`), and
// again for every new bars array (the 600-bar tail, the deep history, each poll that moves the newest
// bar, a symbol or timeframe switch). The runtime lane computes in a Web Worker (`runtimeAsync.js`).
//
// What makes a host document expensive is its RECURRENCES: a Pine `var` (running state) is a bounded
// window, so every bar re-runs the state from its warm-up (`interpret.js::recurrenceStepsPerBar`).
// Measured over the 81 committed scripts a member's door installs on the host lane today (5,000 daily
// bars, node 24): every one with a recurrence costs 82 ms to 23.5 s; every one without costs at most
// 1.1 s and is window work, which the runtime lane does not do cheaper (one runs SLOWER there).
//
// ⛔ NO CLOCK. The decision is a count read off the document's own trees and two constants derived
// from a recorded measurement, so the same document routes the same way on every machine.
import { recurrenceStepsPerBar } from './ast/interpret.js'

/** The bars the estimate is stated over: the newest 5,000, the window the compute-cap evidence and
 *  this measurement use (the server's alert window, `HISTORY_WINDOW_BARS`). */
export const HOST_COST_REFERENCE_BARS = 5000

/** A long task: the W3C Long Tasks threshold, a main-thread task the browser reports as one. */
export const LONG_TASK_MS = 50

/** ⭐ THE CHEAPEST RECURRENCE STEP MEASURED on the host lane, in nanoseconds: `sessions` (committed),
 *  555.7 ms for 6,000 steps a bar over 5,000 bars (node 24, the evidence's table). The cheapest, so
 *  the budget below is the LARGEST honest one: a document is moved only when even at this rate its
 *  recurrences alone would hold the main thread for a long task. (The dearest measured, 1,104 ns,
 *  `pivot-point-supertrend`, would move every recurrence; this one moves only what a long task proves.) */
export const CHEAPEST_MEASURED_STEP_NS = 18.5

/** ⭐ THE BUDGET, in recurrence steps over the reference bars: a long task at the cheapest measured
 *  step, `LONG_TASK_MS / CHEAPEST_MEASURED_STEP_NS` (2,702,702 steps, 540 a bar). DERIVED, never typed:
 *  `hostLaneCost.test.js` holds it to the two numbers it comes from. */
export const HOST_RECURRENCE_STEP_BUDGET = Math.floor((LONG_TASK_MS * 1e6) / CHEAPEST_MEASURED_STEP_NS)

/** The trees a host document computes, as one value: a recurrence two plots share is computed once
 *  (the document's trees share one pass memo, `astColumns.js::crossMemo`), so it is counted once. */
function computedTrees(def) {
  const c = def && def.compute
  if (!c || c.kind !== 'ast') return null
  if (c.trees && typeof c.trees === 'object') {
    const all = Object.values(c.trees).filter((t) => t && typeof t === 'object')
    return all.length ? all : null
  }
  return c.ast && typeof c.ast === 'object' ? [c.ast] : null
}

/**
 * What this host document costs in recurrences, and whether that is over the budget.
 *
 * @param {object} def an `ast` document (anything else is not a host document: `{over: false}`)
 * @returns {{steps: number, stepsPerBar: number, budget: number, over: boolean}}
 */
export function hostLaneCostOf(def) {
  const trees = computedTrees(def)
  if (!trees) return { steps: 0, stepsPerBar: 0, budget: HOST_RECURRENCE_STEP_BUDGET, over: false }
  const root = trees.length === 1 ? trees[0] : { type: 'op', name: '+', args: trees }
  let stepsPerBar
  try {
    stepsPerBar = recurrenceStepsPerBar(root)
  } catch {
    // ⛔ A TREE THE ESTIMATE CANNOT READ STAYS WHERE IT IS: the host lane, today's answer.
    return { steps: 0, stepsPerBar: 0, budget: HOST_RECURRENCE_STEP_BUDGET, over: false, unreadable: true }
  }
  const steps = stepsPerBar * HOST_COST_REFERENCE_BARS
  return { steps, stepsPerBar, budget: HOST_RECURRENCE_STEP_BUDGET, over: steps > HOST_RECURRENCE_STEP_BUDGET }
}
