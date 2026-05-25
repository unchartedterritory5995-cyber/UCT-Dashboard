/**
 * Shared relative-time helper.
 *
 * Accepts unix-seconds int, unix-millis int, or an ISO string.
 * Tweet store returns unix-seconds, so we extend the original
 * AlertBell behaviour to handle ints.
 *
 * Format choices:
 *   < 60s   → "{n}s ago"  (or "now" via the AlertBell-compatible short() helper)
 *   < 1h    → "{n}m ago"
 *   < 1d    → "{n}h ago"
 *   else    → "{n}d ago"
 */
export function timeAgo(ts) {
  if (ts === null || ts === undefined || ts === '') return ''
  let ms
  if (typeof ts === 'number') {
    ms = ts < 1e12 ? ts * 1000 : ts
  } else {
    ms = new Date(ts).getTime()
  }
  if (Number.isNaN(ms)) return ''
  const diff = (Date.now() - ms) / 1000
  if (diff < 60) return `${Math.max(0, Math.floor(diff))}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

/** Short variant used by AlertBell: "now / 5m / 2h / 3d" (no "ago"). */
export function timeAgoShort(ts) {
  if (ts === null || ts === undefined || ts === '') return ''
  let ms
  if (typeof ts === 'number') {
    ms = ts < 1e12 ? ts * 1000 : ts
  } else {
    ms = new Date(ts).getTime()
  }
  if (Number.isNaN(ms)) return ''
  const diff = (Date.now() - ms) / 1000
  if (diff < 60) return 'now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}
