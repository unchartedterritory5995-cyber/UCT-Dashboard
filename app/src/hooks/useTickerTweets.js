import useSWR from 'swr'

const fetcher = (url) => fetch(url).then((r) => (r.ok ? r.json() : []))

/**
 * Fetch tweets that mention a specific ticker.
 * Used by EarningsModal on open + by MoversSidebar's expanded-row panel.
 */
export default function useTickerTweets(sym, { hours = 24, enabled = true } = {}) {
  const key = enabled && sym ? `/api/tweets/ticker/${sym}?hours=${hours}` : null
  return useSWR(key, fetcher, { revalidateOnFocus: false })
}
