import { useEffect, useState } from 'react'

// The ETF-symbol universe (Massive reference type=ETF), fetched once from
// /api/etf/symbols and cached module-wide so the chart can decide whether to show
// the "View Holdings" button without a per-mount request. Mirrors useBreadthSymbols.

let _cache = null            // Set<string> (uppercased tickers)
let _promise = null
const _subs = new Set()

function _load() {
  if (_cache) return Promise.resolve(_cache)
  if (_promise) return _promise
  if (typeof fetch !== 'function') {          // jsdom / SSR — no network
    _cache = new Set()
    return Promise.resolve(_cache)
  }
  _promise = fetch('/api/etf/symbols', { credentials: 'include' })
    .then(r => (r.ok ? r.json() : { symbols: [] }))
    .then(data => {
      _cache = new Set((data.symbols || []).map(s => String(s).toUpperCase()))
      _subs.forEach(fn => fn(_cache))
      return _cache
    })
    .catch(() => {
      _cache = new Set()
      return _cache
    })
  return _promise
}

/** Returns { ready, isEtf(sym) }. */
export default function useEtfSymbols() {
  const [set, setSet] = useState(_cache)
  useEffect(() => {
    if (_cache) return            // already seeded via the useState initializer
    let alive = true
    const fn = (s) => { if (alive) setSet(s) }
    _subs.add(fn)
    _load()
    return () => { alive = false; _subs.delete(fn) }
  }, [])
  return {
    ready: !!set,
    isEtf: (sym) => !!set && !!sym && set.has(String(sym).toUpperCase()),
  }
}
