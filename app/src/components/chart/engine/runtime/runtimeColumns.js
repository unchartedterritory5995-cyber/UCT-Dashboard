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
import { beginAlertLog, takeAlertLog } from './collections.js'
import { buildRuntimeIr, RUNTIME_FRONTEND_LANGUAGE, RUNTIME_FRONTEND_VERSION, columnSinkRefusal, columnBlankRefusal,
  buildBarCountClass } from '../ast/pineRuntimeFrontend.js'
import { RUNTIME_IR_VERSION } from './ir.js'
import { runtimeClockOpts, newestBarIsFormingFrom, isNewByBar } from '../ast/pineRuntimeClock.js'
import { interpret, isIntradayTf } from '../ast/interpret.js'
import { TABLE, BAR_READERS } from '../ast/parse.js'
import { cloneValues } from './vmState.js'
import { SLOT } from './ir.js'
import { lowerIrProgram, naTestsOf } from './lowerIr.js'
import { execute, requestRegionCausal } from './vm.js'
import {
  runtimeRequestSupply, requestWaitingSentence, REQUEST_GUARD, REQUEST_LAG_GUARD, tailCutSentence, tailCutIsOff,
} from './requestSupply.js'
import { withOvernightTail, REQUEST_OVERNIGHT_GUARD } from './overnightTail.js'
import { EVENTS_KEY } from '../pineEvents.js'
// ⭐⭐ T4 F1b — the chart's financial entry (`request.financial`, read through the same other-symbol supply)
import { FINANCIAL_KEY } from '../pineFinancial.js'
import { symbolConstants, minContractOf } from '../ast/bind.js'
// ⭐ RS RATING L3 — the symbol fields the fold reads, from the one list that names them.
import { bindSymbolOf, bindConstsFor } from '../ast/bind.js'
import { strategyBrokerGateOn } from '../strategyBrokerGateRegistry.js'
import { Budget, RuntimeLimitError, DEFAULT_LIMITS, LIMIT_PLAIN } from './limits.js'
import { MAX_COLLECTION_CAP as ITER_SLOTS, rtLoopId } from '../ast/objectProgram.js'
// ⭐ W5-T2 — through the leaf seam, never `objectColumns.js` (which reaches the registry)
import { registerObjectRuntimeValues } from '../objectRuntimeSeam.js'
// ⭐⭐ RT5 — the run's own drawings ride the column record (`runtimeObjects.js`).
import { withRuntimeObjects, RUNTIME_WARMUP_KEY, RUNTIME_OBJECTS_KEY, runtimeWarmupOf } from './runtimeObjects.js'
import { sameDrawings } from './warmupDrawings.js'
import { runtimeInputValues, runtimeBuildInputs } from './runtimeInputs.js'
// ⭐⭐ W9-T11 — the run's `strategy` record (design 3.2) and the window a broker run takes.
import { BROKER_START_GUARD, BrokerRefusal, BrokerUnpinned, BrokerStart } from './broker.js'
import { barOpenInstants } from '../../indicators.js'
import { STRATEGY_WINDOW_HISTORY, strategyRecordOf, withStrategyRecord, refusedStrategyRecordOf, DISARMED_WITHHELD_GUARD,
  disarmedWithheldSentence } from './strategyRecord.js'
import { withColumnErrors } from '../astColumns.js'
import { makeWarmupProbe, sameProgram } from './warmupProbe.js'
export { RUNTIME_WARMUP_KEY, runtimeWarmupOf }
// W5-T1: the identity constants the server bundle's entry re-exports (it must not import the front end itself: pineRuntimeFrontendGate).
export { RUNTIME_FRONTEND_LANGUAGE, RUNTIME_FRONTEND_VERSION }
// ⭐⭐ CBC-FMT — `calc_bars_count`: ONE window for both lanes (`engine/calcBarsWindow.js`), read
// off the document's own stamp (`meta.calcBarsCount`, `pine.js::declarationCalcBars`).
import { rememberRuntimeBudgetStop, runtimeBudgetStopAt, runtimeBudgetGeneration, onRuntimeBudgetStopsChange, resetRuntimeBudgetStops } from '../runtimeBudgetStops.js'
import { calcBarsWindowOf, widenToChart, windowContext, withCalcBarsRecord,
  CALC_BARS_REQUEST_GUARD, CALC_BARS_REQUEST_SOURCE, calcBarsRequestSentence } from '../calcBarsWindow.js'
import { strippedForScan, withTranslateClock } from '../ast/pine.js'
import { withAmbientRunClock } from './vm.js'
import { dailyExpressionAdmitted } from '../dailyExpressionGate.js'

// ─── ⭐⭐ W5-T2 — EVERY WALL CLOCK A RUN READS IS THE HOST'S TO INJECT (design 2.2 H5) ──
// `opts.now` reaches the pane budget, the VM's `WALL_TIME` and the translator's
// `pine:timeout` (`withTranslateClock`). Absent, each reads the host's own clock, LATE,
// from this ONE default. ⛔ A clock is a safety stop and never a verdict (ruling R3):
// what a script computes is decided by the instruction budgets (`limits.js`).
const hostNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const clockOf = (opts) => (opts && typeof opts.now === 'function' ? opts.now : (MEMBER_DOOR_CLOCK || hostNow))

// ─── ⭐⭐ ENGINE 94 — THE MEMBER DOOR'S OWN RUNS ARE BOUNDED BY INSTRUCTIONS, NOT BY TIME ─────────
// The member door (`memberPaneDefinition`) compiles and runs the script to DECIDE its document: the object-runtime
// check, the program probe, the colour-input probe. Their runs read the host's clock (the VM's `WALL_TIME`, a run's
// budget), so a busier machine stopped a probe earlier and the door answered a different document
// (measured, batchF 2026-11-21: slowing only `performance.now` 3x changed a served script's drawing). Inside the door's
// call (`withMemberDoorClock`) every runtime clock is the door's: one that never moves, so the instruction limits
// (`limits.js`) bound those runs, the same on every machine. Painting a chart is NOT the door: the pane's own budget
// (`RUNTIME_PANE_TIME_BUDGET_MS`) and every run outside the door read the host's clock as before.
let MEMBER_DOOR_CLOCK = null
const STILL = () => 0
/** Runs `fn` (the member door's call) with every runtime clock still (`STILL`); nesting-safe. ⛔ The translator's own
 *  windows inside the call keep the host's clock: they are the last-resort stop, whole-call and by name. */
export function withMemberDoorClock(fn) {
  const prior = MEMBER_DOOR_CLOCK
  MEMBER_DOOR_CLOCK = STILL
  try {
    return withAmbientRunClock(STILL, fn)
  } finally {
    MEMBER_DOOR_CLOCK = prior
  }
}
const injectedNow = (opts) => (opts && typeof opts.now === 'function' ? { now: opts.now } : {})

/** ⭐⭐ C23 — THE RUNTIME LANE SERVES A CHART PANE, NEVER A SCREEN, from every
 *  door in this module: a runtime pane's columns and an object pass's values are
 *  both drawn on ONE symbol's chart. `pane` hands the columnar resolver the host
 *  lane's pane contract (`buildRuntimeIr`'s `resolverOpts`), so `barstate.isfirst`,
 *  the forming-bar clock and `timeframe.change` are the plot lane's own columns.
 *  The two COMPILE checks build over no bars before a symbol is chosen, so they
 *  also leave what a symbol settles (`syminfo.mintick`) to the binding
 *  (`symbolAtBind`); every build with bars carries the chart's symbol instead. */
const COMPILE_ON_A_PANE = Object.freeze({ pane: true, symbolAtBind: true })

/** The chart's symbol as the binder hands it, or undefined — the SAME object the object
 *  reader folds its trees with (`objectColumns.js` `bindConstsFor({… symbol: opts.symbol})`),
 *  so a run and the trees beside it settle `syminfo.*` from one symbol.
 *  ⭐ RS RATING L3 — every field the fold reads (`bind.js::BIND_SYMBOL_FIELDS`: ticker,
 *  exchange, and the classification fields industry / sector / securityType). This copied
 *  `{ticker, exchange}` only, so a run refused `syminfo.industry` the host lane settled. */
const symbolOf = (ctx) => (ctx && ctx.symbol && typeof ctx.symbol === 'object'
  ? { ticker: ctx.symbol.ticker, exchange: ctx.symbol.exchange, ...bindSymbolOf(ctx.symbol),
    // ⭐⭐ (2026-11-20) the listing facts, for the run's keys (`symbolKey`); the fold reads neither
    ...(typeof ctx.symbol.firstTradeDate === 'string' ? { firstTradeDate: ctx.symbol.firstTradeDate } : {}),
    ...(ctx.symbol.firstTradeDatePending === true ? { firstTradeDatePending: true } : {}) } : undefined)
/** ⛔ The run caches key on this, so a field the fold reads is in it: two charts of one ticker
 *  whose classification differs must not share a run. Unchanged for a symbol without one. */
const symbolKey = (s) => {
  if (!s) return '-'
  const cls = ['industry', 'sector', 'securityType'].map((f) => (s[f] == null ? '' : String(s[f])))
  // ⭐⭐ (coordinator ruling 2026-11-20) — and the listing facts the own-daily read rests on (`requestSupply.js::
  // aboveChartRead`): ⚰️ CAPTURED (ipocold-bgin), a run refused while the date was out was served from this key's memo
  // after the date landed, and the chart stayed refused. Absent both, the key is unchanged byte for byte.
  const listing = typeof s.firstTradeDate === 'string' ? `^${s.firstTradeDate}` : s.firstTradeDatePending === true ? '^?' : ''
  return `${s.ticker}@${s.exchange}${cls.some((v) => v !== '') ? `#${cls.join('#')}` : ''}${listing}`
}

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
  const tooBig = sourceSizeRefusal(source)
  if (tooBig) return { ok: false, refusal: { guard: RUNTIME_LIMIT_GUARD, message: tooBig, limit: 'PROGRAM_SIZE' } }
  let built
  try {
    // ⭐ RT5 — `objectsInRun`: the build that DRAWS its own objects instead of
    // handing them to the host object pass (`objectTrees: []`).
    built = buildRuntimeIr(String(source || ''), {
      bars: [], inputs: {}, ...(objectsInRun ? { objectsInRun: true } : { objectTrees: [] }),
      ...COMPILE_ON_A_PANE, ...runtimeClockOpts(false),
      // ⭐ P3 WS-F (review M3) — the PANE's compile check: the pane runs with its ledger
      realtimeLedger: true,
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
    // ⭐ RS RATING L5 — the host's reading of each request (`pineRuntimeFrontend.js`), so the
    // member door can ask whether a run's requests are servable by the host's rules
    requestTargets: (program.requests || []).map((r) => r.target || null),
    // ⭐ RT5 — how many drawing operations the build lowered (0 unless asked).
    objectOps: (program.objectOps || []).length,
    // ⭐⭐ ENGINE 54 — each drawing-making op's source call and family (`objectSiteKey`), so the
    // member door can prove every host create site has the same call in the run.
    objectSites: (program.objectOps || []).filter((o) => typeof o.site === 'string')
      .map((o) => ({ site: o.site, fn: o.fn })),
    // ⭐⭐ W9-T11 — the program holds a strategy broker (only when the broker gate is on:
    // `buildRuntimeIr` retries into broker mode only then), so the member door stamps the
    // document `STRATEGY_WINDOW_HISTORY`.
    broker: !!program.broker,
    // ⭐ SERVE OR REFUSE BY NAME (2026-11-17) — with the broker gate on, a strategy whose broker build refused and whose
    // plain build stands (`buildRuntimeIr` `brokerDeclined`): the member door names it on the pane. Absent otherwise,
    // so every other probe answers exactly as before.
    ...(built.brokerDeclined ? { brokerDeclined: { guard: built.brokerDeclined.guard || null,
      message: String(built.brokerDeclined.message || '').slice(0, 400) } } : {}),
    // ⭐⭐ U15 — the library versions the build linked, each by the sha256 of the code it
    // compiled (`pineLibraries.js`): the member door pins them on the document. Absent unless
    // the script imports one, so every other probe answers exactly as before.
    ...(Array.isArray(built.libraries) && built.libraries.length ? { libraries: libraryPinsOf(built.libraries) } : {}),
  }
}

/** ⭐⭐ U15 — `[{path, sha256}]`, sorted by path: a document's library pins (`meta.libraries`). */
export function libraryPinsOf(libraries) {
  return (Array.isArray(libraries) ? libraries : [])
    .filter((l) => l && typeof l.path === 'string' && typeof l.sha256 === 'string')
    .map((l) => ({ path: l.path, sha256: l.sha256 }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** ⭐⭐ U15 — what a run hands the front end about libraries: the document's pins (a changed
 *  library is refused by name, `pine:library-changed`). The ENTRIES come from the registry,
 *  in the browser and on the server alike (the service registers a job's verified entries
 *  for that one run, `services/pine_runtime/job.mjs`), so both build the same call. */
function libraryBuildOpts(pins) {
  return Array.isArray(pins) && pins.length ? { libraryPins: pins } : {}
}

/** ⭐⭐ UIE PHASE 3 (M4) — WHICH COLOUR INPUTS THE RUN ACTUALLY READS.
 *
 *  A colour input is a setting only where the member's colour changes what is drawn.
 *  Measured, not inferred: the program is built (as the pane builds it, over no bars) at
 *  the author's defaults and again with each colour input replaced by a SENTINEL colour
 *  (`inputDefaults`, `pineRuntimeFrontend.js::applyMemberDefault`); an input whose
 *  sentinel changes what the document DRAWS is read by the run. Two probes:
 *    * STRUCTURAL, for everything but plot colours: the program built WITHOUT plot
 *      colour outputs (`plotColours: false`) lowers differently — the run's own
 *      drawings, tables, gradients, bar colours read it, on whatever bar they run;
 *    * a RUN, for a plot's per-bar colour: the colour columns the document draws
 *      (`outputs`, the indices it maps), over a short synthetic series. ⛔ Not the
 *      program alone: the pane's build emits EVERY plot's `color =` as an output, a
 *      fixed one included, and a plot's fixed colour is that plot's own Style colour,
 *      not this input's. ⚠️ A per-bar colour reached only on bars the series never makes
 *      is missed — the conservative direction, a knob not offered.
 *  @returns {Set<string>} the keys the run reads. Never throws. */
export function colourInputsTheRunReads(source, keys, { objectsInRun = false, outputs = [] } = {}) {
  const N = 160
  const rows = Array.from({ length: N }, (_, i) => {
    const c = 100 + 6 * Math.sin(i / 5) + 3 * Math.sin(i / 2.3) + (i % 40 < 20 ? i * 0.05 : -i * 0.05)
    return { t: 1600000000 + i * 86400, o: c - Math.sin(i), h: c + 1.5, l: c - 1.5, c, v: 1000 + (i % 7) * 50 }
  })
  const objects = objectsInRun ? { objectsInRun: true } : { objectTrees: [] }
  const structural = (inputDefaults) => {
    try {
      const built = buildRuntimeIr(String(source || ''), {
        bars: [], inputs: {}, inputDefaults, ...objects, ...COMPILE_ON_A_PANE, ...runtimeClockOpts(false),
        realtimeLedger: true,   // the pane's program, measured on closed history (`varip` is `var` there)
      })
      if (!built.ok) return null
      const p = lowerIrProgram(built.ir, { historyFromListing: true })
      return JSON.stringify([Array.from(p.code), p.consts, p.colourOps, p.objectOps, p.textOps])
    } catch { return null }
  }
  const perBar = (inputDefaults) => {
    if (!outputs.length) return ''
    try {
      const built = buildRuntimeIr(String(source || ''), {
        bars: rows, inputs: {}, inputDefaults, ...objects,
        pane: true, plotColours: true, tf: 'D', basePeriod: 'D', ...runtimeClockOpts(false, { tf: 'D' }),
        realtimeLedger: true,
      })
      if (!built.ok || (built.ir.requests || []).length) return null
      const program = lowerIrProgram(built.ir, { historyFromListing: true })
      const res = execute(program, {
        bars: N, series: ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(rows.map((b) => b[k]))),
        columns: program.columns, confirmed: true, barTimes: rows.map((b) => b.t),
      })
      return JSON.stringify(outputs.map((i) => Array.from(res.outputs[i] || [])))
    } catch { return null }
  }
  const out = new Set()
  const baseS = structural({})
  const baseR = perBar({})
  for (const k of keys || []) {
    for (const sentinel of ['#010203', '#030201']) {
      const s = baseS === null ? null : structural({ [k]: sentinel })
      const r = baseR === null ? null : perBar({ [k]: sentinel })
      if ((s !== null && s !== baseS) || (r !== null && r !== baseR)) { out.add(k); break }
    }
  }
  return out
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

/** ⭐⭐ (Fred RS filled chart, coordinator ruling 2026-11-19, engine 84) — THE BUDGET OF A RUN IN THE WORKER
 *  SCALES WITH THE BARS IT COVERS. 1,000 ms is a whole-run number that an honest script crosses through chart LENGTH
 *  alone, and the budget's own record (RT1, above) says its job is to bound a RUNAWAY, not to cap honest long work.
 *    budget(n) = min(12,000, 1,000 + 1.0 x max(0, n - 5,000)) ms, `n` the bars the run COVERS (the rows after the
 *  depth cut, a `calc_bars_count` or strategy window's own): 1,000 up to 5,000 bars (today's behaviour), 4,000 at
 *  8,000, 7,520 at 11,520, 12,000 from 16,000 bars.
 *    ⭐⭐ (engine 86, coordinator ruling: option A2) THE SLOPE IS 1.0 MS A BAR AND THE CEILING 12,000 ms (engine 84 shipped
 *  0.35 and 4,000), AND IN THE WORKER THE VM'S `WALL_TIME` FOLLOWS THIS BUDGET (`runLimitsOf`). Measured: Fred RS's run
 *  half on 5m (11,520 bars covered) costs about 2 s on the desktop (0.17 ms a bar), 7.5-8.2 s in-process on a CI runner
 *  (0.67-0.73) and an estimated 5.3-5.7 s on a member's device (0.47-0.49, 2.9x desktop, the e81 ratio). At 0.35 the
 *  budget sat below that cost at EVERY bar count (3,282 ms at 11,520), so it was refused live, and the refusal was run
 *  cold again on every update. A2 proposed 1.2 (8,824 ms at 11,520, 1.05x the CI cost); the FINAL slope (coordinator
 *  ruling, the engine 86 train) is the formula's floor, 1.0 (7,520 ms at 11,520): the live engine-85 run-half
 *  timing on 5m was about 0.05-0.07 ms a bar, and x 1.5, rounded up to 0.1, is below the floor of 1.0.
 *    WHY THE CEILING ALONE WAS NOT ENOUGH (found building it): the ceiling binds only past 16,000 bars, and the VM's
 *  `WALL_TIME` (5,000 ms, `limits.js`) stops any one execute past 5 s first, so a budget above 5 s was not real.
 *  The worker's run now hands the VM `WALL_TIME` = its budget when the budget is larger (`runLimitsOf`); every other
 *  caller keeps 5,000 (the main-thread doors, the service, the limits census, a test harness).
 *    What a long budget costs is bounded elsewhere now: a stale run is STOPPED (`runtimeAsync.js`: a symbol or
 *  timeframe switch terminates it, a hidden tab computes nothing), and a stop the budget made is not re-run on the
 *  next bars (`runtimeBudgetStops.js`, Retry on the strip).
 *    WHY 0.35 MS A BAR, MEASURED (desktop, 2026-11-19, engine 83 with the depth cut, the array-operation ceiling and
 *  the session-day memo): Fred RS's run half on a filled 5m extended-hours chart covers 11,520 bars and spends
 *  1,029 ms of what this budget counts (A's whole run, 619, and B's VM, 410: `computeOffListing`); 60m (8,000 bars)
 *  about 670. The heaviest SERVED corpus script on SPY 1D costs 68 us a bar (one run), the p95 44, the median 5.5. ⚠️
 *  The e81 live worker log puts a member's device at about 2.9x this desktop (its pre-VM work took 2.66-2.81 s where
 *  this machine takes about 0.94 s): an ESTIMATE, to be confirmed by the live timing after engine 83, and the margin
 *  resized against the confirmed number. 1,000 + 0.35 x 6,520 = 3,282 ms is 3.2x this desktop's 1,029.
 *    WHAT STILL STOPS A RUNAWAY, unchanged: `INSTRUCTIONS_PER_BAR` (one bar), the whole-run counts and `MEMORY`
 *  (`limits.js`), this budget's own 12,000 ms ceiling (in the worker `WALL_TIME` is this budget; elsewhere 5,000 ms per
 *  `execute`), and the worker watchdog (`runtimeAsync.js`, 20 s).
 *    ⛔ WORKER ONLY (`opts.budgetScales`, passed by `runtimeWorker.js` alone): a run on the MAIN thread (the
 *  synchronous door, `runtimeAsync.js::runHere` where a browser has no Worker, the server entry) keeps 1,000 ms, since
 *  there a longer run is a frozen page. */
export const RUNTIME_PANE_BUDGET_FLOOR_BARS = 5000
export const RUNTIME_PANE_BUDGET_PER_BAR_MS = 1.0
export const RUNTIME_PANE_BUDGET_CEILING_MS = 12000
/** The worker's budget for a run covering `bars` bars, `floorMs` the per-run number (1,000). */
export function runtimePaneBudgetFor(bars, floorMs = RUNTIME_PANE_TIME_BUDGET_MS) {
  const over = Number.isInteger(bars) ? Math.max(0, bars - RUNTIME_PANE_BUDGET_FLOOR_BARS) : 0
  return Math.max(floorMs, Math.min(RUNTIME_PANE_BUDGET_CEILING_MS, floorMs + RUNTIME_PANE_BUDGET_PER_BAR_MS * over))
}
/** The budget this run is held to: scaled by the bars it covers when its caller asked (`budgetScales`), else as
 *  passed. Read where the run's rows are final, once: the curtain hands its two runs fixed numbers. */
const budgetFor = (opts, bars) => (opts && opts.budgetScales === true && Number.isFinite(opts.budgetMs)
  ? runtimePaneBudgetFor(bars, opts.budgetMs) : (opts ? opts.budgetMs : undefined))
/** ⭐⭐ (engine 86, option A2) — THE LIMITS A RUN HANDS THE VM. In the worker (a run whose budget scales,
 *  `budgetScales`, and the curtain's two runs of one, `wallFollowsBudget`) the VM's `WALL_TIME` is the run's budget
 *  where that is the larger, or a budget above 5,000 ms would be stopped at 5,000 by the VM first. Every other caller
 *  hands exactly what it was handed (`opts.limits`: nothing, so `DEFAULT_LIMITS`, or a measurement's named limits),
 *  and a limit a caller NAMES always wins. */
export function runLimitsOf(opts, budgetMs) {
  const named = opts ? opts.limits : undefined
  const follows = !!opts && (opts.budgetScales === true || opts.wallFollowsBudget === true)
  if (!follows || !Number.isFinite(budgetMs) || budgetMs <= DEFAULT_LIMITS.WALL_TIME) return named
  if (named && Object.prototype.hasOwnProperty.call(named, 'WALL_TIME')) return named
  return { ...(named || {}), WALL_TIME: budgetMs }
}

/** The guard a run that passes the budget carries. */
export const RUNTIME_TIME_BUDGET_GUARD = 'runtime:time-budget'

/** ⭐ RF — the guard a run stopped by one of the VM's declared limits carries. */
export const RUNTIME_LIMIT_GUARD = 'runtime:limit'

/** ⭐ RF — the guard a run that threw something unexpected carries. */
export const RUNTIME_FAILED_GUARD = 'runtime:failed'

/** ⭐⭐ P1 HARDENING (2026-10-11) — WHAT THE DOCUMENT SAYS, NOT JUST WHO IT IS.
 *
 *  ⛔ `compute.fn` on a runtime document is `runtime:<id>` (`memberPaneDefinition`),
 *  a NAME, not a content hash — so a key built from `id` and `fn` alone served the
 *  previous columns for an edited script over the same bars array. Every field the
 *  run READS is fingerprinted here: the source, the plot→output map, whether the
 *  run owns its drawings, the listing-history rule, and the document's version.
 *  ⭐ Memoised per definition OBJECT (definitions are replaced, never mutated in
 *  place, on every edit and reload), so a large script is hashed once, not per paint. */
const _contentKey = new WeakMap()
function fnv1a(str, seed) {
  let h = seed >>> 0
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}
export function runtimeContentKey(def) {
  if (!def || typeof def !== 'object') return 'none'
  const known = _contentKey.get(def)
  if (known) return known
  const compute = def.compute || {}
  const text = JSON.stringify([
    String(compute.source || ''),
    compute.outputs || null,
    compute.objects === true,
    (def.meta && def.meta.runtimeHistory) || null,
    Number.isInteger(def.version) ? def.version : null,
    // ⭐ ROUTE BY COST (Engine 73 (#1711)) — the library code the run LINKS (U15's pins, `meta.libraries`):
    // the same script over the same bars linked against another library is another answer. ⚰️ Without
    // it an incremental session (`_sessions`) compiled against one library was resumed for a document
    // pinned to another (`vendorHarness.capRound4`'s control, once the cost route put it on this lane).
    (def.meta && Array.isArray(def.meta.libraries) && def.meta.libraries.length) ? def.meta.libraries : null,
  ])
  // Two independent 32-bit passes plus the length: a collision needs all three to agree.
  const key = `${text.length.toString(36)}.${fnv1a(text, 0x811c9dc5).toString(36)}.${fnv1a(text, 0x9e3779b9).toString(36)}`
  _contentKey.set(def, key)
  return key
}

/** The memo key for one run: the definition, its compute handle, its CONTENT, and
 *  everything in `ctx` that changes the answer (the clock, the symbol, the listing fact). */
function runKey(def, ctx, withSupply = true) {
  const compute = (def && def.compute) || {}
  const tf = ctx && typeof ctx.tf === 'string' ? ctx.tf : undefined
  const forming = newestBarIsFormingFrom(ctx)
  const listing = !!(ctx && ctx.historyFromListing === true)
  // ⭐ UIE PHASE 2 (M4) — the member's settings are part of what a run computed
  const given = ctx && ctx.runtimeInputs && typeof ctx.runtimeInputs === 'object' ? ctx.runtimeInputs : null
  const settings = given && Object.keys(given).length ? JSON.stringify(given) : ''
  // ⭐ P3 WS-F (re-review L1) — a FRAMED instance refuses a `varip` (its window slides) where a
  // plain chart runs it, so the two are different answers and never share a memo entry or a
  // session. (`opts.slidingWindow` never reaches this key: it is set only inside the calc_bars
  // window's own run, which keys its session apart, `|slides`.)
  const framed = ctx && ctx.framed === true ? '|framed' : ''
  // ⭐⭐ W9-T11 — a broker run's window (`ctx.historyWindowBars`) decides which bars it trades
  const hw = ctx && Number.isInteger(ctx.historyWindowBars) ? `|hw${ctx.historyWindowBars}` : ''
  // ⭐⭐ (2026-11-19) and the depth it is served at without [B-START-DEEP] (a different depth is a different answer)
  const ld = ctx && Number.isInteger(ctx.listingDepthBars) ? `|ld${ctx.listingDepthBars}` : ''
  // ⭐ U-DAILY (e96, part B) — a run made with the daily-expression capability open is another run (its session, its
  // memo): unchanged while it is closed, as committed (`dailyExpressionGate.js`)
  const dx = dailyExpressionAdmitted() ? '|dx' : ''
  return `${def && def.id}|${compute.fn}|${runtimeContentKey(def)}|${tf}|${forming}|${symbolKey(symbolOf(ctx))}|${listing}|${settings}${framed}${hw}${ld}${dx}${withSupply ? requestSupplyKey(compute, ctx) : ''}`
}

/** ⭐ RS RATING L5 — what a run that reads requested bars computed FROM: the chart's other-
 *  symbol cache (`requestSupply.js` decides from it), so a series that lands or changes is a
 *  new run, never the memo of the run that was still waiting for it. '' for a script with no
 *  request (its key is unchanged byte for byte). */
function requestSupplyKey(compute, ctx) {
  // ⭐⭐ T4 E2 — and the chart's own corporate events (`request.earnings` / `dividends` / `splits`, read through the same
  // other-symbol supply under `pineEvents.EVENTS_KEY`)
  if (!/\brequest\.(security|seed|earnings|dividends|splits|financial)\b/.test(String((compute && compute.source) || ''))) return ''
  const sec = ctx && ctx.secondary && typeof ctx.secondary.entries === 'function' ? ctx.secondary : null
  if (!sec) return '|req-'
  const parts = []
  for (const [k, e] of sec.entries()) {
    const bars = e && Array.isArray(e.bars) ? e.bars : []
    const last = bars.length ? bars[bars.length - 1] : null
    // ⭐ RS RATING L11 PR 2 — whether its session is in progress decides what the chart's newest bar reads
    // (`otherSymbols.newestOwnPeriodOf`): the close flips it with the bars unchanged, and that is a new run
    parts.push(`${k}:${(e && e.status) || ''}:${bars.length}:${last ? `${last.t}/${last.c}` : ''}`
      + `${e && e.newestBarIsForming === true ? ':forming' : ''}`
      // ⭐⭐ e98 — the chart's session (`otherSymbols.CHART_SESSION_KEY`, no bars): it moves a custom timeframe's grid
      + `${e && e.extended === true ? ':eth' : ''}`
      // ⭐⭐ T4 E2 — the events entry (no bars): its answer's refresh and its symbol
      + `${(k === EVENTS_KEY || k === FINANCIAL_KEY) && e ? `:r${e.rev || ''}:s${e.symbol || ''}` : ''}`)
  }
  return `|req${parts.sort().join(',')}`
}

/** ⭐⭐ P1 HARDENING — `PROGRAM_SIZE` (`limits.js`): the source's UTF-8 bytes, asked
 *  BEFORE the front end is handed it, at every door that builds a script. Returns the
 *  sentence when the source is over the ceiling, else `null`. */
export function utf8Bytes(text) {
  let n = 0
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i += 1 }
    else n += 3
  }
  return n
}
export function sourceSizeRefusal(source) {
  const bytes = utf8Bytes(String(source || ''))
  const ceiling = DEFAULT_LIMITS.PROGRAM_SIZE
  if (bytes <= ceiling) return null
  return `this script is ${bytes} bytes long, past the ${ceiling}-byte limit a script drawn bar by bar is `
    + 'read under, so it is not read at all.'
}

// ─── ⭐⭐ P1 HARDENING — VERSION AND OUTPUT-MAP INTEGRITY ─────────────────────
//
// A runtime document stores its SOURCE and an index map (`compute.outputs`: plot key
// → the runtime output at that index). Nothing recorded which front end built that
// map or what each index pointed at, so a later front end that ordered outputs
// differently would silently draw one plot's column under another's name. The
// member door now stamps both; every run re-checks them. A document minted before
// this (no stamp) runs exactly as before — the check is additive.

/** The guard a run refused for a version or output-map mismatch carries. */
export const RUNTIME_VERSION_GUARD = 'runtime:version'

/** What each runtime output IS, in order: its `call`, plus the plot id or role it
 *  carries when it has one — enough that a reorder or a re-meaning changes it. */
export function runtimeOutputSignature(outputs) {
  return (outputs || []).map((o) => [o && o.call, o && (o.role || o.plot || o.id || null)]
    .filter((x) => x !== null && x !== undefined).join(':'))
}

/** The fields the member door stamps on `meta` at mint. */
export function runtimeVersionStamp(probeOutputs) {
  return {
    runtimeLanguage: RUNTIME_FRONTEND_LANGUAGE,
    runtimeFrontend: RUNTIME_FRONTEND_VERSION,
    runtimeIr: RUNTIME_IR_VERSION,
    runtimeOutputSignature: runtimeOutputSignature(probeOutputs),
  }
}

/** The sentence when `def` cannot be run by THIS engine as minted, else `null`. */
export function runtimeVersionRefusal(def, programOutputs) {
  const meta = (def && def.meta) || {}
  const lang = meta.runtimeLanguage
  if (lang !== undefined && lang !== RUNTIME_FRONTEND_LANGUAGE) {
    return `this script is stored as ${JSON.stringify(lang)}, and the only language this engine draws bar `
      + `by bar is ${RUNTIME_FRONTEND_LANGUAGE}, so it is not run.`
  }
  for (const [field, have] of [['runtimeFrontend', RUNTIME_FRONTEND_VERSION], ['runtimeIr', RUNTIME_IR_VERSION]]) {
    const want = meta[field]
    if (want !== undefined && !(Number.isInteger(want) && want >= 1 && want <= have)) {
      return `this script was saved by a newer version of the bar-by-bar engine (${field} ${JSON.stringify(want)}, `
        + `this one is ${have}), so it is not run rather than computed by rules it was not written for.`
    }
  }
  const sig = meta.runtimeOutputSignature
  if (Array.isArray(sig)) {
    const now = runtimeOutputSignature(programOutputs)
    const outputs = (def.compute && def.compute.outputs) || {}
    for (const [plotKey, index] of Object.entries(outputs)) {
      if (sig[index] !== now[index]) {
        return `this script's plot \`${plotKey}\` was saved as output ${index} (${sig[index] || 'none'}) and this `
          + `engine now builds ${now[index] || 'nothing'} there, so it is not drawn rather than drawn under the `
          + 'wrong name. Re-attaching the script rebuilds it.'
      }
    }
  }
  return null
}

/** ⭐⭐ (2026-11-20) the overnight tail's cut, refusal-shaped so every caller between the supply and
 *  `computeRuntimeColumns` passes it up untouched. */
function overnightCutError(cutAt, series, tail = null) {
  const err = tail ? refusal(tail.guard, tail.message) : refusal(REQUEST_OVERNIGHT_GUARD, 'the newest bars are overnight trading')
  err.cutAt = cutAt
  err.overnightSeries = Array.isArray(series) ? series : []
  if (tail) { err.tailWait = true; err.tailPending = tail.pending === true }
  return err
}
/** ⭐⭐ (e91 (2b)) the tail a supply's refusal names (a cut at another series' newest held bar), or null. */
function tailOf(r) {
  return r && r.tailWait === true ? { guard: r.guard, message: r.message, pending: r.tailPending === true } : null
}

/** A refusal-shaped error, as `nativeRegistry.runtimeColumnsOrReasons` reads one. */
function refusal(guard, message, limit) {
  const err = new Error(message)
  err.guard = guard
  // the limit's engine NAME, for telemetry only — never in the member's sentence
  if (limit) err.limit = limit
  return err
}

/** ⭐ (e85) Tests: a drawing run whose newest bar alone is on another series' live tail withholds it as before the
 *  wait (the e85 reply after a new bar, reproduced: `tailLag.test.js`). */
let _newestTailWaitOff = false
export function __newestTailWaitOffForTests(off) { _newestTailWaitOff = !!off }

/** ⭐ (e85) A run that WAITS for other series' bars: refusal-shaped (`runtime:request`) and `pending`; a wait for other
 *  series' NEWEST bars (a live-tail lag, `requestSupply.js`) also names them (`waitingFor`: comma-separated plain
 *  text, so it crosses the worker, `errorImage.js`), and the strip says what it waits for (`nativeRegistry.js`). */
function requestWait(message, series) {
  const err = refusal('runtime:request', message)
  err.pending = true
  if (Array.isArray(series) && series.length) err.waitingFor = [...new Set(series)].join(',')
  return err
}

/** ⭐ THE MEMBER'S SENTENCE FOR A VM LIMIT — plain words, the numbers kept, no engine
 *  token (`CALL_COUNT`). Exported for its rail. */
export function runtimeLimitSentence(err, bar, total) {
  const what = LIMIT_PLAIN[err && err.limit] || 'one of the limits a script drawn bar by bar runs under'
  const n = (v) => (Number.isFinite(v) ? Number(v).toLocaleString('en-US') : String(v))
  const unit = err && err.limit === 'WALL_TIME' ? ' ms' : ''
  // ⭐⭐ (coordinator ruling 2026-11-19) a ceiling that scaled with the chart says the bars it was set for
  const forBars = err && Number.isInteger(err.coveredBars) ? ` for ${n(err.coveredBars)} bars` : ''
  return `this script went past ${what} (at most ${n(err && err.ceiling)}${unit}${forBars}, it reached `
    + `${n(err && err.reached)}${unit}) on bar ${n(bar)} of ${n(total)}, so it is stopped and nothing is drawn `
    + 'rather than part of it.'
}

/**
 * ⭐⭐ W9-T11 — THE WINDOW A STRATEGY RUN TAKES (design 3.4). A broker run trades the most
 * recent `ctx.historyWindowBars` bars of what the chart loaded, so scroll-back (more bars
 * loaded) never changes its trades. The window is the CONTEXT's: the server reads it from
 * `bars_window.HISTORY_WINDOW_BARS`; this lane holds no bar constant.
 *
 * ⛔ NOT R-W's warm-up curtain: a backtest is path-dependent, so no curtain can withhold "the
 * bars that depend on the start". A window that does not reach the listing is run with
 * `historyFromListing: false`, and the VM's own rules decide (`vm.js`: [B-START], Q-S1n).
 * A run told no window is run over every bar, and the VM refuses it by name
 * (`runtime:strategy-start`): the refusal has one author.
 * ⭐ ONE BUDGET: the windowed run is the only run, under the caller's `opts` (its time budget,
 * `limits.js`'s DEFAULT_LIMITS); nothing here adds a limit or a second clock.
 */
function computeStrategyWindow(def, rows, ctx, opts) {
  const win = ctx && ctx.historyWindowBars
  if (!(Number.isInteger(win) && win > 0) || rows.length <= win) return computeRuntimeColumnsOnce(def, rows, ctx, opts)
  const cut = rows.length - win
  let cols
  try {
    cols = computeRuntimeColumnsOnce(def, rows.slice(cut), { ...(ctx || {}), historyFromListing: false }, opts)
  } catch (err) {
    if (err && Number.isInteger(err.bar)) err.bar += cut
    // ⚠️ (e91, 2026-11-20) a supply CUT (`err.cutAt`, the overnight tail or a tail lag) found by this window run would be
    // in the WINDOW's indices and is not moved here: unreachable today, since a strategy reads no other series (broker
    // off: refused `pine:strategy-call` before its supply; broker on: `request.security` refuses broker mode,
    // `ast/strategyRepaint.js`). If the broker ever admits requests, move `cutAt` by `cut` here as `bar` is, with a rail.
    throw err
  }
  // the record is keyed by bar TIME, so it rides the widened columns unchanged
  return widenToChart(cols, cut, RUNTIME_OBJECTS_KEY)
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
/** ⭐⭐ (the e81 live capture, 2026-11-19) — the record of a run started where every requested series is known
 *  (non-enumerable): `{knownFrom, firstKnownT}` in the chart's own indices. */
export const RUNTIME_KNOWN_FROM_KEY = '__runtimeKnownFrom'
/** How many times a run may move its start for a depth gap (one per requested series that begins later). */
const KNOWN_FROM_PASSES = 4

/**
 * ⭐⭐ (the e81 live capture, 2026-11-19) — A CHART DEEPER THAN OUR DATA IS DRAWN FROM WHERE OUR DATA BEGINS.
 * ⚰️ On the served build every intraday chart's run half was refused whole: the chart's backfill reached far before
 * the first SP:SPX row our store holds (5m ~60 days, 60m 730), every bar before it was UNKNOWN, and a run that
 * carries state bar to bar refused the chart (`runtime:request`). A refusal that names ONLY such a depth gap carries
 * `knownFrom` (`requestSupply.js`); the run then starts there, as a chart whose history does not reach the listing,
 * so the off-listing two-start proof decides it (`computeOffListing`): drawn where both starts agree, withheld BY
 * NAME where they never do. Its columns are widened back to the chart (`NaN` before), its drawings shifted, and its
 * warm-up record moved by the same cut, so the run half's column rail starts after it. ⛔ A bar missing AFTER a
 * series began carries no `knownFrom` and refuses as before; a strategy is never moved (its trades would change).
 */
/** How many times a run may cut its overnight tail (one per requested series that ends earlier). */
const OVERNIGHT_PASSES = 4
let _overnightCutOff = false
/** Tests: an overnight tail refuses the whole run, as before the cut (the mutant's control). */
export function __overnightCutOffForTests(off) { _overnightCutOff = !!off }

/**
 * ⭐⭐ (coordinator ruling 2026-11-20) — THE OVERNIGHT TAIL IS CUT, NEVER WAITED FOR AND NEVER A WHOLE-RUN REFUSAL.
 * A supply whose requested series ends before an all-overnight tail of the chart (`overnightTail.js`) answers with
 * `cutAt`. The run is then computed over the bars before it (its newest bar finished: it is in the past), exactly as it
 * draws there, and widened back with the overnight bars withheld by name (`withOvernightTail`). A refusal of any other
 * kind, and a wait, are the run's answer, as before.
 */
export function computeRuntimeColumns(def, rows, ctx, opts = {}) {
  const n = Array.isArray(rows) ? rows.length : 0
  let end = n
  let series = []
  let tail = null
  let tailSeries = []
  for (let pass = 0; ; pass += 1) {
    const cut = end < n
    try {
      const cols = computeRuntimeColumnsKnown(def, cut ? rows.slice(0, end) : rows,
        cut ? { ...(ctx || {}), newestBarIsForming: false } : ctx, opts)
      if (!cut) return cols
      if (!tail) return withOvernightTail(cols, n, end, series)
      // ⭐⭐ (e91, coordinator ruling (2b), option A) — A TAIL CUT: the values are drawn up to the series' newest held bar
      // and the bars past it withheld by name; the DRAWINGS never stand on the cut bar (TradingView draws a last-bar label
      // on the chart's true newest bar): they WAIT, named, as e85's newest-tail drawings do, until the series lands
      const widened = withOvernightTail(cols, n, end, series, { code: tail.guard, reason: tail.message })
      if (!(def && def.compute && def.compute.objects)) return widened
      return withRuntimeObjects(widened, { status: 'WITHHELD', live: [], guard: tail.guard, reason: tail.message,
        ...(tail.pending ? { pending: true, waitingFor: tailSeries.join(',') } : {}) })
    } catch (err) {
      const at = err && Number.isInteger(err.cutAt) ? err.cutAt : 0
      if (_overnightCutOff || pass + 1 >= OVERNIGHT_PASSES || at < 1 || at >= end) throw err
      end = at
      series = [...new Set([...series, ...(Array.isArray(err.overnightSeries) ? err.overnightSeries : [])])]
      if (err.tailWait === true) {
        // several series' tails, one cut each: the cut names them all; a lag past the bound is the answer for all (a
        // wait only when every one is within it), and its own sentence is kept
        const named = Array.isArray(err.overnightSeries) ? err.overnightSeries : []
        tailSeries = [...new Set([...tailSeries, ...named])]
        const pending = err.tailPending === true && (!tail || tail.pending)
        tail = pending ? { guard: err.guard, message: tailCutSentence(tailSeries), pending: true }
          : tail && !tail.pending ? tail
            : { guard: err.guard, message: String(err.message || ''), pending: false }
      }
    }
  }
}

/** The run over `rows`, its start moved past a depth gap (`knownFrom`) where one is named. */
function computeRuntimeColumnsKnown(def, rows, ctx, opts = {}) {
  const strategy = !!(def && def.meta && def.meta.runtimeHistory === STRATEGY_WINDOW_HISTORY)
  let cut = 0
  // ⭐⭐ T4 E2 — the words for the bars the depth cut withholds, when the depth has its own (an event family's record)
  let why = null
  for (let pass = 0; ; pass += 1) {
    // ⭐⭐ (Fred RS filled chart, item 1) — WHERE THE CHART BECOMES KNOWN, ASKED BEFORE THE RUN BUILDS OVER IT
    // (`knownFromBeforeBuild`): the move this pass would make on a depth refusal is made without the build over
    // bars the run never draws, under the same limits (a strategy never moves; at most `KNOWN_FROM_PASSES`; never
    // to the last bar). A probe that finds no depth gap leaves the pass exactly as before.
    // ⭐ PERF (a resumed tick) — ONE rows array and ONE ctx a pass, so the run can take the probe's supply over them
    const passRows = cut ? rows.slice(cut) : rows
    const passCtx = cut ? { ...(ctx || {}), historyFromListing: false } : ctx
    let passOpts = opts
    if (!strategy && pass + 1 < KNOWN_FROM_PASSES) {
      const seen = {}
      const k = knownFromBeforeBuild(def, passRows, passCtx, opts, seen)
      // ⭐⭐ (2026-11-20) an overnight tail the probe found is cut before the run builds over it (`computeRuntimeColumns`)
      if (Number.isInteger(seen.cutAt) && seen.cutAt > 0) throw overnightCutError(cut + seen.cutAt, seen.overnightSeries, seen.tail)
      if (k > 0 && cut + k < rows.length - 1) { cut += k; if (seen.knownFromWhy) why = seen.knownFromWhy; continue }
      if (seen.supply) passOpts = { ...opts, probedSupply: seen.supply }
    }
    try {
      const cols = computeRuntimeColumnsAll(def, passRows, passCtx, passOpts)
      return cut ? fromKnownDepth(cols, cut, rows[cut], why) : cols
    } catch (err) {
      const k = err && Number.isInteger(err.knownFrom) ? err.knownFrom : 0
      if (strategy || pass + 1 >= KNOWN_FROM_PASSES || k <= 0 || cut + k >= rows.length - 1) {
        if (cut && err && Number.isInteger(err.bar)) err.bar += cut
        if (cut && err && Number.isInteger(err.cutAt)) err.cutAt += cut
        throw err
      }
      cut += k
      if (err.knownFromWhy) why = err.knownFromWhy
    }
  }
}

// ─── ⭐⭐ (Fred RS filled chart, item 1) — A CHART DEEPER THAN ITS REQUESTED SERIES IS CUT BEFORE IT IS BUILT OVER ──
//
// MEASURED (the e81 live worker log, and the filled-chart timing on the e83 head): a member's 5m chart fills to
// 20,001-27,871 bars, our store holds ~60 sessions of SP:SPX 5m, and the run reached its depth refusal only after
// building over EVERY bar: the front end evaluates every precomputed column over the whole chart before the supply is
// asked, then the supply refuses with `knownFrom` and the run is built again from there. The first build over the
// bars before `knownFrom` is work for bars the run never draws and never reads.
// So the supply is asked FIRST, with the requests a bar-free build reads (`program.requests`: the targets are the
// host's reading of the source and settings, and read no bar), whenever a requested series could begin after the
// chart's first bar (`depthGapPossible`, from the other-symbol cache alone, no build). Only a DEPTH refusal
// (`knownFrom`) moves the start; any other answer (served, pending, a refusal of another kind, a probe build that
// does not stand) leaves the pass to the run, exactly as before.
// ⭐ (coordinator ruling 2026-11-19) A refusal raised ONLY by bars before `knownFrom` (a column the front end refuses
// over them, the bar count's class of the whole chart) is about bars the run never draws and never reads: dropping
// it is honest, not a loosening. A refusal from bars INSIDE the drawn span still fires (the run's own build over
// them). engine 84.
let _knownFromProbeOff = false
/** Tests / timing: build over the whole chart first, as before (the identity rails compare both ways). */
export function __knownFromProbeOffForTests(off) { _knownFromProbeOff = !!off }
const firstTimeOf = (bars) => (Array.isArray(bars) && bars.length && bars[0] ? bars[0].t : undefined)
/** Could a requested series begin after the chart's first bar? Read from the other-symbol cache alone: an entry whose
 *  first bar is later than the chart's (or whose key kind cannot be compared with it) says yes. */
function depthGapPossible(rows, ctx) {
  const sec = ctx && ctx.secondary && typeof ctx.secondary.values === 'function' ? ctx.secondary : null
  const first = firstTimeOf(rows)
  if (!sec || first === undefined) return false
  for (const e of sec.values()) {
    const t = firstTimeOf(e && e.bars)
    if (t === undefined) continue
    if (typeof t !== typeof first || t > first) return true
  }
  return false
}
// ⭐ PERF (a resumed tick, 2026-11-19) — THE BAR-FREE BUILD, ONCE PER DOCUMENT AND CONTEXT. A resumed 5m tick of Fred RS's
// run half took ~116 ms, ~60 of it this probe's two bar-free builds (one a pass): the build reads no bar (`bars: []`),
// so its requests are a function of the source and the build options alone, and they are kept per both, spelled out
// whole (`JSON.stringify`: the options are plain data; one holding a function is never kept). Only a build that STOOD
// is kept: one that did not (a translator timeout under a slow clock) is built again next time, as before.
const _probeSites = new Map()
const PROBE_SITES_CAP = 32
let _probeMemoOff = false
/** Tests: build every probe afresh, as before (the identity rails compare both). */
export function __knownFromProbeMemoOffForTests(off) { _probeMemoOff = !!off }
function probeSitesOf(source, buildOpts, listing, now) {
  let key = null
  if (!_probeMemoOff) {
    try {
      key = JSON.stringify([source, listing, buildOpts], (k, v) => {
        if (typeof v === 'function') throw new Error('a build option that is a function is not kept')
        return v
      })
    } catch { key = null }
    if (key !== null && _probeSites.has(key)) return _probeSites.get(key)
  }
  const built = withTranslateClock(now, () => buildRuntimeIr(source, { ...buildOpts }))
  if (!built || !built.ok) return null
  const program = lowerIrProgram(built.ir, { historyFromListing: listing })
  const sites = program.requests || []
  if (key !== null) {
    if (_probeSites.size >= PROBE_SITES_CAP) _probeSites.delete(_probeSites.keys().next().value)
    _probeSites.set(key, sites)
  }
  return sites
}
/** The first chart bar every requested read is known from, when the run would be refused for a DEPTH gap alone,
 *  asked of the supply with a bar-free build's requests; or 0. Never throws. */
export function knownFromBeforeBuild(def, rows, ctx, opts = {}, seen = null) {
  if (_knownFromProbeOff || !Array.isArray(rows) || rows.length < 2) return 0
  const compute = (def && def.compute) || {}
  const source = String(compute.source || '')
  if (!/\brequest\.(security|seed|earnings|dividends|splits|financial)\b/.test(source) || !depthGapPossible(rows, ctx)) return 0
  if (opts.slidingWindow === true || !!(ctx && ctx.framed === true)) return 0
  try {
    const slides = false
    const sessionKey = opts.incremental === false || opts.limits ? null : 'probe'
    const sites = probeSitesOf(source, runtimeIrOptions(def, [], ctx, { sessionKey, slides }),
      !!(ctx && ctx.historyFromListing === true), opts.now)
    if (!sites || !sites.length) return 0
    // the ctx the run's first supply is asked with: off the listing, the curtain's (`computeOffListing`)
    const offListing = !!(def && def.meta && def.meta.runtimeHistory === 'listing') && !(ctx && ctx.historyFromListing === true)
    const curtained = offListing
    const sup = runtimeRequestSupply(sites, rows, curtained ? { ...ctx, curtained: true } : ctx)
    // ⭐ PERF — what was asked, for the run of this pass to take instead of asking again (`supplyProbed`)
    if (seen && sup && !sup.refusal && !sup.pending) seen.supply = { rows, ctx, curtained, sites, sup }
    // ⭐⭐ (2026-11-20) an overnight tail: where the run is cut (`computeRuntimeColumns`)
    if (seen && sup && sup.refusal && Number.isInteger(sup.refusal.cutAt)) {
      seen.cutAt = sup.refusal.cutAt
      seen.overnightSeries = Array.isArray(sup.refusal.series) ? sup.refusal.series : []
      seen.tail = tailOf(sup.refusal)
    }
    const k = sup && sup.refusal && Number.isInteger(sup.refusal.knownFrom) ? sup.refusal.knownFrom : 0
    // ⭐⭐ T4 E2 — the depth's own words, when it has them (an event family's record)
    if (seen && k > 0 && sup.refusal.why) seen.knownFromWhy = sup.refusal.why
    return k > 0 ? k : 0
  } catch {
    return 0
  }
}

/** ⭐ PERF (a resumed tick, coordinator ruling 2026-11-19) — THE PROBE'S SUPPLY, TAKEN WHERE IT IS THE RUN'S OWN. The
 *  depth probe asks the supply over this pass's rows and ctx; when it found no depth to move, the run of the pass (the
 *  curtain's A, or a run on the listing) asks again over the very same rows array and ctx, with requests the probe's
 *  bar-free build lowered alike (railed: `knownFromBeforeBuild.test.js`, and compared here, field by field). The
 *  supply is a function of those three alone, so the answer is taken. Anything else (B's rows, a window, another
 *  ctx, a request that differs) asks afresh, as before. */
let _probedSupplyOff = false
/** Tests: every run asks the supply itself, as before. */
export function __probedSupplyOffForTests(off) { _probedSupplyOff = !!off }
const sameSites = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  try {
    for (let i = 0; i < a.length; i += 1) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false
  } catch { return false }
  return true
}
function supplyProbed(probed, sites, rows, ctx, curtained) {
  if (_probedSupplyOff || !probed || probed.rows !== rows || probed.ctx !== ctx || probed.curtained !== curtained) return null
  return sameSites(probed.sites, sites) ? probed.sup : null
}

/** The run over `rows.slice(cut)`, as the chart reads it: widened (`NaN` before `cut`), drawings shifted, the
 *  warm-up record moved by `cut`, and the depth recorded. */
function fromKnownDepth(cols, cut, firstRow, why = null) {
  const out = widenToChart(cols, cut, RUNTIME_OBJECTS_KEY)
  const warm = cols && cols[RUNTIME_WARMUP_KEY]
  // ⭐⭐ T4 E2 — the depth's own code and words for its `cut` bars (an event family's record), riding the warm-up record
  // (which crosses the runtime worker's message): the headless lane names those bars by it (`drawnOutputs`)
  const named = why && typeof why.code === 'string' ? { knownFromCode: why.code, knownFromReason: String(why.reason || '') } : {}
  const moved = warm && Number.isInteger(warm.withheldBars)
    ? { ...warm, withheldBars: warm.withheldBars + cut, knownFrom: cut, ...named }
    : { withheldBars: cut, knownFrom: cut, ...named }
  Object.defineProperty(out, RUNTIME_WARMUP_KEY, { value: moved, enumerable: false, configurable: true })
  Object.defineProperty(out, RUNTIME_KNOWN_FROM_KEY, {
    value: Object.freeze({ knownFrom: cut, firstKnownT: firstRow ? firstRow.t : null }), enumerable: false, configurable: true })
  return out
}

function computeRuntimeColumnsAll(def, rows, ctx, opts = {}) {
  // ⭐⭐ W9-T11 — a strategy document runs over the most recent `ctx.historyWindowBars` bars
  if (def && def.meta && def.meta.runtimeHistory === STRATEGY_WINDOW_HISTORY) return computeStrategyWindow(def, rows, ctx, opts)
  // ⭐ WS-E — `calc_bars_count = N`: the run takes the chart's last N bars, as
  // TradingView does, and its answer is widened back (`engine/calcBarsWindow.js`).
  // ⭐⭐ CBC-FMT — `bar_index` on the window's first bar is WITNESSED (0, `vw-cs1-calc-bars`),
  // so the second run that probed for a dependence on its base is gone (review D3):
  // `plot(bar_index)` is drawn, as are `last_bar_index` and `barstate.isfirst` (the window's
  // own, S10). What a window still does not witness is refused by name BEFORE the run: any
  // request of other bars.
  const win = calcBarsWindowOf(def, rows)
  if (win) {
    const stripped = strippedForScan(String(((def && def.compute) || {}).source || ''))
    if (CALC_BARS_REQUEST_SOURCE.test(stripped)) {
      throw refusal(CALC_BARS_REQUEST_GUARD, calcBarsRequestSentence(win.count))
    }
    let cols
    try {
      // ⛔ P3 WS-F — the window slides: a `varip` is refused by name
      cols = computeRuntimeColumns(def, win.rows, windowContext(ctx), { ...opts, slidingWindow: true })
    } catch (err) {
      if (err && Number.isInteger(err.bar)) err.bar += win.cut
      throw err
    }
    // ⛔ CBC-FMT (realtime ruling) — the newest bar is withheld by name while it may be forming
    return withCalcBarsRecord(widenToChart(cols, win.cut, RUNTIME_OBJECTS_KEY), win, ctx, RUNTIME_OBJECTS_KEY)
  }
  const compute = (def && def.compute) || {}
  if (compute.objects !== true) return computeRuntimeColumnsOnce(def, rows, ctx, opts)
  try {
    return computeRuntimeColumnsOnce(def, rows, ctx, opts)
  } catch (err) {
    if (err && (err.name === 'runtime.error' || err.guard === RUNTIME_TIME_BUDGET_GUARD
      || err.guard === RUNTIME_HISTORY_GUARD || err.guard === RUNTIME_WARMUP_GUARD
      || err.guard === RUNTIME_LISTING_UNVERIFIED_GUARD || err.guard === REQUEST_OVERNIGHT_GUARD
      || (err.tailWait === true && Number.isInteger(err.cutAt)))) throw err
    const plain = { ...def, compute: { ...compute, objects: undefined } }
    let out
    // ⭐ P3 WS-F — the plain run's TIME stop is the run's answer (WS-H, B2: wyckoff on a slow
    // device was named `runtime:calc-bars-count`, the drawings' refusal, when it was the time
    // budget that kept its plots from being drawn); any other plain-run error keeps the first.
    try { out = computeRuntimeColumnsOnce(plain, rows, ctx, opts) } catch (plainErr) {
      throw plainErr && plainErr.guard === RUNTIME_TIME_BUDGET_GUARD ? plainErr : err
    }
    return withRuntimeObjects(out, runtimeObjectsWithheld(err))
  }
}

/** ⭐ OZ N-2 (engine 50) — the sentence a member reads for a run whose drawings stopped on an
 *  error this lane did not NAME (no `guard`): an `ObjectRunError` ("`label.new`: `x` takes a
 *  number") or any other exception. Its text is the engine's, not the member's, and was published
 *  verbatim (`binder.js` → `stoppedRunSentence(reason, 'withheld')`). It is true of every such stop:
 *  the drawings were not worked out, and the plain run (which just succeeded) drew the plots. */
export const RUNTIME_OBJECTS_STOPPED_REASON = 'working them out stopped at a step this engine could '
  + 'not complete, so none are drawn rather than some of them. Its plots are drawn'

/** The WITHHELD payload for `err` (the object run's error). A refusal this lane names (a `guard`)
 *  keeps its own sentence; an unnamed error reads `RUNTIME_OBJECTS_STOPPED_REASON`, and its raw
 *  text goes to `detail`, which no member surface reads (`runtimeObjectsWithheldOf` hands on
 *  `guard` and `reason` only). */
export function runtimeObjectsWithheld(err) {
  if (err && typeof err.guard === 'string' && err.guard) {
    return { status: 'WITHHELD', live: [], guard: err.guard, reason: String(err.message || err),
      ...(err.pending === true ? { pending: true } : {}),
      // ⭐ (e85) and the series a live-tail wait waits for (`requestWait`)
      ...(err.pending === true && typeof err.waitingFor === 'string' && err.waitingFor ? { waitingFor: err.waitingFor } : {}) }
  }
  return { status: 'WITHHELD', live: [], guard: 'runtime:objects', reason: RUNTIME_OBJECTS_STOPPED_REASON,
    detail: String((err && err.message) || err) }
}

/** ⭐ UIE PHASE 2 — two outputs agree: both `na`, or equal to 1e-9 of their size. */
function sameValue(x, y) {
  if (x === y) return true
  const xn = typeof x !== 'number' || Number.isNaN(x)
  const yn = typeof y !== 'number' || Number.isNaN(y)
  if (xn || yn) return xn && yn
  return Math.abs(x - y) <= 1e-9 * Math.max(Math.abs(x), Math.abs(y), 1e-300)
}

/** ⭐⭐ UIE PHASE 2 — WHERE TWO RUNS STOP DEPENDING ON THEIR FIRST BAR.
 *  `a` ran over every bar, `b` over the same bars from `shift` on (its bar k is `a`'s
 *  bar k + shift). → the first bar (in `a`'s indices) from which EVERY output of `a`
 *  and `b` agrees through the last bar, or null when the last bar already disagrees.
 *  Pure; never throws. */
export function convergedFrom(a, b, shift, last) {
  const keys = Object.keys(a || {})
  if (!keys.length || !b) return null
  const n = a[keys[0]].length
  // ⭐ UIE PHASE 3 (M1) — `last`: B stopped after that bar with A's state, so every
  // later bar agrees by proof (`warmupProbe.js`) and is not compared
  const top = Number.isInteger(last) && last < n - 1 ? last : n - 1
  let c = top === n - 1 ? n : top + 1
  for (let i = top; i >= shift; i -= 1) {
    let same = true
    for (const k of keys) {
      const bk = b[k]
      if (!bk || !sameValue(a[k][i], bk[i - shift])) { same = false; break }
    }
    if (!same) break
    c = i
  }
  return c === n ? null : c
}

/** ⭐ UIE PHASE 2 — how many bars later the second run of the warm-up check starts
 *  (a quarter of a short chart). Measured: every converging corpus script's warm-up
 *  is the same within a few dozen bars from 250 and from 1,000 bars in.
 *  ⭐⭐ UIE PHASE 3 — and it is PRIME (`warmupShiftFor`). Two runs `shift` bars apart
 *  cannot tell apart a state that repeats every p bars when p divides `shift`: at 250,
 *  a `var` counter mod 10 (or 2, 5, 25, 50, 125) agreed in both runs and was DRAWN,
 *  though its phase depends on where the chart starts. At a prime only a period of
 *  exactly `shift` can hide, which is named here rather than claimed impossible. */
export const WARMUP_PROBE_SHIFT = 251
const isPrime = (k) => { if (k < 2) return false; for (let d = 2; d * d <= k; d += 1) if (k % d === 0) return false; return true }
/** The shift for a chart of `n` bars: the largest prime ≤ min(251, n/4), or 0. */
export function warmupShiftFor(n) {
  for (let s = Math.min(WARMUP_PROBE_SHIFT, Math.floor(n / 4)); s >= 2; s -= 1) if (isPrime(s)) return s
  return 0
}
/** The guard a document carries whose run never stops depending on its first bar. */
export const RUNTIME_WARMUP_GUARD = 'runtime:warmup-never-converges'

/** ⭐⭐ (coordinator ruling 2026-11-20) THE GUARD WHERE THE CHART DOES START AT THE LISTING, on a timeframe the listing
 *  statement does not serve yet (weekly / monthly: `listingSeed.LISTING_SERVED_TFS`). ⚰️ NASDAQ:BGIN 1W on production
 *  e86: its first weekly bar IS the listing week, and the member read "this chart's bars don't start at the symbol's first
 *  trading day" -- false. Here the true sentence is said, by its own name (`ctx.listingStart`, `listingSeed.listingStartOf`). */
export const RUNTIME_LISTING_UNVERIFIED_GUARD = 'runtime:listing-unverified'
const listingUnserved = (ctx) => !!(ctx && ctx.listingStart === true && ctx.historyFromListing !== true)
const LISTING_UNVERIFIED_REFUSAL = "this script is drawn bar by bar from its first bar, and this chart DOES start at the "
  + "symbol's first trading period, but a run from the listing has only been checked against TradingView on daily charts, "
  + 'not on this timeframe yet. Nothing is drawn rather than a guess. TO UNBLOCK: its daily chart draws it.'

/**
 * ⭐⭐⭐ UIE PHASE 2 — A LISTING DOCUMENT ON A CHART THAT DOES NOT START AT THE LISTING.
 *
 * TradingView runs a script from the first bar IT holds — on an intraday chart, or a
 * daily one cut short of the listing, that is not our first bar, and its `var` state
 * starts somewhere we cannot see. Ruling R-W answers it for the columnar lane: a
 * warm-up curtain, and reads inside it withheld. This is that curtain for a run, and
 * MEASURED rather than assumed:
 *
 *   1. run the script over every bar (A), and again from `shift` bars later (B);
 *   2. find the first bar from which every output of A and B agrees (to 1e-9 of its
 *      size) through the LAST bar (`convergedFrom`): from there on the values did not
 *      depend on which of two different first bars the run began at;
 *   3. draw A from that bar; WITHHOLD (`NaN`) every bar before it;
 *   4. ⛔ refuse BY NAME (`runtime:warmup-never-converges`) a script whose runs never
 *      agree, or agree only in the second half of B: `bar_index` in a plot, a running
 *      count, a cumulative sum — state that never forgets where it started. Those
 *      values on such a chart are unknowable, and are not drawn.
 *
 * ⛔ DRAWINGS ARE WITHHELD on such a chart (named, `runtime:history-start`): the check
 * compares columns, not objects, so a drawing's position is not proven seed-free.
 * The plots beside them are drawn. Costs a second, shorter run inside the same budget —
 * and ⭐ UIE PHASE 3 (M1) stops that run as soon as it is PROVEN to repeat the first
 * (`warmupProbe.js`: same program, same state exactly, same inputs on every later bar),
 * which changes nothing drawn (`runtimeWarmupEarlyStop.test.js`).
 */
function computeOffListing(def, rows, ctx, opts) {
  const n = rows.length
  const shift = warmupShiftFor(n)
  const objects = !!(def.compute && def.compute.objects === true)
  // ⛔ BUILT EXACTLY AS THE DOCUMENT IS — its drawing code included. Stripping
  // `compute.objects` builds a DIFFERENT program (the drawings' text helpers fall to
  // the columnar lane, which refuses e.g. `str.length` in renko's labels); the
  // drawings are withheld AFTER the run instead.
  const plain = { ...def, meta: { ...def.meta, runtimeHistory: undefined } }
  const never = () => (listingUnserved(ctx) ? refusal(RUNTIME_LISTING_UNVERIFIED_GUARD, LISTING_UNVERIFIED_REFUSAL)
    : refusal(RUNTIME_WARMUP_GUARD, "this script is drawn bar by bar from its first bar, and "
    + "this chart's history does not start at the symbol's first bar. Run from two different first bars, "
    + "its values never came to agree, so what it would show here depends on where the chart begins, which "
    + 'TradingView does not share. Nothing is drawn rather than a guess. TO UNBLOCK: a chart whose loaded '
    + "history reaches the listing (a daily chart of a symbol listed within the bars it loads) draws it."))
  if (shift < 2) throw never()
  const clock = clockOf(opts)
  const t0 = clock()
  // ⭐⭐ (coordinator ruling 2026-11-19) the budget of the two runs together, scaled by the bars the chart's run covers
  // (`budgetFor`), then handed to each as a fixed number: A's whole run, then B's VM within what A left
  const budgetMs = budgetFor(opts, n)
  const inner = { ...opts, warmupCurtain: false, budgetScales: false, ...(Number.isFinite(budgetMs) ? { budgetMs } : {}),
    // ⭐⭐ (engine 86) the worker's `WALL_TIME` follows each run's budget (`runLimitsOf`)
    ...(opts.budgetScales === true || opts.wallFollowsBudget === true ? { wallFollowsBudget: true } : {}) }
  // ⭐⭐ UIE PHASE 3 (M1) — B stops as soon as it is PROVEN to repeat A (`warmupProbe.js`);
  // a drawing program is never probed (its object store is not encoded)
  // ⛔ (Fred RS filled chart, 2026-11-19: MEASURED, not to re-propose blind) — probing a program that DRAWS (its
  // object store in the probe's state) was designed and approved, then DROPPED: for Fred RS's run half it pays 0 ms.
  // (1) Its drawings' x is `bar_index`, a column B reads `shift` lower on every bar, so no column check can pass; a
  // throwaway hack that drew the store into the state AND excluded that column showed (2): the state never
  // re-converges. On 60m (an 8,000-bar run half) the first checkpoint past its 5,000-deep ring is A's bar 6,495, and
  // there `var float[] different_values` ("the first 7 DIFFERENT seed values", in the order the run first meets
  // them) holds the same set in another order in A and B: the plots agree, the state never does. On 30m (3,840
  // bars) B never commits 5,000 bars at all. Re-open only with a measured beneficiary whose state does converge.
  const probe = objects || opts.warmupEarlyStop === false ? null : makeWarmupProbe(n, shift)
  // ⭐ UIE PHASE 5 (M2) — each run keeps its own session (`sessionRole`); A is probed only
  // when it runs from scratch (`probeIfCold`): a resumed A visits none of the early bars
  // B could stop at, and B then resumes from its own session instead
  const a = computeRuntimeColumnsOnce(plain, rows, ctx,
    probe ? { ...inner, sessionRole: 'A', probeIfCold: probe.forA, onProgram: probe.programA } : { ...inner, sessionRole: 'A' })
  const aResumed = (runtimeIncrementalOf(a) || {}).resumedFrom !== null
  const left = Number.isFinite(budgetMs) ? budgetMs - (clock() - t0) : null
  if (left !== null && left <= 0) {
    throw refusal(RUNTIME_TIME_BUDGET_GUARD, `this script took more than ${budgetMs} ms to draw bar by bar `
      + "and to check where its values stop depending on this chart's first bar, which is this pane's budget "
      + 'for one indicator, so it is stopped and nothing is drawn rather than part of it.')
  }
  const b = computeRuntimeColumnsOnce(plain, rows.slice(shift), ctx,
    { ...inner, onBudget: undefined, ...(left !== null ? { budgetMs: left } : {}),
      sessionRole: 'B',
      ...(probe && !aResumed ? { probe: probe.forB, onProgram: probe.programB } : {}) })
  const stoppedAt = probe && !aResumed ? probe.stoppedAt() : null
  const from = convergedFrom(a, b, shift, stoppedAt === null ? undefined : stoppedAt)
  if (from === null || from > shift + Math.floor((n - shift) / 2)) throw never()
  for (const k of Object.keys(a)) {
    const col = a[k]
    for (let i = 0; i < from; i += 1) col[i] = NaN
  }
  const warmup = { withheldBars: from, shift, ...(stoppedAt !== null ? { secondRunStoppedAt: stoppedAt } : {}) }
  Object.defineProperty(a, RUNTIME_WARMUP_KEY, { value: warmup, enumerable: false, configurable: true })
  if (objects) {
    // ⭐⭐ UIE PHASE 3 (M3A) — the drawings are held to the plots' standard: drawn when
    // both runs END WITH THE SAME PICTURE (`warmupDrawings.js`), withheld by name otherwise
    const pa = a[RUNTIME_OBJECTS_KEY]
    const pb = b[RUNTIME_OBJECTS_KEY]
    const verdict = opts.warmupDrawings === false ? { same: false, why: 'the drawing check is off' }
      : pa && pb && pa.status === 'ok' && pb.status === 'ok' ? sameDrawings(pa.live, pb.live, shift)
        : { same: false, why: 'a run did not finish its drawings' }
    if (verdict.same) {
      warmup.drawings = 'same-from-two-starts'
    } else {
      withRuntimeObjects(a, listingUnserved(ctx)
        ? { status: 'WITHHELD', live: [], guard: RUNTIME_LISTING_UNVERIFIED_GUARD,
          reason: "its drawings are not drawn here yet: this chart DOES start at the symbol's first trading period, but "
            + 'drawings worked out from the listing have only been checked against TradingView on daily charts. Its plots '
            + 'are drawn.' }
        : { status: 'WITHHELD', live: [], guard: RUNTIME_HISTORY_GUARD,
          reason: "its drawings are not drawn on a chart whose history does not start at the symbol's first bar: "
            + `run from two different first bars, it ends with different drawings (${verdict.why}), so where `
            + 'they land depends on where the chart begins. Its plots are drawn.' })
    }
  }
  return a
}

// ─── ⭐⭐⭐ UIE PHASE 5 (M2) — INCREMENTAL RUNS: RESUME FROM THE LAST CONFIRMED BAR ───────
//
// A chart repaints a runtime pane on every tick and every new bar, and each used to
// run the script over the WHOLE history again. A run now leaves a SESSION behind: the
// bars it ran over (copied), the program it ran, and a checkpoint of the VM at the end
// of its last CONFIRMED bar (`vm.js`, `opts.checkpointAt`). The next run of the same
// identity (`runKey`: the document's content, its settings, the symbol, timeframe,
// forming state and listing — plus the run's role) RESUMES from that checkpoint when,
// and only when, running bars [0, cp] again would rebuild it exactly
// (`resumableFrom`):
//   1. those bars are the same bars — time, open, high, low, close, volume, bit for bit
//      (a historical correction, an inserted bar, a different window: not resumed);
//   2. the new build lowered to the same program (`sameProgram`: code, constants, slots);
//   3. every precomputed column the program reads is the same over [0, cp] — which is
//      what catches what a bar reads of the WHOLE series: `barstate.islast`,
//      `last_bar_index` and the like change when a bar is appended, so a script that
//      reads them is not resumed across a new bar (a tick on the forming bar keeps them);
// and the VM is deterministic, so the resumed run's outputs, drawings and state EQUAL a
// full run's (`runtimeIncremental.test.js` holds every runtime-only corpus script to
// it, bit for bit). Anything else is a full run, which leaves a fresh session.
// ⛔ A forming bar is never checkpointed: each tick resumes from the same confirmed
// state, so a tick's writes never accumulate. Sessions are few and bounded
// (`SESSION_CAP`, oldest dropped); `opts.incremental === false` opts a run out.
const SESSION_CAP = 12
/** ⭐ …and BYTES (an estimate, `sessionBytes`): measured, one session on 20,208 bars holds
 *  3-32 MB (the precomputed columns dominate), so a count alone could hold hundreds of
 *  MB in the worker. Over the budget the oldest go; one bigger than half of it is not
 *  kept at all — that script simply runs in full on every update, as before. */
const SESSION_BYTE_CAP = 64 * 1024 * 1024
const _sessions = new Map()
const lenOf = (x) => (x && typeof x.length === 'number' ? x.length : 0)
function sessionBytes(s) {
  let bytes = 48 * (s.rows ? s.rows.n : 0)
  for (const c of (s.program && s.program.columns) || []) bytes += 8 * lenOf(c)
  const cp = s.checkpoint
  if (cp) {
    for (const o of cp.outputs || []) bytes += 8 * lenOf(o)
    bytes += 16 * (lenOf(cp.persist) + lenOf(cp.hist) + lenOf(cp.held)) + 8 * (lenOf(cp.carState) + lenOf(cp.car2State))
    for (const it of cp.iters || []) bytes += 16 * lenOf(it)
    if (cp.store) bytes += 256 * lenOf(cp.store.live)
    for (const d of cp.supply || []) bytes += 4 * lenOf(d.index) + 56 * (d.max + 1)
  }
  // ⭐ P3 WS-F (review L3) — the kept build (its IR and column trees) counts against the cap too
  if (s.build) bytes += buildBytes(s.build)
  return bytes
}
/** ⭐ P3 WS-F (review L3) — an ESTIMATE of a kept build's bytes, walked once and cached on it:
 *  64 an object, 16 an array element, 8 a typed-array element, 2 a string character. Each
 *  shared node counted once; iterative (deep trees). */
function buildBytes(build) {
  if (Number.isFinite(build.bytes)) return build.bytes
  let bytes = 0
  const seen = new Set()
  const stack = [build.ir, build.trees]
  while (stack.length) {
    const x = stack.pop()
    if (typeof x === 'string') { bytes += 2 * x.length; continue }
    if (!x || typeof x !== 'object' || seen.has(x)) continue
    seen.add(x)
    if (ArrayBuffer.isView(x)) { bytes += 8 * x.length; continue }
    if (Array.isArray(x)) { bytes += 16 * x.length; for (const v of x) stack.push(v); continue }
    bytes += 64
    for (const k of Object.keys(x)) { bytes += 2 * k.length; stack.push(x[k]) }
  }
  build.bytes = bytes
  return bytes
}
/** Drop every session (tests; a host that wants a cold start). */
export function resetRuntimeSessions() { _sessions.clear(); _buildMemo.clear(); _probeSites.clear(); resetRuntimeBudgetStops() }
/** ⭐ What the sessions hold (diagnostics, the resource measurement): how many, and an
 *  ESTIMATE of their bytes — 8 a number (bars, columns, outputs, numeric state), 16 an
 *  array element, plus 256 a live drawing. */
export function runtimeSessionStats() {
  let bytes = 0
  for (const s of _sessions.values()) bytes += s.bytes
  return { sessions: _sessions.size, cap: SESSION_CAP, byteCap: SESSION_BYTE_CAP, approxBytes: bytes }
}
// ⭐⭐ (2026-11-19, the B5 reuse fix) — A BAR'S TIME IS ITS OWN KEY, KEPT AS IT CAME. A daily, weekly or monthly
// bar is keyed by its ISO date (`'2026-11-17'`), and `+'2026-11-17'` is `NaN`: the snapshot stored that `NaN` and
// the checks compared `NaN` with `NaN`, which `Object.is` calls equal, so ANY two daily charts of one length had
// "the same times". A session then carried its price-free clock columns (`dayofweek`, `time`, `time("W")`, …)
// from the PREVIOUS run's bars: a daily window that slid one bar drew last window's `dayofweek` on every bar, and a
// chart with a bar moved onto a Saturday was served where a cold build refuses `runtime:chart-clock`. The key the
// run itself reads (`barTimes`, the columnar lane's bars) is kept and compared as it is: a string as a string, a
// number as a number, and a key of another kind is another time (the safe direction: a rebuild).
const rowsSnapshot = (rows) => {
  const n = rows.length
  const out = { n, t: new Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n),
    c: new Float64Array(n), v: new Float64Array(n) }
  for (let i = 0; i < n; i += 1) {
    const b = rows[i]
    out.t[i] = b.t; out.o[i] = b.o; out.h[i] = b.h; out.l[i] = b.l; out.c[i] = b.c; out.v[i] = b.v
  }
  return out
}
const sameRowsTo = (snap, rows, last) => {
  if (!snap || rows.length <= last || snap.n <= last) return false
  for (let i = 0; i <= last; i += 1) {
    const b = rows[i]
    if (!Object.is(snap.t[i], b.t) || !Object.is(snap.o[i], +b.o) || !Object.is(snap.h[i], +b.h)
      || !Object.is(snap.l[i], +b.l) || !Object.is(snap.c[i], +b.c) || !Object.is(snap.v[i], +b.v)) return false
  }
  return true
}
const sameColumnsTo = (a, b, last) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let k = 0; k < a.length; k += 1) {
    const x = a[k]
    const y = b[k]
    if (!x || !y || x.length <= last || y.length <= last) return false
    if (x === y) continue   // ⭐ P3 WS-F — a column a tick reused (`tickInvariant`) is the same array
    for (let i = 0; i <= last; i += 1) if (!Object.is(x[i], y[i])) return false
  }
  return true
}
// ─── ⭐⭐ (Fred RS filled chart, item 3) — A RUN THAT READS REQUESTS RESUMES WHEN ITS SUPPLY AGREES ──────────────
//
// A checkpoint's state was built from the requested values bars [0, cp] read. A run over a NEW supply rebuilds that
// same state when every one of those values is the same, and that is decided from the supply alone when every
// request region is CAUSAL (`vm.js::requestRegionCausal`: its value on requested bar j reads the requested bars
// [0, j] and nothing else): per request the checkpointed run made (`checkpoint.requests`), the requested bar each
// chart bar 0..cp reads (`index`) and every requested bar they reach (`runBars[0..max]`: `t` as the sub-run reads it,
// the prices as the numbers it reads) are the same (`supplyAgreesTo`). The resumed run then makes those sub-runs
// again over the new supply before bar cp + 1 (`vm.js`), so every later bar reads the NEW requested values, as a
// full run's does. ⛔ A resumed run that throws is run again in full (`computeRuntimeColumnsOnce`), so every stop
// is the full run's own. ⛔ A request with no prepared supply, a region that is not causal, a checkpoint with no
// digest: not resumed, as before.
let _resumeAcrossSupplyOff = false
/** Tests / timing: a run that reads requests never resumes, as before (the identity rails compare both). */
export function __resumeAcrossSupplyOffForTests(off) { _resumeAcrossSupplyOff = !!off }
const RUN_BAR_FIELDS = ['o', 'h', 'l', 'c', 'v']
/** What a checkpoint's state read of the supply: per site its requests reached by bar `cp.bar`, the `index` of chart
 *  bars 0..cp and the requested bars that reaches, copied (a supply's arrays may be shared with a cache). */
function supplyDigestOf(supply, checkpoint) {
  if (!Array.isArray(supply) || !checkpoint) return null
  const out = []
  for (const a of new Set((checkpoint.requests || []).map((e) => e.a))) {
    const s = supply[a]
    if (!s || !s.runBars || !s.index) return null
    const last = checkpoint.bar
    if (s.index.length <= last) return null
    const index = Int32Array.from({ length: last + 1 }, (_, i) => s.index[i])
    let max = -1
    for (let i = 0; i <= last; i += 1) if (index[i] > max) max = index[i]
    if (max >= s.runBars.length) return null
    const bars = { t: new Array(max + 1) }
    for (const k of RUN_BAR_FIELDS) bars[k] = new Float64Array(max + 1)
    for (let j = 0; j <= max; j += 1) {
      const b = s.runBars[j]
      bars.t[j] = b.t
      for (const k of RUN_BAR_FIELDS) bars[k][j] = b[k]
    }
    out.push({ a, index, max, bars })
  }
  return out
}
/** Does `supply` hand every request the digest names the same requested values on chart bars 0..cp? */
function supplyAgreesTo(digest, supply) {
  if (!Array.isArray(digest) || !Array.isArray(supply)) return false
  for (const d of digest) {
    const s = supply[d.a]
    if (!s || !s.runBars || !s.index || s.index.length < d.index.length || s.runBars.length <= d.max) return false
    for (let i = 0; i < d.index.length; i += 1) if (s.index[i] !== d.index[i]) return false
    for (let j = 0; j <= d.max; j += 1) {
      const b = s.runBars[j]
      if (!b || !Object.is(b.t, d.bars.t[j])) return false
      // the numbers the sub-run reads (`runRequest`: `Float64Array.from`), compared as it reads them
      for (const k of RUN_BAR_FIELDS) if (!Object.is(+b[k], d.bars[k][j])) return false
    }
  }
  return true
}
/** Why a run over `supply` may not resume from `cp` across a supply, or null. */
function acrossSupplyBlocked(cp, program, supply) {
  if (!cp.supply) return 'the checkpoint holds no supply digest'
  if (!(cp.requests || []).every((e) => !!e.charged)) return 'a request without a prepared supply'
  if (!(program.requests || []).every((site) => requestRegionCausal(program, site.entry))) return 'a request region that is not causal'
  if (!supplyAgreesTo(cp.supply, supply)) return 'a requested value before the checkpoint changed'
  return null
}

/** The checkpoint a run over `rows` with `program` may resume from, or `{why}`. With `supply` (a run that reads
 *  requests), only across a supply that agrees (`acrossSupplyBlocked`). */
export function resumableFrom(prev, rows, program, supply = null) {
  if (!prev || !prev.checkpoint) return { why: 'no checkpoint' }
  const cp = prev.checkpoint
  if (cp.bar >= rows.length) return { why: 'fewer bars than the checkpoint' }
  if (!sameRowsTo(prev.rows, rows, cp.bar)) return { why: 'the bars before the checkpoint changed' }
  if (!sameProgram(prev.program, program)) return { why: 'the program changed' }
  if (!sameColumnsTo(prev.program.columns, program.columns, cp.bar)) return { why: 'a column before the checkpoint changed' }
  if (supply) {
    const blocked = acrossSupplyBlocked(cp, program, supply)
    if (blocked) return { why: `request: ${blocked}` }
  }
  return { checkpoint: cp }
}
/** ⭐ Where a run's incremental decision rides (non-enumerable, like the warm-up). */
export const RUNTIME_INCREMENTAL_KEY = '__runtimeIncremental'
export const runtimeIncrementalOf = (cols) => (cols && typeof cols === 'object' ? cols[RUNTIME_INCREMENTAL_KEY] || null : null)

// ─── ⭐⭐ P3 WS-F (B5) — A SESSION KEEPS ITS BUILD: A TICK DOES NOT RE-RUN THE FRONT END ───
//
// A realtime tick used to rebuild the whole script — tokenise, resolve, lower to IR — and
// recompute every precomputed column over all the bars, then resume the VM for ONE bar.
// The build is a function of the document and the build options ALONE (all in `runKey`)
// plus, through ONE seam, the bars: the front end reads the bars only by asking the
// columnar lane for a pure subtree's column (`pineRuntimeFrontend.js::columnOf`), and it
// never reads a column's VALUES back. So a session records, at its cold build, each
// column's folded tree in order (`buildRecorder`, through `opts.columnInterpret`), and a
// later run of the same session re-evaluates exactly those trees over its own bars
// (`columnsOver`) instead of rebuilding — the same `interpret` call with the same
// arguments, so the same numbers (`runtimeBuildCache.test.js` holds it bit for bit).
// ⛔ CACHED ONLY WHEN THE BUILD'S PATH COULD NOT HAVE DEPENDED ON THE BARS: a build in
// which any column evaluation THREW (the front end may catch it and route differently,
// and a throw can depend on the data) is never cached. ⛔ AND A RE-EVALUATION THAT THROWS,
// or answers a column of the wrong length, is not used: the run rebuilds from the source,
// which reproduces exactly what a cold run says about those bars.
// ⭐⭐ AND A TICK RE-EVALUATES ONLY THE COLUMNS IT CAN MOVE. A tick changes the forming
// bar's prices, never a bar's time or the number of bars. A column whose tree reads NO
// price — constants, the clock (`bar_index`, `time`, `barstate.*`: `closedTable.json::
// clock`), operators and table functions over those, and no function that reads the bar
// itself (`BAR_READERS`) — is a function of the bars' times and count alone
// (`tickInvariant`), so over bars with the same times as the session's last run it is
// that run's column, reused as it is. Every other column is evaluated again over every
// bar: `interpret` (the columnar lane) has no incremental entry, so a column that reads a
// price pays one pass per tick. Only the VM is resumed for the last bar alone.
const CLOCK_SERIES = new Set(Object.keys((TABLE && TABLE.clock) || {}))
const PRICE_FREE_CALLS = new Set(Object.keys((TABLE && TABLE.functions) || {}).filter((name) => !BAR_READERS.includes(name)))
/** Does this folded tree read no price, so it depends on the bars' times and count only?
 *  ⛔ An ALLOWLIST: a node of any other type (a symbol, a timeframe read, text, a lower
 *  timeframe…) or a call the table does not hold answers no. Iterative (deep trees). */
export function tickInvariant(tree) {
  const stack = [tree]
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object') return false
    if (n.type === 'num' || n.type === 'str') continue
    if (n.type === 'series') { if (!CLOCK_SERIES.has(n.name)) return false; continue }
    if (n.type === 'call' && !PRICE_FREE_CALLS.has(n.name)) return false
    if (n.type !== 'op' && n.type !== 'offset' && n.type !== 'call') return false
    for (const a of n.args || []) stack.push(a)
  }
  return true
}
/** The bars have the same times, in the same number, as a session's snapshot. */
const sameTimes = (snap, rows) => {
  if (!snap || snap.n !== rows.length) return false
  for (let i = 0; i < rows.length; i += 1) if (!Object.is(snap.t[i], rows[i].t)) return false
  return true
}
/** Exported for its rails (`runtimeRealtimeGuards.test.js`); no product caller outside this file. */
export function buildRecorder() {
  const trees = []
  let clean = true
  // ⭐ PERF (item d) — the binding constants the build READ (`pineRuntimeFrontend.js::bindConstsReporting`): the
  // build memo keys a kept build on these symbol facts and no others. A read AFTER `done` (nothing does one today)
  // marks the kept build unsafe for the memo, whose key was taken at `done`.
  const reads = new Set()
  let kept = null
  let seenBars = undefined
  return {
    interpret(tree, bars, inputs, interpretOpts) {
      if (seenBars === undefined && Array.isArray(bars)) seenBars = bars.length
      try {
        const v = interpret(tree, bars, inputs, undefined, undefined, interpretOpts)
        trees.push({ tree, inputs, interpretOpts, invariant: tickInvariant(tree) })
        return v
      } catch (e) { clean = false; throw e }
    },
    bindRead(name) {
      if (kept) kept.memoUnsafe = true
      else reads.add(name)
    },
    /** the build to keep, or null; the IR's own columns (these bars' values) are dropped.
     *  ⭐ (the B5 reuse fix) `nBars`: the count the build was made over, whose class (`buildBarCountClass`) a reuse
     *  must share; a caller that does not say is taken at the count the columns were evaluated over. */
    done(ir, nBars) {
      if (!clean || !ir || !Array.isArray(ir.columns) || trees.length !== ir.columns.length) return null
      kept = { ir: { ...ir, columns: [] }, trees, bindReads: [...reads].sort(),
        barCountClass: buildBarCountClass(Number.isInteger(nBars) ? nBars : seenBars) }
      return kept
    },
  }
}
/** The columns of a kept build over `rows`, made AND CHECKED exactly as `columnOf` makes and checks them, or null
 *  (the run builds afresh, and says what a cold build says). `prev` is the session whose last run computed
 *  `prev.program.columns` with this build.
 *  ⭐⭐ (2026-11-19, the B5 reuse fix) — ONE AUTHORITY FOR WHAT A COLUMN REFUSES: the front end's own
 *  (`columnSinkRefusal`, the length, `columnBlankRefusal`), and the bar count's class the build was made in
 *  (`buildBarCountClass`). ⚰️ This kept its own list, `time-*` codes only, so a reuse over new bars served a
 *  `stoch:flat-window`, a `bool`-`na` or tie witness, a `request:other-timeframe` read and a blank left-edge column
 *  that a cold build refuses by name, and reused a build made within Pine's history buffer over a chart grown past
 *  it (a dynamic offset a cold build lowers piecewise). */
export function columnsOver(build, rows, prev) {   // exported for its rails, as `buildRecorder`
  const n = rows.length
  // a build that names its class is reused only within it (a hand-made build in a rail names none)
  if (build.barCountClass !== undefined && build.barCountClass !== buildBarCountClass(n)) return null
  const out = new Array(build.trees.length)
  let reusedCount = 0
  const prevCols = prev && prev.program && Array.isArray(prev.program.columns)
    && prev.program.columns.length === build.trees.length && sameTimes(prev.rows, rows) ? prev.program.columns : null
  for (let k = 0; k < build.trees.length; k += 1) {
    const { tree, inputs, interpretOpts, invariant } = build.trees[k]
    if (prevCols && invariant && prevCols[k] && prevCols[k].length === n) { out[k] = prevCols[k]; reusedCount += 1; continue }
    let value
    // ⭐ P3 WS-B — a fresh clock sink per re-evaluation: what the columnar lane withholds
    // by name over THESE bars declines the run at the build (`columnOf`), so here it
    // hands back to a rebuild, which says so by name (`runtime:chart-clock`).
    const sink = new Map()
    try { value = interpret(tree, rows, inputs, undefined, undefined, { ...(interpretOpts || {}), chartClockSink: sink }) } catch { return null }
    if (columnSinkRefusal(sink, n, null)) return null
    const arr = typeof value === 'number' ? new Float64Array(n).fill(value)
      : value instanceof Float64Array ? value : Float64Array.from(value)
    // ⚠️ FAIL-CLOSED, NOT MUTATION-PROVABLE: `interpret` over `rows` answers `n` values today
    // (deleting this line left every rail green). It stands because `columnOf` refuses the same
    // mismatch by name, and a cached column of the wrong length would be read past its end.
    if (arr.length !== n) return null
    if (columnBlankRefusal(sink, arr, n, null)) return null
    out[k] = arr
  }
  _lastReused = reusedCount
  return out
}
let _lastReused = 0

// ─── ⭐⭐ PERF (Fred RS 5m profile, 2026-11-19, item d) — A BUILD IS KEPT ACROSS SESSIONS, KEYED ON WHAT IT READ ───
//
// B5 reuses a build inside ONE session (`runKey`: the symbol, the timeframe, the forming bar, the settings, the
// role), so every symbol or timeframe switch, and the off-listing curtain's second run (B, its own session), ran
// the front end again. The build is a function of the source and the build options alone, plus the bars through
// one seam (the columns, `buildRecorder`) and two questions about their count (`buildBarCountClass`); of the
// symbol it reads only the binding's constants, and only the ones it reads (`bindConstsReporting`). So a kept build
// is keyed on:
//   * the document's content (`runtimeContentKey`) and EVERY build option but the bars and the symbol (the
//     timeframe and base period, the clock, the listing fact, the settings and their default nodes, the library
//     pins, the drawing mode, the ledger / sliding refusals): a new option joins the key without a line here;
//   * the strategy broker's gate, which the front end reads itself (`strategyBrokerGateOn`);
//   * the bar count's class (`buildBarCountClass`: none / within Pine's history buffer / past it);
// and, checked on each hit, the VALUE of every binding constant the build read (`syminfo.*` and the rest) under the
// new chart's symbol. A hit re-evaluates the recorded columns over the new bars (`columnsOver`, with no session) with every
// check `columnOf` makes (`columnSinkRefusal`, the length, `columnBlankRefusal`): a column that would refuse, or an
// evaluation that throws, sends the run to a fresh build, which says what a cold build says. The program is
// lowered afresh from the kept IR, as B5's is when it does not resume.
// ⛔ Bounded (`BUILD_MEMO_CAP` entries, `BUILD_MEMO_BYTE_CAP` estimated bytes, oldest dropped), cleared with the
// sessions (`resetRuntimeSessions`), and holding no run state: a build is the program before any bar runs.
const BUILD_MEMO_CAP = 16
const BUILD_MEMO_PER_KEY = 4
const BUILD_MEMO_BYTE_CAP = 48 * 1024 * 1024
/** key → the kept builds under it, oldest first: one per set of symbol facts read (a chart flipping between two
 *  symbols of a script that folds `syminfo.prefix` keeps both). Keys in least-recently-used order. */
const _buildMemo = new Map()
let _buildMemoOff = false
/** Tests: build every run cold (the identity rails compare both ways). */
export function __buildMemoOffForTests(off) { _buildMemoOff = !!off }
/** ⭐ What the build memo holds (diagnostics): how many builds, and an ESTIMATE of their bytes. */
export function runtimeBuildMemoStats() {
  let builds = 0
  let bytes = 0
  for (const list of _buildMemo.values()) for (const e of list) { builds += 1; bytes += buildBytes(e.build) }
  return { builds, cap: BUILD_MEMO_CAP, perKey: BUILD_MEMO_PER_KEY, byteCap: BUILD_MEMO_BYTE_CAP, approxBytes: bytes }
}
/** The memo key of a build made with `irOpts` (`runtimeIrOptions`) for `def`. */
export function buildMemoKey(def, irOpts) {
  const { bars, symbol: _symbol, ...rest } = irOpts
  // ⭐ U-DAILY (e96, part B) — a build made with the daily-expression capability open is another build
  // (`dailyExpressionGate.js`); the key is unchanged while it is closed, as committed
  return JSON.stringify([runtimeContentKey(def), rest, strategyBrokerGateOn() === true,
    buildBarCountClass(Array.isArray(bars) ? bars.length : 0), ...(dailyExpressionAdmitted() ? ['dx'] : [])])
}
/** The binding constants a build with `irOpts` reads, as the front end assembles them (`bindConstsFor`). */
const bindConstsOfOpts = (irOpts) => bindConstsFor({ tf: irOpts.tf, inputs: irOpts.inputs || {}, symbol: irOpts.symbol })
const bindValue = (consts, name) => (name === '*' ? JSON.stringify(Object.entries(consts).sort()) : consts[name])
/** Does a kept entry's every read constant hold the same value under these options' binding? */
const readsHold = (entry, consts) => entry.values.every(([name, value]) => Object.is(bindValue(consts, name), value))
/** Keep a recorded build (`buildRecorder().done`) for later runs with the same key. */
export function keepBuildMemo(def, irOpts, build) {
  if (_buildMemoOff || !build || build.memoUnsafe || !Array.isArray(build.bindReads)) return
  const consts = bindConstsOfOpts(irOpts)
  const key = buildMemoKey(def, irOpts)
  const entry = { build, values: build.bindReads.map((name) => [name, bindValue(consts, name)]) }
  // the same symbol facts replace their older build; at most `BUILD_MEMO_PER_KEY` under one key
  const list = (_buildMemo.get(key) || []).filter((e) => !readsHold(e, consts))
  list.push(entry)
  while (list.length > BUILD_MEMO_PER_KEY) list.shift()
  _buildMemo.delete(key)
  _buildMemo.set(key, list)
  let count = 0
  let total = 0
  for (const l of _buildMemo.values()) for (const e of l) { count += 1; total += buildBytes(e.build) }
  while (count > BUILD_MEMO_CAP || (total > BUILD_MEMO_BYTE_CAP && count > 1)) {
    const oldestKey = _buildMemo.keys().next().value
    const oldest = _buildMemo.get(oldestKey)
    const gone = oldest.shift()
    if (!oldest.length) _buildMemo.delete(oldestKey)
    count -= 1
    total -= buildBytes(gone.build)
  }
}
/** A kept build for a run with `irOpts` over `rows`, with its columns over those rows, or null (build cold). */
export function buildMemoHit(def, irOpts, rows) {
  if (_buildMemoOff || !Array.isArray(rows) || !rows.length) return null
  const key = buildMemoKey(def, irOpts)
  const list = _buildMemo.get(key)
  if (!list) return null
  const consts = bindConstsOfOpts(irOpts)
  const entry = list.find((e) => !e.build.memoUnsafe && readsHold(e, consts))
  if (!entry) return null
  // the one re-evaluation a kept build ever gets (`columnsOver`, the B5 reuse fix's): no session, so every column
  // is evaluated over these rows and checked as `columnOf` checks it, and a build of another bar-count class is refused
  const columns = columnsOver(entry.build, rows, null)
  if (!columns) return null
  _buildMemo.delete(key)
  _buildMemo.set(key, list)
  return { build: entry.build, columns }
}
// ─── ⭐⭐ P3 WS-F — THE REALTIME LEDGER: `varip` AND `barstate.isnew` ─────────────────────
//
// Pine's realtime model (`docs/pine/PHASE3-RUNTIME-PLAN.md` 3.2): on each update of the
// forming bar the script runs the bar again, and EVERY variable — `var` included — is first
// rolled back to the state committed at the previous bar's close. The checkpoint resume
// below is that rollback: a tick resumes from the last confirmed bar, never from a forming
// one. Two things escape it, and both are facts about what has ALREADY RUN:
//   * `varip` keeps what the previous update of the bar left;
//   * `barstate.isnew` is true only on a bar's first execution (`isNewByBar`).
// So a session's runs keep a LEDGER: for each bar time that has run as a FORMING bar, its
// `varip` slots as the bar's latest execution began (`start`) and ended (`end`), whether
// that execution was its closing one (`confirmed`), the bar's prices it ran over (`sig`) and
// whether it was the bar's first (`first`). What a run is to such a bar — its next update,
// the same update again, the close, a replay, a reopening — is `realtimeDecision`.
// A bar no run has seen forming is history: `varip` is `var` there, exactly as on
// TradingView. ⭐ Keyed by bar TIME and by the run's identity WITHOUT the forming flag, so
// a bar that closes when the fetch stops calling it forming keeps its updates.
// ⛔ A run that refuses or stops records nothing (`commit` after success only). A run with
// no session (`incremental: false`, a measurement, `opts.limits`) has no ledger, so a script
// with a `varip` REFUSES there by name (`realtimeLedger`, review M3), as on every other door.
// ⛔ BOUNDED: `LEDGER_CAP` ledgers, `LEDGER_BAR_CAP` bars each (the oldest go; a replay of
// an evicted bar is then history, as after a reload).
// ⛔ ONLY A SCRIPT THAT DECLARES `varip` OR READS `barstate.isnew` keeps one; every other
// run is exactly what it was.
const LEDGER_CAP = 24
const LEDGER_BAR_CAP = 2000
const _ledgers = new Map()   // key → Map(origin → ledger)
const LEDGER_ORIGINS_CAP = 4
/** ⛔⛔ (re-review M1, M2) why a `varip` is refused on a window that slides one bar per new bar. */
export const SLIDING_VARIP_WHY = '`varip` on a window that drops its oldest bar on every new bar (a '
  + '`calc_bars_count` window, or an indicator computed on another timeframe\'s bars): its realtime '
  + 'updates cannot be carried exactly across the slide, and TradingView never slides a loaded history'
/** The ledger for `key` at history start `origin`: its own, or none. ⛔ (re-review M1) NEVER
 *  ADOPTED OR MOVED across starts: a window that slides is refused a `varip` instead
 *  (`SLIDING_VARIP_WHY`), so each history start keeps exactly the ledger its own runs wrote. */
function ledgerFor(key, origin) {
  const byOrigin = _ledgers.get(key)
  return byOrigin && Number.isFinite(origin) ? byOrigin.get(origin) || null : null
}
/** ⭐ (re-review L3) LEDGERS ARE BOUNDED BY BYTES, an ESTIMATE kept on each (`ledgerBytes`):
 *  past `LEDGER_BYTE_CAP` across all of them the least recently written go.
 *  ⚠️ KNOWN LIMITS, to review before arming (`docs/pine/capture-queue-2026-10-31-wsf-realtime.md`):
 *  an evicted script's ledger resets SILENTLY (its pane drops back to the `var` value on the next
 *  run, with no notice), and with very large `varip` values `SEEN_BYTE_CAP` leaves room for only a
 *  few remembered prices per bar, so the protection against a lagging pane shrinks to those. */
const LEDGER_BYTE_CAP = 32 * 1024 * 1024
let _ledgerBytes = 0
const ledgerBytes = (l) => (l && Number.isFinite(l.bytes) ? l.bytes : 0)
function keepLedger(key, origin, ledger) {
  const byOrigin = _ledgers.get(key) || new Map()
  _ledgers.delete(key)
  _ledgers.set(key, byOrigin)
  byOrigin.delete(origin)
  byOrigin.set(origin, ledger)
  while (byOrigin.size > LEDGER_ORIGINS_CAP) {
    const first = byOrigin.keys().next().value
    _ledgerBytes -= ledgerBytes(byOrigin.get(first))
    byOrigin.delete(first)
  }
  const dropOldest = () => {
    const k = _ledgers.keys().next().value
    for (const l of _ledgers.get(k).values()) _ledgerBytes -= ledgerBytes(l)
    _ledgers.delete(k)
  }
  while (_ledgers.size > LEDGER_CAP) dropOldest()
  while (_ledgerBytes > LEDGER_BYTE_CAP && _ledgers.size > 1) dropOldest()
}
/** An ESTIMATE of a `varip` snapshot's bytes: 8 a number, 2 a character, 16 an element or
 *  field (iterative, each object once). */
function snapBytes(snap) {
  if (!snap) return 0
  let bytes = 0
  const seen = new Set()
  const stack = [snap.v, snap.init]
  while (stack.length) {
    const x = stack.pop()
    if (typeof x === 'string') { bytes += 2 * x.length; continue }
    if (!x || typeof x !== 'object') { bytes += 8; continue }
    if (seen.has(x)) continue
    seen.add(x)
    if (ArrayBuffer.isView(x)) { bytes += 8 * x.length; continue }
    const vals = Array.isArray(x) ? x : Object.values(x)
    bytes += 16 * vals.length
    for (const v of vals) stack.push(v)
  }
  return bytes
}
/** ⭐ Where a run's realtime facts ride (non-enumerable): `{isNew, varip, ledgerBars}`. */
export const RUNTIME_REALTIME_KEY = '__runtimeRealtime'
/** ⭐⭐ TRACK 6, AL1 (engine 95) -- THE RUN'S `alert()` CALLS (`collections.js::ALERT_EMIT`), plain data beside
 *  the columns: `{fromBar: 0, events: [{bar, message, freq}], dropped}`. Present ONLY on a run that executed the
 *  program over EVERY bar from the first (never on a resumed run, which ran only the newest bars): a partial log
 *  would read as "no alert on the bars it did not run". Absent means "not recorded", never "no alert". */
export const RUNTIME_ALERTS_KEY = '__runtimeAlerts'
/** The run's alert record (`RUNTIME_ALERTS_KEY`), or null when this run did not record one. */
export function runtimeAlertsOf(cols) {
  const r = cols && typeof cols === 'object' ? cols[RUNTIME_ALERTS_KEY] : null
  return r && typeof r === 'object' ? r : null
}
export const runtimeRealtimeOf = (cols) => (cols && typeof cols === 'object' ? cols[RUNTIME_REALTIME_KEY] || null : null)
/** Drop every ledger (tests; a host that wants a cold start). */
export function resetRuntimeLedgers() { _ledgers.clear(); _ledgerBytes = 0 }
/** ⭐ (re-review L3) what the ledgers hold: how many, and an ESTIMATE of their bytes. */
export function runtimeLedgerStats() { return { ledgers: _ledgers.size, approxBytes: _ledgerBytes, byteCap: LEDGER_BYTE_CAP } }
const READS_ISNEW = /\bbarstate\s*\.\s*isnew\b/
const _readsIsNew = new Map()
/** Does the source read `barstate.isnew` (comments and strings stripped)? Memoised by source. */
function readsIsNew(source) {
  const text = String(source || '')
  let hit = _readsIsNew.get(text)
  if (hit === undefined) {
    hit = READS_ISNEW.test(strippedForScan(text))
    if (_readsIsNew.size >= 64) _readsIsNew.delete(_readsIsNew.keys().next().value)
    _readsIsNew.set(text, hit)
  }
  return hit
}
/** The forming bar's prices as one update saw them: a re-run over the same prices is the
 *  same update, not a new one (review H1). */
const barSig = (b) => [+b.t, +b.o, +b.h, +b.l, +b.c, +b.v]
const sameSig = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
const sigKey = (sig) => sig.join(',')
/** ⭐ (step 2, A) how many distinct prices one forming bar remembers. Past it the oldest go, and
 *  a price that comes back after that is counted again (an over-count only past 1,024 updates). */
const SEEN_CAP = 1024
/** ⭐ (re-review L3) …and how many bytes of `varip` snapshots (an estimate, `snapBytes`).
 *  ⚠️ With big `varip` values (a large array) this holds only a few prices: see the known limits
 *  at `LEDGER_BYTE_CAP`. */
const SEEN_BYTE_CAP = 4 * 1024 * 1024
/** ⭐⭐ (review H1, M2) WHAT ONE RUN IS TO A BAR THE LEDGER HAS SEEN, decided from the bars and
 *  the ledger alone, before the run:
 *    `from`   the `varip` state the bar is entered with (`'snap'` = what the run reaches it with)
 *    `record` the entry to write after a finished run, or null (the run changes nothing)
 *    `isNew`  this run is the bar's first execution (`barstate.isnew`)
 *  The rules (Pine counts EXECUTIONS, one per real update of the bar):
 *    * no entry, the forming bar          → its first update: recorded, new;
 *    * no entry, any other bar            → history: `varip` is `var`, nothing recorded;
 *    * unclosed entry, the bar now closed → the closing update: one more execution;
 *    * unclosed entry, still forming, the SAME prices → the same update run again (a second
 *      pane, a refetch, a remount, older history prepended): entered from where that update
 *      began, nothing advances;
 *    * unclosed entry, new prices         → the next update: entered from where the last ended;
 *    * closed entry, run closed again, or forming again at the SAME prices → a replay of the
 *      closing update: entered from where it began, nothing advances;
 *    * closed entry, forming again at NEW prices (the feed called it closed too early) → a
 *      new update of a bar that reopened: entered from where the close ended, recorded open,
 *      so its later updates keep counting (it used to freeze there).
 *  ⭐⭐ (step 2, A) "THE SAME PRICES" MEANS ANY PRICES THIS BAR HAS ALREADY RUN AT, not only the
 *  latest: a pane whose feed lags (or a stale refetch) runs an OLDER update after a newer one was
 *  recorded, and that is a replay of that update (entered from where IT began, shown as IT
 *  ended), never a new one; otherwise the shared ledger would spread the lagging pane's count to
 *  every pane. A price that genuinely returns to an earlier value is under-counted: the safe
 *  direction. The closing update stays as before: a closed entry at its own closing prices is
 *  the close replayed, checked first. */
//  ⚠️ (re-review L1/L2) THE TRADE-OFF, STATED: a price that truly returns to an earlier value is
//  read as a replay of THAT earlier update, so it shows that update's OLD value and does not
//  count; and past `SEEN_CAP` (or `SEEN_BYTE_CAP`) the oldest prices are forgotten, so a return
//  to one of those counts once more than Pine would and then shows a lower value than the
//  update before it. Both are rare (a bar's update count past 1,024; an exact six-field repeat
//  of O/H/L/C/V/t, which needs the volume to stand still) and both fail toward under-counting
//  or a single extra count, never toward spreading a pane's count to another.
function realtimeDecision(e, bar, rows, forming, lastConfirmed) {
  const n = rows.length
  const confirmedNow = bar <= lastConfirmed
  const sig = barSig(rows[bar])
  if (!e) {
    return forming === true && bar === n - 1
      ? { from: 'snap', record: { confirmed: false, first: true, sig }, isNew: true } : null
  }
  const same = sameSig(e.sig, sig)
  // a closed entry is its closing update, never the bar's first execution: `isNew` is 0
  if (e.confirmed && (confirmedNow || same)) return { from: e.start, record: null, isNew: false }
  const seen = !confirmedNow && e.seen ? e.seen.get(sigKey(sig)) : undefined
  if (seen) return { from: seen.start, record: null, isNew: seen.first === true }
  return { from: e.end, record: { confirmed: confirmedNow, first: false, sig }, isNew: false }
}
function realtimeRun(def, ctx, role, ir, source, rows, forming, lastConfirmed) {
  const varip = (ir.slots || []).filter((sl) => sl && sl.varip === true && sl.owner === null && sl.kind === SLOT.PERSIST)
    .map((sl) => sl.index)
  if (!varip.length && !readsIsNew(source)) return null
  // ⭐ (review H1) SHARED BY IDENTICAL PANES, ON PURPOSE: two panes of one script on one symbol
  // and timeframe see one feed, so they must show one `varip`. Sharing cannot double-count once
  // a run over the same prices is the same update (`realtimeDecision`): the second pane's run
  // re-enters from where the first pane's update began and records nothing.
  // ⭐ (review H1) AND BY WHERE THE HISTORY STARTS (`rows[0].t`): a ledger's states are of the
  // bars it ran over, so a chart with MORE bars before (older history loaded) is another
  // history, run as TradingView runs a reload: `varip` is `var` on its history, its forming bar
  // starts fresh. Two panes over different spans keep a ledger each.
  // ⛔⛔ (re-review M1, M2) A WINDOW THAT SLIDES IS NOT SERVED A `varip` AT ALL: a calc_bars_count
  // window and a framed instance (its `secondaryBars` frame is refetched whole at a fixed depth)
  // drop their oldest bar on every new bar, so `rows[0].t` moves and no ledger can carry the
  // realtime updates across exactly (`SLIDING_VARIP_WHY`). Adopting the older start's ledger was
  // tried and reset the pane it was taken from and stepped the history/realtime boundary.
  const n = rows.length
  const key = `${runKey(def, { ...ctx, newestBarIsForming: null, newest_bar_is_forming: null, interpretOpts: undefined })}|${role}`
  const origin = n ? +rows[0].t : NaN
  const ledger = ledgerFor(key, origin)
  const decisions = new Map()
  if (ledger) for (let i = 0; i < n; i += 1) {
    const e = ledger.bars.get(rows[i].t)
    if (e) decisions.set(i, realtimeDecision(e, i, rows, forming, lastConfirmed))
  }
  if (n && !decisions.has(n - 1)) {
    const d = realtimeDecision(null, n - 1, rows, forming, lastConfirmed)
    if (d) decisions.set(n - 1, d)
  }
  const notNew = new Set()
  for (const [i, d] of decisions) if (!d.isNew) notNew.add(rows[i].t)
  const isNew = isNewByBar(rows, notNew)
  const pending = new Map()
  const snap = (persist, initialised) => (varip.length
    ? { v: cloneValues([varip.map((i) => persist[i])])[0], init: varip.map((i) => initialised[i]) } : null)
  const put = (from, persist, initialised) => {
    if (!from) return
    const v = cloneValues([from.v])[0]
    for (let k = 0; k < varip.length; k += 1) { persist[varip[k]] = v[k]; initialised[varip[k]] = from.init[k] }
  }
  const hooks = {
    barStart(bar, persist, initialised) {
      const d = decisions.get(bar)
      if (!d) return
      if (d.from === 'snap') { pending.set(bar, { d, start: snap(persist, initialised) }); return }
      put(d.from, persist, initialised)
      pending.set(bar, { d, start: d.from })
    },
    barEnd(bar, persist, initialised) {
      const p = pending.get(bar)
      if (p) p.end = snap(persist, initialised)
    },
  }
  return {
    hooks,
    info: { isNew, varip: varip.slice(), ledgerBars: ledger ? ledger.bars.size : 0 },
    /** After a run that finished: what it executed joins the ledger. */
    commit() {
      const add = []
      for (const [bar, p] of pending) {
        if (!p.d.record) continue
        // ⚠️ Not mutation-provable: `barEnd` follows every `barStart` that did not throw (a throw
        // never commits), so an entry with no `end` cannot reach here today; if a VM change ever
        // lets one, it is dropped rather than recorded as `end: undefined` (which would silently
        // roll a `varip` back).
        if (!('end' in p)) continue
        add.push([rows[bar].t, { start: p.start, end: p.end, ...p.d.record }])
      }
      if (!add.length) return
      const into = ledger || { bars: new Map(), bytes: 0 }
      const before = ledgerBytes(into)
      const entryBytes = (e) => 64 + snapBytes(e.start) + snapBytes(e.end) + (e.seen ? e.seen.bytes : 0)
      for (const [time, e] of add) {
        const prior = into.bars.get(time)
        if (prior) into.bytes -= entryBytes(prior)
        // ⭐ (step 2, A) the bar's seen prices, one Map carried from update to update.
        // ⭐ (re-review L3) DROPPED WHEN THE BAR CLOSES: a closed entry is entered only from its
        // close (`realtimeDecision`), so its prices are never read again.
        let seen = null
        if (!e.confirmed) {
          seen = prior && prior.seen ? prior.seen : Object.assign(new Map(), { bytes: 0 })
          const k = sigKey(e.sig)
          const old = seen.get(k)
          if (old) { seen.bytes -= old.bytes; seen.delete(k) }
          const rec = { start: e.start, end: e.end, first: e.first === true }
          rec.bytes = 48 + 2 * k.length + snapBytes(rec.start) + snapBytes(rec.end)
          seen.set(k, rec)
          seen.bytes += rec.bytes
          while (seen.size > SEEN_CAP || (seen.bytes > SEEN_BYTE_CAP && seen.size > 1)) {
            const first = seen.keys().next().value
            seen.bytes -= seen.get(first).bytes
            seen.delete(first)
          }
        }
        const next = { ...e, seen }
        into.bars.delete(time)
        into.bars.set(time, next)
        into.bytes += entryBytes(next)
      }
      while (into.bars.size > LEDGER_BAR_CAP) {
        const first = into.bars.keys().next().value
        into.bytes -= entryBytes(into.bars.get(first))
        into.bars.delete(first)
      }
      _ledgerBytes += into.bytes - before
      keepLedger(key, origin, into)
    },
  }
}

/** ⭐ P3 WS-F (B5) — `Array.from(col)` by index: the same plain array, element for element
 *  (`NaN` and `-0` kept), without the iterator (`Array.from` over a typed array was 20 ms a
 *  tick for a 54-plot script at 5,000 bars). */
function plainCopy(col) {
  const n = col.length
  const out = new Array(n)
  for (let i = 0; i < n; i += 1) out[i] = col[i]
  return out
}

/** ⭐⭐ PERF (item d; Fred RS filled chart, item 1) — EVERY OPTION A RUN'S BUILD IS HANDED (`buildRuntimeIr`), but the
 *  recorder's hooks: one function, so the cold build, the build memo's key (`buildMemoKey`) and the depth probe
 *  (`knownFromBeforeBuild`) read the same object, and a rail can build exactly what a run builds. `sessionKey`: the
 *  run keeps a session (a `varip` builds only where its ledger runs); `slides`: the run
 *  is over a window that slides (a `calc_bars_count` window or a framed instance). */
export function runtimeIrOptions(def, rows, ctx, { sessionKey = null, slides = false } = {}) {
  const compute = (def && def.compute) || {}
  const tf = ctx && typeof ctx.tf === 'string' ? ctx.tf : undefined
  const forming = newestBarIsFormingFrom(ctx)
  const symbol = symbolOf(ctx)
  const clock = runtimeClockOpts(forming, tf ? { tf } : {})
  // ⭐⭐ RT5 — a document that draws its OWN objects builds them into the run
  // (`objectsInRun`); every other runtime document keeps the host lane's.
  const ownObjects = compute.objects === true
  return {
    // ⭐ P3 WS-F (review M3) — a `varip` builds only where its ledger runs: a run with a session
    ...(sessionKey && !slides ? { realtimeLedger: true } : {}),
    ...(slides ? { varipRefusal: SLIDING_VARIP_WHY } : {}),
    bars: rows,
    // ⭐ UIE PHASE 2 (M4) — the member's own settings (`runtimeInputs.js`): only the
    // values that differ from the author's defaults, refused by name outside the
    // author's bounds or options by the front end itself. ⭐ UIE PHASE 3 (M4) — a colour or a
    // source rides apart (`inputDefaults`): it replaces the author's default node.
    ...runtimeBuildInputs(def, ctx && ctx.runtimeInputs && typeof ctx.runtimeInputs === 'object' ? ctx.runtimeInputs : {}),
    // ⭐⭐ U15 — the document's library pins
    ...libraryBuildOpts(def && def.meta && def.meta.libraries),
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
    // ⭐ P3 WS-B — the listing fact `lowerIrProgram` reads below, handed to the
    // front end too, so a `?:` folded into a pure column reads an `na` test as
    // the VM does (`pineRuntimeFrontend.js::columnInterpretOpts`).
    ...(ctx && ctx.historyFromListing === true ? { historyFromListing: true } : {}),
  }
}

function computeRuntimeColumnsOnce(def, rows, ctx, opts = {}) {
  const compute = (def && def.compute) || {}
  const outputs = compute.outputs || {}
  // ⛔ RT1 — R-W FOR THIS LANE (`memberPaneDefinition`, `runtimeHistory`): a
  // document that needs its run to start at TradingView's bar 0 computes nothing
  // on a series that is not proven to start at the symbol's listing — refused by
  // name, never drawn off a seed TradingView never used.
  const strategyDoc = !!(def && def.meta && def.meta.runtimeHistory === STRATEGY_WINDOW_HISTORY)
  if (def && def.meta && def.meta.runtimeHistory === 'listing' && !(ctx && ctx.historyFromListing === true)) {
    // ⭐⭐ UIE PHASE 2 — R-W's WARM-UP CURTAIN, MEASURED PER RUN (`computeOffListing`):
    // the bars whose values do not depend on where the chart starts are drawn; the
    // ones before them are withheld; a script that never forgets its start is refused.
    if (opts.warmupCurtain !== false) return computeOffListing(def, rows, ctx, opts)
    if (listingUnserved(ctx)) throw refusal(RUNTIME_LISTING_UNVERIFIED_GUARD, LISTING_UNVERIFIED_REFUSAL)
    throw refusal(RUNTIME_HISTORY_GUARD, "this script is drawn bar by bar from its first bar, and this chart's "
      + "history is not known to start at the symbol's first bar, so the values it carries from bar to bar "
      + "would start from a different bar than TradingView's. Nothing is drawn rather than a guess. "
      + 'TO UNBLOCK: a chart whose loaded history reaches the listing (a daily chart of a symbol listed '
      + 'within the bars it loads) draws it.')
  }
  const tf = ctx && typeof ctx.tf === 'string' ? ctx.tf : undefined
  const forming = newestBarIsFormingFrom(ctx)
  const symbol = symbolOf(ctx)
  // ⭐⭐ RT5 — a document that draws its OWN objects builds them into the run
  // (`objectsInRun`); every other runtime document keeps the host lane's.
  const ownObjects = compute.objects === true
  const tooBig = sourceSizeRefusal(compute.source)
  if (tooBig) throw refusal(RUNTIME_LIMIT_GUARD, tooBig, 'PROGRAM_SIZE')
  // ⭐ UIE PHASE 5 (M2) — the session, and whether this run resumes from it
  // ⛔⛔ (re-review M1, M2) a run over a window that SLIDES: a calc_bars_count window
  // (`opts.slidingWindow`, set by the window itself) or a framed instance (`ctx.framed`)
  const slides = opts.slidingWindow === true || !!(ctx && ctx.framed === true)
  const sessionKey = opts.incremental === false || opts.limits ? null
    // ⛔ a sliding run keeps its OWN session: a build made with a ledger (a `varip` built) must
    // never be reused by a run that refuses one
    // ⭐⭐ (item 3) …and a run that reads requests keeps ONE session across its supply's changes: what it built does
    // not read the other-symbol cache (`buildRuntimeIr` is handed no other symbol's bars), and what its checkpoint
    // read of the supply is checked bar for bar before it is resumed (`acrossSupplyBlocked`)
    : `${runKey(def, ctx, _resumeAcrossSupplyOff)}|${opts.sessionRole || 'run'}${slides ? '|slides' : ''}`
  const prevSession = sessionKey ? _sessions.get(sessionKey) : null
  // ⭐⭐ P3 WS-F (B5) — THE SESSION'S BUILD, REUSED: the front end is not run again, only
  // the columns are re-evaluated over THESE bars (`buildRecorder`, `columnsOver`).
  const reused = prevSession && prevSession.build && rows.length ? columnsOver(prevSession.build, rows, prevSession) : null
  const reusedLast = reused ? _lastReused : 0
  // ⭐⭐ PERF (item d) — every option the build reads, in one object (`runtimeIrOptions`): the cold build is handed
  // it, and the build memo keys on it (`buildMemoKey`: all of it but the bars and the symbol, whose READ constants it
  // checks instead)
  const irOpts = runtimeIrOptions(def, rows, ctx, { sessionKey, slides })
  // ⭐⭐ PERF (item d) — a build kept from another session (another symbol, the curtain's other run, a timeframe
  // revisited), its columns re-evaluated over these bars, or null: build cold, recorded for the memo
  const memo = !reused && sessionKey && rows.length ? buildMemoHit(def, irOpts, rows) : null
  const recorder = !reused && !memo && sessionKey && rows.length ? buildRecorder() : null
  const built = reused ? { ok: true, ir: { ...prevSession.build.ir, columns: reused } }
    : memo ? { ok: true, ir: { ...memo.build.ir, columns: memo.columns } }
      : withTranslateClock(opts.now, () => buildRuntimeIr(String(compute.source || ''), {
        ...(recorder ? { columnInterpret: recorder.interpret, onBindRead: recorder.bindRead } : {}),
        ...irOpts,
      }))
  if (!built.ok) {
    const r = built.refusal || {}
    throw refusal(r.guard || 'runtime:build', r.message || 'the runtime lane could not build this script')
  }
  // ⭐⭐ RS RATING L5 — A REQUEST OF OTHER BARS IS SUPPLIED (below, `runtimeRequestSupply`),
  // by the host's rules: the host's reading of the request, the host bind's decision over the
  // chart's own other-symbol cache, the host evaluator's alignment. ⚰️ It was refused here
  // whatever the request ("handed only the chart's own bars").
  // ⛔ EXCEPT OVER A WINDOW THAT SLIDES (a `calc_bars_count` window or a framed instance):
  // where its first bar lands is not where a merge's first period does. Out of scope; it
  // keeps the refusal it had.
  const requestSites = built.ir.requests || []
  if (requestSites.length && slides) {
    throw refusal('runtime:request', 'this script requests another symbol or timeframe, and this run is over a '
      + 'window that slides with each new bar, so its requested bars are not aligned here; nothing is drawn '
      + 'rather than a blank line')
  }
  // ⭐⭐ RT3 — from the listing, a `NaN` is Pine's `na` and an `na` condition reads
  // as Pine reads it; off it the shared `{0,1,NaN}` rules stand (`lowerIrProgram`).
  // ⭐ P3 WS-F (B5) — a reused build lowers to the session's program (one IR, one
  // deterministic lowering), so the resume check is handed that program with THESE
  // columns; a run that does not resume lowers afresh below (its own constants).
  const lowerOpts = { historyFromListing: !!(ctx && ctx.historyFromListing === true) }
  let program = reused ? { ...prevSession.program, columns: reused } : lowerIrProgram(built.ir, lowerOpts)
  // ⭐ P1 HARDENING — the document is run only by the engine it was minted for, and
  // only while each mapped index still names the output it named at mint.
  const versionWhy = runtimeVersionRefusal(def, program.outputs)
  if (versionWhy) throw refusal(RUNTIME_VERSION_GUARD, versionWhy)
  // ⭐⭐ W9-T11 — a strategy document whose program holds no broker (the broker gate is off in
  // this build) is refused as the gate-off door refuses a strategy, never run as a plain
  // document over a window R-W never checked.
  if (strategyDoc && !program.broker) {
    throw refusal('pine:strategy-call', 'this script is a strategy whose values come from the broker '
      + 'emulator, which is not switched on in this build, so nothing is drawn.')
  }
  // ⛔ W9-T11 — a broker never runs over a window that SLIDES (a calc_bars_count window or a
  // framed instance): its trades would depend on where the slide put the first bar.
  if (program.broker && slides) {
    throw refusal(BROKER_START_GUARD, 'a strategy run takes the most recent bars of its history window, '
      + 'and this run is over a window that slides with each new bar, so its trades would move. Nothing is drawn.')
  }
  // ⭐⭐ RS RATING L5 — THE REQUESTED BARS, per site (`requestSupply.js`). A refusal names its
  // reason; a symbol still loading holds the run (no columns, nothing said, as the host lane
  // says nothing about a read still waiting); the newest bar alone withheld is withheld below.
  // ⭐ REQ — inside the off-listing warm-up runs (`computeOffListing`, `warmupCurtain: false`) the partial
  // first period of a look-ahead read is the curtain's to judge: the two runs agree only where it no longer
  // reaches, and every bar before that is withheld by the curtain (`requestSupply.js`, `curtained`).
  // ⛔ (item 3, 2026-11-19, measured; coordinator ruling: DROPPED) — the supply is computed afresh on every run, a tick
  // included. A memo keyed on the rows' times and the other-symbol cache's fingerprints was approved and then dropped:
  // during the session the newest requested bar moves on every tick, so that key misses on every tick. Only a supply
  // DERIVED from the previous one when the newest bar alone moved would pay, and after #1977 and #2003 the supply costs
  // ~9 ms a run on 11,520 5m bars (a resumed tick: ~116 ms in all). Re-open with a measured tick where it dominates.
  const curtainedSupply = !!(opts && opts.warmupCurtain === false)
  const reqSupply = requestSites.length
    ? (supplyProbed(opts && opts.probedSupply, program.requests, rows, ctx, curtainedSupply)
      || runtimeRequestSupply(program.requests, rows, curtainedSupply ? { ...ctx, curtained: true } : ctx))
    : null
  if (reqSupply && reqSupply.refusal) {
    const err = refusal(reqSupply.refusal.guard, reqSupply.refusal.message)
    // ⭐⭐ a DEPTH gap only (`requestSupply.js`): the caller may start the run where every read is known
    if (Number.isInteger(reqSupply.refusal.knownFrom)) err.knownFrom = reqSupply.refusal.knownFrom
    // ⭐⭐ T4 E2 — and what the bars before it are withheld for, when the depth has its own words (an event family's record)
    if (reqSupply.refusal.why && Number.isInteger(reqSupply.refusal.knownFrom)) err.knownFromWhy = reqSupply.refusal.why
    // ⭐⭐ (2026-11-20) an OVERNIGHT tail: the caller cuts the run there (`computeRuntimeColumns`)
    if (Number.isInteger(reqSupply.refusal.cutAt)) {
      err.cutAt = reqSupply.refusal.cutAt
      err.overnightSeries = Array.isArray(reqSupply.refusal.series) ? reqSupply.refusal.series : []
      if (reqSupply.refusal.tailWait === true) { err.tailWait = true; err.tailPending = reqSupply.refusal.tailPending === true }
    }
    throw err
  }
  const build = reused ? prevSession.build : memo ? memo.build : (recorder ? recorder.done(built.ir, rows.length) : null)
  // ⭐ PERF (item d) — a build made cold here is kept for the next run with its key
  if (recorder && build) keepBuildMemo(def, irOpts, build)
  // ⭐ (e85) a run that waits keeps the build it made (above): the run its series' update asks for is not cold
  if (reqSupply && reqSupply.pending) {
    // PENDING, NOT REFUSED (2026-11-16): the guard is unchanged, and the error says the wait is
    // a wait (`pending`), so a reader that words a refusal does not word this one as final
    // (`nativeRegistry.js::withRunHalf` holds the run half instead of naming a cause).
    // ⭐⭐ (e85) a wait for other series' NEWEST bars (a live-tail lag, `requestSupply.js`) says so, and names them
    // (`waitingFor`, plain text: it crosses the worker, `errorImage.js`), for the strip's status
    const w = reqSupply.waiting
    throw requestWait(w ? w.sentence : "this script reads another symbol whose bars are still loading; it is "
      + 'drawn once they arrive', w ? w.series : null)
  }
  // ⭐⭐ (e85, the reply after a new bar) — THE NEWEST BAR ALONE ON ANOTHER SERIES' LIVE TAIL, IN A RUN THAT DRAWS. Its
  // withholding (below) takes every drawing when the read reaches one (`requestNewestHeldOf`: `keys: null`), and off the
  // listing the two-start proof then withheld them all as `runtime:history-start` ("a run did not finish its drawings")
  // until the series caught up: captured on e85, the chart grew a bar and SPX had not. That bar is "not arrived yet",
  // so the drawing run WAITS (a lag past the bound is refused by name); its plain run (`computeRuntimeColumnsAll`) still
  // draws the plots with that bar withheld, as before. ⛔ Only when EVERY site withheld there is such a tail: a bar a
  // chart-clock rule withholds will not arrive.
  if (!_newestTailWaitOff && ownObjects && reqSupply && reqSupply.newestWithheld && Array.isArray(reqSupply.newestTail)
      && reqSupply.newestTail.length && reqSupply.newestTail.length === reqSupply.newestWithheldSites.length
      && requestNewestHeldOf(program.requests, reqSupply.newestWithheldSites, outputs).keys === null) {
    const late = reqSupply.newestTail.find((t) => !t.within)
    const series = reqSupply.newestTail.map((t) => t.series)
    // ⭐⭐ (e91, coordinator ruling (2b)) — the newest bar alone on the tail is CUT too, never the whole run waiting. ⚰️
    // MEASURED (this file's product rail, Fred RS one bar ahead of SPX): the drawing run waited, its plain program does
    // not stand on its own, so the WHOLE run waited and a freshly opened pane stayed blank. Cut at the newest bar: the
    // values are drawn up to it, the drawings wait named (`computeRuntimeColumns`), and SPX's update draws them
    if (!tailCutIsOff() && rows.length > 1) {
      const cut = refusal(late ? REQUEST_LAG_GUARD : REQUEST_GUARD, late ? late.message : tailCutSentence(series))
      cut.cutAt = rows.length - 1
      cut.overnightSeries = [...new Set(series)]
      cut.tailWait = true
      cut.tailPending = !late
      throw cut
    }
    if (late) throw refusal(REQUEST_LAG_GUARD, late.message)
    throw requestWait(requestWaitingSentence(series), series)
  }
  // ⛔ RS RATING L5 — a run that reads requested bars never resumes from a checkpoint: the
  // checkpoint's state was computed from the requested bars of an EARLIER supply.
  // ⭐⭐ (item 3) …unless its supply agrees with the checkpoint's (`acrossSupplyBlocked`)
  const acrossSupply = !!reqSupply && !_resumeAcrossSupplyOff && opts.resumeAcrossSupply !== false
  const resumable = prevSession && !opts.probe && (!reqSupply || acrossSupply)
    ? resumableFrom(prevSession, rows, program, reqSupply ? reqSupply.supply : null)
    : { why: reqSupply ? 'request' : sessionKey ? 'cold' : 'off' }
  // ⚠️ Fresh constants for a run from bar 0 — conservative, NOT mutation-provable: running the
  // session's program instead drew the same columns and drawings on every rail and probe tried
  // (`runtimeRealtimeGuards.test.js`, a drawing script re-run after an old bar moved).
  if (reused && !resumable.checkpoint) program = lowerIrProgram(built.ir, lowerOpts)
  // a probe that rides only a run from scratch (the curtain's A, `computeOffListing`)
  const runProbe = opts.probe || (resumable.checkpoint ? null : (opts.probeIfCold || null))
  const lastConfirmed = forming === false ? rows.length - 1 : rows.length - 2
  const resumeFrom = resumable.checkpoint || null
  // ⭐ a resumed run runs the SESSION's program (its constants — a drawing-handle template
  // the checkpointed state already holds is that very object) over THIS build's columns
  const runProgram = resumeFrom ? { ...prevSession.program, columns: program.columns } : program
  // ⭐ P3 WS-F (B5) — the five series and the times in ONE pass (it was six `map`s and five
  // `Float64Array.from`s, about 3 ms a tick at 5,000 bars); the same numbers.
  const nRows = rows.length
  const series = [new Float64Array(nRows), new Float64Array(nRows), new Float64Array(nRows),
    new Float64Array(nRows), new Float64Array(nRows)]
  const barTimes = new Array(nRows)
  for (let i = 0; i < nRows; i += 1) {
    const b = rows[i]
    series[0][i] = b.o; series[1][i] = b.h; series[2][i] = b.l; series[3][i] = b.c; series[4][i] = b.v
    barTimes[i] = b.t
  }
  // ⭐⭐ (2026-11-17, strategy-epoch-bar-times) — A BROKER RUN READS A BAR'S TIME AS `time` DOES. The product keys a
  // D / W / M bar by its ISO DATE (`/api/bars` `t: 'YYYY-MM-DD'`) and an intraday bar by its unix seconds; `time` reads
  // either as the instant the bar opened (`indicators.js::barOpenInstants`, the clock columns' own gate). A broker run
  // is handed THOSE instants, so its clock reads, its fills, its trades' and orders' times and its record's window
  // (below) are the times an epoch-second run records for the same bars, and `strategy.closedtrades.entry_time` is
  // `time` of the fill bar. A series the gate cannot read is `na` on every bar, as `time` is there: never a key in
  // disguise. ⚰️ The broker was handed the keys: on a daily chart every trade time was a date string, the report
  // refused whole (`runtime:strategy-report-record`) and every trade-time read refused by name.
  // ⛔ A run WITHOUT a broker keeps the keys it always had: changing what every other script's run reads is a wider
  // engine change, not this one.
  const runTimes = runProgram.broker ? brokerBarTimes(rows, tf) : barTimes
  // ⭐⭐ P3 WS-F — `varip` and `barstate.isnew`: the realtime ledger of this chart's run
  const realtime = sessionKey ? realtimeRun(def, ctx, opts.sessionRole || 'run', built.ir, compute.source,
    rows, forming, lastConfirmed) : null
  // ⭐⭐ RT1 — THE TIME BUDGET, checked at the end of every bar through the VM's
  // own per-bar hook (no VM change): past it the run stops by name.
  // ⭐⭐ (coordinator ruling 2026-11-19) scaled by the bars this run covers when its caller asked (`budgetFor`)
  const budgetMs = Number.isFinite(opts.budgetMs) ? budgetFor(opts, rows.length) : null
  // ⭐⭐ (engine 86) in the worker the VM's `WALL_TIME` follows this budget (`runLimitsOf`); elsewhere `opts.limits` as passed
  const runLimits = runLimitsOf(opts, budgetMs)
  const now = clockOf(opts)
  const startedAt = budgetMs !== null ? now() : 0
  if (typeof opts.onProgram === 'function') opts.onProgram(program)
  // ⭐⭐ C43 — the script's own `runtime.error` (C35's `PineRuntimeError`) stops
  // the run on the bar it is reached; TradingView's study then holds nothing and
  // names that bar (`vw-runtime-error-reached`). The bar is the one after the last
  // the run finished, stamped on the error for the member's sentence
  // (`nativeRegistry.runtimeColumnsOrReasons`).
  let finished = -1
  let res
  // ⭐⭐ Engine 76 (#1803, fix/strategy-refusal-keeps-plots) — the broker's own refusal, when the run stood in for it
  // without the broker (`disarmedAfter`): the plots are drawn and the backtest alone is refused by name
  let backtestRefused = null
  const runCtx = {
      bars: rows.length,
      series,
      columns: program.columns,
      // Only a bar KNOWN to have finished is confirmed; unknown fails closed the
      // way `interpret` does for the four realtime clock columns.
      confirmed: forming === false,
      barTimes: runTimes,
      // ⭐⭐ RS RATING L5 — the requested bars and, per chart bar, which one is read
      ...(reqSupply ? { requestSupply: reqSupply.supply } : {}),
      // ⭐⭐ W9-T11 — the window the VM checks a broker run against (`vm.js`, [3.4]): the
      // context's, never a literal
      ...(ctx && ctx.historyWindowBars !== undefined ? { historyWindowBars: ctx.historyWindowBars } : {}),
      // ⭐⭐ (2026-11-19, the strategy-only daily window) the depth a run from the listing is served at without the
      // deep-start rule (`vm.js` [B-START-DEEP]); absent, the window itself (every run as before)
      ...(ctx && ctx.listingDepthBars !== undefined ? { listingDepthBars: ctx.listingDepthBars } : {}),
      // ⭐⭐ W9-T4-F1 — the symbol's `syminfo.mincontract`, from the ONE authority a script's own
      // `syminfo.mincontract` folds from (`bind.js::symbolConstants`, the witnessed
      // `symbolScope.json::min_contract` table). DERIVED from the symbol, never read from `ctx`:
      // no caller can state it, so an unwitnessed exchange stays undefined and a cash /
      // percent-of-equity size refuses by name (Q-S1a). `minContractLock.test.js` holds this line.
      minContract: minContractOf(symbolConstants(symbol)),
      // ⭐ UIE PHASE 2 — `opts.limits` is a MEASUREMENT door (the limits census,
      // `runtimeLimitsBudget.measure.test.js`); no product caller passes it, so every
      // chart runs under `DEFAULT_LIMITS`.
    }
  const onBar = (bar) => {
    finished = bar
    if (budgetMs !== null) {
      const spent = now() - startedAt
      if (spent > budgetMs) {
        // ⛔ TAGGED AS THE PANE'S: the VM's own `limits.WALL_TIME` throws the same
        // class and name, and must not be reported as this budget.
        const over = new RuntimeLimitError('WALL_TIME', budgetMs, Math.round(spent))
        over.paneBudget = true
        throw over
      }
    }
  }
  /** ⭐⭐ Engine 76 (#1803, fix/strategy-refusal-keeps-plots) — THE BROKER REFUSED BY NAME: THE PLOTS STAY.
   *  Owner rule (coordinator ruling 2026-11-18): an admission must never take away what a member sees today. When
   *  a strategy's broker run refuses by name ([B-START] on a chart whose history does not reach the listing, an
   *  unpinned rule, an unsettled question), the same program is run again WITHOUT its broker (`vm.js`
   *  `brokerDisarmed`: an order places nothing, every bar is run as the host lane runs it) and its plots and paints
   *  are drawn; the backtest alone is refused, by the broker's own name (`refusedStrategyRecordOf`). Any other stop
   *  is not the broker's and is not retried.
   *  ⭐⭐ Engine 77 (#1833, fix/strategy-disarmed-taint) — WHAT IS DRAWN IS DECIDED STATICALLY, by the host lane's own
   *  taint (W9-OQ-N2, `strategyTaint.js::strategyDisarmOf`, the program's `broker.disarm`, coordinator ruling
   *  2026-11-18 (a)): every output a broker value reaches is withheld by name (`withheldByTaint`, below) and the rest
   *  are drawn; a broker number read inside the run is `na` only so the order logic can finish. ⛔ FAIL CLOSED, the
   *  broker's refusal kept (ruling (b)): a broker value reaching a sink with no row of its own (a `fill` band,
   *  `alert()`, `hline`) or a drawing, a trace that failed, a program with no verdict, and any throw of the run.
   *  ⚰️ supertrend-strategy on SPY daily (5,000 of 8,509 bars): the broker run refused [B-START] and the member lost
   *  the seven plots the host lane drew; macd-shortlong-strategy-for-tradingview-input-optimizer, whose ORDER logic
   *  reads `strategy.position_size`, lost its six MACD plots until the verdict was static. */
  const disarm = runProgram.broker && runProgram.broker.disarm
  const disarmedAfter = (err) => {
    if (!runProgram.broker || !(err instanceof BrokerRefusal || err instanceof BrokerUnpinned || err instanceof BrokerStart)) return null
    if (!disarm || disarm.refused || !Array.isArray(disarm.withheld)) return null
    // a stand-in that would draw NOTHING (every output it maps is one a broker value reaches) gains the member nothing:
    // the broker's refusal stands, exactly as it read before
    const held = new Set(disarm.withheld.map((w) => w.index))
    const built = (runProgram.outputs || []).length
    if (!Object.values(outputs).some((index) => Number.isInteger(index) && index < built && !held.has(index))) return null
    try {
      finished = -1
      beginAlertLog()
      return execute(runProgram, runCtx, runLimits, { ...injectedNow(opts), brokerDisarmed: true, onBar })
    } catch {
      return null
    }
  }
  // ⭐⭐ TRACK 6, AL1 -- the run's alert log starts empty here and is taken once the run is answered (below)
  beginAlertLog()
  try {
    res = execute(runProgram, runCtx, runLimits, {
      ...injectedNow(opts),
      ...(runProbe ? { probe: runProbe } : {}),
      ...(resumeFrom ? { resume: resumeFrom } : {}),
      ...(realtime ? { realtime: realtime.hooks } : {}),
      ...(sessionKey && lastConfirmed >= 0 && !(resumeFrom && resumeFrom.bar >= lastConfirmed)
        ? { checkpointAt: lastConfirmed } : {}),
      onBar,
    })
  } catch (err) {
    takeAlertLog()   // AL1: a stopped run's partial log is never served (a stand-in begins its own)
    // ⭐⭐ (item 3) a run resumed across a supply that throws is run again in full: its stop is the full run's own
    // (a time stop is the box's, never the script's, and is said as it is)
    if (resumeFrom && reqSupply && !(err instanceof RuntimeLimitError && err.limit === 'WALL_TIME')) {
      return computeRuntimeColumnsOnce(def, rows, ctx, { ...opts, resumeAcrossSupply: false })
    }
    const stood = disarmedAfter(err)
    if (stood) {
      res = stood
      backtestRefused = err
    } else {
    if (err && err.name === 'runtime.error') err.bar = finished + 1
    // ⭐ THE BAR A STOP NAMES, 1-BASED, THE SAME WAY FOR EVERY STOP. `finished` is the
    // 0-based index of the last bar whose END was reached (-1 before the first). The
    // pane's check runs IN that bar's end hook, so its stop is bar `finished + 1`; every
    // VM stop (a limit mid-bar, or the VM's own bar-end account, which runs BEFORE the
    // hook) is on the bar AFTER it: `finished + 2`. Railed: both sentences name the same
    // bar for the same stop (`runtimeLimitSentence.test.js`).
    const stopBar = err instanceof RuntimeLimitError && err.paneBudget === true ? finished + 1 : finished + 2
    // ⛔⛔ EVERY WALL-CLOCK STOP IS `runtime:time-budget` (LIMITS r1, ruling B2-a): a time
    // stop is a property of the box, never of the script, so the result cache (service
    // `cache.mjs::cacheable`, `pine_runtime_client.py::cacheable`) must never store it.
    // The sentence names the ceiling that ACTUALLY fired: the pane's `budgetMs`, or the
    // VM's own `limits.WALL_TIME` (a single bar that ran past it, e.g. under a stall).
    if (err instanceof RuntimeLimitError && err.limit === 'WALL_TIME') {
      const which = err.paneBudget === true
        ? "which is this pane's budget for one indicator"
        : 'which is the most time one run of a script may take'
      throw refusal(RUNTIME_TIME_BUDGET_GUARD, `this script took more than ${err.ceiling} ms to draw `
        + `bar by bar (it had reached bar ${stopBar} of ${rows.length}), ${which}, so it is stopped `
        + 'and nothing is drawn rather than part of it.', 'WALL_TIME')
    }
    // ⭐⭐ RF — EVERY OTHER STOP OF THE RUN IS NAMED TOO. A VM limit
    // (`limits.js`: loop iterations, collection sizes, …) and an unexpected throw
    // used to reach the registry as a bare `Error` — guard `engine:error`, message
    // `LOOP_ITERATIONS_EXCEEDED — ceiling …` — which is not a sentence a member
    // can read. The script's own `runtime.error` (C43) keeps its own path.
    if (err && err.name !== 'runtime.error' && !err.guard) {
      if (err instanceof RuntimeLimitError) {
        throw refusal(RUNTIME_LIMIT_GUARD, runtimeLimitSentence(err, stopBar, rows.length), err.limit)
      }
      // A collection / record / VM error words its own reason (`collections.js`:
      // "array.sum of an empty array — …"); it is kept, with the bar it stopped on.
      const failed = refusal(RUNTIME_FAILED_GUARD, `this script stopped on bar ${stopBar} of ${rows.length} `
        + `when drawn bar by bar (${String((err && err.message) || err).slice(0, 400)}), so nothing is drawn `
        + 'rather than part of it.')
      failed.cause = (err && err.name) || 'Error'
      throw failed
    }
    throw err
    }
  }
  if (typeof opts.onBudget === 'function') opts.onBudget(res.budget)   // the census reads its counts
  // a run that stood in for a refused broker held no realtime session, checkpoint or resume of its own
  if (realtime && !backtestRefused) realtime.commit()
  if (sessionKey && !backtestRefused) {
    // ⭐⭐ (item 3) a new checkpoint of a run that reads requests keeps what it read of THIS supply
    if (res.checkpoint && reqSupply) res.checkpoint.supply = supplyDigestOf(reqSupply.supply, res.checkpoint)
    const checkpoint = res.checkpoint || (resumeFrom && resumeFrom.bar <= lastConfirmed ? resumeFrom : null)
    _sessions.delete(sessionKey)
    const next = { rows: rowsSnapshot(rows), program: runProgram, checkpoint, ...(build ? { build } : {}) }
    next.bytes = sessionBytes(next)
    if (next.bytes <= SESSION_BYTE_CAP / 2) {
      _sessions.set(sessionKey, next)
      let total = 0
      for (const s of _sessions.values()) total += s.bytes
      while (_sessions.size > SESSION_CAP || total > SESSION_BYTE_CAP) {
        const oldest = _sessions.keys().next().value
        total -= _sessions.get(oldest).bytes
        _sessions.delete(oldest)
      }
    }
  }
  // ⛔ RS RATING L5 — a request the run could not be handed (a nested request, a symbol the
  // supply did not name) answered `na`: refused by name, never drawn as a blank line.
  if (reqSupply && res.requested && res.requested.length) {
    throw refusal('runtime:request', `this script requested ${res.requested.join(', ')} while it ran (a request `
      + 'inside a request, or a symbol computed as it runs), which this run is not handed, so nothing is drawn '
      + 'rather than a blank line')
  }
  const out = {}
  // ⭐⭐ Engine 77 (#1833, fix/strategy-disarmed-taint) — a run that stood in for a refused broker: the outputs a broker
  // value reaches are WITHHELD by name (`strategyDisarmOf`), never drawn from the `na` the run read in its place
  const withheldByTaint = backtestRefused ? new Map(disarm.withheld.map((w) => [w.index, w])) : null
  const taintErrors = {}
  for (const [plotKey, index] of Object.entries(outputs)) {
    const w = withheldByTaint && withheldByTaint.get(index)
    if (w) {
      taintErrors[plotKey] = { guard: DISARMED_WITHHELD_GUARD, message: disarmedWithheldSentence(w) }
      continue
    }
    const col = res.outputs[index]
    if (col) out[plotKey] = plainCopy(col)
  }
  withColumnErrors(out, taintErrors)
  // ⭐ RS RATING L5 — the newest bar a request cannot know yet (`request:htf-newest-unconfirmed`)
  // is withheld, as the host withholds that bar, and named beside the columns it blanks.
  // ⭐⭐ HTF-NEWEST-NARROW (coordinator ruling 2026-11-19) — ONLY on the outputs that request reaches on that bar:
  // each withheld site's `newestReach` (`strategyTaint.js::requestNewestReachOf`, the same-bar taint from its call,
  // `x[k]` k >= 1 cut). ⚰️ It blanked EVERY column, plots that never read the request included. ⛔ A site with no
  // reach, or one whose reach is refused (a `fill` / `hline` / `alert` or a drawing it reaches, an unplaced output, a
  // trace that failed), keeps the whole-bar rule, every column and every drawing.
  const newestHeld = reqSupply && reqSupply.newestWithheld && rows.length
    ? requestNewestHeldOf(runProgram.requests, reqSupply.newestWithheldSites, outputs) : null
  if (newestHeld) {
    const keys = newestHeld.keys === null ? Object.keys(out) : newestHeld.keys
    for (const k of keys) if (out[k] && out[k].length === rows.length) out[k][rows.length - 1] = NaN
    Object.defineProperty(out, RUNTIME_REQUEST_WITHHELD_KEY, { enumerable: false, configurable: true,
      value: Object.freeze({ bar: rows.length - 1, codes: [...reqSupply.codes], sentences: [...reqSupply.sentences],
        keys: newestHeld.keys === null ? null : Object.freeze([...newestHeld.keys]) }) })
  }
  Object.defineProperty(out, RUNTIME_INCREMENTAL_KEY, { enumerable: false, configurable: true,
    value: { resumedFrom: Number.isInteger(res.resumedFrom) ? res.resumedFrom : null,
      why: resumeFrom ? null : resumable.why, ranBars: rows.length - (resumeFrom ? resumeFrom.bar + 1 : 0),
      rebuilt: !reused && !memo, columnsReused: reused ? reusedLast : 0, buildMemo: !!memo } })
  if (realtime) Object.defineProperty(out, RUNTIME_REALTIME_KEY, { enumerable: false, configurable: true, value: realtime.info })
  // ⭐⭐ TRACK 6, AL1 -- the run's alert() calls, only for a run over every bar from the first
  const alertLog = takeAlertLog()
  if (alertLog && !resumeFrom) {
    Object.defineProperty(out, RUNTIME_ALERTS_KEY, { enumerable: false, configurable: true,
      value: Object.freeze({ fromBar: 0, events: Object.freeze(alertLog.events.map((e) => Object.freeze({ ...e }))),
        dropped: alertLog.dropped }) })
  }
  // ⭐⭐ W9-T11 — THE RUN'S `strategy` RECORD (design 3.2), plain data beside the columns
  if (res.broker) {
    withStrategyRecord(out, strategyRecordOf({ summary: res.broker, decl: runProgram.broker, barTimes: runTimes,
      historyWindowBars: ctx && ctx.historyWindowBars, confirmed: forming === false }))
  } else if (backtestRefused) {
    // the plots stood in without the broker: the backtest is refused by the broker's own name (`disarmedAfter`)
    withStrategyRecord(out, refusedStrategyRecordOf({ decl: runProgram.broker, barTimes: runTimes,
      historyWindowBars: ctx && ctx.historyWindowBars, confirmed: forming === false, refused: backtestRefused,
      withheld: Object.keys(taintErrors).length }))
  }
  // ⭐⭐ RT5 — THE DRAWINGS THIS SAME RUN MADE, as plain data (structured-clone
  // safe for the worker), beside the columns.
  if (ownObjects) {
    const fin = res.objects ? res.objects.finish() : { status: 'ok', reason: null, live: [], withheld: {} }
    // ⛔ RS RATING L5 — a run whose newest bar read a request it cannot know yet draws no
    // drawing (a last-bar label would carry that read), and says why
    const held = newestHeld && newestHeld.keys === null
      ? { status: 'WITHHELD', guard: reqSupply.codes[0] || 'runtime:request', reason: reqSupply.sentences[0] || '' }
      : null
    withRuntimeObjects(out, held || { ...fin, pineVersion: Number.isFinite(program.version) ? program.version : null })
  }
  return out
}

/** ⭐⭐ (2026-11-17) — THE BAR TIMES A BROKER RUN IS HANDED: each bar's opening instant in unix seconds, from the ONE
 *  gate `time` reads (`indicators.js::barOpenInstants`), or `NaN` on every bar when that gate reads the series as
 *  having none (one unreadable bar blanks `time` on every bar, and so here). A plain array: the VM's clock, the
 *  broker (`broker.js` `timeOf` / `barTimeMs`) and the record (`strategyRecord.js` `timeAt`) index it. */
export function brokerBarTimes(rows, tf) {
  const opens = barOpenInstants(rows, tf)
  const n = Array.isArray(rows) ? rows.length : 0
  return opens ? Array.from(opens) : new Array(n).fill(NaN)
}

/** ⭐ RS RATING L5 — where a run's newest-bar request withholding rides (non-enumerable): `{bar, codes, sentences,
 *  keys}`, `keys` the plot keys blanked on that bar, or `null` when every column (and every drawing) was. */
export const RUNTIME_REQUEST_WITHHELD_KEY = '__runtimeRequestWithheld'

/** ⭐⭐ HTF-NEWEST-NARROW (2026-11-19) — which outputs a run blanks on its newest bar for the request sites that
 *  cannot know it: `{keys: [plot keys]}` (the union of each site's `newestReach.withheld`), or `{keys: null}` (every
 *  column and every drawing) when any such site carries no reach or a refused one. `outputs` is plot key -> index. */
export function requestNewestHeldOf(requests, sites, outputs) {
  const list = Array.isArray(requests) ? requests : []
  const at = Array.isArray(sites) ? sites : []
  if (!at.length) return { keys: null }
  const indices = new Set()
  for (const s of at) {
    const reach = list[s] && list[s].newestReach
    if (!reach || reach.refused || !Array.isArray(reach.withheld)) return { keys: null }
    for (const w of reach.withheld) if (w && Number.isInteger(w.index)) indices.add(w.index)
  }
  const keys = []
  for (const [k, index] of Object.entries(outputs || {})) if (indices.has(index)) keys.push(k)
  return { keys }
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

/** ⭐⭐ THE PARITY SEAM — THE CLOCK THE SYNCHRONOUS DOOR HANDS ITS RUN, when anything does.
 *
 *  `null` (the default, and EVERY member) — the run reads the host's clock and the
 *  pane's `RUNTIME_PANE_TIME_BUDGET_MS` is a real wall-clock stop, exactly as before.
 *  ⛔ Only a PARITY grader installs one (the vendor harness, `ourSide.js`, for the
 *  length of one grade, and it restores `null`): a grade asks "does our value equal
 *  TradingView's", and a wall clock answers "how busy was the box" — under load the
 *  1,000 ms stop fired and the harness graded the machine (INCONCLUSIVE, no column).
 *  A clock that never moves keeps every wall-clock stop (the budget, the VM's
 *  `WALL_TIME`, the translator's timeout) from firing, while the instruction
 *  budgets (`limits.js`) still bound the run: ruling R3, a clock is a safety stop
 *  and never a verdict. The budget, the door and the guard are unchanged; that the
 *  door still enforces them, and that no shipped module installs a clock, is railed
 *  in `runtimeDoorBudget.rail.test.js`. */
let _doorClock = null
export function setRuntimeDoorClock(now) {
  _doorClock = typeof now === 'function' ? now : null
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
export function runtimeColumnsFor(def, bars, inputs, ctx) {
  const rows = Array.isArray(bars) ? bars : []
  // ⭐ UIE PHASE 2 (M4) — the instance's settings ride the context the run reads
  const values = runtimeInputValues(def, inputs)
  if (Object.keys(values).length) ctx = { ...(ctx || {}), runtimeInputs: values }
  const key = runKey(def, ctx)
  let perBars = _memo.get(rows)
  if (!perBars) { perBars = new Map(); _memo.set(rows, perBars) }
  // ⭐ (engine 86) a budget stop remembered before a Retry is dropped here, and the bars run again
  if (perBars.has(key) && perBars.get(key) && perBars.get(key).budgetGen !== undefined
      && perBars.get(key).budgetGen !== runtimeBudgetGeneration()) {
    perBars.delete(key)
  }
  if (perBars.has(key)) {
    const hit = perBars.get(key)
    // ⭐ C43 — a run the script stopped is remembered as that stop, not re-run;
    // ⭐ RT1 — and so is a refusal or a budget stop, and an in-flight run.
    if (hit && hit.stoppedBy) throw hit.stoppedBy
    if (hit && hit.pending) return {}
    return hit
  }
  // ⭐⭐ (engine 86) — A TIME-BUDGET STOP IS REMEMBERED FOR THIS PAGE, per document, symbol, timeframe, settings and
  // history fact (`runKey` WITHOUT the other-symbol supply, which moves every tick): a live chart's next bars are not
  // run cold again only to be stopped again (they were, on every update, each burning the whole budget and drawing
  // nothing). ⛔ Never persisted: a reload, another setting or symbol, or Retry on the strip
  // (`retryRuntimeBudgetStops`) runs it again, so a stop that came from a busy machine is never permanent.
  const stopKey = runKey(def, ctx, false)
  const remembered = runtimeBudgetStopAt(stopKey)
  if (remembered) {
    perBars.set(key, { stoppedBy: remembered.err, budgetGen: runtimeBudgetGeneration() })
    throw remembered.err
  }
  const stopOf = (err) => {
    if (!(err && err.guard === RUNTIME_TIME_BUDGET_GUARD)) return { stoppedBy: err }
    const kept = budgetStopOf(err)
    rememberRuntimeBudgetStop(stopKey, def && def.id, kept)
    return { stoppedBy: kept, budgetGen: runtimeBudgetGeneration() }
  }
  if (_runner) {
    // ⭐⭐ RT1 — OFF THE MAIN THREAD. The run is handed to the worker and this
    // paint draws nothing for the definition; when the columns land they are
    // remembered under the same key and every listener is told, so the next
    // paint reads them here. A run is never started twice for one key.
    const pending = { pending: true }
    perBars.set(key, pending)
    _runner(def, rows, ctx, (err, columns) => {
      perBars.set(key, err ? stopOf(err) : columns)
      for (const fn of [..._landed]) {
        try { fn(key) } catch { /* a bad listener must not break the lane */ }
      }
    }, () => {
      // ⭐ (engine 86) a run that will never be answered (superseded, or stopped because its pane asked for another
      // picture, `runtimeAsync.js`): its pending entry goes, so these bars asked again are a new run
      if (perBars.get(key) === pending) perBars.delete(key)
    })
    return {}
  }
  try {
    const out = computeRuntimeColumns(def, rows, ctx,
      { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS, ...(_doorClock ? { now: _doorClock } : {}) })
    perBars.set(key, out)
    return out
  } catch (err) {
    const stop = stopOf(err)
    perBars.set(key, stop)
    throw stop.stoppedBy
  }
}

// ─── ⭐⭐ (engine 86) the time-budget stops this page remembers (`runtimeColumnsFor`; the store is
// `../runtimeBudgetStops.js`, which the strip reads without loading this lane) ─────────────────────────────────────
/** The stop as the strip says it: the run's own sentence, and that it is not run again until a retry. */
function budgetStopOf(err) {
  const kept = new Error(`${String((err && err.message) || '').trim()} It is not run again on this chart's next bars `
    + '(each would be stopped the same way); Retry runs it again.')
  for (const [k, v] of Object.entries(err || {})) if (k !== 'message' && k !== 'stack') kept[k] = v
  kept.guard = RUNTIME_TIME_BUDGET_GUARD
  kept.retryable = true
  return kept
}
// a Retry repaints: the chart asks again, and the forgotten stops run
onRuntimeBudgetStopsChange((retried) => {
  if (!retried) return
  for (const fn of [..._landed]) { try { fn('retry') } catch { /* a bad listener must not break the lane */ } }
})

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

/** ⭐⭐ DIV-4 — `opts.paneLane: true`: the same compile check on the RUNTIME PANE's
 *  lane (not the object door's master-only lane), for a value only a document
 *  behind the runtime pane's own switch reads (`memberPaneDefinition::runtimeReadPaints`).
 *  Absent, byte-identical to before. */
export function probeObjectRuntime(source, specs, opts = {}) {
  const tooBig = sourceSizeRefusal(source)
  if (tooBig) return { ok: false, refusal: { guard: RUNTIME_LIMIT_GUARD, message: tooBig, limit: 'PROGRAM_SIZE' } }
  let built
  try {
    built = buildRuntimeIr(String(source || ''), {
      bars: [], inputs: {}, objectTrees: [], objectTreesAt: specs, ...COMPILE_ON_A_PANE, ...runtimeClockOpts(false),
      // ⭐⭐ THE OBJECT DOOR (Phase 3 audit): this build serves members' drawings with no runtime
      // flag, so it gets master's lane only (`pineRuntimeFrontend.js::objectDoorRefuses`).
      // ⭐ DIV-4 — unless the caller is behind the runtime pane's switch (`paneLane`).
      objectDoor: opts.paneLane !== true,
    })
  } catch (err) {
    return { ok: false, refusal: { guard: 'runtime:build', message: String((err && err.message) || err) } }
  }
  if (!built.ok) return { ok: false, refusal: built.refusal || { guard: 'runtime:build', message: '' } }
  // ⛔ RS RATING L5 — NOT LIFTED HERE. This is the OBJECT door's check (C18), which serves
  // members' drawings with no runtime flag on (master's lane), unlike the run half, whose run
  // is supplied its requested bars (`requestSupply.js`). Lifting it would hand every member a
  // request read through the object reader, a production change of its own.
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
  // ⭐ P1 HARDENING — `PROGRAM_SIZE`: an over-long source is never handed to the front end.
  if (sourceSizeRefusal(rt && rt.source)) return withheld(RUNTIME_LIMIT_GUARD)
  const tf = typeof ctx.tf === 'string' ? ctx.tf : undefined
  const forming = newestBarIsFormingFrom(ctx)
  const symbol = symbolOf(ctx)
  const key = `${tf}|${forming}|${symbolKey(symbol)}|${rt.source.length}|${JSON.stringify(rt.at).length}|${rt.lane === 'pane' ? 'pane' : 'door'}`
  let perBars = _objectMemo.get(rows)
  if (!perBars) { perBars = new Map(); _objectMemo.set(rows, perBars) }
  const memoFor = perBars.get(rt)
  if (memoFor && memoFor.key === key) return memoFor.value

  const value = (() => {
    let built
    try {
      built = withTranslateClock(ctx.now, () => buildRuntimeIr(String(rt.source), {
        bars: rows,
        inputs: {},
        // ⭐⭐ U15 — the run half's library pins (stamped by the member door beside its source)
        ...libraryBuildOpts(rt && rt.libraryPins),
        objectTrees: [],
        objectTreesAt: at,
        pane: true,
        // ⭐⭐ the object door: master's lane only (see `probeObjectRuntime`); a document behind the
        // runtime pane's switch names the pane lane (`rt.lane === 'pane'`, DIV-4)
        objectDoor: !(rt && rt.lane === 'pane'),
        ...(symbol ? { symbol } : {}),
        ...(tf ? { basePeriod: tf, tf } : {}),
        ...runtimeClockOpts(forming, tf ? { tf } : {}),
      }))
    } catch (err) {
      return withheld('runtime:build')
    }
    if (!built.ok) return withheld((built.refusal && built.refusal.guard) || 'runtime:build')
    // ⛔ RS RATING L5 — not lifted: see `probeObjectRuntime` (the object door's master lane)
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
      }, undefined, { budget, ...injectedNow(ctx), ...(hasIters ? { onBar } : {}) })
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


/** ⭐⭐ RS RATING L12 PR 2 (U-DAILY) — does `source`, built for a `tf` chart as the run builds it, read THIS chart's
 *  own symbol at "D" above the chart (a request target `{own, above}`, `pine.js`)? The chart fetches its daily
 *  rows only then (`useSecondarySources`, `OWN_DAILY_KEY`). Memoised per (timeframe, symbol, source). Only an
 *  intraday timeframe can say yes: `pine.js` mints
 *  the target on an intraday base only (`isIntradayTf`), and the same predicate is checked FIRST here so a daily /
 *  weekly / monthly chart never compiles for this question. ⛔ It is a cost guard, equal in behaviour to the mint's
 *  own gate (no rail can tell them apart, the mutation proof found): derive it, never restate the timeframe list.
 *  ⭐⭐ RS RATING (2026-11-19, the e83 live capture) — AND WITH THE CHART'S SYMBOL, as the run binds it (`symbolOf`,
 *  the chart's `symbolMeta`). ⚰️ Built without one, Fred RS refused at its `syminfo.industry` branch (line 94,
 *  `interpret:bind-time-text`), so this answered false, the chart never fetched `OWN_DAILY_KEY`, and the served
 *  run refused every 5m / 30m / 1h chart: "this run is not handed that symbol's daily bars" (the worker request
 *  carried SPX, SPX@D and the seed only). A symbol the chart has not resolved yet settles nothing, exactly as
 *  the run's own build. Memoised per (timeframe, symbol, source): the classification is in the key.
 *  ⛔⛔ A PREDICATE THAT CANNOT ANSWER NEVER SAYS NO. A build that is refused (or throws) answers NEEDED: the
 *  e83 failure was exactly a refused build read as "not needed". Fetching `OWN_DAILY_KEY` is one bars read; the
 *  run then decides, and refuses by name if it must. Only a build that SUCCEEDS and names no own daily read
 *  above the chart answers no. */
const _ownDailyMemo = new Map()
/** ⭐⭐ (switch smoothness, 2026-11-20) THE QUESTION `runtimeReadsOwnDaily` ANSWERS, as its memo names it:
 *  `{key, tf, symbol}` (the timeframe as a string, the chart's symbol as the run binds it), or null where the
 *  answer is NO without a build (not an intraday timeframe, no source). One function, so the chart's thread and
 *  the worker that answers it off that thread (`ownDailyAsync.js`) key one memo the same way. */
export function runtimeOwnDailyQuestion(source, tf, symbol = null) {
  const t = tf == null ? '' : String(tf)
  if (!isIntradayTf(t) || typeof source !== 'string' || !source) return null
  const sym = symbolOf({ symbol })
  // ⭐ U-DAILY (e96, part B) — whether a daily EXPRESSION is read there depends on its capability's admission too
  // (`dailyExpressionGate.js`): an answer given with it closed is never the answer with it open
  const gate = dailyExpressionAdmitted() ? 'dx|' : ''
  return { key: `${t}|${symbolKey(sym)}|${gate}${source}`, tf: t, symbol: sym || null }
}
/** The memoised answer for a question's key, or undefined when it has not been answered in this tab. */
export function runtimeOwnDailyKnown(key) {
  return _ownDailyMemo.has(key) ? _ownDailyMemo.get(key) : undefined
}
/** Test seam: forget every answer (a rail comparing two threads must not read one thread's memo for the other). */
export function __resetOwnDailyMemoForTests() { _ownDailyMemo.clear() }
/** Remember an answer (the worker's, computed by this very function there: `ownDailyProbe.js`). */
export function rememberRuntimeOwnDaily(key, yes) {
  if (_ownDailyMemo.size >= 64) _ownDailyMemo.clear()
  _ownDailyMemo.set(key, yes === true)
}
export function runtimeReadsOwnDaily(source, tf, symbol = null) {
  const q = runtimeOwnDailyQuestion(source, tf, symbol)
  if (!q) return false
  const known = runtimeOwnDailyKnown(q.key)
  if (known !== undefined) return known
  const t = q.tf
  const sym = q.symbol
  let yes = true
  try {
    const built = buildRuntimeIr(source, {
      bars: [], inputs: {}, objectsInRun: true, pane: true, plotColours: true, basePeriod: t, tf: t,
      ...(sym ? { symbol: sym } : {}),
      ...runtimeClockOpts(false, { tf: t }),
    })
    if (built && built.ok) {
      yes = ((built.ir && built.ir.requests) || [])
        .some((r) => r && r.target && r.target.own === true && r.target.above === true)
    }
  } catch (err) {
    yes = true
  }
  rememberRuntimeOwnDaily(q.key, yes)
  return yes
}
