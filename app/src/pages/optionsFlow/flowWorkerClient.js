/**
 * flowWorkerClient — the main thread's side of flow.worker.js.
 *
 * Two hard rules:
 *
 *  1. THE PAGE MUST NEVER BREAK BECAUSE OF THE WORKER. If the worker can't be
 *     constructed, throws, or the browser doesn't support module workers, every
 *     call transparently runs the identical flowCompute functions on the main
 *     thread. Slow is an acceptable failure. Blank is not.
 *
 *  2. THE ROWS DO NOT CROSS THE BOUNDARY. Handing back 96,178 row objects costs
 *     ~1,027ms of structured clone (measured on prod hardware), which would give
 *     most of the win straight back. Only the aggregate, the dates and a count
 *     come over.
 *
 * `usedWorker` is reported on every result so the page can log which path ran —
 * a silent fall back to the main thread would otherwise look exactly like the
 * worker "not helping", and that is the failure mode nobody notices.
 */
import {
  parseCSV,
  processFlowData,
  availableDatesFrom,
  filterRowsByDate,
} from './flowCompute'

let worker = null
let workerDead = false          // once we fall back, stay fallen back
let seq = 0
const pending = new Map()

// Main-thread mirror of the worker's state, used only on the fallback path.
let fbRows = null
let fbDates = []
let loadedKey = null      // which range the worker currently holds
let loadedMeta = null     // ...and what the page needs to render it

/** Key of the dataset the worker already has, so a re-entry can skip the fetch. */
export function getLoadedKey() { return loadedKey }

/**
 * { rowCount, availableDates } for the held dataset.
 *
 * A remount resets component state to its initial values, so it is not enough to
 * know THAT the worker still holds the rows — the page has to get rowCount and
 * availableDates back too, or the processing effect's `if (!rowCount) return`
 * guard leaves it sitting on the spinner forever.
 */
export function getLoadedMeta() { return loadedMeta }

/**
 * Record the data version the held rows represent.
 *
 * A remount gives the component fresh refs, so without this the re-entry path
 * restores the rows but reports "no version", planDelta reads that as stale and
 * fires a full refetch — we skip the download and then do it anyway.
 */
export function setLoadedVersion(v) { if (loadedMeta) loadedMeta.version = v }

function getWorker() {
  if (workerDead) return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('./flow.worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const { id } = e.data || {}
      const entry = pending.get(id)
      if (!entry) return                     // stale reply for an abandoned job
      pending.delete(id)
      entry.resolve(e.data)
    }
    worker.onerror = (err) => {
      // Fail the whole worker permanently — a worker that errored once on a
      // module-resolution problem will do it every time.
      // eslint-disable-next-line no-console
      console.warn('[flow] worker failed, falling back to the main thread:', err && err.message)
      workerDead = true
      for (const [, entry] of pending) entry.resolve({ ok: false, error: 'worker error' })
      pending.clear()
      try { worker.terminate() } catch { /* ignore */ }
      worker = null
    }
    return worker
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[flow] worker unavailable, using the main thread:', err && err.message)
    workerDead = true
    return null
  }
}

function post(msg, timeoutMs = 20000) {   // a real parse is ~2s; 60s stalled the spinner for a minute
  const w = getWorker()
  if (!w) return Promise.resolve(null)
  const id = ++seq
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); resolve(null) }   // -> fallback
    }, timeoutMs)
    pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v) } })
    try { w.postMessage({ id, ...msg }) }
    catch { clearTimeout(timer); pending.delete(id); resolve(null) }
  })
}

// ── main-thread fallback, mirroring the worker exactly ──────────────────────
const toSet = (er) => (er && er.length ? new Set(er) : null)

function fbAggregate(filter, erSoon) {
  const filtered = filterRowsByDate(fbRows, { ...filter, availableDates: fbDates })
  return {
    D: filtered.length === 0 ? null : processFlowData(filtered, toSet(erSoon)),
    filteredCount: filtered.length,
  }
}

/** Parse a CSV and keep it. Aggregation is a separate call — see processFlow. */
export async function loadFlow(csv, filter, erSoon, key) {
  const res = await post({ type: 'load', csv, filter, erSoon, key: key ?? null })
  if (res && res.ok) {
    loadedKey = key ?? null
    loadedMeta = { rowCount: res.rowCount, availableDates: res.availableDates }
    return { ...res, usedWorker: true }
  }
  if (res && res.ok === false && res.error && !workerDead) {
    return { ok: false, error: res.error, usedWorker: true }   // a real data error, not a worker failure
  }
  const rows = parseCSV(csv)
  if (!rows || rows.length === 0) {
    return { ok: false, error: 'CSV parsed but contained 0 valid rows. Check file format.', usedWorker: false }
  }
  fbRows = rows
  fbDates = availableDatesFrom(rows)
  loadedKey = key ?? null
  loadedMeta = { rowCount: rows.length, availableDates: fbDates }
  return { ok: true, rowCount: rows.length, availableDates: fbDates, usedWorker: false }
}

/** Re-aggregate the already-loaded rows under a different date selection. */
export async function processFlow(filter, erSoon, view, expectKey) {
  const res = await post({ type: 'process', filter, erSoon, view, expectKey })
  if (res && res.ok) return { ...res, usedWorker: true }
  // The worker is holding a different dataset than the caller expects (a mode or
  // range switch is still in flight). NOT an error and NOT a fallback case: the
  // main-thread copy would be just as wrong. The pending load will re-trigger.
  if (res && res.staleDataset) return { ok: false, staleDataset: true, usedWorker: true }
  // The rows live in the worker, so if it died mid-session the fallback has
  // nothing to work from. That is NOT an error to show the user — ask the page
  // to re-fetch, which repopulates the main-thread copy (workerDead is now set,
  // so loadFlow takes the fallback) and everything keeps working, just slower.
  if (!fbRows) return { ok: false, error: 'worker lost the dataset', needsReload: true, usedWorker: false }
  // The fallback needs the SAME identity guarantee as the worker. A browser with
  // no Worker support — or one whose worker died — must not be the single place
  // that still renders the previous mode's feed under the new header.
  if (expectKey != null && loadedKey !== expectKey) {
    return { ok: false, staleDataset: true, usedWorker: false }
  }
  // Fallback deliberately returns NO tabCharts — the page then uses its own
  // main-thread FD path, which is the behaviour this replaces.
  return { ok: true, ...fbAggregate(filter || {}, erSoon), usedWorker: false }
}

/** Splice today's rows in (replacing that date) and re-aggregate. */
export async function mergeToday(csv, filter, erSoon, expectKey) {
  const res = await post({ type: 'merge', csv, filter, erSoon, expectKey })
  if (res && res.ok) {
    loadedMeta = { rowCount: res.rowCount, availableDates: res.availableDates }
    return { ...res, usedWorker: true }
  }
  if (res && res.staleDataset) return { ok: false, staleDataset: true, usedWorker: true }
  if (!fbRows) return { ok: false, error: 'worker lost the dataset', needsReload: true, usedWorker: false }
  if (expectKey != null && loadedKey !== expectKey) {
    return { ok: false, staleDataset: true, usedWorker: false }
  }
  const incoming = parseCSV(csv)
  if (!incoming || !incoming.length) return { ok: false, error: 'delta had no rows', usedWorker: false }
  const days = new Set(incoming.map(r => (r.date || '').trim()).filter(Boolean))
  if (!days.size) return { ok: false, error: 'delta had no dates', usedWorker: false }
  fbRows = fbRows.filter(r => !days.has((r.date || '').trim())).concat(incoming)
  fbDates = availableDatesFrom(fbRows)
  loadedMeta = { rowCount: fbRows.length, availableDates: fbDates }
  return { ok: true, rowCount: fbRows.length, availableDates: fbDates, usedWorker: false }
}

/** Aggregate one ticker's prints (the Search drill-in). */
export async function tickerFlow(sym, erSoon) {
  const res = await post({ type: 'ticker', sym, erSoon })
  if (res && res.ok) return { ...res, usedWorker: true }
  if (!fbRows) return { ok: false, error: 'worker lost the dataset', needsReload: true, usedWorker: false }
  const s = String(sym || '').toUpperCase().trim()
  const rows = fbRows.filter(r => (r.ticker || '').toUpperCase().trim() === s)
  return { ok: true, D: rows.length ? processFlowData(rows, toSet(erSoon)) : null, rowCount: rows.length, usedWorker: false }
}

/**
 * The worker no longer holds a usable dataset. Clearing the key stops a re-entry
 * from believing it does and skipping the fetch that has to happen.
 */
export function forgetLoaded() { loadedKey = null; loadedMeta = null }

/**
 * Parse + aggregate a CSV the caller already holds, without disturbing the loaded
 * dataset. The Search drill-in uses this: its per-ticker feed is uncapped history
 * the loaded range does not contain, and on a busy symbol it is ~64k rows — about
 * a second of frozen UI if done on the main thread.
 */
export async function computeCsv(csv, erSoon) {
  const res = await post({ type: 'compute', csv, erSoon })
  if (res && res.ok) return { ...res, usedWorker: true }
  const rows = parseCSV(csv)
  return {
    ok: true,
    D: rows && rows.length ? processFlowData(rows, toSet(erSoon)) : null,
    rowCount: rows ? rows.length : 0,
    usedWorker: false,
  }
}

/** Test seam — drop worker + fallback state. */
export function _resetFlowWorker() {
  try { if (worker) worker.terminate() } catch { /* ignore */ }
  worker = null; workerDead = false; pending.clear(); seq = 0
  fbRows = null; fbDates = []; loadedKey = null; loadedMeta = null
}
