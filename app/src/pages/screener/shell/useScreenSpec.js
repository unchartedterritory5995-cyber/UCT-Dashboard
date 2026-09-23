import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SHARED_SCREEN_PARAM, sharedScreenReadUrl } from '../screenShareLink'
import { SPEC_PARAM, DEFAULT_SORT, DEFAULT_VIEW, encodeSpec, decodeSpec } from './specUrl'

export const PAGE_SIZE = 100
export const REQUIRED_COLS = ['ticker', 'company', 'price', 'chg_pct_1d']

const specToFilters = spec =>
  Object.fromEntries((spec?.filters || []).map(({ key, ...rest }) => [key, rest]))

export default function useScreenSpec({ viewColumnsFor } = {}) {
  const fromUrl = useMemo(
    () => decodeSpec(new URLSearchParams(window.location.search).get(SPEC_PARAM)),
    [], // once, on mount — popstate handles the rest
  )
  const [filters, setFilters] = useState(fromUrl?.filters ?? {})
  const [sort, setSortState] = useState(fromUrl?.sort ?? { ...DEFAULT_SORT })
  const [view, setViewState] = useState(fromUrl?.view ?? DEFAULT_VIEW)
  const [columns, setColumnsState] = useState(fromUrl?.columns ?? null)
  // A ranked scan (weighted composite + optional top_n cap, e.g. UCT 50). Owns
  // ordering when present — query.py ranks by it and top_n bounds the list — so
  // an explicit column-header sort clears it (see setSort).
  const [rank, setRankState] = useState(fromUrl?.rank ?? null)
  const [page, setPage] = useState(1)

  // ── shared-screen arrival: only when no working spec is in the URL ───────
  useEffect(() => {
    if (fromUrl) return undefined
    const token = new URLSearchParams(window.location.search).get(SHARED_SCREEN_PARAM)
    if (!token) return undefined
    let alive = true
    fetch(sharedScreenReadUrl(token))
      .then(r => (r.ok ? r.json() : null))
      .then(rec => { if (alive && rec?.spec) applySpec(rec.spec) })
      .catch(() => {})
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── URL write: debounced replaceState; local edits strip `screen=` ───────
  const writeTimer = useRef()
  const skipNextWrite = useRef(false)
  useEffect(() => {
    if (skipNextWrite.current) { skipNextWrite.current = false; return undefined }
    clearTimeout(writeTimer.current)
    writeTimer.current = setTimeout(() => {
      const url = new URL(window.location.href)
      const enc = encodeSpec({ filters, sort, view, columns, rank })
      if (enc) url.searchParams.set(SPEC_PARAM, enc)
      else url.searchParams.delete(SPEC_PARAM)
      url.searchParams.delete(SHARED_SCREEN_PARAM)
      window.history.replaceState(null, '', url)
    }, 400)
    return () => clearTimeout(writeTimer.current)
  }, [filters, sort, view, columns, rank])

  // ── back/forward restores the encoded screen ─────────────────────────────
  useEffect(() => {
    const onPop = () => {
      const dec = decodeSpec(new URLSearchParams(window.location.search).get(SPEC_PARAM))
      skipNextWrite.current = true
      setFilters(dec?.filters ?? {})
      setSortState(dec?.sort ?? { ...DEFAULT_SORT })
      setViewState(dec?.view ?? DEFAULT_VIEW)
      setColumnsState(dec?.columns ?? null)
      setRankState(dec?.rank ?? null)
      setPage(1)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const resetPage = () => setPage(1)
  const setFilter = useCallback((key, v) => {
    setFilters(prev => {
      const n = { ...prev }
      if (v) n[key] = v
      else delete n[key]
      return n
    })
    setPage(1)
  }, [])
  const clearFilters = useCallback(() => { setFilters({}); setRankState(null); setPage(1) }, [])
  // An explicit column-header sort takes over ordering, so it drops any active
  // rank (e.g. leaving the UCT-50 cap) — otherwise the click would appear to do
  // nothing because the rank still owns the order server-side.
  const setSort = useCallback(v => { setSortState(v); setRankState(null); setPage(1) }, [])
  const setRank = useCallback(r => { setRankState(r || null); setPage(1) }, [])
  const setView = useCallback(k => { setViewState(k); setColumnsState(null); setPage(1) }, [])
  const setColumns = useCallback(c => { setColumnsState(c?.length ? c : null); setPage(1) }, [])
  const applySpec = useCallback(s => {
    setFilters(prev => {
      const next = specToFilters(s)
      // ⭐ THE CHOSEN POOL SURVIVES A SCAN. A preset / saved scan carries its
      // conditions (RS, price, structure…) but is pool-agnostic — the member has
      // already picked Global Universe / UCT Universe / Watchlist / Combo, so that
      // selection is kept UNLESS the incoming spec names its own pool. This is
      // what lets a scan run WITHIN a watchlist or a combo instead of resetting
      // the pool to the whole market.
      //
      // ⛔ THE POOL IS ATOMIC. `universe` and `list` are the two reserved pool
      // keys and they are MUTUALLY EXCLUSIVE (UniverseBar clears one when it sets
      // the other). So if the incoming spec names EITHER, it owns the pool whole
      // and the current one is dropped; only when it names NEITHER do we carry
      // the member's selection forward.
      const POOL_KEYS = ['universe', 'list']
      if (!POOL_KEYS.some(k => next[k])) {
        for (const k of POOL_KEYS) if (prev[k]) next[k] = prev[k]
      }
      return next
    })
    if (s?.view) setViewState(s.view)
    // Copy, never alias: the spec belongs to the caller (a saved row in the SWR
    // cache, a fetched shared screen) — aliasing `sort`/`columns` into state
    // would let a later in-place edit reach back into the cached spec.
    if (s?.sort) setSortState({ ...s.sort })
    setColumnsState(Array.isArray(s?.columns) && s.columns.length ? [...s.columns] : null)
    setRankState(s?.rank ? { ...s.rank } : null)
    setPage(1)
  }, [])
  const loadMore = useCallback(() => setPage(p => p + 1), [])

  const visibleColumns = useMemo(
    () => columns ?? (viewColumnsFor ? viewColumnsFor(view) : null) ?? null,
    [columns, view, viewColumnsFor])
  const requestColumns = useMemo(
    () => (visibleColumns ? [...new Set([...REQUIRED_COLS, ...visibleColumns])] : null),
    [visibleColumns])

  const baseSpec = useMemo(() => ({
    filters: Object.entries(filters).filter(([, v]) => v).map(([key, v]) => ({ key, ...v })),
    sort, view, ...(columns?.length ? { columns } : {}), ...(rank ? { rank } : {}),
  }), [filters, sort, view, columns, rank])

  const scanSpec = useMemo(() => ({
    ...baseSpec,
    ...(requestColumns ? { columns: requestColumns } : {}),
    page, page_size: PAGE_SIZE,
  }), [baseSpec, requestColumns, page])

  return { filters, sort, view, columns, rank, visibleColumns, page,
    setFilter, clearFilters, setSort, setRank, setView, setColumns, applySpec,
    loadMore, resetPage, baseSpec, scanSpec }
}
