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

// True iff TODAY (ET) is a trading session — a weekday that is not an NYSE full holiday.
// Holiday-aware (via the shared NYSE calendar), so a developing-bar reservation/seed is never
// placed on a day when no new bar will actually arrive (weekend/holiday → a phantom right slot).
export function isTradingSessionTodayET() {
  try { return !_isNonTradingDayET(new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))) }
  catch { return false }
}

// True iff the ISO date 'YYYY-MM-DD' is an NYSE FULL-holiday closure (weekday market closure).
// Weekend-agnostic on purpose: callers that already skip Sat/Sun (e.g. the daily future-axis
// whitespace) use this ONLY to also skip holidays, so a closed weekday (Labor Day, etc.) never
// gets a phantom axis slot between the surrounding trading days.
export function isHolidayISO(iso) {
  try {
    const s = String(iso).slice(0, 10)
    const y = Number(s.slice(0, 4))
    return hasCoverage(y) && !!holidayOn(s)
  } catch { return false }
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

/**
 * Classify an intraday cache tail. THREE answers, because the old two-way
 * stale/fresh split is what forced the whole history to be thrown away.
 *
 *   'fresh'  — the tail reaches the market. Poll with `since=`.
 *   'behind' — the CACHE IS SOUND but stops short of now (the 10:00 tail at 13:17).
 *              Its history is still trustworthy, so keep it and fetch ONLY the gap.
 *   'gapped' — the tail predates the last closed session, so the cache may be
 *              discontinuous. A `since=` delta cannot vouch for bars BEFORE the
 *              tail, so this one must still refetch in full.
 *
 * ⛔⛔ WHY THE MIDDLE CASE EXISTS. `isIntradayTailStale` answered one bit, and
 * every "stale" tail — including a perfectly continuous one that merely stopped
 * three hours ago — dropped `since=` and re-downloaded the entire window. That is
 * the "re-download thousands of bars to obtain today's last twenty" shape: it
 * makes the request big exactly when the user is waiting, and it discards sound
 * history to recover a handful of bars.
 *
 * ⭐ 'behind' is the case the session tail is FOR. The cached history paints
 * immediately and the small `since=` response carries today's completed bars.
 */
// ── EXPECTED LATEST COMPLETED BAR ─────────────────────────────────
// The freshness half of the acceptance standard. At 13:17 ET on 5m the expected
// completed bar starts 13:10 and the expected forming bar starts 13:15 — a chart
// whose newest bar is 10:00 has failed, whatever its paint time was.
//
// ⛔ IT RETURNS null RATHER THAN A GUESS when there is no expectation to hold the
// data to: a non-trading day, before the first bucket of the session has closed, or
// a timeframe it cannot bucket. "No expectation right now" is an ANSWER; inventing
// one would manufacture the very thing the no-fabricated-bars rule forbids, and a
// freshness lag measured against a fabricated expectation is worse than none.
//
// ⚠️ EXPECTATION IS NOT EXISTENCE. This says which interval SHOULD have closed, not
// that the symbol printed in it. An illiquid name with no trades legitimately has no
// such bar, so a lag computed from this is evidence to read, never a defect on its own.
const _RTH_OPEN_MINUTES = 570        // 09:30 ET
const _EXT_OPEN_MINUTES = 240        // 04:00 ET
const _EXT_CLOSE_MINUTES = 1200      // 20:00 ET

function _etMinutesOfUnix(unixSec) {
  const s = new Date(unixSec * 1000).toLocaleString('en-US', {
    timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit',
  })
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

/**
 * Start instant of the bucket containing `unixSec`.
 * ⭐ tf=60 is SESSION-ANCHORED (09:30-09:59 anchors at 09:30, then clock hours) to
 * match the server's `bucket_60_et_unix_seconds`. Two bucketings of one timeframe is
 * how duplicate candles at neighbouring timestamps get planted.
 * Subtracting a MINUTE DIFFERENCE from the epoch keeps this DST-safe — no calendar
 * instant is reconstructed.
 */
function _bucketStartUnix(unixSec, tfMin) {
  const mins = _etMinutesOfUnix(unixSec)
  const anchor = tfMin === 60
    ? ((mins >= 570 && mins < 600) ? 570 : Math.floor(mins / 60) * 60)
    : Math.floor(mins / tfMin) * tfMin
  const secs = new Date(unixSec * 1000).getSeconds()   // timezone-invariant
  return unixSec - (mins - anchor) * 60 - secs
}

export function expectedLatestCompletedBar(tf, nowMs = Date.now(), { session = 'rth' } = {}) {
  const tfMin = Number(tf)
  if (!Number.isFinite(tfMin) || tfMin <= 0) return null
  const d = new Date(nowMs)
  if (_isNonTradingDayET(d)) return null
  const nowSec = Math.floor(nowMs / 1000)
  const mins = _etMinutesOfUnix(nowSec)
  const open = session === 'extended' ? _EXT_OPEN_MINUTES : _RTH_OPEN_MINUTES
  const close = session === 'extended'
    ? _EXT_CLOSE_MINUTES
    : _effectiveCloseMinutesET(d)           // early-close aware, one calendar
  // Session over: the last completed bar is the one ending at the close.
  const probe = mins >= close ? nowSec - (mins - (close - 1)) * 60 : nowSec
  const curStart = _bucketStartUnix(probe, tfMin)
  if (mins >= close) return curStart
  // ⛔⛔ THE PREVIOUS BUCKET IS FOUND BY RE-BUCKETING, NOT BY SUBTRACTING tf.
  // On tf=60 the opening bucket is only THIRTY minutes (09:30-10:00), so
  // `curStart - 3600` at 10:05 yields 09:00 — an instant that is not a bar on this
  // chart at all. Re-bucketing one second before the current start is correct for
  // every timeframe AND for the irregular opening bucket, with no special case.
  const prevStart = _bucketStartUnix(curStart - 1, tfMin)
  // …and the same irregularity breaks an `open + tfMin` guard: at 10:05 a full hour
  // has not elapsed since 09:30, yet the 09:30-10:00 bar HAS closed. Ask whether the
  // previous bucket starts inside the session instead of doing clock arithmetic.
  if (_etMinutesOfUnix(prevStart) < open) return null
  return prevStart
}

/** The interval currently forming, or null when nothing is. */
export function expectedFormingBar(tf, nowMs = Date.now(), { session = 'rth' } = {}) {
  if (expectedLatestCompletedBar(tf, nowMs, { session }) == null) return null
  const tfMin = Number(tf)
  const d = new Date(nowMs)
  const nowSec = Math.floor(nowMs / 1000)
  const mins = _etMinutesOfUnix(nowSec)
  const close = session === 'extended' ? _EXT_CLOSE_MINUTES : _effectiveCloseMinutesET(d)
  if (mins >= close) return null            // nothing forms after the close
  // The bucket containing NOW — not completed + tf, which walks off the irregular
  // opening hour exactly as the completed-bar arithmetic did.
  return _bucketStartUnix(nowSec, tfMin)
}

export function classifyIntradayTail(lastTUnixSec, tf) {
  if (typeof lastTUnixSec !== 'number' || !Number.isFinite(lastTUnixSec)) return 'gapped'
  const tailDate = _etDateOfUnix(lastTUnixSec)
  const expected = expectedLatestDailySessionET()   // last CLOSED trading session
  if (tailDate < expected) return 'gapped'          // missing a whole closed session
  if (tailDate > expected) {                        // inside today's still-open session
    const tfSec = Math.max(60, (Number(tf) || 5) * 60)
    return (Date.now() / 1000 - lastTUnixSec) > Math.max(3 * tfSec, 180) ? 'behind' : 'fresh'
  }
  // tailDate === expected → a CLOSED session by definition. Complete iff it reached
  // the close; an incomplete one is BEHIND (sound history, short tail), not gapped.
  if (_intradayCompletenessOn()) {
    const tfMin = Math.max(1, Number(tf) || 5)
    const tailD = new Date(new Date(lastTUnixSec * 1000).toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const tailMin = tailD.getHours() * 60 + tailD.getMinutes()
    if (tailMin < 960 - tfMin) return 'behind'
  }
  return 'fresh'
}

export function isIntradayTailStale(lastTUnixSec, tf) {
  // ⭐ DERIVED, never a second opinion. `barsIDB` eviction and the provisional-paint
  // gate both read this; keeping it a projection of `classifyIntradayTail` is what
  // stops "is this tail usable" from having two answers that can drift apart.
  return classifyIntradayTail(lastTUnixSec, tf) !== 'fresh'
}

