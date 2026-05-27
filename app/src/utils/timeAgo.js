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

/**
 * Format a unix timestamp as a short Eastern-time absolute string.
 *
 *   Same day:    "9:32 AM EDT"   (or EST in winter — browser handles DST)
 *   Earlier day: "May 25, 9:32 AM EDT"
 *
 * Used by the catalyst table to show per-row synthesis time. Trading
 * clock is ET, so we always render in America/New_York regardless of
 * the user's locale.
 */
export function formatET(ts) {
  if (ts === null || ts === undefined || ts === '') return ''
  let ms
  if (typeof ts === 'number') {
    ms = ts < 1e12 ? ts * 1000 : ts
  } else {
    ms = new Date(ts).getTime()
  }
  if (Number.isNaN(ms)) return ''

  const d = new Date(ms)
  const now = new Date()
  // Compare dates in ET
  const fmtDate = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const sameDay = fmtDate.format(d) === fmtDate.format(now)

  if (sameDay) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(d)
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(d)
}

/**
 * Always render just the time-of-day in ET: "9:32 AM EDT".
 * Unlike formatET, never includes the date — use for "Updated 9:32 AM EDT"
 * or "Last refresh: 9:32 AM EDT" displays.
 */
export function formatETTime(ts) {
  if (ts === null || ts === undefined || ts === '') return ''
  let ms
  if (typeof ts === 'number') {
    ms = ts < 1e12 ? ts * 1000 : ts
  } else {
    ms = new Date(ts).getTime()
  }
  if (Number.isNaN(ms)) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(ms))
}

/**
 * Always render just the date in ET: "May 25, 2026".
 * Use for date-only displays where time isn't meaningful (e.g. "as of May 25").
 */
export function formatETDate(ts) {
  if (ts === null || ts === undefined || ts === '') return ''
  let ms
  if (typeof ts === 'number') {
    ms = ts < 1e12 ? ts * 1000 : ts
  } else {
    ms = new Date(ts).getTime()
  }
  if (Number.isNaN(ms)) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: 'short', day: 'numeric',
  }).format(new Date(ms))
}

/**
 * Full date + time in ET: "May 25, 2026, 9:32 AM EDT".
 * Use for tooltips, audit logs, or anywhere unambiguous absolute is required.
 */
export function formatETFull(ts) {
  if (ts === null || ts === undefined || ts === '') return ''
  let ms
  if (typeof ts === 'number') {
    ms = ts < 1e12 ? ts * 1000 : ts
  } else {
    ms = new Date(ts).getTime()
  }
  if (Number.isNaN(ms)) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(ms))
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
