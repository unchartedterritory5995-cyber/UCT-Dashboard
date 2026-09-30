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
import { Budget } from './limits.js'
import { registerObjectRuntimeValues } from '../objectColumns.js'

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

// ─── ⭐⭐ C18 — VALUES A DRAWING READS FROM THE RUNTIME LANE ─────────────────
//
// The host object pass (`pine.js::buildObjectProgram`, `rtCheck`) writes a
// placeholder where a drawing's value is computed imperatively, and carries the
// script with it (`objectProgram.js::RUNTIME_AT_CALL`). These two functions are
// the only doors between that program and this lane: `probeObjectRuntime` is the
// member door's compile check at translation, and `runtimeObjectValues` computes
// the placeholders' columns on the chart's bars. ONE evaluator — the VM that
// already runs the runtime pane — never a second.

/** The member door's check: does the runtime lane build this script with the
 *  drawing values read at their statements? Built over NO bars, so it costs a
 *  compile. ⛔ A program that asks another symbol or timeframe is refused here:
 *  the object reader has no other bars to hand it, and a request answered `na`
 *  would draw a picture of a fetch that did not happen. */
export function probeObjectRuntime(source, specs) {
  let built
  try {
    built = buildRuntimeIr(String(source || ''), {
      bars: [], inputs: {}, objectTrees: [], objectTreesAt: specs, ...runtimeClockOpts(false),
    })
  } catch (err) {
    return { ok: false, refusal: { guard: 'runtime:build', message: String((err && err.message) || err) } }
  }
  if (!built.ok) return { ok: false, refusal: built.refusal || { guard: 'runtime:build', message: '' } }
  if ((built.ir.requests || []).length) {
    return { ok: false, refusal: { guard: 'runtime:request', message: 'the script requests other bars' } }
  }
  // ⭐ A value that is not a number here (text, a colour, an array) is named by
  // index, so the object pass can leave exactly those out and ask again.
  const exclude = (built.objectAtKinds || []).map((kind, k) => (kind === 'num' ? -1 : k)).filter((k) => k >= 0)
  if (exclude.length) {
    return { ok: false, exclude, refusal: { guard: 'runtime:object-kind', message: 'a value is not a number' } }
  }
  try {
    lowerIrProgram(built.ir)
  } catch (err) {
    return { ok: false, refusal: { guard: 'runtime:lower', message: String((err && err.message) || err) } }
  }
  return { ok: true }
}

/** The two probe settings an unmeasured value is run at (`collections.js::probedEmpty`,
 *  `colours.js` `color.from_gradient`). A value that moves between them depends on
 *  the unknown; one that does not, does not. */
export const RUNTIME_PROBES = Object.freeze([
  Object.freeze({ probe: NaN, colourProbe: NaN }),
  Object.freeze({ probe: -1e12, colourProbe: 0x7f3a5b1c }),
])

const _objectMemo = new WeakMap()

/**
 * The columns of an object program's runtime placeholders over `bars`.
 *
 * @param {{source: string, at: object[]}} rt  the program's `runtime`
 * @param {object[]} bars `{t, o, h, l, c, v}`, oldest first
 * @param {object} ctx `{tf, newestBarIsForming, fromListing, atDefaults}`
 * @returns {{cols: Float64Array[], unknown: (Uint8Array|null)[], served: boolean, reason: string|null}}
 *
 * ⛔⛔ SERVED ONLY WHERE EXACT, and otherwise every placeholder reads UNKNOWN, so
 * the object runtime withholds what reads it (C17). Exact means ALL of:
 *   · the series starts at the symbol's LISTING (`fromListing`, ruling R-W — the
 *     same one gate the plot lane's `var`s answer): the run starts where Pine's
 *     did, so every `var`, array and loop holds what Pine's held. Anywhere else a
 *     value could carry state from bars this chart does not have;
 *   · the member left every input at the author's default (`atDefaults`): the run
 *     builds the script as written;
 *   · the run completes — a `while` past `WHILE_ITERATIONS`, a per-bar ceiling, an
 *     out-of-range read: the run stops by name and nothing is read from it;
 *   · per bar and per value, the two probe runs agree (`RUNTIME_PROBES`) whenever
 *     the first run met an unmeasured value.
 */
export function runtimeObjectValues(rt, bars, ctx = {}) {
  const rows = Array.isArray(bars) ? bars : []
  const n = rows.length
  const k = (rt && Array.isArray(rt.at)) ? rt.at.length : 0
  const withheld = (reason) => ({
    cols: Array.from({ length: k }, () => new Float64Array(n).fill(NaN)),
    unknown: Array.from({ length: k }, () => new Uint8Array(n).fill(1)),
    served: false,
    reason,
  })
  if (!k) return withheld('runtime:empty')
  if (ctx.fromListing !== true) return withheld('runtime:not-from-listing')
  if (ctx.atDefaults !== true) return withheld('runtime:member-inputs')
  const tf = typeof ctx.tf === 'string' ? ctx.tf : undefined
  const forming = newestBarIsFormingFrom(ctx)
  const key = `${tf}|${forming}|${rt.source.length}|${JSON.stringify(rt.at).length}`
  let perBars = _objectMemo.get(rows)
  if (!perBars) { perBars = new Map(); _objectMemo.set(rows, perBars) }
  const memoFor = perBars.get(rt)
  if (memoFor && memoFor.key === key) return memoFor.value

  const value = (() => {
    let built
    try {
      built = buildRuntimeIr(String(rt.source), {
        bars: rows,
        inputs: {},
        objectTrees: [],
        objectTreesAt: rt.at,
        ...(tf ? { basePeriod: tf, tf } : {}),
        ...runtimeClockOpts(forming, tf ? { tf } : {}),
      })
    } catch (err) {
      return withheld('runtime:build')
    }
    if (!built.ok) return withheld((built.refusal && built.refusal.guard) || 'runtime:build')
    if ((built.ir.requests || []).length) return withheld('runtime:request')
    if ((built.objectAtKinds || []).some((kind) => kind !== 'num')) return withheld('runtime:object-kind')
    let program
    try { program = lowerIrProgram(built.ir) } catch { return withheld('runtime:lower') }
    const series = ['o', 'h', 'l', 'c', 'v'].map((f) => Float64Array.from(rows.map((b) => b[f])))
    const runAt = (probe) => {
      const budget = new Budget()
      budget.unmeasured = { ...probe, hits: [] }
      const res = execute(program, {
        bars: n,
        series,
        columns: program.columns,
        confirmed: forming === false,
        barTimes: rows.map((b) => b.t),
      }, undefined, { budget })
      return { outputs: res.outputs, hits: budget.unmeasured.hits.length }
    }
    let first
    try { first = runAt(RUNTIME_PROBES[0]) } catch (err) {
      return withheld(err && err.limit ? `runtime:${err.limit}` : `runtime:${(err && err.name) || 'error'}`)
    }
    const cols = built.objectAtOutputs.map((o) => first.outputs[o])
    const unknown = cols.map(() => null)
    if (first.hits) {
      let second
      try { second = runAt(RUNTIME_PROBES[1]) } catch (err) {
        return withheld(err && err.limit ? `runtime:${err.limit}` : `runtime:${(err && err.name) || 'error'}`)
      }
      built.objectAtOutputs.forEach((o, j) => {
        const a = first.outputs[o]
        const b = second.outputs[o]
        for (let i = 0; i < n; i += 1) {
          const same = Object.is(a[i], b[i]) || (Number.isNaN(a[i]) && Number.isNaN(b[i]))
          if (!same) {
            if (!unknown[j]) unknown[j] = new Uint8Array(n)
            unknown[j][i] = 1
          }
        }
      })
    }
    return { cols, unknown, served: true, reason: null }
  })()
  perBars.set(rt, { key, value })
  return value
}

// ⭐ C18 — importing this lane is what makes it available to the object reader.
registerObjectRuntimeValues(runtimeObjectValues)
