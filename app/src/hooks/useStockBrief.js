import useMobileSWR from './useMobileSWR'

const fetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null))

/**
 * Per-stock profile for the Stock Profile widget: YTD performance stats, the last
 * 4 reported earnings, and an AI company description + this-year thematic
 * narrative. Polls fast while the AI profile is still generating, then settles to
 * a market-hours-aware cadence (the YTD stats develop through the trading day).
 */
export default function useStockBrief(sym, { generating = false } = {}) {
  const { data, error, isLoading } = useMobileSWR(
    sym ? `/api/stock-brief/${encodeURIComponent(sym)}` : null,
    fetcher,
    {
      refreshInterval: generating ? 4000 : 30000,
      dedupingInterval: 8000,
      revalidateOnFocus: false,
      marketHoursOnly: true,
    },
  )
  return {
    status: data?.status || (isLoading ? 'loading' : 'ready'),
    company: data?.company || null,
    stats: data?.stats || null,
    earnings: data?.earnings || [],
    profile: data?.profile || null,
    generatedAt: data?.generated_at || null,
    error,
    isLoading,
  }
}
