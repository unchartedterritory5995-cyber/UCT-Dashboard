// app/src/components/chart/engine/runtime/runtimeAsync.js
//
// ─── ⭐⭐ RT1 — LOADING THE RUNTIME LANE, AND RUNNING IT OFF THE MAIN THREAD ───
//
// `ensureRuntimeLane()` is the ONE door that makes a runtime document computable
// in this client: it registers the lane's compute with the registry
// (`nativeRegistry.registerRuntimeLane`), installs the worker runner
// (`runtimeColumns.setRuntimeRunner`) where a browser has workers, and tells the
// chart to repaint when a run lands (the same generation the server lane bumps,
// `serverCompute.notifyColumnsLanded`, which `StockChart` already listens to).
//
// Two callers: the member door, when it mints a runtime document, and the
// registry, lazily, when a SAVED runtime document is installed on a chart that
// never opened the door (`nativeRegistry.runtimeColumnsOrReasons`). Idempotent.
//
// ⛔ WITHOUT `Worker` (tests, a non-browser host) nothing is installed and every
// run is synchronous — the same computation, under the same time budget.
import { registerRuntimeLane } from '../nativeRegistry.js'
import { notifyColumnsLanded } from '../serverCompute.js'
import { withRuntimeObjects } from './runtimeObjects.js'
import {
  runtimeColumnsFor, computeRuntimeColumns, setRuntimeRunner, onRuntimeColumnsLanded,
  RUNTIME_PANE_TIME_BUDGET_MS,
} from './runtimeColumns.js'

let _ready = false
let _worker = null
let _workerBroken = false
let _starts = 0
let _nextId = 1
const _jobs = new Map()      // id -> job, in the order they were posted
const _held = new Map()      // coalescing key -> the newest job not yet posted
let _watchdog = null

/** ⭐⭐ RF — HOW LONG THE WORKER MAY TAKE TO ANSWER THE JOB AT THE HEAD OF ITS
 *  QUEUE before it is called unresponsive, in ms. The run itself is bounded by
 *  `RUNTIME_PANE_TIME_BUDGET_MS` (1,000 ms of bars) plus its compile; this also
 *  covers fetching and starting the worker bundle on a slow connection. */
export const RUNTIME_WORKER_WATCHDOG_MS = 20000

/** ⭐ RF — how many times one tab starts a worker before it stops trying. A
 *  worker that cannot load (a stale bundle after a deploy, a blocked fetch) or
 *  keeps dying is not restarted forever. */
export const RUNTIME_WORKER_MAX_STARTS = 3

/** The guards a run carries when the WORKER, not the script, failed. */
export const RUNTIME_WORKER_UNRESPONSIVE_GUARD = 'runtime:worker-unresponsive'
export const RUNTIME_WORKER_FAILED_GUARD = 'runtime:worker-failed'

/** Rebuild the error a worker reported, with the fields the registry reads. */
function errorOf(e) {
  const err = new Error(e && e.message ? e.message : 'the runtime lane failed')
  err.name = (e && e.name) || 'Error'
  if (e && e.guard) err.guard = e.guard
  if (e && Number.isInteger(e.bar)) err.bar = e.bar
  return err
}

function named(guard, message) {
  const err = new Error(message)
  err.guard = guard
  return err
}

const unresponsive = () => named(RUNTIME_WORKER_UNRESPONSIVE_GUARD,
  `the background worker that draws this script bar by bar did not answer within ${RUNTIME_WORKER_WATCHDOG_MS / 1000} s, `
  + 'so it was stopped and nothing is drawn rather than part of it. The chart is unaffected; '
  + 'changing the symbol or timeframe tries again.')
const workerFailed = () => named(RUNTIME_WORKER_FAILED_GUARD,
  'the background worker that draws this script bar by bar failed to start or stopped, so nothing is drawn. '
  + 'The chart is unaffected; reloading the page tries again.')

/** Run on this thread: ONLY where this browser cannot construct a worker at all. */
function runHere(def, rows, ctx, done) {
  let columns = null
  let failed = null
  try {
    columns = computeRuntimeColumns(def, rows, ctx, { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS })
  } catch (err) { failed = err }
  done(failed, columns)
}

/** Answer a job once, whatever answers it first (the worker or the watchdog). */
function settle(job, err, columns) {
  if (job.settled) return
  job.settled = true
  job.done(err, columns)
}

function disarm() {
  if (_watchdog !== null) { clearTimeout(_watchdog); _watchdog = null }
}

/** ⭐ RF — one timer, on the job at the head of the queue: the worker answers in
 *  order, so the head is the one running (or the worker is still loading). */
function arm() {
  disarm()
  if (!_jobs.size) return
  _watchdog = setTimeout(() => {
    _watchdog = null
    killWorker(unresponsive)
  }, RUNTIME_WORKER_WATCHDOG_MS)
}

/** ⛔ RF — A WORKER THAT HANGS OR DIES IS STOPPED, AND EVERY JOB IT HELD IS
 *  ANSWERED BY NAME. Nothing it held is re-run on the main thread (RT1 did): a
 *  run there is up to a full budget of frames, and on a live chart that is a
 *  freeze per update. The next job starts a fresh worker, up to
 *  `RUNTIME_WORKER_MAX_STARTS` per tab. */
function killWorker(reasonOf) {
  disarm()
  const pending = [..._jobs.values()]
  _jobs.clear()
  if (_worker) { try { _worker.terminate() } catch { /* already gone */ } }
  _worker = null
  if (_starts >= RUNTIME_WORKER_MAX_STARTS) _workerBroken = true
  const held = [..._held.values()]
  _held.clear()
  for (const job of [...pending, ...held]) settle(job, reasonOf(), null)
}

function workerOf(factory) {
  if (_worker || _workerBroken) return _worker
  _starts += 1
  try {
    _worker = factory()
  } catch {
    // ⭐ This browser cannot construct a worker at all: the only case that runs
    // on this thread (under the same budget).
    _workerBroken = true
    _starts = Infinity
    return null
  }
  _worker.onmessage = (event) => {
    const { id, ok, columns, error, objects } = event.data || {}
    const job = _jobs.get(id)
    if (!job) return
    _jobs.delete(id)
    arm()
    settle(job, ok ? null : errorOf(error), ok ? withRuntimeObjects(columns, objects || null) : null)
    postHeld(job.coalesce, factory)
  }
  _worker.onerror = () => killWorker(workerFailed)
  _worker.onmessageerror = () => killWorker(workerFailed)
  return _worker
}

/** The plain message one job sends. */
function messageOf(id, def, rows, ctx) {
  // ⭐ ONLY WHAT THE RUN READS crosses: the plain rows, the compute block, the
  // two `meta` facts, and the context's plain fields.
  const plainDef = {
    id: def && def.id,
    compute: def && def.compute,
    meta: { runtimeHistory: def && def.meta ? def.meta.runtimeHistory : undefined },
  }
  const plainCtx = {
    tf: ctx && ctx.tf,
    newestBarIsForming: ctx ? ctx.newestBarIsForming : undefined,
    historyFromListing: !!(ctx && ctx.historyFromListing === true),
    ...(ctx && ctx.symbol && typeof ctx.symbol === 'object'
      ? { symbol: { ticker: ctx.symbol.ticker, exchange: ctx.symbol.exchange } } : {}),
  }
  const plainRows = rows.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }))
  return { id, def: plainDef, rows: plainRows, ctx: plainCtx }
}

function post(job, factory) {
  const w = workerOf(factory)
  if (!w) {
    if (_starts === Infinity) { runHere(job.def, job.rows, job.ctx, (e, c) => settle(job, e, c)); return }
    settle(job, workerFailed(), null)
    return
  }
  const id = _nextId++
  _jobs.set(id, job)
  try {
    w.postMessage(messageOf(id, job.def, job.rows, job.ctx))
  } catch {
    _jobs.delete(id)
    settle(job, workerFailed(), null)
    return
  }
  if (_jobs.size === 1) arm()
}

/** Post the newest held job for this key, once nothing for the key is in flight. */
function postHeld(key, factory) {
  if (!_held.has(key)) return
  for (const j of _jobs.values()) if (j.coalesce === key) return
  const job = _held.get(key)
  _held.delete(key)
  post(job, factory)
}

/** ⭐ RF — WHICH JOBS ARE THE SAME PANE: one document on one chart (symbol,
 *  timeframe, clock, listing fact). A live chart hands a new bars array per
 *  update; while one run of the pane is in the worker, only the NEWEST waiting
 *  one is kept — an older one would compute bars nobody paints. */
function coalesceKeyOf(def, ctx) {
  const s = ctx && ctx.symbol && typeof ctx.symbol === 'object' ? `${ctx.symbol.ticker}@${ctx.symbol.exchange}` : '-'
  return `${def && def.id}|${def && def.compute && def.compute.fn}|${ctx && ctx.tf}|${s}|`
    + `${ctx ? ctx.newestBarIsForming : ''}|${!!(ctx && ctx.historyFromListing === true)}`
}

/** The runner `runtimeColumns` hands a run to. Exported for its test.
 *  @param {() => Worker} factory */
export function workerRunner(factory) {
  return (def, rows, ctx, done) => {
    const job = { def, rows, ctx, done, coalesce: coalesceKeyOf(def, ctx), settled: false }
    if ([..._jobs.values()].some((j) => j.coalesce === job.coalesce)) {
      // ⛔ A SUPERSEDED JOB IS NEVER ANSWERED: its bars array is no longer the
      // chart's, its memo entry stays "in flight" and goes with that array. No
      // landing, no repaint, no notice for bars nobody draws.
      _held.set(job.coalesce, job)
      return
    }
    post(job, factory)
  }
}

/** Test seam: forget the worker and the jobs. */
export function resetRuntimeAsync() {
  disarm()
  if (_worker) { try { _worker.terminate() } catch { /* gone */ } }
  _worker = null
  _workerBroken = false
  _starts = 0
  _jobs.clear()
  _held.clear()
  _ready = false
  setRuntimeRunner(null)
}

const defaultFactory = () => new Worker(new URL('./runtimeWorker.js', import.meta.url), { type: 'module' })

/** Make runtime documents computable in this client. Idempotent. */
export function ensureRuntimeLane({ factory } = {}) {
  registerRuntimeLane(runtimeColumnsFor)
  if (_ready) return
  _ready = true
  onRuntimeColumnsLanded((key) => notifyColumnsLanded(key))
  const canWork = typeof Worker === 'function' && typeof window !== 'undefined'
  if (factory || canWork) setRuntimeRunner(workerRunner(factory || defaultFactory))
}
