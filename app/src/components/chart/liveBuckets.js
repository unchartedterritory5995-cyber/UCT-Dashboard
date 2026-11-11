// app/src/components/chart/liveBuckets.js — the LIVE-writer side of the 60m grid policy
// (bucket ends, the stream's wire session). Split out of barTime.js on 2026-11-11 so the
// shared entry chunk (marketSession / barsIDB / liveBarClassify import barTime) does not
// carry code only the chart's live writers use (notebook first-open bytes budget).
import {
  bucketStartUnix, etMinuteOfDay, fromChartTime, rthCloseMinuteOf, sixtyMinGridFor, toChartTime,
  RTH_OPEN_MIN, SIXTY_MIN_GRID_BY_SESSION, DEFAULT_SIXTY_MIN_GRID, _GRID_ALIAS,
} from './barTime'

/** The /api/stream/bars `session` (wire name 'rth' | 'eth') whose 60m buckets
 *  match the series this chart view FETCHES. Follows the grid policy: the
 *  extended view fetches (`/api/bars?session=eth`) and so streams the clock
 *  grid, the RTH view the session grid. */
export function liveStreamSession(showExtended, policy = SIXTY_MIN_GRID_BY_SESSION) {
  return sixtyMinGridFor(showExtended ? 'extended' : 'rth', policy) === 'clock' ? 'eth' : 'rth'
}

/**
 * Unix second at which the bucket STARTING at (or containing) `unixSec` ends
 * (exclusive). Client twin of `bar_rollup.tv_bucket_bounds(..)[1]`: on the
 * session grid the 09:00 pre-market stub ends at 09:30 and the last regular bar
 * at the close (16:00, or 13:00 on a half-day).
 * ⭐ Canonical client bucket end — liveBarMerge.bucketEndTime should delegate here
 * (via `bucketEndChartTime`) rather than re-encode the anchors.
 */
export function bucketEndUnix(unixSec, tfMin, { grid } = {}) {
  const tf = Number(tfMin)
  const start = bucketStartUnix(unixSec, tf, { grid })
  if (tf !== 60) return start + (tf > 0 ? tf : 5) * 60
  // No grid named → the grid /api/bars serves by default (NOT the policy's extended view).
  const g = _GRID_ALIAS[grid || DEFAULT_SIXTY_MIN_GRID] || 'session'
  if (g === 'clock') return start + 3600
  const m0 = etMinuteOfDay(start)
  const close = rthCloseMinuteOf(start)
  let endMin = m0 + 60
  if (m0 < RTH_OPEN_MIN) endMin = Math.min(endMin, RTH_OPEN_MIN)
  else if (m0 < close) endMin = Math.min(endMin, close)
  return start + (endMin - m0) * 60
}

/** `bucketEndUnix` in chart-time space (what live writers compare `bar.time` to).
 *  `session` is 'rth' | 'eth' | 'extended' (wire names accepted). */
export function bucketEndChartTime(chartTime, tf, session = 'rth') {
  const grid = session === 'eth' ? 'clock' : session === 'rth' ? 'session' : sixtyMinGridFor(session)
  return toChartTime(bucketEndUnix(fromChartTime(chartTime), Number(tf), { grid }))
}
