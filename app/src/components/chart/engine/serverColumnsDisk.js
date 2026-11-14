// app/src/components/chart/engine/serverColumnsDisk.js
//
// ─── WHAT THIS BROWSER LAST HAD FOR A SYMBOL, KEPT ACROSS PAGE LOADS ─────────
//
// ⚰️ MEASURED ON PRODUCTION 2026-11-13. Within one page load a server-lane column
// (the RS suite) is drawn with its candles: the rows ahead are asked for before
// the member arrives (`serverWarm.js`). The FIRST chart of a page load cannot be:
// its candles come from this browser's own store in a few milliseconds and its
// server columns from a request, about half a second later on a warm server and
// seconds later on one that just restarted. The same is true of every pop-out
// window (a new page load each) and of a jump to a symbol nothing pre-loaded.
//
// So landed envelopes are also written here, and a chart that shows a symbol
// reads them back at once (`serverCompute.js` owns when).
//
// ⛔⛔ A PLACEHOLDER, NEVER AN ANSWER. `utils/barsIDB.js` records what a browser
// store does when it is believed: wrong-scale bars that outlived the server fix
// for weeks. Nothing read from here is believed. `serverCompute.js` marks it
// PROVISIONAL: it is drawn, and it is asked for from the server exactly as if it
// were absent; the server's answer replaces it (and repaints only if it differs),
// a refusal removes it, and "the server cannot compute this" removes it after the
// lane's own bounded retries. A record is dropped unread when it is older than
// `DISK_MAX_AGE_MS`, written by another `DISK_LOGIC_VERSION`, or not the shape
// the lane's parser produces.
//
// ⛔ IT HOLDS NO POLICY ABOUT CHARTS. No definition, input or entitlement is named
// here: keys are the lane's own (`serverColumnsKey`), and a 402 is handled where
// the request is. This file owns the store, its bounds and its restraint:
//
//   · WRITES NEVER COMPETE WITH A PAINT. They are queued (newest per key, at most
//     `DISK_QUEUE_MAX`) and written from idle callbacks, `DISK_FLUSH_CHUNK` records
//     at a time (a store copies a record when it is handed over, on this thread).
//   · BOUNDED. At most `DISK_MAX_CELLS` cells; past that the OLDEST records go
//     first. One record is at most `DISK_ENTRY_MAX_CELLS`.
//   · IT FAILS TO "NOTHING". No IndexedDB, a blocked or failed open, a full disk,
//     a private window: every read answers `[]` and every write is dropped.
//
// ⚠️ A schema change takes a NEW DATABASE NAME, never a version bump: an upgrade
// waits on every other open tab (`barsIDB.js` records the deadlock that cost).
//
// Kill switch, per browser, no deploy: localStorage['uct.rsdisk.off'] = '1'.

export const DISK_DB = 'uct_server_columns_v1'
const STORE = 'entries'
/** Bumped when the stored shape or what a record means changes: older records read as absent. */
export const DISK_LOGIC_VERSION = 1
/** A record older than this is never read (a long weekend, plus a day). */
export const DISK_MAX_AGE_MS = 5 * 24 * 60 * 60_000
/** The most Float64 cells the store keeps (about 64 MB); the oldest records go first. */
export const DISK_MAX_CELLS = 8_000_000
/** One record larger than this is not written. */
export const DISK_ENTRY_MAX_CELLS = 400_000
/** The most records waiting to be written; past that the oldest waiting one is dropped. */
export const DISK_QUEUE_MAX = 400
/** The most records written in one idle slice (about one symbol's definitions); the rest wait for the next. */
export const DISK_FLUSH_CHUNK = 6
export const DISK_OFF_KEY = 'uct.rsdisk.off'

let _maxCells = DISK_MAX_CELLS
let _entryMaxCells = DISK_ENTRY_MAX_CELLS
let _queueMax = DISK_QUEUE_MAX
/** Test seam: smaller bounds (no argument restores the real ones). */
export function __setDiskLimitsForTests(limits = {}) {
  _maxCells = Number.isFinite(limits.maxCells) ? limits.maxCells : DISK_MAX_CELLS
  _entryMaxCells = Number.isFinite(limits.entryMaxCells) ? limits.entryMaxCells : DISK_ENTRY_MAX_CELLS
  _queueMax = Number.isFinite(limits.queueMax) ? limits.queueMax : DISK_QUEUE_MAX
}

function switchedOff() {
  try { return localStorage.getItem(DISK_OFF_KEY) === '1' } catch { return false }
}

const symtfOf = (sym, tf) => `${String(sym)}|${String(tf == null ? 'D' : tf)}`

// ── the IndexedDB backend: four thin operations, every failure answers "nothing" ──
function idbBackend() {
  let opening = null
  const open = () => {
    if (opening) return opening
    opening = new Promise((resolve) => {
      let req
      try { req = indexedDB.open(DISK_DB, 1) } catch { resolve(null); return }
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'key' })
        store.createIndex('symtf', 'symtf')
        store.createIndex('age', ['savedAt', 'cells'])
      }
      req.onsuccess = () => {
        const db = req.result
        // another tab wants to change the database: let it, and reopen on the next use
        db.onversionchange = () => { try { db.close() } catch { /* already closed */ } opening = null }
        db.onclose = () => { opening = null }
        resolve(db)
      }
      req.onerror = () => { opening = null; resolve(null) }
      req.onblocked = () => { opening = null; resolve(null) }
    })
    return opening
  }
  const run = (mode, fn, fallback) => open().then((db) => {
    if (!db) return fallback
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, mode)
        const got = fn(tx.objectStore(STORE))
        tx.oncomplete = () => resolve(got === undefined ? fallback : got())
        tx.onerror = () => resolve(fallback)
        tx.onabort = () => resolve(fallback)
      } catch { resolve(fallback) }
    })
  })
  return {
    read: (symtf) => run('readonly', (s) => { const r = s.index('symtf').getAll(symtf); return () => r.result || [] }, []),
    write: (records) => run('readwrite', (s) => { for (const r of records) s.put(r) }, undefined),
    remove: (keys) => run('readwrite', (s) => { for (const k of keys) s.delete(k) }, undefined),
    // oldest first, read from the index alone (no record is loaded to be counted)
    sizes: () => run('readonly', (s) => {
      const out = []
      const cur = s.index('age').openKeyCursor()
      cur.onsuccess = () => {
        const c = cur.result
        if (!c) return
        out.push({ key: c.primaryKey, savedAt: c.key[0], cells: c.key[1] })
        c.continue()
      }
      return () => out
    }, []),
  }
}

const _TEST_MODE = (() => {
  try { return !!(import.meta && import.meta.env && import.meta.env.MODE === 'test') } catch { return false }
})()

let _backend = null
let _backendMade = false
function backend() {
  if (_backendMade) return _backend
  _backendMade = true
  // ⛔ DISARMED UNDER VITEST, like the lane's own requests: a suite must not meet a store it
  // never asked for. A test arms one with `__setDiskBackendForTests`.
  _backend = (!_TEST_MODE && typeof indexedDB !== 'undefined') ? idbBackend() : null
  return _backend
}

const _queue = new Map()      // key -> record waiting to be written (newest wins)
let _flushScheduled = false
let _flushing = null
const _stats = { reads: 0, hits: 0, written: 0, dropped: 0, evicted: 0, removed: 0 }

/** Diagnostic + test seam. */
export function diskStats() {
  return { ..._stats, queued: _queue.size, off: switchedOff() || !backend() }
}

// By tag, not `instanceof`: a store hands back arrays it built itself, and the question is
// only "is this a Float64 column".
function isColumn(v) { return Object.prototype.toString.call(v) === '[object Float64Array]' }

/** The lane's parsed envelope -> a record, or null when it is not worth (or not safe) to keep. */
function toRecord(key, sym, tf, parsed, now) {
  if (!key || !parsed || typeof parsed !== 'object') return null
  const times = Array.isArray(parsed.times) ? parsed.times : null
  const columns = parsed.columns && typeof parsed.columns === 'object' ? parsed.columns : null
  if (!times || !times.length || !columns) return null       // nothing positional: nothing to draw early
  const names = Object.keys(columns)
  if (!names.length) return null
  let cells = times.length
  for (const k of names) {
    if (!isColumn(columns[k]) || columns[k].length !== times.length) return null
    cells += columns[k].length
  }
  if (cells > _entryMaxCells) return null
  const rec = { key, symtf: symtfOf(sym, tf), savedAt: now, cells, logic: DISK_LOGIC_VERSION, times: Float64Array.from(times), columns }
  if (parsed.payload && typeof parsed.payload === 'object') rec.payload = parsed.payload
  if (Number.isFinite(parsed.rev)) rec.rev = parsed.rev
  return rec
}

/** A record -> exactly the shape `columnsFromWire` produces, or null when it is not one. */
function fromRecord(rec, now) {
  if (!rec || typeof rec !== 'object' || typeof rec.key !== 'string') return null
  if (rec.logic !== DISK_LOGIC_VERSION) return null
  if (!Number.isFinite(rec.savedAt) || now - rec.savedAt > DISK_MAX_AGE_MS || rec.savedAt - now > 60_000) return null
  const times = isColumn(rec.times) ? rec.times : null
  const columns = rec.columns && typeof rec.columns === 'object' ? rec.columns : null
  if (!times || !times.length || !columns) return null
  const names = Object.keys(columns)
  if (!names.length) return null
  for (const k of names) if (!isColumn(columns[k]) || columns[k].length !== times.length) return null
  const parsed = { times: Array.from(times), columns }
  if (rec.payload && typeof rec.payload === 'object' && !Array.isArray(rec.payload)) parsed.payload = rec.payload
  if (Number.isFinite(rec.rev)) parsed.rev = Number(rec.rev)
  return parsed
}

/**
 * What this browser last had for one (symbol, timeframe): every record still
 * readable. Never rejects; `[]` when there is nothing, the store is off, or it failed.
 *
 * @returns {Promise<Array<{key: string, parsed: object, savedAt: number}>>}
 */
export function readDisk(sym, tf, now = Date.now()) {
  const b = backend()
  if (!b || switchedOff() || !sym) return Promise.resolve([])
  _stats.reads += 1
  return Promise.resolve()
    .then(() => b.read(symtfOf(sym, tf)))
    .then((records) => {
      const out = []
      const bad = []
      for (const rec of Array.isArray(records) ? records : []) {
        const parsed = fromRecord(rec, now)
        if (parsed) out.push({ key: rec.key, parsed, savedAt: rec.savedAt })
        else if (rec && typeof rec.key === 'string') bad.push(rec.key)
      }
      if (bad.length) forgetDisk(bad)                       // unreadable or expired: gone, not re-read
      _stats.hits += out.length
      return out
    })
    .catch(() => [])
}

function scheduleFlush() {
  if (_flushScheduled) return
  _flushScheduled = true
  const go = () => { _flushScheduled = false; _flushSlice(Date.now()).then(() => { if (_queue.size) scheduleFlush() }) }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 4000 })
  else setTimeout(go, 800)
}

/**
 * Keep a landed envelope for the next page load. Queued; written when the page is idle.
 * A record that is not worth keeping (nothing positional, malformed, too large) is ignored.
 */
export function writeDisk(key, sym, tf, parsed, now = Date.now()) {
  if (!backend() || switchedOff()) return false
  const rec = toRecord(key, sym, tf, parsed, now)
  if (!rec) return false
  _queue.delete(key)
  _queue.set(key, rec)
  if (_queue.size > _queueMax) { _queue.delete(_queue.keys().next().value); _stats.dropped += 1 }
  scheduleFlush()
  return true
}

/** Remove records (a refused ask, an answer the server withdrew). Also forgets a queued write. */
export function forgetDisk(keys) {
  const b = backend()
  const list = (Array.isArray(keys) ? keys : [keys]).filter((k) => typeof k === 'string' && k)
  for (const k of list) _queue.delete(k)
  if (!b || !list.length) return Promise.resolve()
  _stats.removed += list.length
  return Promise.resolve().then(() => b.remove(list)).catch(() => {})
}

/** Expire what is too old, then drop the oldest until the store fits. */
function evict(b, now) {
  return Promise.resolve().then(() => b.sizes()).then((sizes) => {
    const rows = (Array.isArray(sizes) ? sizes : []).slice().sort((x, y) => x.savedAt - y.savedAt)
    let total = 0
    for (const r of rows) total += Number(r.cells) || 0
    const gone = []
    for (const r of rows) {
      const expired = now - r.savedAt > DISK_MAX_AGE_MS
      if (!expired && total <= _maxCells) break        // oldest first: the rest are younger and fit
      gone.push(r.key)
      total -= Number(r.cells) || 0
    }
    if (!gone.length) return
    _stats.evicted += gone.length
    return b.remove(gone)
  })
}

/** Write the oldest `DISK_FLUSH_CHUNK` queued records (one idle slice). Never rejects. */
function _flushSlice(now) {
  const b = backend()
  if (!b || !_queue.size) return _flushing || Promise.resolve()
  const batch = []
  for (const [k, rec] of _queue) {
    batch.push(rec)
    _queue.delete(k)
    if (batch.length >= DISK_FLUSH_CHUNK) break
  }
  const p = Promise.resolve(_flushing)
    .then(() => b.write(batch))
    .then(() => { _stats.written += batch.length })
    .then(() => evict(b, now))
    .catch(() => {})
    .then(() => { if (_flushing === p) _flushing = null })
  _flushing = p
  return p
}

/** Write everything queued, slice after slice (a test, a page about to go). Never rejects. */
export function flushDiskNow(now = Date.now()) {
  const step = () => (_queue.size && backend() ? _flushSlice(now).then(step) : (_flushing || Promise.resolve()))
  return Promise.resolve().then(step).then(() => undefined)
}

/**
 * Test seam: arm a backend (`{read, write, remove, sizes}`), disarm with null, or
 * `'default'` for the browser's own. Clears anything queued.
 */
export function __setDiskBackendForTests(b) {
  _queue.clear()
  _flushScheduled = false
  _flushing = null
  for (const k of Object.keys(_stats)) _stats[k] = 0
  if (b === 'default') { _backendMade = true; _backend = typeof indexedDB !== 'undefined' ? idbBackend() : null; return }
  _backendMade = true
  _backend = b && typeof b === 'object' ? b : null
}

/**
 * Test helper: a store in memory with the backend's exact contract. Records are
 * copied on the way in and on the way out, as a real store copies them.
 */
export function memoryDiskBackend() {
  const rows = new Map()
  const copy = (v) => {
    if (isColumn(v)) return Float64Array.from(v)
    if (Array.isArray(v)) return v.map(copy)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)]))
    return v
  }
  return {
    rows,
    read: async (symtf) => [...rows.values()].filter((r) => r.symtf === symtf).map(copy),
    write: async (records) => { for (const r of records) rows.set(r.key, copy(r)) },
    remove: async (keys) => { for (const k of keys) rows.delete(k) },
    sizes: async () => [...rows.values()].map((r) => ({ key: r.key, savedAt: r.savedAt, cells: r.cells })),
  }
}
