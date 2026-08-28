import { useState, useEffect } from 'react'

// A "$IDX:<slug>" pseudo-ticker → a clean display name, even before (or without)
// the quotes fetch: title-case the slug with the common acronyms fixed up. The
// paid /api/theme-index/quotes response overrides this with the exact theme name.
const _ACRONYMS = { ai: 'AI', gpu: 'GPU', it: 'IT', saas: 'SaaS', etf: 'ETF', uct: 'UCT', ev: 'EV', us: 'US', reit: 'REIT' }
export function themeIndexLabel(sym) {
  if (typeof sym !== 'string' || !sym.startsWith('$IDX:')) return sym
  const words = sym.slice(5).toLowerCase().split('-').filter(Boolean)
    .map(w => _ACRONYMS[w] || (w.charAt(0).toUpperCase() + w.slice(1)))
  return words.join(' ') + ' Index'
}

// Normalize any-case "$IDX:CYBERSECURITY" → the lowercase key the quotes map uses
// (watchlist storage uppercases syms; the endpoint keys by lowercase slug).
export function themeIndexKey(sym) {
  return typeof sym === 'string' && sym.startsWith('$IDX:') ? '$IDX:' + sym.slice(5).toLowerCase() : sym
}

// Batch quotes for the "UCT Thematic Indexes" watchlist: { "$IDX:<slug>": {name,
// change_pct, price} }. Fetched ONCE (small, all themes) only when the caller
// actually has $IDX rows on screen (`enabled`). Paid-only endpoint — a free user
// (or a 402) just gets an empty map and the slug-derived label above.
export default function useThemeIndexQuotes(enabled) {
  const [quotes, setQuotes] = useState({})

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    const load = () => {
      fetch('/api/theme-index/quotes', { credentials: 'include' })
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (!cancelled && d?.quotes) setQuotes(d.quotes) })
        .catch(() => { /* free tier / offline — keep the slug-derived labels */ })
    }
    load()
    const id = setInterval(load, 60000)   // live daily % — refresh each minute
    return () => { cancelled = true; clearInterval(id) }
  }, [enabled])

  return { quotes }
}
