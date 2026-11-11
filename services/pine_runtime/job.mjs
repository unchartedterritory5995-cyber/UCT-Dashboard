// services/pine_runtime/job.mjs
//
// W5-T7: THE SERVICE'S HOST ADAPTER (docs/pine/SERVER-RUNTIME-DESIGN.md H1, H6, HP-7). It turns
// one validated wire job (protocol.mjs) into the `(def, rows, ctx, opts)` the browser's worker
// passes to `computeRuntimeColumns`, runs it ONCE, and encodes the answer. It runs inside a
// sandboxed worker (sandbox.mjs); `rt` is the server bundle's module, passed in, never imported
// here, so this file holds no engine rule and no second copy of one.
//
// ⛔ HP-7 ADAPTER AGREEMENT: `runtimeWorker.js` (the call and its opts) and `runtimeAsync.js
// ::messageOf` (the def / ctx / rows it builds) are parsed beside this file by a static rail
// (test/adapter.test.mjs). The ONLY differences allowed are the ones declared below, each with
// its reason; any other drift in argument construction fails the rail by name.
//
// ⛔ H6 PER-JOB RESET: every run is `incremental: false` (no session) and is followed, in a
// `finally`, by `resetRuntimeSessions()` + `resetRuntimeLedgers()`. A column that says it resumed
// from an earlier run (the run's own `RUNTIME_INCREMENTAL_KEY` record) is refused as
// `runtime:server-integrity`, so one member's run can never be answered from another's state.
//
// WIRE DECISIONS THIS FILE FIXES (the T11 client mirrors them):
//   columns          canonical base64 of n little-endian Float64 values, n = bars.n. `null`,
//                    `undefined` and every NaN are written as 0x7FF8000000000000; -0 stays -0.
//                    A column of any other length, or a value that is not a number / null /
//                    undefined, withholds the WHOLE job (`runtime:server-integrity`): never partial.
//                    W5-INT: the bytes are the T3 codec's (`rt.encodeColumn` + `rt.bytesToB64`,
//                    the bundle's own runtime/columnDigest.js); this file holds no second encoder.
//   time budget      W5-INT: EXPLICIT. Every run gets `budgetMs` = the bundle's
//                    RUNTIME_PANE_TIME_BUDGET_MS (1,000 ms), which must be a positive finite number
//                    or the worker refuses to boot (`budgetOf`, sandbox.mjs; a module namespace
//                    cannot change after its import, so one check at boot covers every run). With
//                    a budget, the run names EVERY
//                    wall-clock stop `runtime:time-budget` (runtimeColumns.js), which the result
//                    cache never stores (cache.mjs `cacheable`): the pane budget's AND the VM's own
//                    `limits.WALL_TIME` (LIMITS r1 ruling B2-a; the sentence names whichever ceiling
//                    fired). The budget stays
//                    explicit so that no future routing of a wall-clock stop can reach the cache.
//   run-wide stop    status `withheld`, no `columns`, refusals `[{key: '*', guard, sentence, bar}]`.
//                    guard = the run's own `err.guard`; the script's `runtime.error` is guard
//                    `runtime.error`; an unnamed throw is the bundle's `RUNTIME_FAILED_GUARD`.
//   per-output       status `ok`; a wanted key the run did not produce is absent from `columns`
//                    and listed as `{key, guard: 'runtime:server-output-absent'}`; drawings the
//                    run made are not served in v1 and are listed as
//                    `{key: RUNTIME_OBJECTS_KEY, guard: 'runtime:server-drawings'}`.
//   want = []        every column the run produced (its enumerable keys).
//   warmup           (W5-T7b) on every ok result, `{ withheldBars }` from the run's own record
//                    (`rt.runtimeWarmupOf`, the function the browser worker posts): the bars
//                    [0, withheldBars) a run off the listing withheld because their values depend on
//                    where the history starts; 0 when the run withheld none. The supervisor's seal
//                    (protocol.mjs) checks it is a bar count and adds the digest.
//   strategy         (W9-T14) only when `want` names STRATEGY_WANT ('#strategy', profile `backtest`):
//                    the run's own `strategy` record (`rt.runtimeStrategyOf`, the reader the browser
//                    worker posts it by), written as JSON text. '#strategy' is never a column. A run
//                    that made no record lists `{key: '#strategy', guard: 'runtime:server-output-absent'}`
//                    (the job stays ok for its columns). A record holding a value JSON cannot carry
//                    exactly (NaN, +/-Infinity, undefined: JSON.stringify would write null or drop it)
//                    withholds the WHOLE job as `runtime:server-integrity`: never a silent null. The
//                    seal (protocol.mjs) checks the shape and adds `strategy_sha256`. This file decides
//                    no strategy value: sizing, costs and fills are the broker's (RT/broker.js), and
//                    what it cannot serve it refuses by name inside the run.
import { INTEGRITY_GUARD, STRATEGY_WANT } from './protocol.mjs'

export const OUTPUT_ABSENT_GUARD = 'runtime:server-output-absent'
export const DRAWINGS_GUARD = 'runtime:server-drawings'
export const SCRIPT_ERROR_GUARD = 'runtime.error'

/** The opts this host adds to the browser worker's, and why (HP-7 declares them; nothing else). */
export const SERVER_ONLY_OPTS = Object.freeze({
  // H6: a shared process keeps no session, so no member's run resumes another's. The cold path
  // is the one the browser's cold rails already compare against (runtimeBuildCache.test.js).
  incremental: false,
})

/** Every HP-7 difference between this adapter and the browser's, by argument (test/adapter.test.mjs). */
export const DECLARED_DIFFERENCES = Object.freeze({
  // the wire has no framed instance (protocol.mjs closes ctx); a server run never slides that way
  ctxBrowserOnly: Object.freeze(['framed']),
  // the whole document meta, so the run's own runtimeVersionRefusal (runtimeColumns.js) reads the
  // version facts on every document (design 3.2); the browser worker passes runtimeHistory only
  defMeta: 'doc.meta',
})

/** The bundle's per-run wall budget, or a throw: a run with no budget could have a wall-clock stop
 *  named `runtime:limit` (deterministic, cacheable). sandbox.mjs calls this ONCE at worker boot
 *  (the one guard); runJob passes the same export, which the HP-7 rail reads by name. */
export function budgetOf(rt) {
  const ms = rt.RUNTIME_PANE_TIME_BUDGET_MS
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) {
    throw new Error('the bundle exports no positive finite RUNTIME_PANE_TIME_BUDGET_MS, so a wall-clock stop could not be told from a limit')
  }
  return ms
}

/** The `(def, rows, ctx)` of one wire job, built as `runtimeAsync.js::messageOf` builds them. */
export function runArgs(doc, job) {
  const def = { id: doc.id, compute: doc.compute, meta: doc.meta }
  const { t, o, h, l, c, v } = job.bars
  const rows = Array.from({ length: job.bars.n }, (_, i) => ({ t: t[i], o: o[i], h: h[i], l: l[i], c: c[i], v: v[i] }))
  const ctx = {
    tf: job.tf,
    newestBarIsForming: job.ctx.newestBarIsForming,
    historyFromListing: job.ctx.historyFromListing === true,
    runtimeInputs: { ...job.ctx.runtimeInputs },
    symbol: { ticker: job.symbol.ticker, exchange: job.symbol.exchange },
    // W9-T11: the window, from the job's ctx exactly as the browser forwards its own (runtimeAsync.js
    // ::messageOf); never a literal here. HP-7 compares the two shapes.
    ...(job.ctx.historyWindowBars !== undefined ? { historyWindowBars: job.ctx.historyWindowBars } : {}),
  }
  return { def, rows, ctx }
}

/** Canonical base64 of one column by the bundle's T3 codec, or null when it is not exactly `n`
 *  plain numbers / na (T3 refuses the element or the container; a wrong length is refused here). */
export function encodeColumn(rt, col, n) {
  let bytes
  try { bytes = rt.encodeColumn(col) } catch { return null }
  if (bytes.length !== n * 8) return null
  return rt.bytesToB64(bytes)
}

/** ⛔ LIMITS r2 — PHASE 1 OF 2: the service does NOT emit a refusal's `limit` field yet. The web,
 *  worker and runtime services deploy independently, and a client older than LIMITS r1 refuses a
 *  refusal with any key outside {key, guard, sentence, bar} as INTEGRITY. The new client accepts the
 *  field (`pine_runtime_client.py::_REFUSAL_KEYS`); TODO(LIMITS phase 2): set this true once every
 *  Python service runs a client that accepts it. Railed: `job.test.mjs` (the emitted key set). */
export const EMIT_REFUSAL_LIMIT = false

const runWide = (job, guard, sentence, bar = null, limit = null) => ({
  job, status: 'withheld', refusals: [{ key: '*', guard, sentence, bar, ...(EMIT_REFUSAL_LIMIT && limit ? { limit } : {}) }],
})

/** LIMITS r1: a stop's limit NAME (`CALL_COUNT`, `WALL_TIME`, ...) rides as a field: the
 *  member's sentence names it in plain words only (`limits.js::LIMIT_PLAIN`). */
const LIMIT_NAME = /^[A-Z][A-Z0-9_]{0,63}$/

/** The run-wide refusal for a thrown stop, by the run's own name. */
export function refusalOf(rt, err) {
  const guard = (err && typeof err.guard === 'string' && err.guard)
    || (err && err.name === SCRIPT_ERROR_GUARD ? SCRIPT_ERROR_GUARD : rt.RUNTIME_FAILED_GUARD)
  const sentence = String((err && err.message) || err).slice(0, 2000)
  const limit = err && typeof err.limit === 'string' && LIMIT_NAME.test(err.limit) ? err.limit : null
  return { guard, sentence, bar: err && Number.isInteger(err.bar) ? err.bar : null, limit }
}

/** W9-T14: why `rec` cannot be written as JSON exactly (a path and a reason), or null. Every number
 *  must be finite and every value JSON-representable: JSON.stringify writes NaN and +/-Infinity as
 *  null and drops undefined, which would be a silent wrong value on the wire. */
export function recordValueFault(rec, path = 'strategy', depth = 0) {
  if (depth > 16) return `${path} is nested deeper than a strategy record is`
  if (rec === null || typeof rec === 'string' || typeof rec === 'boolean') return null
  if (typeof rec === 'number') return Number.isFinite(rec) ? null : `${path} is ${rec}, not a finite number`
  if (Array.isArray(rec)) {
    for (let i = 0; i < rec.length; i += 1) {
      const why = recordValueFault(rec[i], `${path}[${i}]`, depth + 1)
      if (why) return why
    }
    return null
  }
  if (typeof rec === 'object' && (Object.getPrototypeOf(rec) === Object.prototype || Object.getPrototypeOf(rec) === null)) {
    for (const [k, v] of Object.entries(rec)) {
      const why = recordValueFault(v, `${path}.${k}`, depth + 1)
      if (why) return why
    }
    return null
  }
  return `${path} is ${rec === undefined ? 'undefined' : `a ${typeof rec}`}, which JSON cannot carry`
}

/** W9-T14: the run's record as wire text, `{ refusal }` when the run made none, or `{ fault }`. */
function strategyOfRun(rt, cols) {
  const rec = typeof rt.runtimeStrategyOf === 'function' ? rt.runtimeStrategyOf(cols) : null
  if (rec === null || rec === undefined) {
    return { refusal: { key: STRATEGY_WANT, guard: OUTPUT_ABSENT_GUARD, bar: null,
      sentence: 'this run made no strategy record (the script did not run with the strategy broker), so there is no backtest to serve.' } }
  }
  const fault = recordValueFault(rec)
  return fault ? { fault } : { text: JSON.stringify(rec) }
}

/** Encode one run's columns for the wire (see the header), or withhold the whole job. */
export function encodeResult(rt, job, cols) {
  const info = cols ? cols[rt.RUNTIME_INCREMENTAL_KEY] : null
  if (info && info.resumedFrom !== null && info.resumedFrom !== undefined) {
    return runWide(job.job, INTEGRITY_GUARD, 'this run resumed from an earlier run instead of starting cold, so it has no value.')
  }
  const keys = job.want.length ? job.want : Object.keys(cols)
  const columns = {}
  const refusals = []
  for (const key of keys) {
    if (key === STRATEGY_WANT) continue // the record, below: never a column
    if (!Object.prototype.propertyIsEnumerable.call(cols, key)) {
      refusals.push({ key, guard: OUTPUT_ABSENT_GUARD, sentence: `this run produced no output \`${key}\`.`, bar: null })
      continue
    }
    const b64 = encodeColumn(rt, cols[key], job.bars.n)
    if (b64 === null) {
      return runWide(job.job, INTEGRITY_GUARD, `output \`${key}\` is not ${job.bars.n} numbers long, so no output of this job has a value.`)
    }
    columns[key] = b64
  }
  if (cols[rt.RUNTIME_OBJECTS_KEY]) {
    refusals.push({ key: rt.RUNTIME_OBJECTS_KEY, guard: DRAWINGS_GUARD,
      sentence: 'the drawings this script makes are not served to alerts, scans or backtests yet.', bar: null })
  }
  let strategy
  if (Array.isArray(job.want) && job.want.includes(STRATEGY_WANT)) {
    const s = strategyOfRun(rt, cols)
    if (s.fault) return runWide(job.job, INTEGRITY_GUARD, `the strategy record cannot be sent exactly: ${s.fault}, so no output of this job has a value.`)
    if (s.refusal) refusals.push(s.refusal)
    else strategy = s.text
  }
  const warm = rt.runtimeWarmupOf(cols)
  return { job: job.job, status: 'ok', columns, refusals, warmup: { withheldBars: warm === null ? 0 : warm.withheldBars },
    ...(strategy !== undefined ? { strategy } : {}) }
}

/**
 * Run one job ONCE on the bundle `rt`, cold, and reset the bundle's session state afterwards.
 * Never throws: every stop is a named, run-wide refusal.
 */
export function runJob(rt, doc, job, clock = () => performance.now()) {
  const started = clock()
  let out
  try {
    const { def, rows, ctx } = runArgs(doc, job)
    const cols = rt.computeRuntimeColumns(def, rows, ctx, { budgetMs: rt.RUNTIME_PANE_TIME_BUDGET_MS, incremental: false })
    out = encodeResult(rt, job, cols)
  } catch (err) {
    const r = refusalOf(rt, err)
    out = runWide(job.job, r.guard, r.sentence, r.bar, r.limit)
  } finally {
    rt.resetRuntimeSessions()
    rt.resetRuntimeLedgers()
  }
  out.ms = Math.max(0, Math.round(clock() - started))
  return out
}
