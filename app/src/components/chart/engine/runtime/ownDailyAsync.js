// app/src/components/chart/engine/runtime/ownDailyAsync.js
//
// ─── ⭐⭐ THE OWN-DAILY QUESTION, OFF THE CHART'S MAIN THREAD (switch smoothness, 2026-11-20) ────────────
//
// MEASURED (patrick-54's trace of the 1D -> 5m switch with Fred RS, a production build of fcbb91a97f with hidden
// sourcemaps): the switch's worst values task was not the values. It was `useSecondarySources`' effect asking
// `runtimeReadsOwnDaily(source, '5', symbol)` (does the run read this chart's own daily rows?), which BUILDS the
// script's runtime program to read its request targets: 74 ms inside a 207 ms task on the member default path,
// 51 ms on the 28k-row path. The answer is memoised per (timeframe, symbol, source), so it is paid once per
// timeframe a member switches to, on the click.
//
// What this module does: the same question, answered by the same function (`runtimeReadsOwnDaily`) in a worker
// (`runtimeWorker.js`, the run's own bundle, its own instance: `ownDailyProbe.js`), the answer kept in the SAME
// memo the chart's thread reads (`runtimeColumns.js::rememberRuntimeOwnDaily`).
//   · `runtimeReadsOwnDailyOffThread` answers at once what this tab already knows (true / false); a question not
//     answered yet is asked in the worker and answers `null`, which the chart reads as NEEDED, the predicate's own
//     rule (a predicate that cannot answer never says no: `runtimeReadsOwnDaily`'s header). So a run that reads its
//     own daily rows has them asked for on the click, exactly as before; a run that does not is told so when the
//     worker answers (`onOwnDailyAnswer`), and the chart drops the key.
//   · ⛔ Answered HERE, as before (`runtimeReadsOwnDaily`, synchronously): with no worker (tests, a host without
//     one, a worker that failed: the tab stays on this thread after that), and for a script that IMPORTS a library
//     (the library registry is this thread's state, `pineLibraryStore.js`, and a worker starts holding none).
//   · The worker is started on the first question and stopped after `OWN_DAILY_WORKER_IDLE_MS` with nothing
//     asked, so a tab that is not switching holds no second copy of the run's bundle.
// ⛔ IT PICKS A THREAD, NEVER AN ANSWER: both threads run one function on the same arguments (railed through the
// real worker module, `ownDailyOffThread.rail.test.js`), and no value is computed from this answer: it decides
// which bars the chart FETCHES (`OWN_DAILY_KEY`), and the run reads what it is handed, as before.
import {
  runtimeOwnDailyQuestion, runtimeOwnDailyKnown, rememberRuntimeOwnDaily, runtimeReadsOwnDaily,
} from './runtimeColumns.js'
import { importPathsOf } from '../ast/pineLibraryStore.js'
import { OWN_DAILY_ASK } from './ownDailyProbe.js'

/** How long the probe worker is kept with nothing asked before it is stopped, in ms. */
export const OWN_DAILY_WORKER_IDLE_MS = 30000
/** How long one question may wait for its answer before the worker is called unresponsive (then this tab
 *  answers on its own thread, as before). Covers fetching and starting the bundle on a slow connection. */
export const OWN_DAILY_WORKER_WATCHDOG_MS = 20000

let _factory = null          // test seam: () => Worker-like
let _worker = null
let _broken = false
let _nextId = 1
let _idle = null
let _watchdog = null
const _asked = new Map()     // id -> {key, source, tf, symbol}
const _askedKeys = new Map() // key -> id
const _listeners = new Set()
const _stats = { asked: 0, answered: 0, here: 0, starts: 0, stops: 0, failures: 0 }

/** What this tab's probe did (diagnostics and rails). */
export function ownDailyAskStats() {
  return { ..._stats, broken: _broken, live: !!_worker, waiting: _asked.size }
}

/** Test seam: the worker factory (`null` = the browser's own worker, where there is one). */
export function setOwnDailyWorkerFactory(fn) { _factory = typeof fn === 'function' ? fn : null }

/** Test seam: forget the worker, the questions and the listeners. */
export function resetOwnDailyAsync() {
  stop()
  _broken = false
  _asked.clear()
  _askedKeys.clear()
  _listeners.clear()
  _factory = null
  for (const k of Object.keys(_stats)) _stats[k] = 0
}

/** Told `(key, yes)` whenever a question asked off this thread is answered. @returns {() => void} */
export function onOwnDailyAnswer(fn) {
  if (typeof fn !== 'function') return () => {}
  _listeners.add(fn)
  return () => { _listeners.delete(fn) }
}

const defaultFactory = () => new Worker(new URL('./runtimeWorker.js', import.meta.url), { type: 'module' })
const canWork = () => !_broken && (!!_factory || (typeof Worker === 'function' && typeof window !== 'undefined'))

function disarmWatchdog() { if (_watchdog !== null) { clearTimeout(_watchdog); _watchdog = null } }
function disarmIdle() { if (_idle !== null) { clearTimeout(_idle); _idle = null } }

function stop() {
  disarmWatchdog()
  disarmIdle()
  const w = _worker
  _worker = null
  if (!w) return
  w.onmessage = null
  w.onerror = null
  w.onmessageerror = null
  try { w.terminate() } catch { /* already gone */ }
  _stats.stops += 1
}

function tell(key, yes) {
  for (const fn of [..._listeners]) {
    try { fn(key, yes) } catch { /* a bad listener must not break the probe */ }
  }
}

/** ⛔ The worker failed (it could not start, crashed, sent an unreadable message, or did not answer): this tab
 *  answers on its own thread from now on, and every question still waiting is answered here, as before. */
function fail() {
  _stats.failures += 1
  _broken = true
  stop()
  const waiting = [..._asked.values()]
  _asked.clear()
  _askedKeys.clear()
  for (const q of waiting) {
    const yes = runtimeReadsOwnDaily(q.source, q.tf, q.symbol)
    _stats.here += 1
    tell(q.key, yes)
  }
}

function landed(reply) {
  const r = reply || {}
  if (r.kind !== OWN_DAILY_ASK) return
  const q = _asked.get(r.id)
  if (!q) return
  _asked.delete(r.id)
  _askedKeys.delete(q.key)
  const yes = r.ownDaily === true
  rememberRuntimeOwnDaily(q.key, yes)
  _stats.answered += 1
  if (_asked.size) {
    disarmWatchdog()
    _watchdog = setTimeout(() => { _watchdog = null; fail() }, OWN_DAILY_WORKER_WATCHDOG_MS)
  } else {
    disarmWatchdog()
    disarmIdle()
    _idle = setTimeout(() => { _idle = null; if (!_asked.size) stop() }, OWN_DAILY_WORKER_IDLE_MS)
  }
  tell(q.key, yes)
}

function workerOf() {
  if (_worker) return _worker
  if (_broken) return null
  try {
    _worker = (_factory || defaultFactory)()
  } catch {
    _worker = null
    _broken = true
    return null
  }
  _stats.starts += 1
  _worker.onmessage = (event) => landed(event && event.data)
  _worker.onerror = () => fail()
  _worker.onmessageerror = () => fail()
  return _worker
}

/**
 * ⭐⭐ `runtimeReadsOwnDaily(source, tf, symbol)`, without its build on this thread: `true` / `false` when this tab
 * knows the answer (or computes it here: no worker, or a script that imports a library), `null` while a worker
 * answers it (read as NEEDED; `onOwnDailyAnswer` says when it lands).
 */
export function runtimeReadsOwnDailyOffThread(source, tf, symbol = null) {
  const q = runtimeOwnDailyQuestion(source, tf, symbol)
  if (!q) return false
  const known = runtimeOwnDailyKnown(q.key)
  if (known !== undefined) return known
  if (_askedKeys.has(q.key)) return null
  const here = () => { _stats.here += 1; return runtimeReadsOwnDaily(source, tf, symbol) }
  if (!canWork() || importPathsOf(source).length) return here()
  const w = workerOf()
  if (!w) return here()
  const id = _nextId++
  try {
    w.postMessage({ kind: OWN_DAILY_ASK, id, source, tf: q.tf, symbol: q.symbol })
  } catch {
    // ⛔ a question that cannot be posted is answered here, as before (and the tab stays here)
    _broken = true
    stop()
    return here()
  }
  _asked.set(id, { key: q.key, source, tf, symbol })
  _askedKeys.set(q.key, id)
  _stats.asked += 1
  disarmIdle()
  if (_watchdog === null) _watchdog = setTimeout(() => { _watchdog = null; fail() }, OWN_DAILY_WORKER_WATCHDOG_MS)
  return null
}

/** The memo key of a question (`runtimeOwnDailyQuestion`), or null where the answer is no without a build. */
export function ownDailyKeyOf(source, tf, symbol = null) {
  const q = runtimeOwnDailyQuestion(source, tf, symbol)
  return q ? q.key : null
}
