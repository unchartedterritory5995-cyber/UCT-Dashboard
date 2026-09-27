// app/src/components/chart/engine/pineRuntimeLane.js
//
// ─── ⭐⭐ THE RUNTIME LANE'S ONE DOOR TO A MEMBER (2026-09-27, flag-gated) ─────
//
// Until today the runtime lane — `ast/pineRuntimeFrontend.js::buildRuntimeIr` →
// `runtime/lowerIr.js::lowerIrProgram` → `runtime/vm.js::execute` — had ZERO live
// importers, by ruling D2: the member pane draws the HOST lane's saved
// definition. The owner's goal of 2026-09-27 ("fully import every and any
// TradingView Pine script indicator so it shows on UCT charts exactly as on
// TradingView") supersedes that for ONE path:
//
//     the host lane REFUSES a script at the member door with a guard that names
//     a limit of its own single-expression value model (`var` state, `:=`, a
//     block as a value, …) → the door tries this lane → if it builds, the pane
//     draws the runtime lane's values through the SAME definition document,
//     binder and renderer the host lane uses.
//
// ⛔⛔ THE HOST LANE STAYS AUTHORITATIVE WHENEVER IT SUCCEEDS. This module is only
// ever asked about a script the host lane refused; it never replaces a working
// host translation (`memberPaneDefinition.js` holds that order, and a rail holds
// it there).
//
// ⛔⛔ AND THIS IS THE ONLY LIVE MODULE THAT IMPORTS THE LANE. Two callers reach
// it — the door (`builder/memberPane/runtimeLaneDefinition.js`) and the compute
// dispatch (`nativeRegistry.computeFor`, kind `'pine'`) — and both are behind
// `VITE_PINE_RUNTIME_LANE_ENABLED` (`pineRuntimeLaneGate.js`), which this module
// ALSO reads, so a stubbed or forgotten caller-side check still fails closed.
// `__tests__/pineRuntimeFrontendGate.test.js` is the rail on both facts.
//
// ⭐⭐ WHAT A SAVED RUNTIME-LANE DOCUMENT IS: THE SOURCE, RECOMPILED.
// A host document stores canonical TREES because the tree is the maths (D-A1).
// The runtime lane has no such artifact: its program is compiled against the
// bars (pure sub-expressions become columns at build time) and the member's
// input values (a length sizes a ring before bar 0). So the document stores the
// member's Pine (`compute.source`) and which runtime OUTPUT each plot key reads
// (`compute.columns`), and `runtimeLaneColumns` rebuilds the program for every
// (bars, inputs, timeframe, symbol, clock) it is asked about — the same thing
// TradingView does when an input changes. Built with `inputsReachEveryFold`, so
// a member's value reaches EVERY fold (window lengths and history offsets
// included) rather than only the columns — the half-applied knob the frozen
// resolver would otherwise produce.

import { buildRuntimeIr } from './ast/pineRuntimeFrontend'
// ⛔ REQUIRED BY `pineRuntimeFrontendGate.test.js`: a live importer of the
// runtime front end must also build the clock tri-state, or the four
// CLOCK_REALTIME columns render blank with nothing red anywhere.
import { runtimeClockOpts, newestBarIsFormingFrom } from './ast/pineRuntimeClock'
import { lowerIrProgram } from './runtime/lowerIr'
import { execute } from './runtime/vm'
import { pineRuntimeLaneEnabled } from './pineRuntimeLaneGate'

/** The compute kind a runtime-lane document declares (`defSchema.COMPUTE_KINDS`). */
export const RUNTIME_LANE_KIND = 'pine'

/** ⭐⭐ THE HOST REFUSALS THE RUNTIME LANE IS BUILT TO SERVE — and only those.
 *
 *  Each is a limit of the host lane's VALUE MODEL (one canonical expression per
 *  column), which the runtime lane's bytecode answers by design: persistent
 *  slots, reassignment, blocks and loops as statements, arrays, tuples, records,
 *  user functions with frames, per-bar memory, history rings. `runtimeLaneGuards
 *  .test.js` proves every member with a script the host refuses by exactly that
 *  guard and this lane builds — a member with no such proof is not in the set.
 *
 *  ⛔⛔ NEVER A VOCABULARY OR RULING GUARD. `pine:function`, `pine:builtin`,
 *  `pine:arity`, `pine:role-order`, `pine:window`, `pine:input-kind`,
 *  `pine:request`, `pine:text-value`, … each record that nobody has RULED what a
 *  name means here. The runtime lane reuses the host resolver for pure
 *  sub-expressions, so it usually refuses the same name again — but where it has
 *  a path of its own, falling back would route AROUND a ruling. Measured
 *  2026-09-27: `support-and-resistance__UgNPprOr8h` (host `pine:role-order`)
 *  BUILDS in this lane; it is refused anyway, and the rail pins that. */
//
//  ⚠️ MEASURED OUT, 2026-09-27: `pine:tuple` and `pine:na` read like value-model
//  limits and are NOT in the set, because no fixture exists where the host refuses
//  them and this lane builds — `[k, d] = ta.stoch(…)` refuses here too
//  (`runtime:tuple`), and `fixnan` refuses in both lanes (`pine:na`). A member
//  earns a place by a script the lane actually serves, never by its sentence.
export const RUNTIME_FALLBACK_GUARDS = Object.freeze(new Set([
  'pine:state',
  'pine:reassign',
  'pine:block',
  'pine:collection',
  'pine:type',
  'pine:function-def',
]))

/** Is this host refusal one the runtime lane may answer instead? */
export function isRuntimeFallbackGuard(guard) {
  return typeof guard === 'string' && RUNTIME_FALLBACK_GUARDS.has(guard)
}

/** The output calls a pane draws as a row. `hline`, `bgcolor`, `barcolor`,
 *  `plotarrow` and `alertcondition` are outputs of this lane that the member
 *  pane does not draw (the door says so, by name). */
export const RUNTIME_DRAWN_CALLS = Object.freeze(new Set(['plot', 'plotshape', 'plotchar']))

/** The build options the door and the compute share. ⛔ ONE OBJECT, because the
 *  output indices a document saves are only meaningful for the options they
 *  were minted under — `plotColours` inserts outputs. */
function laneOpts(plotColours, ownsDrawing) {
  return {
    plotColours: plotColours === true,
    inputsReachEveryFold: true,
    collectInputs: true,
    ...(ownsDrawing ? { objectTrees: [] } : {}),
  }
}

/** A refusal in the one shape both lanes use, tagged as this door's. */
const refusal = (guard, message, line = null) => ({ guard, message, line })

/**
 * ⭐ THE DOOR-TIME BUILD — does this script compile in the runtime lane at all?
 *
 * No bars, no symbol, the clock told `false` (settled), every input at the
 * author's default — the same fixture `PARITY-PROGRAMME.md` §3 measured the
 * lane's walls with. A script that builds here is rebuilt per chart by
 * `runtimeLaneColumns`; one that only builds with a particular symbol is
 * refused here by the name its own build gave, never guessed.
 *
 * ⭐ THE COLOUR CHANNEL IS TRIED FIRST AND DROPPED, NOT FATAL. A plot's colour
 * is presentation; the value is the indicator. If lowering the colours is the
 * only thing that fails, the program builds without them and the door reports
 * every dynamic colour as not carried.
 *
 * @param {string} source
 * @param {{ownsDrawing?: boolean}} [opts] `ownsDrawing` — the caller carries the
 *   host object pass's program for this script (with its losses accounted), so
 *   the lane may treat drawing calls as the object program's.
 * @returns {{ok: true, plotColours: boolean, outputs: object[], inputParams: object[],
 *            requests: number, persistent: number}
 *          |{ok: false, refusal: {guard: string, message: string, line: number|null}}}
 */
export function runtimeLaneBuild(source, { ownsDrawing = false } = {}) {
  if (!pineRuntimeLaneEnabled()) {
    return { ok: false, refusal: refusal('runtime-door:off', 'the runtime lane is off on this build') }
  }
  const attempt = (plotColours) => {
    try {
      return buildRuntimeIr(source, {
        ...runtimeClockOpts(false), inputs: {}, ...laneOpts(plotColours, ownsDrawing),
      })
    } catch (err) {
      return { ok: false, refusal: refusal('runtime-door:threw', String((err && err.message) || err)) }
    }
  }
  let plotColours = true
  let built = attempt(true)
  if (!built.ok) {
    const plain = attempt(false)
    if (!plain.ok) return { ok: false, refusal: plain.refusal }
    built = plain
    plotColours = false
  }
  let program
  try {
    program = lowerIrProgram(built.ir)
  } catch (err) {
    return { ok: false, refusal: refusal('runtime-door:lower', String((err && err.message) || err)) }
  }
  return {
    ok: true,
    plotColours,
    outputs: program.outputs.map((o) => ({ ...o })),
    inputParams: built.inputParams || [],
    // ⛔ COUNTED FOR THE DOOR TO REFUSE ON: a `request.security` answers `na`
    // with no second-symbol bars, and a chart of `na` reads as a quiet market.
    requests: (built.ir.requests || []).length,
    persistent: (built.ir.slots || []).filter((s) => s && s.kind === 'persist').length,
  }
}

// ─── compute ───────────────────────────────────────────────────────────────────

/** Bars array → Map(runKey → result). ⛔ Keyed by the bars' IDENTITY, so a new
 *  fetch can never be served an old run; bounded per array. */
const RUNS = new WeakMap()
const RUNS_PER_BARS = 8

/** A bool knob reaches the runtime as the number Pine folds it to. */
function runtimeValue(v) {
  if (v === true) return 1
  if (v === false) return 0
  return v
}

/** The member's values for the runtime's own input names, from the document's
 *  `compute.inputs` map (document key → Pine name). */
function runtimeInputsOf(compute, inputs) {
  const out = {}
  const map = (compute && compute.inputs) || {}
  for (const [key, pineName] of Object.entries(map)) {
    if (inputs && Object.prototype.hasOwnProperty.call(inputs, key) && inputs[key] !== undefined) {
      out[pineName] = runtimeValue(inputs[key])
    }
  }
  return out
}

/** One run of a runtime-lane document's program over one chart's bars. */
function runOnce(compute, bars, runtimeInputs, ctx) {
  const forming = newestBarIsFormingFrom(ctx || null)
  const built = buildRuntimeIr(compute.source, {
    bars,
    inputs: runtimeInputs,
    tf: ctx && ctx.tf,
    symbol: ctx && ctx.symbol,
    ...runtimeClockOpts(forming),
    ...laneOpts(compute.lane && compute.lane.plotColours, compute.lane && compute.lane.ownsDrawing),
  })
  if (!built.ok) {
    const r = built.refusal || {}
    return { ok: false, error: { guard: r.guard || 'runtime:refused',
      message: `${String(r.message || 'the runtime lane refused this script')}`
        + (Number.isInteger(r.line) ? ` (line ${r.line})` : '') } }
  }
  const program = lowerIrProgram(built.ir)
  const n = bars.length
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => {
    const s = new Float64Array(n)
    for (let i = 0; i < n; i += 1) {
      const v = bars[i] ? Number(bars[i][k]) : NaN
      s[i] = Number.isFinite(v) ? v : NaN
    }
    return s
  })
  const res = execute(program, {
    bars: n,
    series,
    columns: program.columns,
    // ⛔ A FORMING newest bar is not confirmed; unknown is treated as settled
    // only where the clock gate above has already refused every realtime read.
    confirmed: forming !== true,
    // ⛔ UNIX SECONDS OR `na`. A daily bar's ISO date is not an instant, and the
    // VM answers `na` for it rather than a guessed midnight (`etClockAt`).
    barTimes: bars.map((b) => (b && Number.isFinite(b.t) ? b.t : NaN)),
  })
  return { ok: true, program, outputs: res.outputs }
}

/**
 * ⭐⭐ A RUNTIME-LANE DOCUMENT'S COLUMNS — what `computeFor` returns for kind
 * `'pine'`.
 *
 * ⛔ EVERY FAILURE IS A NAMED COLUMN ERROR, NEVER A THROW AND NEVER A BLANK
 * THAT LOOKS LIKE DATA. A refused rebuild, a program whose outputs no longer
 * sit where the document says (`runtime-door:shape` — the saved source and the
 * saved map disagree), or a run that hit a limit: every key the document
 * declares is reported with the reason, and no column is returned for it.
 *
 * @returns {{columns: Object<string, Float64Array>, errors: Object<string, {guard, message}>}}
 */
export function runtimeLaneColumns(def, bars, inputs, ctx) {
  const compute = (def && def.compute) || {}
  const specs = compute.columns || {}
  const keys = Object.keys(specs)
  const columns = {}
  const errors = {}
  const failAll = (e) => { for (const k of keys) errors[k] = e; return { columns, errors } }
  if (!pineRuntimeLaneEnabled()) {
    return failAll({ guard: 'runtime-door:off',
      message: 'this definition runs in the runtime lane, which is off on this build' })
  }
  if (typeof compute.source !== 'string' || !compute.source.trim()) {
    return failAll({ guard: 'runtime-door:no-source', message: 'the definition carries no script' })
  }
  const list = Array.isArray(bars) ? bars : []
  const runtimeInputs = runtimeInputsOf(compute, inputs)
  const runKey = JSON.stringify([compute.fn, runtimeInputs, ctx && ctx.tf, ctx && ctx.symbol,
    newestBarIsFormingFrom(ctx || null)])
  let byBars = RUNS.get(list)
  if (!byBars) { byBars = new Map(); RUNS.set(list, byBars) }
  let run = byBars.get(runKey)
  if (!run) {
    try {
      run = runOnce(compute, list, runtimeInputs, ctx)
    } catch (err) {
      run = { ok: false, error: { guard: 'runtime-door:run',
        message: String((err && err.message) || err) } }
    }
    if (byBars.size >= RUNS_PER_BARS) byBars.delete(byBars.keys().next().value)
    byBars.set(runKey, run)
  }
  if (!run.ok) return failAll(run.error)

  for (const key of keys) {
    const spec = specs[key] || {}
    const o = run.program.outputs[spec.output]
    // ⛔⛔ THE SAVED MAP IS CHECKED AGAINST THE PROGRAM, NOT TRUSTED. An output
    // index is only meaningful for the source and options it was minted under;
    // a program that moved underneath it would hand one plot another's series.
    if (!o || o.call !== spec.call || (Number.isInteger(spec.line) && o.line !== spec.line)) {
      errors[key] = { guard: 'runtime-door:shape',
        message: `the saved document expects output ${spec.output} to be \`${spec.call}\``
          + `${Number.isInteger(spec.line) ? ` on line ${spec.line}` : ''}, and the rebuilt program `
          + 'disagrees — the script and its saved map no longer match' }
      continue
    }
    const raw = run.outputs[spec.output]
    const shift = Number.isInteger(spec.shift) && spec.shift > 0 ? spec.shift : 0
    if (!shift) { columns[key] = raw; continue }
    // ⭐ A POSITIVE `offset = N` DRAWS bar i's value at bar i + N — the host lane
    // puts it in the tree as `x[N]`; here it is the same re-indexing of a
    // finished column, with the first N bars `na`.
    const shifted = new Float64Array(raw.length).fill(NaN)
    for (let i = shift; i < raw.length; i += 1) shifted[i] = raw[i - shift]
    columns[key] = shifted
  }
  return { columns, errors }
}

/** The document's compute HANDLE (FNV-1a) — a changed script or a changed map
 *  is a changed handle. ⭐ It lives in `pineRuntimeHandle.js`, which imports
 *  nothing, so the store's parity rail can read it without this lane's VM; and
 *  it is hashed over KEY-SORTED JSON so a document survives the store's
 *  sorted-key round trip (that file says why). */
export { runtimeLaneHandle, runtimeLaneHandleOf } from './pineRuntimeHandle'
