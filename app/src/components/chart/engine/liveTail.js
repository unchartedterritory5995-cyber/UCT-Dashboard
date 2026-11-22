// app/src/components/chart/engine/liveTail.js
//
// ─── THE LIVE LAST POINT OF A SERVER COLUMN — `plots[].liveTail` (RS split, U2b) ──
//
// The server lane caches an envelope per ET session day on D/W/M (TTL to the next
// session close, `rs_provider.py`) and for 900 s intraday. The HISTORY in it is
// right for the whole session; the LAST cell is the forming bar's value as it
// stood when the envelope was built, and it stays there while the candle moves.
// MarketSurge and Deepvue move the RS line with price. This module moves the one
// cell that is live — the forming bar's — on the client, from two numbers the
// chart already has or can ask cheaply for:
//
//   ratio   last = close / benchmarkClose (× `scale`), the definition of an RS
//           line, with the benchmark's forming bar read from the bars endpoint
//           the chart's own candle comes from (`/api/bars`, same store, same
//           session anchoring), joined BY TIME.
//   ma      last = the cached average continued one step with the live ratio in
//           place of the stale one. Both averages are linear in their newest term,
//           so the step is exact against the server's own value:
//             EMA: ma + k·(liveRs − staleRs), k = 2/(L+1)
//             SMA: ma + (liveRs − staleRs)/L
//           (and when the envelope ends one bar before the chart — built before
//           the forming bar existed in the store — the step starts from the last
//           sealed average: EMA ma₋₁ + k·(liveRs − ma₋₁); SMA drops the L-th value
//           back, gap-skipping exactly as `rs_moving_average` does.)
//
// ⛔ FAIL CLOSED, EVERY WAY, AND NEVER A LINE OF ITS OWN. A tail CONTINUES a
// server line: no finite server value on the last or the second-to-last bar, no
// patch (a degraded envelope that drew nothing must not grow a single dot). No
// benchmark symbol in the payload, a synthetic one (`INDUSTRY:…`), the chart's own
// symbol, no benchmark bar at the chart's last time, a non-finite or non-positive
// close, a bar the server has already sealed (`newestBarIsForming === false`),
// an average length or type that does not resolve: the server's value stands.
// A patched value is never kept anywhere: it is recomputed from the cached
// envelope on every compute, so a wrong tail lives one paint.
//
// ⭐ ONE BENCHMARK TAIL PER (SYMBOL, TIMEFRAME) FOR THE WHOLE PAGE. Sixteen RS
// instances on a grid share one `SPY:D` entry and one in-flight request. The
// entry is re-asked only when a compute asks for it and it is older than
// `benchmarkTailMaxAgeMs(tf)` — half the chart's own bars poll (30 s intraday,
// 300 s D/W/M in `StockChart`), so the benchmark is never asked faster than the
// stock is, and the tail is never older than the stock's own refresh. A landed
// tail is announced (`subscribeBenchmarkTails`) so the lane repaints exactly as
// it does for a landed envelope, and its version rides the binder's compute memo
// signature (`nativeRegistry.computeSignature`) so the repaint recomputes.
//
// ⛔ NO TENANT HERE. Every value is addressed through the definition: the
// benchmark by a `scalar:` path of the envelope's payload, the length and type by
// a literal or an `input:` key — the readout's own source grammar
// (`readoutSchema.readoutSourceValue`), one resolver for both. `defSchema.
// validateLiveTails` holds the grammar fail-closed; `serverCompute.test.js`'s
// source scan keeps the lane free of definition ids.

//
// ⛔ NOT IN THE COMPUTE CLOSURE, AND NO NETWORK OF ITS OWN (fix lane F2,
// 2026-11-10). The grammar `defSchema.js` validates against is the leaf
// `liveTailSchema.js` (re-exported below), so the runtime lane's closure never
// reaches this store. And the store does not know how to ASK: the request is the
// host's, registered through `registerBenchmarkTailRequest` by the door that
// already owns the envelope's own request (`serverCompute.js`, on import); a host
// that never registers one (the test host, by `test-setup.js`; any other
// process) asks for nothing and the server's value stands — unregistered is
// OFF, as `lowerTfServing.js` reads its gate. No `import.meta.env` here: which
// host this is was a build-flag read (`MODE === 'test'`), and a build flag
// inside the lane is a second authority (SERVER-RUNTIME-DESIGN.md 2.2 H3).

import { readoutSourceValue } from './readoutSchema'
import { LIVE_TAIL_KINDS, LIVE_TAIL_FIELDS, LIVE_TAIL_MA_TYPES } from './liveTailSchema'

/** The grammar, from its leaf (`liveTailSchema.js`): one import for every reader. */
export { LIVE_TAIL_KINDS, LIVE_TAIL_FIELDS, LIVE_TAIL_MA_TYPES }

/** How many benchmark bars one tail request asks for: the forming bar, the
 *  sealed one before it (the time join needs no more), and one spare for a
 *  store whose newest row is a bar ahead of the chart's. */
export const BENCHMARK_TAIL_BARS = 3

/** The oldest a benchmark tail may be before a compute asks again: HALF the
 *  chart's own bars poll (`StockChart`: ~30 s intraday, 300 s D/W/M), so a stock
 *  refresh always finds its benchmark due and the benchmark is never asked
 *  faster than the stock. */
export const BENCHMARK_TAIL_MAX_AGE_MS = Object.freeze({ intraday: 15_000, session: 60_000 })

/** Past this multiple of the max age an entry is not used at all (a tab asleep
 *  for an hour must not pair a fresh stock close with a stale benchmark); the
 *  refetch is in flight and the server's value stands until it lands. */
export const BENCHMARK_TAIL_HARD_STALE_FACTOR = 10

const SESSION_TFS = new Set(['D', 'W', 'M'])

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/** The max age for one timeframe code (the chart's own: '1'…'60', 'D', 'W', 'M'). */
export function benchmarkTailMaxAgeMs(tf) {
  return SESSION_TFS.has(String(tf == null ? 'D' : tf).toUpperCase())
    ? BENCHMARK_TAIL_MAX_AGE_MS.session : BENCHMARK_TAIL_MAX_AGE_MS.intraday
}

// ─── Pure math ──────────────────────────────────────────────────────────────

/** `close / benchClose × scale`, or NaN unless both closes are finite and
 *  positive and the scale is finite and positive. */
export function ratioTail(close, benchClose, scale = 1) {
  const s = scale === undefined ? 1 : scale
  if (!isNum(close) || !isNum(benchClose) || !isNum(s)) return NaN
  if (close <= 0 || benchClose <= 0 || s <= 0) return NaN
  return (close / benchClose) * s
}

/**
 * The cached average's last point continued with the live ratio, or NaN.
 *
 * @param {{ma: ArrayLike<number>, rs: ArrayLike<number>, liveRs: number, length: number, type: string}} a
 *   `ma` and `rs` are the SERVER's columns (the stale ones), same length;
 *   `length` a whole number ≥ 1; `type` 'EMA' or 'SMA' (any case).
 * @returns {number} NaN when the step cannot be made exactly.
 */
export function movingAverageTail({ ma, rs, liveRs, length, type }) {
  if (!ma || !rs || typeof ma.length !== 'number' || ma.length !== rs.length) return NaN
  const n = ma.length
  if (n < 2 || !isNum(liveRs)) return NaN
  const L = Number(length)
  if (!Number.isInteger(L) || L < 1) return NaN
  const kind = typeof type === 'string' ? type.toUpperCase() : ''
  if (!LIVE_TAIL_MA_TYPES.includes(kind)) return NaN
  const last = ma[n - 1]
  const prev = ma[n - 2]
  // Case A — the envelope reaches the chart's last bar: replace the newest term.
  // `prev` finite keeps the step off the seed bar (an EMA's first value is an
  // SMA seed, whose newest-term weight is 1/L and not k).
  if (isNum(last) && isNum(rs[n - 1]) && isNum(prev)) {
    if (kind === 'EMA') return last + (2 / (L + 1)) * (liveRs - rs[n - 1])
    return last + (liveRs - rs[n - 1]) / L
  }
  // Case B — the envelope ends one bar before the chart (built before the
  // forming bar reached the store): one step forward from the sealed average.
  if (!isNum(last) && isNum(prev)) {
    if (kind === 'EMA') return prev + (2 / (L + 1)) * (liveRs - prev)
    // SMA over the VALID values, as the server computes it: the value that leaves
    // the window is the L-th finite ratio counting back from the sealed bar.
    let seen = 0
    for (let i = n - 2; i >= 0; i -= 1) {
      if (!isNum(rs[i])) continue
      seen += 1
      if (seen === L) return prev + (liveRs - rs[i]) / L
    }
    return NaN
  }
  return NaN
}

/** The payload's resolved benchmark as a symbol the bars endpoint can serve, or
 *  null: a plain ticker spelling only (never a synthetic `INDUSTRY:…` group),
 *  and never the chart's own symbol (close over itself is a flat 1). */
const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,11}$/
export function liveBenchmarkSymbol(resolved, chartSym) {
  if (typeof resolved !== 'string') return null
  const s = resolved.trim().toUpperCase()
  if (!TICKER_RE.test(s)) return null
  if (typeof chartSym === 'string' && chartSym.trim().toUpperCase() === s) return null
  return s
}

// ─── The definition's declarations ──────────────────────────────────────────

/** The plots carrying a `liveTail`, ratio kinds FIRST (an `ma` continues a ratio
 *  the same pass computed). Empty for a definition that declares none. */
export function liveTailPlots(def) {
  const plots = def && Array.isArray(def.plots) ? def.plots : []
  const out = plots.filter((p) => p && typeof p.key === 'string' && p.liveTail && typeof p.liveTail === 'object')
  return out.sort((a, b) => (a.liveTail.kind === 'ratio' ? 0 : 1) - (b.liveTail.kind === 'ratio' ? 0 : 1))
}

export function definitionHasLiveTail(def) {
  return liveTailPlots(def).length > 0
}

/** A literal number, or an `input:<key>` read through the readout grammar. */
function resolveNumber(spec, def, inputs) {
  const v = typeof spec === 'string' ? readoutSourceValue(spec, null, def, inputs) : spec
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

/** A literal type word, or an `input:<key>` read through the readout grammar. */
function resolveType(spec, def, inputs) {
  if (spec === undefined) return 'EMA'
  const v = typeof spec === 'string' && spec.startsWith('input:') ? readoutSourceValue(spec, null, def, inputs) : spec
  return typeof v === 'string' ? v.toUpperCase() : ''
}

/** The benchmark close at the chart's last time, joined by `timeKey`, or NaN. */
function benchCloseAt(entry, key, timeKey) {
  const bars = entry && Array.isArray(entry.bars) ? entry.bars : null
  if (!bars || !isNum(key)) return NaN
  for (let i = bars.length - 1; i >= 0; i -= 1) {
    const b = bars[i]
    if (b && timeKey(b.t) === key) return isNum(b.c) ? b.c : NaN
  }
  return NaN
}

/**
 * The aligned columns with every declared `liveTail` applied to the LAST bar.
 *
 * Returns the SAME object when nothing changed (so a memo keyed on it still
 * hits), otherwise a shallow copy with a COPIED column per patched plot — the
 * aligned columns of a cached envelope are never mutated.
 *
 * @param {object} def a server-lane definition
 * @param {object} columns `{key: Float64Array}` as `alignColumns` returned them
 * @param {Array<{t: number|string, c: number}>} bars the chart's own bars
 * @param {object} inputs the instance's inputs (declared defaults under the stored)
 * @param {{
 *   scalars: object|null, sym: string, tf: string|number|null|undefined,
 *   newestBarIsForming?: boolean|null, timeKey: (t: unknown) => number,
 *   tail: (sym: string, tf: unknown) => ({bars: Array<{t: unknown, c: number}>}|null),
 * }} opts `timeKey` is the lane's own join (`serverCompute.barTimeKey`); `tail`
 *   reads the benchmark tail (the store's `benchmarkTailFor`, or a test's).
 */
export function withLiveTail(def, columns, bars, inputs, opts) {
  const plots = liveTailPlots(def)
  if (!plots.length || !columns || typeof columns !== 'object') return columns
  const o = opts || {}
  // A sealed newest bar is the server's; nothing to move.
  if (o.newestBarIsForming === false) return columns
  if (typeof o.timeKey !== 'function' || typeof o.tail !== 'function') return columns
  const series = Array.isArray(bars) ? bars : []
  const n = series.length
  if (n < 2) return columns
  const last = series[n - 1]
  const close = last ? Number(last.c) : NaN
  if (!isNum(close) || close <= 0) return columns
  const lastKey = o.timeKey(last.t)
  const ins = inputs && typeof inputs === 'object' ? inputs : {}

  let out = null
  const live = new Map()   // plot key -> the live value this pass settled on
  const write = (key, col, v) => {
    live.set(key, v)
    if (col[n - 1] === v) return
    if (!out) out = { ...columns }
    const copy = new Float64Array(col)
    copy[n - 1] = v
    out[key] = copy
  }

  for (const p of plots) {
    const lt = p.liveTail
    const col = columns[p.key]
    if (!col || typeof col.length !== 'number' || col.length !== n) continue
    if (lt.kind === 'ratio') {
      // A tail continues a line: the server must have drawn to (or to one bar
      // before) the chart's last bar.
      if (!isNum(col[n - 1]) && !isNum(col[n - 2])) continue
      const resolved = readoutSourceValue(lt.benchmark, o.scalars, def, ins)
      const bench = liveBenchmarkSymbol(resolved, o.sym)
      if (!bench) continue
      const entry = o.tail(bench, o.tf)
      const v = ratioTail(close, benchCloseAt(entry, lastKey, o.timeKey), lt.scale)
      if (isNum(v)) write(p.key, col, v)
    } else if (lt.kind === 'ma') {
      const liveRs = live.get(lt.of)
      if (!isNum(liveRs)) continue
      const v = movingAverageTail({
        ma: col, rs: columns[lt.of], liveRs,
        length: Math.round(resolveNumber(lt.length, def, ins)),
        type: resolveType(lt.type, def, ins),
      })
      if (isNum(v)) write(p.key, col, v)
    }
  }
  return out || columns
}

// ─── The benchmark tail store ───────────────────────────────────────────────
//
// One entry per `SYM:TF`, the newest BENCHMARK_TAIL_BARS bars of `/api/bars`, the
// same route and store the chart's own candle is served from. Deduped in flight,
// re-asked only when a compute reads a due entry, announced when it lands.

const _tails = new Map()       // key -> {sym, tf, bars: Array|null, fetchedAt, version}
const _inflight = new Map()    // key -> Promise
const _subscribers = new Set()
let _version = 0
let _request = null            // the host's request for one URL, or null: this host asks for nothing

/**
 * The host's request for a benchmark tail: `(url) => Promise<barsBody>`, or
 * `null` to take it away. The door registers the browser's (`serverCompute.js`,
 * on import, the same `fetch` its envelopes use); the test host disarms it before
 * every test (`test-setup.js`) and a suite arms a counting one through
 * `__setBenchmarkTailFetcherForTests`. ⛔ Unregistered, the store never asks:
 * the server's value stands, nothing is guessed.
 */
export function registerBenchmarkTailRequest(fn) {
  _request = typeof fn === 'function' ? fn : null
}

function tailKey(sym, tf) {
  return `${String(sym).toUpperCase()}:${String(tf == null ? 'D' : tf)}`
}

/** The request URL for one benchmark tail — pure and exported so a call site
 *  can be asserted without a network. */
export function benchmarkTailUrl(sym, tf) {
  const s = typeof sym === 'string' ? sym.trim() : ''
  if (!s) return null
  return `/api/bars/${encodeURIComponent(s)}?tf=${encodeURIComponent(String(tf == null ? 'D' : tf))}&bars=${BENCHMARK_TAIL_BARS}`
}

/** Notified with the entry key when a benchmark tail lands (or fails). @returns {() => void} */
export function subscribeBenchmarkTails(fn) {
  if (typeof fn !== 'function') return () => {}
  _subscribers.add(fn)
  return () => { _subscribers.delete(fn) }
}

function _notify(key) {
  for (const fn of [..._subscribers]) {
    try { fn(key) } catch { /* a bad subscriber must not break the lane */ }
  }
}

/** The bars payload → the newest tail bars `[{t, c}]`, or null for a body that is not one. */
export function tailBarsFromWire(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.bars)) return null
  const rows = body.bars.slice(-BENCHMARK_TAIL_BARS)
  const out = []
  for (const b of rows) {
    if (!b || typeof b !== 'object' || b.t === undefined || b.t === null) continue
    // `null` ⇄ NaN at this boundary, as the columns lane does: JSON has no NaN.
    const c = (b.c === null || b.c === undefined) ? NaN : Number(b.c)
    out.push({ t: b.t, c: Number.isFinite(c) ? c : NaN })
  }
  return out
}

function _land(key, sym, tf, bars, now) {
  _version += 1
  _tails.set(key, { sym, tf, bars, fetchedAt: now, version: _version })
  _notify(key)
}

function _fetchTail(sym, tf, key, fetcher, now) {
  // The call's own request first, else the host's registered one, else nothing.
  const get = typeof fetcher === 'function' ? fetcher : _request
  if (!get) return
  const url = benchmarkTailUrl(sym, tf)
  if (!url) return
  // The ask goes out SYNCHRONOUSLY (a throwing fetcher is a rejection, never a
  // throw on the paint path), so a call site can count requests without a tick.
  let asked
  try { asked = Promise.resolve(get(url)) } catch (err) { asked = Promise.reject(err) }
  const p = asked
    .then((body) => {
      const bars = tailBarsFromWire(body)
      if (!bars) throw new Error('malformed bars body')
      _land(key, sym, tf, bars, typeof now === 'number' ? now : Date.now())
    })
    .catch(() => {
      // A failure is remembered as "no bars" for one max-age window: the server's
      // value stands, and the next due compute asks again — never a retry storm.
      _land(key, sym, tf, null, typeof now === 'number' ? now : Date.now())
    })
    .finally(() => { _inflight.delete(key) })
  _inflight.set(key, p)
}

/**
 * The newest landed tail for `(sym, tf)`, or null — and the ask, when the entry
 * is missing or due. Synchronous, like `serverCompute.ensureColumns`: the
 * compute that reads it runs inside a paint.
 *
 * @param {string} sym the benchmark ticker
 * @param {unknown} tf the chart's timeframe code
 * @param {{fetcher?: (url: string) => Promise<any>, now?: number}} [opts] test seams
 * @returns {{bars: Array<{t: unknown, c: number}>, fetchedAt: number, version: number}|null}
 */
export function benchmarkTailFor(sym, tf, opts) {
  const s = typeof sym === 'string' ? sym.trim().toUpperCase() : ''
  if (!s) return null
  const key = tailKey(s, tf)
  const now = opts && typeof opts.now === 'number' ? opts.now : Date.now()
  const hit = _tails.get(key) || null
  const maxAge = benchmarkTailMaxAgeMs(tf)
  const age = hit ? now - hit.fetchedAt : Infinity
  if (age >= maxAge && !_inflight.has(key)) _fetchTail(s, tf, key, opts && opts.fetcher, now)
  if (!hit || !hit.bars || age >= maxAge * BENCHMARK_TAIL_HARD_STALE_FACTOR) return null
  return hit
}

/** The store's version for `(sym, tf)` — changes when a tail lands. `'0'` for none. */
export function benchmarkTailVersion(sym, tf) {
  const hit = _tails.get(tailKey(sym, tf))
  return hit ? String(hit.version) : '0'
}

/**
 * The part of a compute's memo key that a landed benchmark tail moves: for every
 * `ratio` tail the definition declares, the benchmark it resolves to on this
 * payload and the store's version for it. `''` when the definition declares no
 * tail or the payload has not landed (nothing to move yet).
 */
export function liveTailSignature(def, scalars, inputs, sym, tf) {
  const plots = liveTailPlots(def)
  if (!plots.length || !scalars) return ''
  const parts = []
  for (const p of plots) {
    if (p.liveTail.kind !== 'ratio') continue
    const bench = liveBenchmarkSymbol(readoutSourceValue(p.liveTail.benchmark, scalars, def, inputs || {}), sym)
    if (!bench) continue
    parts.push(`${tailKey(bench, tf)}@${benchmarkTailVersion(bench, tf)}`)
  }
  return parts.join(',')
}

/** Seed a tail somebody already holds (and the test seam). */
export function primeBenchmarkTail(sym, tf, bars, now) {
  const s = typeof sym === 'string' ? sym.trim().toUpperCase() : ''
  if (!s || !Array.isArray(bars)) return null
  _land(tailKey(s, tf), s, tf, bars.map((b) => ({ t: b.t, c: Number(b.c) })), typeof now === 'number' ? now : Date.now())
  return _tails.get(tailKey(s, tf))
}

/** Test seam: forget every tail and request, as a new page load would. */
export function _resetBenchmarkTailsForTests() {
  _tails.clear()
  _inflight.clear()
  _version = 0
}

/** Test seam: arm (or, with null, disarm) the request for the whole module — the
 *  test host's spelling of `registerBenchmarkTailRequest`, kept so a suite reads
 *  as one that counts requests it armed itself. */
export function __setBenchmarkTailFetcherForTests(fn) {
  registerBenchmarkTailRequest(fn)
}

/** Test seam: the in-flight promises, to await a landing. */
export function _inflightBenchmarkTails() {
  return [..._inflight.values()]
}
