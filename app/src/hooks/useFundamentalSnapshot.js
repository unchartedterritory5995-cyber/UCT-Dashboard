import useMobileSWR from './useMobileSWR'
import { sectionFetcher } from '../components/research/sections/sectionFetch'

// TERM-033: a failed read THROWS (sectionFetcher), so a failed 5-min refresh keeps the card
// on screen instead of replacing it with `null`. 402 stays absent, as before.
const fetcher = (url) => sectionFetcher(url).then((d) => (d?.paywalled ? null : d))

// Consolidated ratings + key fundamentals for the glanceable snapshot card.
// Only fetches when `enabled` (e.g. the Fundamentals tab is actually open).
export default function useFundamentalSnapshot(rawSym, enabled = true) {
  const sym = (rawSym || '').toUpperCase().trim()
  const key = enabled && sym ? `/api/research/snapshot/${sym}` : null
  // 5-min re-poll: the backend serves instantly (stale-while-revalidate), so a
  // stale-served card picks up the background rebuild without a remount.
  const { data, isLoading } = useMobileSWR(key, fetcher, { refreshInterval: 5 * 60 * 1000 })
  return { data: data || null, isLoading: isLoading && !data }
}
