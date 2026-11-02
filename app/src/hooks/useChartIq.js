// app/src/hooks/useChartIq.js — the Chart IQ read of one daily chart (GET /api/chart-iq/{sym}).
//
// The engine reads DAILY bars, so the request is made only on a daily chart and only while `enabled` (the toggle is on and the
// viewer is allowed): otherwise the SWR key is null and nothing is fetched. The read changes once a session, so there is no
// polling; the server caches it too.
import useSWR from 'swr'

// A failed read carries the server's reason (`detail`) and status, so the panel can say WHY instead of a bare failure.
const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then(async (r) => {
    if (!r.ok) {
      let detail = ''
      try { detail = (await r.json())?.detail || '' } catch { /* not JSON */ }
      const e = new Error(detail || `HTTP ${r.status}`)
      e.status = r.status
      e.detail = typeof detail === 'string' ? detail : ''
      throw e
    }
    return r.json()
  })

export function chartIqKey(sym, tf, enabled) {
  return enabled && sym && String(tf || '') === 'D' ? `/api/chart-iq/${encodeURIComponent(String(sym).toUpperCase())}` : null
}

export function useChartIq(sym, tf, enabled) {
  const { data, error, isLoading } = useSWR(chartIqKey(sym, tf, enabled), fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
    shouldRetryOnError: false,
  })
  return { data: data || null, error: error || null, isLoading }
}

export default useChartIq
