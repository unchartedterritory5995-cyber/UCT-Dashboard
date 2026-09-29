// app/src/components/chart/engine/runtime/runtimeColumns.js
//
// ─── ⭐⭐ `compute.kind: 'runtime'` — A MEMBER'S SCRIPT, COMPUTED BAR BY BAR ──
//
// The columnar lane turns a script into one formula per output; the per-bar
// runtime lane (`buildRuntimeIr` → `lowerIrProgram` → `execute`) runs its
// statements in source order, once per bar — which is how Pine runs it. Some
// scripts only the second can represent: two `var`s that each read the other
// before setting their own (`pine.js::partialStateRead`, measured against a
// TradingView capture of `inside-bar-range-mother-candle-…`).
//
// This module is the ONE place that computes such a document's columns. It is
// registered into `nativeRegistry` by the door that mints runtime documents
// (`builder/memberPane/runtimePaneDefinition.js`), so the chart's own bundle does
// not carry the runtime lane until a member pane can produce a document for it.
//
// ⛔ GATED: `runtimePaneGate.runtimePaneEnabled()` decides whether a runtime
// document may exist at all; nothing here reads a flag.
//
// ⛔ THE CLOCK IS THREADED, NEVER ASSUMED. `runtimeClockOpts` fills both halves
// of the forming-bar tri-state from ONE value, the pair `pineRuntimeFrontendGate
// .test.js` requires every live importer of the front end to reach.
import { buildRuntimeIr } from '../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts, newestBarIsFormingFrom } from '../ast/pineRuntimeClock.js'
import { lowerIrProgram } from './lowerIr.js'
import { execute } from './vm.js'

/**
 * Can the runtime lane build this script at all, and what does it output?
 *
 * Built over NO bars: every column the program reads is then an empty array, so
 * this costs a compile, not a computation. The member door asks it before it
 * routes a script here, so a document is only minted for a program that builds.
 *
 * @returns {{ok: true, outputs: {call: string}[]} | {ok: false, refusal: object}}
 */
export function probeRuntimeProgram(source) {
  let built
  try {
    built = buildRuntimeIr(String(source || ''), {
      bars: [], inputs: {}, objectTrees: [], ...runtimeClockOpts(false),
    })
  } catch (err) {
    return { ok: false, refusal: { guard: 'runtime:build', message: String((err && err.message) || err) } }
  }
  if (!built.ok) return { ok: false, refusal: built.refusal || { guard: 'runtime:build', message: '' } }
  let program
  try {
    program = lowerIrProgram(built.ir)
  } catch (err) {
    return { ok: false, refusal: { guard: 'runtime:lower', message: String((err && err.message) || err) } }
  }
  return { ok: true, outputs: program.outputs.map((o) => ({ call: o.call })) }
}

/** One build per (bars array, definition, timeframe, forming). A chart repaints
 *  far more often than its bars change, and a build re-interprets every column
 *  the program reads. Keyed on the bars ARRAY identity, as the binder's own
 *  memos are, so a new fetch is a new build. */
const _memo = new WeakMap()

/**
 * The columns of a `compute.kind: 'runtime'` definition over `bars`.
 *
 * @param {object} def   the definition; `def.compute.source` is the member's Pine
 *                       and `def.compute.outputs` maps plot key → runtime output index
 * @param {object[]} bars `{t, o, h, l, c, v}` rows, oldest first
 * @param {object} [_inputs] unused: a runtime document declares no member knobs
 *                       (it draws the script at its DEFAULTS — the owner principle)
 * @param {object} [ctx] `{tf, newestBarIsForming}` as `computeFor` receives it
 * @returns {Record<string, number[]>} one column per mapped plot key
 * @throws a refusal-shaped error when the runtime lane cannot build the script
 */
export function runtimeColumnsFor(def, bars, _inputs, ctx) {
  const compute = (def && def.compute) || {}
  const outputs = compute.outputs || {}
  const rows = Array.isArray(bars) ? bars : []
  const tf = ctx && typeof ctx.tf === 'string' ? ctx.tf : undefined
  const forming = newestBarIsFormingFrom(ctx)
  const key = `${def && def.id}|${compute.fn}|${tf}|${forming}`
  let perBars = _memo.get(rows)
  if (!perBars) { perBars = new Map(); _memo.set(rows, perBars) }
  if (perBars.has(key)) return perBars.get(key)

  const clock = runtimeClockOpts(forming, tf ? { tf } : {})
  const built = buildRuntimeIr(String(compute.source || ''), {
    bars: rows,
    inputs: {},
    // `[]` = the caller owns the drawing: `line.new` & co. are skipped, not
    // refused. The document's object program (the host lane's) draws them.
    objectTrees: [],
    ...(tf ? { basePeriod: tf, tf } : {}),
    ...clock,
  })
  if (!built.ok) {
    const r = built.refusal || {}
    const err = new Error(r.message || 'the runtime lane could not build this script')
    err.guard = r.guard || 'runtime:build'
    throw err
  }
  const program = lowerIrProgram(built.ir)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(rows.map((b) => b[k])))
  const res = execute(program, {
    bars: rows.length,
    series,
    columns: program.columns,
    // Only a bar KNOWN to have finished is confirmed; unknown fails closed the
    // way `interpret` does for the four realtime clock columns.
    confirmed: forming === false,
    barTimes: rows.map((b) => b.t),
  })
  const out = {}
  for (const [plotKey, index] of Object.entries(outputs)) {
    const col = res.outputs[index]
    if (col) out[plotKey] = Array.from(col)
  }
  perBars.set(key, out)
  return out
}
