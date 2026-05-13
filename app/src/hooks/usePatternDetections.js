// app/src/hooks/usePatternDetections.js — SWR-cached hook for engine-detected chart patterns.
//
// Fetches Detection records from GET /api/patterns/{sym}?tf={tf}&min_conf={n} and polls every 30s
// to keep the overlay fresh as new patterns emerge during the trading day.
//
// Returns { detections, count, isLoading, error }. When `enabled` is false (or sym/tf missing),
// the SWR key is null so the request is suppressed entirely — safe to mount before user toggles.
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })

export function usePatternDetections(sym, tf, enabled = true, minConf = 50) {
  const key =
    enabled && sym && tf
      ? `/api/patterns/${encodeURIComponent(sym)}?tf=${encodeURIComponent(tf)}&min_conf=${minConf}`
      : null

  const { data, error, isLoading } = useSWR(key, fetcher, {
    refreshInterval: 30_000, // poll every 30s for fresh detections
    revalidateOnFocus: true,
    dedupingInterval: 5_000,
  })

  return {
    detections: data?.detections || [],
    count: data?.count || 0,
    isLoading,
    error,
  }
}

export default usePatternDetections
