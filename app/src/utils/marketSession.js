// Shared market-session helpers for daily-bar freshness. StockChart's daily
// staleness gate and the prefetch warmer MUST agree on "what session should a
// fresh daily series include" — so both import this one source of truth.

/**
 * The ET date ('YYYY-MM-DD') of the most recent CLOSED daily session that a fresh
 * daily series should carry: today only once today's session has CLOSED (>= 16:00
 * ET on a weekday), else the previous weekday. Weekend/pre-open/mid-session aware.
 *
 * The threshold is market CLOSE, NOT open — deliberately. During the trading day
 * today's daily bar is still FORMING; the historical series legitimately ends at
 * the last closed session and the live feed supplies today's developing candle on
 * top. Anchoring on open (9:30) would flag every closed-only cache/pack as "stale"
 * mid-session and force a black-screen refetch, defeating the instant-paint pack —
 * while STILL catching a series that's missing an EARLIER closed session (that
 * tail is < the previous weekday, so it's flagged stale regardless of the hour).
 * So this keeps the "no Friday-close-on-a-Tuesday" fix and makes closed-only daily
 * caches paint instantly during RTH. Holidays aren't tracked client-side — a rare
 * holiday only costs a brief refetch, never stale data on screen.
 */
export function expectedLatestDailySessionET() {
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const dow = nowET.getDay()               // 0 Sun … 6 Sat
  const mins = nowET.getHours() * 60 + nowET.getMinutes()
  const d = new Date(nowET)
  // ⚠️ 2026-08-19 INCIDENT REVERT: temporarily back on the OPEN threshold (570 / 9:30 ET).
  // The close threshold (960) made closed-only daily caches paint instantly during RTH —
  // which correctly SKIPPED the mid-session refetch, but that refetch was ALSO masking two
  // latent client bugs: (1) a stale/mismatched cached daily bar surviving in IDB (newest-wins
  // merge can't heal a wrong-OHLC row at an existing ts) and (2) the view-lock restoring a
  // back-in-time pan on instant paint. With no refetch, both showed through as black,
  // scrolled-back charts during the 8/19 open. Reverting to 570 restores the full RTH refetch
  // (series REPLACE → heals the bar + re-anchors the view). Re-raise to 960 only AFTER the
  // IDB-heal + view-lock re-anchor fixes land so instant daily is correct, not just instant.
  if (!(dow >= 1 && dow <= 5 && mins >= 570)) { // not a weekday at/after 09:30 ET (open)
    do { d.setDate(d.getDate() - 1) } while (d.getDay() === 0 || d.getDay() === 6)
  }
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * True when a DAILY series' newest-bar date (ISO 'YYYY-MM-DD' string) is older
 * than the most recent CLOSED expected session — i.e. it's missing a session that
 * has already finished. A series ending at the last closed session while today is
 * still open is NOT stale (today's candle rides the live feed).
 */
export function isDailyTailStale(isoTail) {
  if (typeof isoTail !== 'string' || !isoTail) return false
  return isoTail.slice(0, 10) < expectedLatestDailySessionET()
}
