// Shared market-session helpers for daily-bar freshness. StockChart's daily
// staleness gate and the prefetch warmer MUST agree on "what session should a
// fresh daily series include" — so both import this one source of truth.
//
// Temporal / Freshness Truth Convergence V1 — S11 already owns the NYSE
// holiday/early-close calendar (app/src/lib/marketClock/nyseCalendar.js); the
// two functions below now consume its `holidayOn`/`earlyCloseOn`/`hasCoverage`
// exports instead of a weekend-only, hardcoded-16:00 guess, so a holiday
// evening or a real early-close day no longer misreports "the last closed
// session." Outside `hasCoverage`'s covered years this degrades EXACTLY to the
// prior weekday-only/16:00 behavior — never a guess, never a throw.
import { hasCoverage, holidayOn, earlyCloseOn } from '../lib/marketClock/nyseCalendar'

const _pad = (n) => String(n).padStart(2, '0')

// ISO date ('YYYY-MM-DD') of a Date object whose LOCAL getters already carry
// ET-equivalent values (this file's established idiom: re-parsing a
// toLocaleString('en-US', {timeZone: 'America/New_York'}) string yields a
// Date whose getFullYear/getMonth/getDate/getDay read as ET).
function _isoOfET(d) {
  return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`
}

// True when the ET calendar date `d` (same reparse-Date convention as above)
// is not a trading day at all — weekend, or an NYSE full-holiday closure per
// S11's calendar (silently skipped when the year has no coverage).
function _isNonTradingDayET(d) {
  const dow = d.getDay()
  if (dow === 0 || dow === 6) return true
  const iso = _isoOfET(d)
  return hasCoverage(d.getFullYear()) && !!holidayOn(iso)
}

// The effective regular-session close, in minutes-since-midnight ET, for the
// ET calendar date `d` — 13:00 (780) on a real NYSE early-close day, else the
// ordinary 16:00 (960) close. Falls back to 960 outside calendar coverage.
function _effectiveCloseMinutesET(d) {
  if (!hasCoverage(d.getFullYear())) return 960
  const earlyClose = earlyCloseOn(_isoOfET(d))
  return earlyClose ? earlyClose.closeHour * 60 + earlyClose.closeMinute : 960
}

/**
 * The ET date ('YYYY-MM-DD') of the most recent CLOSED daily session that a fresh
 * daily series should carry: today only once today's session has CLOSED (>= 16:00
 * ET on an ordinary weekday, >= 13:00 ET on a real NYSE early-close day), else the
 * most recent real prior trading day. Weekend/holiday/early-close/pre-open/
 * mid-session aware.
 *
 * The threshold is market CLOSE, NOT open — deliberately. During the trading day
 * today's daily bar is still FORMING; the historical series legitimately ends at
 * the last closed session and the live feed supplies today's developing candle on
 * top. Anchoring on open (9:30) would flag every closed-only cache/pack as "stale"
 * mid-session and force a black-screen refetch, defeating the instant-paint pack —
 * while STILL catching a series that's missing an EARLIER closed session (that
 * tail is < the last real prior trading day, so it's flagged stale regardless of
 * the hour). So this keeps the "no Friday-close-on-a-Tuesday" fix and makes
 * closed-only daily caches paint instantly during RTH.
 *
 * Holiday awareness matters for exactly one asymmetric reason: on the DOW-only
 * (weekend-only) predecessor of this function, a wrong answer could only ever be
 * >= the true last-closed-session date — every consumer that treats a lower date
 * as "needs refetch" (prefetchBars.js, barsIDB.js, StockChart.jsx) could at worst
 * be tricked into one extra, harmless refetch. The one consumer that compares the
 * OTHER direction (useBrokerMarkPreference.js, deciding broker-mark vs live-feed
 * pricing) could have that inflated date silently SUPPRESS a correct broker-mark
 * preference on every full NYSE holiday evening — never wrongly activate one
 * early. This fix removes that asymmetry rather than papering over one side of it.
 */
export function expectedLatestDailySessionET() {
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const dow = nowET.getDay()               // 0 Sun … 6 Sat
  const mins = nowET.getHours() * 60 + nowET.getMinutes()
  const d = new Date(nowET)
  const isTradingDayToday = dow >= 1 && dow <= 5 && !_isNonTradingDayET(nowET)
  const closeThresholdMin = _effectiveCloseMinutesET(nowET)
  if (!(isTradingDayToday && mins >= closeThresholdMin)) {
    do { d.setDate(d.getDate() - 1) } while (_isNonTradingDayET(d))
  }
  return _isoOfET(d)
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

/**
 * The ET date a fresh daily series should end at FOR THE PURPOSE OF THE INSTANT
 * PROVISIONAL PAINT — which, unlike expectedLatestDailySessionET, is anchored on
 * market OPEN, not close, during RTH.
 *
 * Since /api/bars now server-includes TODAY's developing daily bar (see
 * api/routers/bars.py::_augment_daily_with_today), the authoritative series ends
 * at TODAY the moment the session opens. So a cache/pack whose tail is only the
 * last CLOSED session (yesterday) is now stale-by-one-bar during RTH: painting it
 * provisionally frames yesterday, then the today-inclusive network response adds a
 * bar and re-anchors → the visible "current candle loads one bar right, then pops
 * left" shift. Treating that closed-only tail as stale makes the client skip the
 * provisional and paint the today-inclusive network response directly (no shift).
 *
 * OUTSIDE RTH this deliberately agrees with expectedLatestDailySessionET (the
 * close-anchored session model), because that is exactly when the server does NOT
 * carry today either: pre-open / overnight / weekend → day.o is 0 so the server
 * returns the last closed session, and a closed-only cache is genuinely fresh;
 * post-market (>=16:00) → both already return today. So this differs ONLY inside
 * 09:30–16:00 ET, the one window where the server adds today's forming bar and a
 * yesterday tail would shift.
 *
 * This is the PAINT gate only — expectedLatestDailySessionET (and isDailyTailStale)
 * stay close-anchored for the prefetch warmer + intraday session model, which must
 * not start re-warming every daily mid-session.
 */
export function expectedDailyTailForPaintET() {
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const dow = nowET.getDay()
  const mins = nowET.getHours() * 60 + nowET.getMinutes()
  // RTH (weekday 09:30–16:00 ET): the server carries today's developing bar, so the
  // expected paint tail is TODAY.
  if (dow >= 1 && dow <= 5 && mins >= 570 && mins < 960) {
    const p = (n) => String(n).padStart(2, '0')
    return `${nowET.getFullYear()}-${p(nowET.getMonth() + 1)}-${p(nowET.getDate())}`
  }
  return expectedLatestDailySessionET()
}

/**
 * True when a DAILY series' newest-bar date is older than what a fresh series
 * should carry FOR PAINTING — i.e. it's missing today during RTH (server includes
 * today now) or missing an earlier closed session. Use this for the instant-paint
 * decision; use isDailyTailStale for the warmer/session model.
 */
export function isDailyTailStaleForPaint(isoTail) {
  if (typeof isoTail !== 'string' || !isoTail) return false
  return isoTail.slice(0, 10) < expectedDailyTailForPaintET()
}

/**
 * True when a TODAY-dated daily cache's CLOSE should be treated as provisional for
 * the instant paint — i.e. the session has CLOSED for the day but the cache may hold
 * a MID-SESSION close (it was written while the bar was still developing during RTH),
 * so the sealed close from /api/bars should paint first.
 *
 * Once the market closes, today's daily bar is SEALED at the regular close (the
 * server serves it as day.c). A cache tail dated today reads as "fresh" to the date
 * gate above (it is not missing a session) — but its cached CLOSE can still be a
 * mid-session snapshot from when the ticker was viewed earlier in the day, which then
 * visibly snaps to the real close when the network response lands ("loads a different
 * price, then the body adjusts to the actual close"). Deferring the paint to the
 * network for such a tail shows the sealed close on the first frame instead. It is a
 * paint-timing gate only (the SWR fetch happens regardless), so it adds no request.
 *
 * Scoped to a weekday AT/AFTER close, same ET day as the tail (close → midnight ET) —
 * the "after hours" window. Close is the ordinary 16:00 ET threshold, or 13:00 ET on
 * a real NYSE early-close day (a half-day session sealed 3 hours earlier — without
 * this the sealed close's provisional-paint deferral stayed dormant until 16:00 even
 * though the real close had already happened). Overnight/next-session a today-dated
 * tail is a DIFFERENT ET day than the cache, so it never matches; the date gate +
 * expected session handle those. During RTH this is intentionally false: the
 * developing bar's close SHOULD evolve with the live feed, so a same-session cache
 * is legitimately live.
 */
export function isDailyTodayCloseProvisionalForPaint(isoTail) {
  if (typeof isoTail !== 'string' || !isoTail) return false
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const dow = nowET.getDay()
  const mins = nowET.getHours() * 60 + nowET.getMinutes()
  if (!(dow >= 1 && dow <= 5 && mins >= _effectiveCloseMinutesET(nowET))) return false   // only at/after today's close
  return isoTail.slice(0, 10) === _isoOfET(nowET)
}

// ET calendar date ('YYYY-MM-DD') of a unix-SECONDS timestamp (intraday bars carry
// `t` as unix seconds). Used to compare an intraday tail's SESSION against the last
// closed daily session — the session model both daily and intraday freshness share.
function _etDateOfUnix(unixSec) {
  const d = new Date(new Date(unixSec * 1000).toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * True when an INTRADAY series' newest-bar timestamp (unix SECONDS) is too stale to
 * paint. The intraday analog of isDailyTailStale, and the reason a pre-seeded
 * intraday pack can paint instantly like daily. Session/weekend/holiday-aware via
 * expectedLatestDailySessionET() (the last CLOSED trading session), NOT a flat age:
 *
 *   - tail BEFORE the last closed session          → STALE (missing a whole session).
 *   - tail == the last closed session              → FRESH. Prior sessions are
 *       complete; today's bars ride the live feed / a since-fetch fills them. This is
 *       what lets a Monday pre-seed holding FRIDAY's 15:55 bar paint — the old flat
 *       26h / max(3*tf,180s) gates wrongly killed it (65h over a weekend).
 *   - tail in TODAY's still-open session (> expected) → apply the intra-session
 *       recency gate (max(3*tf,180s)); a series missing the last few CLOSED bars of
 *       the CURRENT session still refetches (the noon-cutoff guard, preserved).
 *
 * The anti-spike safety is unchanged and lives elsewhere (classifyLiveBar's
 * >1-bucket contiguity guard + provisionalStaleRef): "fresh for prior sessions" only
 * authorizes PAINTING the tail + filling today, never fusing a live tick onto it.
 */
// ── Intraday integrity Phase 1 — session-completeness gate (dark canary) ──────
// The completeness check below (a tail on the last-closed-session date must REACH
// that session's close, not just carry its date) rides this gate so it can be
// verified on prod then ramped, exactly like the daily edge fixes. At PCT=0 with no
// opt-in, isIntradayTailStale is byte-identical to before. Owner opt-in for testing:
// window.__uctIntradayComplete(true). Instant revert: set PCT to 0 / opt-out.
export const INTRADAY_COMPLETENESS_PCT = 0
export function _intradayCompletenessOn() {
  try {
    const ls = typeof localStorage !== 'undefined' ? localStorage.getItem('uct.intradayComplete.enabled') : null
    if (ls === '1') return true     // explicit opt-in (canary)
    if (ls === '0') return false    // explicit opt-out
    let b = localStorage.getItem('uct.intradayComplete.bucket')
    if (b == null) { b = String(Math.floor(Math.random() * 100)); localStorage.setItem('uct.intradayComplete.bucket', b) }
    const n = parseInt(b, 10)
    return (Number.isFinite(n) ? n : 100) < INTRADAY_COMPLETENESS_PCT
  } catch { return false }
}
if (typeof window !== 'undefined') {
  window.__uctIntradayComplete = (on) => {
    try {
      if (on) localStorage.setItem('uct.intradayComplete.enabled', '1')
      else localStorage.removeItem('uct.intradayComplete.enabled')
    } catch { /* ignore */ }
  }
}

export function isIntradayTailStale(lastTUnixSec, tf) {
  if (typeof lastTUnixSec !== 'number' || !Number.isFinite(lastTUnixSec)) return true
  const tailDate = _etDateOfUnix(lastTUnixSec)
  const expected = expectedLatestDailySessionET()   // last CLOSED trading session (ET date)
  if (tailDate < expected) return true               // missing a whole closed session
  if (tailDate > expected) {                         // tail is in TODAY's still-open session
    const tfSec = Math.max(60, (Number(tf) || 5) * 60)
    return (Date.now() / 1000 - lastTUnixSec) > Math.max(3 * tfSec, 180)
  }
  // tailDate == expected → a CLOSED session BY DEFINITION (expected is the last closed
  // session). The date-only check treated ANY tail on that date as fresh — so a cache
  // written mid-session (e.g. a 13:30 bar, then the market closed) read as fresh and the
  // client only ever since-polled it, never backfilling 13:30→close: the "missing the last
  // hours of the day on first open after close" bug. A truly-fresh tail must REACH the
  // session close. Last RTH bucket START by tf: 5m→15:55, 15m→15:45, 30m→15:30, 60m→15:00
  // (all = 16:00 − one bar) → "reached close" == tailMin >= 960 − tf-minutes. An earlier tail
  // is an incomplete session → stale → forces a FULL no-since refetch that REPLACES the
  // truncated series (a since= delta cannot reliably backfill it). Post-market / RTH-complete
  // tails (tailMin ≥ last RTH bucket) stay fresh; the since-poll appends any newer post bars.
  if (_intradayCompletenessOn()) {
    const tfMin = Math.max(1, Number(tf) || 5)
    const tailD = new Date(new Date(lastTUnixSec * 1000).toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const tailMin = tailD.getHours() * 60 + tailD.getMinutes()
    if (tailMin < 960 - tfMin) return true           // incomplete closed session → refetch
  }
  return false                                       // tail == last closed session, complete → fresh
}
