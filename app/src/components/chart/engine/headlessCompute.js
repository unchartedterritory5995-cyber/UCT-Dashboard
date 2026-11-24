// app/src/components/chart/engine/headlessCompute.js
//
// ─── ⭐⭐ A SAVED DEFINITION, COMPUTED WITH NO CHART (HEADLESS, Studio R6 / Indicators backlog 44) ──
//
//   computeHeadless(definition, bars, opts?) -> { lane, outputs, work }
//                                             | { lane, outputs: null, work: null, refusal }
//
// The browser (a library or share card) and the server bundle (`runtime/serverEntry.js`, which the
// service runs, so the server computes `work` itself and never trusts a client's number) ask this
// ONE function. It computes what the chart computes, through the chart's own code:
//
//   · LANE — `computeLane.js::computeLaneOf`, the router `nativeRegistry.computeFor` dispatches on.
//     Never a second router: the answer IS the chart's.
//   · OUTPUTS — what the lane's compute returns for each DRAWN output, as an ordered array
//     `[{key, title, values}]`, one entry per plot the chart draws, in the definition's plot order
//     (`def.plots`; a `hidden` helper column and an `hlines` guide are not drawn, so not listed):
//       key     the definition's stable plot key (the column's own name; unique, never merged)
//       title   the plot's own title as the chart names it (`pinePresentation.js::plotOwnTitlesOf`,
//               the rule the settings form titles a plot by), or `null` for an untitled plot (the
//               form's stand-ins `Plot` / a colour group, a column key `outN` and the import's
//               indicator-name stand-in are not titles). Two plots may share a title: they stay two
//               entries, told apart by `key` and by position.
//       values  the per-bar series, a plain `number[]` (`NaN` where nothing is drawn)
//       withheld  (only when some bars are withheld BY NAME) `[{code, bars}]`, the engine's own records
//     Computed by:
//       'ast'     → `astColumns.js::astLaneColumns`, the host lane's values (moved there from the
//                   registry so this bundle can reach them), with NONE of the run-read parts
//       'runtime' → `runtime/runtimeColumns.js::computeRuntimeColumns`, the ONE run both the chart's
//                   synchronous door and its worker make
//   · WORK — a DETERMINISTIC count, in the lane's own unit:
//       'runtime' → the VM's whole-run instruction count, `TOTAL_INSTRUCTIONS`, read off the run's
//                   own `Budget` (`vm.js` charges it at every bar end; `limits.js` sets its ceiling,
//                   `DEFAULT_LIMITS.TOTAL_INSTRUCTIONS`), handed back by the lane's census hook
//                   (`opts.onBudget`). A run that stops at that ceiling is refused by name.
//       'ast'     → evaluation units: the node evaluations `interpret` performed (`interpret.js::
//                   evalNode`, the one chokepoint; a memo hit costs none), every tree and every
//                   nested `tf` / `sym` pass counted into one object (`ctx.workSink`). The unit the
//                   static `budget:nodes` cap counts (`interpret.js::evaluationUnits`), now counted
//                   as it runs. ⛔ Not `ast/budget.js`: that is a static bound, not a run.
//     The two units are different and are never summed: `lane` says which one `work` is in.
//
// ⛔⛔ NO CLOCK IN THE VERDICT. The runtime lane is handed a clock that never moves (`opts.now`), so
// neither the VM's `WALL_TIME` nor the translator's timeout can decide what is computed; the
// instruction budgets (`limits.js`) bound the run (ruling R3: a clock is a safety stop, never a
// verdict). The host lane reads no clock. A HOST that needs a wall-clock stop puts it around this
// call (the service's pool kills a job past `killMs`), and a stop there is the host's, never an
// answer of this function. Same definition, same bars, same opts: the same `work`, on every run and
// every machine.
//
// ⛔⛔ NEVER A PARTIAL RESULT, SILENTLY. A definition is refused BY NAME, with the engine's own
// refusal code, when:
//   · the server's served row says it is not drawn (`meta.runtimeKilled`, `meta.runtimeNotGraded`,
//     `meta.hostKnownDivergence`, `meta.heldDivergence` — the stamps the install door refuses on), or it declares its own
//     `runtime.error` checks, which the chart evaluates in its object lane and this host does not load;
//   · its run stops (a limit, a build or version refusal, a request it is not handed, the script's
//     own `runtime.error`, an engine error);
//   · ANY of its plots is refused, withheld whole, or reads another symbol / lower timeframe this
//     call was not handed (the chart would draw nothing there until bars arrive; here none will).
// Then `outputs` and `work` are `null` and `refusal` is `{code, message, plots?, limit?}`.
// ⭐ What is computed but is not a series is said, not dropped: an `ast` document that carries
// run-read colours or a run half (`compute.runtimeColours`, `compute.runtimeObjects`) gives its
// values, and `runParts` names the parts not computed here (their run is not counted in `work`).
//
// ⛔ A lane with no work counter ('native': repo-authored JavaScript, 'server': fetched columns) is
// not a member's saved definition: asking for one THROWS, naming the lane.
// ⛔ WHAT THE CALLER OWNS, as the service's job adapter does (`services/pine_runtime/job.mjs`): the
// lists the chart reads from its own tab (kill list, starter allowlist, capability admission) are
// honoured here through the stamps the server writes on a served row, and a document's pinned Pine
// libraries are registered by the caller for the call (`registerPineLibrary`), as for any run.
//
// opts (all optional; the reference measurement passes `referenceSeries.js::referenceOptions()`):
//   tf                  the bars' timeframe code ('D', 'W', '60', …); absent, a timeframe read fails
//                       closed exactly as `computeFor` does with no `ctx.tf`
//   symbol              the chart symbol `{ticker, exchange, industry?, sector?, securityType?}`
//   historyFromListing  `true` when bar 0 is the symbol's first bar (the reference series is)
//   newestBarIsForming  default `false`: a headless series is a finished history
//   inputs              the instance's settings; default `{}`, the definition's own defaults
//   otherBars           bars for another symbol: `(storeKey) => rows | null`, or `{[storeKey]: rows}`,
//                       keyed as the chart fetches them (`otherSymbols.js::fetchableOtherSymbols`), at the
//                       timeframe the chart fetches them at: `tf`'s own, except a key `heldFetchOf` holds at
//                       another (SP:SPX and the RS seed on a weekly chart: their DAILY rows, RS RATING L11)
import { computeLaneOf, COMPUTE_LANE } from './computeLane.js'
import {
  astLaneColumns, astPlotKey, columnErrors, otherSymbolReport, lowerTfReport, chartClockReport, withheldBarsReport,
  RUNTIME_ERROR_GUARD,
} from './astColumns.js'
import {
  computeRuntimeColumns, runtimeWarmupOf, RUNTIME_REQUEST_WITHHELD_KEY, RUNTIME_HISTORY_GUARD,
} from './runtime/runtimeColumns.js'
import { runtimeInputValues } from './runtime/runtimeInputs.js'
import { fetchableOtherSymbols, heldFetchesOf } from './otherSymbols.js'
import { instanceDocumentForFetch } from './symbolInputs.js'
import { HOST_KNOWN_DIVERGENCE_GUARD, HOST_KNOWN_DIVERGENCE_STAMP } from './hostKnownDivergence.js'
import { HELD_DIVERGENCE_GUARD, HELD_DIVERGENCE_STAMP } from './heldWithholds.js'
import { plotOwnTitlesOf } from './pinePresentation.js'
import { ENGINE_ERROR } from './ast/parse.js'
import { PER_BAR_CLOCK_CODES as PER_BAR_CLOCK_CODE_LIST } from './ast/interpret.js'

/** The clock the runtime lane is handed: it never moves, so no wall-clock stop decides anything. */
const STILL_CLOCK = () => 0

/** The engine's codes this module names a served-row stamp by (the member door's and the server's
 *  own spellings: `memberPaneDefinition.js`, `runtime_definitions.py`; registered in
 *  `supportLoop/refusalCodes.json`). */
const KILLED = 'runtime:killed'
const NOT_GRADED = 'runtime:not-yet-graded'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v) => (typeof v === 'string' && v ? v : null)

function refused(lane, code, message, extra = {}) {
  return { lane, outputs: null, work: null, refusal: { code, message: String(message || ''), ...extra } }
}

/** The other-symbol supply, in the shape the chart's cache has (`useSecondarySources`): a Map
 *  store key → `{bars, status}`, for exactly the keys the chart would fetch for this document. */
function supplyOf(def, otherBars, inputs, tf) {
  if (!otherBars) return null
  // ⭐ as THIS instance's symbol settings make the document (`useSecondarySources`'s own call)
  const keys = fetchableOtherSymbols(instanceDocumentForFetch(def, { inputs }))
  if (!keys.length) return null
  const read = typeof otherBars === 'function' ? otherBars
    : (isObj(otherBars) ? (k) => otherBars[k] : () => null)
  const secondary = new Map()
  for (const k of keys) {
    const rows = read(k)
    // ⭐ RS RATING L11 — a key this timeframe HOLDS at another one (`heldFetchOf`: SP:SPX on a weekly
    // chart) is filed under its held key, as the chart files it; its rows are that timeframe's (daily)
    const held = heldFetchesOf(k, tf)
    if (Array.isArray(rows) && rows.length) secondary.set(held.length ? held[0].key : k, { bars: rows, status: 'available' })
    // ⭐ RS RATING L12 — a second held series (an intraday chart's daily rows) is read under its own key
    for (const h of held.slice(1)) {
      const extra = read(h.key)
      if (Array.isArray(extra) && extra.length) secondary.set(h.key, { bars: extra, status: 'available' })
    }
  }
  return secondary.size ? secondary : null
}

function contextOf(def, opts) {
  const ctx = {
    ...(typeof opts.tf === 'string' && opts.tf ? { tf: opts.tf } : {}),
    ...(isObj(opts.symbol) ? { symbol: opts.symbol } : {}),
    historyFromListing: opts.historyFromListing === true,
    newestBarIsForming: opts.newestBarIsForming === true,
  }
  const secondary = supplyOf(def, opts.otherBars, isObj(opts.inputs) ? opts.inputs : {}, opts.tf)
  if (secondary) ctx.secondary = secondary
  return ctx
}

// ─── the outputs: one entry per drawn plot ────────────────────────────────────────────────────────

/** How many bars a 0/1 withholding mask covers. */
function countOnes(mask) {
  let n = 0
  for (let i = 0; i < mask.length; i += 1) if (mask[i] === 1) n += 1
  return n
}

/** The column map a lane returned, as the ordered drawn outputs `[{key, title, values, withheld?}]`. */
function drawnOutputs(def, out) {
  const titles = plotOwnTitlesOf(def)
  // the bars a column carries withheld BY NAME: the host lane's per-plot witness masks, the runtime
  // lane's warm-up curtain (a history off the listing) and its newest bar a request cannot know yet
  const perPlot = withheldBarsReport(out) || {}
  const warm = runtimeWarmupOf(out)
  const newest = out[RUNTIME_REQUEST_WITHHELD_KEY] || null
  const entries = []
  for (const p of (Array.isArray(def.plots) ? def.plots : [])) {
    if (!p || typeof p.key !== 'string' || p.style === 'hlines' || p.hidden === true) continue
    const col = out[p.key]
    if (!(col && typeof col.length === 'number')) continue
    const withheld = []
    for (const [code, mask] of Object.entries(perPlot[p.key] || {})) {
      const bars = countOnes(mask)
      if (bars) withheld.push({ code, bars })
    }
    // ⭐⭐ T4 E2 — a depth cut with its own words (an event family's record) names its bars by its own code
    const named = warm && typeof warm.knownFromCode === 'string' && Number.isInteger(warm.knownFrom) && warm.knownFrom > 0
      ? Math.min(warm.knownFrom, warm.withheldBars) : 0
    if (named) withheld.push({ code: warm.knownFromCode, bars: named })
    if (warm && warm.withheldBars - named > 0) withheld.push({ code: RUNTIME_HISTORY_GUARD, bars: warm.withheldBars - named })
    // ⭐⭐ HTF-NEWEST-NARROW — only the plots the run blanked (`keys`; `null` = every column)
    if (newest && (!Array.isArray(newest.keys) || newest.keys.includes(p.key))) {
      for (const code of newest.codes || []) withheld.push({ code, bars: 1 })
    }
    entries.push({ key: p.key, title: titles.has(p.key) ? titles.get(p.key) : null, values: Array.from(col),
      ...(withheld.length ? { withheld } : {}) })
  }
  return entries
}

// ─── the runtime lane ─────────────────────────────────────────────────────────────────────────────

function runtimeLane(def, rows, opts) {
  const lane = COMPUTE_LANE.RUNTIME
  const meta = isObj(def.meta) ? def.meta : {}
  // the install door's refusals of a served row (`nativeRegistry.validateUserDefinitions`)
  if (text(meta.runtimeKilled)) return refused(lane, KILLED, meta.runtimeKilled)
  if (text(meta.runtimeNotGraded)) return refused(lane, NOT_GRADED, meta.runtimeNotGraded)
  // a saved copy minted before its script's narrow withholds (`heldWithholds.js`, the server's sentence)
  if (text(meta[HELD_DIVERGENCE_STAMP])) return refused(lane, HELD_DIVERGENCE_GUARD, meta[HELD_DIVERGENCE_STAMP])
  let ctx = contextOf(def, opts)
  // the instance's settings ride the context, as `runtimeColumnsFor` hands them
  const values = runtimeInputValues(def, isObj(opts.inputs) ? opts.inputs : {})
  if (Object.keys(values).length) ctx = { ...ctx, runtimeInputs: values }
  let work = 0
  let out
  try {
    out = computeRuntimeColumns(def, rows, ctx, {
      incremental: false,                // no session: this run is the whole run, every time
      now: STILL_CLOCK,
      onBudget: (budget) => { work += budget.counts.TOTAL_INSTRUCTIONS },
    })
  } catch (err) {
    if (err && err.name === 'runtime.error') return refused(lane, RUNTIME_ERROR_GUARD, err.message)
    const code = (err && err.guard) || ENGINE_ERROR
    return refused(lane, code, (err && err.message) || err, err && err.limit ? { limit: err.limit } : {})
  }
  // every mapped plot computed, or the run is refused by name: a missing column is never a quiet gap
  const missing = Object.keys((def.compute && def.compute.outputs) || {}).filter((k) => !(out[k] && typeof out[k].length === 'number'))
  if (missing.length) {
    return refused(lane, ENGINE_ERROR, `the run computed no column for ${missing.join(', ')}`, { plots: missing })
  }
  return { lane, outputs: drawnOutputs(def, out), work }
}

// ─── the host (formula) lane ──────────────────────────────────────────────────────────────────────

/** Why a computed host column map is not the whole answer, or null. */
function hostRefusalOf(def, out) {
  const plots = {}
  const errors = columnErrors(out)
  for (const key of astPlotKey(def)) {
    const e = errors[key]
    if (e) plots[key] = { code: e.guard || e.status || ENGINE_ERROR, message: String(e.message || '') }
    else if (!(out[key] && typeof out[key].length === 'number')) plots[key] = { code: ENGINE_ERROR, message: 'no column was computed' }
  }
  const named = Object.keys(plots)
  if (named.length) {
    const first = plots[named[0]]
    return { code: first.code, message: first.message, plots }
  }
  // a read of another symbol or a lower timeframe this call was not handed (the chart waits for bars
  // that never arrive here), or any it refused, is the whole definition's refusal
  for (const report of [otherSymbolReport(out), lowerTfReport(out)]) {
    const r = report && Array.isArray(report.refused) ? report.refused[0] : null
    if (r) {
      return { code: r.code || r.refusal || ENGINE_ERROR,
        message: r.reason || `${r.ticker || r.code} is not supplied to this compute` }
    }
  }
  // a plot withheld on every bar by the chart clock or a calc_bars window says so on the chart's
  // strip; here it is a refusal, named the same way
  const clock = chartClockReport(out)
  // ⭐⭐ PER BAR, NOT WHOLE (coordinator ruling (A), 2026-11-20) — `history:before-chart` withholds the bars that read
  // before the chart's first one and draws every other: a plot that carries it PER BAR (`withheldBarsReport`, written by
  // `interpret.js::historyBeforeChartMask`) gives its values with those bars withheld by name (`drawnOutputs`), as the
  // runtime lane's warm-up curtain does. ⚰️ Every named chart-clock row refused the whole script here, so since engine 90
  // "Inspect a bar" answered "not computed here" for `plot(nz(close[1]))` off the listing. ⛔ Fails closed: a plot named
  // with no per-bar column for the code, and every other chart-clock code, still refuses.
  const perBar = withheldBarsReport(out) || {}
  const wholeOf = (w) => (w && Array.isArray(w.plots) ? w.plots : [])
    .filter((p) => !(PER_BAR_CLOCK_CODES.has(w.code) && perBar[p] && perBar[p][w.code]))
  const row = clock && Array.isArray(clock.withheld) ? clock.withheld.find((w) => wholeOf(w).length) : null
  if (row) return { code: row.code, message: row.reason, plots: Object.fromEntries(wholeOf(row).map((p) => [p, { code: row.code, message: row.reason }])) }
  return null
}

/** The chart-clock codes a plot can carry per bar (`__withheldBars`) rather than whole: `interpret.js::PER_BAR_CLOCK_CODES`,
 *  the one authority (each writes its bars there). */
const PER_BAR_CLOCK_CODES = new Set(PER_BAR_CLOCK_CODE_LIST)

function hostLane(def, rows, opts) {
  const lane = COMPUTE_LANE.AST
  const meta = isObj(def.meta) ? def.meta : {}
  if (text(meta[HOST_KNOWN_DIVERGENCE_STAMP])) {
    return refused(lane, HOST_KNOWN_DIVERGENCE_GUARD, meta[HOST_KNOWN_DIVERGENCE_STAMP])
  }
  if (text(meta[HELD_DIVERGENCE_STAMP])) return refused(lane, HELD_DIVERGENCE_GUARD, meta[HELD_DIVERGENCE_STAMP])
  // ⛔ the script's own `runtime.error` checks are evaluated by the chart's object lane
  // (`runtimeErrorStop.js`), which this host-neutral compute does not load: never the unchecked values
  const checks = meta.runtimeErrors
  if (checks && (!Array.isArray(checks) || checks.length)) {
    return refused(lane, RUNTIME_ERROR_GUARD, "this script declares its own `runtime.error` checks, which the chart "
      + 'evaluates in its drawing lane; a headless compute does not load that lane, so its values are not given '
      + 'rather than given unchecked.')
  }
  const sink = { units: 0 }
  const ctx = { ...contextOf(def, opts), workSink: sink }
  let out
  try {
    out = astLaneColumns(def, rows, isObj(opts.inputs) ? opts.inputs : {}, ctx)
  } catch (err) {
    return refused(lane, (err && err.guard) || ENGINE_ERROR, (err && err.message) || err)
  }
  const why = hostRefusalOf(def, out)
  if (why) return refused(lane, why.code, why.message, why.plots ? { plots: why.plots } : {})
  const compute = def.compute || {}
  const runParts = ['runtimeColours', 'runtimeObjects'].filter((k) => compute[k])
  return { lane, outputs: drawnOutputs(def, out), work: sink.units, ...(runParts.length ? { runParts } : {}) }
}

/**
 * Compute a saved definition over `bars` with no chart.
 *
 * @param {object} definition a saved definition (`compute.kind` 'ast' or 'runtime')
 * @param {object[]} bars `{t, o, h, l, c, v}` rows, oldest first
 * @param {object} [opts] see the module header
 * @returns {{lane: string, outputs: {key: string, title: string|null, values: number[], withheld?: object[]}[],
 *     work: number, runParts?: string[]}
 *   | {lane: string, outputs: null, work: null, refusal: {code: string, message: string, plots?: object, limit?: string}}}
 * @throws for a definition on a lane with no work counter ('native', 'server')
 */
export function computeHeadless(definition, bars, opts = {}) {
  const lane = computeLaneOf(definition)
  const rows = Array.isArray(bars) ? bars : []
  const o = isObj(opts) ? opts : {}
  if (lane === COMPUTE_LANE.RUNTIME) return runtimeLane(definition, rows, o)
  if (lane === COMPUTE_LANE.AST) return hostLane(definition, rows, o)
  const err = new Error(`computeHeadless: a '${lane}' definition is not computed headlessly — only a saved `
    + "member definition is ('ast' or 'runtime'); this lane has no work counter")
  err.lane = lane
  throw err
}
