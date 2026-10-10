// app/src/hooks/marketIndicatorRegistry.js
//
// ─── THE MARKET INDICATORS REGISTRY: FETCH, CACHE, HOOK ──────────────────────
//
// Split out of `useMarketIndicators.js` (2026-10-09) so a component that only needs
// the registry ROWS (Symbol Search, mounted on every route through the ticker menu)
// does not statically import the chart engine. The classifiers that need
// `engine/ohlcCapability` and `engine/sourceCapability` stay in
// `useMarketIndicators.js`, which re-exports everything here, so every existing
// import keeps working. Rail: `src/__tests__/entryExcludesChartEngine.test.js`.
//
// ⛔ This module must import nothing from `components/chart/engine/`.
import { useEffect, useState } from 'react'

let _cache = null          // { byKey: Map<string, row>, rows, families, dormant }
let _promise = null
const _subs = new Set()

const EMPTY = { byKey: new Map(), rows: [], families: [], dormant: [], cotSymbols: null }

function _index(data) {
  const byKey = new Map()
  const rows = Array.isArray(data?.rows) ? data.rows : []
  // ⭐⭐ PRODUCT COMPONENTS ARE INDEXED BUT NOT BROWSABLE. They are deliberately
  // absent from `rows` — a search for "AAII" must return ONE row — and they are
  // nonetheless real, chartable canonical series that every capability gate has to
  // be able to CLASSIFY.
  //
  // ⚰️ MEASURED IN A BROWSER: with them absent from the index entirely,
  // `canonicalFamily('AAII:BULLS')` found no record, fell through to `security`, and
  // Candles were offered over a weekly survey. Listability and identity are
  // different questions and only one of them was being asked.
  const components = Array.isArray(data?.components) ? data.components : []
  for (const row of [...rows, ...components]) {
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
    components,
    families: Array.isArray(data?.families) ? data.families : [],
    // ⚠️ Dormant rows are indexed NOWHERE. They are carried for a diagnostic surface
    // only; putting them in `byKey` would let `canonicalFamily` classify NYMO, which
    // would make it look chartable to every capability gate downstream.
    dormant: Array.isArray(data?.dormant) ? data.dormant : [],
    // ⭐ chart symbol → the COT market the follow-the-chart COT indicator draws there
    // (`registry.COT_SYMBOL_MAP`). ONE object per load, so a memo keyed on it is stable.
    cotSymbols: data?.cot_symbols && typeof data.cot_symbols === 'object' ? data.cot_symbols : null,
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

/** The browsable registry rows, or [] before the registry lands. */
export function marketIndicatorRows() {
  return (_cache && _cache.rows) || []
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
    cotSymbols: cache?.cotSymbols || null,
    get: (sym) => (cache && sym ? cache.byKey.get(String(sym).toUpperCase()) || null : null),
    all: () => cache?.rows || [],
  }
}
