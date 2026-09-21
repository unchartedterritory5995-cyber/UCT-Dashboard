import { useEffect, useState } from 'react'
import { symbolFamily as breadthSymbolFamily, breadthRegistryReady } from './useBreadthSymbols'
import { OHLC_FAMILY } from '../components/chart/engine/ohlcCapability'

// ─── THE MARKET INDICATORS REGISTRY, CLIENT SIDE ────────────────────────────
//
// ⭐⭐ THE SAME SHAPE `useBreadthSymbols` ALREADY PROVES: fetched ONCE per session,
// cached module-wide, and readable BOTH as a hook (for components) and as a plain
// function (for the chart engine, which runs inside the binder with no React around
// it). Copying that shape rather than inventing a second one is deliberate — the two
// registries answer the same kind of question and a consumer should not have to learn
// two idioms to ask it.
//
// ⛔⛔ AND IT FAILS CLOSED, WHICH IS WHY `canonicalFamily` HAS THREE ANSWERS AND NOT
// TWO. A boolean would say FALSE both for "this is an ordinary security" and for "the
// registry has not landed yet", and a caller deciding whether to draw candles cannot
// tell those apart — the second would silently admit a survey as a security for the
// first few hundred milliseconds of every page load. `'unknown'` is a real answer here
// and `ohlcCapabilityOf` refuses it.

let _cache = null          // { byKey: Map<string, row>, rows, families, dormant }
let _promise = null
const _subs = new Set()

const EMPTY = { byKey: new Map(), rows: [], families: [], dormant: [] }

function _index(data) {
  const byKey = new Map()
  const rows = Array.isArray(data?.rows) ? data.rows : []
  for (const row of rows) {
    // ⛔ EVERY SPELLING THAT MAY RESOLVE — id, member-facing symbol and explicit
    // aliases — because Rule 4 separates them on purpose and a lookup that only knew
    // one would answer 'unknown' for the other two.
    for (const k of [row.id, row.symbol, ...(row.aliases || [])]) {
      if (k) byKey.set(String(k).toUpperCase(), row)
    }
  }
  return {
    byKey,
    rows,
    families: Array.isArray(data?.families) ? data.families : [],
    // ⚠️ Dormant rows are indexed NOWHERE. They are carried for a diagnostic surface
    // only; putting them in `byKey` would let `canonicalFamily` classify NYMO, which
    // would make it look chartable to every capability gate downstream.
    dormant: Array.isArray(data?.dormant) ? data.dormant : [],
  }
}

function _load() {
  if (_cache) return Promise.resolve(_cache)
  if (_promise) return _promise
  if (typeof fetch !== 'function') {            // jsdom / SSR — no network
    _cache = EMPTY
    return Promise.resolve(_cache)
  }
  _promise = fetch('/api/market-indicators')
    .then(r => (r.ok ? r.json() : null))
    .then(data => {
      _cache = data ? _index(data) : EMPTY
      _subs.forEach(fn => fn(_cache))
      return _cache
    })
    .catch(() => {
      _cache = EMPTY
      return _cache
    })
  return _promise
}

/** Has the market-indicator registry landed? Until it has, nothing can be classified. */
export function marketIndicatorRegistryReady() {
  return !!_cache
}

/** The registry ROW for a canonical symbol/id/alias, or null. */
export function marketIndicatorRecord(sym) {
  if (!_cache || !sym) return null
  return _cache.byKey.get(String(sym).toUpperCase()) || null
}

/** True when this deploy serves `sym` as a market indicator. */
export function isMarketIndicator(sym) {
  return marketIndicatorRecord(sym) !== null
}

/**
 * `OHLC_FAMILY[...]` for any canonical symbol — THE composed classifier.
 *
 * ⭐⭐ ONE AUTHORITY OVER TWO CATALOGUES. `useBreadthSymbols.symbolFamily` answers
 * `'breadth' | 'security' | 'unknown'` and is unchanged; this layers the market-
 * indicator registry over it and is what the chart engine should ask. Leaving the
 * breadth function alone keeps every existing caller and test answering exactly as
 * before, while there is still only ONE function that knows the full answer.
 *
 * ⛔ ORDER MATTERS. Breadth is consulted FIRST so the 44 shipped pseudo-tickers can
 * never be reclassified by a newer catalogue — the same backward-compatibility
 * guarantee `breadth_symbols.is_breadth_symbol` makes on the server.
 *
 * ⛔⛔ AND A REGISTRY THAT HAS NOT LOADED YIELDS `'unknown'`, NOT `'security'`. Both
 * registries arrive over the network; until both have answered, "not one of ours" is
 * indistinguishable from "we have not been told", and only one of those may draw a
 * candle.
 */
export function canonicalFamily(sym) {
  if (!sym) return OHLC_FAMILY.UNKNOWN
  const breadth = breadthSymbolFamily(sym)
  if (breadth === OHLC_FAMILY.BREADTH) return OHLC_FAMILY.BREADTH

  const row = marketIndicatorRecord(sym)
  if (row) {
    if (row.source_type === 'volatility' && row.ohlc_capable) return OHLC_FAMILY.VOLATILITY
    if (row.source_type === 'survey') return OHLC_FAMILY.SURVEY
    return OHLC_FAMILY.INDICATOR
  }
  // Neither registry claims it. That is only "an ordinary security" once BOTH have
  // actually answered; otherwise it is "not yet classified".
  if (!breadthRegistryReady() || !marketIndicatorRegistryReady()) return OHLC_FAMILY.UNKNOWN
  return OHLC_FAMILY.SECURITY
}

/** Start the fetch without mounting a component. Safe to call repeatedly. */
export function loadMarketIndicators() {
  return _load()
}

/** Test seam: install a registry synchronously. ⚠️ tests only. */
export function __setMarketIndicatorsForTest(data) {
  _cache = data ? _index(data) : null
  _promise = null
  _subs.forEach(fn => fn(_cache))
}

/** Returns `{ ready, rows, families, dormant, get(sym), all() }`. */
export default function useMarketIndicators() {
  const [cache, setCache] = useState(_cache)
  useEffect(() => {
    if (_cache) return                     // already seeded via the useState initializer
    let alive = true
    const fn = (c) => { if (alive) setCache(c) }
    _subs.add(fn)
    _load()
    return () => { alive = false; _subs.delete(fn) }
  }, [])
  return {
    ready: !!cache,
    rows: cache?.rows || [],
    families: cache?.families || [],
    dormant: cache?.dormant || [],
    get: (sym) => (cache && sym ? cache.byKey.get(String(sym).toUpperCase()) || null : null),
    all: () => cache?.rows || [],
  }
}
