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

// >2% apart at a shared bar = stale / wrong scale (split, wrong company). Owned here so the
// pack keep-rule, the chart's basis heal and the monotonic writer ask ONE question.
export function _closeMismatch(a, b) {
  if (!a || !b) return false                        // no shared bar to compare → don't force a heal
  const ac = +a.c, bc = +b.c
  if (!Number.isFinite(ac) || !Number.isFinite(bc) || bc === 0) return false
  return Math.abs(ac - bc) / Math.abs(bc) > 0.02    // >2% at a shared CLOSED session = stale/wrong scale
}

// ── THE ONE WRITE RULE (W-L 2026-11-11, reviews of #1095) ────────────────────────────
// How a server ANSWER lands on what is stored NOW (`cur` must already have passed the
// reader's validity rules — barsIDB `_entryReadable`; an unreadable entry is passed as null):
//   • overlapping timestamps: the ANSWER wins (corrections always land) — unless the stored
//     set was written AFTER this request began (`curIsNewer`: a later answer already landed);
//   • a FULL answer is authoritative over [answer[0].t, answer.tail]: stored bars in that
//     range that the answer does not carry are DROPPED (off-grid / stale / wrong-basis rows);
//   • deeper history (< answer[0].t) is kept only if it joins the answer cleanly — no >2%
//     close mismatch at the seam (`_closeMismatch`) — otherwise the answer replaces it;
//   • stored bars NEWER than the answer's tail are kept (tail age decides only this): the
//     result's tail is never older than what was stored;
//   • a DELTA (`since=`) merges into the stored set; with nothing stored it writes nothing.
export function mergeMonotonic(cur, incoming, { delta = false, curIsNewer = false } = {}) {
  if (!incoming?.length) return cur?.length ? cur : null
  if (!cur?.length) return delta ? null : incoming
  if (curIsNewer) return mergeDelta(incoming, cur)
  if (delta) return mergeDelta(cur, incoming)
  const first = incoming[0].t
  const last = incoming[incoming.length - 1].t
  const seam = cur.find(b => String(b.t) === String(first))
  const before = _closeMismatch(seam, incoming[0]) ? [] : cur.filter(b => b.t < first)
  const after = cur.filter(b => b.t > last)
  if (!before.length && !after.length) return incoming
  return [...before, ...incoming, ...after]
}
