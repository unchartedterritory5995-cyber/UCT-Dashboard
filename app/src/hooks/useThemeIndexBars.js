import { useState, useEffect } from 'react'

// Resolves a "thematic ETF" pseudo-ticker ("$IDX:<slug>") to its equal-weight
// index bars from /api/theme-index. Returns {isIndex:false} for a normal ticker,
// so callers can pass the bars to StockChart via barsOverride when isIndex.
//
// ONE fetch, ONE bars update — StockChart frames its default view (last ~200 bars,
// right-anchored) off the bars it first receives. A two-stage cache→fetch update
// made it frame on the first (cached) series and NOT re-anchor when the fresh
// series arrived, opening the chart scrolled back in time. The server is already
// fast (warm bars reads + prewarm), so a single fetch is instant enough.
export default function useThemeIndexBars(sym, tf) {
  const isIndex = typeof sym === 'string' && sym.startsWith('$IDX:')
  const slug = isIndex ? sym.slice(5) : null
  const idxTf = ['D', 'W', 'M'].includes(tf) ? tf : 'D'
  const [state, setState] = useState({ bars: null, name: null, sector: null })

  useEffect(() => {
    if (!isIndex) return undefined
    let cancelled = false
    fetch(`/api/theme-index/${encodeURIComponent(slug)}?tf=${idxTf}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setState({ bars: d?.bars || [], name: d?.name || null, sector: d?.sector || null }) })
      .catch(() => { if (!cancelled) setState({ bars: [], name: null, sector: null }) })
    return () => { cancelled = true }
  }, [isIndex, slug, idxTf])

  // loading (→ barsOverridePending) is derived, so no synchronous setState in the
  // effect: true only before the first series lands (bars still null).
  if (!isIndex) return { isIndex: false, bars: null, name: null, sector: null, loading: false }
  return { isIndex, bars: state.bars, name: state.name, sector: state.sector, loading: state.bars === null }
}
