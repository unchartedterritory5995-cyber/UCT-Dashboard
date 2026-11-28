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
import { setRuntimeBudgetStopClock } from '../runtimeBudgetStops.js'
import { notifyColumnsLanded } from '../serverCompute.js'
import { withRuntimeObjects, RUNTIME_WARMUP_KEY } from './runtimeObjects.js'
import { withStrategyRecord } from './strategyRecord.js'
import { CALC_BARS_KEY } from '../calcBarsWindow.js'
import { RUNTIME_OVERNIGHT_KEY } from './overnightTail.js'
import {
  runtimeColumnsFor, computeRuntimeColumns, setRuntimeRunner, onRuntimeColumnsLanded,
  RUNTIME_PANE_TIME_BUDGET_MS, RUNTIME_TIME_BUDGET_GUARD, RUNTIME_LIMIT_GUARD, RUNTIME_FAILED_GUARD,
} from './runtimeColumns.js'
import { LIMIT_NAMES } from './limits.js'
import { errorFromImage } from './errorImage.js'
import { runtimeSourceHash } from '../runtimeKill.js'
import { bindSymbolOf } from '../ast/bind.js'
import { noteRuntimeRunStarted, noteRuntimeRunSettled, resetRuntimeRunTelemetry } from '../runtimeRunTelemetry.js'
import { RUNTIME_WORKER_READY, RUNTIME_WORKER_READY_ASK, RUNTIME_WORKER_WARM } from './workerReady.js'
import { strippedForScan } from '../ast/pine.js'

let _ready = false
let _worker = null
let _workerBroken = false
let _starts = 0
let _nextId = 1
// ⭐⭐ (engine 86) ONE JOB IN THE WORKER AT A TIME, the rest waiting HERE, so a stale run can be stopped
// without taking anyone else's with it (`supersede`, `cancelInFlight`). ⚰️ Every job was posted at once
// and queued inside the worker, where nothing could reach it: a symbol or timeframe switch waited behind
// the old symbol's whole run, and the only bound on that wait was the time budget.
let _inFlight = null         // the job the worker is computing
const _queue = []            // jobs not yet posted, oldest first: at most one per pane, and per key for pane-less jobs
let _hidden = false          // the tab is hidden: nothing is posted, and the running job was stopped
let _visibilityBound = false
const _stats = { posted: 0, cancelled: 0, superseded: 0, hiddenStops: 0, factsKept: 0, warmed: 0 }
let _watchdog = null
// ⭐⭐ (Fred RS run half, 2026-11-26) — THE WORKER HAS SAID IT IS READY (`workerReady.js`). A worker from a factory that
// announces (`factory.announcesReady`, the browser's own) starts not ready, and nothing is posted to it until it says
// so; a job superseded meanwhile is dropped HERE (the queue keeps one per pane) and the loading worker is kept.
// ⚰️ Measured (production-flag bundle, smoke@ AGL 1D cold reloads, 2026-11-26): in 9 of 20 the chart's first run was
// posted to a worker still loading, superseded 40-260 ms later (the listing date landed), and the worker TERMINATED and
// loaded again, its whole start-up paid twice before the RS label could be computed. A factory that does not announce
// (every stand-in) is ready at once, as before.
let _workerReady = true
let _readyWatchdog = null
// ⭐⭐ WARM jobs waiting for a ready, idle worker: `{def, rows, ctx}` (`warmRuntimeLane({warm})`)
const _warmJobs = []

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

/** An entry's own enumerable fields whose values are plain data (null, string, number, boolean). */
function plainFieldsOf(e) {
  const out = {}
  if (!e || typeof e !== 'object') return out
  for (const [k, v] of Object.entries(e)) if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v
  return out
}

/** Rebuild the error a worker reported, with EVERY field it carried (`errorImage.js`, the rule: an error
 *  that crosses a worker boundary keeps every field the main thread reads). ⚰️ A hand-picked list here
 *  dropped `pending` (RS Rating L10b): a wait came back as a refusal. */
function errorOf(e) {
  return errorFromImage(e, 'the runtime lane failed')
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
// transport (a keepalive `fetch`, `sendStopBeacon`), and the beacon is fire-and-forget (it never throws, never waits, and
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
    // the NAME rides the refusal as a field; the member's sentence carries none
    if (LIMIT_NAMES.includes(err.limit)) body.limit = err.limit
  }
  return body
}

/** ⛔ `fetch` with `keepalive`, NOT `navigator.sendBeacon`: a sendBeacon of an
 *  `application/json` Blob is a non-CORS-safelisted type that some Chrome and
 *  Safari versions refuse (it returns false, or throws), and nothing here could
 *  prove which. A keepalive POST outlives the page the same way, carries the
 *  session cookie, and its failure (offline, a 4xx, a refused request) is
 *  swallowed: a telemetry miss costs nothing. */
function sendStopBeacon(body) {
  if (typeof fetch !== 'function') return
  try {
    const sent = fetch(RUNTIME_STOP_BEACON_URL, {
      method: 'POST', keepalive: true, credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (sent && typeof sent.catch === 'function') sent.catch(() => {})
  } catch { /* a refused request is a lost count, never an error */ }
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

/** Test seam: where a stop's beacon goes (null: a keepalive `fetch`). */
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
  if (job) { job.lane = 'main'; job.startedAt = clock(); noteRuntimeRunStarted() }
  try {
    columns = computeRuntimeColumns(def, rows, ctx, { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS })
  } catch (err) { failed = err }
  done(failed, columns)
}

/** Answer a job once, whatever answers it first (the worker or the watchdog). */
function settle(job, err, columns) {
  if (job.settled) return
  job.settled = true
  // ⭐ U4 — the run count (`runtimeRunTelemetry.js`): every ANSWERED job, by outcome,
  // with its round trip when it started. An integer bump; nothing is sent from here.
  noteRuntimeRunSettled(err || null, job.startedAt != null ? clock() - job.startedAt : undefined)
  if (err) {
    reportStop(job.def, job.rows, err,
      Number.isFinite(err.ms) ? err.ms : clock() - (job.startedAt ?? clock()), job.lane)
  }
  job.done(err, columns)
}

function disarm() {
  if (_watchdog !== null) { clearTimeout(_watchdog); _watchdog = null }
}

function disarmReady() {
  if (_readyWatchdog !== null) { clearTimeout(_readyWatchdog); _readyWatchdog = null }
}

/** A worker that never says it is ready is as unresponsive as one that never answers: the same timer, the same end. */
function armReady() {
  if (_readyWatchdog !== null) return
  _readyWatchdog = setTimeout(() => {
    _readyWatchdog = null
    if (!_workerReady) killWorker(unresponsive)
  }, RUNTIME_WORKER_WATCHDOG_MS)
}

/** ⭐ RF — one timer, on the job in the worker (or the worker still loading for it). */
function arm() {
  disarm()
  if (!_inFlight) return
  _watchdog = setTimeout(() => {
    _watchdog = null
    killWorker(unresponsive)
  }, RUNTIME_WORKER_WATCHDOG_MS)
}

/** A worker that will not be asked anything again: its doors closed, then terminated. */
function stopWorker(w) {
  if (!w) return
  w.onmessage = null
  w.onerror = null
  w.onmessageerror = null
  try { w.terminate() } catch { /* already gone */ }
}

/** ⛔ RF — A WORKER THAT HANGS OR DIES IS STOPPED, AND EVERY JOB IT HELD IS
 *  ANSWERED BY NAME. Nothing it held is re-run on the main thread (RT1 did): a
 *  run there is up to a full budget of frames, and on a live chart that is a
 *  freeze per update. The next job starts a fresh worker, up to
 *  `RUNTIME_WORKER_MAX_STARTS` per tab. */
function killWorker(reasonOf) {
  disarm()
  disarmReady()
  _warmJobs.length = 0   // a failed worker is never started again for a warm-up
  const failed = [...(_inFlight && !_inFlight.warm ? [_inFlight] : []), ..._queue.splice(0)]
  _inFlight = null
  stopWorker(_worker)
  _worker = null
  if (_starts >= RUNTIME_WORKER_MAX_STARTS) _workerBroken = true
  for (const job of failed) settle(job, reasonOf(), null)
}

/** A job that will never be answered: superseded before it ran, or stopped while it ran. Its memo entry is
 *  dropped (`runtimeColumnsFor`'s `forget`), so the same bars asked again are a new run, never a pending
 *  answer forever. Never painted, never a refusal, never counted as a stop. */
function forgetJob(job) {
  if (job.settled) return
  job.settled = true
  if (job.forget) { try { job.forget() } catch { /* a bad memo hook must not break the lane */ } }
}

/** ⭐⭐ (engine 86) — STOP THE RUN IN THE WORKER. By TERMINATING the worker: one that is computing cannot read a
 *  message until the run ends, and a cooperative stop needs a `SharedArrayBuffer` flag, which this page has not
 *  (it is not cross-origin isolated). The host lane stops its runs the same way (`hostLaneAsync.js`,
 *  `cancelRunning`). The next job starts a fresh worker. ⛔ A CANCEL IS NOT A FAILURE: the stopped worker's
 *  start is given back, so cancels never spend `RUNTIME_WORKER_MAX_STARTS`. Returns the job it stopped. */
function cancelInFlight() {
  const job = _inFlight
  disarm()
  disarmReady()
  _inFlight = null
  stopWorker(_worker)
  _worker = null
  _starts = Math.max(0, _starts - 1)
  _stats.cancelled += 1
  return job
}

/** ⭐⭐ (engine 86) — A PANE THAT ASKS FOR ANOTHER PICTURE STOPS ITS OWN RUN. A chart pane (`ctx.hostPane`, the
 *  binder's pane and instance) that now asks for a different document, symbol, timeframe, settings or history
 *  fact than the run in the worker was started for will never draw that run's answer: it is stopped and
 *  forgotten, and the newer job starts now on a fresh worker. ⛔ NOT for newer bars of the SAME picture (the
 *  same coalescing key): that run finishes, and the newer one resumes from its session in milliseconds; stopping
 *  it on a live chart would restart a cold run on every update and never draw. ⛔ NEVER another pane's run (a
 *  grid of charts asks for many pictures at once), and never a job no pane owns. */
function supersede(newer) {
  const run = _inFlight
  if (!run || newer.pane === null || run.pane !== newer.pane || run.coalesce === newer.coalesce) return
  // ⭐⭐ (e101 S1) ONLY A SYMBOL FACT LANDED (`factsKept`): the run is not stopped, the newer job waits
  if (!_factsKeepOff && run.factsFree === newer.factsFree && namesNoSymbolFact(newer.def)) {
    _stats.factsKept += 1
    return
  }
  forgetJob(cancelInFlight())
  _stats.superseded += 1
}

// ─── ⭐⭐ (e101 S1, coordinator GO 2026-11-27) — A SYMBOL FACT LANDING NEVER RESTARTS A RUN ─────────────────────────────
//
// ⚰️ MEASURED ON PRODUCTION (608bd20bf1, smoke@, kernel-channel-backquant, cold ticker switches): one switch posted the
// SAME run (same symbol, timeframe and 12,501 rows) three times, PEP at 18.8 / 174 / 561 ms and KO at 14 / 733 / 896 ms.
// Each repost came right after `/api/ticker-ipo` (170 / 730 ms: the listing date, '^?' -> '^date') or `/api/ticker-meta`
// (557 / 893 ms: the exchange, null -> NYSE) answered, so the worker was terminated twice per switch. Each restart
// fetched and evaluated the worker chunk again and threw away its build memo and sessions. The script reads neither
// fact. The final run started only when the last fact landed.
//
// So when a pane's newer job differs from its running job ONLY in those symbol facts (`coalesceKeyOf` with the facts
// erased is the same: the same document, ticker, timeframe, forming state and listing flags), the running job is not
// stopped. The newer job waits in the queue, and the running job finishes and settles under its own key. The newer job
// is then posted to the SAME worker, where it resumes from that run's session when the run cannot have read the facts
// (`runtimeColumns.js::factsSessionFor`, proved by the unchanged `resumableFrom`), and otherwise runs in full, as today.
// ⛔ THIS ONLY DECIDES WHEN A RUN IS STOPPED, NEVER A VALUE: the newer job always gets its own answer (a proven resume,
// or a full run). ⛔ The gate is static and conservative (`namesNoSymbolFact`): a script that names `syminfo`, a
// `request.` call, a `ticker.` call or an `import` keeps today's stop, because waiting for a run whose answer cannot be
// resumed would only delay the newer one.

/** Does the script name nothing that reads a symbol fact? `syminfo.*` (folded at build time), `request.*` (the listing
 *  date and the other-symbol bind), `ticker.*` and a library `import`: comments and strings stripped. Memoised. */
const SYMBOL_FACT_NAMES = /\bsyminfo\b|\brequest\s*\.|\bticker\s*\.|^\s*import\b/m
const _namesFact = new Map()
function namesNoSymbolFact(def) {
  const source = def && def.compute && typeof def.compute.source === 'string' ? def.compute.source : null
  if (source === null) return false
  let names = _namesFact.get(source)
  if (names === undefined) {
    try { names = SYMBOL_FACT_NAMES.test(strippedForScan(source)) } catch { names = true }
    if (_namesFact.size >= 16) _namesFact.delete(_namesFact.keys().next().value)
    _namesFact.set(source, names)
  }
  return !names
}
let _factsKeepOff = false
/** Tests: stop the running job on a symbol fact too (the identity rails compare both ways). */
export function __factsKeepOffForTests(off) { _factsKeepOff = !!off }

/** ⭐⭐ (engine 86) — A HIDDEN TAB COMPUTES NOTHING. The run in the worker is stopped (a worker cannot be paused)
 *  and goes back to the head of the queue; nothing is posted while hidden; visible again, the queue runs. A
 *  page that loads hidden starts its runs when it is first shown. */
function onVisibility() {
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
  if (hidden === _hidden) return
  _hidden = hidden
  if (hidden) {
    if (_inFlight) {
      const job = cancelInFlight()
      _stats.hiddenStops += 1
      if (!job.warm) _queue.unshift(job)
    }
    return
  }
  pump()
}

function bindVisibility() {
  if (_visibilityBound || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return
  _visibilityBound = true
  document.addEventListener('visibilitychange', onVisibility)
  _hidden = document.visibilityState === 'hidden'
}

/** Test seam: what the lane did (posted, cancelled, superseded, stopped while hidden). */
export function runtimeWorkerStats() {
  return { ..._stats, inFlight: !!_inFlight, queued: _queue.length, hidden: _hidden }
}

function workerOf(factory) {
  if (_worker || _workerBroken) return _worker
  _starts += 1
  _workerReady = !(factory && factory.announcesReady === true)
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
    // ⭐⭐ (Fred RS run half, 2026-11-26) the worker has evaluated: what waited for it is posted now
    if (event.data && event.data.kind === RUNTIME_WORKER_READY) {
      _workerReady = true
      disarmReady()
      pump()
      return
    }
    const { id, ok, columns, error, objects, warmup, strategy, calcBars, overnight } = event.data || {}
    const job = _inFlight
    if (!job || job.id !== id) return
    _inFlight = null
    disarm()
    // a warm job is answered with nothing: no landing, no count, no paint
    if (job.warm) { _stats.warmed += 1; pump(); return }
    const landed = ok ? withRuntimeObjects(columns, objects || null) : null
    if (landed && warmup) {
      Object.defineProperty(landed, RUNTIME_WARMUP_KEY, { value: warmup, enumerable: false, configurable: true })
    }
    // ⭐⭐ W9-T11 — the run's `strategy` record, re-attached as the worker found it
    if (landed && strategy) withStrategyRecord(landed, strategy)
    // ⭐⭐ CBC-FMT — and its `calc_bars_count` window record (the disclosure strip reads it)
    if (landed && calcBars) {
      Object.defineProperty(landed, CALC_BARS_KEY, { value: calcBars, enumerable: false, configurable: true })
    }
    // ⭐⭐ (2026-11-20) and its overnight tail's record (`overnightTail.js`; the strip reads it)
    if (landed && overnight) {
      Object.defineProperty(landed, RUNTIME_OVERNIGHT_KEY, { value: overnight, enumerable: false, configurable: true })
    }
    settle(job, ok ? null : errorOf(error), landed)
    pump()
  }
  _worker.onerror = () => killWorker(workerFailed)
  _worker.onmessageerror = () => killWorker(workerFailed)
  // ⭐⭐ (Fred RS run half, 2026-11-26) the ask the worker answers READY to once its module has evaluated
  if (!_workerReady) {
    try { _worker.postMessage({ kind: RUNTIME_WORKER_READY_ASK }) } catch { killWorker(workerFailed); return _worker }
  }
  return _worker
}

/** The plain message one job sends. */
function messageOf(id, def, rows, ctx) {
  // ⭐ ONLY WHAT THE RUN READS crosses: the plain rows, the compute block, the
  // two `meta` facts, and the context's plain fields.
  const plainDef = {
    id: def && def.id,
    compute: def && def.compute,
    meta: {
      runtimeHistory: def && def.meta ? def.meta.runtimeHistory : undefined,
      // ⭐⭐ CBC-FMT — the `calc_bars_count` window stamp: the run takes its window from it
      // (`engine/calcBarsWindow.js`). ⛔ Without it a worker run would compute every bar.
      ...(def && def.meta && Number.isInteger(def.meta.calcBarsCount) ? { calcBarsCount: def.meta.calcBarsCount } : {}),
    },
  }
  const plainCtx = {
    tf: ctx && ctx.tf,
    newestBarIsForming: ctx ? ctx.newestBarIsForming : undefined,
    historyFromListing: !!(ctx && ctx.historyFromListing === true),
    // ⭐⭐ (2026-11-20) the listing FACT where it holds and is not served (W / M): the run's withhold says it truthfully
    ...(ctx && ctx.listingStart === true ? { listingStart: true } : {}),
    // ⭐ UIE PHASE 2 (M4) — the member's settings (plain numbers and text)
    ...(ctx && ctx.runtimeInputs && typeof ctx.runtimeInputs === 'object'
      ? { runtimeInputs: { ...ctx.runtimeInputs } } : {}),
    ...(ctx && ctx.symbol && typeof ctx.symbol === 'object'
      // ⭐ RS RATING L3 — every field the fold reads (`bind.js::BIND_SYMBOL_FIELDS`), not only
      // `{ticker, exchange}`: the worker's run settles `syminfo.industry` from the same symbol.
      // ⭐⭐ (2026-11-19, Fred RS 1h) and the symbol's FIRST TRADE day, the listing fact the own-daily read's first
      // session rests on (`requestSupply.js::aboveChartRead`); absent stays absent (no listing is claimed).
      ? { symbol: { ticker: ctx.symbol.ticker, exchange: ctx.symbol.exchange, ...bindSymbolOf(ctx.symbol),
        ...(typeof ctx.symbol.firstTradeDate === 'string' ? { firstTradeDate: ctx.symbol.firstTradeDate } : {}),
        // ⭐⭐ (2026-11-20) and whether that answer is still in flight (the run waits on it)
        ...(ctx.symbol.firstTradeDatePending === true ? { firstTradeDatePending: true } : {}) } } : {}),
    // ⭐ P3 WS-F — a framed instance's window slides, so the run refuses a `varip` there
    ...(ctx && ctx.framed === true ? { framed: true } : {}),
    // ⭐⭐ W9-T11 — the window a broker run takes (design 3.4), as the context holds it
    ...(ctx && ctx.historyWindowBars !== undefined ? { historyWindowBars: ctx.historyWindowBars } : {}),
    // ⭐⭐ (2026-11-19, the strategy-only daily window) the depth a run from the listing is served at without [B-START-DEEP]
    ...(ctx && ctx.listingDepthBars !== undefined ? { listingDepthBars: ctx.listingDepthBars } : {}),
    // ⭐⭐ RS RATING L5 — the chart's other-symbol cache, for a run that reads another symbol
    // (`requestSupply.js` decides from it by the host bind's rules): plain entries, each with
    // the store exchange the bind matches a spelling against (`exchangeOf` is a function and
    // does not cross), rebuilt as a Map on the other side (`runtimeWorker.js`).
    ...(ctx && ctx.secondary && typeof ctx.secondary.entries === 'function' ? {
      // ⛔ EVERY PLAIN FIELD OF AN ENTRY CROSSES (as `hostLaneWire.entryImageOf` does): a hand-picked
      // {bars, status, exchange} dropped `newestBarIsForming`, which decides what the chart's newest bar
      // reads (RS RATING L11 PR 2, `otherSymbols.newestOwnPeriodOf`): the worker's run read the previous
      // session where the host read today's, and the column rail refused the run half.
      secondaryEntries: [...ctx.secondary.entries()].map(([k, e]) => [k, {
        ...plainFieldsOf(e),
        bars: e && Array.isArray(e.bars) ? e.bars.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })) : [],
        status: e && e.status,
        exchange: (e && typeof e.exchange === 'string' && e.exchange)
          || (typeof ctx.exchangeOf === 'function' ? ctx.exchangeOf(k) : null) || null,
      }]),
    } : {}),
  }
  const plainRows = rows.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }))
  return { id, def: plainDef, rows: plainRows, ctx: plainCtx }
}

function post(job) {
  const w = workerOf(job.factory)
  if (!w) {
    if (_starts === Infinity) { runHere(job.def, job.rows, job.ctx, (e, c) => settle(job, e, c), job); return }
    settle(job, workerFailed(), null)
    return
  }
  const id = _nextId++
  job.id = id
  job.lane = 'worker'
  job.startedAt = clock()
  _inFlight = job
  _stats.posted += 1
  noteRuntimeRunStarted()
  try {
    w.postMessage(messageOf(id, job.def, job.rows, job.ctx))
  } catch {
    _inFlight = null
    settle(job, workerFailed(), null)
    return
  }
  arm()
}

/** Post the next waiting job while the worker is free, READY and the tab is visible; a warm job only when no chart
 *  job waits. */
function pump() {
  while (!_inFlight && !_hidden && (_queue.length || _warmJobs.length)) {
    const factory = _queue.length ? _queue[0].factory : _warmJobs[0].factory
    const w = workerOf(factory)
    // ⭐⭐ posted when the worker says it is ready (`RUNTIME_WORKER_READY`), never before
    if (w && !_workerReady) { armReady(); return }
    if (_queue.length) { post(_queue.shift()); continue }
    const warm = _warmJobs.shift()
    if (w) postWarm(w, warm)
  }
}

/** ⭐⭐ (Fred RS run half, 2026-11-26) — a WARM job in the worker: the chart's own document over stand-in bars. It is
 *  `_inFlight` like any job (one at a time), so a chart job posted meanwhile waits for it; it is never superseded
 *  (it has no pane, `supersede`), never answered or counted (`workerOf`'s reply), and a stopped worker drops it. */
function postWarm(w, warm) {
  const id = _nextId++
  const job = { id, warm: true, pane: null, coalesce: null, factory: warm.factory }
  _inFlight = job
  try {
    const m = messageOf(id, warm.def, warm.rows, warm.ctx)
    w.postMessage({ ...m, kind: RUNTIME_WORKER_WARM })
  } catch {
    _inFlight = null
    return
  }
  arm()
}

/** ⭐ RF — WHICH JOBS ARE THE SAME PICTURE: one document on one chart (symbol,
 *  timeframe, clock, listing fact). A live chart hands a new bars array per
 *  update; while one run of the pane is in the worker, only the NEWEST waiting
 *  one is kept — an older one would compute bars nobody paints. */
function coalesceKeyOf(def, ctx, facts = true) {
  // ⭐⭐ (2026-11-20) the listing facts too: a run asked before the date landed is not the run asked after it
  // ⭐⭐ (e101 S1) `facts: false` erases the symbol facts (the exchange, the listing date): `supersede` compares the two
  const s = ctx && ctx.symbol && typeof ctx.symbol === 'object'
    ? (facts ? `${ctx.symbol.ticker}@${ctx.symbol.exchange}${typeof ctx.symbol.firstTradeDate === 'string' ? `^${ctx.symbol.firstTradeDate}`
      : ctx.symbol.firstTradeDatePending === true ? '^?' : ''}` : `${ctx.symbol.ticker}`) : '-'
  return `${def && def.id}|${def && def.compute && def.compute.fn}|${ctx && ctx.tf}|${s}|`
    + `${ctx ? ctx.newestBarIsForming : ''}|${!!(ctx && ctx.historyFromListing === true)}`
    + (ctx && ctx.listingStart === true ? '|listingStart' : '')
}

/** The chart pane asking (`binder.js`: its scope and the instance), or null for a request no pane owns. */
const paneOf = (ctx) => (ctx && typeof ctx.hostPane === 'string' && ctx.hostPane ? ctx.hostPane : null)

/** The runner `runtimeColumns` hands a run to. Exported for its test.
 *  `forget` (optional): called for a job that will never be answered, so its memo entry goes.
 *  @param {() => Worker} factory */
export function workerRunner(factory) {
  bindVisibility()
  return (def, rows, ctx, done, forget) => {
    const job = { def, rows, ctx, done, forget: typeof forget === 'function' ? forget : null, factory,
      coalesce: coalesceKeyOf(def, ctx), factsFree: coalesceKeyOf(def, ctx, false), pane: paneOf(ctx), settled: false }
    supersede(job)
    // ⛔ A SUPERSEDED WAITING JOB IS NEVER ANSWERED: its bars array is no longer the chart's (or its pane now asks
    // for another picture). No landing, no repaint, no notice for bars nobody draws; its memo entry is dropped.
    // A pane keeps its newest waiting job; a job no pane owns is coalesced by its key, as before.
    for (let i = _queue.length - 1; i >= 0; i -= 1) {
      const q = _queue[i]
      const same = job.pane !== null ? q.pane === job.pane : (q.pane === null && q.coalesce === job.coalesce)
      if (same) { _queue.splice(i, 1); forgetJob(q) }
    }
    _queue.push(job)
    pump()
  }
}

/** Test seam: forget the worker and the jobs. */
export function resetRuntimeAsync() {
  disarm()
  stopWorker(_worker)
  _worker = null
  _workerBroken = false
  _starts = 0
  _inFlight = null
  _queue.length = 0
  _warmJobs.length = 0
  _workerReady = true
  disarmReady()
  _warmedOnce = false
  if (_visibilityBound && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
  _visibilityBound = false
  _hidden = false
  for (const k of Object.keys(_stats)) _stats[k] = 0
  _ready = false
  _beaconed.clear()
  _hashOf.clear()
  _stopReporter = null
  _factsKeepOff = false
  _namesFact.clear()
  resetRuntimeRunTelemetry()
  setRuntimeRunner(null)
}

const defaultFactory = () => new Worker(new URL('./runtimeWorker.js', import.meta.url), { type: 'module' })
// ⭐⭐ (Fred RS run half, 2026-11-26) the browser's worker says READY when its module has evaluated (`runtimeWorker.js`)
defaultFactory.announcesReady = true

/** Make runtime documents computable in this client. Idempotent. */
export function ensureRuntimeLane({ factory } = {}) {
  registerRuntimeLane(runtimeColumnsFor)
  // the page's wall clock for a remembered time-budget stop's hold (`runtimeBudgetStops.js`: the compute closure reads
  // no clock of its own, design 2.2 H5)
  setRuntimeBudgetStopClock(() => Date.now())
  if (_ready) return
  _ready = true
  onRuntimeColumnsLanded((key) => notifyColumnsLanded(key))
  const canWork = typeof Worker === 'function' && typeof window !== 'undefined'
  if (factory || canWork) setRuntimeRunner(workerRunner(factory || defaultFactory))
}

/** ⚡ PRELOAD (perf/pine-runtime-chunk-preload) — the lane, AND ITS WORKER, now.
 *
 *  ⚰️ Measured on production (RS Rating, RDDT 1D, 2026-11-16): "Add this script to my chart" to
 *  labels drawn took 7.98 s in a cold tab against 1.85 s warm, and the cold cost is the worker
 *  chunk (~1.3 MB, ~380 KB gzip) fetched, parsed and evaluated on the FIRST job: `workerOf` spawns
 *  the worker only when a run is posted, so the download started after the bars and the run had
 *  already been asked for.
 *
 *  This spawns it ahead of the first job, so the chunk loads while the member is still reading the
 *  preview or the chart is still painting. Idempotent (`workerOf` keeps one worker), posts nothing,
 *  arms no watchdog (that is per job). Callers decide WHEN (never before the first chart paint) and
 *  WHETHER (only for a member whose runtime pane is permitted: this module is reached only behind
 *  that gate). Returns whether a worker now exists.
 *  ⛔ Without `Worker` (tests, a non-browser host) it registers the lane and spawns nothing. */
let _warmAsks = 0
/** ⭐ THE PASTE WORKER (2026-11-20) — how many times this module was asked to warm the lane. The member door
 *  builds in its own worker, where a warm can spawn nothing (no page); the worker counts the door's asks
 *  and the page warms the lane when the answer lands (`builder/memberPane/memberDoorAsync.js`). */
export function runtimeLaneWarmAsks() { return _warmAsks }

export function warmRuntimeLane({ factory, warm } = {}) {
  _warmAsks += 1
  ensureRuntimeLane({ factory })
  const canWork = typeof Worker === 'function' && typeof window !== 'undefined'
  if (!factory && !canWork) return false
  const f = factory || defaultFactory
  const w = workerOf(f)
  // ⭐⭐ (Fred RS run half, 2026-11-26) — AND THE DOCUMENTS THE CHART WILL RUN, run once over stand-in bars as soon as
  // the worker is ready and idle (`postWarm`): the compiler's and the VM's first run is paid before the chart's
  // first real job. At most `RUNTIME_WARM_MAX` documents, once per page; a chart job always goes first.
  if (w && Array.isArray(warm) && !_warmedOnce) {
    _warmedOnce = true
    for (const d of warm.slice(0, RUNTIME_WARM_MAX)) if (d && d.def) _warmJobs.push({ ...d, factory: f })
    pump()
  }
  return !!w
}
/** ⭐⭐ How many documents a page warms (`warmRuntimeLane({warm})`). */
export const RUNTIME_WARM_MAX = 2
let _warmedOnce = false
