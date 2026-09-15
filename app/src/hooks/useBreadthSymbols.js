import { useEffect, useState } from 'react'

// Catalog of the UCT breadth pseudo-tickers (UCTA50 = % above 50-day MA, etc.).
// Fetched once from /api/breadth-symbols and cached module-wide, so the chart can
// recognize a breadth symbol (daily-only, no live quote, breadth watermark) without
// a per-mount request. Membership is by exact symbol — never a bare "UCT" prefix —
// so a real ticker like UCTT is never mistaken for one.

let _cache = null          // { map: Map<sym, rec>, groups: [...] }
let _promise = null
const _subs = new Set()

function _load() {
  if (_cache) return Promise.resolve(_cache)
  if (_promise) return _promise
  if (typeof fetch !== 'function') {          // jsdom / SSR — no network
    _cache = { map: new Map(), groups: [], library: { rows: [], families: [], universes: [], metricOrder: new Map() } }
    return Promise.resolve(_cache)
  }
  _promise = fetch('/api/breadth-symbols')
    .then(r => (r.ok ? r.json() : { symbols: [], groups: [] }))
    .then(data => {
      const map = new Map()
      for (const rec of data.symbols || []) map.set(String(rec.symbol).toUpperCase(), rec)
      // ⭐ THE LIBRARY RIDES THE SAME FETCH. `library` is the richer projection
      // (`breadth_symbols.library_catalog`) served beside `symbols` on the one
      // endpoint this module already calls once per session, so metric-first
      // discovery costs no extra request and cannot disagree with the registry
      // beside it — they are the same payload.
      const lib = data.library || {}
      _cache = {
        map,
        groups: data.groups || [],
        library: {
          rows: Array.isArray(lib.rows) ? lib.rows : [],
          families: Array.isArray(lib.families) ? lib.families : [],
          universes: Array.isArray(lib.universes) ? lib.universes : [],
          // ⛔ SENT, NEVER INFERRED — see the comment on `metric_order` in
          // `library_catalog`. A client deriving it from row order gets it wrong for
          // any metric with no symbol in the first universe.
          metricOrder: new Map((lib.metric_order || []).map((m, i) => [m, i])),
        },
      }
      _subs.forEach(fn => fn(_cache))
      return _cache
    })
    .catch(() => {
      _cache = { map: new Map(), groups: [], library: { rows: [], families: [], universes: [], metricOrder: new Map() } }
      return _cache
    })
  return _promise
}

// ─── THE SYNCHRONOUS READ, FOR CODE THAT CANNOT HOLD A HOOK ─────────────
//
// ⭐⭐ THE ENGINE NEEDS THE FAMILY, NOT THE ROWS. `ohlcCapability` has to know
// whether a canonical symbol is a security or one of our breadth pseudo-tickers,
// and it runs inside the binder — no React, no effects, no await. This registry
// is already module-level and already fetched once per session for the chart's
// own use, so the answer is here; it simply had no non-hook door.
//
// ⛔⛔ AND IT FAILS CLOSED, WHICH IS THE WHOLE REASON IT IS THREE FUNCTIONS AND
// NOT ONE BOOLEAN. `isBreadth` alone would answer FALSE both for "this is a
// security" and for "the registry has not arrived yet", and a caller deciding
// whether to draw candles cannot tell those apart — the second would silently
// admit a breadth measure as an ordinary security for the first few hundred
// milliseconds of every page load. `symbolFamily` answers `'unknown'` until the
// registry is loaded, and the capability gate refuses `'unknown'`.

/** Has the breadth registry landed? Until it has, nothing can be classified. */
export function breadthRegistryReady() {
  return !!_cache
}

/**
 * `'breadth' | 'security' | 'unknown'` for a canonical symbol.
 *
 * ⚠️ `'security'` HERE MEANS "NOT ONE OF OURS", which is the only claim this
 * registry can make. A symbol the bars route cannot serve is an AVAILABILITY
 * fact and is answered elsewhere (`secondaryBars.SOURCE_STATUS`); this says only
 * which family's semantics apply.
 */
export function symbolFamily(sym) {
  if (!_cache) return 'unknown'
  const key = sym ? String(sym).toUpperCase() : ''
  if (!key) return 'unknown'
  return _cache.map.has(key) ? 'breadth' : 'security'
}

/**
 * The registry's RECORD for a canonical symbol, or null — the non-hook read, for
 * the same population `symbolFamily` exists for.
 *
 * ⭐ THE CHART'S PANE READOUT NEEDS THE `name`. `UCTU20W` over a pane of green
 * bars is an address, not a name; "UCT Stocks Up 20%+ in 5 Days" is the sentence
 * that explains it, and it is already in this registry — fetched once per session
 * for the chart's own use, so the answer costs no request.
 *
 * ⚠️ NULL MEANS "NOT KNOWN YET" AS WELL AS "NOT ONE OF OURS", deliberately: both
 * callers want the same fallback (print the short label), and neither should show
 * a placeholder while a fetch is in flight. The readout re-renders with the
 * crosshair, so the long name appears as soon as the registry lands.
 */
export function breadthRecord(sym) {
  if (!_cache || !sym) return null
  return _cache.map.get(String(sym).toUpperCase()) || null
}

/** Start the fetch without mounting a component — for a non-React caller that
 *  wants the answer to become available. Safe to call repeatedly. */
export function loadBreadthSymbols() {
  return _load()
}

/** Returns { ready, isBreadth(sym), get(sym), groups }. */
export default function useBreadthSymbols() {
  const [cache, setCache] = useState(_cache)
  useEffect(() => {
    if (_cache) return            // already seeded via the useState initializer
    let alive = true
    const fn = (c) => { if (alive) setCache(c) }
    _subs.add(fn)
    _load()
    return () => { alive = false; _subs.delete(fn) }
  }, [])
  const map = cache?.map || null
  return {
    ready: !!cache,
    isBreadth: (sym) => !!map && !!sym && map.has(String(sym).toUpperCase()),
    get: (sym) => (map && sym ? map.get(String(sym).toUpperCase()) || null : null),
    groups: cache?.groups || [],
    // ⚰️ `all()` DID NOT EXIST, AND A CALLER WAS ALREADY ASKING FOR IT.
    // `useSymbolDiscovery` reads `typeof breadth.all === 'function' ? breadth.all()
    // : []` under the comment "LOCAL BREADTH FIRST, and it needs no network: a
    // member typing `UCTA` sees the measure before the ticker search has been asked
    // anything". The guard made the miss silent, so that path has always returned
    // `[]` and breadth reached the source picker ONLY through the remote
    // `/api/ticker-search` injection — which needs two characters and a round-trip.
    all: () => (cache?.library?.rows?.length
      ? cache.library.rows
      : [...(map ? map.values() : [])]),
    // ⭐ The richer projection, for a surface that wants METRIC-first discovery.
    library: () => (cache?.library
      || { rows: [], families: [], universes: [], metricOrder: new Map() }),
  }
}
