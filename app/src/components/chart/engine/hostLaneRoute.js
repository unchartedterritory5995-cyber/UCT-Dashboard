// app/src/components/chart/engine/hostLaneRoute.js
//
// ─── ⭐⭐ WHICH THREAD COMPUTES A CHART PANE'S HOST VALUES: LEARNED, PER TAB ─────────────────────────────
//
// docs/pine/evidence/2026-11-19-host-lane-learned-route/EVIDENCE.md. `hostLaneAsync.hostLaneColumns` asks
// this module one question per new request: may the MAIN thread compute these values, or do they go to the
// host worker? The answer is read off what this tab has MEASURED the document cost (`learnCost`), not off its
// trees: two static estimates were measured and neither predicts window work (#1711's recurrence count reads 0
// for Fred RS, which costs 356 ms at 28,800 five-minute rows; a window count is off by three orders of
// magnitude, 2026-11-18 evidence section 3).
//
// ⛔⛔ IT PICKS A THREAD, NEVER A VALUE. Both threads run the same function on the same arguments
// (`astColumns.astColumnsGiven`), so a machine-dependent answer here moves only WHERE the values are computed:
// a slower member machine sends more of them off its own main thread, which is the point. (#1711's "no clock"
// rule governs what changes a value or a lane: `hostLaneCost.hostLaneCostOf(...).over` and the cost route to the
// runtime lane stay deterministic and are not read here except `.over`, which still always means the worker.)
//
// THE MEMORY: per tab (module state), bounded (`HOST_COST_MEMORY` documents, `HOST_COST_SAMPLES` sizes each,
// least recently measured forgotten first), NEVER persisted (no storage of any kind: a reload starts empty).
//
// THE PREDICTION (`predictedMs`), from the samples of the same document on the same timeframe:
//   · at or below a measured size: the cost between the two measured sizes around it, read on the straight line
//     through them (a host pass is a fixed cost plus a per-row cost); below the smallest, the smallest's cost (a
//     shorter series never costs more);
//   · above the largest: the straight line through the two largest, or, with one sample, its cost per row times
//     the rows (a fixed cost spread over more rows: an over-estimate, the safe side), never below the largest;
//   · not measured on this timeframe, but on another: the dearest such prediction, times
//     `HOST_OTHER_TF_MARGIN` (a timeframe's rows need not cost what another's do);
//   · not measured at all: null.
// THE ROUTE (`computesOnMain`): the main thread when the prediction is `HOST_MAIN_BUDGET_MS` or less, or, with
// no prediction, when the rows are a first paint's (`HOST_UNMEASURED_MAIN_ROWS`, where a document is first
// measured: today's path for a first paint, unchanged). Everything else goes to the worker.
//
// ⛔ A LEAF: no imports beyond the two constants it is derived from, so its rails need no chart.
import { LONG_TASK_MS } from './hostLaneCost.js'
import { FIRST_PAINT_MAX } from '../../../utils/barsBackfill.js'

/** ⭐ The most a host values pass may be PREDICTED to cost for the main thread to compute it: a long task
 *  (`hostLaneCost.LONG_TASK_MS`, the W3C threshold the estimate already uses). Derived, never typed. */
export const HOST_MAIN_BUDGET_MS = LONG_TASK_MS
/** ⭐ A document this tab has not measured is computed on the main thread only over this many rows or fewer: a
 *  chart's first paint (`barsBackfill.FIRST_PAINT_MAX`: every first paint is clamped under it), where it is then
 *  measured. Derived, never typed. */
export const HOST_UNMEASURED_MAIN_ROWS = FIRST_PAINT_MAX
/** A prediction read off ANOTHER timeframe's measurements is multiplied by this. */
export const HOST_OTHER_TF_MARGIN = 2
/** How many documents' measurements one tab keeps (the least recently measured is forgotten first). */
export const HOST_COST_MEMORY = 128
/** How many measured sizes one document keeps per timeframe. */
export const HOST_COST_SAMPLES = 4
/** Two sizes within this fraction of each other are one sample (the dearer cost per row kept). */
const SAME_SIZE = 0.1

const _memory = new Map()   // doc key -> Map(tf -> [{rows, ms}] ascending by rows)
let _costClock = null       // test seam: (measuredMs, rows) -> the ms to learn

/** Test seam: what a measurement LEARNS (`(measuredMs, rows) => ms`), so a rail can make every document
 *  cheap or dear whatever the machine; `null` = the measurement itself. */
export function __setHostLaneCostClockForTests(fn) { _costClock = typeof fn === 'function' ? fn : null }

/** Forget every measurement (a test; the page never does: a reload does). */
export function resetHostLaneRoute() { _memory.clear(); _costClock = null }

/** How many documents this tab holds measurements for (diagnostics, and the bound's rail). */
export function hostLaneCostMemorySize() { return _memory.size }

const tfKey = (tf) => (tf === undefined || tf === null ? '' : String(tf))

/** ⭐ Learn what one values pass of document `doc` cost on timeframe `tf` over `rows` rows. */
export function learnCost(doc, tf, rows, measuredMs) {
  if (doc === undefined || doc === null || !(rows > 0) || !Number.isFinite(measuredMs) || measuredMs < 0) return
  const ms = _costClock ? _costClock(measuredMs, rows) : measuredMs
  if (!Number.isFinite(ms) || ms < 0) return
  let per = _memory.get(doc)
  if (per) _memory.delete(doc)
  else per = new Map()
  _memory.set(doc, per)   // the most recently measured, last
  while (_memory.size > HOST_COST_MEMORY) _memory.delete(_memory.keys().next().value)
  const k = tfKey(tf)
  const list = (per.get(k) || []).slice()
  const near = list.findIndex((s) => Math.abs(s.rows - rows) <= SAME_SIZE * Math.max(s.rows, rows))
  if (near >= 0) {
    // one size: the dearer cost per row, at the larger of the two sizes
    const s = list[near]
    const r = Math.max(s.rows, rows)
    list[near] = { rows: r, ms: Math.max(s.ms / s.rows, ms / rows) * r }
  } else {
    list.push({ rows, ms })
  }
  list.sort((a, b) => a.rows - b.rows)
  while (list.length > HOST_COST_SAMPLES) {
    // keep the smallest and the largest; drop the interior size nearest (by ratio) to the size below it
    let drop = 1
    let best = Infinity
    for (let i = 1; i < list.length - 1; i += 1) {
      const ratio = list[i].rows / list[i - 1].rows
      if (ratio < best) { best = ratio; drop = i }
    }
    list.splice(drop, 1)
  }
  per.set(k, list)
}

const line = (a, b, rows) => {
  const slope = Math.max(0, (b.ms - a.ms) / (b.rows - a.rows))
  return a.ms + slope * (rows - a.rows)
}

/** The prediction from one timeframe's samples (ascending by rows), or null. */
function fromSamples(list, rows) {
  if (!list || !list.length) return null
  if (rows <= list[0].rows) return list[0].ms
  for (let i = 1; i < list.length; i += 1) {
    if (rows <= list[i].rows) return Math.max(list[i - 1].ms, line(list[i - 1], list[i], rows))
  }
  const top = list[list.length - 1]
  const out = list.length >= 2 ? line(list[list.length - 2], top, rows) : top.ms * (rows / top.rows)
  return Math.max(top.ms, out)
}

/** ⭐ What this tab predicts one values pass of `doc` costs on `tf` over `rows` rows, in ms, or null. */
export function predictedMs(doc, tf, rows) {
  const per = _memory.get(doc)
  if (!per) return null
  const own = fromSamples(per.get(tfKey(tf)), rows)
  if (own !== null) return own
  let worst = null
  for (const list of per.values()) {
    const p = fromSamples(list, rows)
    if (p !== null && (worst === null || p > worst)) worst = p
  }
  return worst === null ? null : worst * HOST_OTHER_TF_MARGIN
}

/** ⭐⭐ THE ROUTE: may the main thread compute this request's values? (`hostLaneAsync` asks it only for a
 *  document under #1711's estimate and with a worker to send it to.) */
export function computesOnMain(doc, tf, rows) {
  const p = predictedMs(doc, tf, rows)
  return p === null ? rows <= HOST_UNMEASURED_MAIN_ROWS : p <= HOST_MAIN_BUDGET_MS
}
