// app/src/components/chart/engine/runtimeRunTelemetry.js
//
// ─── ⭐⭐ U4 — THE RUNTIME LANE'S RUN COUNT AND PERF BEACON ───────────────────────────────
//
// The cohort stage's exit gate is "stops under 2% of runs". The stop beacon
// (`runtime/runtimeAsync.js`, S8) counts STOPS, once per (script, stop) per tab, so the
// gate had a numerator and no denominator. This module is the denominator: every run the
// lane ANSWERS is counted, by outcome, in this tab, and the counts leave in a batch.
//
//   started   a run handed to the worker (or, where no worker can be built, this thread)
//   ok        a run that landed columns
//   stops     a run that stopped, by code: one of `RUN_STOP_GUARDS`, and for
//             `runtime:limit` the NAME of the limit (`runtime:limit:INSTRUCTIONS_PER_BAR`);
//             `runtime:load-failed` once per tab when the lane itself could not load
//   declined  a run that answered with any other refusal (not a stop)
//   ms        a fixed histogram (`RUN_MS_BUCKETS`, upper edges in ms) of each answered
//             run's round trip, post to answer, so the server can MERGE days and still
//             read p50/p95 (a percentile cannot be averaged; a histogram can be summed)
//
// ⛔⛔ "INSTANT ALWAYS": NOTHING HERE WAITS AND NOTHING IS SENT PER RUN. A run only bumps
// an integer. The batch leaves at most once every `RUNS_FLUSH_MS`, from a timer that hands
// the send to `requestIdleCallback` where there is one, or when the tab is hidden or
// closed (`pagehide` / `visibilitychange`). The send is a keepalive `fetch` whose promise
// nobody awaits (the stop beacon's transport, for its reason: a JSON `sendBeacon` is
// refused by some browsers). At most `RUNS_BEACONS_PER_TAB` batches per tab.
//
// ⛔⛔ NO SOURCE, NO HASH, NO MEMBER ID, NO SENTENCE. A batch is integers keyed by closed
// codes; it does not even say which script ran (the stop beacon does that, for stops).
// The server re-checks every key against its own closed sets
// (`api/routers/pine_runtime_telemetry.py`, `RunsBody`).
//
// ⛔ A CACHED RESULT IS NOT A RUN. `runtimeColumnsFor` answers a memo hit without the
// runner, and only the runner's answer (`runtimeAsync.settle`) is counted here.

export const RUNTIME_RUNS_BEACON_URL = '/api/pine-runtime-telemetry/runs'
/** How long a batch collects before it is sent (when anything is in it). */
export const RUNS_FLUSH_MS = 60000
/** At most this many batches leave one tab (four hours of a busy chart). */
export const RUNS_BEACONS_PER_TAB = 240
/** No one count in a batch exceeds this (the server's per-field bound). */
export const RUNS_MAX_PER_FIELD = 10000
/** The round-trip histogram's upper edges, ms. A run over the last edge counts under `inf`.
 *  ⛔ Pinned to the server's `RUN_MS_BUCKETS` by `tests/test_pine_runtime_run_telemetry.py`. */
export const RUN_MS_BUCKETS = Object.freeze([
  1, 2, 3, 5, 7, 10, 15, 20, 30, 50, 70, 100, 150, 200, 300, 500, 700, 1000, 1500, 2000, 3000, 5000,
  10000, 20000,
])
/** The stops (S8's set, the server's `STOP_GUARDS`). ⛔ Pinned to both by the server rail. */
export const RUN_STOP_GUARDS = Object.freeze([
  'runtime:time-budget', 'runtime:limit', 'runtime:failed',
  'runtime:worker-unresponsive', 'runtime:worker-failed', 'runtime:load-failed',
])
const LIMIT_NAME_RE = /^[A-Z][A-Z_]{1,40}$/

let _acc = fresh()
let _timer = null
let _sent = 0
let _loadFailedNoted = false
let _listening = false
let _reporter = null

function fresh() {
  return { started: 0, ok: 0, declined: 0, stops: {}, ms: {} }
}

function bump(obj, key) {
  obj[key] = Math.min(RUNS_MAX_PER_FIELD, (obj[key] || 0) + 1)
}

/** The histogram key for one run's ms. Exported for its rail. */
export function runMsBucketOf(ms) {
  const v = Number.isFinite(ms) ? Math.max(0, ms) : 0
  for (const edge of RUN_MS_BUCKETS) if (v <= edge) return String(edge)
  return 'inf'
}

/** The stop code for an error, or null when the error is not a stop. Exported for its rail. */
export function runStopCodeOf(err) {
  const guard = err && err.guard
  if (!RUN_STOP_GUARDS.includes(guard)) return null
  if (guard === 'runtime:limit' && typeof err.limit === 'string' && LIMIT_NAME_RE.test(err.limit)) {
    return `${guard}:${err.limit}`
  }
  return guard
}

const isEmpty = (a) => !a.started && !a.ok && !a.declined
  && !Object.keys(a.stops).length && !Object.keys(a.ms).length

function send(body) {
  if (typeof fetch !== 'function') return
  try {
    const sent = fetch(RUNTIME_RUNS_BEACON_URL, {
      method: 'POST', keepalive: true, credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (sent && typeof sent.catch === 'function') sent.catch(() => {})
  } catch { /* a lost batch, never an error */ }
}

/** Send what has been collected, now. Never throws, never waits. Exported for the
 *  page-hide path and the rails. */
export function flushRuntimeRuns() {
  try {
    if (_timer !== null) { clearTimeout(_timer); _timer = null }
    const body = _acc
    _acc = fresh()
    if (isEmpty(body) || _sent >= RUNS_BEACONS_PER_TAB) return false
    _sent += 1
    ;(_reporter || send)(body)
    return true
  } catch { return false }
}

function onHide() {
  if (typeof document === 'undefined' || document.visibilityState === 'hidden') flushRuntimeRuns()
}

function listen() {
  if (_listening || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  _listening = true
  try {
    window.addEventListener('pagehide', flushRuntimeRuns)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onHide)
  } catch { /* no listeners: the timer still sends */ }
}

function schedule() {
  listen()
  if (_timer !== null || _sent >= RUNS_BEACONS_PER_TAB) return
  _timer = setTimeout(() => {
    _timer = null
    const idle = typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback : null
    if (idle) idle(() => flushRuntimeRuns(), { timeout: 5000 })
    else flushRuntimeRuns()
  }, RUNS_FLUSH_MS)
}

/** ⭐ A run was handed to the worker (or this thread). Never throws. */
export function noteRuntimeRunStarted() {
  try { bump(_acc, 'started'); schedule() } catch { /* never reaches the chart */ }
}

/** ⭐ The lane ANSWERED one run: `err` null for columns, else the run's error. `ms` is the
 *  round trip when the run started (omitted for a job answered before it started). */
export function noteRuntimeRunSettled(err, ms) {
  try {
    if (!err) bump(_acc, 'ok')
    else {
      const code = runStopCodeOf(err)
      if (code) bump(_acc.stops, code)
      else bump(_acc, 'declined')
    }
    if (Number.isFinite(ms)) bump(_acc.ms, runMsBucketOf(ms))
    schedule()
  } catch { /* never reaches the chart */ }
}

/** ⭐ The lane could not be LOADED in this tab: one stop, once per tab. */
export function noteRuntimeLoadFailed() {
  try {
    if (_loadFailedNoted) return
    _loadFailedNoted = true
    bump(_acc.stops, 'runtime:load-failed')
    schedule()
  } catch { /* never reaches the chart */ }
}

/** This tab's not-yet-sent batch (a copy). */
export function pendingRuntimeRuns() {
  return JSON.parse(JSON.stringify(_acc))
}

/** Test seams. */
export function setRuntimeRunsReporter(fn) { _reporter = typeof fn === 'function' ? fn : null }
export function resetRuntimeRunTelemetry() {
  if (_timer !== null) { clearTimeout(_timer); _timer = null }
  _acc = fresh()
  _sent = 0
  _loadFailedNoted = false
}
