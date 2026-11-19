// app/src/components/chart/builder/runsHere.js
//
// ─── ⭐⭐ ONE AUTHORITY FOR "DOES THIS SCRIPT RUN ON THIS CHART" (2026-11-19) ──────────
//
// The status a pasted script gets (`editorStatus`) is decided BEFORE ANY BAR IS COMPUTED. It says
// "Runs on the chart" for scripts the engine then refuses when it runs them:
//
//   · a value kept since the first bar, on a chart whose history does not reach the listing
//     (`runtime:warmup-never-converges`);
//   · a clock read in a zone the run cannot answer for (`runtime:clock-zone`);
//   · a loop past its limit, the run's time budget, a script's own `runtime.error`;
//   · drawings the run withheld (off the listing), or the host program's drawings with no run.
//
// A member told "Runs" who then gets an empty pane with a notice has been told something false.
// Coordinator's ruling (2026-11-19): the verdict a member sees comes from a REAL RUN on the chart's
// own bars and context, in BOTH doors (the Create Indicator dock and the builder's status panel),
// through ONE function. This is that function.
//
// ⛔ IT ADDS NO JUDGEMENT OF ITS OWN. Every sentence here is the engine's: the same functions, in
// the same order, that the chart's binder asks when it decides what to put on the notice strip
// (`binder.js::noteRuntimeErrorStop`, `nativeRegistry.runtimeObjectsWithheld`). `runsHere.test.js`
// holds the two to each other on real scripts: what this says IS what the chart would say.
//
// ⛔ AND IT NEVER BLOCKS THE CHART. It is a run, so it is asked for after the chart's first paint
// and off the critical path (`runHereWhenLanded`); a run handed to a worker is waited for, never
// repeated on the main thread.

import {
  computeFor, columnErrors, runtimeErrorStopOf, runtimeRunStopOf, runtimeColourStopOf, runtimeObjectsWithheld,
  RUNTIME_ERROR_GUARD,
} from '../engine/nativeRegistry'
import { hostLaneStopOf, isHostLanePending } from '../engine/hostLaneAsync.js'
import { RUNTIME_OBJECTS_KEY, runtimeWarmupOf } from '../engine/runtime/runtimeObjects'
import { onRuntimeColumnsLanded } from '../engine/runtime/runtimeColumns'
import { memberPaneEnabled } from '../engine/memberPaneGate'
import { RUNTIME_FORMING_GUARD } from '../engine/runtimeKill'

export const RUN = Object.freeze({
  /** the engine computed it and named no stop */
  RAN: 'ran',
  /** the engine refused or stopped it on this chart, by name */
  STOPPED: 'stopped',
  /** the run is in a worker; ask again when it lands */
  PENDING: 'pending',
  /** there was nothing to run on (no definition, no bars) */
  NOT_RUN: 'not-run',
})

/** Fewer bars than this is a chart still loading, not a chart to judge a script on. */
export const MIN_BARS = 50

/**
 * ⛔ GUARDS THAT MEAN "THE CHART HAS NOT HANDED THIS RUN WHAT IT READS", NEVER "REFUSED". A script
 * that reads another symbol gets that symbol's bars from the chart once it is on it; a check made
 * beside the chart has none to give. Such an output is reported as `unchecked`, said as that, and
 * never counted as a stop.
 */
export const NEEDS_THE_CHART = Object.freeze(['other-symbol:bare'])

/**
 * ⛔ GUARDS THAT MEAN "THIS CHART'S NEWEST BAR HAS NOT FINISHED", NEVER "THE SCRIPT IS WRONG" (found live
 * 2026-11-19). A script that reads where the chart ends (`barstate.islast` and its like) is admitted for
 * FINISHED bars only (`engine/runtimeKill.js`, G6), so on a live chart it is not drawn all session long and is
 * drawn again once the bar has finished. Counted as a stop, it was sent back for a repair that could not help
 * (the script is what the assistant was told to write) and shown as "does not run ... open it to fix it".
 * Such a run is reported as `waiting`: said as that, never repaired, never a stop.
 */
export const WAITS_FOR_THE_BAR = Object.freeze([RUNTIME_FORMING_GUARD])

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()

const notRun = (why) => ({ state: RUN.NOT_RUN, stops: [], unchecked: [], waiting: [], notes: [], why })

function isPending(def, cols) {
  if (isHostLanePending(cols)) return true
  // a runtime document handed to the worker answers `{}` until its columns land
  if (def.compute && def.compute.kind === 'runtime' && cols && Object.keys(cols).length === 0) {
    return Object.keys(columnErrors(cols) || {}).length === 0
  }
  return false
}

/**
 * Run a script the paste path accepted on a chart's own bars, and say what the engine said.
 *
 * @param {object} pane   `memberPaneDefinition(...)`
 * @param {object} chart
 * @param {Array}  chart.bars  the bars the chart computes on
 * @param {object} chart.ctx   the compute context the chart hands its binder: `{sym, symbol, tf,
 *                             newestBarIsForming, historyFromListing}`
 * @param {Function} [chart.compute]  the engine's `computeFor` (a seam for tests; nothing else passes one)
 * @returns {{state: string, stops: Array<{guard: string, sentence: string}>,
 *            unchecked: Array<{guard: string, sentence: string}>, notes: string[], why?: string}}
 */
export function runHere(pane, { bars, ctx, compute = computeFor } = {}) {
  // ⛔ THE MEMBER-PANE GATE, ASKED FIRST (`engine/memberPaneGate.js`). A build that does not draw a
  // member's script on a chart has no chart to run one on: no run, no verdict from a run. It is also
  // what keeps the runtime lane behind its gate on every path that reaches this module
  // (`engine/__tests__/memberPaneGate.test.js` walks them).
  if (!memberPaneEnabled()) return notRun('this build does not draw member scripts on charts')
  const def = pane && pane.ok === true ? pane.definition : null
  if (!def) return notRun('the chart does not take this script')
  if (!Array.isArray(bars) || bars.length < MIN_BARS) return notRun('the chart has no bars to run it on yet')

  let cols
  try {
    cols = compute(def, bars, undefined, ctx || {})
  } catch (e) {
    return { state: RUN.STOPPED, stops: [{ guard: (e && e.guard) || 'run:threw', sentence: clean((e && e.message) || e) }], unchecked: [], waiting: [], notes: [] }
  }
  if (!cols) return notRun('the run answered nothing')
  if (isPending(def, cols)) return { state: RUN.PENDING, stops: [], unchecked: [], waiting: [], notes: [] }

  const found = []
  const add = (guard, sentence) => {
    const s = clean(sentence)
    if (guard && s && !found.some((f) => f.guard === guard && f.sentence === s)) found.push({ guard, sentence: s })
  }
  // ── the binder's own order (`noteRuntimeErrorStop`) ──
  const own = runtimeErrorStopOf(cols)
  if (own && own.reached) add(RUNTIME_ERROR_GUARD, own.sentence)
  const ran = runtimeRunStopOf(def, cols)
  if (ran) add(ran.guard, ran.sentence)
  const paint = runtimeColourStopOf(def, cols)
  if (paint) add(paint.guard, paint.sentence)
  const worker = hostLaneStopOf(cols)
  if (worker) add(worker.guard, worker.sentence)
  // ── each output's own refusal: on the host lane one line can be refused while the others draw ──
  const errors = columnErrors(cols) || {}
  for (const key of Object.keys(errors)) {
    const e = errors[key]
    if (e && e.guard && !(ran && ran.guard === e.guard)) add(e.guard, e.message)
  }
  // ── its drawings ──
  const hostDrawings = runtimeObjectsWithheld(def, cols)
  if (hostDrawings) add(hostDrawings.guard, hostDrawings.message)
  const run = cols[RUNTIME_OBJECTS_KEY]
  if (run && run.status === 'WITHHELD') add(run.guard || 'runtime:objects-withheld', run.reason)

  const notes = []
  const warm = runtimeWarmupOf(cols)
  if (warm && warm.withheldBars > 0) {
    notes.push(`Its values are drawn from bar ${warm.withheldBars + 1} on: before that they depend on where this chart's history starts.`)
  }
  if (run && run.status === 'ok' && run.withheldCounts && Object.keys(run.withheldCounts).length) {
    notes.push('Some of its drawings are withheld on this chart.')
  }

  const unchecked = found.filter((f) => NEEDS_THE_CHART.includes(f.guard))
  const waiting = found.filter((f) => WAITS_FOR_THE_BAR.includes(f.guard))
  const stops = found.filter((f) => !NEEDS_THE_CHART.includes(f.guard) && !WAITS_FOR_THE_BAR.includes(f.guard))
  return { state: stops.length ? RUN.STOPPED : RUN.RAN, stops, unchecked, waiting, notes }
}

/**
 * `runHere`, waited for: a run handed to a worker is asked again when its columns land, up to
 * `timeoutMs`. Never repeats a run on the main thread. A run that has not landed in time is
 * returned as PENDING, which a caller must show as "still being checked", never as "runs".
 *
 * @param {object} pane
 * @param {object} chart       `{bars, ctx}`
 * @param {object} [opts]      `{timeoutMs, onLanded}` (`onLanded` is the engine's subscription; a seam for tests)
 * @returns {Promise<ReturnType<typeof runHere>>}
 */
export function runHereWhenLanded(pane, chart, { timeoutMs = 8000, onLanded = onRuntimeColumnsLanded } = {}) {
  const first = runHere(pane, chart)
  if (first.state !== RUN.PENDING) return Promise.resolve(first)
  return new Promise((resolve) => {
    let done = false
    let off = () => {}
    const finish = (value) => {
      if (done) return
      done = true
      try { off() } catch { /* a listener that will not go is not this caller's failure */ }
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => finish(first), Math.max(0, timeoutMs))
    off = onLanded(() => {
      const again = runHere(pane, chart)
      if (again.state !== RUN.PENDING) finish(again)
    })
  })
}

/**
 * A paste verdict (`scriptAnswer.verdictFrom`) joined with a real run. The run can only take
 * "runs" AWAY: a script the paste path refused is not rescued by it.
 *   STOPPED   -> not "runs"; the engine's stop sentences lead the reasons and go back for repair
 *   PENDING   -> not "runs" yet; said as being checked
 *   NOT_RUN   -> the paste verdict, marked as not checked on a chart
 *   RAN       -> the paste verdict, with the run's notes after its own
 */
export const STOPPED_HEADLINE = 'It does not run on this chart'
export const CHECKING_HEADLINE = 'Still being checked on this chart'
export const WAITING_HEADLINE = 'Draws once this bar has finished'
/** What a member reads under that headline (the engine's own sentence follows it). */
export const WAITING_LINE = "This script draws on the chart's last bar, and that is only drawn on a finished bar. "
  + 'On a live chart it appears when the bar closes; nothing is wrong with the script.'

export function verdictOnChart(verdict, run, { maxErrors = 6, maxChars = 300 } = {}) {
  if (!verdict || !run) return verdict
  const base = { ...verdict, ranHere: run.state }
  if (!verdict.runs) return base
  if (run.state === RUN.STOPPED) {
    const sentences = run.stops.map((s) => s.sentence)
    return {
      ...base, runs: false, headline: STOPPED_HEADLINE,
      withheld: [...sentences, ...verdict.withheld],
      errors: [...new Set(sentences)].slice(0, maxErrors).map((e) => e.slice(0, maxChars)),
    }
  }
  // (`checking`: nothing is wrong with the script and nothing is known yet. The script answer asks again a
  // bounded number of times, and the button beside it never says "to fix it": `authoring/scriptAnswer.js`)
  if (run.state === RUN.PENDING) return { ...base, runs: false, checking: true, headline: CHECKING_HEADLINE, errors: [] }
  if (run.state === RUN.RAN) {
    const unchecked = run.unchecked.map((u) => `Not checked here (${u.guard}): it is checked when the script is on the chart.`)
    const waiting = run.waiting || []
    if (waiting.length) {
      // ⛔ still "runs" (no repair is asked for: there is nothing to repair), under a headline that says what
      // the member will see, with the engine's own sentence kept
      return {
        ...base, headline: WAITING_HEADLINE, waits: true,
        notes: [WAITING_LINE, ...[...new Set(waiting.map((w) => w.sentence))], ...verdict.notes, ...run.notes, ...unchecked],
      }
    }
    return { ...base, notes: [...verdict.notes, ...run.notes, ...unchecked] }
  }
  return base
}
