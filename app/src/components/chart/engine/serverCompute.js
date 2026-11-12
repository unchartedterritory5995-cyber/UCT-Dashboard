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

/** The ONE path every server-lane definition is fetched through. */
export const SERVER_COLUMNS_PATH = '/api/signature/columns'

/** The ONE path the server-lane definitions themselves are published on. */
export const SERVER_DEFINITIONS_PATH = '/api/signature/definitions'

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
    _cache.delete(key)
    _notify(key)                                       // the next paint asks again
  }, DEGRADED_RETRY_MS[tries]))
}

/** Test seam + a symbol/timeframe change escape hatch. */
export function clearServerColumns() {
  _cache.clear()
  _inflight.clear()
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
  _cache.set(key, parsed)
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
  return hit === undefined ? null : hit
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
      _cache.set(key, parsed)
      _trackDegraded(key, parsed, wire)
      return parsed
    })
    .catch(() => {
      // Quiet on purpose, exactly like `useSignatureIndicators`' fetcher: the
      // lane is paid-gated, so a 402 is a routine state and not an incident. The
      // failure is NOT cached — an absent entry retries on the next paint, a
      // cached empty one would be remembered as "no data" forever.
      _cache.delete(key)
      return null
    })
    .finally(() => {
      _inflight.delete(key)
      _notify(key)
    })
  _inflight.set(key, p)
  return p
}

function _defaultFetch(url) {
  return fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })
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
  if (key && !_inflight.has(key)) fetchColumns(defId, sym, tf, inputs, fetcher)
  return null
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
  return withDerivedColumns(def, live, inputs)
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
