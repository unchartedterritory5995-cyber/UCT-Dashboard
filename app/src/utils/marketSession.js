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
  // CLOSE threshold (960 / 16:00 ET): closed-only daily caches/packs paint INSTANTLY
  // during RTH (today's bar is still forming and rides the live feed; the historical
  // series legitimately ends at the last closed session). Anchoring on OPEN (570) would
  // flag every closed-only cache as stale mid-session and force a black-screen refetch,
  // defeating the instant-paint pack.
  //   History: 960 was briefly reverted to 570 on 2026-08-19 because skipping the RTH
  //   refetch exposed two LATENT client bugs the refetch had been masking — the view-lock
  //   restoring a back-in-time pan on instant paint, and a corrupt-value daily bar painting
  //   from IDB. Both are now fixed at the source (StockChart.jsx: the anchorFrac back-in-time
  //   guard re-anchors to latest when a stored pan predates current data; _idbDailyLastInsane
  //   refuses to instant-paint an internally-inconsistent daily bar → falls through to the
  //   healing refetch). With those guards in place the instant paint is correct, so 960 is
  //   restored. A series missing an EARLIER closed session is still < the previous weekday, so
  //   it's flagged stale regardless of the hour ("no Friday-close-on-a-Tuesday" holds).
  if (!(dow >= 1 && dow <= 5 && mins >= 960)) { // not a weekday at/after 16:00 ET (close)
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
