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
  if (rawCols === undefined || rawCols === null) return { times: [], columns: {} }
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
  return { times, columns }
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
export function alignColumns(parsed, bars) {
  const { times, columns } = parsed || { times: [], columns: {} }
  const series = Array.isArray(bars) ? bars : []
  const keys = Object.keys(columns || {})
  if (!keys.length) return {}
  if (!times.length) return {}

  const at = new Map()
  for (let i = 0; i < times.length; i++) if (!at.has(times[i])) at.set(times[i], i)

  const out = {}
  for (const key of keys) {
    const src = columns[key]
    const col = new Float64Array(series.length)
    for (let i = 0; i < series.length; i++) {
      const j = at.get(Number(series[i] && series[i].t))
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

/** Test seam + a symbol/timeframe change escape hatch. */
export function clearServerColumns() {
  _cache.clear()
  _inflight.clear()
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
  const parsed = ensureColumns(def.id, sym, ctx.tf, inputs, ctx.fetcher)
  if (!parsed) return {}
  return alignColumns(parsed, bars)
}
