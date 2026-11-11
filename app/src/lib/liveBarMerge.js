// Pure decision logic for the INTRADAY developing ("live") candle.
//
// StockChart.jsx has several writers that touch the developing bar (A = livePrices
// tick, B = Massive push bar, C = realtimeCandle registry tick, D = post-setData
// re-top after the 30s poll). Each used to carry its own inline merge rules, and
// they disagreed — which is how the forming candle's HIGH/LOW kept disappearing,
// how a new bucket's prints fused into the previous candle, and how the poll
// reverted the developing bar to a ~30s-stale server snapshot. The rules live here
// once, as pure functions over plain bar objects, so they can be unit-tested and so
// every writer applies the SAME invariants:
//
//   I1  Within one bucket HIGH only rises and LOW only falls (never shrink a range
//       the live writer has already shown) — unless the server marks the bar FINAL.
//   I2  OPEN is set once per bucket (first writer wins; the fetched/server open is
//       authoritative when it exists) and is never overwritten by a partial slice.
//   I3  VOLUME never decreases within a bucket: max(server, live).
//   I4  A bar/tick for a LATER bucket never fuses into the current candle, and a late
//       bar/tick for an EARLIER bucket never touches it either (bucket by trade time).
//   I5  A bar never merges across symbols.
//
// Bar shape here is the chart's: { time, open, high, low, close, volume, sym?, tradeTs? }
// where `time` is the chart-series time (already ET-offset — the caller converts).

import { bucketEndChartTime } from '../components/chart/barTime'

const finitePos = (v) => Number.isFinite(v) && v > 0

/** True when every OHLC field is a finite positive number and low <= high. */
export function isCompleteOhlc(b) {
  return !!b && finitePos(b.open) && finitePos(b.high) && finitePos(b.low) && finitePos(b.close) &&
    b.low <= b.high
}

function _vol(v) { return Number.isFinite(v) && v >= 0 ? v : 0 }

export const LIVE_PERIOD_SECONDS = Object.freeze({ '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600 })

/**
 * End (exclusive) of the intraday bucket that STARTS at chart time `barTime`.
 * Chart time encodes ET wall-clock as UTC seconds, so `barTime % 86400` is the ET
 * time of day. 60m is TradingView-aligned (owner ruling: 9:30, 10:30 … 15:30 half
 * bar), so a 60m bucket never spans the 9:30 open or the 16:00 close — those are
 * session anchors that cut it short (pre-market 9:00 → 9:30, 15:30 → 16:00).
 * session='eth' is the server's extended-hours alignment: plain CLOCK hours
 * (04:00 … 19:00), no anchors — matches /api/stream/bars?session=eth.
 */
export function bucketEndTime(barTime, tf, session = 'rth') {
  // ⭐ ONE implementation: chart/barTime.js (twin of bar_rollup.tv_bucket_bounds),
  // which also knows the 13:00 half-day close.
  return bucketEndChartTime(barTime, String(tf), session)
}

/**
 * Merge an incoming PUSH bar (Writer B) into the developing bar we hold.
 *
 * @param {object|null} prev    the developing bar we hold (liveBarRef/lastBarRef), chart shape
 * @param {object} inc          incoming bar, chart shape ({time, open, high, low, close, volume})
 * @param {object} [opts]
 * @param {string} [opts.sym]   the chart's symbol (I5)
 * @param {boolean} [opts.final] server says this bar is the FINAL closed bar for its bucket
 * @param {number} [opts.tradeTs] unix ms of the newest trade folded into `inc`
 * @param {string} [opts.tf]   chart timeframe code (for the trade_ts bucket check)
 * @param {number} [opts.timeOffsetSec] chart time = unix seconds + this (legacy constant; prefer toChart)
 * @param {function} [opts.toChart] unix seconds -> chart time (barTime.toChartTime, per-instant ET offset)
 * @param {string} [opts.session] 'rth' | 'eth' (60m alignment, see bucketEndTime)
 * @returns {{kind:'new'|'update'|'stale'|'correct'|'drop', bar?:object}}
 *   new    — inc opens a later bucket than prev (or there is no usable prev): paint inc as is
 *   update — same bucket: paint the merged bar
 *   stale  — inc is for an EARLIER bucket than prev: never paint it over the live candle
 *   correct — a FINAL bar for an EARLIER bucket (the server's late AM correction of the
 *            just-closed bucket): the caller replaces THAT historical bar in place and
 *            leaves the developing candle alone
 *   drop   — malformed / inconsistent frame
 */
export function mergePushBar(prev, inc, opts = {}) {
  const { sym = null, final = false, tradeTs = null, tf = null, timeOffsetSec = 0, session = 'rth', toChart = null } = opts
  if (!inc || !Number.isFinite(inc.time) || !isCompleteOhlc(inc)) return { kind: 'drop' }
  // I4 by trade time: when the server tells us WHEN the newest trade in this bar
  // printed, it must fall inside the bar's own bucket. A frame whose trade lies
  // outside it is a mis-bucketed partial — painting it would fuse prints across
  // the boundary. (Absent field ⇒ trust the bucket, the pre-existing contract.)
  if (Number.isFinite(tradeTs) && tf != null) {
    const _sec = Math.floor(tradeTs / 1000)
    const tradeChart = typeof toChart === 'function' ? toChart(_sec) : _sec + timeOffsetSec
    if (tradeChart < inc.time || tradeChart >= bucketEndTime(inc.time, tf, session)) return { kind: 'drop' }
  }
  const usable = prev && Number.isFinite(prev.time) && (sym == null || prev.sym == null || prev.sym === sym)
  if (!usable || inc.time > prev.time) {
    return { kind: 'new', bar: { ...inc, volume: _vol(inc.volume), sym, tradeTs: Number.isFinite(tradeTs) ? tradeTs : null } }
  }
  if (inc.time < prev.time) {
    return final
      ? { kind: 'correct', bar: { ...inc, volume: _vol(inc.volume), sym, final: true } }
      : { kind: 'stale' }
  }
  // Same bucket.
  if (final) {
    // The server's FINAL closed bar is the truth for H/L/C/V (it may legitimately be
    // narrower than an unfiltered live print). Keep the open we already hold only if
    // the final carries none usable (it always does, given isCompleteOhlc above).
    return { kind: 'update', bar: { ...prev, open: inc.open, high: inc.high, low: inc.low, close: inc.close,
      volume: _vol(inc.volume), sym: sym ?? prev.sym ?? null, tradeTs: Number.isFinite(tradeTs) ? tradeTs : (prev.tradeTs ?? null), final: true } }
  }
  if (prev.final) {
    // Already sealed by a final — a later non-final frame for the same bucket is a
    // straggler; keep the sealed bar.
    return { kind: 'update', bar: { ...prev } }
  }
  // Out-of-order frame within the bucket (older trade than the one we already show):
  // it may still widen the range or carry more volume, but must not move the close back.
  const older = Number.isFinite(tradeTs) && Number.isFinite(prev.tradeTs) && tradeTs < prev.tradeTs
  const open = finitePos(prev.open) ? prev.open : inc.open                         // I2
  const high = Math.max(finitePos(prev.high) ? prev.high : inc.high, inc.high)      // I1
  const low = Math.min(finitePos(prev.low) ? prev.low : inc.low, inc.low)           // I1
  const close = older && finitePos(prev.close) ? prev.close : inc.close
  return {
    kind: 'update',
    bar: {
      ...prev, open, high: Math.max(high, close), low: Math.min(low, close), close,
      volume: Math.max(_vol(prev.volume), _vol(inc.volume)),                         // I3
      sym: sym ?? prev.sym ?? null,
      tradeTs: older ? prev.tradeTs : (Number.isFinite(tradeTs) ? tradeTs : (prev.tradeTs ?? null)),
    },
  }
}

/**
 * Writer D: reconcile the developing bar we hold with the fetched series tail after a
 * poll/refetch setData(). Returns the bar to keep as liveBarRef and whether it must be
 * re-topped onto the series (it is the series' last bar or one bucket past it).
 *
 * @param {object|null} live     liveBarRef (chart shape, may carry sym)
 * @param {object} server        the fetched tail bar, chart shape
 * @param {object} opts
 * @param {string} opts.sym
 * @param {number} opts.periodSec
 * @param {number} [opts.nowChart] current wall-clock time in chart time (unix s + ET offset)
 * @param {string} [opts.tf]       chart timeframe code (with nowChart: the current-bucket test)
 * @param {string} [opts.session]  'rth' | 'eth'
 * @param {number} [opts.graceSec]  how long past the live bucket's END it may stay "ahead"
 *   while the server catches up (one poll interval + slack)
 * @returns {{bar:object, ahead:boolean}}
 *   ahead=true ⇒ `bar` is the NEXT bucket after the server tail (server hasn't seen
 *   it yet) — the caller must re-append it, never drop it (the "new candle blanks /
 *   collapses to the current price when the poll lands" bug).
 */
export const RECONCILE_AHEAD_GRACE_SEC = 45

export function reconcileWithServerTail(live, server, { sym = null, periodSec = 300, nowChart = null, tf = null, session = 'rth', graceSec = RECONCILE_AHEAD_GRACE_SEC } = {}) {
  const srv = { ...server, volume: _vol(server.volume), sym }
  if (!live || !Number.isFinite(live.time) || (live.sym != null && sym != null && live.sym !== sym)) {
    return { bar: srv, ahead: false }
  }
  if (live.time === server.time) {
    if (live.final) return { bar: { ...live, sym }, ahead: false }
    // I2: the server open is the true bucket open. I1: H/L keep what live showed.
    // The developing close tracks the tape — the server snapshot lags it by up to a
    // poll interval, so the live close stands. I3: volume = max.
    const high = Math.max(server.high, finitePos(live.high) ? live.high : server.high)
    const low = Math.min(server.low, finitePos(live.low) ? live.low : server.low)
    const close = finitePos(live.close) ? live.close : server.close
    return {
      bar: { ...live, open: server.open, high: Math.max(high, close), low: Math.min(low, close), close,
        volume: Math.max(srv.volume, _vol(live.volume)), sym },
      ahead: false,
    }
  }
  // The live writer has already opened a LATER bucket than the fetched tail. Keep it when
  // it is the next bucket, OR when it is the bucket the wall clock is in right now — the
  // first bucket of a session (tail = the prior session's last bar) and a thin name that
  // skipped buckets are both "more than one period" past the tail yet entirely current.
  // Dropping it there re-seeded the candle at o=h=l=price on the next tick.
  const hasClock = Number.isFinite(nowChart) && tf != null
  const liveEnd = hasClock ? bucketEndTime(live.time, tf, session) : null
  const isCurrent = hasClock && live.time <= nowChart && nowChart < liveEnd
  // The "next bucket" case is held only until the bucket has ENDED plus one poll of grace.
  // A bucket the server never ingests (opened by a print the server filters out, on a thin
  // name whose tail stays put) must not stay "ahead" forever — after the grace the server
  // tail wins and the fallback writers resume on it.
  const nextInGrace = live.time - server.time <= periodSec && (!hasClock || nowChart < liveEnd + graceSec)
  if (live.time > server.time && (nextInGrace || isCurrent)) {
    return { bar: { ...live, sym }, ahead: true }
  }
  // Server is newer (or the live bar is detached by >1 bucket): server wins.
  return { bar: srv, ahead: false }
}

/**
 * Fallback writers (A / C, only when push is NOT delivering): fold one filtered
 * trade/quote price into the developing bar for the bucket the trade belongs to.
 *
 * @param {object|null} bar     the developing bar (chart shape)
 * @param {number} price
 * @param {number|null} tickTime chart-series time of the trade (null ⇒ unknown, treat as current bucket)
 * @param {string} tf          chart timeframe code
 * @param {string} [session]   'rth' | 'eth' (60m alignment)
 * @returns {{kind:'update'|'later'|'earlier'|'drop', bar?:object}}
 *   later   — the trade is in a LATER bucket than `bar` (do not fuse; caller opens/awaits it)
 *   earlier — a late print for an earlier bucket (ignore)
 */
export function foldPrice(bar, price, tickTime, tf, session = 'rth') {
  if (!finitePos(price) || !bar || !Number.isFinite(bar.time)) return { kind: 'drop' }
  if (Number.isFinite(tickTime) && tf != null) {
    if (tickTime >= bucketEndTime(bar.time, tf, session)) return { kind: 'later' }
    if (tickTime < bar.time) return { kind: 'earlier' }
  }
  if (bar.final) return { kind: 'update', bar: { ...bar } }
  return {
    kind: 'update',
    bar: {
      ...bar,
      high: Math.max(finitePos(bar.high) ? bar.high : price, price),
      low: Math.min(finitePos(bar.low) ? bar.low : price, price),
      close: price,
    },
  }
}

/**
 * Writer C on a 1m chart: the registry candle only counts ticks seen since we
 * subscribed, so it is a PARTIAL slice of the minute. Merge it into what we already
 * hold for that minute instead of overwriting O/H/L wholesale (which shrank the
 * fetched range to the "since you opened it" window). Returns null when the registry
 * candle is unusable (missing o/h/l/c — the D1 bar_close shape).
 */
export function mergeRegistryMinute(known, candle) {
  if (!candle || !isCompleteOhlc({ open: candle.o, high: candle.h, low: candle.l, close: candle.c })) return null
  const k = known && known.time === candle.time ? known : null
  const open = k && finitePos(k.open) ? k.open : candle.o
  const high = Math.max(candle.h, k && finitePos(k.high) ? k.high : candle.h, candle.c)
  const low = Math.min(candle.l, k && finitePos(k.low) ? k.low : candle.l, candle.c)
  return {
    ...(k || {}), time: candle.time, open, high, low, close: candle.c,
    volume: Math.max(_vol(candle.v), _vol(k?.volume)),
  }
}
