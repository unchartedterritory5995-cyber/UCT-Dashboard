/** Public track-record share link — the ONE authority over the path shape
 *  (screener/notebook share-link posture: the route in App.jsx and the
 *  copy-link button both derive from here, so they cannot drift apart). */

export const TRACK_RECORD_ROUTE = '/track/:token'

export function trackRecordPath(token) {
  return `/track/${encodeURIComponent(token)}`
}

export function buildTrackRecordUrl(token) {
  const origin = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'https://uctintelligence.com'
  return `${origin}${trackRecordPath(token)}`
}
