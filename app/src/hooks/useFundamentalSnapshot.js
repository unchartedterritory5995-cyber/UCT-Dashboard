import useMobileSWR from './useMobileSWR'

const fetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

// Consolidated ratings + key fundamentals for the glanceable snapshot card.
// Only fetches when `enabled` (e.g. the Fundamentals tab is actually open).
export default function useFundamentalSnapshot(rawSym, enabled = true) {
  const sym = (rawSym || '').toUpperCase().trim()
  const key = enabled && sym ? `/api/research/snapshot/${sym}` : null
  const { data, isLoading } = useMobileSWR(key, fetcher)
  return { data: data || null, isLoading: isLoading && !data }
}
