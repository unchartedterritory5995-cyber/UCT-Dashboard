import { useState, useEffect } from 'react'

// Resolves a "thematic ETF" pseudo-ticker ("$IDX:<slug>") to its equal-weight
// index bars from /api/theme-index. Returns {isIndex:false} for a normal ticker,
// so callers can pass the bars to StockChart via barsOverride when isIndex.
export default function useThemeIndexBars(sym, tf) {
  const isIndex = typeof sym === 'string' && sym.startsWith('$IDX:')
  const slug = isIndex ? sym.slice(5) : null
  const idxTf = ['D', 'W', 'M'].includes(tf) ? tf : 'D'
  const [state, setState] = useState({ bars: null, name: null, sector: null, loading: false })

  useEffect(() => {
    if (!isIndex) {
      setState({ bars: null, name: null, sector: null, loading: false })
      return undefined
    }
    let cancelled = false
    setState(s => ({ ...s, loading: true }))
    fetch(`/api/theme-index/${encodeURIComponent(slug)}?tf=${idxTf}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setState({ bars: d?.bars || [], name: d?.name || null, sector: d?.sector || null, loading: false }) })
      .catch(() => { if (!cancelled) setState({ bars: [], name: null, sector: null, loading: false }) })
    return () => { cancelled = true }
  }, [isIndex, slug, idxTf])

  return { isIndex, ...state }
}
