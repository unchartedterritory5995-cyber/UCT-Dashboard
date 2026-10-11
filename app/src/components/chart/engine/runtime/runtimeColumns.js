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
import { buildRuntimeIr, RUNTIME_FRONTEND_LANGUAGE, RUNTIME_FRONTEND_VERSION } from '../ast/pineRuntimeFrontend.js'
import { RUNTIME_IR_VERSION } from './ir.js'
import { runtimeClockOpts, newestBarIsFormingFrom } from '../ast/pineRuntimeClock.js'
import { lowerIrProgram, naTestsOf } from './lowerIr.js'
import { execute } from './vm.js'
import { Budget, RuntimeLimitError, DEFAULT_LIMITS } from './limits.js'
import { MAX_COLLECTION_CAP as ITER_SLOTS, rtLoopId } from '../ast/objectProgram.js'
import { registerObjectRuntimeValues } from '../objectColumns.js'
// ⭐⭐ RT5 — the run's own drawings ride the column record (`runtimeObjects.js`).
import { withRuntimeObjects, RUNTIME_WARMUP_KEY, RUNTIME_OBJECTS_KEY, runtimeWarmupOf } from './runtimeObjects.js'
import { sameDrawings } from './warmupDrawings.js'
import { runtimeInputValues, runtimeBuildInputs } from './runtimeInputs.js'
import { makeWarmupProbe } from './warmupProbe.js'
export { RUNTIME_WARMUP_KEY, runtimeWarmupOf }
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
  const tooBig = sourceSizeRefusal(source)
  if (tooBig) return { ok: false, refusal: { guard: RUNTIME_LIMIT_GUARD, message: tooBig } }
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
  ])
  // Two independent 32-bit passes plus the length: a collision needs all three to agree.
  const key = `${text.length.toString(36)}.${fnv1a(text, 0x811c9dc5).toString(36)}.${fnv1a(text, 0x9e3779b9).toString(36)}`
  _contentKey.set(def, key)
  return key
}

/** The memo key for one run: the definition, its compute handle, its CONTENT, and
 *  everything in `ctx` that changes the answer (the clock, the symbol, the listing fact). */
function runKey(def, ctx) {
  const compute = (def && def.compute) || {}
  const tf = ctx && typeof ctx.tf === 'string' ? ctx.tf : undefined
  const forming = newestBarIsFormingFrom(ctx)
  const listing = !!(ctx && ctx.historyFromListing === true)
  // ⭐ UIE PHASE 2 (M4) — the member's settings are part of what a run computed
  const given = ctx && ctx.runtimeInputs && typeof ctx.runtimeInputs === 'object' ? ctx.runtimeInputs : null
  const settings = given && Object.keys(given).length ? JSON.stringify(given) : ''
  return `${def && def.id}|${compute.fn}|${runtimeContentKey(def)}|${tf}|${forming}|${symbolKey(symbolOf(ctx))}|${listing}|${settings}`
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
    + 'read under (PROGRAM_SIZE), so it is not read at all.'
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
      || err.guard === RUNTIME_HISTORY_GUARD || err.guard === RUNTIME_WARMUP_GUARD)) throw err
    const plain = { ...def, compute: { ...compute, objects: undefined } }
    let out
    try { out = computeRuntimeColumnsOnce(plain, rows, ctx, opts) } catch { throw err }
    return withRuntimeObjects(out, { status: 'WITHHELD', live: [], guard: (err && err.guard) || 'runtime:objects',
      reason: String((err && err.message) || err) })
  }
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
  const never = () => refusal(RUNTIME_WARMUP_GUARD, "this script is drawn bar by bar from its first bar, and "
    + "this chart's history does not start at the symbol's first bar. Run from two different first bars, "
    + "its values never came to agree, so what it would show here depends on where the chart begins, which "
    + 'TradingView does not share. Nothing is drawn rather than a guess. TO UNBLOCK: a chart whose loaded '
    + "history reaches the listing (a daily chart of a symbol listed within the bars it loads) draws it.")
  if (shift < 2) throw never()
  const clock = typeof opts.now === 'function' ? opts.now
    : () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const t0 = clock()
  const inner = { ...opts, warmupCurtain: false }
  // ⭐⭐ UIE PHASE 3 (M1) — B stops as soon as it is PROVEN to repeat A (`warmupProbe.js`);
  // a drawing program is never probed (its object store is not encoded)
  const probe = objects || opts.warmupEarlyStop === false ? null : makeWarmupProbe(n, shift)
  const a = computeRuntimeColumnsOnce(plain, rows, ctx,
    probe ? { ...inner, probe: probe.forA, onProgram: probe.programA } : inner)
  const left = Number.isFinite(opts.budgetMs) ? opts.budgetMs - (clock() - t0) : null
  if (left !== null && left <= 0) {
    throw refusal(RUNTIME_TIME_BUDGET_GUARD, `this script took more than ${opts.budgetMs} ms to draw bar by bar `
      + "and to check where its values stop depending on this chart's first bar, which is this pane's budget "
      + 'for one indicator, so it is stopped and nothing is drawn rather than part of it.')
  }
  const b = computeRuntimeColumnsOnce(plain, rows.slice(shift), ctx,
    { ...inner, onBudget: undefined, ...(left !== null ? { budgetMs: left } : {}),
      ...(probe ? { probe: probe.forB, onProgram: probe.programB } : {}) })
  const stoppedAt = probe ? probe.stoppedAt() : null
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
      withRuntimeObjects(a, { status: 'WITHHELD', live: [], guard: RUNTIME_HISTORY_GUARD,
        reason: "its drawings are not drawn on a chart whose history does not start at the symbol's first bar: "
          + `run from two different first bars, it ends with different drawings (${verdict.why}), so where `
          + 'they land depends on where the chart begins. Its plots are drawn.' })
    }
  }
  return a
}

function computeRuntimeColumnsOnce(def, rows, ctx, opts = {}) {
  const compute = (def && def.compute) || {}
  const outputs = compute.outputs || {}
  // ⛔ RT1 — R-W FOR THIS LANE (`memberPaneDefinition`, `runtimeHistory`): a
  // document that needs its run to start at TradingView's bar 0 computes nothing
  // on a series that is not proven to start at the symbol's listing — refused by
  // name, never drawn off a seed TradingView never used.
  if (def && def.meta && def.meta.runtimeHistory === 'listing' && !(ctx && ctx.historyFromListing === true)) {
    // ⭐⭐ UIE PHASE 2 — R-W's WARM-UP CURTAIN, MEASURED PER RUN (`computeOffListing`):
    // the bars whose values do not depend on where the chart starts are drawn; the
    // ones before them are withheld; a script that never forgets its start is refused.
    if (opts.warmupCurtain !== false) return computeOffListing(def, rows, ctx, opts)
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
  const tooBig = sourceSizeRefusal(compute.source)
  if (tooBig) throw refusal(RUNTIME_LIMIT_GUARD, tooBig)
  const built = buildRuntimeIr(String(compute.source || ''), {
    bars: rows,
    // ⭐ UIE PHASE 2 (M4) — the member's own settings (`runtimeInputs.js`): only the
    // values that differ from the author's defaults, refused by name outside the
    // author's bounds or options by the front end itself. ⭐ UIE PHASE 3 (M4) — a colour or a
    // source rides apart (`inputDefaults`): it replaces the author's default node.
    ...runtimeBuildInputs(def, ctx && ctx.runtimeInputs && typeof ctx.runtimeInputs === 'object' ? ctx.runtimeInputs : {}),
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
  // ⭐ P1 HARDENING — the document is run only by the engine it was minted for, and
  // only while each mapped index still names the output it named at mint.
  const versionWhy = runtimeVersionRefusal(def, program.outputs)
  if (versionWhy) throw refusal(RUNTIME_VERSION_GUARD, versionWhy)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(rows.map((b) => b[k])))
  // ⭐⭐ RT1 — THE TIME BUDGET, checked at the end of every bar through the VM's
  // own per-bar hook (no VM change): past it the run stops by name.
  const budgetMs = Number.isFinite(opts.budgetMs) ? opts.budgetMs : null
  const now = typeof opts.now === 'function' ? opts.now
    : () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const startedAt = budgetMs !== null ? now() : 0
  if (typeof opts.onProgram === 'function') opts.onProgram(program)
  // ⭐⭐ C43 — the script's own `runtime.error` (C35's `PineRuntimeError`) stops
  // the run on the bar it is reached; TradingView's study then holds nothing and
  // names that bar (`vw-runtime-error-reached`). The bar is the one after the last
  // the run finished, stamped on the error for the member's sentence
  // (`nativeRegistry.runtimeColumnsOrReasons`).
  let finished = -1
  let res
  try {
    res = execute(program, {
      bars: rows.length,
      series,
      columns: program.columns,
      // Only a bar KNOWN to have finished is confirmed; unknown fails closed the
      // way `interpret` does for the four realtime clock columns.
      confirmed: forming === false,
      barTimes: rows.map((b) => b.t),
      // ⭐ UIE PHASE 2 — `opts.limits` is a MEASUREMENT door (the limits census,
      // `runtimeLimitsBudget.measure.test.js`); no product caller passes it, so every
      // chart runs under `DEFAULT_LIMITS`.
    }, opts.limits, {
      ...(opts.probe ? { probe: opts.probe } : {}),
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
  if (typeof opts.onBudget === 'function') opts.onBudget(res.budget)   // the census reads its counts
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
export function runtimeColumnsFor(def, bars, inputs, ctx) {
  const rows = Array.isArray(bars) ? bars : []
  // ⭐ UIE PHASE 2 (M4) — the instance's settings ride the context the run reads
  const values = runtimeInputValues(def, inputs)
  if (Object.keys(values).length) ctx = { ...(ctx || {}), runtimeInputs: values }
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
    const out = computeRuntimeColumns(def, rows, ctx, { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS })
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
  const tooBig = sourceSizeRefusal(source)
  if (tooBig) return { ok: false, refusal: { guard: RUNTIME_LIMIT_GUARD, message: tooBig } }
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
  // ⭐ P1 HARDENING — `PROGRAM_SIZE`: an over-long source is never handed to the front end.
  if (sourceSizeRefusal(rt && rt.source)) return withheld(RUNTIME_LIMIT_GUARD)
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
