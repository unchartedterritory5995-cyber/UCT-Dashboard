// app/src/components/chart/crosshairSync.js
// Cross-timeframe crosshair sync for linked charts (Charts workspace color groups).
//
// Two charts in the same color group can sit on DIFFERENT timeframes, and the two
// bar-time families are not comparable:
//   • D/W/M  → 'YYYY-MM-DD' strings
//   • intraday → epoch SECONDS already shifted to ET (StockChart's adjustTime)
// The original sync compared them directly, so anything crossing that boundary
// silently failed: a daily string never satisfied `typeof t === 'number'` (no snap
// at all), and an intraday number binary-searched against strings gave nonsense.
//
// So a synced payload carries a normalized ET calendar `day` plus — intraday only —
// the exact ET-shifted instant `t`, and the receiver uses whichever its own series
// can consume.

/** ET calendar day ('YYYY-MM-DD') for either bar-time representation, else null. */
export function etDayOf(time) {
  if (typeof time === 'string') return time.slice(0, 10) || null
  if (!Number.isFinite(time)) return null
  // Intraday times are pre-shifted to ET, so the UTC parts ARE the ET wall clock.
  const d = new Date(time * 1000)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/**
 * Which bar on the RECEIVING chart a synced {day, t} should mark.
 *
 * @param bars   the receiver's own bars, ascending, each { t, ... }
 * @param adjust the receiver's adjustTime (numeric → ET-shifted; strings pass through)
 * @param day    'YYYY-MM-DD' of the hovered bar (always present)
 * @param t      the hovered ET-shifted instant, or null when the source was D/W/M
 * @returns the series time to hand to setCrosshairPosition, or null when the
 *          target isn't loaded here — the caller should then CLEAR rather than
 *          park the crosshair on an unrelated bar.
 */
export function snapSyncedBar(bars, adjust, day, t) {
  if (!bars || !bars.length) return null

  if (typeof bars[0].t === 'string') {
    // D/W/M receiver: the last bar at or before the day — exact for Daily, and
    // the CONTAINING week/month for W/M.
    if (!day) return null
    let lo = 0, hi = bars.length - 1, best = null
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (String(bars[mid].t).slice(0, 10) <= day) { best = bars[mid]; lo = mid + 1 } else hi = mid - 1
    }
    return best ? best.t : null
  }

  // Intraday receiver.
  if (Number.isFinite(t)) {
    // Source was also intraday → nearest bar by instant.
    let lo = 0, hi = bars.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (adjust(bars[mid].t) < t) lo = mid; else hi = mid
    }
    const a = adjust(bars[lo].t), b = adjust(bars[hi].t)
    return Math.abs(a - t) <= Math.abs(b - t) ? a : b
  }

  // Source was D/W/M → mark that DAY on this intraday series, using its LAST bar
  // of the day so both charts' readouts agree on the same close. Walking
  // backwards stops as soon as we pass the day; not loaded here ⇒ null.
  if (!day) return null
  for (let i = bars.length - 1; i >= 0; i--) {
    const at = adjust(bars[i].t)
    const d = etDayOf(at)
    if (d === day) return at
    if (d && d < day) break
  }
  return null
}
