// Shared market-session helpers for daily-bar freshness. StockChart's daily
// staleness gate and the prefetch warmer MUST agree on "what session should a
// fresh daily series include" — so both import this one source of truth.

/**
 * The ET date ('YYYY-MM-DD') of the most recent daily session that SHOULD be
 * present in a fresh daily series: today once the market has opened on a weekday
 * (>= 9:30 ET), else the previous weekday. Weekend/pre-open aware. Holidays are
 * not tracked client-side — a rare holiday only costs a brief refetch, never
 * stale data on screen.
 */
export function expectedLatestDailySessionET() {
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const dow = nowET.getDay()               // 0 Sun … 6 Sat
  const mins = nowET.getHours() * 60 + nowET.getMinutes()
  const d = new Date(nowET)
  if (!(dow >= 1 && dow <= 5 && mins >= 570)) { // not a weekday at/after 9:30 ET
    do { d.setDate(d.getDate() - 1) } while (d.getDay() === 0 || d.getDay() === 6)
  }
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * True when a DAILY series' newest-bar date (ISO 'YYYY-MM-DD' string) is older
 * than the most recent expected session — i.e. it's missing recent sessions.
 */
export function isDailyTailStale(isoTail) {
  if (typeof isoTail !== 'string' || !isoTail) return false
  return isoTail.slice(0, 10) < expectedLatestDailySessionET()
}
