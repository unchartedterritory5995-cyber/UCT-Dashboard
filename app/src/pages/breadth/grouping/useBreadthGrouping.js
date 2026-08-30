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

// ⛔ MODULE SCOPE, NOT INLINE DEFAULTS. Re-created per render they are a new
// identity every time, so every memo that legitimately depends on them would
// churn — which is why the memos below used to depend on a joined STRING
// instead of on what they actually read.
const DEFAULT_TICKER_OF = r => r?.t
const DEFAULT_PCT_OF = r => r?.pct

function readLS(key, allowed, fallback) {
  try {
    const v = localStorage.getItem(key)
    return allowed.includes(v) ? v : fallback
  } catch { return fallback }
}

export default function useBreadthGrouping(items, opts = {}) {
  const tickerOf = opts.tickerOf || DEFAULT_TICKER_OF
  const pctOf = opts.pctOf || DEFAULT_PCT_OF

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

  const rows = useMemo(() => items ?? [], [items])

  /**
   * 🔴 A JOINED STRING WAS STANDING IN FOR THE ROWS, AND IT WAS THE WRONG PROXY.
   *
   * `tickerKey` is the ticker set as one string, and three memos below took it
   * as their ONLY dependency while reading `rows` — so a list whose tickers were
   * unchanged but whose PERCENTAGES had moved kept the previous grouping, with
   * the previous per-group averages, for as long as the set held. That is a
   * second authority over "have these rows changed", answering a narrower
   * question than the one the memos actually ask, and it needed three
   * `eslint-disable` lines to stay.
   *
   * It survives for the ONE job it is honestly right for: the ticker list handed
   * to the sector/industry fetch, which is a function of the set and nothing
   * else. Derived FROM the key rather than beside it, so the dependency is the
   * whole input.
   */
  const tickerKey = rows.map(tickerOf).join(',')
  const tickers = useMemo(() => tickerKey.split(',').filter(Boolean), [tickerKey])
  const meta = useGroupMeta(tickers)
  const labelByTicker = dimension === 'sector' ? meta.sectors : meta.industries

  const grouped = useMemo(
    () => (viewMode === 'grouped' ? groupItems(rows, labelByTicker, { tickerOf, pctOf }) : null),
    [viewMode, rows, labelByTicker, tickerOf, pctOf],
  )

  const visibleOrder = useMemo(() => {
    if (!grouped) return rows
    return grouped.groups.flatMap(g => (collapsedGroups.has(g.key) ? [] : g.items))
  }, [grouped, rows, collapsedGroups])

  const summary = useMemo(
    () => (grouped ? grouped.groups.slice(0, 6).map(g => ({ key: g.key, count: g.count, avgPct: g.avgPct })) : null),
    [grouped],
  )

  return {
    viewMode, setViewMode, dimension, setDimension,
    grouped, visibleOrder, collapsedGroups, toggleGroupCollapse, summary,
  }
}
