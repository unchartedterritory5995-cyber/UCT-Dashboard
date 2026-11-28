// ⭐⭐ (2026-11-27, owner: "close to 30MS for everything always") THE TICKER UNIVERSE, IN THE BROWSER, FOR THE KEYSTROKE.
//
// The chart's symbol search learned that typed text IS a ticker only from a /api/ticker-search answer, and at a typist's
// pace (150-250 ms a key) that debounced answer is aborted by the next key before it lands: the typed ticker was warmed
// 140 ms after the last key (the typing pause), 10 ms before a typical Enter, against a cold page of 100-350 ms. With the
// list here, the exact ticker is known on its LAST KEY, and a prefix with one completion names it on the prefix.
//
// The list is `/api/ticker-universe` (the cap universe /api/ticker-search ranks, ~3,600 symbols, ~27 KB, ~10 KB gzip),
// fetched LAZILY (the first time a symbol search opens: never on any page's first open) and kept in localStorage under
// its version, refreshed in the background once a day. Every reader is synchronous and answers null while nothing is
// loaded, so a caller falls back to what it did before (the typing pause).

const STORE_KEY = 'uct.tickerUniverse'
const FRESH_MS = 24 * 60 * 60 * 1000
const URL = '/api/ticker-universe'

let _list = null        // sorted upper-case symbols, or null (not loaded)
let _v = null           // the held list's version (the server's `v`)
let _set = null
let _loading = null
let _checkedAt = 0

function _adopt(symbols) {
  if (!Array.isArray(symbols) || !symbols.length) return false
  const list = symbols.filter((s) => typeof s === 'string' && s).map((s) => s.toUpperCase())
  list.sort()
  _list = list
  _set = new Set(list)
  return true
}

function _readCache() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) : null
    if (!raw) return null
    const c = JSON.parse(raw)
    return c && Array.isArray(c.symbols) ? c : null
  } catch { return null }
}

function _writeCache(v, symbols) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ v, at: Date.now(), symbols })) } catch { /* a full store: memory only */ }
}

/**
 * Load the universe (from this browser's copy at once, then from the server when that copy is missing or a day old).
 * Resolves true when a list is held. Never rejects; safe to call on every open of a search.
 */
export function ensureTickerUniverse({ fetchImpl } = {}) {
  if (!_list) {
    const c = _readCache()
    if (c) { _adopt(c.symbols); _checkedAt = Number(c.at) || 0; _v = c.v ?? null }
  }
  if (_list && Date.now() - _checkedAt < FRESH_MS) return Promise.resolve(true)
  if (_loading) return _loading
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null)
  if (!f) return Promise.resolve(!!_list)
  _loading = Promise.resolve()
    .then(() => f(URL, { credentials: 'same-origin' }))
    .then((r) => (r && r.ok ? r.json() : null))
    .then((j) => {
      _checkedAt = Date.now()
      if (j && _adopt(j.symbols)) { _v = j.v ?? null; _writeCache(_v, _list) }
      return !!_list
    })
    .catch(() => !!_list)
    .finally(() => { _loading = null })
  return _loading
}

/** Is `text` a ticker of the universe? true / false, or null while no list is held (the caller decides as before). */
export function isKnownTicker(text) {
  if (!_set) return null
  return _set.has(String(text || '').trim().toUpperCase())
}

/**
 * The ONE ticker that starts with `prefix`, or null: none, several (GOO: GOOG and GOOGL), or no list held. The prefix
 * itself counts as one of them when it is a ticker (GOOG: GOOG and GOOGL, so null; the exact answer is isKnownTicker).
 */
export function uniqueCompletion(prefix) {
  if (!_list) return null
  const p = String(prefix || '').trim().toUpperCase()
  if (!p) return null
  let lo = 0, hi = _list.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (_list[mid] < p) lo = mid + 1; else hi = mid }
  if (lo >= _list.length || !_list[lo].startsWith(p)) return null
  if (lo + 1 < _list.length && _list[lo + 1].startsWith(p)) return null
  return _list[lo]
}

/** (review of #2938) The server named its list's version (every /api/ticker-search answer carries it): a held list of
 *  another version is replaced now, not after its day. Never throws. */
export function noteTickerUniverseVersion(v, opts = {}) {
  if (!v || !_list || v === _v || _loading) return
  _checkedAt = 0
  ensureTickerUniverse(opts)
}

/** Does a LONGER ticker start with `text` (AM: AMZN)? null while no list is held. */
export function hasLongerCompletion(text) {
  if (!_list) return null
  const p = String(text || '').trim().toUpperCase()
  if (!p) return false
  let lo = 0, hi = _list.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (_list[mid] <= p) lo = mid + 1; else hi = mid }
  return lo < _list.length && _list[lo].startsWith(p)
}

/** Tests: forget the list (and, with `cache`, this browser's copy). */
export function __resetTickerUniverseForTests({ cache = true } = {}) {
  _list = null; _set = null; _loading = null; _checkedAt = 0; _v = null
  if (cache) { try { localStorage.removeItem(STORE_KEY) } catch { /* */ } }
}
