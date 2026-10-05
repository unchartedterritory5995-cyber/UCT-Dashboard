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
import { lowerIrProgram, naTestsOf } from './lowerIr.js'
import { execute } from './vm.js'
import { Budget, RuntimeLimitError } from './limits.js'
import { MAX_COLLECTION_CAP as ITER_SLOTS, rtLoopId } from '../ast/objectProgram.js'
import { registerObjectRuntimeValues } from '../objectColumns.js'
// ⭐⭐ RT5 — the run's own drawings ride the column record (`runtimeObjects.js`).
import { withRuntimeObjects } from './runtimeObjects.js'
import { declaredCalcBarsOf } from './objectStore.js'
import { strippedForScan } from '../ast/pine.js'

/** ⭐⭐ C23 — THE RUNTIME LANE SERVES A CHART PANE, NEVER A SCREEN, from every
 *  door in this module: a runtime pane's columns and an object pass's values are
 *  both drawn on ONE symbol's chart. `pane` hands the columnar resolver the host
 *  lane's pane contract (`buildRuntimeIr`'s `resolverOpts`), so `barstate.isfirst`,
 *  the forming-bar clock and `timeframe.change` are the plot lane's own columns.
 *  The two COMPILE checks build over no bars before a symbol is chosen, so they
 *  also leave what a symbol settles (`syminfo.mintick`) to the binding
 *  (`symbolAtBind`); every build with bars carries the chart's symbol instead. */
const COMPILE_ON_A_PANE = Object.freeze({ pane: true, symbolAtBind: true })

/** The chart's `{ticker, exchange}` as the binder hands it, or undefined — the
 *  SAME object the object reader folds its trees with (`objectColumns.js`
 *  `bindConstsFor({… symbol: opts.symbol})`), so a run and the trees beside it
 *  settle `syminfo.*` from one symbol. */
const symbolOf = (ctx) => (ctx && ctx.symbol && typeof ctx.symbol === 'object'
  ? { ticker: ctx.symbol.ticker, exchange: ctx.symbol.exchange } : undefined)
const symbolKey = (s) => (s ? `${s.ticker}@${s.exchange}` : '-')

/** ⭐ RT1 — the guard a fallback document carries on a chart whose history does
 *  not start at the listing (see `runtimeColumnsFor`). */
export const RUNTIME_HISTORY_GUARD = 'runtime:history-start'

/**
 * Can the runtime lane build this script at all, and what does it output?
 *
 * Built over NO bars: every column the program reads is then an empty array, so
 * this costs a compile, not a computation. The member door asks it before it
 * routes a script here, so a document is only minted for a program that builds.
 *
 * @returns {{ok: true, outputs: {call: string}[]} | {ok: false, refusal: object}}
 */
export function probeRuntimeProgram(source, { objectsInRun = false } = {}) {
  let built
  try {
    // ⭐ RT5 — `objectsInRun`: the build that DRAWS its own objects instead of
    // handing them to the host object pass (`objectTrees: []`).
    built = buildRuntimeIr(String(source || ''), {
      bars: [], inputs: {}, ...(objectsInRun ? { objectsInRun: true } : { objectTrees: [] }),
      ...COMPILE_ON_A_PANE, ...runtimeClockOpts(false),
      // ⭐ RT6 — the pane's own build: each plot's `color =` is an output too.
      plotColours: true,
    })
  } catch (err) {
    return { ok: false, refusal: { guard: 'runtime:build', message: String((err && err.message) || err) } }
  }
  if (!built.ok) return { ok: false, refusal: built.refusal || { guard: 'runtime:build', message: '' } }
  let program
  try {
    // ⭐⭐ RT3 — lowered as the member door's FALLBACK document runs: from the
    // listing (`runtimeHistory: 'listing'`, R-W), where an `na` condition is read
    // as Pine reads it. A routed document reads only `outputs` from this probe.
    program = lowerIrProgram(built.ir, { historyFromListing: true })
  } catch (err) {
    return { ok: false, refusal: { guard: 'runtime:lower', message: String((err && err.message) || err) } }
  }
  // ⭐ RT1 — `naTests`: the program's conditions whose `na` reading is not settled
  // (`naTestsOf`, RT3), read by the member door's runtime fallback.
  // ⭐ RT2 — `requests`: the requests the lowering did NOT fold into this chart's
  // own expression (another symbol or timeframe). The pane hands a run no other
  // bars, so the member door declines a program that has any.
  return {
    ok: true,
    // ⭐ RT6 — each descriptor carries what the door needs to carry a colour:
    // `colour` (`{output}` or `{refused}`), `of` (a colour output's plot),
    // `transp`, `colourOpaque`, `line`. Absent unless the call said something.
    outputs: program.outputs.map((o) => ({ ...o })),
    naTests: naTestsOf(program),
    requests: (built.ir.requests || []).length,
    // ⭐ RT5 — how many drawing operations the build lowered (0 unless asked).
    objectOps: (program.objectOps || []).length,
  }
}

/** One build per (bars array, definition, timeframe, forming). A chart repaints
 *  far more often than its bars change, and a build re-interprets every column
 *  the program reads. Keyed on the bars ARRAY identity, as the binder's own
 *  memos are, so a new fetch is a new build. */
const _memo = new WeakMap()

/** ⭐⭐ RT1 — THE PER-INDICATOR TIME BUDGET FOR ONE RUNTIME-PANE RUN, in ms.
 *
 *  Measured 2026-10-02 (`runtimeFallbackPerf.measure.test.js`, the newest 5,000
 *  daily bars of a committed AAPL capture, cold, median of 5): every document
 *  the member door mints from the runtime lane runs in 94–144 ms on the
 *  measuring box. The budget is ~7x the slowest reading, room for a slower
 *  device, and it bounds what a runaway costs: a run that passes it STOPS, and
 *  the pane says so by name (`RUNTIME_TIME_BUDGET_GUARD`), never draws a part.
 *
 *  ⛔ It is the runtime PANE's budget, passed to this lane's own run — the VM's
 *  declared limits (`limits.js`, `WALL_TIME` among them) are not touched, and no
 *  other caller of `execute` sees it. And it is a wall-clock budget, so it is a
 *  property of the device that runs it: off the main thread (`runtimeWorker.js`)
 *  a run costs the member no frame either way, and this is what stops it. */
export const RUNTIME_PANE_TIME_BUDGET_MS = 1000

/** ⭐⭐ RT8 (step 87) — THE VENDOR HARNESS GRADES THE COMPUTATION, NOT THE CLOCK.
 *
 *  The budget above is a property of the device (ruling D3 keeps it on the
 *  product path, unchanged). A GRADE is a property of the script: run under a
 *  wall clock it depended on how busy the box was (CAP3, 2026-10-03: atr-stepped
 *  flipped MATCH <-> INCONCLUSIVE, nadaraya stopped at 1,202 ms under load). The
 *  harness's runtime state (`vendorHarness/harness.js::enterDoorState`) switches
 *  the wall clock off for the synchronous lane; the VM's declared, instruction-
 *  counted limits (`limits.js`) still bound every run. Rails only — product code
 *  never calls it; `runtimePaneClock.test.js` proves the product path still stops
 *  a run at the budget. */
let _paneClockOff = false
export function __gradeWithoutPaneClockForTests(off) { _paneClockOff = off === true }
/** The budget the synchronous pane lane applies right now (null = no wall clock). */
export function paneBudgetMs() { return _paneClockOff ? null : RUNTIME_PANE_TIME_BUDGET_MS }

/** The guard a run that passes the budget carries. */
export const RUNTIME_TIME_BUDGET_GUARD = 'runtime:time-budget'

/** ⭐ RF — the guard a run stopped by one of the VM's declared limits carries. */
export const RUNTIME_LIMIT_GUARD = 'runtime:limit'

/** ⭐ RF — the guard a run that threw something unexpected carries. */
export const RUNTIME_FAILED_GUARD = 'runtime:failed'


/** The memo key for one run: the definition, its compute handle, and everything
 *  in `ctx` that changes the answer (the clock, the symbol, the listing fact). */
function runKey(def, ctx) {
  const compute = (def && def.compute) || {}
  const tf = ctx && typeof ctx.tf === 'string' ? ctx.tf : undefined
  const forming = newestBarIsFormingFrom(ctx)
  const listing = !!(ctx && ctx.historyFromListing === true)
  return `${def && def.id}|${compute.fn}|${tf}|${forming}|${symbolKey(symbolOf(ctx))}|${listing}`
}

/** A refusal-shaped error, as `nativeRegistry.runtimeColumnsOrReasons` reads one. */
function refusal(guard, message) {
  const err = new Error(message)
  err.guard = guard
  return err
}

/**
 * ⭐⭐ RT1 — ONE RUN, NO MEMO: the columns of a runtime document over `rows`.
 *
 * The single computation both doors share — the synchronous one below and the
 * worker (`runtimeWorker.js`) — so a column computed off the main thread is the
 * same number, by construction, as one computed on it.
 *
 * @param {object} def   `def.compute.source` is the member's Pine and
 *                       `def.compute.outputs` maps plot key → runtime output index
 * @param {object[]} rows `{t, o, h, l, c, v}` rows, oldest first
 * @param {object} [ctx] `{tf, newestBarIsForming, symbol, historyFromListing}`
 * @param {{budgetMs?: number, now?: () => number}} [opts]
 * @returns {Record<string, number[]>}
 * @throws a refusal-shaped error (`err.guard`) or the script's own `runtime.error`
 */
/**
 * ⭐⭐ RT5 — a run that OWNS its drawings and cannot make them (a named drawing
 * wall, an engine error inside drawing code, `calc_bars_count`) never costs the
 * document its plots: the plain run (drawings skipped, as before RT5) computes the
 * columns, and the drawings are WITHHELD by name beside them. A reached
 * `runtime.error` and the two run-wide budgets are the run's answer, not the
 * drawings', and stay as they are.
 */
export function computeRuntimeColumns(def, rows, ctx, opts = {}) {
  const compute = (def && def.compute) || {}
  if (compute.objects !== true) return computeRuntimeColumnsOnce(def, rows, ctx, opts)
  try {
    return computeRuntimeColumnsOnce(def, rows, ctx, opts)
  } catch (err) {
    if (err && (err.name === 'runtime.error' || err.guard === RUNTIME_TIME_BUDGET_GUARD
      || err.guard === RUNTIME_HISTORY_GUARD)) throw err
    const plain = { ...def, compute: { ...compute, objects: undefined } }
    let out
    try { out = computeRuntimeColumnsOnce(plain, rows, ctx, opts) } catch { throw err }
    return withRuntimeObjects(out, { status: 'WITHHELD', live: [], guard: (err && err.guard) || 'runtime:objects',
      reason: String((err && err.message) || err) })
  }
}

function computeRuntimeColumnsOnce(def, rows, ctx, opts = {}) {
  const compute = (def && def.compute) || {}
  const outputs = compute.outputs || {}
  // ⛔ RT1 — R-W FOR THIS LANE (`memberPaneDefinition`, `runtimeHistory`): a
  // document that needs its run to start at TradingView's bar 0 computes nothing
  // on a series that is not proven to start at the symbol's listing — refused by
  // name, never drawn off a seed TradingView never used.
  if (def && def.meta && def.meta.runtimeHistory === 'listing' && !(ctx && ctx.historyFromListing === true)) {
    throw refusal(RUNTIME_HISTORY_GUARD, "this script is drawn bar by bar from its first bar, and this chart's "
      + "history is not known to start at the symbol's first bar, so the values it carries from bar to bar "
      + "would start from a different bar than TradingView's. Nothing is drawn rather than a guess. "
      + 'TO UNBLOCK: a chart whose loaded history reaches the listing (a daily chart of a symbol listed '
      + 'within the bars it loads) draws it.')
  }
  const tf = ctx && typeof ctx.tf === 'string' ? ctx.tf : undefined
  const forming = newestBarIsFormingFrom(ctx)
  const symbol = symbolOf(ctx)
  const clock = runtimeClockOpts(forming, tf ? { tf } : {})
  // ⭐⭐ RT5 — a document that draws its OWN objects builds them into the run
  // (`objectsInRun`); every other runtime document keeps the host lane's.
  const ownObjects = compute.objects === true
  // ⛔ RT5 — `calc_bars_count = N` makes TradingView run the script on the LAST N
  // bars only; a run from this chart's first bar would make other drawings. No
  // lane honours it yet, so a run that owns its drawings refuses by name.
  if (ownObjects) {
    const calcBars = declaredCalcBarsOf(strippedForScan(String(compute.source || '')))
    if (calcBars !== null && rows.length > calcBars) {
      throw refusal('runtime:calc-bars-count', `this script runs on its last ${calcBars} bars only `
        + `(\`calc_bars_count = ${calcBars}\`), and this chart holds ${rows.length}; its drawings from a run over `
        + 'every bar would be a different picture. Nothing is drawn rather than a guess.')
    }
  }
  const built = buildRuntimeIr(String(compute.source || ''), {
    bars: rows,
    // ⭐ RT9 (Q1) — a hybrid's objects run carries the member's moved numeric
    // inputs it honours (`objectsRunDefinition`); every other document has none.
    inputs: (compute.inputs && typeof compute.inputs === 'object') ? compute.inputs : {},
    // `[]` = the caller owns the drawing: `line.new` & co. are skipped, not
    // refused. The document's object program (the host lane's) draws them.
    ...(ownObjects ? { objectsInRun: true } : { objectTrees: [] }),
    pane: true,
    // ⭐ RT6 — the same build the door probed: each plot's `color =` is an
    // output too, appended after every other, so `compute.outputs` indices a
    // document minted before RT6 still name the same columns.
    plotColours: true,
    ...(symbol ? { symbol } : {}),
    ...(tf ? { basePeriod: tf, tf } : {}),
    ...clock,
  })
  if (!built.ok) {
    const r = built.refusal || {}
    throw refusal(r.guard || 'runtime:build', r.message || 'the runtime lane could not build this script')
  }
  // ⛔ RT2 — a request of other bars computes nothing here, whatever door the
  // document came through (the member door declines one; a stored document is
  // re-checked at its run): this run is handed no other symbol's bars, and an
  // `na` drawn where TradingView draws a value is a wrong drawing.
  if ((built.ir.requests || []).length) {
    throw refusal('runtime:request', 'this script requests another symbol or timeframe, and a script drawn '
      + "bar by bar here is handed only the chart's own bars, so nothing is drawn rather than a blank line")
  }
  // ⭐⭐ RT3 — from the listing, a `NaN` is Pine's `na` and an `na` condition reads
  // as Pine reads it; off it the shared `{0,1,NaN}` rules stand (`lowerIrProgram`).
  const program = lowerIrProgram(built.ir, { historyFromListing: !!(ctx && ctx.historyFromListing === true) })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(rows.map((b) => b[k])))
  // ⭐⭐ RT1 — THE TIME BUDGET, checked at the end of every bar through the VM's
  // own per-bar hook (no VM change): past it the run stops by name.
  const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : null
  const now = typeof opts.now === 'function' ? opts.now
    : () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const startedAt = budgetMs !== null ? now() : 0
  // ⭐⭐ C43 — the script's own `runtime.error` (C35's `PineRuntimeError`) stops
  // the run on the bar it is reached; TradingView's study then holds nothing and
  // names that bar (`vw-runtime-error-reached`). The bar is the one after the last
  // the run finished, stamped on the error for the member's sentence
  // (`nativeRegistry.runtimeColumnsOrReasons`).
  let finished = -1
  let res
  // ⭐⭐ H7 (step 92h) — ONE RUN. F8's INTERIM two-probe run for `array.sum` /
  // `array.avg` over zero real elements is gone: CAP4 Q-RT7a
  // (`vw-rt7-empty-reduce-fixnan-spy-1d-2026-10-04`) MEASURED the answer — `na`, no
  // runtime error — and `collections.js` answers it directly. The pane sets no
  // `budget.unmeasured`, so every value no capture pins (`array.median` / `stdev`, a
  // gradient outside reversed bounds) still stops the run by name.
  try {
    res = execute(program, {
      bars: rows.length,
      series,
      columns: program.columns,
      // Only a bar KNOWN to have finished is confirmed; unknown fails closed the
      // way `interpret` does for the four realtime clock columns.
      confirmed: forming === false,
      barTimes: rows.map((b) => b.t),
    }, undefined, {
      onBar: (bar) => {
        finished = bar
        if (budgetMs !== null) {
          const spent = now() - startedAt
          if (spent > budgetMs) throw new RuntimeLimitError('WALL_TIME', budgetMs, Math.round(spent))
        }
      },
    })
  } catch (err) {
    if (err && err.name === 'runtime.error') err.bar = finished + 1
    if (err instanceof RuntimeLimitError && err.limit === 'WALL_TIME' && budgetMs !== null) {
      throw refusal(RUNTIME_TIME_BUDGET_GUARD, `this script took more than ${budgetMs} ms to draw `
        + `bar by bar (it had reached bar ${finished + 1} of ${rows.length}), which is this pane's budget `
        + 'for one indicator, so it is stopped and nothing is drawn rather than part of it.')
    }
    // ⭐⭐ RF — EVERY OTHER STOP OF THE RUN IS NAMED TOO. A VM limit
    // (`limits.js`: loop iterations, collection sizes, …) and an unexpected throw
    // used to reach the registry as a bare `Error` — guard `engine:error`, message
    // `LOOP_ITERATIONS_EXCEEDED — ceiling …` — which is not a sentence a member
    // can read. The script's own `runtime.error` (C43) keeps its own path.
    if (err && err.name !== 'runtime.error' && !err.guard) {
      if (err instanceof RuntimeLimitError) {
        throw refusal(RUNTIME_LIMIT_GUARD, `this script passed one of the limits a script drawn bar by bar `
          + `runs under (${err.limit}: at most ${err.ceiling}, it reached ${err.reached}) on bar ${finished + 1} `
          + `of ${rows.length}, so it is stopped and nothing is drawn rather than part of it.`)
      }
      // A collection / record / VM error words its own reason (`collections.js`:
      // "array.sum of an empty array — …"); it is kept, with the bar it stopped on.
      const failed = refusal(RUNTIME_FAILED_GUARD, `this script stopped on bar ${finished + 1} of ${rows.length} `
        + `when drawn bar by bar (${String((err && err.message) || err).slice(0, 400)}), so nothing is drawn `
        + 'rather than part of it.')
      failed.cause = (err && err.name) || 'Error'
      throw failed
    }
    throw err
  }
  const out = {}
  for (const [plotKey, index] of Object.entries(outputs)) {
    const col = res.outputs[index]
    if (col) out[plotKey] = Array.from(col)
  }
  // ⭐⭐ RT5 — THE DRAWINGS THIS SAME RUN MADE, as plain data (structured-clone
  // safe for the worker), beside the columns.
  if (ownObjects) {
    const fin = res.objects ? res.objects.finish() : { status: 'ok', reason: null, live: [], withheld: {} }
    withRuntimeObjects(out, { ...fin, pineVersion: Number.isFinite(program.version) ? program.version : null })
  }
  return out
}

/** ⭐⭐ RT1 — WHERE A RUN HAPPENS OFF THE MAIN THREAD, when anything does.
 *
 *  `null` (the default, and always in tests) runs on the caller's thread. The
 *  browser door installs the worker runner (`runtimeAsync.js`) when the runtime
 *  pane is switched on; a runner takes `(def, rows, ctx, done)` and calls
 *  `done(err, columns)` once. */
let _runner = null
export function setRuntimeRunner(runner) {
  _runner = typeof runner === 'function' ? runner : null
}

/** Listeners told when an off-thread run lands, so a chart can repaint. */
const _landed = new Set()
export function onRuntimeColumnsLanded(fn) {
  if (typeof fn !== 'function') return () => {}
  _landed.add(fn)
  return () => { _landed.delete(fn) }
}

/**
 * The columns of a `compute.kind: 'runtime'` definition over `bars`.
 *
 * @param {object} def   the definition; `def.compute.source` is the member's Pine
 *                       and `def.compute.outputs` maps plot key → runtime output index
 * @param {object[]} bars `{t, o, h, l, c, v}` rows, oldest first
 * @param {object} [_inputs] unused: a runtime document declares no member knobs
 *                       (it draws the script at its DEFAULTS — the owner principle)
 * @param {object} [ctx] `{tf, newestBarIsForming}` as `computeFor` receives it
 * @returns {Record<string, number[]>} one column per mapped plot key; `{}` while
 *          an off-thread run is in flight (the chart repaints when it lands)
 * @throws a refusal-shaped error when the runtime lane cannot build the script
 */
export function runtimeColumnsFor(def, bars, _inputs, ctx) {
  const rows = Array.isArray(bars) ? bars : []
  const key = runKey(def, ctx)
  let perBars = _memo.get(rows)
  if (!perBars) { perBars = new Map(); _memo.set(rows, perBars) }
  if (perBars.has(key)) {
    const hit = perBars.get(key)
    // ⭐ C43 — a run the script stopped is remembered as that stop, not re-run;
    // ⭐ RT1 — and so is a refusal or a budget stop, and an in-flight run.
    if (hit && hit.stoppedBy) throw hit.stoppedBy
    if (hit && hit.pending) return {}
    return hit
  }
  if (_runner) {
    // ⭐⭐ RT1 — OFF THE MAIN THREAD. The run is handed to the worker and this
    // paint draws nothing for the definition; when the columns land they are
    // remembered under the same key and every listener is told, so the next
    // paint reads them here. A run is never started twice for one key.
    perBars.set(key, { pending: true })
    _runner(def, rows, ctx, (err, columns) => {
      perBars.set(key, err ? { stoppedBy: err } : columns)
      for (const fn of [..._landed]) {
        try { fn(key) } catch { /* a bad listener must not break the lane */ }
      }
    })
    return {}
  }
  try {
    const out = computeRuntimeColumns(def, rows, ctx, { budgetMs: paneBudgetMs() })
    perBars.set(key, out)
    return out
  } catch (err) {
    perBars.set(key, { stoppedBy: err })
    throw err
  }
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
/** ⭐ C20 — the kind a runtime value was asked for: a pass count and a REACHED
 *  signal are numbers; otherwise the spec says (`text`, `colour`), default a number. */
const wantedKind = (spec) => (spec && !spec.passes && spec.node && spec.kind) || 'num'

export function probeObjectRuntime(source, specs) {
  let built
  try {
    built = buildRuntimeIr(String(source || ''), {
      bars: [], inputs: {}, objectTrees: [], objectTreesAt: specs, ...COMPILE_ON_A_PANE, ...runtimeClockOpts(false),
    })
  } catch (err) {
    return { ok: false, refusal: { guard: 'runtime:build', message: String((err && err.message) || err) } }
  }
  if (!built.ok) return { ok: false, refusal: built.refusal || { guard: 'runtime:build', message: '' } }
  if ((built.ir.requests || []).length) {
    return { ok: false, refusal: { guard: 'runtime:request', message: 'the script requests other bars' } }
  }
  // ⭐ A value that is not of the kind the object pass asked for (a number by
  // default; C20 also asks for `text` and `colour`) is named by index WITH the
  // kind it is, so the object pass can leave exactly those out, or ask again for
  // the kind it is, and try once more.
  const kinds = built.objectAtKinds || []
  const exclude = kinds.map((kind, k) => (kind === wantedKind(specs[k]) ? -1 : k)).filter((k) => k >= 0)
  if (exclude.length) {
    return {
      ok: false, exclude, kinds: exclude.map((k) => kinds[k]),
      refusal: { guard: 'runtime:object-kind', message: 'a value is not of the kind asked for' },
    }
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
  const at = (rt && Array.isArray(rt.at)) ? rt.at : []
  const k = at.length
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
  const symbol = symbolOf(ctx)
  const key = `${tf}|${forming}|${symbolKey(symbol)}|${rt.source.length}|${JSON.stringify(rt.at).length}`
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
        objectTreesAt: at,
        pane: true,
        ...(symbol ? { symbol } : {}),
        ...(tf ? { basePeriod: tf, tf } : {}),
        ...runtimeClockOpts(forming, tf ? { tf } : {}),
      })
    } catch (err) {
      return withheld('runtime:build')
    }
    if (!built.ok) return withheld((built.refusal && built.refusal.guard) || 'runtime:build')
    if ((built.ir.requests || []).length) return withheld('runtime:request')
    if ((built.objectAtKinds || []).some((kind, j) => kind !== wantedKind(at[j]))) return withheld('runtime:object-kind')
    let program
    try { program = lowerIrProgram(built.ir) } catch { return withheld('runtime:lower') }
    const series = ['o', 'h', 'l', 'c', 'v'].map((f) => Float64Array.from(rows.map((b) => b[f])))
    // ⭐⭐ C20 — PER-PASS AND TEXT VALUES ARE READ AT THE END OF EVERY BAR.
    // They ride per-iteration buffers (`vm.js` allocates them ONCE and every bar
    // overwrites them), so what a bar wrote is copied out in `onBar` — only on a
    // bar the loop ran (its pass count) or the statement was reached (a text in
    // slot 0) — and the buffer is reset, so the next bar cannot read it back.
    const iterOf = built.objectAtIters || []
    const passesOut = new Map()
    at.forEach((s, j) => {
      if (s && s.passes) passesOut.set(`${s.line}:${s.column}`, built.objectAtOutputs[j])
    })
    const hasIters = iterOf.some((b) => b >= 0)
    const runAt = (probe) => {
      const budget = new Budget()
      budget.unmeasured = { ...probe, hits: [] }
      const snaps = at.map(() => null)
      const overflow = new Uint8Array(n)
      const onBar = (bar, iters, outputs) => {
        for (let j = 0; j < k; j += 1) {
          const b = iterOf[j]
          if (!(b >= 0)) continue
          const buf = iters[b]
          const s = at[j]
          let len = 0
          if (s.loop) {
            const o = passesOut.get(`${s.loop.line}:${s.loop.column}`)
            const passes = o === undefined ? NaN : outputs[o][bar]
            if (!(passes >= 1)) continue
            // ⛔ More passes than a buffer holds: the values past it were never
            // written, so the bar is unknown, never read short.
            if (passes > ITER_SLOTS) overflow[bar] = 1
            len = Math.min(passes, ITER_SLOTS)
          } else {
            if (buf[0] === undefined || (typeof buf[0] === 'number' && Number.isNaN(buf[0]))) continue
            len = 1
          }
          if (!snaps[j]) snaps[j] = new Map()
          snaps[j].set(bar, Array.from(buf.slice(0, len)))
          buf.fill(Array.isArray(buf) ? undefined : NaN, 0, len)
        }
      }
      const res = execute(program, {
        bars: n,
        series,
        columns: program.columns,
        confirmed: forming === false,
        barTimes: rows.map((b) => b.t),
      }, undefined, { budget, ...(hasIters ? { onBar } : {}) })
      return { outputs: res.outputs, snaps, overflow, hits: budget.unmeasured.hits.length }
    }
    let first
    try { first = runAt(RUNTIME_PROBES[0]) } catch (err) {
      return withheld(err && err.limit ? `runtime:${err.limit}` : `runtime:${(err && err.name) || 'error'}`)
    }
    let second = null
    if (first.hits) {
      try { second = runAt(RUNTIME_PROBES[1]) } catch (err) {
        return withheld(err && err.limit ? `runtime:${err.limit}` : `runtime:${(err && err.name) || 'error'}`)
      }
    }
    const same = (a, b) => Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b))
    const cols = []
    const unknown = []
    for (let j = 0; j < k; j += 1) {
      const s = at[j]
      let mask = null
      const mark = (i) => { if (!mask) mask = new Uint8Array(n); mask[i] = 1 }
      if (iterOf[j] >= 0) {
        // ⭐ A per-bar map of per-pass values: the object reader indexes it by the
        // loop counter (`loop`) or reads slot 0 (a text outside any loop).
        const byBar = first.snaps[j] || new Map()
        if (second) {
          const other = second.snaps[j] || new Map()
          for (let i = 0; i < n; i += 1) {
            const a = byBar.get(i)
            const b = other.get(i)
            if (!a && !b) continue
            if (!a || !b || a.length !== b.length || a.some((x, q) => !same(x, b[q]))) mark(i)
          }
        }
        cols.push({ byBar, text: s.kind === 'text', loop: s.loop ? rtLoopId(s.loop) : null })
      } else {
        const o = built.objectAtOutputs[j]
        const a = first.outputs[o]
        const b = second ? second.outputs[o] : null
        let col = a
        if (s.passes) {
          // ⭐ A LOOP'S LAST PASS INDEX, read as the object program's counted loop
          // `0 to N-1`: no pass (or a loop never reached) is `na`, so the loop runs
          // zero times — never `0 to -1`, which Pine's `for` would count DOWN.
          col = Float64Array.from(a, (v) => (v >= 1 ? v - 1 : NaN))
          // ⛔ More passes than a per-pass buffer holds (`ITER_SLOTS`): the loop's
          // bound is unknown on that bar, so the whole loop is withheld — the ONE
          // place this is decided (its per-pass values are never read short).
          for (let i = 0; i < n; i += 1) if (first.overflow[i]) mark(i)
        }
        for (let i = 0; b && i < n; i += 1) if (!same(a[i], b[i])) mark(i)
        // ⛔ A runtime colour is served OPAQUE only — decided in ONE place, the
        // object runtime's `colorOf` (`{c:'rt'}`), never repeated here.
        cols.push(col)
      }
      unknown.push(mask)
    }
    return { cols, unknown, served: true, reason: null }
  })()
  perBars.set(rt, { key, value })
  return value
}

// ⭐ C18 — importing this lane is what makes it available to the object reader.
registerObjectRuntimeValues(runtimeObjectValues)
