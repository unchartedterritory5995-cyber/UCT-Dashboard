// app/src/components/chart/engine/runtime/__tests__/condHistoryOutcome.js
//
// ⭐ HIST-S3 (Engine 64 (#1450)) — WHAT HAPPENS TO A CONDITIONAL-HISTORY SHAPE, BUILD AND RUN TOGETHER.
//
// Before HIST-S3 a call written in a block or a `?:` arm that this lane does not step per call site
// was refused at BUILD (`runtime:conditional-history`). Now most such regions are lowered as on
// every bar and CHECKED as they run: the first run after a skipped bar STOPS the run by the same
// guard (`collections.js` `callSiteRuns`). A rail that pinned "never drawn off every bar" therefore
// asks both halves: the guard the build refused with, else the guard the run stopped with, else
// null (the run finished: every bar was drawn). Shared by the conditional-history rails so the
// question is asked one way.
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
// ⛔ the tri-state producer rides every build (`pineRuntimeFrontendGate.test.js`): these runs are over
// finished bars, so the newest bar is stated FINISHED (`false`), never left unknown
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

/** `{guard, message, at}`: the build's refusal (`at: 'build'`), else the run's stop (`at: 'run'`),
 *  else null (built and ran to the end). */
export function runRefusalOf(src, { bars, inputs = {}, extra = {}, listing = true } = {}) {
  const b = buildRuntimeIr(src, { bars, inputs, ...runtimeClockOpts(false), ...extra })
  if (!b.ok) return { guard: b.refusal && b.refusal.guard, message: String((b.refusal && b.refusal.message) || ''), at: 'build' }
  const program = lowerIrProgram(b.ir, { historyFromListing: listing })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((x) => (x[k] == null ? 0 : x[k]))))
  try {
    execute(program, { bars: bars.length, series, columns: program.columns, confirmed: true })
    return null
  } catch (e) {
    return { guard: e && e.guard ? e.guard : `threw:${e && e.message}`, message: String((e && e.message) || ''), at: 'run' }
  }
}

/** The build's refusal guard, else the run's stop guard, else null (built and ran to the end). */
export function runGuardOf(src, opts = {}) {
  const r = runRefusalOf(src, opts)
  return r ? r.guard : null
}

