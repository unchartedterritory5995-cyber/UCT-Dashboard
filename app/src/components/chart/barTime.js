// Shared time helpers for the dashboard's charts.
// Extracted from StockChart so other consumers (Journal 2.0 markers,
// overlays, etc.) can produce bar-aligned times without duplicating the
// logic.

function computeETOffset() {
  const now = new Date()
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' })
  const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' })
  return (new Date(etStr) - new Date(utcStr)) / 1000
}

export const ET_OFFSET = computeETOffset()

export const PERIOD_SECONDS = { '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600 }

/**
 * Given a timeframe code and a UTC-seconds timestamp, return the value
 * that LW Charts uses as the bar's `time`:
 *   - Intraday (1/5/15/30/60): number — period-floor in UTC, +ET_OFFSET
 *   - Daily ('D'): "YYYY-MM-DD" string in ET
 *   - Weekly ('W'): "YYYY-MM-DD" of the Friday (close) of the ET week
 *   - Monthly ('M'): "YYYY-MM-01" of the ET month
 */
export function computeBarTime(tf, tickTimeSec) {
  if (tf === 'D') {
    return new Date(tickTimeSec * 1000).toLocaleDateString('en-CA', {
      timeZone: 'America/New_York',
    })
  }
  if (tf === 'W') {
    // Date the weekly bar by the week's CLOSE (Friday), matching the backend
    // resample. Walk to Monday first, then +4 days = Friday. Stable per-week
    // key so live ticks update the same candle instead of creating a new one.
    const d = new Date(tickTimeSec * 1000)
    const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const day = et.getDay()
    et.setDate(et.getDate() - day + (day === 0 ? -6 : 1) + 4)
    return et.toISOString().split('T')[0]
  }
  if (tf === 'M') {
    const d = new Date(tickTimeSec * 1000)
    const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-01`
  }
  // 60-min: match the backend's ET-anchored hourly bucketing (bucket_60_et_unix_seconds):
  // the 9:30–9:59 ET session-open bar anchors at 9:30; every other hour floors to the
  // clock hour. Without this the frontend keyed the first hour at 9:00, so the live tick
  // planted a fresh FLAT bar instead of updating the fetched 9:30 partial (open lost).
  if (tf === '60') {
    const clockHour = Math.floor(tickTimeSec / 3600) * 3600 + ET_OFFSET
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(new Date(tickTimeSec * 1000))
      const etHour = +parts.find(p => p.type === 'hour').value
      const etMin = +parts.find(p => p.type === 'minute').value
      if (etHour === 9 && etMin >= 30) return clockHour + 1800   // the "clean open" 9:30 bar
    } catch { /* fall through to the clock-hour bucket */ }
    return clockHour
  }
  // Intraday: floor to period boundary in UTC, offset to ET for display
  const period = PERIOD_SECONDS[tf] || 300
  return Math.floor(tickTimeSec / period) * period + ET_OFFSET
}
