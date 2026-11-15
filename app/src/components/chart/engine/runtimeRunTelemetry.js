// app/src/components/chart/engine/runtimeRunTelemetry.js
//
// ─── ⭐⭐ U4 — THE RUNTIME LANE'S RUN COUNT AND PERF BEACON ───────────────────────────────
//
// The cohort stage's exit gate is "stops under 2% of runs". The stop beacon
// (`runtime/runtimeAsync.js`, S8) counts STOPS, once per (script, stop) per tab, so the
// gate had a numerator and no denominator. This module is the denominator: every run the
// lane ANSWERS is counted, by outcome, in this tab, and the counts leave in a batch.
//
//   tab       a RANDOM nonce minted per page load (never stored, joins nothing): it lets
//             the server see that one heavy tab is not the whole sample
//   started   a run handed to the worker (or, where no worker can be built, this thread)
//   ok        a run that landed columns
//   stops     a run that stopped, by code: one of `RUN_STOP_GUARDS`, and for
//             `runtime:limit` the NAME of the limit (`runtime:limit:INSTRUCTIONS_PER_BAR`);
//             `runtime:load-failed` once per tab when the lane itself could not load
//   declined  a run that answered with any other refusal (not a stop)
//   dropped   a run answered while the batch was full (`RUNS_MAX_PER_BATCH`): REPORTED, so a
//             count that could not be kept is never mistaken for a quiet tab
//   ms        a fixed histogram (`RUN_MS_BUCKETS`, upper edges in ms) of each answered
//             run's round trip, post to answer, so the server can MERGE days and still
//             read p50/p95 (a percentile cannot be averaged; a histogram can be summed)
//
// ⛔⛔ "INSTANT ALWAYS": NOTHING HERE WAITS AND NOTHING IS SENT PER RUN. A run only bumps
// an integer. The batch leaves at most once every `RUNS_FLUSH_MS` from a timer that hands
// the send to `requestIdleCallback` where there is one, early when the batch fills (never
// sooner than `RUNS_MIN_GAP_MS` after the last send), or when the tab is hidden or closed
// (`pagehide` / `visibilitychange`). Sends are bounded by a ROLLING budget
// (`RUNS_BEACONS_PER_HOUR`): over it, the batch keeps collecting (and counting what it
// drops) until the hour frees a slot, so a tab open all day keeps reporting. The send is a
// keepalive `fetch` whose promise nobody awaits.
//
// ⛔⛔ NO SOURCE, NO HASH, NO MEMBER ID, NO SENTENCE. A batch is integers keyed by closed
// codes plus the random tab nonce; it does not even say which script ran. The server
// re-checks every key against its own closed sets (`pine_runtime_telemetry.RunsBody`).
//
// ⛔ A CACHED RESULT IS NOT A RUN. `runtimeColumnsFor` answers a memo hit without the
// runner, and only the runner's answer (`runtimeAsync.settle`) is counted here.

export const RUNTIME_RUNS_BEACON_URL = '/api/pine-runtime-telemetry/runs'
/** How long a batch collects before it is sent (when anything is in it). */
export const RUNS_FLUSH_MS = 60000
/** A full batch leaves early, but never sooner than this after the last send. */
export const RUNS_MIN_GAP_MS = 10000
/** At most this many batches leave one tab in any rolling hour. */
export const RUNS_BEACONS_PER_HOUR = 90
const HOUR_MS = 3600000
/** At most this many answered runs (ok + declined + stops) in one batch: the server's ceiling. */
export const RUNS_MAX_PER_BATCH = 600
/** The dropped count's own bound (the server's). */
export const RUNS_MAX_DROPPED = 100000
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

const now = () => Date.now()

function mintTab() {
  try {
    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null
    if (c && typeof c.getRandomValues === 'function') {   // works outside a secure context too
      const b = new Uint8Array(8)
      c.getRandomValues(b)
      return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    }
  } catch { /* fall through */ }
  let s = ''
  for (let i = 0; i < 16; i += 1) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

let _tab = mintTab()
let _acc = fresh()
let _timer = null
let _sends = []            // timestamps of sends in the rolling hour
let _loadFailedNoted = false
let _listening = false
let _reporter = null

function fresh() {
  return { started: 0, ok: 0, declined: 0, dropped: 0, stops: {}, ms: {} }
}

const answeredOf = (a) => a.ok + a.declined + Object.values(a.stops).reduce((x, y) => x + y, 0)

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

const isEmpty = (a) => !a.started && !a.dropped && !answeredOf(a)

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

function budgetLeft(t) {
  _sends = _sends.filter((s) => t - s < HOUR_MS)
  return _sends.length < RUNS_BEACONS_PER_HOUR
}

/** Send what has been collected, now, if the rolling budget allows. Never throws, never
 *  waits. Over budget, the batch is KEPT (and keeps collecting) for a later send. Exported
 *  for the page-hide path and the rails. */
export function flushRuntimeRuns() {
  try {
    if (_timer !== null) { clearTimeout(_timer); _timer = null }
    if (isEmpty(_acc)) return false
    const t = now()
    if (!budgetLeft(t)) { schedule(); return false }
    const body = { tab: _tab, ..._acc }
    if (!body.dropped) delete body.dropped
    _acc = fresh()
    _sends.push(t)
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

function fire() {
  _timer = null
  const idle = typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
    ? window.requestIdleCallback : null
  if (idle) idle(() => flushRuntimeRuns(), { timeout: 5000 })
  else flushRuntimeRuns()
}

function schedule(soon = false) {
  listen()
  const t = now()
  const last = _sends.length ? _sends[_sends.length - 1] : -Infinity
  let wait = RUNS_FLUSH_MS
  if (soon) wait = Math.max(0, RUNS_MIN_GAP_MS - (t - last))
  if (!budgetLeft(t)) wait = Math.max(wait, HOUR_MS - (t - _sends[0]))
  if (_timer !== null) {
    if (!soon) return
    clearTimeout(_timer)
  }
  _timer = setTimeout(fire, wait)
}

/** One answered run, or a drop when the batch is already full. */
function room() {
  if (answeredOf(_acc) < RUNS_MAX_PER_BATCH) return true
  _acc.dropped = Math.min(RUNS_MAX_DROPPED, _acc.dropped + 1)
  schedule(true)
  return false
}

/** ⭐ A run was handed to the worker (or this thread). Never throws. */
export function noteRuntimeRunStarted() {
  try {
    if (_acc.started < RUNS_MAX_PER_BATCH) _acc.started += 1
    schedule()
  } catch { /* never reaches the chart */ }
}

/** ⭐ The lane ANSWERED one run: `err` null for columns, else the run's error. `ms` is the
 *  round trip when the run started (omitted for a job answered before it started). */
export function noteRuntimeRunSettled(err, ms) {
  try {
    if (!room()) return
    if (!err) _acc.ok += 1
    else {
      const code = runStopCodeOf(err)
      if (code) _acc.stops[code] = (_acc.stops[code] || 0) + 1
      else _acc.declined += 1
    }
    if (Number.isFinite(ms)) {
      const k = runMsBucketOf(ms)
      _acc.ms[k] = (_acc.ms[k] || 0) + 1
    }
    schedule(answeredOf(_acc) >= RUNS_MAX_PER_BATCH)
  } catch { /* never reaches the chart */ }
}

/** ⭐ The lane could not be LOADED in this tab: one stop, once per tab. */
export function noteRuntimeLoadFailed() {
  try {
    if (_loadFailedNoted) return
    _loadFailedNoted = true
    if (!room()) return
    _acc.stops['runtime:load-failed'] = (_acc.stops['runtime:load-failed'] || 0) + 1
    schedule()
  } catch { /* never reaches the chart */ }
}

/** This tab's not-yet-sent batch (a copy). */
export function pendingRuntimeRuns() {
  return JSON.parse(JSON.stringify(_acc))
}

/** Test seams. */
export function setRuntimeRunsReporter(fn) { _reporter = typeof fn === 'function' ? fn : null }
export function runtimeRunsTab() { return _tab }
export function resetRuntimeRunTelemetry() {
  if (_timer !== null) { clearTimeout(_timer); _timer = null }
  _acc = fresh()
  _sends = []
  _loadFailedNoted = false
  _tab = mintTab()
}
