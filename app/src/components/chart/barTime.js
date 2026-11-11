// Shared time helpers for the dashboard's charts.
// Extracted from StockChart so other consumers (Journal 2.0 markers,
// overlays, etc.) can produce bar-aligned times without duplicating the
// logic.
//
// ─── CHART TIME (intraday) ──────────────────────────────────────────────────
// Lightweight Charts labels a numeric time as UTC. Intraday bars are therefore
// fed as "ET wall clock read as if it were UTC": chartTime = unix + ET offset
// AT THAT INSTANT (-14400 in EDT, -18000 in EST).
//
// ⛔ THE OFFSET IS PER TIMESTAMP, NEVER ONE CONSTANT. Until 2026-11-10 it was
// captured once at module load, so after the Nov 1 DST change every pre-Nov-1
// bar was labelled an hour early (and every drawing / marker / replay cutoff
// rode the same wrong shift). `toChartTime` / `fromChartTime` are the ONLY
// conversions; every forward shift must have its matching inverse.
//
// Monotonic: chart time is strictly increasing in unix time everywhere except
// the repeated 01:00-02:00 wall hour on the fall-back Sunday, when no US
// equity session (incl. 04:00-20:00 extended hours) trades. Spring-forward
// only opens a 1h gap. `barTime.dst.test.js` proves both 2026 transitions.

import { earlyCloseOn } from '../../lib/marketClock/nyseCalendar.js'

const _ET_PARTS = typeof Intl !== 'undefined'
  ? new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  : null

// The slow, authoritative read (one Intl call). Whole seconds.
function _rawEtOffsetSec(sec) {
  const p = {}
  for (const x of _ET_PARTS.formatToParts(new Date(sec * 1000))) {
    if (x.type !== 'literal') p[x.type] = Number(x.value)
  }
  const hour = p.hour === 24 ? 0 : p.hour
  return Date.UTC(p.year, p.month - 1, p.day, hour, p.minute, p.second) / 1000 - sec
}

// UTC day -> offset (a number) or, on a transition day, {a, b, at}: offset `a`
// before second `at`, `b` from it on. Two Intl calls per new day (+~17 on the
// two transition days a year), then a Map hit per bar.
const _OFFSET_DAY_CACHE_MAX = 20000
const _offsetByDay = new Map()

/** ET's offset from UTC, in SECONDS, at unix second `unixSec` (-14400 | -18000). */
export function etOffsetSec(unixSec) {
  const sec = Math.floor(unixSec)
  const day = Math.floor(sec / 86400)
  let e = _offsetByDay.get(day)
  if (e === undefined) {
    const start = day * 86400
    const a = _rawEtOffsetSec(start)
    const b = _rawEtOffsetSec(start + 86399)
    if (a === b) {
      e = a
    } else {
      let lo = start, hi = start + 86399   // offset(lo) === a, offset(hi) === b
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2)
        if (_rawEtOffsetSec(mid) === a) lo = mid
        else hi = mid
      }
      e = { a, b, at: hi }
    }
    if (_offsetByDay.size >= _OFFSET_DAY_CACHE_MAX) _offsetByDay.clear()
    _offsetByDay.set(day, e)
  }
  return typeof e === 'number' ? e : (sec >= e.at ? e.b : e.a)
}

/** unix seconds -> intraday chart time (ET wall clock as UTC seconds). */
export function toChartTime(unixSec) {
  return unixSec + etOffsetSec(unixSec)
}

/** Intraday chart time -> unix seconds. Exact inverse of `toChartTime` for
 *  every instant a US equity bar can have. In the repeated fall-back hour the
 *  EARLIER instant wins; inside the spring-forward gap (a wall time that never
 *  existed) the EST reading is returned. */
export function fromChartTime(chartSec) {
  if (typeof chartSec !== 'number' || !Number.isFinite(chartSec)) return NaN
  // America/New_York is UTC-4 or UTC-5, so the instant is one of these two.
  const edt = chartSec + 14400
  if (etOffsetSec(edt) === -14400) return edt
  return chartSec + 18000
}

/** ET minute-of-day (0..1439) of a unix second. */
export function etMinuteOfDay(unixSec) {
  const c = Math.floor(toChartTime(unixSec))
  return Math.floor((((c % 86400) + 86400) % 86400) / 60)
}

/** ET calendar date 'YYYY-MM-DD' of a unix second. */
export function etDateOf(unixSec) {
  return new Date(Math.floor(toChartTime(unixSec)) * 1000).toISOString().slice(0, 10)
}

// ─── SESSION + BUCKET POLICY ────────────────────────────────────────────────
export const RTH_OPEN_MIN = 570    // 09:30 ET
export const RTH_CLOSE_MIN = 960   // 16:00 ET

const _closeByDay = new Map()
/** Regular-session close (ET minute-of-day) for the ET date containing
 *  `unixSec`: 960, or the NYSE early close (13:00 -> 780) on a half-day. */
export function rthCloseMinuteOf(unixSec) {
  const iso = etDateOf(unixSec)
  let m = _closeByDay.get(iso)
  if (m === undefined) {
    let ec = null
    try { ec = earlyCloseOn(iso) } catch { ec = null }
    m = ec ? ec.closeHour * 60 + ec.closeMinute : RTH_CLOSE_MIN
    if (_closeByDay.size >= 4000) _closeByDay.clear()
    _closeByDay.set(iso, m)
  }
  return m
}

/**
 * ⭐ THE 60-MINUTE GRID POLICY — the one place it is decided (server twin:
 * `bars_fetch.SIXTY_MIN_GRID` / `bucket_60_et_unix_seconds`).
 *
 * TradingView computes intraday bars from the SESSION START (captured in
 * tests/fixtures/vendor/harness/vw-time-session-spy-60-{rth,ext}-2026-09-28.json):
 *   'session' — RTH hours anchor at the 09:30 open: 09:30, 10:30 ... 15:30
 *               (a 30-min last bar; 12:30 on a 13:00 half-day). Pre-market is
 *               clock hours, its 09:00 bar truncated at 09:30; post-market is
 *               clock hours from the close. RTH-only view == TradingView RTH.
 *   'clock'   — plain ET clock hours 04:00 ... 19:00 (the 09:00 bar spans the
 *               open) == TradingView's extended-hours (04:00-20:00) chart.
 *
 * ⭐ (2026-11-10) The extended view is 'clock': `/api/bars?tf=60&session=eth`
 * serves that grid (derived from 15m server-side), the client caches it under
 * its own key (`seriesCacheTf` → '60e'), and the live stream is asked for 'eth'
 * buckets. A request WITHOUT `session=eth` still gets the stored 'session' grid
 * (`DEFAULT_SIXTY_MIN_GRID`), which is also what every caller that names no
 * grid/session reads.
 * 5/15/30m are identical on both grids (09:30 is on the half hour).
 */
export const SIXTY_MIN_GRID_BY_SESSION = Object.freeze({ rth: 'session', extended: 'clock' })
/** The grid `/api/bars?tf=60` serves when no `session=eth` is asked for. */
export const DEFAULT_SIXTY_MIN_GRID = 'session'

export function sixtyMinGridFor(session = 'extended', policy = SIXTY_MIN_GRID_BY_SESSION) {
  return policy[session === 'rth' ? 'rth' : 'extended']
}

/** The `/api/bars` `session` a chart view asks for: 'eth' with extended hours on,
 *  else 'rth'. (The server judges the tail against this session on every intraday
 *  tf, and serves the clock grid for tf=60 & 'eth'.) */
export function barsSessionFor(showExtended) {
  return showExtended ? 'eth' : 'rth'
}

/** The CACHE identity of a chart's series (IDB / mem cache / load keys). Only 60m
 *  differs between the views, so only 60m on the clock grid gets its own key
 *  ('60e'); every other tf shares one key across sessions (no halved hit rate). */
export function seriesCacheTf(tf, showExtended, policy = SIXTY_MIN_GRID_BY_SESSION) {
  const t = String(tf)
  if (t === '60' && sixtyMinGridFor(showExtended ? 'extended' : 'rth', policy) === 'clock') return '60e'
  return t
}

/** The tf a cache key ('60e') stands for — what bucket/session logic must read. */
export function logicTfOf(cacheTf) {
  return cacheTf === '60e' ? '60' : cacheTf
}

const _NATIVE_INTRADAY = new Set(['1', '5', '15', '30', '60'])
/** `&session=…` for an `/api/bars` URL of `tf` in this view ('' for D/W/M). */
export function barsSessionQuery(tf, showExtended) {
  return _NATIVE_INTRADAY.has(String(tf)) ? `&session=${barsSessionFor(showExtended)}` : ''
}

/** `&session=eth` ONLY where the bars themselves differ (60m on the clock grid) —
 *  for secondary series (compare overlays) that must sit on the main series' grid
 *  but have no tail judgment of their own. */
export function barsGridQuery(tf, showExtended) {
  return seriesCacheTf(tf, showExtended) === '60e' ? '&session=eth' : ''
}

/** True when `unixSec` is a 60m bucket start on the grid this chart view uses
 *  (half-day aware) — the push opt-in's "is the fetched series on the stream's
 *  grid" test. */
export function isOnSixtyMinGrid(unixSec, showExtended, policy = SIXTY_MIN_GRID_BY_SESSION) {
  const grid = sixtyMinGridFor(showExtended ? 'extended' : 'rth', policy)
  return bucketStartUnix(unixSec, 60, { grid }) === Math.floor(unixSec)
}

/**
 * Unix second at which the `tfMin`-minute bucket containing `unixSec` starts.
 * Non-60 TFs floor to their period (ET offsets are whole hours, so the UTC
 * floor IS the ET floor). 60 follows `grid` (see SIXTY_MIN_GRID_BY_SESSION).
 */
export function bucketStartUnix(unixSec, tfMin, { grid } = {}) {
  const sec = Math.floor(unixSec)
  const tf = Number(tfMin)
  if (tf !== 60) {
    const p = (tf > 0 ? tf : 5) * 60
    return Math.floor(sec / p) * p
  }
  if (_GRID_ALIAS[grid || DEFAULT_SIXTY_MIN_GRID] === 'clock') return Math.floor(sec / 3600) * 3600
  const m = etMinuteOfDay(sec)
  const close = rthCloseMinuteOf(sec)
  let anchor
  if (m >= RTH_OPEN_MIN && m < close) anchor = RTH_OPEN_MIN + Math.floor((m - RTH_OPEN_MIN) / 60) * 60
  else if (m >= close) anchor = close + Math.floor((m - close) / 60) * 60
  else anchor = Math.floor(m / 60) * 60   // pre-market; 09:00-09:29 ends at the open
  return sec - (((sec % 60) + 60) % 60) - (m - anchor) * 60
}

// Grid names: this file's 'session'/'clock' == bar_rollup.tv_bucket_bounds'
// (and the stream wire's) 'rth'/'eth'.
export const _GRID_ALIAS = { session: 'session', clock: 'clock', rth: 'session', eth: 'clock' }


export const PERIOD_SECONDS = { '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600 }

/**
 * Given a timeframe code and a UTC-seconds timestamp, return the value
 * that LW Charts uses as the bar's `time`:
 *   - Intraday (1/5/15/30/60): number — bucket start as chart time (toChartTime)
 *   - Daily ('D'): "YYYY-MM-DD" string in ET
 *   - Weekly ('W'): "YYYY-MM-DD" of the Friday (close) of the ET week
 *   - Monthly ('M'): "YYYY-MM-01" of the ET month
 */
export function computeBarTime(tf, tickTimeSec, opts = {}) {
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
  // Intraday: the bucket start on the shared grid (60m per the session policy),
  // shifted by the ET offset AT THAT BAR -- never a page-load constant.
  if (tf === '60') {
    // No session named → the grid /api/bars serves by default (never the policy's
    // extended view, which only a caller that knows its view may ask for).
    const grid = opts.session == null ? DEFAULT_SIXTY_MIN_GRID
      : opts.session === 'eth' ? 'clock' : opts.session === 'rth' ? 'session' : sixtyMinGridFor(opts.session)
    return toChartTime(bucketStartUnix(tickTimeSec, 60, { grid }))
  }
  const period = PERIOD_SECONDS[tf] || 300
  return toChartTime(Math.floor(tickTimeSec / period) * period)
}
