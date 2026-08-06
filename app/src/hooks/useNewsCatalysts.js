import useMobileSWR from './useMobileSWR'

const fetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null))

/**
 * Per-stock News & Catalysts feed. Polls fast while the historical catalysts are
 * still generating, then settles to a ~20s live cadence (market-hours-aware, so it
 * slows 10x when the market is closed and pauses on a hidden tab). No SSE — the
 * backend reads DBs the app already updates continuously (see service.py).
 */
export default function useNewsCatalysts(sym, { generating = false } = {}) {
  const { data, error, isLoading } = useMobileSWR(
    sym ? `/api/news-catalysts/${encodeURIComponent(sym)}` : null,
    fetcher,
    {
      refreshInterval: generating ? 4000 : 20000,
      dedupingInterval: 8000,
      revalidateOnFocus: false,
      marketHoursOnly: true,
    },
  )
  return {
    status: data?.status || (isLoading ? 'loading' : 'ready'),
    events: data?.events || [],
    generatedAt: data?.generated_at || null,
    error,
    isLoading,
  }
}
