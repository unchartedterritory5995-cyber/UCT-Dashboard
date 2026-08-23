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
      const enc = encodeSpec({ filters, sort, view, columns })
      if (enc) url.searchParams.set(SPEC_PARAM, enc)
      else url.searchParams.delete(SPEC_PARAM)
      url.searchParams.delete(SHARED_SCREEN_PARAM)
      window.history.replaceState(null, '', url)
    }, 400)
    return () => clearTimeout(writeTimer.current)
  }, [filters, sort, view, columns])

  // ── back/forward restores the encoded screen ─────────────────────────────
  useEffect(() => {
    const onPop = () => {
      const dec = decodeSpec(new URLSearchParams(window.location.search).get(SPEC_PARAM))
      skipNextWrite.current = true
      setFilters(dec?.filters ?? {})
      setSortState(dec?.sort ?? { ...DEFAULT_SORT })
      setViewState(dec?.view ?? DEFAULT_VIEW)
      setColumnsState(dec?.columns ?? null)
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
  const clearFilters = useCallback(() => { setFilters({}); setPage(1) }, [])
  const setSort = useCallback(v => { setSortState(v); setPage(1) }, [])
  const setView = useCallback(k => { setViewState(k); setColumnsState(null); setPage(1) }, [])
  const setColumns = useCallback(c => { setColumnsState(c?.length ? c : null); setPage(1) }, [])
  const applySpec = useCallback(s => {
    setFilters(specToFilters(s))
    if (s?.view) setViewState(s.view)
    // Copy, never alias: the spec belongs to the caller (a saved row in the SWR
    // cache, a fetched shared screen) — aliasing `sort`/`columns` into state
    // would let a later in-place edit reach back into the cached spec.
    if (s?.sort) setSortState({ ...s.sort })
    setColumnsState(Array.isArray(s?.columns) && s.columns.length ? [...s.columns] : null)
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
    sort, view, ...(columns?.length ? { columns } : {}),
  }), [filters, sort, view, columns])

  const scanSpec = useMemo(() => ({
    ...baseSpec,
    ...(requestColumns ? { columns: requestColumns } : {}),
    page, page_size: PAGE_SIZE,
  }), [baseSpec, requestColumns, page])

  return { filters, sort, view, columns, visibleColumns, page,
    setFilter, clearFilters, setSort, setView, setColumns, applySpec,
    loadMore, resetPage, baseSpec, scanSpec }
}
