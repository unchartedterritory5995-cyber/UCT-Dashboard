import { useCallback, useEffect, useMemo, useState } from 'react'
import useGroupMeta from '../../grouping/useGroupMeta'
import useWatchlistMeta from '../../../../hooks/useWatchlistMeta'
import { parseMcap } from '../../../Watchlists'
import { composition, UNCLASSIFIED, readReview, writeReview, reviewKey } from './scanDeckModel'
import { emptySelection, applyFacets, facetModel, toggleFacet, activeCount, activeChips } from './scanFacets'

const NO_ITEMS = []
const up = (s) => String(s || '').toUpperCase()

/** Which way a list points. A strong close on a DOWN list is the bottom of the
 *  range, so the filters need to know. Read from the list key, which names it. */
export function listDirection(drillKey) {
  return /(^|_)(down|dn)_|lows|stage4|magna_down/.test(String(drillKey || '')) ? -1 : 1
}

/**
 * The cell's badges: other lists each name is also on that day, and repeat
 * counts over the previous sessions. Dated drills only — a LIVE list has no
 * settled snapshot to compare against. A failure is "no badges", never an error
 * the member sees: the list is the product, badges are garnish.
 */
export function useDrillContext(drill) {
  // Keyed by URL so a context that answers for a PREVIOUS cell is never shown
  // for the current one.
  const [got, setGot] = useState({ url: null, data: null })
  const url = drill?.url && !drill?.live && Array.isArray(drill?.items) ? `${drill.url}/context` : null
  useEffect(() => {
    if (!url) return undefined
    let cancelled = false
    fetch(url)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setGot({ url, data: d && typeof d === 'object' ? d : null }) })
      .catch(() => { if (!cancelled) setGot({ url, data: null }) })
    return () => { cancelled = true }
  }, [url])
  return url && got.url === url ? got.data : null
}

/**
 * Everything the scan window derives from one drill: enriched rows, the filter
 * and group state, the filtered list handed to the real watchlist table, and the
 * reviewed/skipped store.
 */
export default function useScanDeck(drill, { storage = safeStorage() } = {}) {
  const items = drill?.items ?? NO_ITEMS
  const tickers = useMemo(() => items.map(i => up(i?.t)).filter(Boolean), [items])

  // ONE fetch each for the whole cell. The list below is handed the same maps,
  // so a filter toggle never re-asks the server.
  const groupMeta = useGroupMeta(tickers)
  const { metaData } = useWatchlistMeta(tickers)
  const context = useDrillContext(drill)
  const dir = listDirection(drill?.drillKey)

  const rows = useMemo(() => {
    const ctxOk = context && context.lookback_found > 0
    return items.map((it) => {
      const sym = up(it?.t)
      const m = metaData?.[sym] || {}
      return {
        sym,
        name: it?.n ?? m.name ?? null,
        pct: num(it?.pct),
        price: num(it?.c),
        rvol: num(it?.vr),
        atr: num(it?.atr),
        a50: num(it?.a50),
        mcap: parseMcap(m.market_cap),
        rating: num(m.composite),
        nextEarnings: m.next_earnings || null,
        sector: groupMeta.sectors?.[sym] || null,
        industry: groupMeta.industries?.[sym] || null,
        theme: groupMeta.themes?.[sym] || null,
        // Unknown, not zero, when the server could not look back: a short history
        // must never read as "first appearance".
        repeat: ctxOk ? (context.repeat?.[sym] || 0) : null,
        also: context?.also?.[sym] || [],
      }
    })
  }, [items, metaData, groupMeta, context])

  // ── Filters (facets) ─────────────────────────────────────────────────────
  // Held for the life of the window, so stepping to the next session keeps the
  // same scan applied — that is the point of scanning day after day.
  const [sel, setSel] = useState(emptySelection)
  const facetCtx = useMemo(() => ({ date: drill?.live ? null : drill?.date }), [drill?.live, drill?.date])
  const shownRows = useMemo(() => applyFacets(rows, sel, facetCtx), [rows, sel, facetCtx])
  const facets = useMemo(() => facetModel(rows, sel, facetCtx), [rows, sel, facetCtx])
  const toggle = useCallback((facet, value) => setSel(prev => toggleFacet(prev, facet, value)), [])
  const clearAll = useCallback(() => setSel(emptySelection()), [])

  // The ORIGINAL drill items for the shown rows, in the drill's own order, so
  // the watchlist table gets exactly the payload it always got — just fewer rows.
  const shownItems = useMemo(() => {
    if (shownRows.length === rows.length) return items
    const keep = new Set(shownRows.map(r => r.sym))
    return items.filter(i => keep.has(up(i?.t)))
  }, [items, rows.length, shownRows])
  const rowBySym = useMemo(() => Object.fromEntries(rows.map(r => [r.sym, r])), [rows])

  // The masthead's read on the WHOLE list (not the filtered view): the average
  // move, and the sector and theme the names cluster in.
  const summary = useMemo(() => {
    const pcts = rows.map(r => r.pct).filter(Number.isFinite)
    const known = (list) => list.find(g => g.key !== UNCLASSIFIED) || null
    return {
      avgPct: pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null,
      topSector: known(composition(rows, r => r.sector)),
      topTheme: known(composition(rows, r => r.theme)),
      sectors: composition(rows, r => r.sector),
    }
  }, [rows])

  // ── Reviewed / skipped ────────────────────────────────────────────────────
  const rKey = reviewKey(drill?.drillKey || drill?.label, drill?.date, drill?.live)
  // State is tagged with the list it belongs to. When the window steps to a new
  // session or list, the stored entry for THAT list is read during render (the
  // React "adjust state when a prop changes" pattern) — never an effect, which
  // would paint one frame of the previous list's ticks.
  const [reviewState, setReviewState] = useState(() => ({ key: rKey, ...readReview(storage, rKey) }))
  let review = reviewState
  if (reviewState.key !== rKey) {
    review = { key: rKey, ...readReview(storage, rKey) }
    setReviewState(review)
  }
  const update = useCallback((fn) => {
    setReviewState(prev => {
      const next = fn(prev)
      if (next === prev) return prev
      writeReview(storage, prev.key, next)
      return { key: prev.key, ...next }
    })
  }, [storage])
  const markSeen = useCallback((sym) => {
    if (!sym) return
    update(prev => (prev.seen.has(sym) ? prev : { seen: new Set(prev.seen).add(sym), skipped: prev.skipped }))
  }, [update])
  const toggleSkip = useCallback((sym) => {
    if (!sym) return
    update(prev => {
      const skipped = new Set(prev.skipped)
      if (skipped.has(sym)) skipped.delete(sym); else skipped.add(sym)
      return { seen: new Set(prev.seen).add(sym), skipped }
    })
  }, [update])
  const resetReview = useCallback(() => update(() => ({ seen: new Set(), skipped: new Set() })), [update])
  const reviewedCount = useMemo(() => rows.reduce((n, r) => n + (review.seen.has(r.sym) ? 1 : 0), 0), [rows, review])

  return {
    dir, rows, rowBySym, shownRows, shownItems, groupMeta, context,
    filters: { sel, model: facets, toggle, clear: clearAll, count: activeCount(sel), chips: activeChips(sel) },
    summary,
    review: { seen: review.seen, skipped: review.skipped, markSeen, toggleSkip, reset: resetReview, count: reviewedCount },
  }
}

function num(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function safeStorage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}
