// app/src/components/chart/engine/economicSeries.js
//
// ─── THE CHART'S HALF OF THE ECONOMIC-DATA SEAM: CATALOGUE + SERIES CACHE ───
//
// ⭐⭐ `fundamentalSeries.js`' TWIN, DELIBERATELY THE SAME SHAPE. The binder is
// synchronous and economic series arrive later; this module owns the request and
// the cache, a caller (the harness today, a `useEconomicSources` hook in Phase 2)
// owns the React half, and the binder reads a ready map. Same statuses
// (`SOURCE_STATUS`), same rules:
//   • deduped per URL — every consumer of one series costs one request;
//   • a 401/403 is DENIED and TERMINAL (asking again cannot change the answer);
//   • a 404 is NO_DATA — the registry does not carry that symbol, a FACT, cached;
//   • any other error is NOT cached, and is not re-asked on every paint either —
//     a backoff schedule decides when, and one notification wakes the chart.
//
// ⛔⛔ NEVER `/api/bars`, NEVER `sym:`. `/api/econ/*` serves UCT's own published
// observation store (docs/economic-data/PHASE1-DESIGN.md, "Member API"). An
// economic series has no bars and no OHLC; routing it through the bars lane would
// fabricate candles and forward-fill it on a session calendar.
//
// Wire format (api/routers/econ.py):
//   catalog: { series: [{ symbol, id, name, short_name, frequency, week_anchor,
//              units:{display, fmt, scale}, presentation:{style}, source, ... }],
//              attributions: {...} }
//   series:  { id, symbol, view, asof, meta:{...catalog row...},
//              currentness:{state, latest_period, expected_period, next_release},
//              columns:['t','v','ps','pe','pit'],
//              points:[[t_available_unix, v|null, 'YYYY-MM-DD', 'YYYY-MM-DD', pit], ...] }
import { SOURCE_STATUS } from './secondaryBars'
import { economicSymbolOf } from './economicGrammar'

export { SOURCE_STATUS }

export const ECON_CATALOG_URL = '/api/econ/catalog'
export const ECON_SERIES_PATH = '/api/econ/series/'
const DENIED = new Set([401, 403])

// ─── plumbing ────────────────────────────────────────────────────────────────

const _subscribers = new Set()
function _notify() {
  for (const fn of [..._subscribers]) {
    try { fn() } catch { /* a subscriber's failure is its own */ }
  }
}

/** Subscribe to "something landed" — catalogue or series. Returns unsubscribe. */
export function subscribeEconomic(fn) {
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
export function setEconomicFetcher(fn) { _fetcher = typeof fn === 'function' ? fn : _defaultFetch }

// ─── the catalogue ──────────────────────────────────────────────────────────

const EMPTY_CATALOG = () => ({ status: SOURCE_STATUS.LOADING, bySymbol: new Map(), list: [], attributions: {} })
let _catalog = EMPTY_CATALOG()
let _catalogInflight = null
let _catalogRetryAt = 0

function _readCatalog(body) {
  const list = Array.isArray(body && body.series) ? body.series.filter((r) => r && typeof r.symbol === 'string') : []
  return {
    status: list.length ? SOURCE_STATUS.AVAILABLE : SOURCE_STATUS.NO_DATA,
    bySymbol: new Map(list.map((r) => [r.symbol.toUpperCase(), Object.freeze({ ...r })])),
    list,
    attributions: (body && body.attributions && typeof body.attributions === 'object') ? body.attributions : {},
  }
}

/**
 * The catalogue, synchronously — `{status, bySymbol, list, attributions}`. Asks
 * for it (once) when absent. UNSUPPORTED (flag off / 404) and DENIED are terminal
 * for the session: a dark feature is not re-probed on every paint.
 */
export function economicCatalog() {
  if (_catalog.status === SOURCE_STATUS.LOADING && !_catalogInflight && Date.now() >= _catalogRetryAt) {
    _catalogInflight = Promise.resolve()
      .then(() => _fetcher(ECON_CATALOG_URL))
      .then((body) => { _catalog = _readCatalog(body) })
      .catch((err) => {
        const code = _status(err)
        if (DENIED.has(code)) _catalog = { ..._catalog, status: SOURCE_STATUS.DENIED }
        else if (code === 404) _catalog = { ..._catalog, status: SOURCE_STATUS.UNSUPPORTED }
        else _catalogRetryAt = Date.now() + 30_000        // transient: ask again later, not now
      })
      .finally(() => { _catalogInflight = null; _notify() })
  }
  return _catalog
}

/** Harness seam: prime the catalogue with a payload fetched elsewhere. */
export function primeEconomicCatalog(body) {
  _catalog = _readCatalog(body)
  _notify()
}

// ─── the series cache ───────────────────────────────────────────────────────

const _cache = new Map()      // url -> entry
const _inflight = new Map()
const _retry = new Map()      // url -> {attempt, readyAt}

/** `/api/econ/series/USCPI` (+ `?asof=` for a point-in-time view); null when the
 *  symbol is unreadable. Accepts `USCPI`, `econ:USCPI` or `ECON:USCPI`. */
export function economicSeriesUrl(symbol, { asof = null } = {}) {
  const s = economicSymbolOf(symbol)
  if (!s) return null
  const q = Number.isFinite(asof) ? `?asof=${Math.floor(asof)}` : ''
  return `${ECON_SERIES_PATH}${encodeURIComponent(s)}${q}`
}

/**
 * `[[t, v, ps, pe, pit]]` -> `[{t, v, ps, pe, pit}]` ONCE, frozen, so the
 * projection memo can key on array identity.
 *
 * ⛔⛔ A NULL VALUE IS KEPT. `v: null` is a provider-stated MISSING observation
 * (BLS `-` for October 2025 CPI, the appropriations lapse) — it ENDS the previous
 * value in `projectAsOf` rather than letting it be carried across. Dropping it
 * would silently bridge. Any row with a non-finite `t`, or a value that is neither
 * finite nor null, is malformed and dropped.
 *
 * Reads by COLUMN NAME when the payload states `columns`, so a server that adds
 * a column cannot shift `pe` into `ps`.
 */
export function _econPoints(raw, columns = null) {
  const cols = Array.isArray(columns) && columns.length ? columns : ['t', 'v', 'ps', 'pe', 'pit']
  const at = (k) => cols.indexOf(k)
  const it = at('t'); const iv = at('v'); const ips = at('ps'); const ipe = at('pe'); const ipit = at('pit')
  if (it < 0 || iv < 0) return Object.freeze([])
  const out = []
  for (const p of (Array.isArray(raw) ? raw : [])) {
    if (!Array.isArray(p)) continue
    const t = p[it]
    const v = p[iv]
    if (!Number.isFinite(t)) continue
    if (!(Number.isFinite(v) || v === null)) continue
    out.push(Object.freeze({
      t,
      v,
      ps: (ips >= 0 && typeof p[ips] === 'string') ? p[ips] : null,
      pe: (ipe >= 0 && typeof p[ipe] === 'string') ? p[ipe] : null,
      pit: (ipit >= 0 && typeof p[ipit] === 'string') ? p[ipit] : null,
    }))
  }
  // The contract says sorted by (t, pe); a projection walks it once, so it is
  // ENFORCED rather than trusted.
  out.sort((a, b) => (a.t - b.t) || String(a.pe || '').localeCompare(String(b.pe || '')))
  return Object.freeze(out)
}

/** A series payload -> the frozen cache entry the binder reads. */
export function readEconomicSeries(body) {
  const points = _econPoints(body && body.points, body && body.columns)
  const meta = (body && body.meta && typeof body.meta === 'object') ? Object.freeze({ ...body.meta }) : Object.freeze({})
  return Object.freeze({
    status: points.length ? SOURCE_STATUS.AVAILABLE : SOURCE_STATUS.NO_DATA,
    symbol: (body && typeof body.symbol === 'string') ? body.symbol.toUpperCase() : (meta.symbol || null),
    view: (body && body.view) || 'latest',
    asof: (body && Number.isFinite(body.asof)) ? body.asof : null,
    points,
    meta,
    currentness: (body && body.currentness && typeof body.currentness === 'object') ? Object.freeze({ ...body.currentness }) : null,
  })
}

const _final = (status) => Object.freeze({ status, symbol: null, points: Object.freeze([]), meta: Object.freeze({}), currentness: null })
const LOADING = _final(SOURCE_STATUS.LOADING)
const ERROR = _final(SOURCE_STATUS.ERROR)

function _fetch(url) {
  if (_inflight.has(url)) return _inflight.get(url)
  const p = Promise.resolve()
    .then(() => _fetcher(url))
    .then((body) => { _cache.set(url, readEconomicSeries(body)); _retry.delete(url) })
    .catch((err) => {
      const code = _status(err)
      if (DENIED.has(code)) { _cache.set(url, _final(SOURCE_STATUS.DENIED)); return }
      if (code === 404) { _cache.set(url, _final(SOURCE_STATUS.NO_DATA)); return }
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

/** Synchronous read; asks when absent (the PAINT path — backoff-gated).
 *  null only for an unreadable symbol. */
export function ensureEconomicSeries(symbol, opts = {}) {
  const url = economicSeriesUrl(symbol, opts)
  if (!url) return null
  const hit = _cache.get(url)
  if (hit) return hit
  const r = _retry.get(url)
  if (r && Date.now() < r.readyAt) return ERROR
  _fetch(url)
  return LOADING
}

/** Iterable of symbols -> Map(symbol -> entry) — the binder's `ctx.economics`. */
export function ensureAllEconomicSeries(symbols) {
  const out = new Map()
  for (const raw of symbols || []) {
    const s = economicSymbolOf(raw)
    if (!s || out.has(s)) continue
    const e = ensureEconomicSeries(s)
    if (e) out.set(s, e)
  }
  return out
}

/** Awaitable twin for tests / the harness: resolves with the settled entry. */
export async function loadEconomicSeries(symbol, opts = {}) {
  const url = economicSeriesUrl(symbol, opts)
  if (!url) return null
  if (!_cache.has(url)) await _fetch(url)
  return _cache.get(url) || ERROR
}

/**
 * The metadata that governs how a series reads: the loaded series' own `meta`
 * first (it is what the points were served with), the catalogue row second.
 * null while neither has arrived.
 */
export function economicMeta(symbol, entries = null) {
  const s = economicSymbolOf(symbol)
  if (!s) return null
  const e = entries && typeof entries.get === 'function' ? entries.get(s) : null
  if (e && e.meta && Object.keys(e.meta).length) return e.meta
  const hit = _cache.get(economicSeriesUrl(s))
  if (hit && hit.meta && Object.keys(hit.meta).length) return hit.meta
  return _catalog.bySymbol.get(s) || null
}

/** Test seam. */
export function _resetEconomicForTests() {
  _cache.clear(); _inflight.clear(); _retry.clear()
  _catalog = EMPTY_CATALOG()
  _catalogInflight = null; _catalogRetryAt = 0
  _fetcher = _defaultFetch
}
