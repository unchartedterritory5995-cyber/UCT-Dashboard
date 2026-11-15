// The rows a list scan is about to reach, NEAREST FIRST, in the direction it is moving.
//
// ⭐ W-L (2026-11-11). A watchlist ArrowDown scan used to warm only what IndexedDB
// already held (`warmMemFromIDB`, zero network) for ±6 rows. Anything the list-open
// prewarm left BEHIND the session frontier — a list opened before the bell, or simply
// more than ~10 minutes ago on 5m — was refused by the chart's paint rule and every
// switch waited on its own `/api/bars` (measured: keypress→current-frame p50 107 ms,
// 72/96 switches >100 ms, against 33 ms when the rows were current). The scan
// direction decides which rows get the NETWORK warm: `ahead` rows the way the member
// is moving, `behind` a couple the other way (a reversal is one press away).
//
// Wrap-aware (the nav wraps at both ends), deduped, never includes the current row.
export function scanNeighbors(flat, idx, dir = 1, { ahead = 6, behind = 2 } = {}) {
  const len = Array.isArray(flat) ? flat.length : 0
  if (len < 2 || idx < 0 || idx >= len) return []
  const step = dir < 0 ? -1 : 1
  const out = []
  const seen = new Set([flat[idx]])
  const add = (i) => {
    const s = flat[((i % len) + len) % len]
    if (s && !seen.has(s)) { seen.add(s); out.push(s) }
  }
  for (let d = 1; d <= ahead; d++) add(idx + step * d)
  for (let d = 1; d <= behind; d++) add(idx - step * d)
  return out
}
