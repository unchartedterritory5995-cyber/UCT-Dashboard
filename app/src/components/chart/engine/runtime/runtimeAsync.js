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
import { withRuntimeObjects, RUNTIME_WARMUP_KEY } from './runtimeObjects.js'
import {
  runtimeColumnsFor, computeRuntimeColumns, setRuntimeRunner, onRuntimeColumnsLanded,
  RUNTIME_PANE_TIME_BUDGET_MS, RUNTIME_TIME_BUDGET_GUARD, RUNTIME_LIMIT_GUARD, RUNTIME_FAILED_GUARD,
} from './runtimeColumns.js'
import { LIMIT_NAMES } from './limits.js'
import { runtimeSourceHash } from '../runtimeKill.js'

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
  if (e && Number.isFinite(e.ms)) err.ms = e.ms
  return err
}

// ─── ⭐⭐ P3 WS-H (S8) — THE STOP BEACON ──────────────────────────────────────
//
// A run that STOPS (one of `RUNTIME_STOP_BEACON_GUARDS`) is counted for the
// operator: `POST RUNTIME_STOP_BEACON_URL` (`api/routers/pine_runtime_telemetry.py`)
// with exactly { guard, limit?, hash, bars, ms, lane }. ⛔ NO SOURCE AND NO
// SENTENCE: the script leaves as the first 12 hex characters of its sha256 (the
// prefix the kill list prints), and a stop's message, which can quote the script,
// is read only for the NAME of a limit, kept only when it is a declared one.
// ⛔ Main thread only: the VM and the worker reach no network; this file is the
// transport, and the beacon is fire-and-forget (it never throws, never waits, and
// a failure costs nothing). Once per (script, stop) per tab, at most
// `RUNTIME_STOP_BEACONS_PER_TAB` per tab: a live chart reruns a stopping script on
// every update, and one count is the signal.
export const RUNTIME_STOP_BEACON_URL = '/api/pine-runtime-telemetry/stop'
export const RUNTIME_STOP_BEACONS_PER_TAB = 32
export const RUNTIME_STOP_BEACON_GUARDS = Object.freeze([
  RUNTIME_TIME_BUDGET_GUARD, RUNTIME_LIMIT_GUARD, RUNTIME_FAILED_GUARD,
  RUNTIME_WORKER_UNRESPONSIVE_GUARD, RUNTIME_WORKER_FAILED_GUARD,
])
const MAX_BEACON_MS = 600000
let _stopReporter = null
const _beaconed = new Set()
const _hashOf = new Map()     // source -> 12-hex prefix, the last few only

function hashPrefixOf(source) {
  if (_hashOf.has(source)) return _hashOf.get(source)
  const h = runtimeSourceHash(source).slice(0, 12)
  if (_hashOf.size >= 8) _hashOf.delete(_hashOf.keys().next().value)
  _hashOf.set(source, h)
  return h
}

/** The beacon body for a stopped run, or null when `err` is not a stop.
 *  Exported for its rail. */
export function runtimeStopBeaconOf(def, rows, err, ms, lane) {
  const guard = err && err.guard
  if (!RUNTIME_STOP_BEACON_GUARDS.includes(guard)) return null
  const source = def && def.compute && def.compute.source
  if (typeof source !== 'string' || !source) return null
  const body = {
    guard,
    hash: hashPrefixOf(source),
    bars: Array.isArray(rows) ? rows.length : 0,
    ms: Math.min(MAX_BEACON_MS, Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0))),
    lane: lane === 'main' ? 'main' : 'worker',
  }
  if (guard === RUNTIME_LIMIT_GUARD) {
    const m = /\(([A-Z_]+): at most /.exec(String(err.message || ''))
    if (m && LIMIT_NAMES.includes(m[1])) body.limit = m[1]
  }
  return body
}

function sendStopBeacon(body) {
  const nav = typeof navigator !== 'undefined' ? navigator : null
  if (!nav || typeof nav.sendBeacon !== 'function' || typeof Blob !== 'function') return
  nav.sendBeacon(RUNTIME_STOP_BEACON_URL, new Blob([JSON.stringify(body)], { type: 'application/json' }))
}

function reportStop(def, rows, err, ms, lane) {
  try {
    if (_beaconed.size >= RUNTIME_STOP_BEACONS_PER_TAB) return
    const body = runtimeStopBeaconOf(def, rows, err, ms, lane)
    if (!body) return
    const key = `${body.hash}|${body.guard}|${body.limit || ''}`
    if (_beaconed.has(key)) return
    _beaconed.add(key)
    ;(_stopReporter || sendStopBeacon)(body)
  } catch { /* a telemetry failure never reaches the chart */ }
}

/** Test seam: where a stop's beacon goes (null: `navigator.sendBeacon`). */
export function setRuntimeStopReporter(fn) { _stopReporter = typeof fn === 'function' ? fn : null }

const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())

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
function runHere(def, rows, ctx, done, job) {
  let columns = null
  let failed = null
  if (job) { job.lane = 'main'; job.startedAt = clock() }
  try {
    columns = computeRuntimeColumns(def, rows, ctx, { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS })
  } catch (err) { failed = err }
  done(failed, columns)
}

/** Answer a job once, whatever answers it first (the worker or the watchdog). */
function settle(job, err, columns) {
  if (job.settled) return
  job.settled = true
  if (err) {
    reportStop(job.def, job.rows, err,
      Number.isFinite(err.ms) ? err.ms : clock() - (job.startedAt ?? clock()), job.lane)
  }
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
    const { id, ok, columns, error, objects, warmup } = event.data || {}
    const job = _jobs.get(id)
    if (!job) return
    _jobs.delete(id)
    arm()
    const landed = ok ? withRuntimeObjects(columns, objects || null) : null
    if (landed && warmup) {
      Object.defineProperty(landed, RUNTIME_WARMUP_KEY, { value: warmup, enumerable: false, configurable: true })
    }
    settle(job, ok ? null : errorOf(error), landed)
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
    // ⭐ UIE PHASE 2 (M4) — the member's settings (plain numbers and text)
    ...(ctx && ctx.runtimeInputs && typeof ctx.runtimeInputs === 'object'
      ? { runtimeInputs: { ...ctx.runtimeInputs } } : {}),
    ...(ctx && ctx.symbol && typeof ctx.symbol === 'object'
      ? { symbol: { ticker: ctx.symbol.ticker, exchange: ctx.symbol.exchange } } : {}),
  }
  const plainRows = rows.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }))
  return { id, def: plainDef, rows: plainRows, ctx: plainCtx }
}

function post(job, factory) {
  const w = workerOf(factory)
  if (!w) {
    if (_starts === Infinity) { runHere(job.def, job.rows, job.ctx, (e, c) => settle(job, e, c), job); return }
    settle(job, workerFailed(), null)
    return
  }
  const id = _nextId++
  job.lane = 'worker'
  job.startedAt = clock()
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
  _beaconed.clear()
  _hashOf.clear()
  _stopReporter = null
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
