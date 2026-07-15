// Extended-hours "session preview" helpers for the Charts workspace.
//
// Two independent behaviors on Daily / Weekly / Monthly charts, both scoped to
// the /charts workspace (StockChart's `sessionView` prop is non-null only there):
//
//  1. A synthetic pre/post-market candle (the "Include pre-market / Include
//     post-market" toggle). Pre-market draws a NEW forming daily candle from the
//     4:00–9:30 ET prints; post-market EXTENDS today's RTH candle with the
//     16:00–20:00 ET prints. Weekly/Monthly extend the current period bar (or,
//     on the first session of a new week/month, seed a new one).
//
//  2. Two right-axis price tags (always shown during pre/post market): a green
//     tag LOCKED at the last regular-session close (yesterday's close in
//     pre-market, today's 4pm close in post-market) plus an orange "Pre"/"Post"
//     tag tracking the live extended-hours price. Mirrors TradingView.
//
// This module is pure (no React / DOM / color decisions) so it is unit-tested in
// isolation. All timestamps here are raw UTC unix seconds as returned by
// /api/bars (the frontend's +ET_OFFSET display shift is applied elsewhere).

// ET session windows, minutes-since-ET-midnight. Match useMarketOpen.js.
const PRE_WINDOW = [4 * 60, 9 * 60 + 30]   // 4:00 – 9:30
const POST_WINDOW = [16 * 60, 20 * 60]     // 16:00 – 20:00

/** "YYYY-MM-DD" ET calendar date for a UTC-seconds timestamp. */
export function etDateStr(tSec) {
  return new Date(tSec * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

/** Minutes since ET midnight for a UTC-seconds timestamp. */
export function etMinutes(tSec) {
  const s = new Date(tSec * 1000).toLocaleString('en-US', {
    timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit',
  })
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

/**
 * Aggregate today's extended-hours intraday bars into a single OHLCV for the
 * relevant window. `bars` are 5-min (or any intraday) bars: { t, o, h, l, c, v }
 * with `t` in UTC seconds.
 *
 * @returns {{open,high,low,close,volume}|null} null when no in-window bar exists.
 */
export function aggregateExtBars(bars, { session, todayEt }) {
  if (!Array.isArray(bars) || !bars.length) return null
  const win = session === 'post' ? POST_WINDOW : PRE_WINDOW
  let open = null, high = -Infinity, low = Infinity, close = null, volume = 0, found = false
  for (const b of bars) {
    const t = typeof b.t === 'number' ? b.t : Number(b.t)
    if (!Number.isFinite(t)) continue
    if (etDateStr(t) !== todayEt) continue
    const mins = etMinutes(t)
    if (mins < win[0] || mins >= win[1]) continue
    const O = +b.o, H = +b.h, L = +b.l, C = +b.c
    if (![O, H, L, C].every(v => Number.isFinite(v) && v > 0)) continue
    if (open == null) open = O
    if (H > high) high = H
    if (L < low) low = L
    close = C
    volume += Number.isFinite(+b.v) ? +b.v : 0
    found = true
  }
  return found ? { open, high, low, close, volume } : null
}

/**
 * Apply the extended-hours preview candle onto the regular-session bars.
 * `rthBars` are D/W/M bars ({ t:'YYYY-MM-DD', o,h,l,c,v }); `curTime` is the
 * current period key from computeBarTime(tf, now) (also 'YYYY-MM-DD').
 *
 *  - curTime === last bar's time  → EXTEND that bar (post-market always;
 *    mid-week/month pre-market). open is preserved; high/low widen; close = live.
 *  - curTime  >  last bar's time  → APPEND a new period bar seeded from the ext
 *    window (daily pre-market; first session of a new week/month).
 *
 * Returns a NEW array (never mutates rthBars). No-op (returns rthBars) when
 * there's nothing to add.
 */
export function applySessionCandle(rthBars, { curTime, extAgg, extPrice }) {
  if (!Array.isArray(rthBars) || !rthBars.length) return rthBars
  const px = Number.isFinite(extPrice) && extPrice > 0 ? extPrice
    : (extAgg && Number.isFinite(extAgg.close) ? extAgg.close : null)
  if (px == null && !extAgg) return rthBars

  const closePx = px != null ? px : extAgg.close
  const aggOpen = extAgg ? extAgg.open : closePx
  const aggHigh = extAgg ? extAgg.high : closePx
  const aggLow = extAgg ? extAgg.low : closePx

  const last = rthBars[rthBars.length - 1]
  const lastT = String(last.t)
  const cur = String(curTime)

  if (cur === lastT) {
    const merged = {
      ...last,
      h: Math.max(+last.h, aggHigh, closePx),
      l: Math.min(+last.l, aggLow, closePx),
      c: closePx,
      v: (Number.isFinite(+last.v) ? +last.v : 0) + (extAgg ? extAgg.volume : 0),
    }
    return [...rthBars.slice(0, -1), merged]
  }
  if (cur > lastT) {
    const newBar = {
      t: curTime,
      o: aggOpen != null ? aggOpen : closePx,
      h: Math.max(aggHigh, closePx),
      l: Math.min(aggLow, closePx),
      c: closePx,
      v: extAgg ? extAgg.volume : 0,
    }
    return [...rthBars, newBar]
  }
  return rthBars
}

/**
 * Build the two right-axis price-line tags. Returns descriptors consumed by the
 * StockChart price-line applier (createPriceLine). `rthBars` MUST be the
 * regular-session bars (not the session-applied ones) so the green tag stays
 * locked at the true RTH close.
 */
export function computeSessionTagLines({ rthBars, session, extPrice, upColor, downColor, extColor }) {
  const lines = []
  if (!Array.isArray(rthBars) || !rthBars.length) return lines
  const last = rthBars[rthBars.length - 1]
  const prev = rthBars.length > 1 ? rthBars[rthBars.length - 2] : null
  const rthClose = +last.c
  if (Number.isFinite(rthClose) && rthClose > 0) {
    const up = prev && Number.isFinite(+prev.c) ? rthClose >= +prev.c : true
    lines.push({
      price: rthClose,
      color: up ? upColor : downColor,
      lineWidth: 1,
      lineStyle: 2,          // dashed — the classic previous-close line
      axisLabelVisible: true,
      lineVisible: true,
      title: '',
      _sessionTag: 'rth',
    })
  }
  if (Number.isFinite(extPrice) && extPrice > 0) {
    lines.push({
      price: extPrice,
      color: extColor,
      lineWidth: 1,
      lineStyle: 0,
      axisLabelVisible: true,
      lineVisible: false,    // chip only — no line drawn across the plot
      title: session === 'post' ? 'Post' : 'Pre',
      _sessionTag: 'ext',
    })
  }
  return lines
}
