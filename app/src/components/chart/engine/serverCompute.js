// app/src/components/chart/engine/serverCompute.js
//
// ─── `compute.kind: 'server'` — COLUMNS FETCHED, NOT COMPUTED ────────────────
//
// ⭐ THE LANE IS GENERIC AND TASK 14'S RS LINE IS THE PROOF. Three definitions
// that each know their own endpoint is not a lane; it is the hardcoding spec §10
// said was "acceptable at launch, genericize in C". **A lane is generic when a
// fourth tenant needs no code in it** — so there is no `defId ===` anywhere in
// this file, every tenant is addressed by its definition id through ONE path,
// and `serverCompute.test.js` reads this module's own source to keep it that way.
//
// ⚠️ WIRE FORMAT (spec §4): a column is a JSON ARRAY of numbers and `null`, and
// `null` ⇄ NaN is mapped AT THIS BOUNDARY. Compute never emits point objects —
// `[{time, value}]` is what the BINDER converts a column INTO, and a server that
// emitted points would put that conversion in two places with nothing keeping
// them equal. `columnsFromWire` refuses it by name. (Base64 Float64 buffers are
// a later optimisation, not v1.)
//
// ⚠️ JOINED BY TIME, NEVER BY INDEX. The envelope carries `times`, and
// `alignColumns` maps them onto the chart's own bars. The server's window and
// the chart's are not the same array: under an index join one missing bar shifts
// every subsequent value, and the line is plausible and wrong for the whole
// history rather than absent for one bar. That is the same rule
// `compute_rs_line_raw` states for its benchmark, applied one level up.
//
// ⚠️ PREMIUM STAYS GATED BY HANDLER IDENTITY. This file holds no entitlement
// logic and must never grow any: the lane's route declares `Depends(require_paid)`
// itself, a 402 is a routine state, and the honest client behaviour is an ABSENT
// overlay — never a retry storm and never a client-side "are you paid?" branch
// that could disagree with the server.

import { withDerivedColumns } from './derivedColumns'
// ⭐ U2b — the forming bar's live value for a `plots[].liveTail` (`liveTail.js`):
// the one cell of a cached envelope that moves with price, recomputed where the
// envelope is aligned. The module imports nothing of this one.
import { withLiveTail, benchmarkTailFor, subscribeBenchmarkTails, registerBenchmarkTailRequest } from './liveTail'
// ⭐ 2026-11-12 — a declared `rescale` (`rescale.js`): the drawn columns multiplied
// by one factor per envelope so the line reads like a rating. Presentation only.
import { rescaleOf, rescaleChoice, rescaleFactor, withRescale, withRescaleScalars } from './rescale'

/** The ONE path every server-lane definition is fetched through. */
export const SERVER_COLUMNS_PATH = '/api/signature/columns'

/** The ONE path the server-lane definitions themselves are published on. */
export const SERVER_DEFINITIONS_PATH = '/api/signature/definitions'

/**
 * The ONE path several definitions for ONE symbol are fetched through together
 * (`fetchColumnsBatch`). Each slot of its answer is the envelope
 * `SERVER_COLUMNS_PATH` returns for the same ask, so the two paths can never
 * draw two different charts.
 */
export const SERVER_COLUMNS_BATCH_PATH = '/api/signature/columns-batch'

/**
 * The request URL for one (definition, symbol, timeframe, inputs).
 *
 * Pure and exported so a call site can be asserted without a network, and so the
 * cache key and the request are derived from the SAME function — a key that can
 * disagree with the URL it stands for is a cache that serves the wrong symbol.
 *
 * @returns {string|null} null when there is nothing to ask for.
 */
export function serverColumnsUrl(defId, sym, tf, inputs) {
  const id = typeof defId === 'string' ? defId.trim() : ''
  const s = typeof sym === 'string' ? sym.trim() : ''
  if (!id || !s) return null
  const q = [
    `defId=${encodeURIComponent(id)}`,
    `sym=${encodeURIComponent(s)}`,
    `tf=${encodeURIComponent(String(tf == null ? 'D' : tf))}`,
  ]
  const body = serverInputsParam(inputs)
  if (body) q.push(`inputs=${encodeURIComponent(body)}`)
  return `${SERVER_COLUMNS_PATH}?${q.join('&')}`
}

/**
 * The `inputs` query value — a JSON object with its keys SORTED.
 *
 * Sorted because this string is half the cache key: `{a,b}` and `{b,a}` are the
 * same instance and must not be two cache entries, two in-flight requests and
 * two different answers for one chart.
 */
export function serverInputsParam(inputs) {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return ''
  const keys = Object.keys(inputs).sort()
  if (!keys.length) return ''
  const obj = {}
  for (const k of keys) obj[k] = inputs[k]
  return JSON.stringify(obj)
}

/** The cache key. Identical inputs in any key order collapse to one entry. */
export function serverColumnsKey(defId, sym, tf, inputs) {
  return serverColumnsUrl(defId, sym, tf, inputs)
}

/**
 * The wire envelope → `{times: number[], columns: {key: Float64Array}}`.
 *
 * PURE. Throws on a violated wire contract rather than returning something
 * plausible: a column that is silently the wrong shape draws a wrong line, and a
 * wrong line is worse than an absent one (the whole reason this phase exists).
 *
 * ⛔ THE REFUSAL THAT MATTERS: `[{time, value}]`. It is the shape the binder
 * produces at ITS boundary, so a server emitting it means two conversions exist
 * with nothing keeping them equal.
 */
export function columnsFromWire(wire) {
  if (!wire || typeof wire !== 'object') {
    throw new Error('serverCompute: the envelope is not an object')
  }
  const rawCols = wire.columns
  if (rawCols === undefined || rawCols === null) return withEnvelopeExtras({ times: [], columns: {} }, wire)
  if (typeof rawCols !== 'object' || Array.isArray(rawCols)) {
    throw new Error('serverCompute: `columns` must be a mapping of key to array')
  }
  const times = Array.isArray(wire.times) ? wire.times.map(Number) : []
  const columns = {}
  for (const key of Object.keys(rawCols)) {
    const col = rawCols[key]
    if (!Array.isArray(col)) {
      throw new Error(
        `serverCompute: column ${JSON.stringify(key)} is not an array — the wire `
        + 'carries a bare positional array, one cell per entry in `times`',
      )
    }
    if (col.length && col[0] !== null && typeof col[0] === 'object') {
      throw new Error(
        `serverCompute: column ${JSON.stringify(key)} arrived as point objects `
        + '({time, value}). Compute never emits points: the wire carries a bare array '
        + 'and the BINDER is the one place a column becomes chart points, so a second '
        + 'conversion here would be a second truth about where a value belongs.',
      )
    }
    const out = new Float64Array(col.length)
    for (let i = 0; i < col.length; i++) {
      const v = col[i]
      // `null` ⇄ NaN, AT THIS BOUNDARY. JSON has no NaN (FastAPI serializes with
      // allow_nan=False and a browser `r.json()` throws on a bare NaN), so the
      // gap is transported as null and restored to the NaN the binder converts
      // into LWC whitespace.
      out[i] = (v === null || v === undefined) ? NaN : Number(v)
    }
    columns[key] = out
  }
  if (times.length) {
    for (const key of Object.keys(columns)) {
      if (columns[key].length !== times.length) {
        throw new Error(
          `serverCompute: column ${JSON.stringify(key)} has ${columns[key].length} cells `
          + `against ${times.length} times — the wire is positional, so a length mismatch `
          + 'would draw the whole series shifted rather than absent',
        )
      }
    }
  }
  return withEnvelopeExtras({ times, columns }, wire)
}

/**
 * ⭐ THE ENVELOPE'S SCALARS RIDE BESIDE THE COLUMNS (plan §8.3, audit A7).
 *
 * `columnsFromWire` used to keep `{times, columns}` and drop every other key —
 * which meant a server that computed a benchmark label, a legend sentence or a
 * "last RS high" scalar had no way to reach the chip or the readout. Two keys
 * are kept now, and only when the wire carries them, so an envelope without
 * them parses to exactly the shape it always did:
 *
 *   payload — a plain object of scalars the definition's `readout` (Phase 2a)
 *             and legend read through `scalarsFor`. Never a column: nothing in
 *             it is per-bar, so nothing in it is aligned or drawn.
 *   rev     — the server definition's `compute.rev`. `serverColumnsFor` treats a
 *             cached entry whose rev differs from the CLIENT definition's as a
 *             miss, so a deploy that changes the maths never draws new plots over
 *             old columns (and never the reverse).
 */
function withEnvelopeExtras(parsed, wire) {
  if (wire && wire.payload && typeof wire.payload === 'object' && !Array.isArray(wire.payload)) {
    parsed.payload = wire.payload
  }
  if (wire && Number.isFinite(wire.rev)) parsed.rev = Number(wire.rev)
  return parsed
}

/**
 * The inputs a definition actually SENDS to the server: `meta.serverInputs`
 * when the definition names them (the keys its server row declares), else all
 * of them. A colour pick or a line width is the Style tab's business and must
 * not re-key the fetch (plan §8.3) — `resolve_inputs` would drop it on arrival
 * anyway, so without this filter two cache entries held one answer.
 */
export function pickServerInputs(def, inputs) {
  const keys = def && def.meta && Array.isArray(def.meta.serverInputs) ? def.meta.serverInputs : null
  if (!keys || !inputs || typeof inputs !== 'object') return inputs
  const out = {}
  for (const k of keys) if (inputs[k] !== undefined) out[k] = inputs[k]
  return out
}

/** A landed entry computed by a server definition on a different `compute.rev`
 *  than the client's: the maths changed under the cache. */
export function revMismatch(parsed, def) {
  const want = def && def.compute && Number.isFinite(def.compute.rev) ? def.compute.rev : undefined
  return !!parsed && want !== undefined && parsed.rev !== undefined && parsed.rev !== want
}

/**
 * Re-index a parsed envelope onto the chart's OWN bars, BY TIME.
 *
 * @returns {{[key: string]: Float64Array}} one bars-length NaN-padded column per
 *   key — the identical contract `computeFor` returns for a native, so the pool,
 *   the binder and `hasAnyFinite` cannot tell the two lanes apart.
 *
 * A definition whose envelope carries no `times` is NOT POSITIONAL (dark-pool
 * levels and GEX walls draw horizontal lines at prices, which v1's plot
 * vocabulary cannot express as a column). It yields `{}`, which is the honest
 * answer and the one `hasAnyFinite` reads as "nothing to draw here".
 */
/** ^YYYY-MM-DD$ — the WHOLE string, deliberately. A longer string that merely
 *  STARTS with a date is an instant (`2026-09-16T14:30:00Z`), and folding one to
 *  a day key would collapse every intraday bar of a session onto one slot. */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * ONE bar time → the canonical key both sides of this lane join on.
 *
 * ⭐⭐ THE TWO SIDES ARE NOT IN THE SAME REPRESENTATION, AND NEITHER IS WRONG.
 * `/api/bars/{sym}` hands the chart a D/W/M bar whose `t` is the STRING
 * `'2026-09-16'` and an intraday bar whose `t` is epoch SECONDS;
 * `/api/signature/columns` reads the same store through `bars_sqlite` and hands
 * back `20260916` for D/W/M and the same epoch seconds for intraday. Both are
 * the same instant in that store's own spelling.
 *
 * ⚰️ MEASURED ON PRODUCTION 2026-09-16, build ebffc1cd6. This function used to
 * be `Number(bar.t)` written inline, so on D/W/M it evaluated `Number('2026-09-16')`
 * — **NaN** — against a map keyed `20260916`. Zero matches, every cell NaN,
 * `hasAnyFinite` false, and the binder DROPPED the binding before a series was
 * ever created: the RS line was registered, enabled, fetched, paid for and
 * invisible, with nothing in the console. It worked on 60m and 15m, which is
 * exactly why it read as "broken everywhere" rather than "broken on daily".
 *
 * ⛔⛔ AND IT IS STRING SURGERY, NEVER A `Date`. Both spellings are already
 * CALENDAR DAYS in one store; the only way to introduce a timezone is to invent
 * an instant for one of them and read it back in another zone, which is how
 * `_fetch_bars_for_alert` put the daily VWAP in 1970-08-23. Digits in, digits
 * out: `'2026-09-16'` → `20260916` cannot drift to the 15th or the 17th for any
 * viewer anywhere, and `readout`'s rail stubs `Date` to a throw to keep it that
 * way.
 *
 * ⚠️ THE TWO NUMERIC DOMAINS CANNOT COLLIDE. A `YYYYMMDD` key is ~2.0e7 and a
 * plausible chart instant is ~1.7e9; a series is one timeframe, so only one
 * domain is ever in a given map. `20260916` read as seconds IS 1970-08-23 — the
 * signature of this whole defect class, and a reason never to mix them.
 */
export function barTimeKey(t) {
  if (typeof t === 'number') return t
  if (typeof t !== 'string') return NaN
  const m = DATE_ONLY.exec(t)
  if (m) return Number(m[1] + m[2] + m[3])
  // ⛔ EMPTY IS NOT ZERO. `Number('')` and `Number(' ')` are both `0` — a
  // perfectly plausible key that would silently join an absent time to whatever
  // sits at epoch 0. An absent time has no key.
  const trimmed = t.trim()
  if (!trimmed) return NaN
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : NaN
}

export function alignColumns(parsed, bars) {
  const { times, columns } = parsed || { times: [], columns: {} }
  const series = Array.isArray(bars) ? bars : []
  const keys = Object.keys(columns || {})
  if (!keys.length) return {}
  if (!times.length) return {}

  const at = new Map()
  for (let i = 0; i < times.length; i++) {
    const k = barTimeKey(times[i])
    if (!at.has(k)) at.set(k, i)
  }

  const out = {}
  for (const key of keys) {
    const src = columns[key]
    const col = new Float64Array(series.length)
    for (let i = 0; i < series.length; i++) {
      const j = at.get(barTimeKey(series[i] && series[i].t))
      col[i] = j === undefined ? NaN : src[j]
    }
    out[key] = col
  }
  return out
}

// ─── The cache ──────────────────────────────────────────────────────────────
//
// One entry per (definition, symbol, timeframe, inputs). It exists because
// `computeFor` is SYNCHRONOUS — the binder computes inside a paint — while the
// lane is a fetch. The first paint after an instance appears draws a NaN column
// (a warmup pad, which every native also has) and the fetch fills the entry for
// the next one. **Never a throw**: a definition the binder throws on is exactly
// what kept `rsLine` out of `listDefinitions()` until this lane existed.

const _cache = new Map()      // key -> {times, columns} | null while in flight
const _inflight = new Map()   // key -> Promise
const _subscribers = new Set()

// ─── THE CACHE IS BOUNDED, OLDEST-UNUSED FIRST (2026-11-12) ──────────────────
//
// It used to keep every landed entry for the whole page load. That was a few
// megabytes while a chart only ever held the symbols a member opened; the lane
// now also holds the symbols the member is ABOUT to open (`warmSymbols`), so a
// morning's scanning would otherwise grow without limit (one symbol's RS suite
// is ~40,000 cells). A `Map` iterates in insertion order and a read re-inserts
// its entry, so the first key is always the one unused for longest. An entry a
// paint is still waiting on (`_wanted`) is never the one dropped. A dropped
// entry is simply asked for again the next time a chart needs it.
/** How many Float64 cells (times + every column) the cache may hold: ~64 MB. */
export const CACHE_MAX_CELLS = 8_000_000
let _cacheMaxCells = CACHE_MAX_CELLS
/** Test seam: bound the cache at `n` cells (no argument restores `CACHE_MAX_CELLS`). */
export function __setCacheMaxCellsForTests(n) {
  _cacheMaxCells = Number.isFinite(n) && n > 0 ? n : CACHE_MAX_CELLS
}
const _cacheCells = new Map() // key -> cells this entry holds
let _cellsHeld = 0
const _wanted = new Set()     // keys a paint asked for and was not handed yet

function _cellsOf(parsed) {
  let n = parsed && Array.isArray(parsed.times) ? parsed.times.length : 0
  const cols = (parsed && parsed.columns) || {}
  for (const k of Object.keys(cols)) n += cols[k] ? cols[k].length : 0
  return n
}

function _cacheDrop(key) {
  if (!_cache.has(key)) return
  _cache.delete(key)
  _cellsHeld -= _cacheCells.get(key) || 0
  _cacheCells.delete(key)
}

function _cachePut(key, parsed) {
  _cacheDrop(key)
  const cells = _cellsOf(parsed)
  _cache.set(key, parsed)
  _cacheCells.set(key, cells)
  _cellsHeld += cells
  if (_cellsHeld <= _cacheMaxCells) return
  for (const k of [..._cache.keys()]) {
    if (_cellsHeld <= _cacheMaxCells) break
    if (k === key || _wanted.has(k)) continue
    _cacheDrop(k)
  }
}

/** Diagnostic + test seam: what the cache holds right now. */
export function serverColumnsCacheStats() {
  return { entries: _cache.size, cells: _cellsHeld, inflight: _inflight.size, wanted: _wanted.size }
}

/** Notified whenever an entry lands, so a host can repaint. @returns {() => void} */
export function subscribe(fn) {
  if (typeof fn !== 'function') return () => {}
  _subscribers.add(fn)
  return () => { _subscribers.delete(fn) }
}

function _notify(key) {
  for (const fn of [..._subscribers]) {
    try { fn(key) } catch { /* a bad subscriber must not break the lane */ }
  }
}

// ⭐ U2b — a landed BENCHMARK TAIL says "something landed, ask again" through the
// same door as a landed envelope, so the chart's one listener (`useServerColumns`)
// repaints and the binder's memo (which carries the tail's version, see
// `nativeRegistry.computeSignature`) recomputes the forming bar.
subscribeBenchmarkTails((key) => _notify(`liveTail:${key}`))

// ⭐ F2 (2026-11-10) — and THIS module is the benchmark tail's door: the store
// (`liveTail.js`) holds no request of its own, so the browser's — the same
// `fetch` the envelopes above use — is registered here, on import, by the one
// module that already owns the lane's network (H4). A host that never imports
// this door (the runtime worker, the server bundle, a test file before it arms
// its own) asks for no tail at all. `test-setup.js` takes it away before every
// test; `liveTail.test.js` proves both the registration and the refusal.
registerBenchmarkTailRequest(_defaultFetch)

/** ⭐ RT1 — another lane whose columns arrive AFTER the paint that asked (the
 *  runtime pane's off-thread run, `runtime/runtimeAsync.js`) says so through the
 *  same notification, so the chart's one listener (`useServerColumns`) repaints
 *  for it too. The message is still only "something landed, ask again". */
export function notifyColumnsLanded(key) {
  _notify(key)
}

// ⭐ A DEGRADED ANSWER IS NOT A FINAL ONE (2026-11-11). The server answers `200` with a
// blank envelope when it cannot yet compute: `payload.state` `no-bars` (the pod holds no
// bars for the symbol yet) or `no-benchmark-bars` (none for the benchmark yet, e.g. a
// custom ticker it is still warming), or the route's own `error` envelope. The server
// remembers such an answer for at most a minute (`rs_provider`: "a six-hour memory of
// 'nothing' would outlive the fix") and does not remember a no-bars one at all, but this
// cache keeps a landed entry for the whole page load, so a chart that asked one moment too
// early drew nothing until the member reloaded. A degraded entry is therefore dropped on a
// short, BOUNDED back-off (5 s, 15 s, 45 s after it landed, a little over the server's own
// minute) and the next paint asks again; after the last try the answer stands, as before.
// `intraday`, `same-symbol` and `short-history` are real answers and are never re-asked.
export const DEGRADED_RETRY_MS = Object.freeze([5_000, 15_000, 45_000])
const DEGRADED_STATES = new Set(['no-bars', 'no-benchmark-bars'])
const _degradedTries = new Map()   // key -> retries scheduled so far
const _degradedTimers = new Map()  // key -> the pending timer

function isDegradedWire(wire) {
  if (!wire || typeof wire !== 'object') return false
  if (typeof wire.error === 'string' && wire.error) return true
  const st = wire.payload && typeof wire.payload === 'object' ? wire.payload.state : undefined
  return typeof st === 'string' && DEGRADED_STATES.has(st)
}

function _forgetDegraded(key) {
  const t = _degradedTimers.get(key)
  if (t !== undefined) clearTimeout(t)
  _degradedTimers.delete(key)
}

function _trackDegraded(key, parsed, wire) {
  if (!isDegradedWire(wire)) { _degradedTries.delete(key); _forgetDegraded(key); return }
  const tries = _degradedTries.get(key) || 0
  if (tries >= DEGRADED_RETRY_MS.length) return        // the last answer stands
  _degradedTries.set(key, tries + 1)
  _forgetDegraded(key)
  _degradedTimers.set(key, setTimeout(() => {
    _degradedTimers.delete(key)
    // only if it is still THIS answer (a prime or a clear may have replaced it)
    if (_cache.get(key) !== parsed) return
    _cacheDrop(key)
    _notify(key)                                       // the next paint asks again
  }, DEGRADED_RETRY_MS[tries]))
}

/** Test seam + a symbol/timeframe change escape hatch. */
export function clearServerColumns() {
  _cache.clear()
  _cacheCells.clear()
  _cellsHeld = 0
  _wanted.clear()
  _inflight.clear()
  _asks.clear()
  _own.clear()
  _batchDownUntil = 0
  for (const t of _degradedTimers.values()) clearTimeout(t)
  _degradedTimers.clear()
  _degradedTries.clear()
}

/**
 * Seed the cache from a payload somebody else already fetched.
 *
 * The three Signature overlays ride SWR in `useSignatureIndicators`, which owns
 * the re-render; priming here means their columns cost NO second request. A
 * lane that could only be filled by its own fetch would double every one of them.
 */
export function primeServerColumns(defId, sym, tf, inputs, wire) {
  const key = serverColumnsKey(defId, sym, tf, inputs)
  if (!key) return null
  let parsed
  try {
    parsed = columnsFromWire(wire)
  } catch {
    // A malformed envelope is not cached: caching it would remember a defect as
    // an answer for the life of the chart (lesson_market_cap_cache_poison).
    return null
  }
  _cachePut(key, parsed)
  _degradedTries.delete(key); _forgetDegraded(key)    // a primed answer is somebody else's, final
  return parsed
}

/**
 * The SYNCHRONOUS read `computeFor` uses. Null when nothing has landed yet.
 *
 * Deliberately does NOT fetch — a read with a side effect cannot be called from
 * a test, a probe or a second lane without paying for a request. `ensureColumns`
 * is the one that asks.
 */
export function cachedColumns(defId, sym, tf, inputs) {
  const key = serverColumnsKey(defId, sym, tf, inputs)
  if (!key) return null
  const hit = _cache.get(key)
  if (hit === undefined) return null
  // A read marks the entry as used: it moves to the young end, so the bounded
  // cache drops what no chart has looked at for longest (see `_cachePut`).
  if (hit) { _cache.delete(key); _cache.set(key, hit) }
  return hit
}

/**
 * Is this entry already here, or already on its way? Neither asks for it nor
 * counts as a use of it: the question a warmer asks before it spends a request.
 */
export function hasColumns(defId, sym, tf, inputs) {
  const key = serverColumnsKey(defId, sym, tf, inputs)
  return !!key && (_cache.has(key) || _inflight.has(key))
}

/**
 * The fetch. Deduped per key, so sixteen grid cells on one symbol cost one
 * request and a repeated paint costs none.
 *
 * @param {(url: string) => Promise<any>} [fetcher] injected for tests. The
 *   default is the app's own credentialed fetch.
 */
export function fetchColumns(defId, sym, tf, inputs, fetcher) {
  const key = serverColumnsKey(defId, sym, tf, inputs)
  if (!key) return Promise.resolve(null)
  const existing = _inflight.get(key)
  if (existing) return existing
  const get = typeof fetcher === 'function' ? fetcher : _defaultFetch
  const p = Promise.resolve()
    .then(() => get(key))
    .then((wire) => {
      const parsed = columnsFromWire(wire)
      _cachePut(key, parsed)
      _trackDegraded(key, parsed, wire)
      return parsed
    })
    .catch(() => {
      // Quiet on purpose, exactly like `useSignatureIndicators`' fetcher: the
      // lane is paid-gated, so a 402 is a routine state and not an incident. The
      // failure is NOT cached — an absent entry retries on the next paint, a
      // cached empty one would be remembered as "no data" forever.
      _cacheDrop(key)
      return null
    })
    .finally(() => {
      if (_inflight.get(key) === p) _inflight.delete(key)
      _wanted.delete(key)
      _notify(key)
    })
  _inflight.set(key, p)
  return p
}

function _defaultFetch(url) {
  return fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status}`)
      err.status = r.status
      throw err
    }
    // ⛔ A PAGE IS NOT AN ANSWER. This app answers an API path it does not route with its own
    // HTML and a 200 (the SPA catch-all; measured on production 2026-11-12 for the batch route
    // one deploy before it existed). "No such route" therefore arrives as a 200 that is not
    // JSON, and is reported as the 404 it stands for, so the batch door can remember it
    // instead of asking a server that cannot answer on every symbol.
    const type = (r.headers && typeof r.headers.get === 'function' && r.headers.get('content-type')) || ''
    if (type && !/json/i.test(type)) {
      const err = new Error('not JSON')
      err.status = 404
      throw err
    }
    return r.json()
  })
}

// ─── SEVERAL DEFINITIONS FOR ONE SYMBOL, ONE REQUEST (2026-11-12) ────────────
//
// ⚰️ MEASURED ON PRODUCTION, a member arrowing down a watchlist: the next
// symbol's candles were drawn 40 ms after the key press, from memory, and its
// five RS definitions 1.2 to 2.0 s later: five requests, one per definition,
// each waiting on the same server read, and none of them started until the
// member had already arrived. Two things follow, and this section is the first:
//
//   1. ONE REQUEST PER SYMBOL. `fetchColumnsBatch` asks `SERVER_COLUMNS_BATCH_PATH`
//      for every definition a chart draws for a symbol at once. The server
//      answers each ask through the function its single route calls, so a slot
//      here is the envelope `SERVER_COLUMNS_PATH` returns for that ask.
//   2. ASKED BEFORE THE MEMBER ARRIVES. `engine/serverWarm.js` replays the asks
//      charts are drawing (`liveAsks`) for the symbols the bars prefetch already
//      knows are next, through this same door, quietly.
//
// ⛔ THE BATCH IS A TRANSPORT, NOT A SECOND LANE. Entries land under the keys the
// single ask uses (`serverColumnsKey`), through the same parser, the same
// degraded tracking and the same bounded cache; a paint cannot tell which door
// its columns came through. A batch that fails falls back to the single asks for
// a chart's own request (never for a warm: a warm that cannot be batched is not
// worth N requests), and a server without the route (an older build during a
// deploy) is remembered for `BATCH_RETRY_MS` so the chart is not slowed by a
// request that can only fail.

/** After the batch route answers "no such route", how long single asks are used before it is tried again. */
export const BATCH_RETRY_MS = 5 * 60_000
let _batchDownUntil = 0

// ⛔ DISARMED UNDER VITEST, like the definitions request below: a suite that counts
// `fetch` calls must not meet a batched GET it never asked for. A test arms the
// door for the module (`__setServerBatchFetcherForTests`) or per call (`getBatch`).
const _BATCH_TEST_MODE = (() => {
  try { return !!(import.meta && import.meta.env && import.meta.env.MODE === 'test') } catch { return false }
})()
let _batchGet = _BATCH_TEST_MODE ? null : _defaultFetch

/** Test seam: arm (or, with null, disarm) the batch request for the whole module.
 *  `'default'` arms the browser's own request, the one production uses. */
export function __setServerBatchFetcherForTests(fn) {
  _batchGet = fn === 'default' ? _defaultFetch : (typeof fn === 'function' ? fn : null)
  _batchDownUntil = 0
}

/** May a batch be sent right now? False while the door is disarmed or the route is marked absent. */
export function batchAvailable(now = Date.now()) {
  return typeof _batchGet === 'function' && now >= _batchDownUntil
}

/**
 * The batch request URL for one symbol's asks. Pure. Each ask's inputs are
 * written with sorted keys (`serverInputsParam`), so one set of asks is one URL.
 *
 * @param {Array<{defId: string, inputs?: object}>} asks
 * @returns {string|null} null when there is nothing to ask for.
 */
export function serverColumnsBatchUrl(sym, tf, asks) {
  const s = typeof sym === 'string' ? sym.trim() : ''
  const list = []
  for (const a of Array.isArray(asks) ? asks : []) {
    const id = a && typeof a.defId === 'string' ? a.defId.trim() : ''
    if (!id) continue
    const body = serverInputsParam(a.inputs)
    list.push(body ? { defId: id, inputs: JSON.parse(body) } : { defId: id })
  }
  if (!s || !list.length) return null
  return `${SERVER_COLUMNS_BATCH_PATH}?sym=${encodeURIComponent(s)}`
    + `&tf=${encodeURIComponent(String(tf == null ? 'D' : tf))}`
    + `&asks=${encodeURIComponent(JSON.stringify(list))}`
}

/**
 * Ask for several definitions of ONE symbol in one request and land each answer
 * under its own key. Asks already cached or already in flight are left out; with
 * nothing left, no request is made.
 *
 * `quiet` is a warm (nobody is looking at this symbol yet): it fills only entries
 * that are still ABSENT when the answer lands (a primed answer, or the chart's
 * own, is never replaced), repaints only for a key some paint has since asked
 * for, and does not fall back to single asks.
 *
 * @param {Array<{defId: string, inputs?: object}>} asks inputs as SENT (`pickServerInputs`)
 * @param {{quiet?: boolean, getBatch?: (url: string) => Promise<any>}} [opts]
 * @returns {Promise<number>} entries landed; `-1` when the request itself failed
 *   (a warmer backs off on that); never rejects.
 */
export function fetchColumnsBatch(sym, tf, asks, opts = {}) {
  const quiet = !!opts.quiet
  const todo = []
  for (const a of Array.isArray(asks) ? asks : []) {
    if (!a || typeof a.defId !== 'string') continue
    const key = serverColumnsKey(a.defId, sym, tf, a.inputs)
    if (!key || _cache.has(key) || _inflight.has(key)) continue
    if (todo.some((t) => t.key === key)) continue
    todo.push({ key, defId: a.defId, inputs: a.inputs })
  }
  if (!todo.length) return Promise.resolve(0)
  const get = typeof opts.getBatch === 'function' ? opts.getBatch : _batchGet
  const singles = () => Promise.all(todo.map((t) => fetchColumns(t.defId, sym, tf, t.inputs)))
    .then((got) => got.filter(Boolean).length)
  if (typeof get !== 'function' || (typeof opts.getBatch !== 'function' && Date.now() < _batchDownUntil)) {
    return quiet ? Promise.resolve(0) : singles()
  }
  const url = serverColumnsBatchUrl(sym, tf, todo)
  let failed = false
  const p = Promise.resolve()
    .then(() => get(url))
    .then((body) => {
      const results = body && Array.isArray(body.results) ? body.results : null
      // Positional: one slot per ask. A body of any other shape answers nothing.
      if (!results || results.length !== todo.length) throw new Error('malformed batch body')
      let landed = 0
      todo.forEach((t, i) => {
        const slot = results[i]
        // A refused ask (the route's own 404 / 422 for it) is not cached, exactly
        // as a failed single ask is not: the next paint asks again.
        if (!slot || slot.status !== 200 || !slot.envelope) return
        let parsed
        try { parsed = columnsFromWire(slot.envelope) } catch { return }
        if (quiet && _cache.has(t.key)) return
        _cachePut(t.key, parsed)
        _trackDegraded(t.key, parsed, slot.envelope)
        landed += 1
      })
      return landed
    })
    .catch((err) => {
      failed = true
      const status = err && Number.isFinite(err.status) ? err.status : 0
      if (status === 404 || status === 405) _batchDownUntil = Date.now() + BATCH_RETRY_MS
      return -1
    })
    .then((landed) => {
      for (const t of todo) { if (_inflight.get(t.key) === p) _inflight.delete(t.key) }
      if (failed && !quiet) return singles()            // each single ask notifies for itself
      for (const t of todo) {
        // A warm repaints only for a key a paint asked for while it was on its way.
        const waited = _wanted.delete(t.key)
        if (!quiet || waited) _notify(t.key)
      }
      return landed
    })
  for (const t of todo) _inflight.set(t.key, p)
  return p
}

// ⭐ A CHART'S OWN ASKS LEAVE TOGETHER. `computeFor` asks per definition, inside
// one synchronous paint, so the five definitions of an RS suite arrive here as
// five calls in the same tick. They are collected per (symbol, timeframe) and
// sent when the tick ends: one batch for two or more, the single route for one
// (so a chart with one server definition makes exactly the request it always did).
const _own = new Map()        // `${sym}|${tf}` -> { sym, tf, asks: Map(key -> {defId, inputs}) }
let _ownFlushing = false

function _flushOwnAsks() {
  _ownFlushing = false
  const groups = [..._own.values()]
  _own.clear()
  for (const g of groups) {
    const asks = [...g.asks.values()]
    if (asks.length === 1) fetchColumns(asks[0].defId, g.sym, g.tf, asks[0].inputs)
    else fetchColumnsBatch(g.sym, g.tf, asks)
  }
}

function _queueOwnAsk(key, defId, sym, tf, inputs) {
  const gk = `${sym}|${tf}`
  let g = _own.get(gk)
  if (!g) { g = { sym, tf, asks: new Map() }; _own.set(gk, g) }
  if (!g.asks.has(key)) g.asks.set(key, { defId, inputs })
  if (_ownFlushing) return
  _ownFlushing = true
  queueMicrotask(_flushOwnAsks)
}

/**
 * Read the cache, and ask for the entry if it is not there.
 *
 * This is what `computeFor` calls: a synchronous answer now (possibly null) and
 * a request in flight for the next paint.
 */
export function ensureColumns(defId, sym, tf, inputs, fetcher) {
  const hit = cachedColumns(defId, sym, tf, inputs)
  if (hit) return hit
  const key = serverColumnsKey(defId, sym, tf, inputs)
  if (!key) return null
  _wanted.add(key)
  // An entry already on its way is not asked for twice: both doors below leave an
  // in-flight key alone (`fetchColumns` returns the pending request, a batch skips it).
  // An injected fetcher is a test's (or a host's) own single-ask door: honoured as is.
  if (typeof fetcher === 'function' || !batchAvailable()) fetchColumns(defId, sym, tf, inputs, fetcher)
  else _queueOwnAsk(key, defId, sym, tf, inputs)
  return null
}

// ─── WHAT CHARTS ARE DRAWING, SO IT CAN BE ASKED FOR AHEAD ───────────────────
//
// A warm has a symbol and a timeframe; it does not know which definitions, with
// which inputs, a chart will ask for when the member gets there. The paints do:
// every server-lane compute passes through `serverColumnsFor`, which notes the
// ask (definition, timeframe, inputs as sent) here. `liveAsks(tf)` is that list,
// for a timeframe, while it is recent. Nothing is fetched by noting.
//
// ⛔ AN ASK IS FORGOTTEN, NOT KEPT. An indicator a member removed stops being
// asked for by any paint, so its note ages out (`ASK_TTL_MS`) and warms stop
// paying for it; the list is capped (`ASK_MAX`, oldest dropped) so a member
// stepping through input values cannot grow it.

/** How long after its last paint an ask is still replayed for upcoming symbols. */
export const ASK_TTL_MS = 30 * 60_000
/** The most distinct asks remembered at once. */
export const ASK_MAX = 24
const _asks = new Map()       // `${defId}|${tf}|${inputs}` -> { defId, tf, inputs, at }

function _noteAsk(defId, tf, sent) {
  const t = String(tf == null ? 'D' : tf)
  const k = `${defId}|${t}|${serverInputsParam(sent)}`
  _asks.delete(k)
  _asks.set(k, { defId, tf: t, inputs: sent, at: Date.now() })
  if (_asks.size > ASK_MAX) _asks.delete(_asks.keys().next().value)
}

/**
 * The asks charts drew at this timeframe recently: what a warm replays for a
 * symbol the member has not reached yet.
 *
 * @returns {Array<{defId: string, inputs: object|null|undefined}>}
 */
export function liveAsks(tf, now = Date.now()) {
  const want = String(tf == null ? 'D' : tf)
  const out = []
  for (const [k, a] of [..._asks]) {
    if (now - a.at > ASK_TTL_MS) { _asks.delete(k); continue }
    if (a.tf === want) out.push({ defId: a.defId, inputs: a.inputs })
  }
  return out
}

/**
 * `computeFor`'s server branch, whole: bars-length columns for a server-lane
 * definition, or `{}` while nothing has landed.
 *
 * `{}` and not a throw, and not an all-NaN set of the declared keys: the pool
 * asks `hasData` per binding key, and a declared-but-empty column would create a
 * pane and an axis for a series with nothing in it.
 */
export function serverColumnsFor(def, bars, inputs, ctx) {
  const sym = ctx && typeof ctx.sym === 'string' ? ctx.sym : ''
  if (!sym) return {}
  const sent = pickServerInputs(def, inputs)
  // What this paint asks for is what a warm replays for the symbols ahead (`liveAsks`).
  _noteAsk(def.id, ctx.tf, sent)
  const parsed = ensureColumns(def.id, sym, ctx.tf, sent, ctx.fetcher)
  if (!parsed) return {}
  // ⭐ A DIFFERENT SERVER REV IS DRAWN, NOT RE-ASKED (review finding, 2026-11-06).
  // The first cut treated a rev mismatch as a cache miss and asked again. But the
  // only way the two revs differ is a SERVER that is on another revision — the
  // flag off (the dark default: v1 row, rev 1, one column) or a deploy skew —
  // and asking again returns the same envelope, so every render re-asked:
  // an unbounded loop that drew nothing. The in-memory cache cannot hold an
  // entry from before a deploy (it lives one page load), so there is no stale
  // entry for gating to catch. What arrives is drawn: the binder binds the plots
  // whose columns exist and ignores the rest, which on the v1 server is exactly
  // "the RS line and nothing else". `revMismatch` stays exported as a SIGNAL for
  // the readout ("this chart is drawing an older server answer").
  // ⭐ UCT RS design round (2026-11-08): the declared `plots[].derive` columns —
  // an event's glyph riding the line — are built here, the one place a server
  // definition's columns are aligned, from columns the envelope already carries.
  // ⭐ U2b (RS split, 2026-11-09): and the declared `plots[].liveTail` moves the
  // FORMING bar's cell first — the cached envelope's history is served as it is,
  // its last cell is `close / benchmarkClose` (and the average's exact one-step
  // continuation) on the chart's own last bar, with the benchmark's forming bar
  // read from the bars route the candle itself is served from. Before `derive`,
  // so a glyph that fires on the last bar rides the live line, not the stale one.
  // Fail closed in `withLiveTail`: anything it cannot prove leaves the server's
  // value in place.
  const aligned = alignColumns(parsed, bars)
  const live = withLiveTail(def, aligned, bars, inputs, {
    scalars: parsed.payload || null, sym, tf: ctx.tf,
    newestBarIsForming: ctx.newestBarIsForming,
    timeKey: barTimeKey,
    tail: (benchSym, tf) => benchmarkTailFor(benchSym, tf),
  })
  // ⭐ 2026-11-12 — a declared `rescale` multiplies the drawn columns by ONE factor,
  // read off the envelope's own cells (`rescaleFactor`), AFTER the live tail: the
  // forming bar's raw `close / benchClose` is scaled by the same k as the history,
  // so it moves with price on the rated scale. Before `derive`, so a glyph built
  // from the line rides the scaled line. Off (the declared default), identity.
  const scaled = withRescale(def, live, rescaleFactorFor(def, parsed, inputs, ctx.tf))
  return withDerivedColumns(def, scaled, inputs)
}

// One factor per (envelope, choice, timeframe): `scalarsFor` and the compute ask
// for it on every paint, and the readout's memo keys on the scalars' identity.
const _rescaleMemo = new WeakMap()   // parsed -> Map(`choice|tf` -> {factor, scalars})

function rescaleEntry(def, parsed, inputs, tf) {
  if (!rescaleOf(def) || !parsed || typeof parsed !== 'object') return null
  const memoKey = `${String(rescaleChoice(def, inputs))}|${String(tf == null ? 'D' : tf).toUpperCase()}`
  let byKey = _rescaleMemo.get(parsed)
  if (!byKey) { byKey = new Map(); _rescaleMemo.set(parsed, byKey) }
  let hit = byKey.get(memoKey)
  if (!hit) {
    const factor = rescaleFactor(def, parsed, inputs, tf, barTimeKey)
    hit = { factor, scalars: withRescaleScalars(def, parsed.payload || null, factor) }
    byKey.set(memoKey, hit)
  }
  return hit
}

function rescaleFactorFor(def, parsed, inputs, tf) {
  const e = rescaleEntry(def, parsed, inputs, tf)
  return e ? e.factor : null
}

/**
 * The scalars the server sent beside a definition's columns — `payload` of the
 * landed envelope for this (definition, symbol, timeframe, server inputs) — or
 * `null` while nothing has landed or the entry is on the wrong rev. Read-only:
 * it never asks the server; `serverColumnsFor` is what asks.
 */
export function scalarsFor(def, inputs, ctx) {
  const sym = ctx && typeof ctx.sym === 'string' ? ctx.sym : ''
  if (!def || !sym) return null
  const parsed = cachedColumns(def.id, sym, ctx.tf, pickServerInputs(def, inputs))
  if (!parsed) return null
  // Same rule as the columns: what the server sent is what the readout reads.
  // A v1 server sends no payload, so this is simply null there.
  // ⭐ 2026-11-12 — plus, for a definition declaring `rescale` with the scale on,
  // the scale's state under `rescale` (`rescale.withRescaleScalars`): the readout
  // says "Scaled to 6M: 90 on Nov 11" or why the line is drawn unscaled. The same
  // object every paint (memoised per envelope), the payload itself while off.
  const e = rescaleEntry(def, parsed, inputs, ctx.tf)
  if (e) return e.scalars || null
  return parsed.payload || null
}

// ─── WHAT THE LIVE SERVER DECLARES (UCT RS Phase 3, unit 3-01) ───────────────
//
// ⭐⭐ ONE JS DEFINITION REACHES EVERY MEMBER AT MERGE, SO DARK WORK NEEDS A
// CLIENT GATE. The client cannot see a server flag: it draws whatever columns
// arrive. A definition therefore marks an input, an enum option or a preset
// `requiresServer: true`, and the settings surfaces hide it until the LIVE server
// row — `SERVER_DEFINITIONS_PATH`, published as data and until now read by
// nobody — declares it. Merging a control ahead of its server half then shows
// members nothing, instead of a switch that draws nothing.
//
// ⛔ FAIL CLOSED, EVERY WAY. Not fetched yet, the fetch failed (a 402 is a
// routine state here, exactly as on the columns lane), the body is malformed,
// or the row is absent: every answer is `null`, which the readers treat as "not
// declared". A gated control that appears one paint late is a non-event; one
// that appears against a server that cannot answer it is the defect.
//
// ⚠️ ONE GET PER PAGE LOAD, SHAPED LIKE SWR. `serverDeclares` is a synchronous
// read (the last answer, possibly null) that starts the one request the first
// time anybody asks; the answer lands for every definition at once and is
// announced through `subscribeServerDefinitions`, whose subscribers re-read. A
// success is never re-asked: the route answers the same rows until the next
// deploy, and a deploy is a page load. The answers are memoised per definition,
// so a `useSyncExternalStore` snapshot is reference-stable.
//
// ⭐ 3-02: ONE RETRY, AND ONLY ONE. A failure (a throw, a 402, a malformed body)
// is answered "nothing declared" at once, and the request is asked exactly once
// more `DEFINITIONS_RETRY_MS` later: a pod restarting under a page load would
// otherwise keep every gated control dark until the member reloads. A second
// failure stays "nothing declared" for the rest of the page load. Two GETs at
// most, ever.
//
// ⛔ AND NO TEST PAYS FOR IT BY ACCIDENT. Under vitest (`MODE === 'test'`) the
// default request is disarmed: a suite that counts `fetch` calls must not meet
// a stray GET it never asked for. A test injects a fetcher per call, or arms one
// for the module with `__setServerDefinitionsFetcherForTests`.

const _DEFINITIONS_TEST_MODE = (() => {
  try { return !!(import.meta && import.meta.env && import.meta.env.MODE === 'test') } catch { return false }
})()

let _defsRows = null          // Map defId -> declaration, once landed
let _defsPromise = null       // the one request (or its one retry), once asked
let _defsTestFetcher = null   // armed by a test
let _defsRetryTimer = null    // the one retry, while scheduled
let _defsGeneration = 0       // bumped by clear/prime, so a stale answer lands nowhere
let _defsVersion = 0          // bumped on every landing / prime, read by `serverDefinitionsVersion`
const _defsSubscribers = new Set()

/** ⭐ 3-02 — how long after a failed definitions fetch the ONE retry is asked. */
export const DEFINITIONS_RETRY_MS = 30_000

/** An option entry's VALUE, in the three shapes a definition (or a row) may use. */
function _optionValue(option) {
  if (Array.isArray(option)) return option[0]
  if (option && typeof option === 'object' && 'value' in option) return option.value
  return option
}

/**
 * ONE server row → what it declares, or null for a row that is not one.
 *
 * PURE and exported so the parse is pinned against the real shape. The route
 * answers `{schemaVersion, definitions: [row, …]}`, and a row's `inputs` is a
 * list of `{key, type, default, options?, min?, max?}`; an enum's `options` is a
 * bare list of VALUES (`["SPY", "RSP", …]`, `["EMA", "SMA"]`). Pairs and
 * `{value}` objects are read too, so a row that one day carries labels still
 * parses to the same values.
 *
 * @returns {{defId: string, inputs: string[], options: {[key: string]: Array<string|number|boolean>}}|null}
 *   frozen. `options` holds a key only for an input whose row lists options.
 */
export function declarationFromRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null
  if (typeof row.id !== 'string' || !row.id) return null
  const list = Array.isArray(row.inputs) ? row.inputs : []
  const inputs = []
  const options = {}
  for (const spec of list) {
    if (!spec || typeof spec !== 'object' || typeof spec.key !== 'string' || !spec.key) continue
    if (inputs.includes(spec.key)) continue
    inputs.push(spec.key)
    if (Array.isArray(spec.options)) {
      options[spec.key] = Object.freeze(spec.options.map(_optionValue)
        .filter((v) => ['string', 'number', 'boolean'].includes(typeof v)))
    }
  }
  return Object.freeze({ defId: row.id, inputs: Object.freeze(inputs), options: Object.freeze(options) })
}

/** The route's body → `Map(defId → declaration)`, or null for a body that is not one. */
function _declarationsFromBody(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.definitions)) return null
  const out = new Map()
  for (const row of body.definitions) {
    const d = declarationFromRow(row)
    if (d && !out.has(d.defId)) out.set(d.defId, d)
  }
  return out
}

function _notifyDefinitions() {
  // ⭐ RS split U1 — a surface that lists OFFERED definitions memoises on this
  // number (a `useSyncExternalStore` snapshot), so a landing re-lists.
  _defsVersion += 1
  for (const fn of [..._defsSubscribers]) {
    try { fn() } catch { /* a bad subscriber must not break the gate */ }
  }
}

/** Notified when the definitions land (or fail), and once more after the one retry (3-02). @returns {() => void} */
export function subscribeServerDefinitions(fn) {
  if (typeof fn !== 'function') return () => {}
  _defsSubscribers.add(fn)
  return () => { _defsSubscribers.delete(fn) }
}

/** One attempt: the body parsed to declarations, or a throw for anything that is not one. */
function _askDefinitions(get) {
  return Promise.resolve()
    .then(() => get(SERVER_DEFINITIONS_PATH))
    .then((body) => {
      const rows = _declarationsFromBody(body)
      if (!rows) throw new Error('malformed definitions body')
      return rows
    })
}

/**
 * The one request. Memoised for the page load: the second call returns the
 * first call's promise, landed or not. A failure resolves `null` ("nothing
 * declared") at once and schedules exactly ONE retry `DEFINITIONS_RETRY_MS`
 * later (see the header); while that retry is in flight this returns ITS
 * promise, and a second failure is remembered as "nothing declared".
 *
 * @param {(url: string) => Promise<any>} [fetcher] injected for tests.
 * @returns {Promise<Map<string, object>|null>}
 */
export function fetchServerDefinitions(fetcher) {
  if (_defsPromise) return _defsPromise
  const get = typeof fetcher === 'function' ? fetcher
    : (typeof _defsTestFetcher === 'function' ? _defsTestFetcher
      : (_DEFINITIONS_TEST_MODE ? null : _defaultFetch))
  if (!get) return Promise.resolve(null)
  const gen = _defsGeneration
  const land = (rows) => {
    if (gen !== _defsGeneration) return rows
    _defsRows = rows
    _notifyDefinitions()
    // ⭐ UCT RS 3-14 — and the chart repaints: the pool reads the declaration to
    // decide a gated guide (`pool.plotActiveFor`), so a chart painted before the
    // answer landed plans its guides again. Same message as a landing column:
    // "something landed, ask again" (`useServerColumns`).
    _notify('definitions')
    return rows
  }
  const retry = () => {
    _defsRetryTimer = null
    if (gen !== _defsGeneration) return
    _defsPromise = _askDefinitions(get).then(land, () => land(null))
  }
  _defsPromise = _askDefinitions(get)
    .then(land, () => {
      const out = land(null)
      if (gen === _defsGeneration && _defsRetryTimer === null) {
        _defsRetryTimer = setTimeout(retry, DEFINITIONS_RETRY_MS)
      }
      return out
    })
  return _defsPromise
}

/** Cancel a scheduled retry and orphan anything in flight. */
function _resetDefinitionsRequest() {
  if (_defsRetryTimer !== null) clearTimeout(_defsRetryTimer)
  _defsRetryTimer = null
  _defsGeneration += 1
}

/**
 * ⭐ What the live server row of `defId` declares — its input keys and each
 * enum input's option values — or `null` while unknown, after a failed fetch,
 * or for an id the server does not publish. Synchronous; the first call starts
 * the page's one request (see the header).
 *
 * @returns {{defId: string, inputs: string[], options: object}|null}
 */
export function serverDeclares(defId, fetcher) {
  const id = typeof defId === 'string' ? defId : ''
  if (!id) return null
  if (!_defsPromise) fetchServerDefinitions(fetcher)
  return (_defsRows && _defsRows.get(id)) || null
}

// ─── THE DEFINITION-LEVEL GATE (UCT RS split, unit U1) ────────────────────────
//
// ⭐⭐ A WHOLE DEFINITION CAN MERGE AHEAD OF ITS SERVER ROW. The per-input gate
// above hides a CONTROL until the live row declares it; the three new RS
// definitions (`rsRating`, `rsPhases`, `rsVsEma`, unit U6) have no row at all
// until `RS_SPLIT_ENABLED` is armed on the web pod (map §(e) step 1), and a
// library row that adds an indicator the server cannot compute is an empty pane
// with a name on it. So a definition declares `meta.requiresServer: true`
// (`defSchema.validateMeta`), and every surface that OFFERS indicators to add
// — the library dialog, the discovery catalogue and its search, the phone
// indicator sheet, Chart Settings' Indicators tab, the agent's catalogue —
// asks `isDefinitionOffered(def)` before listing it.
//
// ⛔ FAIL CLOSED, THE SAME WAY, FROM THE SAME FETCH. "Offered" is
// `serverDeclares(def.id) !== null`: not fetched yet, failed, malformed, or an
// id the server does not publish all read "not offered". It is the one GET the
// per-input gate already pays for — there is no second request, no second cache.
//
// ⭐ AN INSTANCE ALREADY ON A CHART IS NOT A ROW IN A LIST. The gate hides the
// OFFER only. `getDefinition` still resolves a gated definition, so a stored
// instance validates (`instances.validateInstance`), keeps its settings row and
// draws when the server answers — and draws nothing, never a guess, when it
// cannot, exactly as the columns lane already behaves.
//
// ⛔ A DEFINITION WITHOUT THE FLAG IS NEVER ASKED ABOUT. `isDefinitionOffered`
// returns true for it without touching `serverDeclares`, so listing RSI never
// spends the page's one definitions GET, and a catalogue of ungated definitions
// is exactly the list it was before this gate existed.

/** Does this definition declare the definition-level server gate (`meta.requiresServer: true`)? */
export function definitionRequiresServer(def) {
  return !!(def && def.meta && def.meta.requiresServer === true)
}

/**
 * ⭐ May a surface OFFER this definition (list it as something to add)?
 * `true` for any definition without `meta.requiresServer`; for one with it,
 * only once the live server lists its id (`serverDeclares`), which starts the
 * page's one request on first ask. `null`/non-object → false.
 */
export function isDefinitionOffered(def) {
  if (!def || typeof def !== 'object') return false
  if (!definitionRequiresServer(def)) return true
  return serverDeclares(def.id) !== null
}

/**
 * The catalogue-row form of the same question, for the surfaces that read
 * `indicatorCatalog.catalogRows()` (rows, not definitions). A row with no
 * definition behind it (a carved-out section such as `volumeProfile`, a
 * built-in row) is offered: there is nothing to gate. `registry` is whatever
 * the surface was handed (`getDefinition`); absent, every row is offered.
 */
export function isCatalogRowOffered(row, registry) {
  if (!row || typeof row !== 'object') return false
  const id = typeof row.id === 'string' ? row.id : (typeof row.defId === 'string' ? row.defId : '')
  if (!id || !registry || typeof registry.getDefinition !== 'function') return true
  let def = null
  try { def = registry.getDefinition(id) } catch { def = null }
  return def ? isDefinitionOffered(def) : true
}

/**
 * A number that moves on every landing (success, failure or prime) of the
 * definitions answer: the `useSyncExternalStore` snapshot a surface keys its
 * offered-list memo on, beside `subscribeServerDefinitions`.
 */
export function serverDefinitionsVersion() {
  return _defsVersion
}

/** Seed the answer from a body somebody already holds (and the test seam). */
export function primeServerDefinitions(body) {
  _resetDefinitionsRequest()
  _defsRows = _declarationsFromBody(body)
  _defsPromise = Promise.resolve(_defsRows)
  _notifyDefinitions()
  _notify('definitions')
  return _defsRows
}

/** Test seam: forget the answer and the request, as a new page load would. */
export function clearServerDefinitions() {
  _resetDefinitionsRequest()
  _defsRows = null
  _defsPromise = null
}

/** Test seam: arm (or, with null, disarm) the request for the whole module. */
export function __setServerDefinitionsFetcherForTests(fn) {
  _defsTestFetcher = typeof fn === 'function' ? fn : null
}
