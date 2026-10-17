// app/src/hooks/usePatternDetections.js — SWR-cached hook for engine-detected chart patterns.
//
// Fetches Detection records from GET /api/patterns/{sym}?tf={tf}&min_conf={n} and polls every 30s
// to keep the overlay fresh as new patterns emerge during the trading day.
//
// Returns { detections, count, isLoading, error }. When `enabled` is false (or sym/tf missing),
// the SWR key is null so the request is suppressed entirely — safe to mount before user toggles.
import { useMemo } from 'react'
import useSWR from 'swr'

const EMPTY = Object.freeze([])

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })

export function usePatternDetections(sym, tf, enabled = true, minConf = 50, { includeStructures = false } = {}) {
  // confirmed_only=false: the on-chart overlay needs the full rule-engine detection
  // geometry to draw shapes. The confirmed-vision surface lives on /confirmed/{sym}.
  // includeStructures (AUTO_STRUCTURES_ENABLED, admins): the server adds the current
  // base boxes as `structures` and the learned auto-drawer's lines as `drawn`;
  // a member's request never carries the parameter.
  const key =
    enabled && sym && tf
      ? `/api/patterns/${encodeURIComponent(sym)}?tf=${encodeURIComponent(tf)}&min_conf=${minConf}&confirmed_only=false${includeStructures ? '&include_structures=true' : ''}`
      : null

  const { data, error, isLoading } = useSWR(key, fetcher, {
    refreshInterval: 30_000, // poll every 30s for fresh detections
    revalidateOnFocus: true,
    dedupingInterval: 5_000,
  })

  // Memoized on the response object so the merged list keeps its identity between renders.
  const detections = useMemo(() => {
    const base = data?.detections || EMPTY
    const structures = Array.isArray(data?.structures) ? data.structures : EMPTY
    return structures.length ? [...base, ...structures] : base
  }, [data])
  return {
    detections,
    // The learned auto-drawer (admin + AUTO_STRUCTURES_ENABLED, D/W/M): trendlines,
    // levels and the display rules that ride with them. null whenever absent.
    drawn: data?.drawn || null,
    count: data?.count || 0,
    isLoading,
    error,
  }
}

export default usePatternDetections
