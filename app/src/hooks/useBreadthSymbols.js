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
    _cache = { map: new Map(), groups: [] }
    return Promise.resolve(_cache)
  }
  _promise = fetch('/api/breadth-symbols')
    .then(r => (r.ok ? r.json() : { symbols: [], groups: [] }))
    .then(data => {
      const map = new Map()
      for (const rec of data.symbols || []) map.set(String(rec.symbol).toUpperCase(), rec)
      _cache = { map, groups: data.groups || [] }
      _subs.forEach(fn => fn(_cache))
      return _cache
    })
    .catch(() => {
      _cache = { map: new Map(), groups: [] }
      return _cache
    })
  return _promise
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
  }
}
