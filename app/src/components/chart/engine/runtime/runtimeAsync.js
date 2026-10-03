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
let _nextId = 1
const _jobs = new Map()

/** Rebuild the error a worker reported, with the fields the registry reads. */
function errorOf(e) {
  const err = new Error(e && e.message ? e.message : 'the runtime lane failed')
  err.name = (e && e.name) || 'Error'
  if (e && e.guard) err.guard = e.guard
  if (e && Number.isInteger(e.bar)) err.bar = e.bar
  return err
}

/** Run on this thread: the fallback when no worker can be had. */
function runHere(def, rows, ctx, done) {
  let columns = null
  let failed = null
  try {
    columns = computeRuntimeColumns(def, rows, ctx, { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS })
  } catch (err) { failed = err }
  done(failed, columns)
}

function workerOf(factory) {
  if (_worker || _workerBroken) return _worker
  try {
    _worker = factory()
  } catch {
    _workerBroken = true
    return null
  }
  _worker.onmessage = (event) => {
    const { id, ok, columns, error, objects } = event.data || {}
    const job = _jobs.get(id)
    if (!job) return
    _jobs.delete(id)
    job.done(ok ? null : errorOf(error), ok ? withRuntimeObjects(columns, objects || null) : null)
  }
  _worker.onerror = () => {
    // ⛔ A WORKER THAT DIES TAKES NO RUN WITH IT: every job in flight is run
    // here instead, and no further job is sent to it.
    _workerBroken = true
    const pending = [..._jobs.values()]
    _jobs.clear()
    try { _worker.terminate() } catch { /* already gone */ }
    _worker = null
    for (const job of pending) runHere(job.def, job.rows, job.ctx, job.done)
  }
  return _worker
}

/** The runner `runtimeColumns` hands a run to. Exported for its test.
 *  @param {() => Worker} factory */
export function workerRunner(factory) {
  return (def, rows, ctx, done) => {
    const w = workerOf(factory)
    if (!w) { runHere(def, rows, ctx, done); return }
    const id = _nextId++
    _jobs.set(id, { def, rows, ctx, done })
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
    try {
      w.postMessage({ id, def: plainDef, rows: plainRows, ctx: plainCtx })
    } catch {
      _jobs.delete(id)
      runHere(def, rows, ctx, done)
    }
  }
}

/** Test seam: forget the worker and the jobs. */
export function resetRuntimeAsync() {
  if (_worker) { try { _worker.terminate() } catch { /* gone */ } }
  _worker = null
  _workerBroken = false
  _jobs.clear()
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
