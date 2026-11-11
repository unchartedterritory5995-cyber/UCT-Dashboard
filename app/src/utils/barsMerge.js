// Pure bar-series merges (no IndexedDB, no memory cache) shared by barsIDB and barsMemCache.

/**
 * Merge a delta (new bars from server) into an existing bar array.
 * Delta bars REPLACE existing bars with the same timestamp — server data
 * is always fresher than a cached developing candle or stale IDB entry.
 */
export function mergeDelta(existing, delta) {
  if (!delta?.length) return existing
  if (!existing?.length) return delta
  const deltaMap = new Map(delta.map(b => [String(b.t), b]))
  // Keep existing bars whose timestamp is NOT in the delta (delta wins on conflict)
  const kept = existing.filter(b => !deltaMap.has(String(b.t)))
  const merged = [...kept, ...delta]
  // Sort: ISO date strings sort lexically; unix seconds sort numerically
  const isDate = typeof merged[0]?.t === 'string'
  merged.sort((a, b) => isDate
    ? (a.t > b.t ? 1 : a.t < b.t ? -1 : 0)
    : a.t - b.t
  )
  return merged
}

// A write never moves a cache backwards (see barsIDB `idbPutMonotonic`): merge `incoming`
// into what is stored NOW; on overlapping bars the source with the newer tail wins.
//   tail(result) = max(tail(cur), tail(incoming)); bars(result) ⊇ both (by timestamp).
// A DELTA with nothing to merge into is not a chart → null.
// `curIsNewer`: the stored set was WRITTEN after the incoming request began (a later fetch
// already landed). On an equal tail it then wins every overlapping bar — a late answer for
// the same day/bucket never overwrites a fresher close.
export function mergeMonotonic(cur, incoming, { delta = false, curIsNewer = false } = {}) {
  if (!incoming?.length) return cur?.length ? cur : null
  if (!cur?.length) return delta ? null : incoming
  const ct = cur[cur.length - 1]?.t
  const it = incoming[incoming.length - 1]?.t
  const incomingWins = it > ct || (it === ct && !curIsNewer)
  return incomingWins ? mergeDelta(cur, incoming) : mergeDelta(incoming, cur)
}
