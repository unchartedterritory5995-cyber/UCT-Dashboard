// app/src/components/chart/engine/fundamentalSeries.js
//
// ─── THE CHART'S HALF OF THE FUNDAMENTALS SEAM: CATALOGUE + SERIES CACHE ─────
//
// ⭐⭐ THE SAME SHAPE AS `secondaryBars.js`, DELIBERATELY. The binder is
// synchronous and fundamental series arrive later; this module owns the request
// and the cache, `useFundamentalSources` owns the React half, and the binder
// reads a ready map. Same statuses (`SOURCE_STATUS`), same rules:
//   • deduped per URL — every consumer of one symbol costs one request;
//   • a 401/403 is DENIED and TERMINAL (asking again cannot change the answer);
//   • an error is NOT cached, but it is not re-asked on every paint either — a
//     backoff schedule decides when, and one notification wakes the chart.
//
// ⛔ NO SEC, NO PROVIDER. `/api/fundamentals/pit/*` serves UCT's own published
// point-in-time series; a member's chart load never reaches the filing source.
//
// Wire format (api/routers/fundamentals_pit.py):
//   catalog: { metrics: [{ id, name, category, series, compose, inputs, unit,
//              fmt, presentation, cadence, subtitle, aliases, ... }] }
//   series:  { symbol, metrics: { seriesId: [[t_eff, v, 'YYYY-MM-DD', method], ...] },
//              missing: [...], split_status, withheld_split_sensitive }
import { SOURCE_STATUS } from './secondaryBars'

export { SOURCE_STATUS }

const CATALOG_URL = '/api/fundamentals/pit/catalog'
const SERIES_PATH = '/api/fundamentals/pit/series/'
const DENIED = new Set([401, 403])

// ─── the catalogue ──────────────────────────────────────────────────────────

let _catalog = { status: SOURCE_STATUS.LOADING, byId: new Map(), list: [], categories: [] }
let _catalogInflight = null
let _catalogRetryAt = 0
const _subscribers = new Set()

function _notify() {
  for (const fn of [..._subscribers]) {
    try { fn() } catch { /* a subscriber's failure is its own */ }
  }
}

/** Subscribe to "something landed" — catalogue or series. Returns unsubscribe. */
export function subscribe(fn) {
  _subscribers.add(fn)
  return () => _subscribers.delete(fn)
}

function _status(err) {
  const s = err && (err.status ?? err.httpStatus)
  return Number.isFinite(s) ? s : null
}

function _defaultFetch(url) {
  return fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status}`)
      err.httpStatus = r.status
      throw err
    }
    return r.json()
  })
}

let _fetcher = _defaultFetch
/** Test / harness seam: route requests through a different fetcher. */
export function setFundamentalsFetcher(fn) { _fetcher = typeof fn === 'function' ? fn : _defaultFetch }

/**
 * The catalogue, synchronously — `{status, byId, list, categories}`. Asks for it
 * (once) when absent. UNAVAILABLE (flag off / 404) and DENIED are terminal for
 * the session: a dark feature is not re-probed on every paint.
 */
export function fundamentalsCatalog() {
  const s = _catalog.status
  if (s === SOURCE_STATUS.LOADING && !_catalogInflight && Date.now() >= _catalogRetryAt) {
    _catalogInflight = Promise.resolve()
      .then(() => _fetcher(CATALOG_URL))
      .then((body) => {
        const list = Array.isArray(body && body.metrics) ? body.metrics : []
        _catalog = {
          status: list.length ? SOURCE_STATUS.AVAILABLE : SOURCE_STATUS.NO_DATA,
          byId: new Map(list.map((m) => [m.id, Object.freeze({ ...m })])),
          list,
          categories: Array.isArray(body.categories) ? body.categories : [],
        }
      })
      .catch((err) => {
        const code = _status(err)
        if (DENIED.has(code)) _catalog = { ..._catalog, status: SOURCE_STATUS.DENIED }
        else if (code === 404) _catalog = { ..._catalog, status: SOURCE_STATUS.UNSUPPORTED }
        else _catalogRetryAt = Date.now() + 30_000       // transient: ask again later, not now
      })
      .finally(() => { _catalogInflight = null; _notify() })
  }
  return _catalog
}

/** One catalogue entry, or null (unknown id, or the catalogue not loaded yet). */
export function catalogMetric(id) {
  return fundamentalsCatalog().byId.get(id) || null
}

/** The stored series a metric needs: its own, or its composer's inputs. */
export function seriesIdsFor(metric) {
  if (!metric) return []
  if (metric.compose) return Array.isArray(metric.inputs) ? [...metric.inputs] : []
  return metric.series ? [metric.series] : []
}

// ─── the series cache ──────────────────────────────────────────────────────

const _cache = new Map()      // url -> entry {status, series: {id: points[]}, missing, meta}
const _inflight = new Map()
const _retry = new Map()      // url -> {attempt, readyAt}

export function seriesUrl(symbol, seriesIds) {
  const s = typeof symbol === 'string' ? symbol.trim().toUpperCase() : ''
  const ids = [...new Set((seriesIds || []).filter(Boolean))].sort()
  if (!s || !ids.length) return null
  return `${SERIES_PATH}${encodeURIComponent(s)}?series=${ids.map(encodeURIComponent).join(',')}`
}

/** [[t, v, pe, method]] -> [{t, v, pe, m}] ONCE, so the projection memo can key
 *  on array identity.
 *
 *  ⛔⛔ A GAP POINT IS KEPT. `[t, null, pe, 'gap']` means "from t, the newest
 *  filed period is unknown". Dropping it for its null value -- which this filter
 *  did -- silently bridges the PREVIOUS value through the gap, the one outcome the
 *  owner ruled out ("show a gap, never wrong data"). Any other non-finite value
 *  is malformed and is dropped as before. */
export function _points(raw) {
  return Object.freeze((Array.isArray(raw) ? raw : [])
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0])
      && (Number.isFinite(p[1]) || (p[1] === null && p[3] === 'gap')))
    .map((p) => Object.freeze({ t: p[0], v: p[1], pe: p[2] || null, m: p[3] || null })))
}

function _read(body) {
  const series = {}
  const metrics = body && body.metrics && typeof body.metrics === 'object' ? body.metrics : {}
  for (const [id, raw] of Object.entries(metrics)) series[id] = _points(raw)
  const has = Object.values(series).some((p) => p.length)
  return Object.freeze({
    status: has ? SOURCE_STATUS.AVAILABLE : SOURCE_STATUS.NO_DATA,
    series: Object.freeze(series),
    missing: Object.freeze(Array.isArray(body && body.missing) ? [...body.missing] : []),
    meta: Object.freeze({
      cik: body && body.cik, name: body && body.name,
      splitStatus: body && body.split_status,
      withheldSplitSensitive: !!(body && body.withheld_split_sensitive),
    }),
  })
}

function _fetch(url) {
  if (_inflight.has(url)) return _inflight.get(url)
  const p = Promise.resolve()
    .then(() => _fetcher(url))
    .then((body) => { _cache.set(url, _read(body)); _retry.delete(url) })
    .catch((err) => {
      const code = _status(err)
      if (DENIED.has(code)) {
        _cache.set(url, Object.freeze({ status: SOURCE_STATUS.DENIED, series: {}, missing: [], meta: {} }))
        return
      }
      if (code === 404) {                                  // symbol not covered: a FACT, cached
        _cache.set(url, Object.freeze({ status: SOURCE_STATUS.NO_DATA, series: {}, missing: [], meta: {} }))
        return
      }
      const r = _retry.get(url) || { attempt: 0 }
      r.attempt += 1
      r.readyAt = Date.now() + Math.min(60_000, 1000 * 2 ** r.attempt)
      _retry.set(url, r)
      setTimeout(_notify, Math.max(0, r.readyAt - Date.now()) + 5)
    })
    .finally(() => { _inflight.delete(url); _notify() })
  _inflight.set(url, p)
  return p
}

const LOADING = Object.freeze({ status: SOURCE_STATUS.LOADING, series: {}, missing: [], meta: {} })
const ERROR = Object.freeze({ status: SOURCE_STATUS.ERROR, series: {}, missing: [], meta: {} })

/** Synchronous read; asks when absent (the PAINT path — backoff-gated). */
export function ensureFundamentals(symbol, seriesIds) {
  const url = seriesUrl(symbol, seriesIds)
  if (!url) return null
  const hit = _cache.get(url)
  if (hit) return hit
  const r = _retry.get(url)
  if (r && Date.now() < r.readyAt) return ERROR
  _fetch(url)
  return LOADING
}

/** `{symbol: Set(seriesIds)}` -> Map(symbol -> entry). */
export function ensureAllFundamentals(needed) {
  const out = new Map()
  for (const [sym, ids] of Object.entries(needed || {})) {
    const e = ensureFundamentals(sym, [...ids])
    if (e) out.set(sym, e)
  }
  return out
}

/** Test seam. */
export function _resetFundamentalsForTests() {
  _cache.clear(); _inflight.clear(); _retry.clear()
  _catalog = { status: SOURCE_STATUS.LOADING, byId: new Map(), list: [], categories: [] }
  _catalogInflight = null; _catalogRetryAt = 0
  _fetcher = _defaultFetch
}

/** Harness seam: prime the catalogue with a payload fetched elsewhere. */
export function primeFundamentalsCatalog(body) {
  const list = Array.isArray(body && body.metrics) ? body.metrics : []
  _catalog = { status: list.length ? SOURCE_STATUS.AVAILABLE : SOURCE_STATUS.NO_DATA,
    byId: new Map(list.map((m) => [m.id, Object.freeze({ ...m })])), list,
    categories: Array.isArray(body && body.categories) ? body.categories : [] }
  _notify()
}
