import useMobileSWR from './useMobileSWR'
import { snapshotKey, snapshotFetcher } from './fundamentalSnapshotKey'
import { useKeyRest, useAskWhenRested } from '../lib/symbolPace'

// Consolidated ratings + key fundamentals for the glanceable snapshot card.
// Only fetches when `enabled` (e.g. the Fundamentals tab is actually open).
export default function useFundamentalSnapshot(rawSym, enabled = true) {
  const key = enabled ? snapshotKey(rawSym) : null
  // 5-min re-poll: the backend serves instantly (stale-while-revalidate), so a
  // stale-served card picks up the background rebuild without a remount.
  // A symbol the member is racing past is not asked for (lib/symbolPace.js); what the browser
  // already holds for it is still shown at once.
  const rest = useKeyRest(key)
  const { data, isLoading, mutate } = useMobileSWR(key, snapshotFetcher, { refreshInterval: 5 * 60 * 1000, isPaused: rest.isPaused })
  useAskWhenRested(rest, key, data, mutate)
  return { data: data || null, isLoading: isLoading && !data }
}
