import { useState, useEffect } from 'react'
import { idbGet, idbPut } from '../utils/barsIDB'

// Resolves a "thematic ETF" pseudo-ticker ("$IDX:<slug>") to its equal-weight
// index bars from /api/theme-index. Returns {isIndex:false} for a normal ticker,
// so callers can pass the bars to StockChart via barsOverride when isIndex.
//
// INSTANT-LOAD: paint from the IndexedDB cache immediately (same store as regular
// bars, keyed by "$IDX:<slug>"), THEN revalidate from the server and re-cache — so
// a repeat view is instant with no network wait, and the server hit is a warm
// cache hit (the backend prewarms every theme). A daily index bar changes only for
// today, so a slightly-stale cached series is fine to show while it refreshes.
export default function useThemeIndexBars(sym, tf) {
  const isIndex = typeof sym === 'string' && sym.startsWith('$IDX:')
  const slug = isIndex ? sym.slice(5) : null
  const idxTf = ['D', 'W', 'M'].includes(tf) ? tf : 'D'
  const [state, setState] = useState({ bars: null, name: null, sector: null, loading: false })

  useEffect(() => {
    if (!isIndex) return undefined
    let cancelled = false
    let fetched = false          // once the server responds, ignore a late IDB read

    // 1) Instant paint from IndexedDB (also clears the previous index's bars). No
    //    spinner once we have something to show; loading only while nothing paints.
    idbGet(sym, idxTf).then((cached) => {
      if (cancelled || fetched) return
      setState(cached?.bars?.length
        ? { bars: cached.bars, name: null, sector: null, loading: false }
        : { bars: null, name: null, sector: null, loading: true })
    }).catch(() => {})

    // 2) Revalidate from the (prewarmed) server and re-cache.
    fetch(`/api/theme-index/${encodeURIComponent(slug)}?tf=${idxTf}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return
        fetched = true
        const bars = d?.bars || []
        setState({ bars, name: d?.name || null, sector: d?.sector || null, loading: false })
        if (bars.length) idbPut(sym, idxTf, bars).catch(() => {})
      })
      .catch(() => { if (!cancelled) { fetched = true; setState(s => ({ ...s, loading: false })) } })

    return () => { cancelled = true }
  }, [isIndex, sym, slug, idxTf])

  // Non-index: a clean empty result without touching state inside the effect.
  if (!isIndex) return { isIndex: false, bars: null, name: null, sector: null, loading: false }
  return { isIndex, ...state }
}
