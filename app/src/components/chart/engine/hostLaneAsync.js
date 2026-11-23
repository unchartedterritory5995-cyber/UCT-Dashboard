// app/src/components/chart/engine/hostLaneAsync.js
//
// ─── ⭐⭐ HOST WORKER — THE HOST LANE'S VALUES OFF THE MEMBER'S MAIN THREAD ──────────────────────────
//
// docs/pine/evidence/2026-11-17-host-lane-worker/EVIDENCE.md. The host (formula) lane computed a
// member's document synchronously inside the chart's paint (`StockChart.updateChart` -> `binder.sync`
// -> `nativeRegistry.computeFor` -> `astLaneColumns` -> `interpret`): pivot-point-supertrend held the
// page for 5.6-6.3 s when the deep history landed and twice per daily poll, supertrend-strategy 8.6 s.
//
// What this module does, for a CHART's request (`ctx.hostPane`, set by the binder) that goes to the worker
// (a document over #1711's estimate, `hostLaneCost.js::hostLaneCostOf`, or one this tab has not measured
// cheap at this size: "ONE DOOR" below):
//
//   1. the chart's thread plans the compute as it always did (`astColumns.js::astLanePlan`: the
//      member's settings, the `calc_bars_count` window, the scalars) and decides the script's own
//      `runtime.error` stop (`astRuntimeErrorStop`: its evaluator reaches the chart registry);
//   2. ONE worker per tab computes the VALUES with the SAME function the chart's thread runs
//      (`astColumnsGiven`, `hostLaneWorkerCore.js`) over the same rows, scalars and context
//      (`hostLaneWire.js`): values unchanged by construction, and railed byte for byte;
//   3. when they land the chart is told (`serverCompute.notifyColumnsLanded`, the runtime lane's own
//      signal), repaints, and the run-read parts are applied here, on its thread (`astLaneFinish`),
//      exactly as `astLaneColumns` applies them.
//
// ⭐⭐ STALE-WHILE-REVALIDATE. While a job is in flight the answer is PENDING (`isHostLanePending`):
// the columns this pane last drew for the SAME document, symbol, timeframe and settings
// (`paneSigOf`), re-aligned on bar TIME to the bars now asked for (a bar the old answer did not hold
// reads `NaN`), so a 6 s compute never blanks the pane on a poll; with no such answer (the first load,
// a symbol or timeframe switch) the pending answer holds NO column: the pane's loading state, never
// another symbol's or another timeframe's values. The binder never memoises a pending answer and
// keeps the instance's notices and drawings as they stand until the values land.
//
// ⭐⭐ A NEWER REQUEST SUPERSEDES AN OLDER ONE. One job in the worker at a time; at most ONE waiting
// job per pane (a newer one replaces it, and the replaced one is forgotten, never answered).
//
// ⭐⭐ AND A RUNNING ONE (docs/pine/evidence/2026-11-18-host-lane-worker-followups/EVIDENCE.md): when a
// pane asks again while its own job is in the worker, the running job stops at once and the newer
// one starts on a fresh worker; the stopped job is forgotten, never answered, never painted
// (`supersedeRunning`). ⛔ BY TERMINATING THE WORKER, NOT A CHECKPOINT: a worker computing a job
// cannot read a message until the job ends, so a cooperative stop needs a `SharedArrayBuffer` flag
// the evaluator polls, and the page is not cross-origin isolated (no COOP / COEP: measured on
// production, `crossOriginIsolated === false`), where no such buffer exists. A cancel is not a
// failure: it never counts toward `HOST_WORKER_MAX_STARTS`.
// ⭐ ONE EXCEPTION, THE PANE'S FIRST PICTURE: a running job whose answer the pane would draw while the
// newer one computes (the same document, settings, symbol and timeframe, and nothing of them drawn
// yet: the 600-bar first paint when the deep history arrives) is not thrown away. Its worker is
// RETIRED: it finishes that one job, its answer is drawn (re-aligned on bar time, as a poll's last
// picture is), and it is terminated; the newer job starts at once on a fresh worker beside it. At
// most one worker is retiring; a job that would need a second is stopped. An answer that lands after
// a NEWER job of its pane already landed is dropped (`_landedSeq`): a picture is only ever replaced by
// a newer one.
//
// ⭐⭐ ONE DOOR FOR EVERY CHART PANE'S HOST VALUES, WHICHEVER THREAD COMPUTES THEM
// (docs/pine/evidence/2026-11-19-host-lane-learned-route/EVIDENCE.md). Measured on production, a
// member's RDDT 1D -> 5m switch with Fred RS attached: 18 main-thread long tasks, 4.2 s, the worst 525 ms,
// against 7 / 1.6 s with no script. Two faults, multiplied:
//   · THE ROUTE. Only a document over #1711's estimate came here. The estimate counts recurrences, and
//     Fred RS's cost is window work (0 recurrence steps), so its 28,006-row values ran on the main thread.
//     A static window count was measured and cannot predict it (2026-11-18 evidence, section 3).
//   · THE REPETITION. The binder never memoises a host answer whose RUN HALF is in flight
//     (`binder.js`, `halfPending`), and the main-thread path kept no values of its own, so EVERY chart pass
//     while the run half waited (each secondary series landing, each runtime landing, the forming flag)
//     computed the whole values pass again.
// So every chart pane's host request now comes through `hostLaneColumns`:
//   1. ⭐ THE VALUES ARE MEMOISED, on either thread (`_memo`: per bars array, keyed on everything the
//      values read, the rows' own content revision included, `barsRevisionOf`): a pass that asks again
//      for the same values re-applies only the run-read parts (`astLaneFinish`), never the values.
//   2. ⭐ THE ROUTE IS LEARNED (`computesOnMain`): the main thread computes a document's values only when
//      THIS TAB has measured them cheap at this size (a predicted `HOST_MAIN_BUDGET_MS` or less), or, for a
//      document not measured yet, over a first paint's rows (`HOST_UNMEASURED_MAIN_ROWS`), where it is
//      measured. Every other request (a document over #1711's estimate, a document measured dear, a deep
//      history of one not measured yet) goes to the worker. The measurement is a clock (`learnCost`, the
//      main thread's own timing of the values, or the worker's `ms`), per tab, bounded
//      (`HOST_COST_MEMORY`), never persisted. ⛔ It picks only the THREAD: both threads run the same
//      function on the same arguments (`astColumnsGiven`), so no rate history can change a value (railed:
//      a cheap and a dear clock over the same documents answer byte-identical columns).
// ⛔ Every request that is not a chart's (`validateEventColumns`, the vendor harness, the coverage ratchets,
// the headless export, a probe) carries no `hostPane` and is answered by `astLaneColumns` exactly as before
// (this module answers `null`): nothing graded against a capture reaches this module.
//
// ⛔ A WORKER THAT CANNOT TAKE A JOB NEVER BLANKS A PANE:
//   · it cannot start, it crashed, a message could not be read, or the post was refused (a document
//     that does not clone): the job is computed on the MAIN thread, today's path, values unchanged;
//     after `HOST_WORKER_MAX_STARTS` workers this tab computes every host document there, as before;
//   · it did not answer within `HOST_WORKER_WATCHDOG_MS`: it is stopped and that job's columns are
//     refused BY NAME (`HOST_WORKER_UNRESPONSIVE_GUARD`), said on the member's strip
//     (`hostLaneStopOf`, read by the binder beside a stopped run's sentence). Not the main thread:
//     a job that outran the watchdog would freeze the page at least that long. The next bars array
//     tries a fresh worker.
//   · the compute itself threw (a document defect, a single-tree refusal): the same throw, on the
//     chart's thread, as `astColumnsFor` would have thrown it there.
import {
  astLanePlan, astLaneFinish, astRuntimeErrorStop, astSideRecordsOf, withAstSideRecords, astPlotKey,
  columnErrors, withColumnErrors, otherSymbolsFor, astColumnsGiven,
} from './astColumns.js'
import { lowerTfCodesOf } from './lowerTf.js'
import { hostLaneCostOf } from './hostLaneCost.js'
import { computesOnMain, learnCost, resetHostLaneRoute } from './hostLaneRoute.js'
import { notifyColumnsLanded } from './serverCompute.js'
import { FIRST_PAGE_ROWS, FIRST_PAGE_PROBE, FIRST_PAGE_POST_ROWS, widenFirstPage } from './firstPage.js'
import { packRows, ctxImageOf, answerFromImage, errorFromImage } from './hostLaneWire.js'

/** How long the worker may take to answer the job it holds before it is called unresponsive, in
 *  ms. Generous on purpose: the dearest host document measured costs 23.5 s at 5,000 bars in node on
 *  the dev PC (evidence section 4), and a member's machine may be several times slower; what this
 *  stops is a worker that will never answer, not a long compute. */
export const HOST_WORKER_WATCHDOG_MS = 180000
/** How many workers one tab may LOSE (a crash, an unreadable message, a watchdog stop) before it
 *  computes every host document on the main thread. ⛔ A worker stopped or retired because a newer
 *  request superseded its job is not lost (`supersedeRunning`). */
export const HOST_WORKER_MAX_STARTS = 3
/** How many documents the worker keeps (the chart's thread mirrors the order it evicts in). */
export const HOST_WORKER_DOCS = 32
/** How many pane pictures are kept for stale-while-revalidate (each holds one bars array). 32 since every
 *  chart pane's host answer is a picture (a document computed on the main thread too: its deep history may
 *  then go to the worker, and the first paint is what the pane keeps meanwhile). */
const STALE_PANES = 32

/** The guard a column carries when the worker held its job past the watchdog. */
export const HOST_WORKER_UNRESPONSIVE_GUARD = 'host-lane:worker-unresponsive'
/** Where a pending answer says so (non-enumerable, like every record on a column map). */
export const HOST_PENDING_KEY = '__hostLanePending'
/** The message a worker's throw is rebuilt with when it carried none (`runtime/errorImage.js`). */
const HOST_LANE_FAILED = 'the host lane failed'
/** Where a refused answer carries its strip sentence (non-enumerable). */
export const HOST_STOP_KEY = '__hostLaneStop'

/** The member's sentence (the house voice: what happened, what settles it), the way the runtime
 *  lane says its own (`runtimeAsync.js::unresponsive`). Registered namespace: `ast/guardIdText.js`. */
const unresponsiveSentence = () => 'the background worker that computes this script did not answer within '
  + `${HOST_WORKER_WATCHDOG_MS / 1000} s, so it was stopped and nothing is drawn rather than part of it. `
  + 'The chart is unaffected; its next update, or changing the symbol or timeframe, tries again.'

/** Is this answer a PENDING one: the values are being computed off the main thread, and its columns
 *  (if any) are the pane's last picture re-aligned on bar time? */
export function isHostLanePending(cols) {
  return !!(cols && cols[HOST_PENDING_KEY])
}

/** The strip sentence a refused host answer carries (`{guard, sentence}`), or null. */
export function hostLaneStopOf(cols) {
  return (cols && cols[HOST_STOP_KEY]) || null
}

// ─── state ────────────────────────────────────────────────────────────────────────────────────────
let _factory = null          // test seam: () => Worker-like
let _worker = null
let _starts = 0
let _lost = 0                // workers lost to a failure (the `HOST_WORKER_MAX_STARTS` budget)
let _broken = false
let _inFlight = null
let _retiring = null         // {worker, job, timer}: a superseded worker finishing its pane's first picture
let _nextId = 1
let _nextDoc = 1
let _nextSeq = 1             // the order jobs were asked in
const _landedSeq = new Map() // pane -> the newest job of it that landed (an older answer is dropped)
let _watchdog = null
const _queue = []            // jobs not yet posted, at most one per pane
const _workerDocs = new Map() // docId -> true, in the order the worker keeps them
let _docIds = new WeakMap()  // specialised document -> docId
let _memo = new WeakMap()    // bars array -> Map(key -> entry)
const _last = new Map()      // `${pane}\u0001${sig}` -> the pane's latest picture
let _realigned = new WeakMap() // picture columns -> {rows, answer}
let _costs = new WeakMap()   // specialised document -> hostLaneCostOf
const _stats = { posted: 0, landed: 0, superseded: 0, cancelled: 0, retired: 0, dropped: 0, toMain: 0, refused: 0,
  starts: 0, lost: 0, workerMs: 0, mainComputed: 0, memoHits: 0, lastFallback: null, firstPages: 0, firstPageFailed: 0, firstPageDiscarded: 0 }

const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())

/** What this tab's host worker has done (diagnostics, the probe and the rails). */
export function hostLaneStats() {
  return { ..._stats, broken: _broken, inFlight: !!_inFlight, retiring: !!_retiring, queued: _queue.length,
    docs: _workerDocs.size }
}

/** Test seam (the byte-equality rail only): send EVERY host document a chart asks for to the
 *  worker, cheap ones included, so the rail compares both threads over the whole corpus. */
let _routeAll = false
export function __routeEveryHostDocumentForTests(on) { _routeAll = on === true }

/** Test seam: the worker factory (`null` = the browser's own worker, where there is one). */
export function setHostLaneWorkerFactory(fn) {
  _factory = typeof fn === 'function' ? fn : null
}

/** Test seam: forget the worker, the jobs, the memo and the pictures. */
export function resetHostLaneAsync() {
  disarm()
  if (_worker) { stopWorker(_worker) }
  _worker = null
  if (_retiring) { clearTimeout(_retiring.timer); stopWorker(_retiring.worker) }
  _retiring = null
  _starts = 0
  _lost = 0
  _broken = false
  _inFlight = null
  _nextSeq = 1
  _landedSeq.clear()
  _queue.length = 0
  _workerDocs.clear()
  _docIds = new WeakMap()
  _memo = new WeakMap()
  _last.clear()
  _realigned = new WeakMap()
  _costs = new WeakMap()
  _objServed.clear()
  _routeAll = false
  resetHostLaneRoute()
  for (const k of Object.keys(_stats)) _stats[k] = k === 'lastFallback' ? null : 0
}

const browserCanWork = () => typeof Worker === 'function' && typeof window !== 'undefined'
const defaultFactory = () => new Worker(new URL('./hostLaneWorker.js', import.meta.url), { type: 'module' })

/** ⭐ THE ESTIMATE'S HALF OF THE ROUTE: is this (specialised) document over #1711's estimate
 *  (`hostLaneCostOf(def).over`, no clock, memoised per document)? Such a document always computes off the
 *  main thread; any other goes where this tab's measurements say (`hostLaneRoute.computesOnMain`). */
export function hostLaneRunsOffThread(def) {
  let c = _costs.get(def)
  if (!c) { c = hostLaneCostOf(def); if (def && typeof def === 'object') _costs.set(def, c) }
  return c.over === true
}

function docIdOf(def) {
  let id = _docIds.get(def)
  if (!id) { id = _nextDoc++; _docIds.set(def, id) }
  return id
}

/** The PANE SIGNATURE a stale picture must match: the same document (and settings) on the same
 *  symbol and timeframe. ⛔ Not the bars, not the listing statement, not whether the newest bar is
 *  forming: those change under one pane (a poll, the deep history) and the last picture is still
 *  this pane's. A symbol or timeframe switch changes it, so no other symbol's values are drawn. */
function paneSigOf(docId, plan, ctx) {
  const c = ctx || {}
  const s = c.symbol && typeof c.symbol === 'object' ? `${c.symbol.ticker}@${c.symbol.exchange}` : '-'
  return JSON.stringify([docId, plan.scalars, c.sym ?? null, s, c.tf ?? null, c.framed === true])
}

/** A per-object serial, for a job key that names an array or an entry by identity. */
let _serial = 1
const _serials = new WeakMap()
function serialOf(o) {
  if (!o || typeof o !== 'object') return 0
  let s = _serials.get(o)
  if (!s) { s = _serial++; _serials.set(o, s) }
  return s
}

/** ⭐ WHAT THE VALUES' OWN DECISIONS ASK OF THE CONTEXT, recorded on this thread: the other-symbol
 *  entries and `exchangeOf`'s answers (`otherSymbolsFor`, the decision `astColumnsFor` takes, which
 *  reads no bars), and the intraday entries of a document that reads below the chart (every entry:
 *  the lower-timeframe decision builds its supply, so it is not run twice). The worker is handed
 *  exactly these, so it asks the same questions and gets the same answers. */
function askedOf(def, ctx) {
  const c = ctx || {}
  const asked = { secondary: new Set(), lowerTf: new Set(), exchange: new Map() }
  const rec = { ...c }
  if (c.secondary && typeof c.secondary.get === 'function') {
    rec.secondary = { get: (k) => { asked.secondary.add(k); return c.secondary.get(k) } }
  }
  if (typeof c.exchangeOf === 'function') {
    rec.exchangeOf = (k) => { const v = c.exchangeOf(k); asked.exchange.set(k, v); return v }
  }
  otherSymbolsFor(def, rec)
  if (lowerTfCodesOf(def).length && c.lowerTf && typeof c.lowerTf.keys === 'function') {
    for (const k of c.lowerTf.keys()) asked.lowerTf.add(k)
  }
  return asked
}

// ─── ⭐⭐ THE ROWS' OWN REVISION ─────────────────────────────────────────────────────────────────────
//
// The memo is held per bars ARRAY (a `WeakMap`: it dies with the array), and an array is the same object
// whatever it holds. Measured before this was written (the evidence, section 3): no path in this app changes
// a bars array or a bar in place (the bar store freezes both, `data/barStore/reducer.js`; the chart's bar
// hooks and session filters build new arrays; the six live writers write the renderer's series, never the
// array; a secondary's tail lands as a new entry). ⛔ But a memo that only that audit keeps honest is one edit
// away from drawing a stale picture, so the key also carries the rows' CONTENT: every bar's time, open, high,
// low, close and volume (the fields the values read), hashed into 64 bits. A forming bar that moved, a bar
// appended, a historical bar corrected: each is another key, and the values are computed again (railed, in
// place, on the same array). Measured: well under a millisecond for 28,800 rows (the evidence).
const _revF64 = new Float64Array(1)
const _revU32 = new Uint32Array(_revF64.buffer)

/** A 64-bit hash of every bar's `t`, `o`, `h`, `l`, `c`, `v` (and the row count), as a string. */
export function barsRevisionOf(rows) {
  if (!Array.isArray(rows)) return '-'
  let a = 0x811c9dc5 ^ rows.length
  let b = 0x9e3779b9 ^ rows.length
  const num = (x) => {
    if (typeof x === 'number') {
      _revF64[0] = x
      a = Math.imul(a ^ _revU32[0], 0x01000193)
      b = Math.imul(b ^ _revU32[1], 0x5bd1e995)
    } else if (typeof x === 'string') {
      for (let k = 0; k < x.length; k += 1) a = Math.imul(a ^ x.charCodeAt(k), 0x01000193)
      b = Math.imul(b ^ (x.length + 0x51ed27), 0x5bd1e995)
    } else {
      // null, undefined, anything else: a tag of its own, never the number it would coerce to
      a = Math.imul(a ^ (x === null ? 0x6a09e667 : 0x3c6ef372), 0x01000193)
      b = Math.imul(b ^ 0x2545f491, 0x5bd1e995)
    }
  }
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]
    if (!r || typeof r !== 'object') { num(undefined); continue }
    num(r.t); num(r.o); num(r.h); num(r.l); num(r.c); num(r.v)
  }
  return `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}.${rows.length}`
}

/** Everything the values read beyond the bars array, as one key (the bars' own revision included). */
function jobKeyOf(docId, plan, asked) {
  const c = plan.valueCtx || {}
  // each as the values read it: `tf` as given, the tri-state `newestBarIsForming ?? null`, and the
  // three statements only when `=== true` / truthy (`historyFromListingFor`, `barIndexAbsoluteFor`,
  // `!!ctx.framed`), so an absent statement and a `false` one are one job
  const plain = [c.tf ?? null, c.newestBarIsForming ?? null, c.historyFromListing === true,
    c.barIndexFromFirstBar === true, !!c.framed]
  const sym = c.symbol && typeof c.symbol === 'object' ? JSON.stringify(c.symbol) : null
  const entry = (map, k) => {
    const e = map && typeof map.get === 'function' ? map.get(k) : undefined
    return [k, e ? serialOf(e) : 0, e ? serialOf(e.bars) : 0, e && e.status != null ? String(e.status) : null,
      e && Array.isArray(e.bars) ? barsRevisionOf(e.bars) : null, e ? (e.newestBarIsForming ?? null) : null]
  }
  return JSON.stringify([docId, plan.scalars, plain, sym,
    [...asked.secondary].map((k) => entry(c.secondary, k)),
    [...asked.lowerTf].map((k) => entry(c.lowerTf, k)),
    [...asked.exchange], barsRevisionOf(plan.rows)])
}

// ─── the stale picture ──────────────────────────────────────────────────────────────────────────────

function rememberPicture(pane, sig, picture) {
  const k = `${pane}\u0001${sig}`
  _last.delete(k)
  _last.set(k, picture)
  while (_last.size > STALE_PANES) _last.delete(_last.keys().next().value)
}

/** The pane's last picture, finished (`astLaneFinish`) if it landed but was never served. */
function pictureOf(pane, sig) {
  const p = _last.get(`${pane}\u0001${sig}`)
  if (!p) return null
  if (!p.cols) {
    try {
      p.cols = astLaneFinish(p.plan, copyOut(p.out), p.inputs, p.ctx, p.extras)
    } catch { return null }
    // finished once: the plan, the context and the raw values are not held any longer
    p.out = p.plan = p.inputs = p.ctx = p.extras = null
  }
  return p
}

/** A values map's container copied (same columns, same records), so the run-read parts never
 *  touch the map the memo holds. */
function copyOut(out) {
  const res = {}
  for (const k of Object.keys(out)) res[k] = out[k]
  return withAstSideRecords(res, astSideRecordsOf(out))
}

/** ⭐ `cols` (computed over `fromRows`) re-aligned on bar TIME to `toRows`: a bar both hold keeps its
 *  value, a bar the old answer did not hold reads `NaN`. Its column reasons are carried. */
export function realignOnTime(cols, fromRows, toRows) {
  const at = new Map()
  for (let i = 0; i < fromRows.length; i += 1) at.set(fromRows[i] && fromRows[i].t, i)
  const n = toRows.length
  const idx = new Int32Array(n)
  for (let j = 0; j < n; j += 1) {
    const i = at.get(toRows[j] && toRows[j].t)
    idx[j] = i === undefined ? -1 : i
  }
  const out = {}
  for (const k of Object.keys(cols)) {
    const col = cols[k]
    if (!col || typeof col.length !== 'number' || col.length !== fromRows.length) continue
    // a value column is a `Float64Array` (or a plain array once widened): `NaN` must be holdable
    const next = col instanceof Float64Array ? new Float64Array(n) : new Array(n)
    for (let j = 0; j < n; j += 1) next[j] = idx[j] >= 0 ? col[idx[j]] : NaN
    out[k] = next
  }
  const errs = columnErrors(cols)
  return Object.keys(errs).length ? withColumnErrors(out, { ...errs }) : out
}

const PENDING_EMPTY = Object.freeze({ stale: false })
const PENDING_STALE = Object.freeze({ stale: true })

function pendingAnswer(pane, sig, rows) {
  const p = pictureOf(pane, sig)
  if (!p || !p.cols) {
    const out = {}
    Object.defineProperty(out, HOST_PENDING_KEY, { value: PENDING_EMPTY, enumerable: false })
    return out
  }
  const hit = _realigned.get(p.cols)
  if (hit && hit.rows === rows) return hit.answer
  const out = p.rows === rows ? copyOut(p.cols) : realignOnTime(p.cols, p.rows, rows)
  Object.defineProperty(out, HOST_PENDING_KEY, { value: PENDING_STALE, enumerable: false })
  _realigned.set(p.cols, { rows, answer: out })
  return out
}

function refusedAnswer(plan, guard, sentence) {
  const errors = {}
  for (const key of astPlotKey(plan.def)) errors[key] = { guard, message: sentence }
  const out = withColumnErrors({}, errors)
  Object.defineProperty(out, HOST_STOP_KEY, { value: Object.freeze({ guard, sentence }), enumerable: false })
  return out
}

// ─── the door ────────────────────────────────────────────────────────────────────────────────────────

/** The timeframe a plan's values are computed on (a framed instance's is its frame's). */
const tfOf = (plan, ctx) => {
  const c = plan.valueCtx || ctx || {}
  return c.tf ?? (ctx && ctx.tf)
}

/** Is there a worker to send a job to (or one that can be started)? */
const workerUsable = () => !_broken && !!(_factory || browserCanWork())

/**
 * ⭐⭐ THE VALUES ON THIS THREAD: `astLaneColumns`' own sequence (the plan made, the `runtime.error` stop
 * decided, `astColumnsGiven` over the plan's rows, scalars and context, `astLaneFinish`), with the values
 * memoised for these bars (`per`, `key`) and their cost learned (`hostLaneRoute.learnCost`). The run-read parts
 * are applied to a copy of the container (`copyOut`), so the memo's values are never the map they write to: the
 * same rule the worker's landed values follow, railed byte-equal to `astLaneColumns` over the corpus.
 * ⛔ A THROW is remembered as thrown, for these bars and this key (the same arguments throw again), and thrown.
 */
function answerOnMain(plan, per, key, stop, pane, sig, docId, inputs, ctx, extras) {
  const t0 = clock()
  let out
  try {
    out = astColumnsGiven(plan.def, plan.valueRows, plan.scalars, plan.valueCtx, stop)
  } catch (err) {
    per.set(key, { state: 'threw', error: err })
    throw err
  }
  learnCost(docId, tfOf(plan, ctx), plan.valueRows.length, clock() - t0)
  _stats.mainComputed += 1
  per.set(key, { state: 'done', out })
  const cols = astLaneFinish(plan, copyOut(out), inputs, ctx, extras)
  rememberPicture(pane, sig, { rows: plan.rows, cols })
  return cols
}

// ─── ⭐⭐ THE FIRST PAGE (`firstPage.js`; coordinator-approved first-draw unit, 2026-11-23) ───────────────────────────
//
// A cold pane (no picture of its signature yet) whose full job goes to the worker is sent a SECOND, small job FIRST:
// kind 'firstPage', the newest `FIRST_PAGE_POST_ROWS` rows, posted on its own queue tag (`<pane>\u0003first`) so the
// queue keeps both and the full job never supersedes it. ⛔⛔ The page's two computes run IN THE WORKER; this thread
// only widens the window that lands (`widenFirstPage`) and stores it as the pane's picture, so `pendingAnswer` draws it
// and the full answer replaces it. ⛔ A page that lands AFTER its full answer (or after any picture of its signature)
// is DISCARDED, never painted over it.
export { FIRST_PAGE_ROWS, FIRST_PAGE_PROBE, FIRST_PAGE_CODE } from './firstPage.js'
let _firstPageOn = true
/** Test seam / kill switch: turn the first page off (the pane is blank until the full answer, as before). */
export function setFirstPageEnabled(on) { _firstPageOn = on !== false }

/** The page job for a cold pane's full `job`, or null when there is none to make: switched off, a calc_bars_count
 *  window or a framed instance (its values are not the chart's rows), or a chart too short to need one. */
function firstPageJobOf(job) {
  const plan = job.plan
  if (!_firstPageOn || plan.win || plan.valueRows !== plan.rows) return null
  const n = plan.rows.length
  if (n < 2 * FIRST_PAGE_ROWS + FIRST_PAGE_PROBE) return null
  return { kind: 'firstPage', pane: `${job.pane}\u0003first`, realPane: job.pane, sig: job.sig, key: job.key, per: new Map(),
    fullKey: job.key, plan, asked: job.asked, stop: job.stop, docId: job.docId, rows: plan.rows,
    sendDef: plan.def, postRows: plan.rows.slice(n - FIRST_PAGE_POST_ROWS), postCtx: plan.valueCtx }
}

/** A landed page: widened and stored as its pane's picture, unless that pane already holds a picture of its
 *  signature or its full answer has settled (then it is dropped: the full picture is never painted over). */
function settleFirstPage(job, reply) {
  if (!reply.ok) { _stats.firstPageFailed += 1; return }
  // ONE guard: the pane already holds a picture of this signature (its full answer, which `rememberPicture` stored when it
  // landed, or an earlier page): the page is dropped
  if (_last.has(`${job.realPane}\u0001${job.sig}`)) { _stats.firstPageDiscarded += 1; return }
  const cols = widenFirstPage(reply.page, job.rows.length)
  if (!cols) return
  rememberPicture(job.realPane, job.sig, { rows: job.rows, cols })
  _stats.firstPages += 1
  notifyColumnsLanded(`host:${job.fullKey}`)
}

/**
 * ⭐⭐ A CHART PANE'S HOST ANSWER (see the header): the values memoised for these bars, computed on the main
 * thread when this tab has measured them cheap here (`hostLaneRoute.computesOnMain`), in the worker otherwise
 * (pending meanwhile: the pane's last picture, or none after a switch). `null` for a request that is not a
 * chart pane's: the caller computes it with `astLaneColumns` exactly as before.
 * @param {object} def    an `ast` document
 * @param {object[]} bars the bars (`calcBars`)
 * @param {object} inputs the instance's inputs
 * @param {object} ctx    `computeFor`'s context; `ctx.hostPane` names the chart pane asking
 * @param {Function} extras the run-read parts (`nativeRegistry.astRunExtras`)
 */
export function hostLaneColumns(def, bars, inputs, ctx, extras) {
  if (!ctx || typeof ctx.hostPane !== 'string' || !ctx.hostPane) return null
  const plan = astLanePlan(def, bars, inputs, ctx)
  if (plan.done) return plan.done
  const pane = ctx.hostPane
  const docId = docIdOf(plan.def)
  const sig = paneSigOf(docId, plan, ctx)
  const asked = askedOf(plan.def, plan.valueCtx)
  const key = jobKeyOf(docId, plan, asked)
  let per = _memo.get(plan.rows)
  if (!per) { per = new Map(); _memo.set(plan.rows, per) }
  const hit = per.get(key)
  if (hit) {
    if (hit.state === 'done') {
      _stats.memoHits += 1
      const cols = astLaneFinish(plan, copyOut(hit.out), inputs, ctx, extras)
      rememberPicture(pane, sig, { rows: plan.rows, cols })
      return cols
    }
    if (hit.state === 'failed') throw errorFromImage(hit.error, HOST_LANE_FAILED)
    if (hit.state === 'threw') throw hit.error
    if (hit.state === 'main') return answerOnMain(plan, per, key, hit.stop ?? null, pane, sig, docId, inputs, ctx, extras)
    if (hit.state === 'refused') return refusedAnswer(plan, hit.guard, hit.sentence)
    return pendingAnswer(pane, sig, plan.rows)
  }
  const stop = astRuntimeErrorStop(plan.def, plan.valueRows, plan.scalars, plan.valueCtx)
  // ⭐⭐ THE ROUTE: a document over #1711's estimate always goes to the worker; any other, to the worker unless
  // this tab measured it cheap here (`computesOnMain`); with no worker, the main thread, as before
  const offThread = workerUsable() && (_routeAll || hostLaneRunsOffThread(plan.def)
    || !computesOnMain(docId, tfOf(plan, ctx), plan.valueRows.length))
  if (!offThread) return answerOnMain(plan, per, key, stop, pane, sig, docId, inputs, ctx, extras)
  const job = { kind: 'values', pane, sig, key, per, plan, inputs, ctx, extras, asked, stop, docId,
    rows: plan.rows, sendDef: plan.def, postRows: plan.valueRows, postCtx: plan.valueCtx }
  per.set(key, { state: 'pending', job })
  // ⭐⭐ THE FIRST PAGE: no picture of this pane yet (a cold timeframe or symbol): a small page job goes to the worker
  // AHEAD of the full one, and its exact plots are drawn when it lands; the full answer replaces them
  const page = pictureOf(pane, sig) ? null : firstPageJobOf(job)
  if (page) submit(page)
  submit(job)
  // ⛔ a job the worker could not take at once (no worker could be started, the post was refused)
  // is computed NOW on this thread, today's path, never left pending
  const now = per.get(key)
  if (now && now.state === 'main') return answerOnMain(plan, per, key, stop, pane, sig, docId, inputs, ctx, extras)
  return pendingAnswer(pane, sig, plan.rows)
}

// ─── ⭐⭐ the host OBJECT program (drawings) ─────────────────────────────────────────────────────────
//
// The binder evaluated every host object program on the main thread on EVERY sync
// (`binder.syncObjects` -> `hostObjectRun`), whatever changed: measured over the corpus (evidence
// section 4), 29 of the 41 committed host object programs cost a long task or more on 5,000 daily
// bars, up to 2.0 s (market-structure-by-leviathan) and 4.0 s from the listing
// (high-low-open-mid-ranges), with values that cost a few ms; #1711's estimate reads 0 recurrence
// steps for several of them (their cost is the object program's own evaluation), so it cannot route
// them. So for a CHART's request every host object program is evaluated in the worker with the same
// code (`hostObjects.js::hostObjectRun`), memoised per bars array: a repaint with the same bars costs
// nothing, a new bars array is one job. While it is in flight the binder keeps the layer it drew for
// the SAME pane signature (stale-while-revalidate, drawings are placed by bar time) and clears it
// for another (a symbol or timeframe switch). Not sent, evaluated on the main thread as before:
// a program whose values come from the runtime lane's VM (C18 placeholders, `objects.runtime`,
// registered on the main thread only), and every request that is not a chart's.
const _objServed = new Map()   // objects pane -> the signature of the picture last handed to it

/** Can this document's drawings be evaluated in the worker? */
export function hostObjectsSendable(def) {
  const o = def && def.objects
  return !!(def && def.compute && def.compute.kind === 'ast' && o && Array.isArray(o.ops) && o.ops.length && !o.runtime)
}

const plainInputs = (inputs) => (inputs && typeof inputs === 'object'
  ? Object.keys(inputs).sort().map((k) => [k, inputs[k] === undefined ? null : inputs[k]]) : null)

function objectsSigOf(docId, inputs, opts) {
  const o = opts || {}
  const s = o.symbol && typeof o.symbol === 'object' ? `${o.symbol.ticker}@${o.symbol.exchange}` : '-'
  return JSON.stringify([docId, plainInputs(inputs), s, o.tf ?? null])
}

function objectsKeyOf(docId, inputs, opts, asked, bars) {
  const o = opts || {}
  const entry = (map, k) => {
    const e = map && typeof map.get === 'function' ? map.get(k) : undefined
    return [k, e ? serialOf(e) : 0, e ? serialOf(e.bars) : 0, e && e.status != null ? String(e.status) : null,
      e && Array.isArray(e.bars) ? barsRevisionOf(e.bars) : null, e ? (e.newestBarIsForming ?? null) : null]
  }
  return JSON.stringify(['objects', docId, plainInputs(inputs), o.tf ?? null, o.newestBarIsForming ?? null,
    o.historyFromListing === true, o.barIndexFromFirstBar === true,
    o.symbol && typeof o.symbol === 'object' ? JSON.stringify(o.symbol) : null,
    [...asked.secondary].map((k) => entry(o.secondary, k)),
    [...asked.lowerTf].map((k) => entry(o.lowerTf, k)),
    [...asked.exchange],
    // ⭐ the rows' own revision, as the values' key carries it (`barsRevisionOf`)
    barsRevisionOf(bars)])
}

/**
 * A host document's drawings for a chart pane, off the main thread:
 *   `{done: true, host}`    the evaluated program (`hostObjectRun`'s `{reader, run}`, or null: nothing
 *                           to draw), memoised for these bars;
 *   `{pending: true, keep}` in the worker: `keep` says the layer on screen is this pane's own last
 *                           picture (same document, settings, symbol and timeframe), so it stays;
 *   `{refused: sentence}`   the worker held the job past its watchdog (nothing drawn, said);
 *   `null`                  the caller evaluates it on the main thread, as before.
 * A failed evaluation throws, as `hostObjectRun` would have.
 */
export function hostObjectsOffThread(def, bars, readerOpts, pane) {
  if (typeof pane !== 'string' || !pane) return null
  if (_broken || !(_factory || browserCanWork())) return null
  if (!hostObjectsSendable(def) || !Array.isArray(bars)) return null
  const opane = `${pane}\u0002objects`
  const docId = docIdOf(def)
  const inputs = readerOpts ? readerOpts.inputs : undefined
  const sig = objectsSigOf(docId, inputs, readerOpts)
  const asked = askedOf(def, readerOpts)
  const key = objectsKeyOf(docId, inputs, readerOpts, asked, bars)
  let per = _memo.get(bars)
  if (!per) { per = new Map(); _memo.set(bars, per) }
  const hit = per.get(key)
  const served = (answer) => { _objServed.set(opane, sig); return answer }
  if (hit) {
    if (hit.state === 'done') return served({ done: true, host: hit.host })
    if (hit.state === 'failed') throw errorFromImage(hit.error, HOST_LANE_FAILED)
    if (hit.state === 'main') return served(null)
    if (hit.state === 'refused') return served({ refused: hit.sentence })
    return objectsPending(opane, sig)
  }
  const job = { kind: 'objects', pane: opane, sig, key, per, docId, rows: bars, asked, inputs,
    sendDef: def, postRows: bars, postCtx: readerOpts }
  per.set(key, { state: 'pending', job })
  submit(job)
  const now = per.get(key)
  if (now && now.state === 'main') return served(null)
  return objectsPending(opane, sig)
}

/** ⭐ THE ONE RULE for a pending drawing: the layer on screen stays only when the picture last handed
 *  to this pane has this pane signature (same document, settings, symbol, timeframe). */
function objectsPending(opane, sig) {
  return { pending: true, keep: _objServed.get(opane) === sig }
}

// ─── the queue and the worker ──────────────────────────────────────────────────────────────────────

function submit(job) {
  job.seq = _nextSeq++
  const at = _queue.findIndex((j) => j.pane === job.pane)
  if (at >= 0) {
    // ⛔ SUPERSEDED BEFORE IT WAS POSTED: never answered, and its memo entry is forgotten, so the
    // same bars asked again later are a new job rather than a pending answer forever.
    forget(_queue[at])
    _stats.superseded += 1
    _queue[at] = job
  } else {
    _queue.push(job)
  }
  supersedeRunning(job)
  pump()
}

/** ⭐ Would `older`'s answer be drawn while `newer` computes? Only as the pane's FIRST picture of
 *  `newer`'s signature (the same document, settings, symbol and timeframe, nothing of it drawn yet):
 *  the values' stale picture (`pictureOf`) and the drawings' kept layer (`objectsPending`) are each
 *  the last answer of that signature, so with one already there `older` would only replace a
 *  picture `newer` replaces in turn, and with another signature it is never drawn at all. */
function paintsWhileNewerComputes(older, newer) {
  if (older.pane !== newer.pane || older.sig !== newer.sig) return false
  if (older.kind === 'objects') return _objServed.get(older.pane) !== older.sig
  return !_last.has(`${older.pane}\u0001${older.sig}`)
}

/** ⭐⭐ A NEWER REQUEST OF A PANE STOPS THAT PANE'S RUNNING JOB (see the header): terminated at once
 *  and forgotten, or, when its answer is the pane's first picture, its worker retired (it finishes that
 *  one job, is drawn, and is terminated), so the newer job starts now on a fresh worker either way. */
function supersedeRunning(newer) {
  if (_retiring && _retiring.job.pane === newer.pane && !paintsWhileNewerComputes(_retiring.job, newer)) {
    stopRetiring()
  }
  const run = _inFlight
  if (!run || run.pane !== newer.pane || run.kind === 'firstPage') return
  if (!_retiring && paintsWhileNewerComputes(run, newer)) retireRunning()
  else cancelRunning()
}

/** A worker that will not be asked anything again: its doors closed, then terminated. */
function stopWorker(w) {
  if (!w) return
  w.onmessage = null
  w.onerror = null
  w.onmessageerror = null
  try { w.terminate() } catch { /* already gone */ }
}

/** ⛔ The running job, superseded: its worker is terminated (it cannot be told to stop: see the
 *  header) and the job forgotten (never answered, never painted). The documents that worker held go
 *  with it: the fresh worker starts holding none (`workerOf`). Not a failure. */
function cancelRunning() {
  const job = _inFlight
  disarm()
  _inFlight = null
  stopWorker(_worker)
  _worker = null
  if (job) forget(job)
  _stats.cancelled += 1
}

/** ⭐ The running job is the pane's first picture: its worker finishes it on its own, beside the
 *  fresh worker the newer job starts on, and is terminated when it answers (or fails, or outruns the
 *  watchdog: then the job is forgotten and the newer one draws). */
function retireRunning() {
  const job = _inFlight
  const worker = _worker
  disarm()
  _inFlight = null
  _worker = null
  const r = { worker, job, timer: null }
  r.timer = setTimeout(() => { if (_retiring === r) stopRetiring() }, HOST_WORKER_WATCHDOG_MS)
  worker.onmessage = (event) => { if (_retiring === r) retiredLanded(event && event.data) }
  worker.onerror = () => { if (_retiring === r) stopRetiring() }
  worker.onmessageerror = () => { if (_retiring === r) stopRetiring() }
  _retiring = r
  _stats.retired += 1
}

/** The retiring worker's job, stopped unanswered (superseded after all, failed, or past the watchdog). */
function stopRetiring() {
  const r = _retiring
  if (!r) return
  _retiring = null
  clearTimeout(r.timer)
  stopWorker(r.worker)
  forget(r.job)
  _stats.cancelled += 1
}

function retiredLanded(reply) {
  const r = _retiring
  if (!r || !reply || reply.id !== r.job.id) return
  _retiring = null
  clearTimeout(r.timer)
  stopWorker(r.worker)
  // a retiring worker is never handed a document again: one it no longer holds is not resent
  if (reply.missing) { forget(r.job); _stats.cancelled += 1; return }
  settleLanded(r.job, reply)
}

function forget(job) {
  const e = job.per.get(job.key)
  if (e && e.job === job) job.per.delete(job.key)
}

function settleEntry(job, entry) {
  const e = job.per.get(job.key)
  if (e && e.job === job) job.per.set(job.key, entry)
}

function pump() {
  if (_inFlight || !_queue.length) return
  post(_queue.shift())
}

/** ⛔ The worker could not take this job: today's path computes it, on the main thread. */
function toMain(job, why) {
  if (job.kind === 'firstPage') { _stats.firstPageFailed += 1; return }
  // a values job keeps the `runtime.error` stop it was asked with: the main thread computes the same job
  settleEntry(job, job.kind === 'values' ? { state: 'main', stop: job.stop ?? null } : { state: 'main' })
  _stats.toMain += 1
  _stats.lastFallback = why
  notifyColumnsLanded(`host:${job.key}`)
}

function disarm() {
  if (_watchdog !== null) { clearTimeout(_watchdog); _watchdog = null }
}

function arm() {
  disarm()
  _watchdog = setTimeout(() => { _watchdog = null; killWorker('unresponsive') }, HOST_WORKER_WATCHDOG_MS)
}

function killWorker(kind) {
  disarm()
  const job = _inFlight
  _inFlight = null
  stopWorker(_worker)
  _worker = null
  _workerDocs.clear()
  // ⛔ LOST, not superseded: only a failure counts toward the budget (a cancel never comes here)
  _lost += 1
  _stats.lost = _lost
  if (_lost >= HOST_WORKER_MAX_STARTS) _broken = true
  if (job && job.kind === 'firstPage') {
    _stats.firstPageFailed += 1
  } else if (job) {
    if (kind === 'unresponsive') {
      settleEntry(job, { state: 'refused', guard: HOST_WORKER_UNRESPONSIVE_GUARD, sentence: unresponsiveSentence() })
      _stats.refused += 1
      _stats.lastFallback = kind
      notifyColumnsLanded(`host:${job.key}`)
    } else {
      toMain(job, kind)
    }
  }
  // the jobs still waiting were not the problem: a fresh worker takes them, or (no more workers)
  // the main thread does
  if (_broken) {
    const waiting = _queue.splice(0)
    for (const j of waiting) toMain(j, `${kind}:worker-retired`)
  } else {
    pump()
  }
}

function workerOf() {
  if (_worker) return _worker
  if (_broken) return null
  _starts += 1
  _stats.starts = _starts
  try {
    _worker = (_factory || defaultFactory)()
  } catch {
    _worker = null
    _broken = true
    return null
  }
  _workerDocs.clear()
  _worker.onmessage = (event) => landed(event && event.data)
  _worker.onerror = () => killWorker('crashed')
  _worker.onmessageerror = () => killWorker('message-unreadable')
  return _worker
}

function post(job) {
  const w = workerOf()
  if (!w) { toMain(job, 'worker-unavailable'); pump(); return }
  const id = _nextId++
  let msg
  let transfer
  try {
    const rows = packRows(job.postRows)
    const ctx = ctxImageOf(job.postCtx, job.asked)
    msg = { id, kind: job.kind, docId: job.docId, rows: rows.pack, ctx: ctx.image,
      ...(job.kind === 'objects' ? { inputs: job.inputs } : { scalars: job.plan.scalars, stop: job.stop }) }
    transfer = [...rows.transfer, ...ctx.transfer]
  } catch {
    toMain(job, 'pack-failed'); pump(); return
  }
  let sentDoc = false
  if (_workerDocs.has(job.docId)) {
    _workerDocs.delete(job.docId)
    _workerDocs.set(job.docId, true)
  } else {
    msg.def = job.sendDef
    sentDoc = true
    _workerDocs.set(job.docId, true)
    if (_workerDocs.size > HOST_WORKER_DOCS) {
      const old = _workerDocs.keys().next().value
      _workerDocs.delete(old)
      msg.evict = [old]
    }
  }
  job.id = id
  job.startedAt = clock()
  job.worker = _starts   // which worker took it (the probe's timeline: a fresh one after a cancel)
  _inFlight = job
  try {
    w.postMessage(msg, transfer)
  } catch {
    // ⛔ a document that does not clone (or a refused post): today's path, and the worker is told
    // nothing it did not receive
    _inFlight = null
    if (sentDoc) _workerDocs.delete(job.docId)
    toMain(job, 'post-refused')
    pump()
    return
  }
  _stats.posted += 1
  arm()
}

function landed(reply) {
  const job = _inFlight
  if (!job || !reply || reply.id !== job.id) return
  _inFlight = null
  disarm()
  if (reply.missing) {
    // the worker no longer holds the document: send it again, first (unless a newer job of its
    // pane is already waiting, which supersedes it)
    _workerDocs.delete(job.docId)
    if (_queue.some((j) => j.pane === job.pane)) { forget(job); _stats.superseded += 1 } else _queue.unshift(job)
    pump()
    return
  }
  settleLanded(job, reply)
  pump()
}

/** One landed answer, from the current worker or a retiring one: settled in the memo, the pane's
 *  picture taken, a timeline entry, and the chart told. ⛔ An answer whose pane already drew a NEWER
 *  job's is dropped (only a retiring worker can answer that late): never settled, never drawn. */
function settleLanded(job, reply) {
  if (job.kind === 'firstPage') { settleFirstPage(job, reply); return }
  const newest = _landedSeq.get(job.pane)
  if (Number.isFinite(newest) && newest > job.seq) {
    forget(job)
    _stats.dropped += 1
    return
  }
  _landedSeq.delete(job.pane)
  _landedSeq.set(job.pane, job.seq)
  while (_landedSeq.size > 4 * STALE_PANES) _landedSeq.delete(_landedSeq.keys().next().value)
  _stats.landed += 1
  if (Number.isFinite(reply.ms)) _stats.workerMs += reply.ms
  if (reply.ok && job.kind === 'objects') {
    settleEntry(job, { state: 'done', host: reply.objects || null })
  } else if (reply.ok) {
    const out = answerFromImage(reply.answer, withAstSideRecords)
    // ⭐ the worker's own timing of the same function teaches the route, as the main thread's does
    learnCost(job.docId, tfOf(job.plan, job.ctx), job.postRows.length, reply.ms)
    settleEntry(job, { state: 'done', out })
    rememberPicture(job.pane, job.sig, { rows: job.rows, out, plan: job.plan, inputs: job.inputs, ctx: job.ctx, extras: job.extras, cols: null })
  } else {
    settleEntry(job, { state: 'failed', error: reply.error })
  }
  try {
    if (typeof performance !== 'undefined' && typeof performance.measure === 'function') {
      // one timeline entry per landed job (the probe reads them), never an unbounded buffer
      if (_stats.landed % 200 === 0 && typeof performance.clearMeasures === 'function') performance.clearMeasures('host-lane:worker-run')
      performance.measure('host-lane:worker-run', { start: job.startedAt, end: clock(), detail: { kind: job.kind, workerMs: reply.ms, ok: !!reply.ok, bars: job.postRows.length, worker: job.worker } })
    }
  } catch { /* a timeline entry is a diagnostic, never a failure */ }
  notifyColumnsLanded(`host:${job.key}`)
}
