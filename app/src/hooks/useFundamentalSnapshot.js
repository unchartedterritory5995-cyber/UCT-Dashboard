import useMobileSWR from './useMobileSWR'
import { snapshotKey, snapshotFetcher } from './fundamentalSnapshotKey'

// Consolidated ratings + key fundamentals for the glanceable snapshot card.
// Only fetches when `enabled` (e.g. the Fundamentals tab is actually open).
export default function useFundamentalSnapshot(rawSym, enabled = true) {
  const key = enabled ? snapshotKey(rawSym) : null
  // 5-min re-poll: the backend serves instantly (stale-while-revalidate), so a
  // stale-served card picks up the background rebuild without a remount.
  const { data, isLoading } = useMobileSWR(key, snapshotFetcher, { refreshInterval: 5 * 60 * 1000 })
  return { data: data || null, isLoading: isLoading && !data }
}
