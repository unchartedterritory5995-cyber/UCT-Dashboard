import { useState, useMemo, useCallback } from 'react'
import useGroupMeta from './useGroupMeta'
import { groupItems } from './groupItems'

// Owns the grouping state (List|Grouped + Sector|Industry + collapsed groups),
// fetches the industry/sector maps, and computes the grouped buckets. Shared by
// the drill modal AND CustomScan so both surfaces behave identically.
//
//   items         — row objects
//   opts.tickerOf — row -> ticker  (default r => r.t)
//   opts.pctOf    — row -> % move  (default r => r.pct)
const LS_VIEW = 'breadth.group.viewMode'
const LS_DIM = 'breadth.group.dimension'

function readLS(key, allowed, fallback) {
  try {
    const v = localStorage.getItem(key)
    return allowed.includes(v) ? v : fallback
  } catch { return fallback }
}

export default function useBreadthGrouping(items, opts = {}) {
  const tickerOf = opts.tickerOf || (r => r?.t)
  const pctOf = opts.pctOf || (r => r?.pct)

  const [viewMode, setViewModeState] = useState(() => readLS(LS_VIEW, ['list', 'grouped'], 'list'))
  const [dimension, setDimensionState] = useState(() => readLS(LS_DIM, ['industry', 'sector'], 'industry'))
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set())

  const setViewMode = useCallback(m => {
    setViewModeState(m)
    try { localStorage.setItem(LS_VIEW, m) } catch { /* ignore */ }
  }, [])
  const setDimension = useCallback(d => {
    setDimensionState(d)
    setCollapsedGroups(new Set())
    try { localStorage.setItem(LS_DIM, d) } catch { /* ignore */ }
  }, [])
  const toggleGroupCollapse = useCallback(key => setCollapsedGroups(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  }), [])

  const rows = items ?? []
  // Stable key so the meta fetch + memos don't churn when the array identity
  // changes but the ticker set doesn't.
  const tickerKey = rows.map(tickerOf).join(',')
  const tickers = useMemo(() => rows.map(tickerOf).filter(Boolean), [tickerKey])  // eslint-disable-line react-hooks/exhaustive-deps
  const meta = useGroupMeta(tickers)
  const labelByTicker = dimension === 'sector' ? meta.sectors : meta.industries

  const grouped = useMemo(
    () => (viewMode === 'grouped' ? groupItems(rows, labelByTicker, { tickerOf, pctOf }) : null),
    [viewMode, tickerKey, labelByTicker],  // eslint-disable-line react-hooks/exhaustive-deps
  )

  const visibleOrder = useMemo(() => {
    if (!grouped) return rows
    return grouped.groups.flatMap(g => (collapsedGroups.has(g.key) ? [] : g.items))
  }, [grouped, tickerKey, collapsedGroups])  // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(
    () => (grouped ? grouped.groups.slice(0, 6).map(g => ({ key: g.key, count: g.count, avgPct: g.avgPct })) : null),
    [grouped],
  )

  return {
    viewMode, setViewMode, dimension, setDimension,
    grouped, visibleOrder, collapsedGroups, toggleGroupCollapse, summary,
  }
}
