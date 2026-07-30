// Single source of truth for "how should this live price/snapshot be applied
// to the chart's last bar?" — shared by StockChart's two live-apply paths
// (the tick effect and the post-setData re-apply) so they can't drift.
//
// The hard case this exists for: when the SSE stream is down the chart runs on
// the 2s REST floor, whose snapshots carry day_open/day_high/day_low/prev_close
// but NO updated_at. With no tick timestamp the old code fell back to the last
// bar's time, concluded "same bar", and fused today's price onto a STALE prior-
// session daily bar — the "Frankenstein candle" (PAYO 2026-06-15: the 7.03 live
// price painted onto the frozen Fri 6/12 daily while the real 6/15 session was
// already complete). Here we recover the new session from the snapshot itself.

import { computeBarTime, PERIOD_SECONDS } from './barTime'

const DWM = new Set(['D', 'W', 'M'])

/**
 * @param {object}   p
 * @param {string}   p.tf        timeframe code ('1'|'5'|'15'|'30'|'60'|'D'|'W'|'M')
 * @param {object}   p.last      current last bar — { time, close }
 * @param {object}   p.live      merged live snapshot — { day_open, prev_close, ... }
 * @param {number=}  p.tickSec   tick timestamp (UTC seconds) when the SSE stream
 *                               provided one; undefined on the REST-only floor
 * @param {number=}  p.nowSec    Date.now()/1000 — wall clock fallback (only used
 *                               once a new session is independently confirmed)
 * @returns {{kind:'new', time:(string|number)} | {kind:'update'} | {kind:'skip'}}
 *   - 'new'    start a fresh bar at `time` (D/W/M build it from session OHLC)
 *   - 'update' fold the tick into the existing last bar
 *   - 'skip'   a new D/W/M day but the session isn't confirmed yet — leave the
 *              last bar untouched (NEVER fuse today's price onto a prior bar)
 */
export function classifyLiveBar({ tf, last, live, tickSec, nowSec }) {
  if (!last || last.time == null) return { kind: 'skip' }
  const isDWM = DWM.has(tf)

  // ── Intraday: timestamp-driven ──────────────────────────────────────────
  if (!isDWM) {
    if (tickSec) {
      const barTime = computeBarTime(tf, tickSec)
      if (barTime !== last.time && barTime > last.time) {
        // Contiguity guard (mirror of the REST-floor branch below). Only plant a
        // NEW bar for the IMMEDIATE next bucket. If barTime is MORE than one
        // interval past last.time, the fetched tail is stale/holed (the buckets in
        // between are missing) — planting here drops a lone developing candle
        // detached from the tail AND advances the newest-bar time so the tail-age
        // freshness gate thinks the cache is fresh, masking the hole so the delta
        // poll never backfills it (the "candles missing until I flip timeframe"
        // bug). SKIP instead; the full refetch (idbStaleIntraday / _hasIntradayGap)
        // fills the gap, then the next tick plants contiguously. A session-boundary
        // jump (overnight) is also skipped and likewise healed by the stale-tail
        // refetch — correct, not a regression.
        const period = PERIOD_SECONDS[tf] || 300
        if (barTime - last.time > period) return { kind: 'skip' }
        return { kind: 'new', time: barTime }
      }
      return { kind: 'update' }
    }
    // REST floor: the tick has NO timestamp, so we can't confirm which bucket it
    // belongs to. Blindly folding it into `last` is only safe when `last` IS the
    // current bucket. If `now` is already PAST last's bucket, the chart is
    // missing candles (e.g. a stale intraday cache after a fast scan) — folding
    // the live price onto that stale bar fuses the whole gap into ONE giant
    // candle (the MSFT 5m artifact). SKIP instead; the 30s delta poll / push
    // feed fills the gap with real bars. (We don't CREATE a bar from nowSec —
    // an off-hours straggler could land on a non-trading bucket.)
    if (typeof nowSec === 'number') {
      const curBar = computeBarTime(tf, nowSec)
      if (curBar != null && curBar > last.time) return { kind: 'skip' }
    }
    return { kind: 'update' }
  }

  // ── Daily / Weekly / Monthly ────────────────────────────────────────────
  const sessionConfirmed = Number(live?.day_open) > 0

  // Primary path: the tick carries a real timestamp (SSE healthy). A newer
  // period only becomes a bar once the session is confirmed by day_open>0,
  // otherwise we must NOT touch yesterday's bar (pre-market straggler).
  if (tickSec) {
    const barTime = computeBarTime(tf, tickSec)
    if (barTime !== last.time && barTime > last.time) {
      return sessionConfirmed ? { kind: 'new', time: barTime } : { kind: 'skip' }
    }
    return { kind: 'update' }
  }

  // Fallback path: REST floor, no tick timestamp. Recover the new session from
  // the snapshot — the last cached bar IS the prior session's close
  // (last.close ≈ prev_close) AND a session is underway (day_open>0). This
  // match is weekend-safe: between sessions prev_close is two sessions back, so
  // it won't equal the last (most-recent-session) bar — no phantom weekend bar.
  const prevClose = Number(live?.prev_close)
  const lastClose = Number(last.close)
  const priorCloseMatch =
    Number.isFinite(prevClose) && prevClose > 0 &&
    Number.isFinite(lastClose) &&
    Math.abs(lastClose - prevClose) <= Math.max(1e-4, prevClose * 5e-4)

  if (sessionConfirmed && priorCloseMatch && typeof nowSec === 'number') {
    const barTime = computeBarTime(tf, nowSec)
    if (barTime !== last.time && barTime > last.time) return { kind: 'new', time: barTime }
  }

  // Can't confirm a new session — fold into the current-session last bar.
  return { kind: 'update' }
}
