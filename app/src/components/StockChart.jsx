// app/src/components/StockChart.jsx — TradingView Lightweight Charts v5 wrapper
// Optimized: chart instance reuse, O(n) HVC, memoized data transforms
import { useEffect, useLayoutEffect, useRef, useCallback, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import useSWR from 'swr'
import { createChart, CandlestickSeries, BarSeries, HistogramSeries, LineSeries, AreaSeries, ColorType, LineType } from 'lightweight-charts'
import usePreferences from '../hooks/usePreferences'
import { mergeChartSettings } from './chart/chartDefaults'
import { createWatermarkPrimitive, composeWatermarkLines } from './chart/watermarkPrimitive'
import useTickerMeta from '../hooks/useTickerMeta'
import useWatermarkDrag from '../hooks/useWatermarkDrag'
import { toHeikinAshi, computeBB, computeVWAP, computeRSI, computeMACD, computeStochastic, computeATR, computeParabolicSAR, computeIchimoku, computeMFI, computeCCI, computeWilliamsR, computeADX, computeOBV, computeDonchian } from './chart/indicators'
import useChartDrawings from './chart/useChartDrawings'
import ChartDrawingOverlay from './chart/ChartDrawingOverlay'
import ChartCalloutOverlay from './chart/ChartCalloutOverlay'
import SetupMoveOverlay from './chart/SetupMoveOverlay'
import { classifyLiveBar } from './chart/liveBarClassify'
import { applySessionCandle, computeSessionTagLines, etMinutes } from './chart/sessionPreview'
import useMarketOpen from '../hooks/useMarketOpen'
import { getExtSession, anchorNoonSec } from '../utils/extSession'
import useSessionExtBars from '../hooks/useSessionExtBars'
import PatternOverlay from './chart/PatternOverlay'
import PatternSidePanel from './chart/PatternSidePanel'
import ChartToolbar from './chart/ChartToolbar'
import { resolveChartRegion, INDICATOR_LABELS } from './chart/chartRegion'
import { createSessionShadingPrimitive, computeSessionBands } from './chart/sessionShadingPrimitive'
import { createSwingLabelsPrimitive } from './chart/swingLabelsPrimitive'
import { detectSwingPivots, sensitivityToParams } from './chart/swingPivots'
import { computePaneMargins } from './chart/paneMargins'
import { usePatternDetections } from '../hooks/usePatternDetections'
import useRealtimePrices from '../hooks/useRealtimePrices'
import { getSnapshot as getLivePriceStoreSnapshot } from '../hooks/livePriceStore'
import useRealtimeBars from '../hooks/useRealtimeBars'
import * as realtimeCandle from '../lib/realtimeCandle'
import * as barsStreamManager from '../lib/barsStreamManager'
// Beyond this, a Massive bar tick is considered stale and the legend falls back
// to the Finnhub price (mirrors BAR_TICK_FRESH_MS in useRealtimeBarPrices).
const LIVE_TICK_FRESH_MS = 6000
// Default-zoom: place the LAST candle at this fraction of the plot width on EVERY
// timeframe so flipping D/W/M/intraday never drifts it left/right. (A fixed
// bars-of-right-pad drifts because bar spacing widens as fewer bars show.)
const LAST_CANDLE_POS = 0.96

// Per-timeframe default number of visible bars (Daily on the workspace is
// overridden to ~126 ≈ 6 months via dailyDefaultBars).
const DEFAULT_VISIBLE_BARS = {
  '1': 390,   // ~1 trading day of 1min bars
  '5': 78,    // ~1 trading day of 5min bars
  '15': 78,   // ~3 trading days of 15min bars
  '30': 65,   // ~5 trading days of 30min bars
  '60': 65,   // ~10 trading days of 1hr bars
  'D': 65,    // ~3 months of daily bars
  'W': 52,    // ~1 year of weekly bars
  'M': 36,    // ~3 years of monthly bars
}

// The canonical default-zoom visible logical range: the newest candle anchored at
// a CONSTANT fraction (LAST_CANDLE_POS) of the plot width, showing the timeframe's
// default history. Shared by the initial framing, the snap-back safety guard, and
// the right-click "Reset view" so all three land on the exact same window.
function computeDefaultLogicalRange(barsLen, tf, { dailyDefaultBars = null, leftBarPad = 0, rightPadBars = 3 } = {}) {
  const visibleBars = (tf === 'D' && dailyDefaultBars) ? dailyDefaultBars : (DEFAULT_VISIBLE_BARS[tf] || 65)
  const from = barsLen > visibleBars ? barsLen - visibleBars - leftBarPad : -leftBarPad
  const hist = (barsLen - 1) - from
  const to = hist > 0 ? from + hist / LAST_CANDLE_POS : barsLen + rightPadBars
  return { from, to }
}

import useJ2ChartMarkers from '../pages/journal-2-0/hooks/useJ2ChartMarkers'
import CountdownTimer from './chart/CountdownTimer'
import styles from './StockChart.module.css'
import { streamStatus } from '../utils/streamStatus'
import brandMark from './intro/assets/compass-mark.png'
import { idbGet, idbPut, mergeDelta } from '../utils/barsIDB'
import { memPeek, memPut } from '../utils/barsMemCache'
import { resample } from '../utils/resampleBars'
import { barsRenderPlan } from './chart/renderPlan'
import ChartSkeleton from './chart/ChartSkeleton'
import { normalizeToPctChange } from './chart/comparisonUtils'
import { composeScreenshot, downloadBlob, copyBlobToClipboard, chartStateToUrl, urlToChartState } from './chart/chartScreenshot'
import ScreenshotPopover from './chart/ScreenshotPopover'
import { matchShortcut } from './chart/keyboardShortcuts'
import KeyboardHelpOverlay from './chart/KeyboardHelpOverlay'
import PositionPanel from './chart/PositionPanel'
import UIcon from './ui/UIcon'
import { FIRST_PAINT_BARS, fullBarsFor, shouldBackfill, nextBackfillDepth } from '../utils/barsBackfill'

const NOOP = () => {}

// Stable empty Journal 2.0 overlay — used by curated book charts that opt out
// of the viewer's personal trade markers/price lines (hideJournalOverlay).
const EMPTY_J2 = { markers: [], priceLines: [] }

// Parse an ISO date / unix-seconds / unix-ms value to epoch milliseconds.
const _dateToMs = (v) => {
  if (v == null) return NaN
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  const s = String(v)
  return Date.parse(s.length <= 10 ? `${s}T00:00:00Z` : s)
}

// Date-range presets for the bottom-left range bar (TC2000-style). Value = months
// back from the newest bar; 'ytd' = since Jan 1 of the newest bar's year. 12M and 1Y
// are intentionally both present (same ~12-month window) per the requested button set.
const RANGE_OPTS = [
  ['3M', 3], ['6M', 6], ['YTD', 'ytd'], ['1Y', 12], ['5Y', 60],
]

// Bars-worth of blank space to render on the LEFT when a framed window's start
// date predates the earliest loaded bar — e.g. a Setup Library / Model Book
// example whose frame start is before the stock's IPO (first-ever trading day).
// Lightweight-charts accepts a NEGATIVE `from` logical index, which paints empty
// space before bar 0, so the chart honors the requested start instead of clamping
// to the IPO bar and zooming in too far. Returns 0 when the start is not earlier
// than the first bar (the normal case — charts with lead-in/warm-up bars).
const PERIOD_MS = { D: 86400000, W: 604800000 }
const leadingBlankBars = (startMs, firstBarMs, tf) => {
  if (!Number.isFinite(startMs) || !Number.isFinite(firstBarMs) || startMs >= firstBarMs) return 0
  const calDays = (firstBarMs - startMs) / 86400000
  if (tf === 'W') return Math.round(calDays / 7)            // one bar per week
  if (tf === 'D') return Math.round((calDays * 5) / 7)      // skip weekends
  const per = PERIOD_MS[tf] || 86400000                     // intraday book charts don't occur
  return Math.round((firstBarMs - startMs) / per)
}

// Throw on !ok so SWR's onErrorRetry sees a real error and backs off.
// Without this, a 503 with a JSON body parses as a successful response
// with bars=[], the chart paints blank, and SWR never retries. The bars
// route now returns 503 during transient SQLite-swap windows precisely
// so this retry loop can heal automatically. Also enforces a client-side
// timeout so a hung cold Massive fetch can't tie up the chart indefinitely.
const fetcher = async (url) => {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 25000)
  try {
    const r = await fetch(url, { signal: ctl.signal })
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status}`)
      err.status = r.status
      throw err
    }
    return await r.json()
  } finally {
    clearTimeout(timer)
  }
}

// Conservative retry for transient (5xx / aborted-network) failures.
// Cold Massive fetches can legitimately take 5–15s, so aggressive 1s
// retries multiply in-flight load across many mounted charts → a normally-
// slow request becomes a stampede that's MUCH slower. Floor 15s, exponential
// up to 60s, hard cap 4 retries (~3 min). During retry, the chart's existing
// bars selector falls back to idbBars — user sees last-known data, not blank.
// 4xx skip retry: real client errors.
const barsSwrOnErrorRetry = (error, _key, _config, revalidate, { retryCount }) => {
  const status = error?.status
  if (status && status >= 400 && status < 500) return
  if (retryCount >= 4) return
  const delay = Math.min(15000 * Math.pow(1.5, retryCount), 60000)
  setTimeout(() => revalidate({ retryCount }), delay)
}

// ─── Legend helpers ─────────────────────────────────────────────────────────

function formatLegendTime(time) {
  if (typeof time === 'string') return time
  const d = new Date(time * 1000)
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

// ─── Time-axis formatting ───────────────────────────────────────────────────
// Intraday bar times are pre-shifted to ET (adjustTime adds _ET_OFFSET), so we
// read the UTC parts of the shifted value to get ET wall-clock. Daily+ times are
// 'YYYY-MM-DD' strings (or business-day objects) with no time-of-day.
const _WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const _MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function _fmt12(d) {
  let h = d.getUTCHours(); const m = d.getUTCMinutes()
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return m === 0 ? `${h} ${ap}` : `${h}:${String(m).padStart(2, '0')} ${ap}`
}

// Parse a daily+ time (string or business-day object) → a UTC Date, or null.
function _dayDate(time) {
  let y, mo, day
  if (typeof time === 'string') { const p = time.split('-'); y = +p[0]; mo = +p[1]; day = +p[2] }
  else if (time && typeof time === 'object') { y = time.year; mo = time.month; day = time.day }
  else return null
  if (!y) return null
  return new Date(Date.UTC(y, (mo || 1) - 1, day || 1))
}

// Bottom-axis TICK labels: 12-hour time on intraday, dates otherwise.
// tickMarkType (LWC): 0=Year 1=Month 2=DayOfMonth 3=Time 4=TimeWithSeconds.
function chartTickMarkFormatter(time, tickMarkType) {
  if (typeof time === 'number') {
    const d = new Date(time * 1000)
    if (tickMarkType >= 3) return _fmt12(d)                       // time tick → 12-hour
    return `${_MO[d.getUTCMonth()]} ${d.getUTCDate()}`           // intraday day-boundary
  }
  const d = _dayDate(time)
  if (!d) return String(time)
  if (tickMarkType === 0) return String(d.getUTCFullYear())       // Year
  if (tickMarkType === 1) return _MO[d.getUTCMonth()]            // Month
  return String(d.getUTCDate())                                  // DayOfMonth
}

// CROSSHAIR time label (the hover box on the axis): weekday + date [+ 12-hour].
// e.g. "Tue 14 Jul '26 12:00 AM"  (daily: "Tue 14 Jul '26").
function chartCrosshairTimeFormatter(time) {
  if (typeof time === 'number') {
    const d = new Date(time * 1000)
    const yy = String(d.getUTCFullYear()).slice(2)
    return `${_WD[d.getUTCDay()]} ${d.getUTCDate()} ${_MO[d.getUTCMonth()]} '${yy} ${_fmt12(d)}`
  }
  const d = _dayDate(time)
  if (!d) return String(time)
  const yy = String(d.getUTCFullYear()).slice(2)
  return `${_WD[d.getUTCDay()]} ${d.getUTCDate()} ${_MO[d.getUTCMonth()]} '${yy}`
}

function formatVolume(v) {
  if (!v) return '0'
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K'
  return v.toLocaleString()
}

// Format dollar notional for dark pool bars: "$120.5M", "$1.2B", "$45K"
function formatDpNotional(v) {
  if (!Number.isFinite(v) || v <= 0) return '$0'
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K'
  return '$' + v.toLocaleString()
}

// ─── Indicator computations ──────────────────────────────────────────────────

// O(n*period) SMA via full window re-sum at every bar. The naive approach,
// kept because the rolling-window optimization (sum += in - out) accumulates
// floating-point error that can flip .toFixed(2) results at cent boundaries
// — verified empirically on cent-rounded prices producing ~1c divergence vs
// the reference in ~24% of bars on SMA200 over 8000 bars. Even periodic
// re-sync of the rolling sum doesn't fully eliminate it because the subtract
// itself introduces drift between syncs.
//
// For the period sizes used here (5-200) and bar counts up to 8000, this
// runs in ~2ms after JIT warmup, well within the 50ms budget. If/when chart
// jank from this becomes measurable, the fix is integer-cents arithmetic
// (Math.round(price*100) → integer sum → divide at output) which is exact,
// or moving the compute to a Web Worker.
// `fromStart`: emit a value for EVERY bar from index 0 instead of waiting for
// the first full `period` window. The leading bars use an expanding-window
// average (SMA of bars[0..i]) so the line begins at the chart's first bar —
// used by the intraday popup, where a single session is too short to "waste"
// the first `period` bars on warmup.
export function computeSMA(bars, period, fromStart = false) {
  if (bars.length < period && !fromStart) return []
  const result = []
  const start = fromStart ? 0 : period - 1
  for (let i = start; i < bars.length; i++) {
    // Re-sum the full window at every bar (exact, no rolling-subtract drift).
    // Keep FULL precision — rounding the MA to cents stair-steps the line on
    // low-priced (split-adjusted) names; TradingView renders it full-precision.
    const from = Math.max(0, i - period + 1)
    let sum = 0
    for (let j = from; j <= i; j++) sum += bars[j].c
    result.push({ time: bars[i].t, value: sum / (i - from + 1) })
  }
  return result
}

// `fromStart`: seed the EMA from the first bar's close (rather than an SMA over
// the first `period` bars) so the line begins at the chart's first bar.
function computeEMA(bars, period, fromStart = false) {
  if (bars.length < period && !fromStart) return []
  if (!bars.length) return []
  const k = 2 / (period + 1)
  // Full precision (no cent rounding) so the line stays smooth on low-priced names.
  if (fromStart) {
    let ema = bars[0].c
    const result = [{ time: bars[0].t, value: ema }]
    for (let i = 1; i < bars.length; i++) {
      ema = bars[i].c * k + ema * (1 - k)
      result.push({ time: bars[i].t, value: ema })
    }
    return result
  }
  let sum = 0
  for (let i = 0; i < period; i++) sum += bars[i].c
  let ema = sum / period
  const result = [{ time: bars[period - 1].t, value: ema }]
  for (let i = period; i < bars.length; i++) {
    ema = bars[i].c * k + ema * (1 - k)
    result.push({ time: bars[i].t, value: ema })
  }
  return result
}

// O(n) HVC detection via monotonic deque — replaces O(n × lookback) slice+spread
function computeHVC(bars) {
  const hvcSet = new Set()
  const lb = Math.min(252, bars.length - 1)
  const startIdx = Math.max(20, lb)
  if (startIdx >= bars.length) return hvcSet
  // Monotonic decreasing deque: front holds index of max volume in window
  const deque = [] // [{idx, vol}]
  // Pre-fill deque with bars before the check window
  for (let i = 0; i < startIdx; i++) {
    const vol = bars[i].v || 0
    while (deque.length && deque[deque.length - 1].vol <= vol) deque.pop()
    deque.push({ idx: i, vol })
  }
  for (let i = startIdx; i < bars.length; i++) {
    const windowStart = Math.max(0, i - lb)
    // Expire elements outside the lookback window
    while (deque.length && deque[0].idx < windowStart) deque.shift()
    const vol = bars[i].v || 0
    // Front of deque = max of [windowStart .. i-1] (prior bars only)
    if (deque.length && vol > deque[0].vol) hvcSet.add(bars[i].t)
    // Maintain decreasing invariant
    while (deque.length && deque[deque.length - 1].vol <= vol) deque.pop()
    deque.push({ idx: i, vol })
  }
  return hvcSet
}


// ─── ET timezone offset for intraday charts ─────────────────────────────────
// LW Charts displays unix timestamps as UTC. We offset intraday timestamps
// so the chart axis shows Eastern Time (handles EDT/EST automatically).

function getETOffset() {
  const now = new Date()
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  return Math.round((et - utc) / 1000) // -14400 for EDT, -18000 for EST
}

const _ET_OFFSET = getETOffset()

// Phase C single-writer ENABLE gate. Resolves per browser: explicit localStorage
// 'uct.barsPush.enabled'='1' (force on) / '0' (force off — instant per-browser revert), else a
// staged percentage rollout keyed by a stable per-browser bucket. When enabled, the developing
// bar is handed to the Massive push writer and the Finnhub writers early-return.
// WIDEN DIAL — % of browsers that get push BY DEFAULT (no explicit opt-in/out).
// CURRENTLY 100 = FULLY ROLLED OUT (2026-07-06): every eligible intraday chart streams push by
// default; a user opts OUT with localStorage 'uct.barsPush.enabled'='0'. (History: ramped
// 0→25→100 under monitoring.) Each eligible chart holds ONE /api/stream/bars loop on the single
// shared event loop, so CHANGING this is a SCALING step. Narrow = lower this + deploy (~10min);
// full backend kill = STREAM_BARS_ENABLED=0; instant per-browser = the localStorage '0' opt-out.
export const BARS_PUSH_ROLLOUT_PCT = 100

// Stable per-browser rollout bucket [0,100), assigned once + persisted so a browser's in/out
// status doesn't flip between renders (or as the dial ramps) — a user won't flap push↔Finnhub.
function _rolloutBucket() {
  try {
    let b = localStorage.getItem('uct.barsPush.bucket')
    if (b == null) { b = String(Math.floor(Math.random() * 100)); localStorage.setItem('uct.barsPush.bucket', b) }
    const n = parseInt(b, 10)
    return Number.isFinite(n) ? n : 100
  } catch { return 100 }  // no storage → out of rollout (safe default-off)
}

export function _barsPushEnabled() {
  try {
    const ls = typeof localStorage !== 'undefined' ? localStorage.getItem('uct.barsPush.enabled') : null
    if (ls === '1') return true     // explicit opt-in (canary / power user)
    if (ls === '0') return false    // explicit opt-out (per-browser revert)
    return _rolloutBucket() < BARS_PUSH_ROLLOUT_PCT   // default: staged percentage rollout
  } catch { return false }
}

// Operator/canary helper: set OR clear the canary flag AND dispatch the same-tab event
// so open charts re-evaluate immediately (no reload — the plan's instant runtime revert).
// From DevTools: window.__uctBarsPush(true) to canary, window.__uctBarsPush(false) to revert.
export function setBarsPushEnabled(on) {
  try {
    if (on) localStorage.setItem('uct.barsPush.enabled', '1')
    else localStorage.removeItem('uct.barsPush.enabled')
    window.dispatchEvent(new Event('uct-barspush-change'))
  } catch { /* ignore */ }
}
if (typeof window !== 'undefined') window.__uctBarsPush = setBarsPushEnabled

// ─── Bar period computation (for real-time new candle creation) ──────────────

const PERIOD_SECONDS = { '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600 }

function computeBarTime(tf, tickTimeSec) {
  if (tf === 'D') {
    // Daily: ET date string "YYYY-MM-DD" (matches LW Charts BusinessDay format)
    return new Date(tickTimeSec * 1000)
      .toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  }
  if (tf === 'W') {
    // Weekly: Friday (close) of current week in ET — matches the backend
    // resample + chart/barTime.js. Walk to Monday, then +4 days = Friday.
    const d = new Date(tickTimeSec * 1000)
    const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const day = et.getDay()
    et.setDate(et.getDate() - day + (day === 0 ? -6 : 1) + 4)
    return et.toISOString().split('T')[0]
  }
  if (tf === 'M') {
    // Monthly: first of current month in ET
    const d = new Date(tickTimeSec * 1000)
    const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-01`
  }
  // Intraday: floor to period boundary in UTC, then offset to ET for display
  const period = PERIOD_SECONDS[tf] || 300
  return Math.floor(tickTimeSec / period) * period + _ET_OFFSET
}

// ─── Series type helpers ─────────────────────────────────────────────────────

const OHLC_TYPES = new Set(['candles', 'hollow', 'bars'])
const VWAP_TFS = new Set(['1', '5', '15', '30', '60'])

function isOhlcType(chartType) {
  return !chartType || OHLC_TYPES.has(chartType)
}

// ─── Live-tick sanity (SINGLE source of truth) ───────────────────────────────
// Every developing-bar update path MUST gate through this. Divergent
// inline guards are exactly how the DDOG 20798 (=100x) phantom slipped a
// path. Rejects non-finite / non-positive, and any value deviating >50%
// from EITHER the last painted bar OR the poison-proof last *server*
// close (lastBarRef can itself get baked bad; the server close cannot).
function isSaneLivePrice(p, lastClose, serverClose) {
  if (!Number.isFinite(p) || p <= 0) return false
  if (lastClose && lastClose > 0 && Math.abs(p - lastClose) / lastClose > 0.5) return false
  if (serverClose && serverClose > 0 && Math.abs(p - serverClose) / serverClose > 0.5) return false
  return true
}

// The price to paint the developing candle with. During an extended session
// (pre/post-market) the snapshot's `price`/`day_close` FREEZES at the 4pm
// regular-session close while `ext_price` carries the live pre/post-market
// print — so using `.price` after the close stamps the STALE RTH close onto the
// last extended-hours bar (QQQ 7:55pm painted 719.69 instead of the real 722.09;
// AEHR dragged 93→72 on an earnings pop). Prefer ext_price whenever the feed
// flags an extended session and it's a sane positive number; else the regular
// `price`. Mirrors TradingView/TC2000 extended-hours behaviour.
function _effLivePrice(snap) {
  if (!snap) return undefined
  const ext = snap.ext_price
  if (snap.ext_session && Number.isFinite(ext) && ext > 0) return ext
  return snap.price
}

// Format the time span between two bar timestamps for the drag-measure readout.
// Bar `.t` is 'YYYY-MM-DD' for D/W/M (→ days) or an epoch-seconds number for
// intraday (→ h/m; any consistent offset cancels in the diff).
function _formatMeasureSpan(t1, t2) {
  let secs
  if (typeof t1 === 'string' && typeof t2 === 'string') {
    const d1 = Date.parse(t1 + 'T00:00:00Z'), d2 = Date.parse(t2 + 'T00:00:00Z')
    if (!Number.isFinite(d1) || !Number.isFinite(d2)) return ''
    secs = Math.abs(d2 - d1) / 1000
  } else {
    secs = Math.abs(Number(t2) - Number(t1))
    if (!Number.isFinite(secs)) return ''
  }
  const days = secs / 86400
  if (days < 1) {
    const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60)
    if (h >= 1) return m > 0 ? `${h}h ${m}m` : `${h}h`
    return `${m}m`
  }
  if (days < 30) { const d = Math.round(days); return d === 1 ? '1 day' : `${d} days` }
  if (days < 365) return `${(days / 30.44).toFixed(1)} months`
  return `${(days / 365.25).toFixed(1)} years`
}

// ─── Volume Profile canvas draw ──────────────────────────────────────────────

function drawVolumeProfile(canvas, chart, series, filteredBars, vpCfg) {
  if (!canvas || !chart || !series || !filteredBars?.length) return
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)
  if (!vpCfg?.enabled) return

  const visRange = chart.timeScale().getVisibleLogicalRange()
  if (!visRange) return

  const startIdx = Math.max(0, Math.floor(visRange.from))
  const endIdx = Math.min(filteredBars.length - 1, Math.ceil(visRange.to))
  const visBars = filteredBars.slice(startIdx, endIdx + 1)
  if (!visBars.length) return

  let minP = Infinity, maxP = -Infinity
  for (const b of visBars) { if (b.l < minP) minP = b.l; if (b.h > maxP) maxP = b.h }
  if (maxP <= minP) return

  const N = Math.max(8, Math.min(50, vpCfg.bins || 24))
  const bucketSize = (maxP - minP) / N
  const bins = new Float64Array(N)
  for (const b of visBars) {
    const tp = (b.h + b.l + b.c) / 3
    const idx = Math.min(N - 1, Math.floor((tp - minP) / bucketSize))
    bins[idx] += b.v
  }

  let maxVol = 0
  let poc = 0
  for (let i = 0; i < N; i++) { if (bins[i] > maxVol) { maxVol = bins[i]; poc = i } }
  if (!maxVol) return

  const maxBarW = width * 0.15
  for (let i = 0; i < N; i++) {
    if (!bins[i]) continue
    const pLow  = minP + i * bucketSize
    const pHigh = pLow + bucketSize
    const yTop  = series.priceToCoordinate(pHigh)
    const yBot  = series.priceToCoordinate(pLow)
    if (yTop == null || yBot == null) continue
    const barH = Math.max(1, Math.abs(yBot - yTop))
    const barW = (bins[i] / maxVol) * maxBarW
    ctx.fillStyle = i === poc ? (vpCfg.pocColor || 'rgba(200,160,40,0.65)') : (vpCfg.color || 'rgba(120,160,100,0.25)')
    ctx.fillRect(width - barW, Math.min(yTop, yBot), barW, barH)
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

// Bold candle/volume palette (shared base — the intraday popup's modelBookLook).
const BOLD_UP = '#21c45c'
const BOLD_DOWN = '#f23645'

// Model Book "Throughout the Years" palette — tuned to pop like TC2000:
// a brighter, bolder green that leaps off the chart, a deeper darker red that
// recedes, all over a deep-navy canvas. Scoped to boldCandles instances ONLY
// (the Model Book stock detail + Setup Library / Bottoms charted examples), so
// no other chart on the site is touched.
const MB_UP = '#1ae51a'      // pure vivid TC2000 spring-green (low blue → really pops)
const MB_DOWN = '#c41f2d'    // deep darker red
const SUNRISE_UP = '#0a5c22'   // very dark green for the Sunrise LIGHT theme (candles + volume)
const SUNRISE_DOWN = '#7d1620' // very dark red for the Sunrise LIGHT theme (candles + volume)
// Continuous sky gradient painted on the chart CONTAINER (behind a transparent LWC
// canvas) so it flows unbroken through the price pane AND the volume pane.
const SUNRISE_GRADIENT = 'linear-gradient(to bottom, #cbe6f7 0%, #e6eede 52%, #fbf1c9 100%)'
const MB_BG = '#0e0f0d'      // matches the app page background (--bg) so the canvas blends with the rest of the screen
const MB_UP_RGB = '26,229,26', MB_DOWN_RGB = '196,31,45'
const VOL_MA_COLOR = 'rgba(255,255,255,0.45)'   // volume-pane MA line (subtle white)
const SESSION_EXT_COLOR = '#f5a623'  // pre/post-market price tag (TradingView "Pre"/"Post" orange)
const SESSION_PREVIEW_COLOR = '#d8d6cf'  // muted (not-bright) white for the pre-market preview daily candle
const _candleRgba = (up, a) => `rgba(${up ? MB_UP_RGB : MB_DOWN_RGB},${a})`
// Re-express any hex / rgb / rgba color at the given alpha (for the MA tail fade).
function colorWithAlpha(color, a) {
  if (!color) return color
  if (color[0] === '#') {
    let h = color.slice(1)
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    const n = parseInt(h, 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
  }
  const m = color.match(/rgba?\(([^)]+)\)/)
  if (m) { const p = m[1].split(',').map(s => s.trim()); return `rgba(${p[0]},${p[1]},${p[2]},${a})` }
  return color
}
// Like colorWithAlpha but MULTIPLIES the existing alpha (volume bars already
// carry a dimmed alpha — the fade scales it rather than replacing it).
function colorMulAlpha(color, mul) {
  if (!color) return color
  if (color[0] === '#') {
    let h = color.slice(1)
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    const n = parseInt(h, 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${mul})`
  }
  const m = color.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const p = m[1].split(',').map(s => s.trim())
    const baseA = p[3] != null ? parseFloat(p[3]) : 1
    return `rgba(${p[0]},${p[1]},${p[2]},${baseA * mul})`
  }
  return color
}

// Main price-scale margins, with optional caller overrides of the top/bottom
// margin (the global default reserves 0.30 headroom; some surfaces want a
// tighter fit, plus a small bottom gap above a separate volume pane).
function _mainMargins(cs, hasVol, topOverride, bottomOverride) {
  const m = computePaneMargins(cs, hasVol).main
  if (topOverride == null && bottomOverride == null) return m
  return {
    top: topOverride != null ? topOverride : m.top,
    bottom: bottomOverride != null ? bottomOverride : m.bottom,
  }
}

// Smoothly animate the chart's visible logical range from wherever it is now to
// `target` ({from,to} in bar-index space) over `duration` ms.
// rafRef holds the in-flight requestAnimationFrame id so a new call (or unmount)
// can cancel the previous animation. autoScale on the right price scale makes the
// vertical axis ride along, so the candles grow as the window narrows.
//
// The right edge eases linearly, but the window WIDTH is interpolated
// geometrically (exponentially) — a zoom reads as smooth only when the
// magnification changes at a constant *ratio* per frame, not a constant number
// of bars per frame. Linear width made the motion lurch (fast at the start,
// crawling at the end); geometric width + easeInOutSine gives a gliding feel.
function _animateVisibleRange(chart, rafRef, target, duration = 1150) {
  if (!chart) return
  if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  const ts = chart.timeScale()
  let start
  try { start = ts.getVisibleLogicalRange() } catch { start = null }
  if (!start) { try { ts.setVisibleLogicalRange(target) } catch { /* out of range mid-load */ } return }
  const startWidth = start.to - start.from
  const endWidth = target.to - target.from
  const geom = startWidth > 0 && endWidth > 0   // geometric width only when both ends are sane
  const ratio = geom ? endWidth / startWidth : 1
  const t0 = performance.now()
  const ease = x => -(Math.cos(Math.PI * x) - 1) / 2   // easeInOutSine — gentlest start/stop
  const step = (now) => {
    const p = Math.min(1, (now - t0) / duration)
    const e = ease(p)
    const to = start.to + (target.to - start.to) * e
    const width = geom ? startWidth * Math.pow(ratio, e) : startWidth + (endWidth - startWidth) * e
    const from = to - width
    try { ts.setVisibleLogicalRange({ from, to }) } catch { /* ignore transient */ }
    if (p < 1) rafRef.current = requestAnimationFrame(step)
    else rafRef.current = null
  }
  rafRef.current = requestAnimationFrame(step)
}

// Price min/max (raw lows/highs) of the bars spanned by a logical [from,to]
// window. Used to give the focus zoom a continuously-interpolated vertical so
// the price axis glides instead of stair-stepping as taller/shorter bars scroll
// into view (default per-frame autoScale only changes at those discrete events).
function _windowPriceRange(bars, from, to, overlays) {
  if (!bars || !bars.length) return null
  const s = Math.max(0, Math.floor(from))
  const e = Math.min(bars.length - 1, Math.ceil(to))
  let lo = Infinity, hi = -Infinity
  const winTimes = new Set()
  for (let i = s; i <= e; i++) {
    const b = bars[i]
    if (!b) continue
    winTimes.add(b.t)
    if (b.l < lo) lo = b.l
    if (b.h > hi) hi = b.h
  }
  // Include overlay (MA) values in the window so the interpolated target matches
  // the chart's default autoScale fit (which fits candles + overlays). Without
  // this, the end-of-zoom hand-off to autoScale snaps the scale to include MAs
  // that dip below / poke above the candles — and the price-anchored annotations
  // skip with it. (Focus zoom only runs in Model Book at daily/weekly, where the
  // overlay's `time` equals the raw bar `t`.)
  if (overlays?.length) {
    for (const ov of overlays) {
      if (!ov?.data) continue
      for (const p of ov.data) {
        if (p.value == null || !winTimes.has(p.time)) continue
        if (p.value < lo) lo = p.value
        if (p.value > hi) hi = p.value
      }
    }
  }
  return (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) ? { lo, hi } : null
}

// Focus zoom with BOTH axes animated: horizontal logical range (geometric width,
// like _animateVisibleRange) AND a vertical price range interpolated in log space
// from the start framing to the target framing. The vertical is driven through an
// autoscaleInfoProvider on the candle series reading priceRangeRef — set per frame
// here, cleared at the end so normal autoScale resumes. Falls back to the plain
// horizontal-only animation when the price ranges can't be computed.
function _animateFocusZoom(chart, series, rafRef, priceRangeRef, bars, target, duration = 1150, onDone = null, overlays = null, textFadeRef = null, targetTextVisible = null, sRangeOverride = null, tRangeOverride = null) {
  // Text annotations fade only in the last sliver of the zoom (see step()) so they
  // land right as the animation settles on a setup / vanish right as it lands on
  // the year. endFade is the settled target; snap to it on any non-animated path.
  const endFade = targetTextVisible == null ? null : (targetTextVisible ? 1 : 0)
  const snapFade = () => { if (textFadeRef && endFade != null) textFadeRef.current = endFade }
  // NOTE: do NOT null priceRangeRef here. The previous zoom left it pinned to its
  // final range; nulling it before the first frame opens a window where any
  // autoScale recompute (e.g. the gold-candle setData when toggling fast between
  // setups) falls back to the default rounded scale → a one-frame flash. We keep
  // the prior range until the first animation frame overwrites it, and only reset
  // to default on the genuine fallback paths below.
  if (!chart || !series) { priceRangeRef.current = null; snapFade(); _animateVisibleRange(chart, rafRef, target, duration); onDone && onDone(); return }
  if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  const ts = chart.timeScale()
  let start
  try { start = ts.getVisibleLogicalRange() } catch { start = null }
  if (!start) { priceRangeRef.current = null; snapFade(); try { ts.setVisibleLogicalRange(target) } catch { /* mid-load */ } onDone && onDone(); return }
  // Callers can supply explicit price windows (Setup⇄Result flip): the horizontal
  // target carries replay right-padding, but the VERTICAL must be fit to the real
  // candles only — never the blank pad (or the other frame's bars held in the
  // series mid-transition), which would otherwise inflate the scale and crunch
  // the candles. Falls back to deriving from the logical windows when unset.
  const sRange = sRangeOverride || _windowPriceRange(bars, start.from, start.to, overlays)
  const tRange = tRangeOverride || _windowPriceRange(bars, target.from, target.to, overlays)
  if (!sRange || !tRange) { priceRangeRef.current = null; snapFade(); _animateVisibleRange(chart, rafRef, target, duration); onDone && onDone(); return }
  const startFade = textFadeRef ? (textFadeRef.current ?? 0) : 0
  const startWidth = start.to - start.from
  const endWidth = target.to - target.from
  const geom = startWidth > 0 && endWidth > 0
  const ratio = geom ? endWidth / startWidth : 1
  // Interpolate price-range endpoints in log space (prices are > 0) so the
  // vertical motion reads uniform on a log axis.
  const logLerp = (a, b, e) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * e)
  const t0 = performance.now()
  const ease = x => -(Math.cos(Math.PI * x) - 1) / 2   // easeInOutSine
  const step = (now) => {
    const p = Math.min(1, (now - t0) / duration)
    const e = ease(p)
    const to = start.to + (target.to - start.to) * e
    const width = geom ? startWidth * Math.pow(ratio, e) : startWidth + (endWidth - startWidth) * e
    const from = to - width
    priceRangeRef.current = { lo: logLerp(sRange.lo, tRange.lo, e), hi: logLerp(sRange.hi, tRange.hi, e) }
    try { ts.setVisibleLogicalRange({ from, to }) } catch { /* ignore transient */ }
    // Text fade is quick (15% of the animation) and edge-anchored: on zoom-IN it
    // eases in over the LAST 15% so it lands right as the chart settles on the
    // setup; on zoom-OUT it eases out over the FIRST 15% so it clears immediately
    // instead of lingering through the whole zoom-out.
    if (textFadeRef && endFade != null) {
      const fp = targetTextVisible
        ? Math.max(0, Math.min(1, (p - 0.85) / 0.15))
        : Math.max(0, Math.min(1, p / 0.15))
      textFadeRef.current = startFade + (endFade - startFade) * fp
    }
    if (p < 1) {
      rafRef.current = requestAnimationFrame(step)
    } else {
      rafRef.current = null
      snapFade()
      // KEEP the final interpolated range in the provider (do NOT null it / re-fit
      // via autoScale). Handing back to the chart's default autoScale re-rounds the
      // range to "nice" tick values — a one-frame snap that drags the candles AND
      // the price-anchored annotations as the chart "lands". Leaving the provider
      // pinned to the exact final range means there's no landing jump at all. The
      // ref is reset at the start of the next focus zoom and cleared on a
      // stock/timeframe switch (the year pin), so autoScale resumes when needed.
      onDone && onDone()
    }
  }
  rafRef.current = requestAnimationFrame(step)
}

export default function StockChart({
  sym,
  tf,
  height = '100%',
  markers = null,
  priceLines = null,
  showVolume: showVolumeProp,
  overlays: overlaysProp,
  watermark = null,
  watermarkOpacity = null,   // override the settings watermark opacity (Model Book uses a brighter mark)
  watermarkX = null,         // override watermark X (0..1 pane fraction; Model Book pins it top-right)
  watermarkY = null,         // override watermark Y (0..1 pane fraction)
  watermarkPad = null,       // px inset used for BOTH the left/right gutter and the top when corner-pinned (Setup Library — even top-left gap). null = default (14px sides, flush top).
  watermarkCenterX = null,   // px from the pane's left edge — when set, pins the watermark's horizontal CENTER here on every chart (no edge clamp) so it stays tucked in the top-left corner and never drifts by name width or pane width (Setup Library)
  watermarkPadTop = null,    // px top inset, independent of the side gutter (watermarkPad). Charts workspace uses this to drop the mark below the floating drawing toolbar. Falls back to watermarkPad when null.
  onWatermarkCommit = null,  // (pos:{x,y}) => void — when set, a watermark drag persists HERE (per-example) instead of writing the global chart_settings (Setup Library)
  watermarkName = null,      // Model Book: curated company name for the watermark. For a REUSED ticker (e.g. WTW = Weight Watchers in 2017, now Willis Towers Watson) the live ticker meta is the wrong company — this overrides the name (and drops the then-wrong sector/industry).
  watermarkSector = null,    // Model Book: curated historical sector — used when the live ticker meta is the wrong/absent company (renamed/delisted), so the watermark still shows sector below the name like every other stock.
  watermarkIndustry = null,  // Model Book: curated historical industry (paired with watermarkSector).
  className = '',
  showDrawingTools = true,
  onSymbolChange = null,
  onBarContextMenu = null,  // Journal 2.0: right-click a bar → callback({bar, clientX, clientY})
  entryDate = null,         // ISO date string — zoom centers on trade holding period
  exitDate = null,          // ISO date string — end of holding period zoom
  priceScaleTopMargin = null, // override the default 0.30 top headroom (0..0.9)
  dailyDefaultBars = null,  // override the Daily default-zoom bar count (Charts workspace: ~126 ≈ 6 months). Daily only; other TFs keep their own defaults.
  ema9MatchCandle = false,  // Charts workspace: paint the 9-EMA overlay in the candle up-color (MB_UP) so the fast MA matches the candles. Reliable regardless of saved overlay colors; scoped so Model Book is unaffected.
  carryDragPlacement = true, // carry the user's drag-repositioned vertical candle placement across ticker switches. false = each ticker autoscales fresh to the default margins (Charts workspace: prevents the price scale ballooning to a sliver and STICKING when scrolling tickers).
  keepPresentOnSymbolChange = false, // on a symbol switch, keep the zoom LEVEL but re-anchor the newest candle to the right so a newly-typed ticker always loads at present day (never inherits the prior symbol's scrolled-back/past view). Charts workspace opts in.
  centerWatermarkOnPlot = false, // center the watermark on the CANDLE PLOT AREA (chart.timeScale().width()/2), not 0.5×pane-width — the pane width includes the right price axis, so a plain 0.5 reads right-of-center. Exact at any widget width.
  rightPadBars = 3,          // bars of empty space between the last candle and the right price scale (rightOffset + default-zoom right pad). Charts workspace uses more for breathing room.
  exactDateRange = false,   // zoom to exactly [entryDate, exitDate] with no padding
  frameRightPadFrac = 0,    // exactDateRange only: leave this fraction of the window as blank space to the RIGHT of the last framed candle (replay-style room to annotate)
  keepBarsAfterExit = false, // exactDateRange only: DON'T slice bars past exitDate — keep real price history rendering into the right-pad space instead of cutting off (Setup Library "Result" view: exitDate stays framed in place, the ensuing candles fill the screen)
  candleFrameFade = false,  // Setup Library: when exitDate moves (Setup⇄Result), crossfade the candles PAST the highlighted setup day in/out instead of popping them
  instantFrameFlip = false, // exactDateRange only: a frame change (Setup⇄Result) SNAPS to the new frame instead of gliding — an instant cut, like loading a fresh chart
  fitPriceToCandles = false, // price scale fits the CANDLES only — MA overlays don't expand it (they clip off-screen, TC2000-style), so price sits at the same spot regardless of where the 200MA is
  forceLogScale = false,    // default the price scale to logarithmic
  forceScaleMode = null,    // 'arith' | 'log' | 'pct' — pin a default scale regardless of user settings (A/L/% still toggles locally)
  frozen = false,           // static exhibit: no pan/zoom/scale-drag — wheel scrolls the PAGE (Setup Library examples)
  boldCandles = false,      // bold solid green/red candles (Model Book look)
  colorByNetChange = false, // color candles by NET CHANGE (close vs previous close, TC2000/StockCharts style) instead of LWC's default close-vs-open
  candlesOnTop = false,     // TradingView-style: draw candle bodies ABOVE the MA/BB/VWAP overlays so the lines pass behind the bodies instead of overlapping them
  hideLastValue = false,    // hide the last-price axis tag on the price series
  volumeLastValue = false,  // show the current-volume axis tag on the volume pane's right scale (like the price tag on the main chart). Opt-in so Model Book (which deliberately hides it) is unaffected.
  volumeSeparatePane = false, // force volume into its own draggable bottom pane
  priceScaleBottomMargin = null, // small gap below price (above a separate vol pane)
  markVolumeExtremes = false, // gold the highest-volume-ever bar (Model Book)
  disableHvc = false,         // force the 52W-volume-high gold bars OFF (intraday popup)
  hidePriceLine = false,      // hide the dashed last-price line on price AND the volume value line/label (intraday popup)
  hideWatermark = false,      // force the symbol watermark OFF regardless of settings (intraday popup)
  subtleSeparator = false,    // thin grey pane divider (matches the Model Book main chart) even without boldCandles
  hideLegend = false,         // suppress the crosshair OHLCV/overlay legend on hover (intraday popup)
  hideCrosshair = false,      // suppress the hover crosshair lines + axis labels entirely (Setup Library examples)
  dragMeasure = false,        // Charts workspace: plain left-drag draws a transient measure line + % / bars / time readout (TC2000-style) instead of panning. Cursor mode only; mouse only.
  verticalLegend = false,     // Charts workspace: stack the crosshair OHLCV legend single-file down the left instead of a horizontal row near the toolbar.
  lockWatermark = false,      // Charts workspace: disable the watermark hover-arm + drag so hovering it never moves it.
  alwaysShowLegend = false,   // Charts workspace: keep the legend visible with the latest bar's values when the cursor is off the chart (instead of hiding).
  leftBarPad = 0,             // bars of empty space before the first bar on the default zoom (intraday popup: matches the right padding)
  overlaysFromStart = false,  // MA overlays begin at the chart's first bar (expanding-window warmup) instead of after `period` bars (intraday popup)
  modelBookLook = false,      // match the Model Book main chart's NON-candle styling (thin 0.5px curved MAs + VWAP, fuller-opacity volume) without the bold candle bodies (intraday popup)
  volumePaneHeightPct = null, // override the separate volume pane height (%)
  showRangeSelector = false, // show the TC2000-style date-range bar (3M/6M/YTD/12M/1Y/5Y) bottom-left, above the volume pane
  canvasTheme = null,        // workspace chart-theme override: 'sunrise' = light gradient canvas (keeps green/red candles); null = the normal dark canvas
  onVolumePaneResize = null,  // (pct) => void — fired when the user drags the price/volume separator, so the caller can persist the new height
  volumeMa = 0,             // N-period SMA line drawn on the volume pane (0 = off)
  liveUpdates = true,       // false = skip SSE subscription (e.g. closed-trade historical charts)
  onTfChange = null,        // optional callback(tf) — called when keyboard TF shortcut fires
  compareSymbol = null,     // optional secondary symbol for % return comparison overlay
  onCompareChange = null,   // callback(sym) — parent manages compareSymbol state
  // ── Optional multi-chart sync hooks (additive — all behavior unchanged when absent) ──
  onCrosshairMove = null,   // (payload: {time, price}) => void — fires when local user hovers chart
  onTimeRangeChange = null, // (payload: {from, to}) => void — fires when visible time range changes
  externalCrosshair = null, // {time, price} | null — render external crosshair from sync context
  externalTimeRange = null, // {from, to} | null — apply external time range from sync context
  hideReplay = false,       // hide the Replay / Time Machine button
  hidePatterns = false,     // hide the pattern-recognition toggle button
  hideCompare = false,      // hide both compare-symbol entry points (text input + popover)
  hideCountdown = false,    // hide the intraday bar-close countdown badge
  // ── Animated "focus a setup" zoom (Model Book) ──
  focusDate = null,         // ISO date — smoothly zoom so this bar is the last candle; null = zoom back to [entryDate,exitDate]
  focusStartDate = null,    // ISO date — optional left edge of the focus frame; overrides focusBarsBack when set
  focusNonce = 0,           // bump to (re)trigger the focus zoom even when focusDate is unchanged
  focusBarsBack = 80,       // lead-up bars shown to the left of the focus bar (fallback when focusStartDate unset)
  // ── Per-setup annotations (Model Book) — additive, default-off ──
  callouts = null,              // array of {time, text} leader-line labels (Model Book catalysts) — placed in blank space with a diagonal line to the candle
  setupMoves = null,            // sorted array of {date, anchor} per setup (Model Book) — draws a "+X%" advance label at the start of each setup's lines vs the previous one
  annotations = null,           // array of chart drawings to render for the focused setup (null = layer off)
  annotationsVisible = false,   // fade the annotation layer in/out (tied to the focus zoom)
  annotationsOpacity = 1,       // extra opacity multiplier (Model Book setup→setup crossfade)
  annotationsFadeWhole = false, // Model Book show-all OFF: fade the WHOLE setup layer with the zoom (not just text)
  annotationsEditable = false,  // admin authoring: enable the drawing toolbar + editing
  annotationsTextVisible = null, // Setup Library: drive the TEXT-annotation fade directly (true=show / false=fade out) when there's no focus zoom to do it. null = leave it to the focus-zoom path (Model Book).
  staticAnnotations = null,     // Model Book: stock-level drawings shown always on the full-year view (read-only, independent of any setup)
  onAnnotationsChange = null,   // (drawings[]) => void — called when admin adds/edits/removes an annotation
  onAnnotationsMigrate = null,  // (drawings[]) => void — called once when a legacy volume-pane annotation is re-anchored to the pane (so it can be persisted)
  highlightBarTime = null,      // ISO/time (or array of them) of bar(s) to paint (Model Book: focused setup's day, or all setup/catalyst days)
  highlightColor = '#e6b800',   // color for highlighted bars (gold for setups; Model Book passes white for catalysts)
  onHighlightClick = null,      // Model Book: ({ date, clientX, clientY }) => void — clicking a highlighted setup/catalyst candle (opens the intraday 5-min popup)
  vwapOverride = null,          // force the session-VWAP indicator on regardless of user settings: { color } (Model Book intraday popup uses white)
  onFocusEscape = null,         // called when the user manually zooms/pans while a setup focus is active → parent should clear focus
  // ── Index comparison pane (Model Book) — additive, default-off ──
  indexPaneSymbol = null,       // e.g. '^IXIC' — draws that symbol's close as a line in a pane ON TOP of the price pane (relative-strength reference vs the index)
  indexPaneColor = '#ffffff',   // line color for the index pane
  indexPaneHeightPct = 18,      // height of the index pane as % of chart
  indexPaneLabel = null,        // top-left label text for the index pane (defaults to the symbol sans caret)
  barsOverride = null,          // Model Book: explicit bars (uploaded historical data for a delisted stock). When set, skip ALL fetching/IDB/delta and render these directly — for tickers the data providers no longer carry.
  barsOverridePending = false,  // Model Book: an override is expected but still loading — suppress the provider fetch (don't flash the wrong/penny data) and show the spinner until it arrives.
  indexAnnotations = null,      // Model Book: GLOBAL drawings (measure marks for Nasdaq corrections) on the index pane — read-only for all, editable for admin
  indexAnnotationsEditable = false, // admin authoring: enable the measure toolbar on the index pane
  onIndexAnnotationsChange = null,  // (drawings[]) => void — called when admin adds/edits/removes an index-pane annotation
  // ── Dark Pool volume profile bars (DarkPool page) ──
  // Renders horizontal bars on the right edge of the chart at the price levels
  // of dark pool prints. Bar width + height scale with $ notional. Latest = gold,
  // older = gray with opacity by relative size. Top 5 by notional get gold tier.
  // Uses series.priceToCoordinate() so bars align pixel-perfect with candles
  // and follow zoom/pan automatically.
  darkPoolBars = null,            // array of {price, notional, isLatest, date, dateLong, pctAvgVol}
  darkPoolMaxBarWidth = 350,      // max bar width in pixels — wider gives
                                  // the $ labels more horizontal room to
                                  // breathe and reduces label collision at
                                  // clustered price levels. Was 250; bumped
                                  // because real charts with 10+ prints near
                                  // the current price had labels stacking on
                                  // top of each other in the small right
                                  // strip. Bars are transparent enough now
                                  // (top tier max 0.50 opacity) that the
                                  // extra width doesn't visually dominate.
  // ── Override candle series priceFormat (e.g. integer-only axis labels) ──
  // Pass { type: 'price', precision: 0, minMove: 1 } to show "200" instead of "200.00"
  priceFormat = null,
  // Curated book charts (Setup Library / Model Book examples) should show ONLY
  // the admin-authored setup overlays — NOT the viewer's own Journal 2.0 trade
  // markers/price lines, which would "randomly" appear on any ticker the viewer
  // happens to have traded. Set true to suppress the personal journal overlay.
  hideJournalOverlay = false,
  // ── Extended-hours session preview (Charts workspace only) ──
  // null on every other surface (feature off). 'regular' | 'extended' from the
  // workspace's "Regular Hours / Include pre-market" toggle. Drives the synthetic
  // pre/post-market daily candle + the locked-close / Pre-Post price tags. Only
  // meaningful on D/W/M — inert on intraday.
  sessionView = null,
  hideExtHoursToolbarToggle = false,  // charts workspace moves the intraday EXT/RTH toggle into the widget header, so hide the toolbar one
}) {
  const { prefs, setPref } = usePreferences()
  const resolvedTf = tf || prefs.default_chart_tf || 'D'

  // ── Chart settings from user preferences ──
  const cs = useMemo(() => mergeChartSettings(prefs.chart_settings), [prefs.chart_settings])
  // Effective candle/volume up-green: darkened for the Sunrise light theme so it
  // stands out on the bright canvas; the normal vivid MB_UP everywhere else.
  const mbUp = canvasTheme === 'sunrise' ? SUNRISE_UP : MB_UP
  const mbDown = canvasTheme === 'sunrise' ? SUNRISE_DOWN : MB_DOWN

  // ── Theme colors (light / dark) layered over user chart settings ──
  // Returns layout/grid/crosshair/candle colors based on cs.theme. Used in
  // chartOpts below and re-applied via useEffect when theme changes.
  const themeColors = useMemo(() => {
    if (canvasTheme === 'sunrise') {
      // TSDR — Sunrise: a light sky-gradient canvas (blue top → sun-yellow bottom),
      // dark ink for text/scales, faint grid. Candles KEEP the current green/red.
      return {
        background: '#eaf3fb',    // crosshair axis-label background (solid, light)
        layoutTransparent: true,  // canvas transparent → the container's CSS sky-gradient shows through unbroken across BOTH panes
        textColor: '#243040',
        gridColor: 'transparent',   // no grid lines on the Sunrise theme
        borderColor: 'rgba(20,35,55,0.22)',
        crosshairColor: '#586573',
        candleUp: boldCandles ? mbUp : cs.candles?.upColor,
        candleDown: boldCandles ? mbDown : cs.candles?.downColor,
      }
    }
    if (cs.theme === 'light') {
      return {
        background: '#ffffff',
        textColor: '#1f2937',
        gridColor: '#e5e7eb',
        borderColor: '#d1d5db',
        crosshairColor: '#6b7280',
        candleUp: '#10b981',
        candleDown: '#ef4444',
      }
    }
    return {
      // Model Book charts (boldCandles) ride a deep-navy canvas to make the
      // bold green/red candles pop (TC2000 look); every other surface keeps the
      // user's configured background.
      background: boldCandles ? MB_BG : cs.background,
      textColor: cs.textColor,
      gridColor: cs.grid?.color,
      borderColor: cs.grid?.color,
      crosshairColor: cs.crosshair?.color,
      candleUp: cs.candles?.upColor,
      candleDown: cs.candles?.downColor,
    }
  }, [cs.theme, cs.background, cs.textColor, cs.grid?.color, cs.crosshair?.color, cs.candles?.upColor, cs.candles?.downColor, boldCandles, canvasTheme])

  // ── Price-scale: forceLogScale (Model Book) defaults to log without touching
  // the user's global chart-settings pref. A per-instance override lets the
  // A/L/% toggle still switch locally. 'arith' | 'log' | 'pct' | null. ──
  const [scaleOverride, setScaleOverride] = useState(null)
  const _forcedScale = forceScaleMode || (forceLogScale ? 'log' : null)
  const effectiveScale = scaleOverride
    || _forcedScale
    || (cs.percentScale ? 'pct' : (cs.logScale ? 'log' : 'arith'))
  const setScale = (kind) => {
    if (_forcedScale) {
      setScaleOverride(kind)  // local only — don't rewrite the global pref
    } else {
      handleUpdateChartSettings({ ...cs, logScale: kind === 'log', percentScale: kind === 'pct', preset: 'custom' })
    }
  }
  // The price pane's right scale, addressed via the candle series so it's always
  // the PRICE scale even when an index-comparison pane sits at pane 0 (where
  // chart.priceScale('right') would otherwise resolve). Falls back to the bare
  // lookup before the series exists. Identical object when no index pane.
  const mainPriceScale = useCallback(
    () => candleSeriesRef.current?.priceScale?.() ?? chartRef.current?.priceScale('right') ?? null,
    []
  )
  // When an index pane sits on top, the PRICE pane is pushed down. The canvas
  // overlays (annotations + catalyst callouts) draw with pane-relative
  // priceToCoordinate (0 = top of the price pane), so their wrapper must be
  // offset to the price pane's box or every drawing lands too high. null = no
  // index pane → wrapper stays inset:0 (every other chart unchanged).
  const [overlayBounds, setOverlayBounds] = useState(null) // {top, height} | null
  const overlayWrapStyle = (extra) => (
    overlayBounds
      ? { position: 'absolute', top: overlayBounds.top, left: 0, right: 0, height: overlayBounds.height, ...extra }
      : { position: 'absolute', inset: 0, ...extra }
  )
  // Same idea for the INDEX pane (top): a drawing overlay there maps Y via the
  // index series' priceToCoordinate (0 = top of the INDEX pane), so its wrapper
  // is offset to the index pane's measured box. null until measured.
  const [indexOverlayBounds, setIndexOverlayBounds] = useState(null) // {top, height} | null
  const indexOverlayWrapStyle = (extra) => (
    indexOverlayBounds
      ? { position: 'absolute', top: indexOverlayBounds.top, left: 0, right: 0, height: indexOverlayBounds.height, ...extra }
      : { position: 'absolute', inset: 0, ...extra }
  )

  // ── Keyboard help overlay state ──
  const [helpOpen, setHelpOpen] = useState(false)
  // Flips true once the LWC chart instance is first created (in updateChart).
  // Used by the crosshair-legend effect to subscribe exactly once, instead of
  // re-subscribing on every render of updateChart (which would happen ~once
  // per real-time tick and visibly stutter the crosshair).
  const [chartReady, setChartReady] = useState(false)

  // ── Dark Pool overlay state ──────────────────────────────────────────────
  // Hover tooltip — fixed-position div near the cursor when hovering a bar.
  const [dpHover, setDpHover] = useState(null)
  const dpBarsContainerRef = useRef(null)

  // Memoize the bar layout so onMouseEnter handlers don't recompute every
  // render. Sorts by notional desc, picks top 25, computes width/height/color
  // tier based on each bar's $ size relative to the largest in the set.
  const darkPoolBarsLayout = useMemo(() => {
    if (!darkPoolBars || darkPoolBars.length === 0) return []
    const sorted = [...darkPoolBars]
      .filter(b => b && b.price != null && b.notional != null && Number.isFinite(b.notional))
      .sort((a, b) => (b.notional || 0) - (a.notional || 0))
      .slice(0, 25)
    if (sorted.length === 0) return []
    const maxN = Math.max(...sorted.map(b => b.notional || 0))
    if (maxN <= 0) return []
    const MIN_BAR_H = 4
    const MAX_BAR_H = 11
    return sorted.map((b, idx) => {
      const ratio = (b.notional || 0) / maxN
      const isGoldTier = idx < 5
      const showLabel = idx < 3   // only label the top 3 by notional
      return {
        ...b,
        idx,
        ratio,
        width: ratio * darkPoolMaxBarWidth,
        height: MIN_BAR_H + ratio * (MAX_BAR_H - MIN_BAR_H),
        color: isGoldTier ? '#c9a84c' : '#9c9588',
        // Bar opacity scales with notional ratio so the largest print is still
        // the most visible. Ceiling was 1.0 which fully solid-colored the top
        // 5 against dark candles — too dominant, drowned out the price action.
        // Iterated down: first cut to 0.65 was still bright, dropped again to
        // 0.50 max for the top tier (≈50% less bright than original at max),
        // 0.40 max for smaller bars.
        opacity: isGoldTier ? 0.20 + ratio * 0.30 : 0.14 + ratio * 0.26,
        isGoldTier,
        showLabel,
      }
    })
  }, [darkPoolBars, darkPoolMaxBarWidth])

  // Position bars vertically by calling series.priceToCoordinate() on each
  // animation frame. Only the chart instance knows the exact pixel Y for a
  // given price (especially after pan/zoom). By running in rAF, bars stay
  // glued to candles regardless of how the user interacts with the chart.
  //
  // Label policy (after several iterations):
  //   - Only the top-3 prints get labels. These are the most important $
  //     amounts on the chart. With only 3 of them, collisions are rare in
  //     practice (you'd need 3 of the biggest prints all at near-identical
  //     prices, which is uncommon).
  //   - Top 4-5 still render as gold bars (visually distinct) but with no
  //     label clutter. Hover for $ amount via the existing tooltip.
  //   - Smaller bars stay as visual reference markers showing WHERE
  //     activity is concentrated. Hover to read the $ amount.
  //   - No staggering — earlier iterations pushed labels far from their
  //     bars and created the "floating disconnected label" failure mode.
  //   - On the rare collision between top-3 labels, they overlap at their
  //     natural Y; the user can zoom in or hover to disambiguate. Still
  //     better than 200px of staggered orphans.
  useEffect(() => {
    if (!chartReady) return
    if (!darkPoolBarsLayout || darkPoolBarsLayout.length === 0) return
    const container = dpBarsContainerRef.current
    if (!container) return
    let raf = 0
    const update = () => {
      const series = candleSeriesRef.current
      if (series) {
        const els = container.querySelectorAll('[data-dp-bar]')
        for (const el of els) {
          const price = parseFloat(el.dataset.price || '')
          if (!Number.isFinite(price)) continue
          let y
          try { y = series.priceToCoordinate(price) } catch { y = null }
          if (y == null || !Number.isFinite(y)) {
            el.style.display = 'none'
          } else {
            el.style.display = 'block'
            el.style.top = `${y}px`
          }
        }
      }
      raf = requestAnimationFrame(update)
    }
    raf = requestAnimationFrame(update)
    return () => { if (raf) cancelAnimationFrame(raf) }
  }, [chartReady, darkPoolBarsLayout])

  // ── Chart event markers (earnings + splits + dividends) — /api/chart/markers ──
  const markersEnabled = cs.markers?.earnings || cs.markers?.splits || cs.markers?.dividends
  const { data: markersData } = useSWR(
    markersEnabled && sym ? `/api/chart/markers/${encodeURIComponent(sym)}?days=730` : null,
    fetcher,
    {
      dedupingInterval: 43_200_000,  // 12 hours — matches backend cache TTL
      revalidateOnFocus: false,
    }
  )

  // ── News markers — /api/chart-news ──
  const showNews = !!cs.markers?.news
  const { data: newsData } = useSWR(
    showNews && sym ? `/api/chart-news/${encodeURIComponent(sym)}?days=60` : null,
    (url) => fetch(url, { credentials: 'include' }).then(r => r.ok ? r.json() : { news: [] }),
    {
      dedupingInterval: 30 * 60 * 1000,  // 30 minutes
      revalidateOnFocus: false,
    }
  )
  const newsMarkers = useMemo(() => {
    if (!showNews || !newsData?.news) return []
    const isDailyWeekly = !['1', '5', '15', '30', '60'].includes(resolvedTf)
    // News timestamps are unix seconds; LW Charts expects ET-offset for intraday and date strings for daily/weekly.
    return newsData.news.map(n => {
      const tsRaw = typeof n.time_published === 'number' ? n.time_published : Number(n.time_published)
      if (!Number.isFinite(tsRaw)) return null
      // For daily/weekly, convert to YYYY-MM-DD date string in ET so it aligns with daily bars
      let time
      if (isDailyWeekly) {
        time = new Date(tsRaw * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
      } else {
        time = tsRaw + _ET_OFFSET
      }
      return {
        time,
        position: 'aboveBar',
        color: '#3b82f6',
        shape: 'circle',
        text: 'N',
        size: 0.8,
        id: `news-${tsRaw}`,
        _newsData: n,
        _tsRaw: tsRaw,
      }
    }).filter(Boolean)
  }, [showNews, newsData, resolvedTf])
  const chartEventMarkers = useMemo(() => {
    // Only show event markers on daily/weekly — intraday bars don't line up with quarter dates
    const isDailyWeekly = !['1', '5', '15', '30', '60'].includes(resolvedTf)
    if (!markersData || !isDailyWeekly) return []
    const eventMarkers = []
    if (cs.markers?.earnings && Array.isArray(markersData.earnings)) {
      for (const e of markersData.earnings) {
        if (!e.date) continue
        const surpTxt = (e.surprise != null && Number.isFinite(+e.surprise))
          ? ` ${(+e.surprise >= 0 ? '+' : '')}${(+e.surprise).toFixed(1)}%`
          : ''
        eventMarkers.push({
          time: e.date,
          position: 'belowBar',
          color: e.beat === true ? '#4ade80' : e.beat === false ? '#f87171' : '#94a3b8',
          shape: e.beat === true ? 'arrowUp' : e.beat === false ? 'arrowDown' : 'circle',
          text: `E${surpTxt}`,
          size: 1,
        })
      }
    }
    if (cs.markers?.splits && Array.isArray(markersData.splits)) {
      for (const s of markersData.splits) {
        if (!s.date) continue
        eventMarkers.push({
          time: s.date,
          position: 'aboveBar',
          color: '#f59e0b',
          shape: 'square',
          text: s.ratio ? `S ${s.ratio}` : 'S',
          size: 1,
        })
      }
    }
    if (cs.markers?.dividends && Array.isArray(markersData.dividends)) {
      for (const d of markersData.dividends) {
        if (!d.date || d.amount == null) continue
        const amt = Number(d.amount)
        if (!Number.isFinite(amt)) continue
        eventMarkers.push({
          time: d.date,
          position: 'belowBar',
          color: '#3b82f6',
          shape: 'arrowUp',
          text: `D $${amt.toFixed(2)}`,
          size: 1,
        })
      }
    }
    return eventMarkers
  }, [markersData, cs.markers, resolvedTf])

  // ── Journal 2.0 markers + entry/stop price lines for this symbol ──
  // Returns empty arrays for unauth'd users. Merged with prop-supplied
  // markers/priceLines below so consumers (e.g. TradeDrawer) keep working.
  const j2Raw = useJ2ChartMarkers(sym, resolvedTf)
  // Curated book charts opt out of the viewer's personal Journal 2.0 overlay so
  // their own BUY/SELL trade markers don't bleed onto setup examples.
  const j2 = hideJournalOverlay ? EMPTY_J2 : j2Raw
  const mergedMarkers = useMemo(
    () => {
      const all = [...(markers || []), ...(j2.markers || []), ...chartEventMarkers, ...newsMarkers]
      // Lightweight Charts requires markers sorted ascending by time. Daily/weekly
      // use date strings (sortable lexicographically), intraday uses unix seconds.
      return all.sort((a, b) => {
        const ta = a?.time
        const tb = b?.time
        if (ta == null && tb == null) return 0
        if (ta == null) return -1
        if (tb == null) return 1
        if (typeof ta === 'number' && typeof tb === 'number') return ta - tb
        return String(ta).localeCompare(String(tb))
      })
    },
    [markers, j2.markers, chartEventMarkers, newsMarkers],
  )
  const mergedPriceLines = useMemo(
    () => [...(priceLines || []), ...(j2.priceLines || [])],
    [priceLines, j2.priceLines],
  )

  // Prop overrides — memoized to prevent unstable references
  const showVolume = showVolumeProp !== undefined ? showVolumeProp : cs.volume.visible
  // Volume in its own pane (no bottom band reserved on the price scale).
  const volInSeparatePane = volumeSeparatePane || !!cs.volume?.separatePane
  const resolvedOverlays = useMemo(
    () => overlaysProp !== undefined ? overlaysProp : cs.overlays.filter(o => o.enabled),
    [overlaysProp, cs.overlays]
  )

  const containerRef = useRef(null)
  const wmCtrlRef = useRef(null)        // watermark primitive controller
  const wmAttachedRef = useRef(false)   // guard: primitive attached once
  const sessionShadeRef = useRef(null)      // extended-hours shading primitive
  const sessionShadeAttachedRef = useRef(false)
  const swingCtrlRef = useRef(null)       // swing-label series primitive controller
  const swingAttachedRef = useRef(false)  // guard: re-attach on candle-series swap
  const tickerMeta = useTickerMeta(sym)
  // Watermark meta. Three cases (Model Book curates name/sector/industry):
  //  1. No curated name → use live ticker meta, but let a curated sector/industry
  //     fill any GAPS the live lookup left blank.
  //  2. Curated name that token-overlaps the live name (same company, just a tidier
  //     label) → keep the accurate live GICS sector/industry, curated fills gaps.
  //  3. Curated name that does NOT match the live name (a REUSED / renamed /
  //     delisted ticker — e.g. SQ=Square→Block, WTW=Weight Watchers, delisted WWE)
  //     → the live meta is the WRONG company, so use the curated name AND the
  //     curated historical sector/industry (so the watermark still shows them like
  //     every other stock, instead of dropping them).
  const watermarkMeta = useMemo(() => {
    const withCuratedGaps = (base) => ({
      ...base,
      sector: base?.sector || watermarkSector || null,
      industry: base?.industry || watermarkIndustry || null,
    })
    if (!watermarkName) {
      return (watermarkSector || watermarkIndustry) ? withCuratedGaps(tickerMeta) : tickerMeta
    }
    const toks = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 4)
    const curated = toks(watermarkName), live = toks(tickerMeta?.name)
    const sameCompany = curated.length > 0 && curated.some(w => live.includes(w))
    if (sameCompany) return withCuratedGaps({ ...tickerMeta, name: watermarkName })
    return { name: watermarkName, sector: watermarkSector || null, industry: watermarkIndustry || null }
  }, [watermarkName, watermarkSector, watermarkIndustry, tickerMeta])
  useWatermarkDrag({
    containerRef,
    controllerRef: wmCtrlRef,
    locked: lockWatermark,
    getActiveTool: () => activeToolRef.current,
    onCommit: ({ x, y }) => {
      // Setup Library: persist the new position on THIS example only, never the
      // global chart_settings (so other charts site-wide keep their watermark).
      if (onWatermarkCommit) { onWatermarkCommit({ x, y }); return }
      const next = mergeChartSettings(prefs.chart_settings)
      next.watermark = { ...next.watermark, x, y }
      next.preset = 'custom'
      setPref('chart_settings', JSON.stringify(next))
    },
  })
  const chartRef = useRef(null)
  const candleSeriesRef = useRef(null)
  const volumeSeriesRef = useRef(null)

  // Keep the plot-centered watermark centered the INSTANT the chart resizes (e.g.
  // a sibling widget is added and this chart narrows). hardCenterXPx is otherwise
  // recomputed only when updateChart next runs (on a data poll), leaving the mark
  // visibly off-center for seconds after a resize. subscribeSizeChange fires on
  // every time-scale width change.
  useEffect(() => {
    if (!chartReady || !centerWatermarkOnPlot) return undefined
    const chart = chartRef.current
    if (!chart) return undefined
    let ts
    try { ts = chart.timeScale() } catch { return undefined }
    const onSize = () => {
      try {
        const tw = ts.width()
        let aw = 0; try { aw = chart.priceScale('right').width() || 0 } catch { /* no right axis */ }
        if (tw > 0 && wmCtrlRef.current) wmCtrlRef.current.setOptions({ hardCenterXPx: (tw + aw) / 2 })
      } catch { /* noop */ }
    }
    try { ts.subscribeSizeChange(onSize) } catch { return undefined }
    onSize()  // sync once on (re)subscribe
    return () => { try { ts.unsubscribeSizeChange(onSize) } catch { /* noop */ } }
  }, [chartReady, centerWatermarkOnPlot])

  const indexPaneSeriesRef = useRef(null) // LineSeries for the index-comparison pane (Model Book ^IXIC)
  const indexMaSeriesRef = useRef(null)   // 50-period SMA line drawn on the index pane (matches the price chart's 50 SMA color)
  const indexScaleRef = useRef({ range: null, pin: false })  // fixed price range for the index pane's autoscaleInfoProvider (pins it steady across ticker switches; pin=false in Percent mode)
  const lastIndexSigRef = useRef(null)  // signature of the last-drawn index line/MA so we SKIP setData+relayout when flipping tickers in the same year (the index line is identical → no millisecond glitch)
  const volumeSeparatePaneRef = useRef(false)  // tracks current volume render mode so a toggle recreates the series in the right pane
  const indScaleRef = useRef({})               // per-indicator last price-scale id, so an overlay toggle recreates it in the right pane
  const overlaySeriesRefs = useRef([])
  const overlayTailSeriesRefs = useRef([])   // candleFrameFade: post-setup MA tail segments whose opacity crossfades on Setup⇄Result
  const frameFadeAlphaRef = useRef(1)        // mirror of frameFadeAlpha for the (deps-light) updateChart overlay loop
  const bbUpperRef    = useRef(null)
  const bbMiddleRef   = useRef(null)
  const bbLowerRef    = useRef(null)
  const vwapSeriesRef = useRef(null)
  const rsiSeriesRef  = useRef(null)
  const stochKRef     = useRef(null)
  const stochDRef     = useRef(null)
  const atrSeriesRef  = useRef(null)
  const sarSeriesRef  = useRef(null)
  const compareSeriesRef = useRef(null)
  const comparisonSeriesRefs = useRef(new Map()) // sym -> LineSeries (multi-symbol comparison overlays)
  const vpCanvasRef = useRef(null)
  const ichimokuTenkanRef = useRef(null)
  const ichimokuKijunRef  = useRef(null)
  const ichimokuSpanARef  = useRef(null)
  const ichimokuSpanBRef  = useRef(null)
  const ichimokuChikouRef = useRef(null)
  const macdLineRef   = useRef(null)
  const macdSignalRef = useRef(null)
  const macdHistRef   = useRef(null)
  const mfiSeriesRef       = useRef(null)
  const cciSeriesRef       = useRef(null)
  const williamsRSeriesRef = useRef(null)
  const adxSeriesRef       = useRef(null)
  const adxPlusDIRef       = useRef(null)
  const adxMinusDIRef      = useRef(null)
  const obvSeriesRef       = useRef(null)
  const donchianUpperRef   = useRef(null)
  const donchianMiddleRef  = useRef(null)
  const donchianLowerRef   = useRef(null)
  const priceLineRefs = useRef([])
  // Identity guard so updateChart doesn't tear down + rebuild price lines on
  // every real-time tick. mergedPriceLines is useMemo'd, so when its deps
  // (priceLines prop, j2 markers) are stable across ticks the reference is
  // stable too — skipping the rebuild saves significant LWC canvas work on
  // charts with many lines + axis labels (e.g. the GEX chart with 8-12).
  const lastPriceLinesRef = useRef(undefined)
  const markersControllerRef = useRef(null)  // lightweight-charts SeriesMarkers controller — must be reused/detached, not recreated
  const volMaSeriesRef = useRef(null)  // 50-MA line on the volume pane
  // Volume-pane height % last APPLIED via setStretchFactor. Gate re-applies on it
  // so a 30s data poll can't reset the pane and fight a user's separator drag; the
  // drag sampler compares the live pane % against it to detect a user resize.
  const lastAppliedVolPctRef = useRef(null)
  const volMaTailSeriesRef = useRef(null)  // candleFrameFade: post-setup tail of the volume MA (crossfades with everything else)
  const lastBarRef = useRef(null)
  const prevChartTypeRef = useRef(null)
  const zoomKeyRef = useRef(null)  // Track sym+tf to only zoom on initial load, not refetches
  const lastTfRef = useRef(null)   // Last resolved timeframe — distinguishes tf change from ticker switch
  const pendingTfReframeRef = useRef(null)  // Set to the new tf on a TF switch; forces the default-latest frame on every commit until the bar count settles (kills the "flip 5m→D snaps hard-left and never recovers" glitch)
  const lastBarCountRef = useRef(0) // Last bar count — lets a ticker switch right-anchor the preserved view
  const lastCfgSigRef = useRef(null) // A2: render-config signature at last paint — an incremental (last-bar-only) update is only safe when the config is byte-identical to the last paint
  const prevBarsRef = useRef(null) // Previous render's bars — used to measure outgoing vertical placement
  // True only while a Ctrl+drag measure is in progress — every handleScroll site
  // reads it so a data-poll re-applyOptions can't unlock the chart mid-measure.
  const measureLockRef = useRef(false)
  const focusRafRef = useRef(null)        // in-flight focus-zoom animation frame id
  const focusActiveRef = useRef(false)    // true while a setup-focus zoom owns the view (suppresses the year-range pin)
  const focusKeyRef = useRef(null)        // sym+tf the focus belongs to — a change releases focus back to the pin
  const lastFocusNonceRef = useRef(0)     // last processed focusNonce — only act when it actually changes
  const yearFramedRef = useRef(null)      // sym+tf the exact-range year frame has been rAF-reapplied for (first-load layout race)
  const yearRangeRef = useRef(null)       // latest {from,to} logical range for the framed year — re-asserts read this so staged data loads can't lock in stale indices
  const focusRangeRef = useRef(null)      // settled {from,to} logical range of the active setup-focus zoom — updateChart re-asserts this so a bars refetch can't snap the horizontal view back while the vertical stays pinned
  const focusPriceRangeRef = useRef(null) // {lo,hi} interpolated price range during a focus zoom (smooth vertical via autoscaleInfoProvider); null = default autoscale
  const focusProviderInstalledRef = useRef(false) // whether the candle series has the focus autoscale provider attached
  const textFadeRef = useRef(0)           // 0..1 opacity for setup TEXT annotations — driven by the focus zoom (Model Book): hidden zoomed out, eases in as it lands on a setup
  const exactPinSigRef = useRef(null)     // `${sym}_${tf}|${entryDate}|${exitDate}` last pinned exact-range frame — a same-chart date change (Setup ⇄ Result flip) glides instead of snapping
  const annRedrawRef = useRef(null)       // set by the annotation overlay; called right after an instant frame snap so the price-anchored lines re-resolve to the new mapping in the same frame (no 1-frame position pop)
  const hadHighlightRef = useRef(false)   // whether a gold highlight bar is currently applied (so we only clear when needed)
  const vertMarginsRef = useRef(null) // Captured proportional candle placement {top,bottom}; null = default headroom
  const latestLiveRef = useRef(null)  // Latest live price — used to re-apply after setData() wipes
  const liveBarRef = useRef(null)     // Developing bar OHLCV tracked tick-by-tick (survives setData)
  const lastServerCloseRef = useRef(null)  // Last close from CLEAN server bars — poison-proof live-tick baseline
  // ── colorByNetChange (TC2000/StockCharts coloring) ── Track the closes needed to
  // color the DEVELOPING bar on live ticks: netPrevCloseRef = close of the bar BEFORE
  // the current last bar (the developing bar's reference); lastNetCloseRef/lastNetTimeRef
  // track the current last bar so a live rollover to a NEW bar re-bases the reference.
  const netPrevCloseRef = useRef(null)
  const lastNetCloseRef = useRef(null)
  const lastNetTimeRef = useRef(null)
  // ── Phase C single-writer invariant (updated each render below the useRealtimeBars
  // call) ── When barsPushActiveRef.current is true, the Massive push writer is the SOLE
  // developing-bar writer; the Finnhub-fed writers early-return. A ref so writers read the
  // latest without re-subscribing.
  //
  // ⚠️ EVERY developing-bar writer MUST consult this flag — the FOUR that exist today, and
  // any FIFTH one added later. A writer that forgets the guard dual-writes or paints the
  // wrong candle — exactly how the Heikin-Ashi raw-candle bug shipped (retro audit 2026-07-06).
  // The four writer sites (grep `barsPushActiveRef` to find them; keep these refs ~in sync):
  //   • Writer A — livePrices tick effect      (~L2748):  if (barsPushActiveRef.current) return
  //   • Writer B — onRealtimeBar, Massive push (~L2890):  if (!barsPushActiveRef.current) return  ← B IS the writer
  //   • Writer C — realtimeCandle registry     (~L5785):  if (barsPushActiveRef.current) return
  //   • Writer D — post-setData re-top         (~L3336):  branch — push-owned re-top vs Finnhub re-top
  const barsPushActiveRef = useRef(false)
  const barStartVolRef = useRef(0)    // Cumulative volume at start of current bar (for per-bar delta)
  // Session preview owns the D/W/M developing bar during pre/post market on the
  // workspace (synthetic pre-market candle / frozen-at-4pm regular candle) — a
  // 5th writer-ownership condition alongside barsPushActive. Writers A + D read
  // this ref to yield the D/W/M last bar to the memo-driven setData.
  const sessionOwnsDailyRef = useRef(false)
  const sessionViewRef = useRef(sessionView)  // latest sessionView, read by live-tick writers

  // ── Extended hours (single toggle: pre/post shading AND price data) ──
  // Driven by the ONE `extendedHoursShading` chart setting (labeled "Extended
  // hours" in the UI). ON = pre/post-market candles + shading show; OFF = only
  // the regular session (9:30–4:00 ET) renders on intraday charts, with overnight
  // gaps — the pre/post PRICE DATA is filtered out, not just the shading.
  // handleToggleExtended (the toolbar EXT/RTH button) is defined just below,
  // after handleUpdateChartSettings, and writes the same setting.
  const showExtended = cs.extendedHoursShading ?? true
  // Latest showExtended, read by the live-tick writers (which are callbacks and
  // would otherwise close over a stale value). When false (RTH), the live path
  // must not paint pre/post-market intraday bars — mirroring the sessionBars fetch
  // filter — or the current ext session leaks onto an RTH-only chart.
  const showExtendedRef = useRef(showExtended)
  showExtendedRef.current = showExtended

  // ── Drawing tools state ──
  // ── Crosshair legend state ──
  const [crosshairData, setCrosshairData] = useState(null)
  const legendHoveringRef = useRef(false)
  // Fastest available developing-bar close, written imperatively (NO re-render)
  // from the Massive bars WS — the SAME reliable feed the theme tracker + header
  // gain use. computeLatestCrosshair prefers this so the legend's price / change
  // match the theme tracker instead of the laggy Finnhub feed.
  const liveTickRef = useRef(null)
  // Build the legend payload for the LATEST bar (used when the cursor is off the
  // chart and alwaysShowLegend is on). Reads live refs; safe to call from effects.
  const computeLatestCrosshair = () => {
    const bars = prevBarsRef.current
    if (!bars || !bars.length) return null
    const last = bars[bars.length - 1]
    let o = last.o, h = last.h, l = last.l
    let c = last.c
    // Prefer the live developing bar the CANDLE is showing (lastBarRef), so the
    // legend tracks the candle exactly rather than a separate/stale source.
    const lb = lastBarRef.current
    if (lb && lb.time === adjustTime(last.t) && Number.isFinite(lb.close)) {
      o = lb.open; h = lb.high; l = lb.low; c = lb.close
    }
    const lp = livePricesRef.current?.[symRef.current]
    // Fast Massive tick (ref, no re-render) wins for the close when RECENT +
    // sane — this makes the legend tick as fast as the theme tracker. When the
    // Massive feed gaps (periodic ~15s), fall back to the always-fresh Finnhub
    // price so the legend never freezes.
    const ft = liveTickRef.current
    const fastFresh = ft && ft.price != null && (Date.now() - ft.ts) < LIVE_TICK_FRESH_MS
    // Regular/RTH-only mode during an extended session: the developing candle is
    // frozen at the RTH close, so keep the LEGEND on it too — don't fold the live
    // pre/post-market price into close/high/low (else the legend disagrees with the
    // frozen candle). D/W/M keys off sessionView; intraday off the EXT/RTH toggle.
    const _nowMin = etMinutes(Math.floor(Date.now() / 1000))
    const _nowExt = _nowMin < 570 || _nowMin >= 960
    const _isDWMtf = ['D', 'W', 'M'].includes(resolvedTfRef.current)
    const _rthLock = _nowExt && (
      (_isDWMtf && sessionViewRef.current === 'regular')
      || (!_isDWMtf && !showExtendedRef.current)
    )
    if (_rthLock) {
      // keep c / h / l from the frozen RTH bar
    } else if (fastFresh && isSaneLivePrice(ft.price, c, lastServerCloseRef.current)) {
      c = ft.price
      if (Number.isFinite(h)) h = Math.max(h, ft.price)
      if (Number.isFinite(l)) l = Math.min(l, ft.price)
    } else if (lp?.price && isSaneLivePrice(lp.price, c, lastServerCloseRef.current)) {
      c = lp.price
    }
    let vol = last.v
    if ((!vol || vol === 0) && lp?.volume) vol = lp.volume
    // Change is close-vs-PREVIOUS-BAR-close ON THE CURRENT TIMEFRAME, so the
    // legend reflects the selected TF (weekly = vs last week, 5m = vs the prior
    // 5m bar), not always "today". DAILY is the special case where the prior bar
    // IS yesterday, so there we prefer the live feed's OFFICIAL prev_close to
    // match the theme tracker / brokers exactly. `c` is the live price.
    const feedPrev = (lp && Number.isFinite(lp.prev_close) && lp.prev_close > 0) ? lp.prev_close : null
    const prevBar = bars.length >= 2 ? bars[bars.length - 2] : null
    const prevBarClose = (prevBar && prevBar.c != null) ? prevBar.c : null
    const prevClose = (resolvedTfRef.current === 'D')
      ? (feedPrev ?? prevBarClose)
      : (prevBarClose ?? feedPrev)
    const change = prevClose != null ? c - prevClose : c - o
    const changePct = (prevClose != null && prevClose) ? (change / prevClose) * 100 : (o ? (change / o) * 100 : 0)
    const ovData = overlayDataRef.current || []
    const rovs = resolvedOverlaysRef.current || []
    const overlays = rovs.map((ov, i) => {
      const d = ovData[i]?.data
      const pt = (d && d.length) ? d[d.length - 1] : null
      if (!pt || !ov) return null
      const color = (ema9MatchCandle && ov.type === 'EMA' && Number(ov.period) === 9) ? mbUp : ov.color
      return { label: `${ov.type} ${ov.period}`, value: pt.value, color }
    }).filter(Boolean)
    return {
      time: last.t, open: o, high: h, low: l, close: c, volume: vol,
      change: change.toFixed(2), changePct: changePct.toFixed(2),
      overlays, rsi: null, macd: null, macdSig: null, stochK: null, stochD: null,
      atr: null, sar: null, ichimokuTenkan: null, ichimokuKijun: null, compare: null,
    }
  }
  const crosshairSubRef = useRef(null)
  const crosshairRafRef = useRef(null)
  const crosshairParamRef = useRef(null)
  // True while we're applying an externally-synced crosshair, so the resulting
  // (point-less) crosshair event doesn't echo a clear back to the sync bus.
  const applyingExternalRef = useRef(false)
  // Refs mirror rapidly-changing values so the crosshair handler can read
  // current data without forcing a tear-down+resubscribe on every tick.
  // Without this, useRealtimeBars updates → bars change → indicatorData
  // re-memoizes → crosshair useEffect re-runs → unsubscribe/subscribe cycle
  // happens on every live tick, causing visible crosshair stutter.
  // Refs initialize to null — the dedicated mirror useEffect below populates
  // them on the first commit, BEFORE the user can hover the chart. Cannot
  // initialize them to the actual values here because most are declared
  // (useMemo) later in the function body — using them at this point would
  // hit a TDZ ReferenceError.
  const overlayDataRef = useRef(null)
  const indicatorDataRef = useRef(null)
  const comparisonDataRef = useRef(null)
  const livePricesRef = useRef(null)
  const resolvedTfRef = useRef(null)   // current tf, for the imperative daily-candle fast writer (writer E)
  const resolvedOverlaysRef = useRef(null)
  const symRef = useRef(null)
  const onCrosshairMoveRef = useRef(null)

  const [activeTool, setActiveTool] = useState(null)
  const activeToolRef = useRef(activeTool)
  activeToolRef.current = activeTool
  const [positionTool, setPositionTool] = useState({ entry: '', stop: '', target: '', risk: 200, direction: 'long' })
  const positionPriceLines = useRef([])
  const [drawColor, setDrawColor] = useState(cs.drawingDefaults.color)
  const [drawWidth, setDrawWidth] = useState(cs.drawingDefaults.width)
  const [magnet, setMagnet] = useState(false)  // snap drawings to nearest O/H/L/C
  const [selectedId, setSelectedId] = useState(null)
  const [repeatMode, setRepeatMode] = useState(() => {
    // Default OFF: after placing a drawing the tool reverts to no-tool, so you can
    // immediately hover-and-drag annotations without clicking the cursor button.
    // Users who explicitly enabled repeat (localStorage 'true') keep it.
    try { return localStorage.getItem('uct-draw-repeat') === 'true' } catch { return false }
  })
  const handleSetRepeatMode = useCallback((val) => {
    setRepeatMode(val)
    try { localStorage.setItem('uct-draw-repeat', val ? 'true' : 'false') } catch {}
  }, [])
  const handleUpdateChartSettings = useCallback((newSettings) => {
    setPref('chart_settings', JSON.stringify(newSettings))
  }, [setPref])

  // Toolbar EXT/RTH button — flips the same "Extended hours" setting the settings
  // panel toggles, so both stay in lockstep (one logical state, two entry points).
  const handleToggleExtended = useCallback((val) => {
    handleUpdateChartSettings({ ...cs, extendedHoursShading: val, preset: 'custom' })
  }, [cs, handleUpdateChartSettings])

  // ── Region-aware right-click menu: build settings sections per region ──
  // Imperative handle to ChartToolbar so a menu item can open its settings
  // panel. Refs are stable, so the builder below can stay pure-ish.
  const toolbarRef = useRef(null)
  // addDrawing is created later (useChartDrawings, below); bridge via ref so a
  // menu item can draw a horizontal line at the clicked price.
  const addDrawingRef = useRef(null)
  const buildRegionSections = useCallback((region, clickPrice) => {
    const setCs = (path, value) => {
      const next = { ...cs }
      const parts = path.split('.')
      if (parts.length === 3) {
        const [a, b, c] = parts
        next[a] = { ...next[a], [b]: { ...next[a][b], [c]: value } }
      } else if (parts.length === 2) {
        const [a, b] = parts
        next[a] = { ...next[a], [b]: value }
      } else {
        next[path] = value
      }
      next.preset = 'custom'
      handleUpdateChartSettings(next)
    }
    const openSettings = () => { try { toolbarRef.current?.openSettings() } catch {} }
    // Reset view: reframe to the timeframe's default window (Daily on the workspace
    // = dailyDefaultBars ≈ 6 months), newest candle anchored at LAST_CANDLE_POS —
    // NOT LWC's resetTimeScale() (which fit-all-ed to ~1 year). Falls back to
    // resetTimeScale when there aren't enough bars to frame.
    const resetView = () => {
      try {
        const ts = chartRef.current?.timeScale(); if (!ts) return
        const len = lastBarCountRef.current || 0
        if (len > 1) {
          const { from, to } = computeDefaultLogicalRange(len, resolvedTf, { dailyDefaultBars, leftBarPad, rightPadBars })
          ts.setVisibleLogicalRange({ from, to })
        } else {
          ts.resetTimeScale()
        }
      } catch {}
    }
    const autoScale = () => {
      try {
        // Clear any locked vertical placement and restore the default candle band.
        vertMarginsRef.current = null
        mainPriceScale()?.applyOptions({
          autoScale: true,
          scaleMargins: _mainMargins(cs, showVolume && volData.length > 0 && !volInSeparatePane, priceScaleTopMargin, volInSeparatePane ? priceScaleBottomMargin : null),
        })
      } catch {}
    }
    const settingsLink = (id, label) =>
      showDrawingTools ? [{ id, label, onSelect: openSettings }] : []

    // Price-level + picker helpers (used by the price area / axis regions).
    const hasPrice = Number.isFinite(clickPrice)
    const fmtPrice = (p) => (p >= 1 ? p.toFixed(2) : p.toFixed(4))
    const drawLineItem = hasPrice ? {
      id: 'draw-hline',
      label: <><UIcon name="ruler" size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />{`Draw line at $${fmtPrice(clickPrice)}`}</>,
      onSelect: () => { try { addDrawingRef.current?.({ type: 'horizontal', points: [{ price: clickPrice }], color: cs.drawingDefaults?.color || '#c9a84c', lineWidth: cs.drawingDefaults?.width || 1 }) } catch {} },
    } : null
    const copyPriceItem = hasPrice ? {
      id: 'copy-price',
      label: <><UIcon name="copy" size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />{`Copy $${fmtPrice(clickPrice)}`}</>,
      onSelect: () => { try { navigator.clipboard?.writeText(fmtPrice(clickPrice)) } catch {} },
    } : null
    const priceActions = hasPrice
      ? [{ id: 'priceactions', title: `At $${fmtPrice(clickPrice)}`, items: [drawLineItem, copyPriceItem] }]
      : []
    const TF_OPTS = [['1', '1m'], ['5', '5m'], ['15', '15m'], ['30', '30m'], ['60', '1h'], ['D', '1D'], ['W', '1W'], ['M', '1M']]
    const CT_OPTS = [['candles', 'Candles'], ['hollow', 'Hollow'], ['bars', 'Bars'], ['line', 'Line'], ['area', 'Area']]
    const tfSection = typeof onTfChange === 'function' ? {
      id: 'tf', title: 'Timeframe',
      items: TF_OPTS.map(([code, label]) => ({ id: 'tf-' + code, label, kind: 'toggle', checked: resolvedTf === code, onSelect: () => onTfChange(code) })),
    } : null
    const ctSection = {
      id: 'ctype', title: 'Chart type',
      items: CT_OPTS.map(([val, label]) => ({ id: 'ct-' + val, label, kind: 'toggle', checked: (cs.chartType || 'candles') === val, onSelect: () => setCs('chartType', val) })),
    }
    const IND_OPTS = [['rsi', 'RSI'], ['macd', 'MACD'], ['bb', 'Bollinger Bands'], ['vwap', 'VWAP'], ['stoch', 'Stochastic'], ['atr', 'ATR'], ['obv', 'OBV'], ['adx', 'ADX']]
    const indicatorsItem = {
      id: 'indicators', label: <><UIcon name="breadth" size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />Indicators</>, kind: 'submenu',
      submenu: IND_OPTS.map(([key, label]) => ({
        id: 'ind-' + key, label, kind: 'toggle', checked: !!cs.indicators?.[key]?.enabled,
        onSelect: () => setCs(`indicators.${key}.enabled`, !cs.indicators?.[key]?.enabled),
      })),
    }
    // "Overlay on volume": move an enabled oscillator into the volume pane
    // (left axis) instead of its own band. Only sub-pane oscillators that are
    // currently ON appear (BB/VWAP live on the price scale and can't overlay).
    const OSC_OPTS = [['rsi', 'RSI'], ['macd', 'MACD'], ['stoch', 'Stochastic'], ['atr', 'ATR'], ['mfi', 'MFI'], ['cci', 'CCI'], ['williamsR', 'Williams %R'], ['adx', 'ADX'], ['obv', 'OBV']]
    const volOverlayCur = Array.isArray(cs.volumeOverlayIndicators) ? cs.volumeOverlayIndicators : []
    const enabledOsc = OSC_OPTS.filter(([key]) => !!cs.indicators?.[key]?.enabled)
    const volumeOverlayItem = (showVolumeProp === undefined && cs.volume?.visible && enabledOsc.length) ? {
      id: 'voloverlay', label: <><UIcon name="link" size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />Overlay on volume</>, kind: 'submenu',
      submenu: enabledOsc.map(([key, label]) => ({
        id: 'vo-' + key, label, kind: 'toggle', checked: volOverlayCur.includes(key),
        onSelect: () => setCs('volumeOverlayIndicators', volOverlayCur.includes(key)
          ? volOverlayCur.filter((k) => k !== key)
          : [...volOverlayCur, key]),
      })),
    } : null

    const secs = []

    if (region.type === 'volume') {
      const items = []
      if (showVolumeProp === undefined) {
        items.push({ id: 'v-show', label: 'Show volume', kind: 'toggle', checked: !!cs.volume.visible, onSelect: () => setCs('volume.visible', !cs.volume.visible) })
      }
      items.push({ id: 'v-sep', label: 'Separate pane', kind: 'toggle', checked: !!cs.volume.separatePane, onSelect: () => setCs('volume.separatePane', !cs.volume.separatePane) })
      items.push({ id: 'v-hvc', label: 'HVC highlight', kind: 'toggle', checked: !!cs.volume.hvcEnabled, onSelect: () => setCs('volume.hvcEnabled', !cs.volume.hvcEnabled) })
      if (volumeOverlayItem) items.push(volumeOverlayItem)
      items.push(...settingsLink('v-set', 'Volume settings…'))
      secs.push({ id: 'region', title: 'Volume', items })
    } else if (region.type === 'indicator') {
      const key = region.key
      const label = INDICATOR_LABELS[key] || key
      secs.push({ id: 'region', title: label, items: [
        { id: 'i-hide', label: `Hide ${label}`, kind: 'toggle', checked: true, onSelect: () => setCs(`indicators.${key}.enabled`, false) },
        ...settingsLink('i-set', `${label} settings…`),
      ] })
    } else if (region.type === 'overlay') {
      const ov = resolvedOverlays?.[region.index]
      const label = ov ? `${ov.type} ${ov.period}` : 'Moving average'
      const csIndex = ov ? cs.overlays.indexOf(ov) : -1
      const items = []
      if (csIndex >= 0) {
        items.push({ id: 'o-hide', label: `Hide ${label}`, kind: 'toggle', checked: true, onSelect: () => {
          const next = { ...cs, overlays: cs.overlays.map((o, i) => i === csIndex ? { ...o, enabled: false } : o), preset: 'custom' }
          handleUpdateChartSettings(next)
        } })
      }
      items.push(...settingsLink('o-set', 'Moving averages…'))
      secs.push({ id: 'region', title: label, items })
    } else if (region.type === 'priceAxis') {
      secs.push(...priceActions)
      secs.push({ id: 'region', title: 'Price scale', items: [
        { id: 'p-log', label: 'Logarithmic scale', kind: 'toggle', checked: !!cs.logScale, onSelect: () => setCs('logScale', !cs.logScale) },
        { id: 'p-auto', label: 'Auto-scale', onSelect: autoScale },
      ] })
    } else if (region.type === 'timeAxis') {
      // Reset view comes from the common section below; nothing region-specific.
    } else {
      // Open price area.
      secs.push(...priceActions)
      const items = [
        { id: 'pr-log', label: 'Logarithmic scale', kind: 'toggle', checked: !!cs.logScale, onSelect: () => setCs('logScale', !cs.logScale) },
        { id: 'pr-magnet', label: 'Magnet crosshair', kind: 'toggle', checked: !!cs.crosshair?.magnet, onSelect: () => setCs('crosshair.magnet', !cs.crosshair?.magnet) },
      ]
      if (['1', '5', '15', '30', '60'].includes(resolvedTf)) {
        items.push({ id: 'pr-eh', label: 'Extended hours', kind: 'toggle', checked: !!cs.extendedHoursShading, onSelect: () => setCs('extendedHoursShading', !cs.extendedHoursShading) })
      }
      items.push({ id: 'pr-swing', label: 'Swing price labels', kind: 'toggle', checked: !!cs.swingLabels?.enabled, onSelect: () => setCs('swingLabels.enabled', !cs.swingLabels?.enabled) })
      if (showVolumeProp === undefined && !cs.volume.visible) {
        items.push({ id: 'pr-vol', label: 'Show volume', kind: 'toggle', checked: false, onSelect: () => setCs('volume.visible', true) })
      }
      items.push(indicatorsItem)
      if (volumeOverlayItem) items.push(volumeOverlayItem)
      secs.push({ id: 'region', title: 'Chart', items })
      if (tfSection) secs.push(tfSection)
      secs.push(ctSection)
    }

    // Common view section — always present.
    const viewItems = [{ id: 'reset', label: 'Reset view', onSelect: resetView }]
    if (showDrawingTools) {
      viewItems.push({ id: 'hide-draw', label: 'Hide drawings', kind: 'toggle', checked: !!cs.hideDrawings, onSelect: () => setCs('hideDrawings', !cs.hideDrawings) })
    }
    viewItems.push(...settingsLink('chart-set', 'Chart settings…'))
    secs.push({ id: 'view', items: viewItems })

    return secs
  }, [cs, handleUpdateChartSettings, showDrawingTools, showVolumeProp, resolvedOverlays, resolvedTf, onTfChange])

  // ── Pattern overlay state (Phase 5 Tasks 1, 3, 4) ──
  // Toggle persists via chart_settings (usePreferences). Local UI state mirrors
  // the persisted flag so toggle feels instant; handleTogglePatterns writes through.
  const persistedShowPatterns = !!cs.showPatterns
  const [showPatterns, setShowPatterns] = useState(persistedShowPatterns)
  useEffect(() => { setShowPatterns(persistedShowPatterns) }, [persistedShowPatterns])
  const handleTogglePatterns = useCallback((next) => {
    setShowPatterns(next)
    handleUpdateChartSettings({ ...cs, showPatterns: next, preset: 'custom' })
  }, [cs, handleUpdateChartSettings])
  const [activeDetection, setActiveDetection] = useState(null)
  const { detections: patternDetections } = usePatternDetections(sym, resolvedTf, showPatterns, 50)

  // ── Screenshot + Share state ──
  const [screenshotPopoverOpen, setScreenshotPopoverOpen] = useState(false)
  const lastPriceRef = useRef(null)
  const lastChangePctRef = useRef(null)

  const handleDownload = useCallback(async () => {
    if (!chartRef.current) return
    try {
      const blob = await composeScreenshot(chartRef.current, {
        sym, tf: resolvedTf, price: lastPriceRef.current, changePct: lastChangePctRef.current,
      })
      const filename = `${sym || 'chart'}-${resolvedTf}-${new Date().toISOString().slice(0, 10)}.png`
      downloadBlob(blob, filename)
    } catch (err) {
      console.warn('Screenshot failed:', err)
    }
  }, [sym, resolvedTf])

  const handleCopyImage = useCallback(async () => {
    if (!chartRef.current) return false
    try {
      const blob = await composeScreenshot(chartRef.current, {
        sym, tf: resolvedTf, price: lastPriceRef.current, changePct: lastChangePctRef.current,
      })
      return await copyBlobToClipboard(blob)
    } catch (err) {
      console.warn('Copy failed:', err)
      return false
    }
  }, [sym, resolvedTf])

  const handleCopyShareUrl = useCallback(() => {
    const state = {
      sym,
      tf: resolvedTf,
      chartType: cs.chartType,
      heikinAshi: cs.heikinAshi,
      logScale: cs.logScale,
      indicators: {
        rsi: { enabled: cs.indicators?.rsi?.enabled },
        macd: { enabled: cs.indicators?.macd?.enabled },
        bb: { enabled: cs.indicators?.bb?.enabled },
        vwap: { enabled: cs.indicators?.vwap?.enabled },
      },
      comparisonSymbols: cs.comparisonSymbols || [],
      markers: cs.markers || {},
    }
    const encoded = chartStateToUrl(state)
    const url = `${window.location.origin}${window.location.pathname}?state=${encoded}`
    try {
      navigator.clipboard.writeText(url)
    } catch {}
  }, [sym, resolvedTf, cs])

  // ── Apply share-URL chart state on mount ──
  // Reads ?state=<encoded> once on mount. If absent, skips silently.
  // If parse fails, logs warning and skips. NEVER includes `cs` in deps —
  // would re-fire and overwrite user-driven changes.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const encoded = params.get('state')
      if (!encoded) return
      const decoded = urlToChartState(encoded)
      if (!decoded) return
      const next = {
        ...cs,
        ...(decoded.chartType ? { chartType: decoded.chartType } : {}),
        ...(typeof decoded.heikinAshi === 'boolean' ? { heikinAshi: decoded.heikinAshi } : {}),
        ...(typeof decoded.logScale === 'boolean' ? { logScale: decoded.logScale } : {}),
        ...(decoded.indicators ? { indicators: { ...cs.indicators, ...decoded.indicators } } : {}),
        ...(decoded.comparisonSymbols ? { comparisonSymbols: decoded.comparisonSymbols } : {}),
        ...(decoded.markers ? { markers: { ...cs.markers, ...decoded.markers } } : {}),
        preset: 'custom',
      }
      handleUpdateChartSettings(next)
      if (decoded.sym && decoded.sym !== sym && typeof onSymbolChange === 'function') {
        onSymbolChange(decoded.sym)
      }
      if (decoded.tf && decoded.tf !== resolvedTf && typeof onTfChange === 'function') {
        onTfChange(decoded.tf)
      }
    } catch (err) {
      console.warn('Failed to apply share URL state:', err)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const { drawings, addDrawing, removeDrawing, updateDrawing, clearAll, reorderDrawing, undo, redo, snapshotHistory, canUndo, canRedo } = useChartDrawings(sym)
  addDrawingRef.current = addDrawing

  // ── Annotation CRUD (Model Book) — operate on the `annotations` prop and
  // bubble the new array to the parent via onAnnotationsChange (no localStorage).
  const annAdd = useCallback((d) => {
    const id = crypto.randomUUID()
    onAnnotationsChange?.([...(annotations || []), { ...d, id }])
    return id
  }, [annotations, onAnnotationsChange])
  const annUpdate = useCallback((id, updates) => {
    onAnnotationsChange?.((annotations || []).map(d => (d.id === id ? { ...d, ...updates } : d)))
  }, [annotations, onAnnotationsChange])
  const annRemove = useCallback((id) => {
    onAnnotationsChange?.((annotations || []).filter(d => d.id !== id))
  }, [annotations, onAnnotationsChange])
  const annClear = useCallback(() => { onAnnotationsChange?.([]) }, [onAnnotationsChange])
  // Setup Library text-annotation fade. No focus zoom runs here to drive textFadeRef,
  // so drive it directly off the Setup⇄Result toggle: snap on mount (text shows
  // immediately), ease over ~260ms on a later toggle (fade out on Result, back in on
  // Setup). Inert when annotationsTextVisible is null (Model Book keeps the zoom path).
  const annTextFadeRafRef = useRef(null)
  const annTextSeenRef = useRef(false)
  useEffect(() => {
    if (annotationsTextVisible == null) return
    const target = annotationsTextVisible ? 1 : 0
    if (!annTextSeenRef.current) { annTextSeenRef.current = true; textFadeRef.current = target; return }
    const from = textFadeRef.current ?? 0
    if (annTextFadeRafRef.current != null) cancelAnimationFrame(annTextFadeRafRef.current)
    if (from === target) { textFadeRef.current = target; return }
    const t0 = performance.now()
    const dur = 260
    const ease = x => -(Math.cos(Math.PI * x) - 1) / 2  // easeInOutSine
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur)
      textFadeRef.current = from + (target - from) * ease(p)
      if (p < 1) annTextFadeRafRef.current = requestAnimationFrame(step)
      else { textFadeRef.current = target; annTextFadeRafRef.current = null }
    }
    annTextFadeRafRef.current = requestAnimationFrame(step)
    return () => { if (annTextFadeRafRef.current != null) { cancelAnimationFrame(annTextFadeRafRef.current); annTextFadeRafRef.current = null } }
  }, [annotationsTextVisible])
  // Index-pane annotation CRUD (GLOBAL ^IXIC measure marks) — mirrors annAdd/etc.
  // but bubbles through onIndexAnnotationsChange. Its own activeTool/selection so
  // it never fights the price-pane drawing state.
  const [indexActiveTool, setIndexActiveTool] = useState('advance')
  const [indexSelectedId, setIndexSelectedId] = useState(null)
  const idxAnnAdd = useCallback((d) => {
    const id = crypto.randomUUID()
    onIndexAnnotationsChange?.([...(indexAnnotations || []), { ...d, id }])
    return id
  }, [indexAnnotations, onIndexAnnotationsChange])
  const idxAnnUpdate = useCallback((id, updates) => {
    onIndexAnnotationsChange?.((indexAnnotations || []).map(d => (d.id === id ? { ...d, ...updates } : d)))
  }, [indexAnnotations, onIndexAnnotationsChange])
  const idxAnnRemove = useCallback((id) => {
    onIndexAnnotationsChange?.((indexAnnotations || []).filter(d => d.id !== id))
  }, [indexAnnotations, onIndexAnnotationsChange])
  const idxAnnClear = useCallback(() => { onIndexAnnotationsChange?.([]) }, [onIndexAnnotationsChange])
  // Current line style for NEW annotation lines; also re-styles the selected line.
  const [drawLineStyle, setDrawLineStyle] = useState('solid')
  const setAnnLineStyle = useCallback((style) => {
    setDrawLineStyle(style)
    if (selectedId) annUpdate(selectedId, { lineStyle: style })
  }, [selectedId, annUpdate])
  // Text annotation font size — applies to new text and (if a text drawing is
  // selected) the selected one.
  const [drawFontSize, setDrawFontSize] = useState(13)
  const setAnnFontSize = useCallback((size) => {
    setDrawFontSize(size)
    if (selectedId) annUpdate(selectedId, { fontSize: size })
  }, [selectedId, annUpdate])

  // ── Position tool price lines ──
  useEffect(() => {
    const cs2 = candleSeriesRef.current
    if (!cs2) return
    for (const pl of positionPriceLines.current) {
      try { cs2.removePriceLine(pl) } catch {}
    }
    positionPriceLines.current = []
    if (activeTool !== 'position') return
    const { entry, stop, target } = positionTool
    const e = parseFloat(entry), s = parseFloat(stop), t = parseFloat(target)
    const acct = parseFloat(cs.positionCalc?.accountSize) || 0
    const riskPct = parseFloat(cs.positionCalc?.riskPct) || 0
    const riskPerShare = (e > 0 && s > 0) ? Math.abs(e - s) : 0
    const rewardPerShare = (e > 0 && t > 0) ? Math.abs(t - e) : 0
    const maxRisk = (acct * riskPct) / 100
    const shares = riskPerShare > 0 ? Math.floor(maxRisk / riskPerShare) : 0
    const rrRatio = riskPerShare > 0 ? rewardPerShare / riskPerShare : 0
    const entryTitle = shares > 0 ? `Entry · ${shares.toLocaleString()} sh` : 'Entry'
    const stopTitle = (shares > 0 && riskPerShare > 0) ? `Stop · -$${Math.round(shares * riskPerShare).toLocaleString()}` : 'Stop'
    const targetTitle = (shares > 0 && rewardPerShare > 0)
      ? `Target · +$${Math.round(shares * rewardPerShare).toLocaleString()} · 1:${rrRatio.toFixed(2)}R`
      : 'Target'
    if (e > 0) positionPriceLines.current.push(cs2.createPriceLine({ price: e, color: '#60a5fa', lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: entryTitle }))
    if (s > 0) positionPriceLines.current.push(cs2.createPriceLine({ price: s, color: '#f87171', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: stopTitle }))
    if (t > 0) positionPriceLines.current.push(cs2.createPriceLine({ price: t, color: '#4ade80', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: targetTitle }))
  }, [activeTool, positionTool, cs.positionCalc?.accountSize, cs.positionCalc?.riskPct])

  // ── Cleanup position lines on tool deactivation/unmount ──
  useEffect(() => {
    return () => {
      const cs2 = candleSeriesRef.current
      if (!cs2) return
      for (const pl of positionPriceLines.current) {
        try { cs2.removePriceLine(pl) } catch {}
      }
      positionPriceLines.current = []
    }
  }, [])

  // ── Position tool: auto-populate entry from last bar close when activated ──
  useEffect(() => {
    if (activeTool === 'position' && !positionTool.entry) {
      const lastBar = filteredBars?.at(-1)
      if (lastBar) setPositionTool(p => ({ ...p, entry: lastBar.c.toFixed(2) }))
    }
  }, [activeTool]) // eslint-disable-line react-hooks/exhaustive-deps

  // NOTE: the keyboard shortcuts, replay auto-advance, and replay-reset
  // useEffects were originally here but referenced `sessionBars`,
  // `replayMode`, `replayPlaying`, `replaySpeed`, and the replay setter
  // functions in their deps arrays — all declared further down the file.
  // Deps arrays evaluate immediately at the useEffect call site, so those
  // identifiers were in the temporal dead zone, throwing
  //   ReferenceError: Cannot access 'X' before initialization
  // on every render of any chart-bearing page (theme tracker, watchlists,
  // ticker pages, etc.). Moved below `filteredBars` declaration so all the
  // referenced consts exist before the deps arrays are evaluated.

  // Viewport-first payload (Phase 2): fetch a shallow window first (fetchDepth =
  // FIRST_PAINT_BARS), bump to the full target only when the user pans into deep
  // history (see the backfill effect below). Reset to shallow on sym/tf change
  // via a render-time key guard (React "adjust state on prop change" pattern).
  // Overlay modes (compare / index pane / multi-symbol comparisons) keep the
  // full fetch so their overlays align across the whole range.
  const [fetchDepth, setFetchDepth] = useState(FIRST_PAINT_BARS)
  const _depthKeyRef = useRef(null)
  const _fullTarget = fullBarsFor(resolvedTf)
  const _overlayActive = !!(
    compareSymbol || indexPaneSymbol ||
    (cs.comparisonSymbols || []).some(c => c && c.enabled && c.sym)
  )
  const _depthKey = `${sym}_${resolvedTf}`
  if (_depthKeyRef.current !== _depthKey) {
    _depthKeyRef.current = _depthKey
    if (fetchDepth !== FIRST_PAINT_BARS) setFetchDepth(FIRST_PAINT_BARS)
  }
  // Pinned book charts (entryDate / exactDateRange) frame a specific historical
  // year that the shallow first-paint window can miss entirely (a 2020 example
  // would silently frame "now"), and they skip the pan-to-backfill path — so
  // they must fetch the full depth up front.
  const _pinnedFull = !!(entryDate || exactDateRange)
  const barCount = (_overlayActive || _pinnedFull) ? _fullTarget : fetchDepth

  // Intraday refetches more often to keep candles current during market hours
  const isIntraday = ['1', '5', '15', '30', '60'].includes(resolvedTf)
  const dedupMs = isIntraday ? 15000 : 60000  // 15s intraday, 60s daily/weekly

  // ── IndexedDB layer — instant renders on repeat visits ────────────────────
  // On every sym/tf change: read IDB (~0 ms) BEFORE firing SWR.
  // idbSinceRef holds the last cached `t` value as a ref (not state) so
  // the SWR URL is stable after the first fire — prevents the double-fetch
  // that would occur if `since` were state and changed after IDB resolved.
  //
  // CRITICAL: idbReadyForRef tracks WHICH sym+tf the IDB state currently
  // belongs to. State updates (setIdbLoaded etc.) are async; on a sym/tf
  // change the FIRST render after the click still sees stale idbLoaded=true
  // and stale idbSinceRef from the previous ticker. Without this gate,
  // swrUrl would be computed as `/api/bars/NEW?since=<OLD's lastT>`, the
  // backend returns an empty delta, mergeDelta(OLD_bars, []) = OLD_bars,
  // and we idbPut(NEW, OLD_bars) — corrupting IDB so NEW chart shows OLD
  // ticker's data forever. This is the "blended" data bug.
  const [idbBars, setIdbBars]   = useState(null)
  const [idbLoaded, setIdbLoaded] = useState(false)
  const idbSinceRef     = useRef(null)
  const idbReadyForRef  = useRef(null)  // string `${sym}_${tf}` once IDB load completes
  // TEMP DIAGNOSTIC (window.__uctBarsDebug) — the sym this chart last PAINTED, so
  // updateChart can log ticker transitions. Captures the "random chart appears for
  // a blip then goes away when switching to BLZE with a 2nd widget" report: a blip
  // shows up as an unexpected paint-sym transition sequence (e.g. A -> X -> BLZE).
  const paintSymRef = useRef(null)

  useEffect(() => {
    if (!sym || !resolvedTf) return
    setIdbBars(null)
    setIdbLoaded(false)
    idbSinceRef.current = null
    idbReadyForRef.current = null  // synchronous — invalidates the gate immediately
    const key = `${sym}_${resolvedTf}`
    idbGet(sym, resolvedTf).then(entry => {
      if (entry?.bars?.length) {
        setIdbBars(entry.bars)
        idbSinceRef.current = entry.lastT ?? null
      }
      idbReadyForRef.current = key
      setIdbLoaded(true)
    }).catch(() => { idbReadyForRef.current = key; setIdbLoaded(true) })
  }, [sym, resolvedTf])

  // SWR URL: only set if IDB state is for the CURRENT sym+tf. Stale idbLoaded
  // from a previous ticker (before the IDB effect runs) is rejected by the ref
  // check, preventing the cross-ticker mergeDelta corruption described above.
  //
  // For Daily/Weekly/Monthly: ALWAYS full-fetch (no `since`). Payloads are
  // ~16KB which is trivial, and any prior IDB entry might contain stale
  // intraday-snapshot OHLC for past days that delta-fetches (server filter
  // is strict `>` so older bars never re-request) cannot heal. With no
  // `since`, server returns full set, the merge branch evaluates delta=false
  // and OVERWRITES the IDB bars array with authoritative server values —
  // healing every prior-day stale bar in one shot. Symptom this fixes:
  // dashboard chart shows wrong H/C for past days (intraday peeks frozen
  // into IDB at whatever moment the user first opened the chart that day).
  //
  // For intraday: keep delta-fetch (payloads can be 400KB+ at 5000 bars)
  // but back off `since` by one second so the boundary bar gets re-fetched.
  // mergeDelta deduplicates by timestamp; fresh server value wins.
  // A cached intraday series whose newest bar is >~23h old is missing at
  // least the most recent session. The `since`-delta CAN heal it (server
  // is authoritative), but a rapid sym/tf flip drops the delta (the
  // sameSymTf race below) leaving the stale cache rendered with a live-
  // price "spike" bar fused onto week-old history — the exact artifact
  // seen in production on 5min. Force a full (no-`since`) refetch so the
  // response REPLACES idbBars with authoritative data (identical to the
  // technique already used for D/W/M above), and don't paint the stale
  // series meanwhile (brief spinner beats a wrong chart). 23h errs toward
  // full-fetch; only cost is one larger payload for already-fresh weekend
  // data — correctness over bandwidth.
  const idbStaleIntraday = isIntraday
    && typeof idbSinceRef.current === 'number'
    && (Date.now() / 1000 - idbSinceRef.current) > 23 * 3600
  let _sinceParam = null
  if (isIntraday && typeof idbSinceRef.current === 'number' && !idbStaleIntraday) {
    _sinceParam = Math.max(0, idbSinceRef.current - 1)
  }
  // Viewport-first backfill: once we've bumped PAST the shallow first-paint depth
  // (any progressive step, not only the full target), drop `since` so the server
  // returns the full (older) range. `since` only returns the newer tail, which
  // would never load the deep history the user panned to see — so a progressive
  // intermediate depth MUST also full-fetch or it would delta-fetch nothing. The
  // bar count grows and the existing same-ticker re-anchor holds the view steady.
  if (fetchDepth > FIRST_PAINT_BARS || _pinnedFull) _sinceParam = null
  // barsOverride (Model Book uploaded data) short-circuits all fetching.
  const _overrideArr = Array.isArray(barsOverride) && barsOverride.length > 0
  const _hasOverride = _overrideArr || barsOverridePending
  const swrUrl = _hasOverride
    ? null
    : ((sym && idbLoaded && idbReadyForRef.current === `${sym}_${resolvedTf}`)
        ? `/api/bars/${encodeURIComponent(sym)}?tf=${resolvedTf}&bars=${barCount}${_sinceParam != null ? `&since=${encodeURIComponent(String(_sinceParam))}` : ''}`
        : null)

  // Self-healing poll cadence: with no refreshInterval, the chart was frozen
  // at first-fetch data until the component unmounted. That trapped users on
  // partial sessions (the noon-cutoff symptom), masked silent WS drops, and
  // missed server-side bar corrections. 30s intraday is comfortably under
  // any one-tf threshold yet long enough that the in-flight request rate stays
  // bounded even with many charts open. D/W/M evolve slowly — 5min is enough.
  // refreshWhenHidden:false stops backgrounded tabs from burning ticks.
  const refreshInterval = isIntraday ? 30_000 : 300_000
  const { data, error, mutate } = useSWR(
    swrUrl,
    fetcher,
    {
      dedupingInterval: dedupMs,
      revalidateOnFocus: false,
      refreshInterval,
      refreshWhenHidden: false,
      onErrorRetry: barsSwrOnErrorRetry,
    }
  )

  // ── Comparison symbol SWR fetch ──
  const compareSwrUrl = compareSymbol
    ? `/api/bars/${encodeURIComponent(compareSymbol.toUpperCase())}?tf=${resolvedTf}&bars=${barCount}`
    : null
  const { data: compareData } = useSWR(compareSwrUrl, fetcher, { dedupingInterval: 60_000, revalidateOnFocus: false })

  // Persist to IDB and merge delta when SWR returns.
  useEffect(() => {
    if (!data?.bars || !sym || !resolvedTf) return
    // Guard against stale closure: if sym changed between fetch-start and resolve,
    // the server's `ticker` field reveals the mismatch — skip to avoid storing
    // e.g. AAPL bars under MSFT when the user switches tickers rapidly.
    if (data.ticker && data.ticker !== sym.toUpperCase()) return
    // Belt-and-suspenders: only merge if idbBars is known to belong to this sym+tf.
    // Without this, a delta response could merge with leftover bars from another
    // ticker still sitting in idbBars state (the cross-ticker race).
    const sameSymTf = idbReadyForRef.current === `${sym}_${resolvedTf}`
    // TEMP DIAGNOSTIC (enable in DevTools: window.__uctBarsDebug = true) — traces
    // the delta-sync path to find the "missing candles until ~10s later" stall on
    // a stale-cache revisit. Logs the since sent, the delta response, the cached
    // tail, and the merge outcome. Remove once the gap-fill delay is root-caused.
    const _dbg = typeof window !== 'undefined' && window.__uctBarsDebug
    if (_dbg) console.log('[bars-delta]', sym, resolvedTf,
      '| resp:', { delta: data.delta, n: data.bars.length, firstT: data.bars[0]?.t, lastT: data.bars[data.bars.length - 1]?.t },
      '| idb:', { n: idbBars?.length ?? 0, lastT: idbBars?.[idbBars.length - 1]?.t },
      '| sinceRef:', idbSinceRef.current, '| sameSymTf:', sameSymTf)
    if (data.delta && idbBars?.length && sameSymTf) {
      const merged = mergeDelta(idbBars, data.bars)
      // refreshInterval flicker guard: when the 30s poll returns no new bars
      // and no overlapping-timestamp updates (the common case during low-vol
      // hours), the merged array is referentially+structurally identical to
      // idbBars. Skipping setIdbBars + idbPut here keeps updateChart's setData
      // from firing — no 1-frame "blank → restored" gap on every poll.
      const lastIdb = idbBars[idbBars.length - 1]
      const lastMerged = merged[merged.length - 1]
      const sameLength = merged.length === idbBars.length
      const sameTail = lastIdb && lastMerged
        && lastIdb.t === lastMerged.t
        && lastIdb.c === lastMerged.c
        && lastIdb.h === lastMerged.h
        && lastIdb.l === lastMerged.l
        && lastIdb.v === lastMerged.v
      if (sameLength && sameTail) {
        if (_dbg) console.log('[bars-delta]', sym, resolvedTf, '=> SKIPPED (delta added nothing new; gap NOT filled)')
        return  // nothing changed — don't repaint
      }
      if (_dbg) console.log('[bars-delta]', sym, resolvedTf, `=> MERGED ${idbBars.length} -> ${merged.length}`)
      setIdbBars(merged)
      if (merged.length) idbSinceRef.current = merged[merged.length - 1].t
      idbPut(sym, resolvedTf, merged)
      memPut(sym, resolvedTf, merged)
    } else if (!data.delta && data.bars.length) {
      if (_dbg) console.log('[bars-delta]', sym, resolvedTf, `=> REPLACED (full) with ${data.bars.length}`)
      setIdbBars(data.bars)
      idbSinceRef.current = data.bars[data.bars.length - 1]?.t ?? null
      idbPut(sym, resolvedTf, data.bars)
      memPut(sym, resolvedTf, data.bars)
    }
  }, [data])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Background prefetch — all other timeframes when sym changes ───────────
  // After the primary chart loads, fetch every other TF into IDB so switching
  // timeframes is instant. Fetches run STRICTLY SEQUENTIAL (one at a time,
  // wait for previous to finish before starting next) — fixed-delay staggering
  // doesn't work because some TFs are slow (e.g. VIX 1min ≈ 7s due to yfinance
  // fallback) and end up overlapping anyway. Sequential = backend sees exactly
  // 1 prefetch in flight per chart at a time.
  //
  // Order: fast / common TFs first (D, W, M, 60, 30) so most TF switches are
  // already instant by the time the slow intraday TFs (15, 5, 1) get fetched.
  useEffect(() => {
    if (!sym) return
    const ORDER = ['D', 'W', 'M', '60', '30', '15', '5', '1']
    const tfs   = ORDER.filter(t => t !== resolvedTf)
    let cancelled = false

    async function runSequential() {
      // 600ms initial delay so the primary chart's fetch goes out alone first.
      await new Promise(r => setTimeout(r, 600))
      if (cancelled) return  // user may have switched tickers during the sleep
      for (const tf of tfs) {
        if (cancelled) return
        try {
          const entry = await idbGet(sym, tf)
          // A cached intraday entry whose newest bar is >23h old is
          // missing >=1 session — must refetch FULL (no since) so the
          // response replaces it, or this stale copy gets rendered later
          // with a fused live-price spike. Mirrors idbStaleIntraday.
          const _et = entry?.lastT
          const entryStaleIntraday = !['D', 'W', 'M'].includes(tf)
            && typeof _et === 'number'
            && (Date.now() / 1000 - _et) > 23 * 3600
          // Skip if IDB has fresh data (D/W: 24 h; intraday: 4 h) — but
          // never skip a stale intraday entry just because it was saved
          // recently (savedAt tracks write time, not bar freshness).
          const maxAge = (['D', 'W'].includes(tf) ? 86400 : 14400) * 1000
          if (!entryStaleIntraday && entry?.bars?.length
              && Date.now() - (entry.savedAt || 0) < maxAge) continue
          const bc    = FIRST_PAINT_BARS  // viewport-first: warm the shallow window; backfill loads deep history on pan
          const since = entryStaleIntraday ? null : entry?.lastT
          const url   = `/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${bc}${since != null ? `&since=${encodeURIComponent(String(since))}` : ''}`
          const r = await fetch(url)
          if (cancelled || !r.ok) continue
          const d = await r.json()
          if (cancelled || !d.bars?.length) continue
          const next = (d.delta && entry?.bars?.length) ? mergeDelta(entry.bars, d.bars) : d.bars
          idbPut(sym, tf, next)
          memPut(sym, tf, next)   // warm the sync mem cache too → instant TF switch
        } catch {
          // Single-TF failures shouldn't kill the whole prefetch chain.
        }
      }
    }
    runSequential()

    return () => { cancelled = true }
  }, [sym])  // eslint-disable-line react-hooks/exhaustive-deps

  // Bars: IDB renders instantly; full SWR data replaces it when available.
  // BUT never paint a stale intraday IDB series — that's what fuses a
  // live-price spike onto week-old history. When stale we force a full
  // refetch (no `since`, above) and show a brief spinner until it lands.
  //
  // Cross-ticker guard: on a sym switch, setIdbBars(null) only lands NEXT
  // render, and a stale-closure `data` may still describe the OLD ticker — so
  // for one render the naive selector would serve the previous stock's candles
  // (the "random candles flashing" on flip). Gate IDB on idbReadyForRef and
  // network on data.ticker so a mismatched render yields null (clean blank +
  // updateChart clears the series) instead of the wrong stock.
  const _symU = sym ? sym.toUpperCase() : ''
  const _netMatches = data?.bars?.length && (!data.ticker || data.ticker === _symU)
  const _idbFresh = idbBars?.length && idbReadyForRef.current === `${sym}_${resolvedTf}` && !idbStaleIntraday
  // A2/A1: synchronous in-memory hit for THIS exact sym+tf. Used only as the
  // last fallback (when net+IDB haven't resolved for the current key yet) so a
  // warm switch paints on the first frame instead of flashing the loading
  // overlay. Keyed to the current sym+tf → cannot show another ticker's data.
  const _memBars = (!_overrideArr && !barsOverridePending) ? memPeek(sym, resolvedTf) : null
  // Phase-A A4: optimistic same-frame TF switch. Switching to Weekly/Monthly on a
  // ticker whose Daily is already in the sync mem cache normally still costs a
  // full /api/bars round-trip (skeleton flash) for the W/M payload. Instead,
  // synthesize W/M from the cached Daily and paint it on the FIRST frame; the
  // normal SWR fetch then replaces it with authoritative server bars. The
  // resampler mirrors the server's ISO-Friday / 1st-of-month bucketing exactly
  // (cross-checked bar-for-bar vs prod), so the swap is seamless for the visible
  // range. Only as the LAST fallback — real net/IDB/mem W/M data always wins — so
  // this paints ONLY during the brief load window. Memoized on the Daily array
  // identity so it doesn't churn updateChart every render.
  const _dailyForAgg = (!_overrideArr && !barsOverridePending
                        && (resolvedTf === 'W' || resolvedTf === 'M'))
    ? memPeek(sym, 'D')
    : null
  const _aggBars = useMemo(
    () => (_dailyForAgg ? resample(_dailyForAgg, 'D', resolvedTf) : null),
    [_dailyForAgg, resolvedTf],
  )
  const bars = _overrideArr
    ? barsOverride
    : (barsOverridePending
        ? null  // override expected but not here yet → render nothing (spinner), don't fall back to provider data
        : ((_netMatches && !data.delta)
            ? data.bars
            : (_idbFresh
                ? idbBars
                : (_netMatches
                    ? data.bars
                    : (_memBars?.length
                        ? _memBars
                        : (_aggBars?.length ? _aggBars : null))))))
  const loading = !bars && !error
  // Only surface the "Failed to load chart" overlay when we have NOTHING
  // to render. If IDB has cached bars (or the SWR data was already painted
  // before the error), keep showing them and let the 30s SWR refresh
  // recover silently. Otherwise a transient backend 5xx pins the chart at
  // a hard-fail state for the user even though usable history is sitting
  // in IndexedDB. The retry button below still mutate()'s on click.
  const showFatalError = !!error && !bars?.length

  // Real-time price streaming for live candle updates
  const { prices: livePrices, staleSymbols, isStreaming } = useRealtimePrices(liveUpdates && sym ? [sym] : [])
  const isStale = !!(sym && staleSymbols && staleSymbols.has(String(sym).toUpperCase()))
  const feed = streamStatus({ isStreaming, isStale })

  // Keep lastPriceRef / lastChangePctRef in sync for screenshot composition.
  // Prefers live stream values; falls back to last bar close / intra-bar change.
  useEffect(() => {
    const live = sym ? livePrices[sym] : null
    const _livePx = _effLivePrice(live)
    if (live && Number.isFinite(_livePx)) {
      lastPriceRef.current = _livePx
    } else if (lastBarRef.current && Number.isFinite(lastBarRef.current.close)) {
      lastPriceRef.current = lastBarRef.current.close
    }
    if (live && Number.isFinite(live.change_pct)) {
      lastChangePctRef.current = live.change_pct
    } else if (lastBarRef.current && Number.isFinite(lastBarRef.current.close)) {
      // Fallback with no live feed: change vs PREVIOUS bar's close (true daily
      // move), not intra-bar close-minus-open.
      const _bars = prevBarsRef.current
      const _prev = _bars && _bars.length >= 2 ? _bars[_bars.length - 2] : null
      if (_prev && Number.isFinite(_prev.c) && _prev.c) {
        lastChangePctRef.current = ((lastBarRef.current.close - _prev.c) / _prev.c) * 100
      } else if (Number.isFinite(lastBarRef.current.open) && lastBarRef.current.open) {
        lastChangePctRef.current = ((lastBarRef.current.close - lastBarRef.current.open) / lastBarRef.current.open) * 100
      }
    }
  }, [livePrices, sym])

  // Bar-correction flash (P4-7): pulses briefly when SSE bar_correction event
  // fires for the current symbol, signaling minute-close reconciliation
  // overrode the WS-built bar.
  const [correctionFlash, setCorrectionFlash] = useState(false)

  // ── Memoized data transforms (only recompute when bars change) ─────────────

  // Offset intraday timestamps from UTC → ET so chart axis shows Eastern Time
  const adjustTime = useCallback(
    (t) => typeof t === 'number' ? t + _ET_OFFSET : t,
    []
  )

  // Filter bars to regular session only when extended hours hidden
  const sessionBars = useMemo(() => {
    if (!bars || !isIntraday || showExtended) return bars

    const getETMins = (t) => {
      const d = new Date(t * 1000)
      const etStr = d.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' })
      const [h, m] = etStr.split(':').map(Number)
      return h * 60 + m
    }

    return bars.filter(b => {
      if (typeof b.t !== 'number') return true
      const mins = getETMins(b.t)
      // All intraday RTH: 9:30 AM (570 min) to 4:00 PM (960 min) ET
      return mins >= 570 && mins < 960
    })
  }, [bars, isIntraday, showExtended, resolvedTf])

  // ── Replay / Time Machine state ──
  const [replayMode, setReplayMode] = useState(false)
  const [replayIndex, setReplayIndex] = useState(null)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const [replaySpeed, setReplaySpeed] = useState(1)

  // ── Extended-hours session preview (Charts workspace; D/W/M only) ──────────
  // `sessionView` is non-null only on the workspace. `marketSession` is the live
  // ET session. Three activation flags drive the behavior; see sessionPreview.js.
  const marketState = useMarketOpen()
  // Extended session with the overnight-post extension: 'post' spans 4pm ET → 4am
  // (post-market + overnight), then 'pre' at 4am. anchorDate = the trading day
  // whose extended data to show (the just-closed day, even after midnight).
  const _extSess = getExtSession()
  const marketSession = _extSess.session   // 'pre' | 'post' | 'rth'
  const _isDWM = ['D', 'W', 'M'].includes(resolvedTf)
  const _sessionActive = sessionView != null && _isDWM
  const _inExtWindow = marketSession === 'pre' || marketSession === 'post'
  const _sessionLive = sym ? livePrices?.[sym] : null
  // Live extended-hours print (null until the feed flags a real pre/post trade).
  const sessionExtPrice = (_sessionLive && _sessionLive.ext_session
    && Number.isFinite(_sessionLive.ext_price) && _sessionLive.ext_price > 0)
    ? _sessionLive.ext_price : null
  // Include-mode: synthesize/extend the D/W/M candle from extended-hours data.
  const sessionCandleActive = _sessionActive && sessionView === 'extended' && _inExtWindow && !replayMode
  // Regular-mode post-market: freeze today's candle at the 4pm close (don't let
  // the live writers fold post-market prints into it). Pre-market regular mode
  // already leaves yesterday's bar untouched (day_open==0 → classifyLiveBar skip).
  const sessionFreezeActive = _sessionActive && sessionView === 'regular' && marketSession === 'post' && !replayMode
  // Show the locked-close + Pre/Post tags whenever it's pre/post market on the
  // workspace, regardless of the toggle (matches TradingView).
  const sessionTagsActive = _sessionActive && _inExtWindow && !replayMode
  // Same two right-axis tags on INTRADAY charts (1m..1h) on the workspace — the
  // prev-day close + live Pre/Post price — regardless of the Regular/Extended
  // toggle. Intraday has no synthetic session candle (that's D/W/M only); it just
  // gets the price-scale references, sourced straight from the live feed.
  const sessionTagsIntraday = sessionView != null && !_isDWM && _inExtWindow && !replayMode
  // The pre-market "include pre-market" preview candle (the appended D/W/M bar) is
  // painted a muted white so it reads as a not-yet-real preview of where the stock
  // sits on pre-market prints; at 9:30 the toggle auto-reverts and the real
  // red/green daily candle takes over.
  const sessionPreviewLastBar = sessionCandleActive && marketSession === 'pre'
  // Writers A + D yield the D/W/M last bar to the memo-driven setData while owned.
  // Kept in a ref (read by the live-tick callbacks); updated in an effect so we
  // never write a ref during render. Effects run top-to-bottom, and the writer
  // callbacks only fire on a later live tick, so the ref is always current by then.
  useEffect(() => {
    sessionOwnsDailyRef.current = sessionCandleActive || sessionFreezeActive
    sessionViewRef.current = sessionView
  }, [sessionCandleActive, sessionFreezeActive, sessionView])
  // Today's extended-hours aggregate (only fetched while the preview candle is on).
  const sessionExtAgg = useSessionExtBars(sym, sessionCandleActive ? marketSession : null, sessionCandleActive, _extSess.anchorDate)

  // Exact-range frame flips (Setup ⇄ Result) animate — see the exact-range pin
  // effect below. While the framed window SHRINKS (Result → Setup) keep slicing
  // at the OLD wider end so the outgoing candles stay in the series and visibly
  // glide off-screen instead of vanishing; the hold is dropped (and the tail
  // re-cut) once the animation lands.
  const sliceHoldRef = useRef(null)     // { key, end } — wider slice end held during a shrink glide
  const prevExactEndRef = useRef(null)  // { key, end } — last exact-range exitDate seen for this chart
  const [, setSliceGen] = useState(0)   // bump after the glide lands to re-render with the hold released
  const _exKey = `${sym}_${resolvedTf}`
  {
    const prev = prevExactEndRef.current
    // The shrink-hold exists ONLY to let outgoing candles glide off-screen during
    // the animated flip. With instantFrameFlip there's no glide (we snap), so never
    // engage it — otherwise it holds the wider slice, then a re-render releases it,
    // which lands the view a beat AFTER the snap (the "moves ¼s later" glitch).
    if (!instantFrameFlip
        && exactDateRange && exitDate && prev && prev.key === _exKey && prev.end
        && String(prev.end) > String(exitDate)
        && (!sliceHoldRef.current || sliceHoldRef.current.key !== _exKey
            || String(sliceHoldRef.current.end) < String(prev.end))) {
      sliceHoldRef.current = { key: _exKey, end: prev.end }
    }
    if (!prev || prev.key !== _exKey || prev.end !== exitDate) {
      prevExactEndRef.current = { key: _exKey, end: exitDate }
    }
  }
  const _sliceHold = sliceHoldRef.current
  const exactSliceEnd = (exactDateRange && exitDate && _sliceHold && _sliceHold.key === _exKey
      && String(_sliceHold.end) > String(exitDate)) ? _sliceHold.end : exitDate

  // Restore filteredBars as the replay-sliced version.
  // All downstream code continues to use `filteredBars` unchanged.
  const filteredBars = useMemo(
    () => {
      let src = sessionBars
      // Model Book (exactDateRange): never render bars AFTER the framed year-end.
      // A stock still trading has next-year bars in the loaded series, and the
      // first one peeks a sliver past the right edge of the year / setup-focus
      // view (the right edge sits on a bar index). Drop them — the chart never
      // shows past the year anyway. LEADING bars are kept for MA warm-up.
      //   • keepBarsAfterExit (Setup Library Result view): keep the post-exit
      //     history so the candles continue into the right-pad space instead of
      //     cutting off at exitDate — but ONLY a pad's worth, never the whole
      //     tail out to today.
      //   • a held slice (_sliceHold, a Setup⇄Result shrink glide in flight):
      //     keep that same pad so the outgoing candles past the new exitDate
      //     glide off-screen instead of vanishing on the first frame.
      // CRITICAL: keeping the ENTIRE tail out to `today` (years past the framed
      // result) let a transient re-frame during a data-phase swap snap the view
      // to the latest bar — the "jumps years into the future, then lands on the
      // result" glitch — and bloated every animation frame. Cap it to the pad.
      const _holdActive = !!(_sliceHold && _sliceHold.key === _exKey && String(_sliceHold.end) > String(exitDate))
      if (exactDateRange && exactSliceEnd && src?.length) {
        const cut = src.findIndex(b => String(b.t) > exactSliceEnd)  // first bar after frame-end
        if (cut > 0) {
          if (keepBarsAfterExit || _holdActive) {
            // Keep just enough real candles past the end to fill the right pad
            // (frameRightPadFrac of the framed window) plus a small margin.
            const startIdx = entryDate ? src.findIndex(b => String(b.t) >= entryDate) : 0
            const winBars = cut - Math.max(0, startIdx)
            const extra = Math.ceil(winBars * (frameRightPadFrac || 0)) + 6
            src = src.slice(0, cut + extra)
          } else {
            src = src.slice(0, cut)
          }
        }
      }
      return (replayMode && replayIndex != null) ? src?.slice(0, replayIndex + 1) : src
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- _sliceHold/_exKey/exitDate are render-derived (mutated in the block above); exactSliceEnd already tracks the hold
    [sessionBars, replayMode, replayIndex, exactDateRange, exactSliceEnd, keepBarsAfterExit, entryDate, frameRightPadFrac]
  )

  // Curated book charts (exactDateRange) frame a specific historical window.
  // For a REUSED ticker with a data gap (e.g. CGC: a different company's data
  // through 2011, then real Canopy Growth from 2018 — NOTHING in between), a
  // selected window that lands entirely in the gap has no bars to show. Rather
  // than silently framing an unrelated era (the old fallback showed the last
  // ~year of whatever bars survived the slice — i.e. the wrong company), detect
  // the empty window and surface it so the date selection is never misrepresented.
  const selectedRangeEmpty = useMemo(() => {
    if (!exactDateRange || !entryDate || !bars || bars.length === 0) return false
    const toMs = v => {
      if (v == null) return NaN
      if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
      const s = String(v)
      return Date.parse(s.length <= 10 ? `${s}T00:00:00Z` : s)
    }
    const lo = toMs(entryDate)
    const hi = exitDate ? toMs(exitDate) : Infinity
    return !bars.some(b => {
      const t = toMs(b.t)
      return t >= lo && t <= hi
    })
  }, [exactDateRange, entryDate, exitDate, bars])

  // ── Countdown to bar close — last bar start time + tf-seconds ──
  const currentBarStart = useMemo(() => {
    if (!filteredBars?.length) return null
    const last = filteredBars[filteredBars.length - 1]
    return typeof last?.t === 'number' ? last.t : null
  }, [filteredBars])
  const countdownTfSec = useMemo(() => {
    const map = { '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600, 'D': 23400, 'W': null, 'M': null }
    return map[resolvedTf] || null
  }, [resolvedTf])

  // ── Unified keyboard shortcut handler ──
  // Uses matchShortcut() from chart/keyboardShortcuts.js as the single source
  // of truth. Covers timeframes, drawing tools, display toggles, indicator
  // toggles, replay controls, and the help overlay. Replaces the older
  // hand-rolled handler that lived here previously.
  useEffect(() => {
    const onKey = (e) => {
      // Ignore when typing in inputs/textareas/contentEditable
      const target = e.target
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        if (target.isContentEditable) return
      }

      const cmd = matchShortcut(e)
      if (!cmd) return

      if (cmd === 'help') {
        e.preventDefault()
        setHelpOpen(true)
        return
      }

      if (cmd.startsWith('tf:')) {
        const tf = cmd.slice(3)
        if (typeof onTfChange === 'function') {
          e.preventDefault()
          onTfChange(tf)
        }
        return
      }

      if (cmd.startsWith('tool:')) {
        if (!showDrawingTools) return
        const tool = cmd.slice(5)
        e.preventDefault()
        if (tool === 'cursor') {
          // Escape / V — clear active tool (returns to default cursor)
          setActiveTool(null)
        } else {
          setActiveTool(t => t === tool ? null : tool)
        }
        return
      }

      if (cmd.startsWith('toggle:')) {
        const target = cmd.slice(7)
        e.preventDefault()
        const updateField = (key, value) => {
          handleUpdateChartSettings({ ...cs, [key]: value, preset: 'custom' })
        }
        const updateIndicator = (key) => {
          const next = {
            ...cs.indicators,
            [key]: { ...(cs.indicators?.[key] || {}), enabled: !cs.indicators?.[key]?.enabled },
          }
          handleUpdateChartSettings({ ...cs, indicators: next, preset: 'custom' })
        }
        switch (target) {
          case 'ha': updateField('heikinAshi', !cs.heikinAshi); break
          case 'log': updateField('logScale', !cs.logScale); break
          case 'theme': updateField('theme', cs.theme === 'light' ? 'dark' : 'light'); break
          case 'countdown': updateField('countdown', !cs.countdown); break
          case 'rsi': updateIndicator('rsi'); break
          case 'macd': updateIndicator('macd'); break
          case 'bb': updateIndicator('bb'); break
          case 'ma': {
            // Toggle all moving-average overlays at once. If any are on, turn
            // them all off; otherwise turn them all on.
            const overlays = Array.isArray(cs.overlays) ? cs.overlays : []
            const anyEnabled = overlays.some(o => o?.enabled)
            const next = overlays.map(o => ({ ...o, enabled: !anyEnabled }))
            handleUpdateChartSettings({ ...cs, overlays: next, preset: 'custom' })
            break
          }
          case 'volume':
            handleUpdateChartSettings({
              ...cs,
              volume: { ...cs.volume, visible: !cs.volume?.visible },
              preset: 'custom',
            })
            break
          default: break
        }
        return
      }

      if (cmd.startsWith('replay:')) {
        if (!replayMode) return
        const action = cmd.slice(7)
        e.preventDefault()
        switch (action) {
          case 'playpause':
            setReplayPlaying(p => !p)
            break
          case 'back':
            setReplayPlaying(false)
            setReplayIndex(i => Math.max(0, (i ?? 0) - 1))
            break
          case 'forward':
            setReplayPlaying(false)
            setReplayIndex(i => Math.min((sessionBars?.length || 1) - 1, (i ?? 0) + 1))
            break
          default: break
        }
        return
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [cs, onTfChange, showDrawingTools, replayMode, sessionBars?.length, handleUpdateChartSettings])

  // ── Replay auto-advance interval ──
  useEffect(() => {
    if (!replayPlaying || !replayMode) return
    const intervalMs = replaySpeed === 20 ? 50 : replaySpeed === 5 ? 100 : 500
    const id = setInterval(() => {
      setReplayIndex(idx => {
        const maxIdx = (sessionBars?.length || 1) - 1
        if (idx >= maxIdx) { setReplayPlaying(false); return idx }
        return idx + 1
      })
    }, intervalMs)
    return () => clearInterval(id)
  }, [replayPlaying, replayMode, replaySpeed, sessionBars?.length])

  // ── Reset replay when sym/tf changes ──
  useEffect(() => {
    setReplayMode(false)
    setReplayPlaying(false)
    setReplayIndex(null)
  }, [sym, resolvedTf])

  // Extended-hours preview: in include-mode (pre/post market on the workspace),
  // append a new pre-market candle or extend today's candle from the ext-hours
  // aggregate + live ext price. filteredBars stays pure (regular-session only);
  // the synthetic bar rides only the candle/volume/overlay data path so the
  // green tag can read the true RTH close off filteredBars. When the toggle
  // flips off (or the 9:30 bell auto-reverts it) this is a no-op.
  const sessionAppliedBars = useMemo(() => {
    if (!sessionCandleActive || !filteredBars?.length) return filteredBars
    // During pre/post (incl. overnight) anchor the session candle to the trading
    // day the extended data belongs to — so at 2am we extend YESTERDAY's daily bar
    // with its post-market prints, not spawn a new (empty) calendar-today bar.
    const _curSec = (marketSession === 'pre' || marketSession === 'post')
      ? anchorNoonSec(_extSess.anchorDate)
      : Date.now() / 1000
    const curTime = computeBarTime(resolvedTf, _curSec)
    return applySessionCandle(filteredBars, { curTime, extAgg: sessionExtAgg, extPrice: sessionExtPrice })
  }, [filteredBars, sessionCandleActive, resolvedTf, sessionExtAgg, sessionExtPrice])

  const displayBars = useMemo(() => {
    if (!sessionAppliedBars?.length) return sessionAppliedBars
    return cs.heikinAshi ? toHeikinAshi(sessionAppliedBars) : sessionAppliedBars
  }, [sessionAppliedBars, cs.heikinAshi])

  // Right-axis session tags — green locked at the last RTH close (from the pure
  // regular-session bars) + orange Pre/Post tag at the live ext price. Merged
  // into the price-line applier via allPriceLines below.
  const sessionTagLines = useMemo(() => {
    if (!sessionTagsActive || !filteredBars?.length) return null
    const effUp = boldCandles ? mbUp : modelBookLook ? BOLD_UP : cs.candles.upColor
    const effDown = boldCandles ? mbDown : modelBookLook ? BOLD_DOWN : cs.candles.downColor
    return computeSessionTagLines({
      rthBars: filteredBars, session: marketSession, extPrice: sessionExtPrice,
      upColor: effUp, downColor: effDown, extColor: SESSION_EXT_COLOR,
    })
  }, [sessionTagsActive, filteredBars, marketSession, sessionExtPrice, boldCandles, modelBookLook, cs.candles.upColor, cs.candles.downColor])

  // Intraday (1m..1h) version of the two tags. There are no synthetic-candle bars
  // to read the RTH close from, so the prev-day close comes straight off the live
  // feed's official `prev_close`, and the Pre/Post tag off the live ext price.
  // Independent of the Regular/Extended toggle (matches the daily behavior).
  const intradaySessionTagLines = useMemo(() => {
    if (!sessionTagsIntraday || !_sessionLive) return null
    const prevClose = Number.isFinite(_sessionLive.prev_close) && _sessionLive.prev_close > 0 ? _sessionLive.prev_close : null
    const extPx = sessionExtPrice
    const effUp = boldCandles ? mbUp : modelBookLook ? BOLD_UP : cs.candles.upColor
    const effDown = boldCandles ? mbDown : modelBookLook ? BOLD_DOWN : cs.candles.downColor
    const lines = []
    if (prevClose != null) {
      // Colour the prev-close tag by where pre/post price sits vs it (green when the
      // extended session is trading above yesterday's close, red below).
      const up = Number.isFinite(extPx) && extPx > 0 ? extPx >= prevClose : true
      lines.push({
        price: prevClose, color: up ? effUp : effDown, lineWidth: 1, lineStyle: 2,
        axisLabelVisible: true, lineVisible: false, title: '', _sessionTag: 'rth',
      })
    }
    if (Number.isFinite(extPx) && extPx > 0) {
      lines.push({
        price: extPx, color: SESSION_EXT_COLOR, lineWidth: 1, lineStyle: 0,
        axisLabelVisible: true, lineVisible: false,
        title: marketSession === 'post' ? 'Post' : 'Pre', _sessionTag: 'ext',
      })
    }
    return lines.length ? lines : null
  }, [sessionTagsIntraday, _sessionLive, sessionExtPrice, marketSession, boldCandles, modelBookLook, cs.candles.upColor, cs.candles.downColor])

  // User/journal price lines + the dynamic session tags (daily OR intraday — the
  // two are mutually exclusive by timeframe). Kept as one array so the price-line
  // applier's reference-equality guard picks up ext-price changes.
  const activeSessionTags = sessionTagLines?.length ? sessionTagLines
    : (intradaySessionTagLines?.length ? intradaySessionTagLines : null)
  const allPriceLines = useMemo(
    () => (activeSessionTags ? [...(mergedPriceLines || []), ...activeSessionTags] : mergedPriceLines),
    [mergedPriceLines, activeSessionTags],
  )

  const ohlcData = useMemo(
    () => {
      if (!displayBars) return []
      const arr = displayBars.map(b => ({ time: adjustTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c }))
      // Paint the pre-market preview candle (the appended last bar) muted white.
      if (sessionPreviewLastBar && arr.length) {
        const i = arr.length - 1
        arr[i] = { ...arr[i], color: SESSION_PREVIEW_COLOR, borderColor: SESSION_PREVIEW_COLOR, wickColor: SESSION_PREVIEW_COLOR }
      }
      return arr
    },
    [displayBars, adjustTime, sessionPreviewLastBar]
  )
  // MarketSurge-style swing high/low pivots — recompute only when the data,
  // sensitivity, or timeframe changes (not per render or live tick). Forming
  // right-edge bars are never pivots, so live updates can't make labels flicker.
  const swingLabelsOn = !!cs.swingLabels?.enabled
  const swingSensitivity = cs.swingLabels?.sensitivity || 'medium'
  const swingPoints = useMemo(
    () => swingLabelsOn ? detectSwingPivots(ohlcData, sensitivityToParams(swingSensitivity, resolvedTf)) : [],
    [swingLabelsOn, swingSensitivity, resolvedTf, ohlcData]
  )
  // Gold-tinted copy with the highlighted bar(s) (Model Book: the focused
  // setup's day, or — with "show all" on — every setup's day) painted gold.
  // Kept separate from ohlcData so updateChart's normal setData path (and every
  // other chart) is untouched — the dedicated effect below applies/clears the
  // gold with a candle-only setData (no full re-render). highlightBarTime accepts
  // a single ISO/time value or an array of them.
  // Resolve each highlight date to the ACTUAL bar time present in the series.
  // On daily/intraday the setup day equals a bar time exactly. On WEEKLY/MONTHLY
  // the setup day falls INSIDE a multi-day bar (the provider anchors the bar at
  // the period start, so the exact daily date is never a bar time) — resolve to
  // the enclosing bar (largest bar time <= the date) so the setup candle still
  // paints white. Without this, weekly/monthly examples lost the highlight.
  const highlightResolved = useMemo(() => {
    if (highlightBarTime == null) return null
    const arr = Array.isArray(highlightBarTime) ? highlightBarTime : [highlightBarTime]
    const times = ohlcData.map(d => d.time)
    const exact = new Set(times)
    const fuzzy = resolvedTf === 'W' || resolvedTf === 'M'
    const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number')
      ? a - b
      : (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)
    const out = []
    for (const raw of arr) {
      if (raw == null) continue
      const target = adjustTime(raw)
      if (exact.has(target)) { out.push({ time: target, orig: raw }); continue }
      if (!fuzzy) continue
      let best = null
      for (const t of times) if (cmp(t, target) <= 0 && (best == null || cmp(t, best) > 0)) best = t
      if (best != null) out.push({ time: best, orig: raw })
    }
    return out.length ? out : null
  }, [highlightBarTime, adjustTime, ohlcData, resolvedTf])
  const highlightTimeSet = useMemo(
    () => highlightResolved ? new Set(highlightResolved.map(e => e.time)) : null,
    [highlightResolved],
  )
  // Reverse map: the chart-space (adjusted) time of each highlighted candle back
  // to the ORIGINAL date string passed in — so a click on a setup candle can be
  // resolved to the YYYY-MM-DD used to fetch that day's intraday bars.
  const highlightTimeMap = useMemo(() => {
    if (!highlightResolved) return null
    const m = new Map()
    for (const e of highlightResolved) m.set(e.time, e.orig)
    return m.size ? m : null
  }, [highlightResolved])
  const goldOhlc = useMemo(() => {
    if (!highlightTimeSet) return ohlcData
    return ohlcData.map(d => (highlightTimeSet.has(d.time)
      ? { ...d, color: highlightColor, borderColor: highlightColor, wickColor: highlightColor }
      : d))
  }, [ohlcData, highlightTimeSet, highlightColor])

  // Setup⇄Result candle crossfade. The bars PAST the highlighted setup day fade
  // in (Setup→Result) / out (Result→Setup) instead of popping. Cutoff = the
  // latest highlighted (setup) day; direction is driven off exitDate moving
  // later (fade in) or earlier (fade out). Inert unless candleFrameFade is set,
  // and a no-op at full opacity (steady state), so no other chart is touched.
  const [frameFadeAlpha, setFrameFadeAlpha] = useState(1)
  const fadeRafRef = useRef(null)
  const prevFadeExitRef = useRef(undefined)
  const fadeCutoff = useMemo(() => {
    if (!candleFrameFade || !highlightResolved?.length) return null
    return highlightResolved.reduce((m, e) => (m == null || String(e.time) > String(m) ? e.time : m), null)
  }, [candleFrameFade, highlightResolved])
  useLayoutEffect(() => {
    if (!candleFrameFade) return
    const prev = prevFadeExitRef.current
    prevFadeExitRef.current = exitDate
    if (prev === undefined || prev === exitDate) { setFrameFadeAlpha(1); frameFadeAlphaRef.current = 1; return }
    const fadeIn = String(exitDate ?? '') > String(prev ?? '')   // window grew → reveal the result run
    const from = fadeIn ? 0 : 1, to = fadeIn ? 1 : 0
    if (fadeRafRef.current) cancelAnimationFrame(fadeRafRef.current)
    // Drive the candle/volume/MA-tail crossfade IMPERATIVELY (ref + direct setData
    // in the rAF tick) instead of through React state. Calling setFrameFadeAlpha on
    // every frame forced a full re-render of this (large) component + a rebuild of
    // the whole OHLC/volume arrays + a setData on every frame — and that ran
    // concurrently with the zoom glide's OWN rAF loop, so frames dropped and the
    // Setup⇄Result transition felt choppy. Here only the ref moves per frame; React
    // state is settled ONCE at the end so the steady-state memos/effects stay
    // correct. Duration matches the zoom glide (900ms) so motion + colour land
    // together instead of the colour finishing ~180ms early. Inputs (goldOhlc /
    // volData / fadeCutoff / highlightTimeSet / overlayData) are stable across a
    // flip (same example, same bars), captured fresh each time this re-runs.
    frameFadeAlphaRef.current = from   // sync before any updateChart overlay repaint in this commit reads it
    const cut = fadeCutoff == null ? null : String(fadeCutoff)
    const buildCandles = a => (cut == null ? goldOhlc : goldOhlc.map(d => {
      if (highlightTimeSet?.has(d.time) || String(d.time) <= cut) return d
      const col = _candleRgba(d.close >= d.open, a)
      return { ...d, color: col, borderColor: col, wickColor: col }
    }))
    const buildVol = a => (cut == null ? volData : volData.map(d => (String(d.time) <= cut ? d : { ...d, color: colorMulAlpha(d.color, a) })))
    const paint = a => {
      frameFadeAlphaRef.current = a
      try { candleSeriesRef.current?.setData(a >= 1 ? goldOhlc : buildCandles(a)) } catch { /* range out of bounds mid-load */ }
      try { volumeSeriesRef.current?.setData(a >= 1 ? volData : buildVol(a)) } catch { /* range out of bounds mid-load */ }
      const tails = overlayTailSeriesRefs.current
      for (let i = 0; i < tails.length; i++) {
        const base = overlayData?.[i]?.color
        if (tails[i] && base) { try { tails[i].applyOptions({ color: colorWithAlpha(base, a) }) } catch { /* disposed mid-anim */ } }
      }
      if (volMaTailSeriesRef.current) { try { volMaTailSeriesRef.current.applyOptions({ color: colorMulAlpha(VOL_MA_COLOR, a) }) } catch { /* disposed mid-anim */ } }
    }
    const t0 = performance.now(), dur = 900
    const ease = x => -(Math.cos(Math.PI * x) - 1) / 2
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur)
      paint(from + (to - from) * ease(p))
      if (p < 1) fadeRafRef.current = requestAnimationFrame(tick)
      else { fadeRafRef.current = null; setFrameFadeAlpha(to) }   // settle React steady state once, at the end
    }
    fadeRafRef.current = requestAnimationFrame(tick)
    return () => { if (fadeRafRef.current) { cancelAnimationFrame(fadeRafRef.current); fadeRafRef.current = null } }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- captured inputs are stable across a Setup⇄Result flip; re-running only on exitDate keeps the fade in lockstep with the frame change
  }, [exitDate, candleFrameFade])
  // Apply the crossfade alpha to the post-setup bars. Untouched at full opacity.
  const fadedOhlc = useMemo(() => {
    if (!candleFrameFade || frameFadeAlpha >= 1 || fadeCutoff == null) return goldOhlc
    const a = Math.max(0, Math.min(1, frameFadeAlpha))
    const cut = String(fadeCutoff)
    return goldOhlc.map(d => {
      if (highlightTimeSet?.has(d.time) || String(d.time) <= cut) return d
      const col = _candleRgba(d.close >= d.open, a)
      return { ...d, color: col, borderColor: col, wickColor: col }
    })
  }, [goldOhlc, candleFrameFade, frameFadeAlpha, fadeCutoff, highlightTimeSet])
  const closeData = useMemo(
    () => displayBars ? displayBars.map(b => ({ time: adjustTime(b.t), value: b.c })) : [],
    [displayBars, adjustTime]
  )
  const hvcSet = useMemo(
    () => cs.volume.hvcEnabled && !disableHvc && filteredBars?.length > 20 ? computeHVC(filteredBars) : new Set(),
    [filteredBars, cs.volume.hvcEnabled, disableHvc]
  )
  // Highest-Volume-Ever bar (across all loaded bars). Coloured gold, no label —
  // only highlighted when it falls within the visible year.
  const volExtremes = useMemo(() => {
    if (!markVolumeExtremes || !filteredBars?.length) return null
    const inYear = b => (!entryDate || b.t >= entryDate) && (!exitDate || b.t <= exitDate)
    let hve = null
    for (const b of filteredBars) if (b.v != null && (!hve || b.v > hve.v)) hve = b
    if (!hve || !inYear(hve)) return null
    return { goldTimes: new Set([hve.t]) }
  }, [markVolumeExtremes, filteredBars, entryDate, exitDate])
  const volData = useMemo(() => {
    if (!sessionAppliedBars?.length) return []
    // Volume bars track the candle palette EXACTLY so the red/green of the
    // volume pane matches the red/green of the candles above it (a dimmed alpha
    // composites darker over the near-black canvas and reads as a mismatched hue).
    const upC = boldCandles ? mbUp : modelBookLook ? BOLD_UP : cs.volume.upColor
    const downC = boldCandles ? mbDown : modelBookLook ? BOLD_DOWN : cs.volume.downColor
    const gold = '#e6b800'
    return sessionAppliedBars.map((b, i) => {
      // Up/down follows the SAME rule as the candles: net change (close vs the
      // PREVIOUS close) when colorByNetChange is on, else close-vs-open. This is
      // why a gap-up-then-fade day (AEHR +22% on the day but red open→close) shows
      // a GREEN volume bar — it's up on net change. First bar has no prior close.
      const prevC = i > 0 ? sessionAppliedBars[i - 1].c : b.o
      const isUp = colorByNetChange ? (b.c >= prevC) : (b.c >= b.o)
      return {
        time: adjustTime(b.t),
        value: b.v,
        color: volExtremes?.goldTimes.has(b.t)        // HVE / HV1 bars → gold
          ? gold
          : (!boldCandles && hvcSet.has(b.t))         // legacy HVC highlight
            ? 'rgba(201,168,76,0.9)'
            : isUp ? upC : downC,
      }
    })
  }, [sessionAppliedBars, hvcSet, cs.volume.upColor, cs.volume.downColor, adjustTime, boldCandles, modelBookLook, volExtremes, colorByNetChange])
  // Volume bars past the setup day crossfade with the candles on Setup⇄Result
  // (each bar's existing alpha scaled by the fade). No-op at full opacity. The
  // re-tint effect lives AFTER updateChart (below) so its setData wins over
  // updateChart's full-opacity volume paint — otherwise the bars flicker.
  const fadedVolData = useMemo(() => {
    if (!candleFrameFade || frameFadeAlpha >= 1 || fadeCutoff == null) return volData
    const a = Math.max(0, Math.min(1, frameFadeAlpha)), cut = String(fadeCutoff)
    return volData.map(d => (String(d.time) <= cut ? d : { ...d, color: colorMulAlpha(d.color, a) }))
  }, [volData, candleFrameFade, frameFadeAlpha, fadeCutoff])
  // Smooth N-SMA line for the volume pane (subtle, white).
  const volMaData = useMemo(() => {
    if (!volumeMa || volumeMa < 2 || !sessionAppliedBars?.length) return []
    const out = []
    const q = []
    let sum = 0
    for (const b of sessionAppliedBars) {
      const v = b.v || 0
      q.push(v); sum += v
      if (q.length > volumeMa) sum -= q.shift()
      if (q.length === volumeMa) out.push({ time: adjustTime(b.t), value: sum / volumeMa })
    }
    return out
  }, [sessionAppliedBars, volumeMa, adjustTime])
  const overlayData = useMemo(() => {
    if (!sessionAppliedBars?.length || !resolvedOverlays?.length) return []
    return resolvedOverlays.map(ov => {
      const raw = ov.type === 'EMA'
        ? computeEMA(sessionAppliedBars, ov.period, overlaysFromStart)
        : computeSMA(sessionAppliedBars, ov.period, overlaysFromStart)
      return { data: raw.map(p => ({ time: adjustTime(p.time), value: p.value })), color: ov.color }
    })
  }, [sessionAppliedBars, resolvedOverlays, adjustTime, overlaysFromStart])
  // Drive the MA tail opacity each frame of the Setup⇄Result crossfade (the
  // overlay loop in updateChart owns the tail DATA; this only re-tints it as the
  // alpha animates). No-op for charts that don't fade.
  useEffect(() => {
    if (!candleFrameFade) return
    const tails = overlayTailSeriesRefs.current
    for (let i = 0; i < tails.length; i++) {
      const base = overlayData?.[i]?.color
      if (tails[i] && base) { try { tails[i].applyOptions({ color: colorWithAlpha(base, frameFadeAlpha) }) } catch { /* disposed mid-anim */ } }
    }
    if (volMaTailSeriesRef.current) {
      try { volMaTailSeriesRef.current.applyOptions({ color: colorMulAlpha(VOL_MA_COLOR, frameFadeAlpha) }) } catch { /* disposed mid-anim */ }
    }
  }, [frameFadeAlpha, candleFrameFade, overlayData])

  const indicatorData = useMemo(() => {
    const ind = cs.indicators || {}
    const rsiRaw = ind.rsi?.enabled
      ? computeRSI(filteredBars, ind.rsi.period).map(p => ({ time: adjustTime(p.time), value: p.value }))
      : []
    const bbRaw = ind.bb?.enabled
      ? computeBB(filteredBars, ind.bb.period, ind.bb.stdDev)
      : { upper: [], middle: [], lower: [] }
    const vwapRaw = ((vwapOverride || ind.vwap?.enabled) && VWAP_TFS.has(resolvedTf))
      ? computeVWAP(filteredBars)
      : []
    const stochRaw = ind.stoch?.enabled
      ? computeStochastic(filteredBars, ind.stoch.kPeriod, ind.stoch.dPeriod)
      : { k: [], d: [] }
    const atrRaw = ind.atr?.enabled
      ? computeATR(filteredBars, ind.atr.period)
      : []
    const sarRaw = ind.sar?.enabled
      ? computeParabolicSAR(filteredBars, ind.sar.step, ind.sar.maxStep)
      : []
    const ichimokuRaw = ind.ichimoku?.enabled
      ? computeIchimoku(filteredBars)
      : { tenkan: [], kijun: [], spanA: [], spanB: [], chikou: [] }
    const mfiRaw = ind.mfi?.enabled
      ? computeMFI(filteredBars, ind.mfi.period)
      : []
    const cciRaw = ind.cci?.enabled
      ? computeCCI(filteredBars, ind.cci.period)
      : []
    const williamsRRaw = ind.williamsR?.enabled
      ? computeWilliamsR(filteredBars, ind.williamsR.period)
      : []
    const adxRaw = ind.adx?.enabled
      ? computeADX(filteredBars, ind.adx.period)
      : { adx: [], plusDI: [], minusDI: [] }
    const obvRaw = ind.obv?.enabled
      ? computeOBV(filteredBars)
      : []
    const donchianRaw = ind.donchian?.enabled
      ? computeDonchian(filteredBars, ind.donchian.period)
      : { upper: [], middle: [], lower: [] }
    return {
      rsi: rsiRaw,
      bb: {
        upper:  bbRaw.upper.map(p  => ({ time: adjustTime(p.time), value: p.value })),
        middle: bbRaw.middle.map(p => ({ time: adjustTime(p.time), value: p.value })),
        lower:  bbRaw.lower.map(p  => ({ time: adjustTime(p.time), value: p.value })),
      },
      vwap: vwapRaw.map(p => ({ time: adjustTime(p.time), value: p.value })),
      macd: (() => {
        const macdCfg = ind.macd
        if (!macdCfg?.enabled) return { macd: [], signal: [], histogram: [] }
        const raw = computeMACD(filteredBars, macdCfg.fastPeriod, macdCfg.slowPeriod, macdCfg.signalPeriod)
        return {
          macd:      raw.macd.map(p      => ({ time: adjustTime(p.time), value: p.value })),
          signal:    raw.signal.map(p    => ({ time: adjustTime(p.time), value: p.value })),
          histogram: raw.histogram.map(p => ({ time: adjustTime(p.time), value: p.value, color: p.color })),
        }
      })(),
      stoch: {
        k: stochRaw.k.map(p => ({ time: adjustTime(p.time), value: p.value })),
        d: stochRaw.d.map(p => ({ time: adjustTime(p.time), value: p.value })),
      },
      atr: atrRaw.map(p => ({ time: adjustTime(p.time), value: p.value })),
      sar: sarRaw.map(p => ({ time: adjustTime(p.time), value: p.value, isUptrend: p.isUptrend })),
      ichimoku: {
        tenkan: ichimokuRaw.tenkan.map(p => ({ time: adjustTime(p.time), value: p.value })),
        kijun:  ichimokuRaw.kijun.map(p  => ({ time: adjustTime(p.time), value: p.value })),
        spanA:  ichimokuRaw.spanA.map(p  => ({ time: adjustTime(p.time), value: p.value })),
        spanB:  ichimokuRaw.spanB.map(p  => ({ time: adjustTime(p.time), value: p.value })),
        chikou: ichimokuRaw.chikou.map(p => ({ time: adjustTime(p.time), value: p.value })),
      },
      mfi:       mfiRaw.map(p       => ({ time: adjustTime(p.time), value: p.value })),
      cci:       cciRaw.map(p       => ({ time: adjustTime(p.time), value: p.value })),
      williamsR: williamsRRaw.map(p => ({ time: adjustTime(p.time), value: p.value })),
      adx: {
        adx:     adxRaw.adx.map(p     => ({ time: adjustTime(p.time), value: p.value })),
        plusDI:  adxRaw.plusDI.map(p  => ({ time: adjustTime(p.time), value: p.value })),
        minusDI: adxRaw.minusDI.map(p => ({ time: adjustTime(p.time), value: p.value })),
      },
      obv: obvRaw.map(p => ({ time: adjustTime(p.time), value: p.value })),
      donchian: {
        upper:  donchianRaw.upper.map(p  => ({ time: adjustTime(p.time), value: p.value })),
        middle: donchianRaw.middle.map(p => ({ time: adjustTime(p.time), value: p.value })),
        lower:  donchianRaw.lower.map(p  => ({ time: adjustTime(p.time), value: p.value })),
      },
    }
  }, [filteredBars, cs.indicators, resolvedTf, adjustTime, vwapOverride])

  // ── Comparison symbol % return data ──
  const comparisonData = useMemo(() => {
    const cmpBars = compareData?.bars || (Array.isArray(compareData) ? compareData : null)
    if (!cmpBars?.length || !filteredBars?.length) return []
    // Build a timestamp-keyed map for the comparison symbol
    const cmpMap = new Map(cmpBars.map(b => [b.t, b.c]))
    // Find the first filteredBar date that exists in comparison data
    let baseCmp = null
    for (const bar of filteredBars) {
      if (cmpMap.has(bar.t)) {
        baseCmp = cmpMap.get(bar.t)
        break
      }
    }
    if (!baseCmp) return []
    // Build % return series aligned to filteredBars timeline
    const result = []
    for (const bar of filteredBars) {
      const cmpClose = cmpMap.get(bar.t)
      if (cmpClose != null) {
        result.push({
          time: adjustTime(bar.t),
          value: parseFloat(((cmpClose / baseCmp - 1) * 100).toFixed(3)),
        })
      }
    }
    return result
  }, [compareData, filteredBars, adjustTime])

  // ── Multi-symbol comparison overlays (cs.comparisonSymbols) ──
  // Independent of legacy single-symbol compareSymbol. Each enabled comparison
  // is fetched in parallel, normalized to % change from first valid close, and
  // drawn on a dedicated 'comparison' price scale (left side).
  const enabledComparisons = useMemo(
    () => (cs.comparisonSymbols || []).filter(c => c && c.enabled && c.sym),
    [cs.comparisonSymbols]
  )
  // Stable cache key: sorted sym list + tf + barCount. Sorted so reorder doesn't refetch.
  const comparisonsKey = useMemo(
    () => enabledComparisons.map(c => String(c.sym).toUpperCase()).sort().join(',') || null,
    [enabledComparisons]
  )
  const { data: comparisonsData } = useSWR(
    comparisonsKey ? ['comparison-bars', comparisonsKey, resolvedTf, barCount] : null,
    async () => {
      const syms = enabledComparisons.map(c => String(c.sym).toUpperCase())
      const results = await Promise.allSettled(
        syms.map(s =>
          fetch(`/api/bars/${encodeURIComponent(s)}?tf=${resolvedTf}&bars=${barCount}`)
            .then(r => (r.ok ? r.json() : { bars: [] }))
            .catch(() => ({ bars: [] }))
        )
      )
      const out = {}
      results.forEach((r, i) => {
        out[syms[i]] = r.status === 'fulfilled' ? (r.value?.bars || []) : []
      })
      return out
    },
    { revalidateOnFocus: false, dedupingInterval: 15_000 }
  )

  // Per-enabled-comparison normalized {time, value} points with adjustTime applied.
  const comparisonSeries = useMemo(() => {
    if (!comparisonsData) return []
    return enabledComparisons.map(c => {
      const symKey = String(c.sym).toUpperCase()
      const rawBars = comparisonsData[symKey] || []
      const points = normalizeToPctChange(
        rawBars.map(b => ({ t: adjustTime(b.t), c: b.c }))
      )
      return { sym: symKey, color: c.color, points }
    })
  }, [comparisonsData, enabledComparisons, adjustTime])

  // ── Index comparison pane (indexPaneSymbol, e.g. ^IXIC) ──
  // Fetch the index's bars for the same tf + bar count and draw its CLOSE as a
  // line in a dedicated pane on top of the price pane. Unlike the % comparison
  // overlay, this is its own auto-scaled pane (the shape is what matters for
  // spotting relative strength). Indices route through yfinance server-side.
  const { data: indexPaneData } = useSWR(
    indexPaneSymbol ? ['index-pane-bars', String(indexPaneSymbol).toUpperCase(), resolvedTf, barCount] : null,
    async () => {
      const s = String(indexPaneSymbol).toUpperCase()
      const res = await fetch(`/api/bars/${encodeURIComponent(s)}?tf=${resolvedTf}&bars=${barCount}`)
        .then(r => (r.ok ? r.json() : { bars: [] }))
        .catch(() => ({ bars: [] }))
      return res?.bars || []
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  )
  // Keep ONLY index points whose time exists in the stock's own bars. The index
  // series shares the chart's logical time scale; if it added points the stock
  // lacks, those extra positions would shift every candle's logical index. That
  // breaks reused/gappy tickers hard: e.g. SNDK (SanDisk delisted 2016 →
  // relisted 2025) has a multi-year hole that ^IXIC fills with continuous data —
  // those gap points expanded the logical space so the year-framing (computed
  // from the stock's gap-less bar array) landed IN the gap, showing an empty
  // chart at the wrong dates. Restricting to the stock's bar times keeps the
  // logical indices 1:1 with the stock; the index line simply skips the gap too.
  const indexPaneSeries = useMemo(() => {
    if (!indexPaneSymbol || !indexPaneData?.length || !ohlcData?.length) return []
    const stockTimes = new Set(ohlcData.map(b => b.time))
    // Also bound to the framed window (Model Book book-year) when provided. A
    // reused ticker (SNDK/BE) has an OLD pre-delisting segment in stockTimes too;
    // including its index points makes the line draw one segment straight across
    // the multi-year gap — a spike at the left edge of the year view. Keeping only
    // the framed window drops the old segment so the line starts cleanly.
    const toMs = (t) => typeof t === 'number'
      ? (t < 1e12 ? t * 1000 : t)
      : Date.parse(String(t).length <= 10 ? `${t}T00:00:00Z` : String(t))
    // Extend the lower bound ~13 months before the book year so the index line
    // also covers the PRIOR-year lead-up a setup/catalyst focus-zoom reveals
    // (e.g. Nov–Dec 2024 on a 2025 chart) — while still excluding a reused
    // ticker's MULTI-year-old segment (its delisting gap is years, not months).
    const YEAR_MS = 365 * 24 * 3600 * 1000
    const loMs = entryDate ? toMs(entryDate) - Math.round(YEAR_MS * 1.1) : -Infinity
    const hiMs = exitDate ? toMs(exitDate) + Math.round(YEAR_MS * 0.25) : Infinity
    return indexPaneData
      .map(b => ({ time: adjustTime(b.t), value: b.c }))
      .filter(p => {
        if (p.value == null || !Number.isFinite(p.value) || !stockTimes.has(p.time)) return false
        const ms = toMs(p.time)
        return ms >= loMs && ms <= hiMs
      })
  }, [indexPaneSymbol, indexPaneData, ohlcData, adjustTime, entryDate, exitDate])

  // Fixed price range for the index pane, computed from the FULL ^IXIC data over
  // the BOOK YEAR ONLY (entryDate..exitDate, NOT the extended lead-up window and
  // NOT clipped to the stock's bar times). Year-only = the Nasdaq line fills the
  // pane (the lead-up window dragged in 2020/2022 lows that wasted the bottom
  // half); full-data (not stock-clipped) = identical for every stock in a year so
  // the scale stays pinned/steady across ticker switches. NaN-time + non-positive
  // guards keep yfinance's 1970s ^IXIC history (period='max', lows near 50) from
  // leaking in past the date filter (NaN comparisons are false → would slip through).
  const indexPaneRange = useMemo(() => {
    if (!indexPaneSymbol || !indexPaneData?.length || !entryDate || !exitDate) return null
    const toMs = (t) => typeof t === 'number'
      ? (t < 1e12 ? t * 1000 : t)
      : Date.parse(String(t).length <= 10 ? `${t}T00:00:00Z` : String(t))
    const loMs = toMs(entryDate)
    const hiMs = toMs(exitDate)
    if (!Number.isFinite(loMs) || !Number.isFinite(hiMs)) return null
    let min = Infinity, max = -Infinity
    for (const b of indexPaneData) {
      if (b.c == null || !Number.isFinite(b.c) || b.c <= 0) continue
      const ms = toMs(adjustTime(b.t))
      if (!Number.isFinite(ms) || ms < loMs || ms > hiMs) continue
      if (b.c < min) min = b.c
      if (b.c > max) max = b.c
    }
    if (!(min <= max)) return null
    // Pad the pinned range with HEADROOM below the line (and a touch above) so the
    // "-X%" decline annotations placed under the Nasdaq line aren't clipped at the
    // pane's bottom edge. The pinned provider range overrides the price-scale's
    // bottom scaleMargin, so the room has to come from the range itself — 28% of
    // the span below, 6% above.
    const span = (max - min) || Math.abs(max) || 1
    return { min: min - span * 0.28, max: max + span * 0.06 }
  }, [indexPaneSymbol, indexPaneData, adjustTime, entryDate, exitDate])
  // Keep the autoscaleInfoProvider's source current (it reads this ref). Pin only
  // in arithmetic/log modes; in Percent mode LWC rebases to the visible window, so
  // a fixed range would fight it — let it autoscale there.
  indexScaleRef.current = { range: indexPaneRange, pin: effectiveScale !== 'pct' }

  // 50-period SMA of the index pane (e.g. ^IXIC). Computed on the FULL index
  // history then clipped to exactly the index line's plotted time set, so the
  // MA is already fully populated at the window's left edge (no 50-bar ramp-in)
  // AND introduces no time points the stock lacks (same 1:1 logical-index rule
  // as the index line — see indexPaneSeries above).
  const indexPaneMaSeries = useMemo(() => {
    if (!indexPaneSymbol || !indexPaneData?.length || !indexPaneSeries.length) return []
    const keepTimes = new Set(indexPaneSeries.map(p => p.time))
    const bars = indexPaneData
      .filter(b => b.c != null && Number.isFinite(b.c))
      .map(b => ({ t: adjustTime(b.t), c: b.c }))
    return computeSMA(bars, 50).filter(p => keepTimes.has(p.time))
  }, [indexPaneSymbol, indexPaneData, indexPaneSeries, adjustTime])

  // Color the index-pane MA the same blue as the price chart's 50 SMA overlay
  // (falls back to the default 50-SMA blue if no such overlay is enabled).
  const indexMaColor = useMemo(() => {
    const ov = resolvedOverlays?.find(o => o.type === 'SMA' && Number(o.period) === 50)
    return ov?.color || '#60a5fa'
  }, [resolvedOverlays])

  // Reset all live tracking refs on symbol or timeframe change.
  // CRITICAL: latestLiveRef must also be cleared — without it, a leftover live
  // tick from the previous ticker (e.g. AAPL price) gets re-applied to the new
  // ticker's first bar in the post-setData re-apply at the bottom of updateChart,
  // producing a wrong wick on the first candle of the new ticker.
  useEffect(() => {
    lastBarRef.current = null
    liveBarRef.current = null
    barStartVolRef.current = 0
    latestLiveRef.current = null
  }, [sym, resolvedTf])

  // Real-time candle updates — tick-by-tick via WebSocket.
  // Detects bar period boundaries and creates NEW candles automatically.
  // Handles both OHLC types (candles/bars) and close-only types (line/area).
  useEffect(() => {
    const liveData = livePrices[sym]
    if (!liveData?.price) return
    // Skip live updates when replay mode is active — don't corrupt historical view.
    if (replayMode) return
    // HA bars depend on the full series history — skip tick-by-tick updates.
    // The chart still refreshes every 15s via SWR, which re-runs toHeikinAshi on
    // the full filteredBars array and calls setData() — accurate enough for HA.
    if (cs.heikinAshi) return
    // Writer A of the single-writer invariant (index @ barsPushActiveRef decl): when the
    // Massive push feed is authoritative, freeze this Finnhub tick writer ENTIRELY — no
    // series write AND no latestLiveRef update (the post-setData re-apply reads latestLiveRef;
    // a stale value there would repaint an old developing bar over the fresh push bar = the
    // 30s seam the plan review flagged).
    if (barsPushActiveRef.current) return
    // On D/W/M, writer E (the fast Massive 1-min tick, in the bars-WS onBar above)
    // owns the developing candle. Defer to it while its tick is fresh so the two
    // don't fight over the developing bar's close (Massive is fresher than
    // Finnhub here); fall back to this Finnhub writer only if Massive goes stale.
    if (!realtimeTfEligible) {
      const _ft = liveTickRef.current
      if (_ft && _ft.price != null && (Date.now() - _ft.ts) < LIVE_TICK_FRESH_MS) return
    }
    // Defensive: drop ticks with bad price BEFORE they touch liveBarRef.
    // Mirror of onRealtimeBar's guard. A single NaN / 0 / extreme price baked
    // into liveBarRef.current.high or .low persists across setData() refreshes
    // because the post-setData re-apply (~line 1170) trusts liveBarRef as the
    // authoritative developing-bar state. Without this guard the chart can
    // get stuck with a low of 0 (or extreme) until full page reload, dragging
    // EMA/SMA series into a V-shape collapse on intraday charts.
    const _p = _effLivePrice(liveData)
    // Single sanity chokepoint (see isSaneLivePrice): non-finite/<=0, or
    // >50% deviation from the last painted bar OR the poison-proof clean
    // server close. Mirror of the WS-bar path so they cannot diverge.
    if (!isSaneLivePrice(_p, lastBarRef.current?.close, lastServerCloseRef.current)) return
    // day_high / day_low can also arrive zero or stale during the first ticks
    // after market open. Treat 0 / negative / non-finite as "not provided" so
    // the bar's H/L don't snap to 0.
    const _dh = Number.isFinite(liveData.day_high) && liveData.day_high > 0 ? liveData.day_high : null
    const _dl = Number.isFinite(liveData.day_low) && liveData.day_low > 0 ? liveData.day_low : null
    const _do = Number.isFinite(liveData.day_open) && liveData.day_open > 0 ? liveData.day_open : null
    // prev_close is carried so the new-session classifier can recover a fresh
    // daily bar from the snapshot when the SSE stream is down (REST floor has
    // no updated_at) — last.close ≈ prev_close proves a new session is underway.
    const _pc = Number.isFinite(liveData.prev_close) && liveData.prev_close > 0 ? liveData.prev_close : null
    latestLiveRef.current = { sym, price: _p, updated_at: liveData.updated_at,
      day_open: _do, day_high: _dh, day_low: _dl, prev_close: _pc,
      ext_session: !!liveData.ext_session }
    if (!candleSeriesRef.current || !lastBarRef.current) return
    if (['D', 'W', 'M'].includes(resolvedTf)) {
      // Writer A yields the D/W/M developing bar to the session-preview memo path
      // while it owns the bar (pre/post-market preview candle or frozen-at-4pm
      // regular candle). latestLiveRef stays updated above; only the candle write
      // is skipped so the two paths can't fight over the last bar's close/high/low.
      if (sessionOwnsDailyRef.current) return
      // Regular Hours mode: NEVER fold an extended-hours print into the daily
      // candle — even in the up-to-60s window after 4pm before useMarketOpen flips
      // isExtended (sessionFreezeActive gates off that laggy clock). ext_session is
      // a per-tick truth from the feed, and _effLivePrice already returned the ext
      // price into _p, so without this the post price seams the RTH candle.
      if (sessionViewRef.current === 'regular' && liveData.ext_session) return
    } else if (!showExtendedRef.current && liveData.ext_session) {
      // RTH-only intraday (EXT/RTH toggle off): same as Writer B — never fold a
      // pre/post-market print into the live intraday bar. (Writer A only reaches
      // intraday when the push feed isn't delivering; this is the fallback path.)
      return
    }
    const price = _p
    const last = lastBarRef.current
    const useOhlc = isOhlcType(cs.chartType)

    // Compute which bar period this tick belongs to.
    // CRITICAL: do NOT fall back to Date.now() — if a tick arrives without
    // updated_at (reconnect, stale cache, weekend straggler), wall-clock time
    // can land on a non-trading day and spawn a phantom Saturday/Sunday candle
    // next to Friday's real one. When the timestamp is missing, just keep
    // updating the last known bar in place.
    const tickSec = liveData.updated_at
    const live = latestLiveRef.current || {}
    const isIntradayTf = !['D', 'W', 'M'].includes(resolvedTf)
    // Single source of truth for the new-bar / update / skip decision (shared
    // with the post-setData re-apply below). For D/W/M it creates today's bar
    // from session OHLC even when the SSE stream is down and the tick carries
    // no timestamp (REST floor) — recovering the new session from the snapshot
    // (last.close ≈ prev_close) instead of fusing today's price onto a stale
    // prior-session candle (the "Frankenstein" bug, PAYO 2026-06-15). 'skip'
    // means a new D/W/M day with no confirmed session — leave yesterday alone.
    const decision = classifyLiveBar({
      tf: resolvedTf, last, live, tickSec, nowSec: Date.now() / 1000,
    })
    const barTime = decision.time != null ? decision.time : last.time

    try {
      if (decision.kind === 'skip') return
      if (decision.kind === 'new') {
        // ── NEW CANDLE ──
        const isDailyWeekly = !isIntradayTf
        // Daily/Weekly: use session OHLC. Intraday: use current tick as open (closest to actual first trade)
        const openPrice = (isDailyWeekly && live.day_open) ? live.day_open : price
        const highPrice = isDailyWeekly ? Math.max(live.day_high || openPrice, price) : price
        const lowPrice = isDailyWeekly ? Math.min((live.day_low && live.day_low > 0) ? live.day_low : openPrice, price) : price

        // Initialize tick-accurate tracking for this bar
        liveBarRef.current = { time: barTime, open: openPrice, high: highPrice, low: lowPrice, close: price }
        barStartVolRef.current = liveData.volume || 0

        if (useOhlc) {
          candleSeriesRef.current.update(liveBarRef.current)
          lastBarRef.current = { ...liveBarRef.current, volume: 0 }
        } else {
          candleSeriesRef.current.update({ time: barTime, value: price })
          lastBarRef.current = { ...liveBarRef.current, volume: 0 }
        }
        if (volumeSeriesRef.current) {
          // Full-opacity default color (matches closed bars + volData) — no lighter
          // "developing" tint. Value is 0 here so it's invisible until the next tick.
          const _vUpN = boldCandles ? mbUp : modelBookLook ? BOLD_UP : cs.volume.upColor
          volumeSeriesRef.current.update({ time: barTime, value: 0, color: _vUpN })
        }
      } else {
        // ── SAME CANDLE (decision.kind === 'update') ──
        // The "new D/W/M day without confirmed session" case is now handled by
        // decision.kind === 'skip' above (returns early), so reaching here means
        // the tick genuinely belongs to the current last bar.

        // Track in liveBarRef (survives setData wipes)
        if (liveBarRef.current && liveBarRef.current.time === last.time) {
          liveBarRef.current.high = Math.max(liveBarRef.current.high, price)
          liveBarRef.current.low = Math.min(liveBarRef.current.low, price)
          liveBarRef.current.close = price
        }

        const updated = {
          time: last.time,
          open: last.open,
          high: liveBarRef.current ? liveBarRef.current.high : Math.max(last.high, price),
          low: liveBarRef.current ? liveBarRef.current.low : Math.min(last.low, price),
          close: price,
        }
        if (useOhlc) {
          candleSeriesRef.current.update(updated)
        } else {
          candleSeriesRef.current.update({ time: last.time, value: price })
        }

        // Volume: don't override — let API-provided volume stand (refreshes every 15s)
        // The API has accurate per-bar volume; live delta calculations are unreliable
        lastBarRef.current = { ...updated, volume: last.volume }
      }
    } catch (e) {
      if (e?.message) console.warn('[StockChart] live update error:', e.message)
    }
  }, [livePrices, sym, resolvedTf, cs.chartType, replayMode])

  // Real-time bar streaming (Phase 4) — Massive AM events.
  // 60-min was added 2026-05-22 once the backend rollup adopted the canonical
  // ET-anchored bucket function (bars_fetch.bucket_60_et_unix_seconds) — the
  // same one the REST resample uses — so WS bars and REST bars now align bit-
  // identically and can't drift across DST or the 9:30 RTH-open anchor.
  // Keep this list in sync with backend ROLLUP_TFS (api/services/bar_broadcaster.py)
  // and the tf allow-list in api/routers/stream.py:stream_bars.
  // Coexists with the tick-driven useEffect above:
  //  - Tick logic drives sub-second flicker on the current developing candle
  //  - AM events deliver authoritative just-closed minute bars (1m chart) or
  //    server-rolled partial bucket bars (5/15/30/60m charts)
  //  - When an AM bar matches liveBarRef/lastBarRef.time, we sync them so the
  //    next tick iteration doesn't overwrite the authoritative values
  const realtimeTfEligible = ['1', '5', '15', '30', '60'].includes(resolvedTf)

  const onRealtimeBar = useCallback((data) => {
    if (!candleSeriesRef.current) return
    // Never paint a live bar onto a historical replay (mirror of writers A + C). When
    // push is authoritative B is THE writer, so without this it would append a live
    // candle onto the replayed slice (review #4).
    if (replayMode) return
    // Defensive: a POOLED bars connection carries many (sym,tf) pairs. The pool
    // dispatches by key, but never apply a bar that isn't ours — cross-symbol
    // application (MSFT's OHLC on the AAPL series) is a data-doubt bug, so guard
    // here too (belt-and-suspenders against any future pool regression).
    if (data?.sym && String(data.sym).toUpperCase() !== String(sym).toUpperCase()) return
    if (data?.tf != null && String(data.tf) !== String(resolvedTf)) return
    // Writer B of the single-writer invariant (index @ barsPushActiveRef decl) — B IS the
    // push writer, so it paints ONLY when push is AUTHORITATIVE (delivering). In the transient
    // connected-but-not-yet-delivering window (the first bar; a flap near the recency boundary)
    // the Finnhub writers are still active, so painting here too would DUAL-WRITE the developing
    // bar (jitter on thin tickers). delivering is tracked independently by the pool, so this is a
    // clean one-bar handoff — Finnhub covers the transition bar, then B takes over.
    if (!barsPushActiveRef.current) return
    // AM `t` is bucket-start in ms. Convert to seconds AND add _ET_OFFSET so
    // the time matches the rest of the chart series — REST bars stored via
    // setData(ohlcData) where ohlcData uses adjustTime(b.t) = b.t + _ET_OFFSET.
    // Without this offset, Phase 4 update() lands at a time that conflicts
    // with the series and is silently dropped by lightweight-charts.
    const tSec = Math.floor(data.bar.t / 1000) + _ET_OFFSET
    const useOhlc = isOhlcType(cs.chartType)

    // RTH-only intraday (EXT/RTH toolbar toggle = off): drop live pre/post-market
    // bars, the same 9:30–16:00 ET window sessionBars filters the FETCHED data to.
    // Without this the CURRENT extended session leaks onto an RTH-only chart via
    // the live push feed (past ext sessions are already filtered out of history).
    if (!showExtendedRef.current && !['D', 'W', 'M'].includes(resolvedTf)) {
      const mins = etMinutes(Math.floor(data.bar.t / 1000))
      if (mins < 570 || mins >= 960) return
    }

    // Defensive: skip bars with invalid OHLC. WS sources can occasionally
    // emit zero / NaN / nonsensical values at bar boundaries or during
    // reconnect; without this guard the chart paints a tall bar spanning
    // from 0 to the current price, throwing off auto-scale and producing
    // the "extreme thin vertical bar at right edge" rendering bug the user
    // has reported repeatedly across intraday charts (60min especially).
    const o = data.bar.o, h = data.bar.h, l = data.bar.l, c = data.bar.c
    const allFinitePositive = [o, h, l, c].every(v => Number.isFinite(v) && v > 0)
    if (!allFinitePositive || l > h) {
      return  // silently drop the bad bar — next tick will repaint correctly
    }
    // Single sanity chokepoint (see isSaneLivePrice) — same gate as the
    // snapshot-tick path so the two can never diverge (divergent inline
    // guards are exactly how the 100x phantom slipped through).
    if (!isSaneLivePrice(c, lastBarRef.current?.close, lastServerCloseRef.current)) {
      return
    }

    try {
      if (useOhlc) {
        candleSeriesRef.current.update({
          time: tSec,
          open: o, high: h, low: l, close: c,
        })
      } else {
        candleSeriesRef.current.update({ time: tSec, value: c })
      }
      if (volumeSeriesRef.current) {
        const _pb = prevBarsRef.current
        const _prevC = colorByNetChange && _pb && _pb.length >= 2 ? _pb[_pb.length - 2].c : null
        const _up = _prevC != null ? (data.bar.c >= _prevC) : (data.bar.c >= data.bar.o)
        // Full-opacity default color (same derivation as volData) — the developing
        // bar matches the closed bars instead of a lighter tint.
        const _vUp = boldCandles ? mbUp : modelBookLook ? BOLD_UP : cs.volume.upColor
        const _vDown = boldCandles ? mbDown : modelBookLook ? BOLD_DOWN : cs.volume.downColor
        volumeSeriesRef.current.update({
          time: tSec,
          value: data.bar.v,
          color: _up ? _vUp : _vDown,
        })
      }
      // B is the SOLE writer here (gated on barsPushActive above), so it OWNS these refs —
      // create-or-advance for THIS bar unconditionally, so at a bucket rollover they follow the
      // new bar even though the Finnhub writers are suppressed. Carry VOLUME on liveBarRef so the
      // post-setData re-top can restore it (else the developing bar shows ~30s-stale server
      // volume until the next AM push — a volume flicker every SWR poll, retro-audit #5).
      liveBarRef.current = { time: tSec, open: o, high: h, low: l, close: c, volume: data.bar.v }
      lastBarRef.current = { time: tSec, open: o, high: h, low: l, close: c, volume: data.bar.v }
    } catch {
      // lightweight-charts throws if `time` regresses below the series' last bar.
      // Silently ignore — out-of-order frames are rare and self-correct on next bar.
    }
  }, [cs.chartType, sym, resolvedTf, replayMode])

  const onRealtimeReconnect = useCallback((lastBarT) => {
    // Gap-backfill on reconnect — uses the existing `since` param of /api/bars.
    // `since` filters with strict > (see _get_bars_since_response). Subtract 1ms
    // so the bar at lastBarT is INCLUDED — covers the case where a bar updated
    // during the disconnect window and we need its authoritative server value.
    if (lastBarT == null || !sym) return
    const sinceMs = Math.max(0, lastBarT - 1)
    fetch(`/api/bars/${encodeURIComponent(sym)}?tf=${encodeURIComponent(resolvedTf)}&since=${sinceMs}`)
      .then(r => r.ok ? r.json() : null)
      .then(payload => {
        if (!payload?.bars?.length) return
        for (const b of payload.bars) {
          // /api/bars returns t in unix SECONDS, but onRealtimeBar expects ms
          // (matching the AM event shape). Multiply by 1000 to reconcile.
          onRealtimeBar({ sym, tf: resolvedTf, bar: { t: b.t * 1000, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v } })
        }
      })
      .catch(e => {
        if (e?.message) console.warn('[StockChart] gap-backfill failed:', e.message)
      })
  }, [sym, resolvedTf, onRealtimeBar])

  // Reactivity for the canary flag: setting/clearing localStorage 'uct.barsPush.enabled'
  // takes effect on the next render with NO page reload (the plan's instant runtime
  // revert). 'storage' fires cross-tab; a same-tab write dispatches 'uct-barspush-change'.
  const [, _bumpPushGate] = useState(0)
  useEffect(() => {
    const onChange = (e) => {
      if (!e || e.key == null || e.key === 'uct.barsPush.enabled' || e.type === 'uct-barspush-change') {
        _bumpPushGate(n => n + 1)
      }
    }
    window.addEventListener('storage', onChange)
    window.addEventListener('uct-barspush-change', onChange)
    return () => {
      window.removeEventListener('storage', onChange)
      window.removeEventListener('uct-barspush-change', onChange)
    }
  }, [])

  // Whether THIS chart subscribes to the bars pool + paints push, per _barsPushEnabled()
  // (currently default-ON at 100% rollout; a browser opts out with localStorage
  // 'uct.barsPush.enabled'='0'). Gating the SUBSCRIPTION on it is what made the rollout %
  // the real cohort lever (review blocker #1). VITE_REALTIME_BARS is an additional
  // compile-time cohort gate inside the hook.
  // !cs.heikinAshi: HA needs the full-series toHeikinAshi() recompute (which the 15s SWR
  // refresh does), NOT incremental raw-OHLC push updates. Under HA the chart neither
  // subscribes nor suppresses Finnhub — writers A/C already `if (cs.heikinAshi) return`, and
  // without this push writer B would paint a RAW candle amid HA-smoothed bars (retro-audit bug).
  const _pushOptIn = _barsPushEnabled() && realtimeTfEligible && liveUpdates && !cs.heikinAshi
  const _barsPush = useRealtimeBars({
    symbol: _pushOptIn ? sym : null,
    tf: _pushOptIn ? resolvedTf : null,
    onBar: onRealtimeBar,
    onReconnect: onRealtimeReconnect,
  })
  // Single-writer gate: engage push ONLY when opted-in, AND the pool is actually
  // DELIVERING recent bars for this (sym,tf) — never suppress the Finnhub writers on a
  // merely-connected or silently-frozen feed (that would freeze the candle while ● LIVE
  // still shows). delivering is bar-recency-gated in barsStreamManager.
  barsPushActiveRef.current = _pushOptIn && _barsPush.delivering

  // ── Chart update — reuses chart instance, swaps data via setData() ─────────
  const updateChart = useCallback(() => {
    if (!containerRef.current) return
    // No bars yet for this sym/tf? Clear the existing series so the prior
    // ticker's data doesn't visually persist on screen during transitions.
    // Without this, switching tickers leaves the OLD ticker's candles drawn
    // until the new SWR fetch returns — that's the "blended data" the user
    // sees flipping between charts.
    if (!filteredBars?.length) {
      try { candleSeriesRef.current?.setData([]) } catch {}
      try { volumeSeriesRef.current?.setData([]) } catch {}
      for (const s of overlaySeriesRefs.current) {
        try { s.setData([]) } catch {}
      }
      lastCfgSigRef.current = null
      return
    }

    // ── A2: incremental last-bar render (kills the 30s full repaint) ──────────
    // During RTH the 30s SWR poll delivers a changed DEVELOPING bar, which re-runs
    // this whole function and full-`setData`s every series (candle + volume + all
    // MAs + all indicators + markers) — a periodic wholesale repaint. When ONLY
    // the last bar's OHLCV changed AND the render config is byte-identical to the
    // last paint, we instead `series.update()` just the last point of each series
    // (which also makes MAs/indicators track the developing bar in real time
    // instead of lagging 30s). `_applyData` below routes every setData call
    // through this decision; it self-corrects to a full setData on ANY edge
    // (empty series, timestamp mismatch) so a wrong incremental can't stick.
    // Config guard: a config-only change yields plan 'noop' (bars identical) →
    // not 'incremental' → full paint; a config change coinciding with a bar tick
    // is caught by the cfgSig compare. Bias is hard to 'full' — a needless full
    // repaint is a wasted frame; a wrong incremental would be a data bug.
    let _cfgSig
    try {
      _cfgSig = JSON.stringify({
        sym, resolvedTf, chartType: cs.chartType, showVolume,
        cs, adjustTime, vwapOverride, hideWatermark, hidePriceLine, leftBarPad,
        modelBookLook, frozen, candleFrameFade, fadeCutoff, fitPriceToCandles,
        watermark, watermarkOpacity,
        ovN: overlayData?.length ?? 0,
        mkN: mergedMarkers?.length ?? 0,
        plN: allPriceLines?.length ?? 0,
        cmpN: comparisonData?.length ?? 0,
      })
    } catch {
      // A non-serializable setting must never break the chart — fail safe to a
      // full paint (null cfgSig guarantees _incr is false this run).
      _cfgSig = null
    }
    const _plan = barsRenderPlan(prevBarsRef.current, filteredBars)
    const _incr = _cfgSig != null && _plan.mode === 'incremental' && _cfgSig === lastCfgSigRef.current
    lastCfgSigRef.current = _cfgSig
    // TEMP DIAGNOSTIC — log only when the painted ticker changes (transitions are
    // rare, so this is quiet). A phantom-chart blip = an unexpected extra hop here.
    if (typeof window !== 'undefined' && window.__uctBarsDebug && paintSymRef.current !== `${sym}_${resolvedTf}`) {
      console.log('[bars-paint]', 'PAINT', `${sym}_${resolvedTf}`, 'prev:', paintSymRef.current,
        '| bars:', filteredBars.length, 'firstT:', filteredBars[0]?.t, 'lastT:', filteredBars[filteredBars.length - 1]?.t,
        '| mode:', _incr ? 'incremental' : 'full')
      paintSymRef.current = `${sym}_${resolvedTf}`
    }
    const _applyData = (series, data) => {
      if (!series || !data) return
      if (_incr && data.length) {
        try { series.update(data[data.length - 1]); return } catch { /* fall through to full setData */ }
      }
      try { series.setData(data) } catch {}
    }

    let chart = chartRef.current

    // ── Capture the OUTGOING ticker's vertical candle placement (proportional lock) ──
    // Runs only on a true ticker switch (same timeframe), BEFORE chartOpts re-applies
    // scaleMargins. We measure where the visible candles sit within the price pane as
    // top/bottom fractions. If that differs from the default headroom, the user has
    // dragged the price scale to reposition the candles — remember it so the next stock
    // lands in the same proportional spot (scaled to its own range). If it matches the
    // default, treat as "not customized" (null) so volume/indicator pane toggles still
    // re-flow normally.
    if (exactDateRange || !carryDragPlacement) {
      // Model Book frames each stock to a fixed year and should just autoscale —
      // the carry-the-drag-placement-across-tickers lock is inappropriate here and
      // compounds badly on huge back-adjusted/log-scale values (uploaded delisted
      // data), ballooning the price scale until the candles are a sliver.
      vertMarginsRef.current = null
    } else {
      const _zoomKey = `${sym}_${resolvedTf}`
      const _isFirstLoad = zoomKeyRef.current === null
      const _tfChanged = lastTfRef.current !== null && lastTfRef.current !== resolvedTf
      const _isSymSwitch = !_isFirstLoad && !_tfChanged && zoomKeyRef.current !== _zoomKey
      if (_isFirstLoad || _tfChanged) {
        vertMarginsRef.current = null
      } else if (_isSymSwitch && chart && candleSeriesRef.current) {
        try {
          const prevBars = prevBarsRef.current
          const vr = chart.timeScale().getVisibleLogicalRange()
          if (prevBars && prevBars.length && vr) {
            const s = Math.max(0, Math.floor(vr.from))
            const e = Math.min(prevBars.length - 1, Math.ceil(vr.to))
            let hi = -Infinity, lo = Infinity
            for (let i = s; i <= e; i++) {
              const b = prevBars[i]
              if (!b) continue
              if (b.h > hi) hi = b.h
              if (b.l < lo) lo = b.l
            }
            let paneH = 0
            try { paneH = chart.paneSize().height } catch {}
            if (!(paneH > 0)) { try { paneH = (containerRef.current?.clientHeight || 0) - chart.timeScale().height() } catch {} }
            const series = candleSeriesRef.current
            if (hi > lo && paneH > 8) {
              const yHi = series.priceToCoordinate(hi)
              const yLo = series.priceToCoordinate(lo)
              if (yHi != null && yLo != null) {
                let top = Math.min(0.9, Math.max(0, yHi / paneH))
                let bottom = Math.min(0.9, Math.max(0, (paneH - yLo) / paneH))
                if (top + bottom > 0.95) { const k = 0.95 / (top + bottom); top *= k; bottom *= k }
                const base = _mainMargins(cs, showVolume && volData.length > 0 && !volInSeparatePane, priceScaleTopMargin, volInSeparatePane ? priceScaleBottomMargin : null)
                // Only treat as a custom placement if it meaningfully differs from default.
                if (Math.abs(top - base.top) < 0.03 && Math.abs(bottom - base.bottom) < 0.03) {
                  vertMarginsRef.current = null
                } else {
                  vertMarginsRef.current = { top: +top.toFixed(4), bottom: +bottom.toFixed(4) }
                }
              }
            }
          }
        } catch {}
      }
    }

    // ── Create or update chart instance ──
    const chartOpts = {
      layout: {
        background: themeColors.layoutTransparent
          ? { type: ColorType.Solid, color: 'rgba(255,255,255,0)' }   // transparent → container gradient shows through (continuous across panes)
          : themeColors.backgroundGradient
            ? { type: ColorType.VerticalGradient, topColor: themeColors.backgroundGradient.top, bottomColor: themeColors.backgroundGradient.bottom }
            : { type: ColorType.Solid, color: themeColors.background },
        textColor: themeColors.textColor,
        fontFamily: "'Instrument Sans', sans-serif",
        fontSize: 10,
        attributionLogo: false,  // hide built-in TradingView logo; we overlay the UCT mark instead
        // Model Book: subtle (not bold gray) pane divider; still draggable.
        ...((boldCandles || subtleSeparator) ? { panes: { separatorColor: canvasTheme === 'sunrise' ? 'rgba(30,42,58,0.5)' : 'rgba(255,255,255,0.18)', separatorHoverColor: canvasTheme === 'sunrise' ? 'rgba(30,42,58,0.7)' : 'rgba(255,255,255,0.32)', enableResize: !frozen } } : {}),
      },
      // Frozen (Setup Library examples): the chart is a static exhibit pinned to
      // its framed window — no pan/zoom/axis-drag, and the wheel is left alone so
      // it scrolls the PAGE instead of the chart.
      // Plain mouse-drag PANS the chart (default). Drag-to-measure is gated behind
      // Ctrl: onDown sets measureLockRef while Ctrl+dragging so the chart stays put.
      // Computed here (re-runs on data polls) so a poll can't unlock mid-measure.
      handleScroll: (frozen || measureLockRef.current) ? false : true,
      handleScale: frozen || measureLockRef.current ? false : true,
      grid: {
        vertLines: { color: cs.grid.visible ? themeColors.gridColor : 'transparent' },
        horzLines: { color: cs.grid.visible ? themeColors.gridColor : 'transparent' },
      },
      crosshair: hideCrosshair ? {
        mode: 0,
        // Fully suppress both crosshair lines + their axis labels (Setup Library examples).
        vertLine: { visible: false, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      } : {
        mode: cs.crosshair.magnet ? 1 : 0,  // 1 = Magnet (snaps to OHLC), 0 = Normal
        vertLine: { color: themeColors.crosshairColor, width: 1, style: cs.crosshair.style, labelBackgroundColor: themeColors.background },
        horzLine: { color: themeColors.crosshairColor, width: 1, style: cs.crosshair.style, labelBackgroundColor: themeColors.background },
      },
      rightPriceScale: {
        borderColor: themeColors.borderColor,
        // Pin a stable minimum width so the axis can't re-flow as the developing
        // bar's live last-value label re-renders. At fractional display scaling
        // (e.g. Windows 125/150%) that label's sub-pixel width jitters every price
        // tick; a floating price-scale width made the whole plot shift left/right
        // in lockstep with the quotes (the "chart jiggles on every tick" bug).
        // 76px covers up to ~5-digit prices; the axis simply stops shrinking below it.
        minimumWidth: 76,
        // Locked proportional placement (carried across ticker switches) wins over the
        // default headroom. vertMarginsRef is captured in fractions of the pane, so the
        // candles land in the same relative spot regardless of the stock's price.
        scaleMargins: vertMarginsRef.current || _mainMargins(cs, showVolume && volData.length > 0 && !volInSeparatePane, priceScaleTopMargin, volInSeparatePane ? priceScaleBottomMargin : null),
      },
      localization: {
        // Crosshair time label (the hover box on the axis): weekday + date +
        // 12-hour time, e.g. "Tue 14 Jul '26 12:00 AM".
        timeFormatter: chartCrosshairTimeFormatter,
      },
      timeScale: {
        borderColor: themeColors.borderColor,
        timeVisible: true,
        secondsVisible: false,
        // Bottom-axis tick labels: 12-hour on intraday (default is 24-hour).
        tickMarkFormatter: chartTickMarkFormatter,
        // Exact-range (Model Book) locks to a historical window, so don't pin the
        // latest bar to the right edge — that re-expands the view to "now".
        rightOffset: exactDateRange ? 0 : rightPadBars,
        rightBarStaysOnScroll: exactDateRange ? false : true,
        // Setup → Result appends the result-era bars while the view sits ON the
        // last bar; LWC's default then shifts the window to the new last bar
        // BEFORE the pin effect's glide starts — the "snaps right, then zooms"
        // bug. Exact-range charts are frozen historical windows: never
        // auto-shift them.
        shiftVisibleRangeOnNewBar: exactDateRange ? false : true,
      },
    }

    if (!chart) {
      chart = createChart(containerRef.current, { ...chartOpts, autoSize: true })
      chartRef.current = chart
      setChartReady(true)
    } else {
      // Re-apply cosmetic/config options on an EXISTING chart, but NOT the
      // view-scroll options (rightOffset / rightBarStaysOnScroll /
      // shiftVisibleRangeOnNewBar). Those are set once at creation; re-applying
      // rightOffset here RE-SCROLLS the chart to the right edge, snapping the
      // view back whenever the user has panned/zoomed/dragged the price scale
      // ("chart skips periods / jumps"). Omitting them from the partial
      // timeScale update leaves LWC's current scroll position untouched. The
      // zoom-anchoring logic below still sets the visible range explicitly on
      // sym/tf switches and data-phase swaps.
      const { rightOffset: _ro, rightBarStaysOnScroll: _rbs, shiftVisibleRangeOnNewBar: _svr, ...tsSafe } = chartOpts.timeScale
      chart.applyOptions({ ...chartOpts, timeScale: tsSafe })
    }

    // ── Symbol watermark (custom v5 pane primitive, behind series) ──
    if (!wmCtrlRef.current) {
      wmCtrlRef.current = createWatermarkPrimitive({ x: cs.watermark.x, y: cs.watermark.y })
    }
    if (!wmAttachedRef.current) {
      try {
        chart.panes()[0].attachPrimitive(wmCtrlRef.current.primitive)
        wmAttachedRef.current = true
      } catch { /* older pane API — primitive optional */ }
    }
    {
      const wmLines = (cs.watermark.visible && !hideWatermark)
        ? composeWatermarkLines(watermark ?? sym, watermarkMeta, cs.watermark.lines)
        : []
      // centerWatermarkOnPlot: pin the horizontal center to the middle of the
      // WHOLE widget — the candle plot PLUS the right price-axis gutter — measured
      // from the pane's left edge (= widget's left edge; there's no left axis). So
      // it's centered between the outer left/right edges of the widget, not just
      // the candle area. Falls back to watermarkCenterX otherwise.
      let _wmCenterX = watermarkCenterX
      if (centerWatermarkOnPlot) {
        try {
          const _tw = chart.timeScale().width()
          let _aw = 0; try { _aw = chart.priceScale('right').width() || 0 } catch { /* no right axis */ }
          if (_tw > 0) _wmCenterX = (_tw + _aw) / 2
        } catch { /* keep fallback */ }
      }
      wmCtrlRef.current.setOptions({
        lines: wmLines,
        color: cs.watermark.color,
        opacity: watermarkOpacity ?? cs.watermark.opacity,
        sizeScale: cs.watermark.sizeScale,
        x: watermarkX ?? cs.watermark.x,
        y: watermarkY ?? cs.watermark.y,
        ...(watermarkPad != null ? { padX: watermarkPad, padTop: watermarkPadTop ?? watermarkPad } : {}),
        hardCenterXPx: _wmCenterX,
      })
    }

    // ── Extended-hours shading (custom v5 pane primitive, behind series) ──
    if (!sessionShadeRef.current) {
      sessionShadeRef.current = createSessionShadingPrimitive({})
    }
    if (!sessionShadeAttachedRef.current) {
      try {
        chart.panes()[0].attachPrimitive(sessionShadeRef.current.primitive)
        sessionShadeAttachedRef.current = true
      } catch { /* older pane API — primitive optional */ }
    }
    {
      const shadeOn = !!cs.extendedHoursShading && isIntraday
      sessionShadeRef.current.setOptions({
        enabled: shadeOn,
        bands: shadeOn ? computeSessionBands(filteredBars, adjustTime) : [],
      })
    }

    // Price-scale mode (Normal/Log/Percent) is applied by a dedicated effect
    // keyed on `effectiveScale`, so the A/L/% toggle and the forceLogScale
    // default both take effect immediately (and survive data updates).

    // ── Price series — reuse if chart type unchanged, else swap ──
    // When swapping the candle series, the markers controller is bound to the
    // old series — detach it so the next markers update creates a fresh
    // controller against the new series.
    const _priceStyleKey = `${cs.chartType || 'candles'}|${canvasTheme || ''}`
    if (prevChartTypeRef.current !== _priceStyleKey && candleSeriesRef.current) {
      try { chart.removeSeries(candleSeriesRef.current) } catch {}
      candleSeriesRef.current = null
      try { markersControllerRef.current?.detach?.() } catch {}
      markersControllerRef.current = null
      focusProviderInstalledRef.current = false  // new series needs the focus autoscale provider re-attached
      swingAttachedRef.current = false           // swing-label primitive must re-attach to the new series
    }

    if (!candleSeriesRef.current) {
      let priceSeries
      switch (cs.chartType) {
        case 'hollow':
          priceSeries = chart.addSeries(CandlestickSeries, {
            upColor: 'transparent', downColor: cs.candles.downColor,
            borderUpColor: cs.candles.upColor, borderDownColor: cs.candles.downColor,
            wickUpColor: cs.candles.upWick, wickDownColor: cs.candles.downWick,
          })
          break
        case 'bars':
          priceSeries = chart.addSeries(BarSeries, {
            upColor: cs.candles.upColor, downColor: cs.candles.downColor,
          })
          break
        case 'line':
          priceSeries = chart.addSeries(LineSeries, {
            color: cs.candles.upColor, lineWidth: 2,
          })
          break
        case 'area':
          priceSeries = chart.addSeries(AreaSeries, {
            lineColor: cs.candles.upColor,
            topColor: cs.candles.upColor + '66',
            bottomColor: cs.candles.upColor + '08',
            lineWidth: 2,
          })
          break
        default: // 'candles'
          priceSeries = chart.addSeries(CandlestickSeries, {
            upColor: cs.candles.upColor, downColor: cs.candles.downColor,
            borderUpColor: cs.candles.upBorder, borderDownColor: cs.candles.downBorder,
            wickUpColor: cs.candles.upWick, wickDownColor: cs.candles.downWick,
          })
      }
      candleSeriesRef.current = priceSeries
      // Model Book studies a past year — the current (latest) price line is
      // irrelevant there, so hide the dotted last-price line for exact-range.
      // boldCandles paints solid bright green/red; hideLastValue drops the
      // right-axis price tag. Both only apply to instances that opt in.
      try {
        // The intraday popup (modelBookLook) shares the Model Book main chart's
        // solid bold green/red so the two charts match exactly — without it the
        // popup falls back to the lighter default cs.candles palette.
        // Model Book (boldCandles) gets the punchier TC2000 palette (vivid green
        // / deep red); the intraday popup (modelBookLook) keeps the base bold one.
        const _bUp = boldCandles ? mbUp : BOLD_UP
        const _bDown = boldCandles ? mbDown : BOLD_DOWN
        const _bold = canvasTheme === 'sunrise' ? {
          // Sunrise default = HOLLOW candles (TC2000 look): up = hollow body + dark
          // green outline; down = filled dark red. Same palette as the volume bars.
          upColor: 'rgba(0,0,0,0)', downColor: mbDown,
          borderVisible: true, borderUpColor: mbUp, borderDownColor: mbDown,
          wickUpColor: mbUp, wickDownColor: mbDown,
        } : (boldCandles || modelBookLook) ? {
          upColor: _bUp, downColor: _bDown,
          borderVisible: false,                       // pure solid bodies (TC2000 look)
          wickUpColor: _bUp, wickDownColor: _bDown,
        } : {}
        // Optional integer-only price axis (DarkPool page passes precision:0
        // for large-cap stocks so the axis shows "200" not "200.00").
        const _priceFormat = priceFormat ? { priceFormat } : {}
        priceSeries.applyOptions({ priceLineVisible: !exactDateRange && !hidePriceLine, lastValueVisible: !hideLastValue, ..._bold, ..._priceFormat })
      } catch { /* older LWC */ }

      // ── colorByNetChange ── Color each candle by close-vs-PREVIOUS-close (TC2000 /
      // StockCharts style) instead of LWC's built-in close-vs-open. LWC only auto-colors
      // by open/close at the series level, so net-change coloring requires a per-bar
      // color/borderColor/wickColor override on the DATA. Rather than touch the ~20
      // developing-bar writer sites, we wrap the series' setData/update ONCE here so every
      // write path (historical setData, gold setup/catalyst highlight, live ticks) is
      // colored consistently. Gated on the prop → only opted-in charts are affected; the
      // gold-highlight override is preserved (bars that already carry an explicit color
      // are left untouched). Candles + OHLC bars only (line/area/hollow have no net-change
      // notion). Same up/down palette the series itself uses so it looks identical apart
      // from the coloring rule.
      if (colorByNetChange && (cs.chartType === 'candles' || cs.chartType === 'bars') && !priceSeries.__uctNetWrap) {
        const _netUp = boldCandles ? mbUp : (modelBookLook ? BOLD_UP : cs.candles.upColor)
        const _netDown = boldCandles ? mbDown : (modelBookLook ? BOLD_DOWN : cs.candles.downColor)
        // Sunrise keeps the HOLLOW look while still coloring by NET CHANGE: a
        // net-change-up bar is hollow (transparent body + green outline); a
        // net-change-down bar is filled red. Every other theme stays solid.
        const _hollowNet = canvasTheme === 'sunrise'
        const _paintNet = (bar, prevClose) => {
          if (!bar || bar.close == null || prevClose == null) return bar
          if (bar.color != null) return bar   // preserve an explicit override (gold highlight)
          const up = bar.close >= prevClose
          const c = up ? _netUp : _netDown
          const body = (_hollowNet && up) ? 'rgba(0,0,0,0)' : c
          return { ...bar, color: body, borderColor: c, wickColor: c }
        }
        const _realSet = priceSeries.setData.bind(priceSeries)
        const _realUpd = priceSeries.update.bind(priceSeries)
        priceSeries.setData = (data) => {
          if (!Array.isArray(data)) return _realSet(data)
          let prev = null, lastPrev = null
          const painted = data.map((b) => {
            if (b && b.close != null) {
              lastPrev = prev
              const out = _paintNet(b, prev)
              prev = b.close
              return out
            }
            return b
          })
          // Refs the update() wrap reads for the developing bar: prev-of-last & the last bar.
          netPrevCloseRef.current = lastPrev
          lastNetCloseRef.current = prev
          lastNetTimeRef.current = painted.length ? data[data.length - 1]?.time : null
          return _realSet(painted)
        }
        priceSeries.update = (bar) => {
          if (!bar || bar.close == null) return _realUpd(bar)
          const isNewBar = lastNetTimeRef.current != null && bar.time > lastNetTimeRef.current
          const prevClose = isNewBar ? lastNetCloseRef.current : netPrevCloseRef.current
          const out = _paintNet(bar, prevClose)
          if (isNewBar) { netPrevCloseRef.current = lastNetCloseRef.current; lastNetTimeRef.current = bar.time }
          lastNetCloseRef.current = bar.close
          return _realUpd(out)
        }
        priceSeries.__uctNetWrap = true
      }
      prevChartTypeRef.current = _priceStyleKey
    }

    // Set price data. The separate gold-recolor effect below re-applies the
    // setup-candle highlight right after every updateChart (it lists updateChart
    // as a dep), so we keep plain data here — pulling highlightTimeSet into THIS
    // effect's deps would re-run the whole updateChart (incl. the visible-range /
    // zoom logic) on every focus change and fight the setup focus zoom.
    _applyData(candleSeriesRef.current, isOhlcType(cs.chartType) ? ohlcData : closeData)

    // Store the last bar for live updates
    if (filteredBars.length) {
      const last = filteredBars[filteredBars.length - 1]
      // Use adjustTime so lastBarRef.time matches the chart series + computeBarTime
      lastBarRef.current = { time: adjustTime(last.t), open: last.o, high: last.h, low: last.l, close: last.c, volume: last.v || 0 }
      // Trustworthy baseline for live-tick sanity gates: server bars are
      // validated/quarantined upstream and proven clean. Unlike
      // lastBarRef (which a bad tick can bake bad, then good ticks get
      // rejected and the phantom sticks — DDOG 20798 = 100x lock-in),
      // this is ONLY ever set from server data and can't be poisoned.
      if (Number.isFinite(last.c) && last.c > 0) lastServerCloseRef.current = last.c
    }

    // For the Finnhub re-top below: prefer the frozen tick for THIS ticker; on a
    // ticker switch (latestLiveRef was just reset to null) seed from the
    // synchronously-available shared live cache (livePrices[sym]) so the developing
    // candle paints at the TRUE current price on the FIRST frame instead of the
    // stale server close that otherwise snapped ~1s later when the first tick
    // arrived. Cold/uncached ticker → null → prior ~1s behaviour, no regression.
    // Sane-price guard mirrors Writers A/B (baseline = the just-refreshed server close).
    let _retopLive = (latestLiveRef.current?.sym === sym && latestLiveRef.current?.price)
      ? latestLiveRef.current
      : null
    if (!_retopLive && !barsPushActiveRef.current) {
      // livePrices (the hook) is filtered to THIS chart's subscription, which on a
      // switch hasn't registered the new sym yet → empty on the switch frame. The
      // livePriceStore GLOBAL snapshot holds every ticker any widget tracks
      // (watchlist / movers / themes), synchronously → seed from it as a fallback.
      const _cached = livePrices[sym] || getLivePriceStoreSnapshot()[sym]
      const _cachedPx = _effLivePrice(_cached)
      if (_cachedPx && isSaneLivePrice(_cachedPx, lastBarRef.current?.close, lastServerCloseRef.current)) {
        _retopLive = {
          sym, price: _cachedPx, updated_at: _cached.updated_at,
          day_open: _cached.day_open, day_high: _cached.day_high,
          day_low: _cached.day_low, prev_close: _cached.prev_close,
          ext_session: !!_cached.ext_session,
        }
      }
    }

    // Re-apply the live developing bar immediately after setData() to prevent snap-back —
    // setData() overwrites with API data (stale by seconds/minutes).
    if (barsPushActiveRef.current) {
      // Writer D of the single-writer invariant (index @ barsPushActiveRef decl) — a BRANCH,
      // not a guard: push authoritative → re-top with the PUSH-owned developing bar (liveBarRef,
      // maintained by onRealtimeBar), NOT the frozen Finnhub latestLiveRef. Without this
      // the ~30s-stale server developing bar from _applyData would seam every SWR poll
      // (review #7). Guard time-regress (server tail may be ahead of the last push bar).
      const lb = liveBarRef.current
      if (lb && lb.time != null && Number.isFinite(lb.close) && lb.close > 0) {
        try {
          if (isOhlcType(cs.chartType)) {
            candleSeriesRef.current.update({ time: lb.time, open: lb.open, high: lb.high, low: lb.low, close: lb.close })
          } else {
            candleSeriesRef.current.update({ time: lb.time, value: lb.close })
          }
          // Restore the push-owned volume too — else the volume bar shows ~30s-stale server
          // volume until the next AM push (a flicker every SWR poll, retro-audit #5).
          if (volumeSeriesRef.current && Number.isFinite(lb.volume)) {
            const _pbD = prevBarsRef.current
            const _prevCD = colorByNetChange && _pbD && _pbD.length >= 2 ? _pbD[_pbD.length - 2].c : null
            const _upD = _prevCD != null ? (lb.close >= _prevCD) : (lb.close >= lb.open)
            // Full-opacity default color (same derivation as volData) — no lighter tint.
            const _vUpD = boldCandles ? mbUp : modelBookLook ? BOLD_UP : cs.volume.upColor
            const _vDownD = boldCandles ? mbDown : modelBookLook ? BOLD_DOWN : cs.volume.downColor
            volumeSeriesRef.current.update({
              time: lb.time, value: lb.volume,
              color: _upD ? _vUpD : _vDownD,
            })
          }
        } catch { /* server tail newer than the last push bar — ignore, next push bar re-tops */ }
      }
    } else if (_retopLive?.price && lastBarRef.current
               && !(['D', 'W', 'M'].includes(resolvedTf)
                    && (sessionOwnsDailyRef.current
                        || (sessionViewRef.current === 'regular' && _retopLive.ext_session)))
               && !(!['D', 'W', 'M'].includes(resolvedTf)
                    && !showExtendedRef.current && _retopLive.ext_session)) {
      // Skip the D/W/M re-top while session preview owns the bar (the memo-driven
      // setData above already painted the synthetic/frozen candle) OR when a
      // Regular-Hours daily chart got an extended-hours print (same lag-independent
      // guard as Writer A). Also skip an RTH-only INTRADAY re-top of an ext print
      // (Writers B/C already drop the live ext bar; don't let the re-top re-add it).
      const lp = _retopLive.price
      const tickSec = _retopLive.updated_at
      const last = lastBarRef.current
      const isIntradayTf = !['D', 'W', 'M'].includes(resolvedTf)
      const liveSnap = _retopLive
      // Same shared classifier as the tick effect — start today's bar from the
      // snapshot even on the REST floor (no updated_at), never fuse onto a stale
      // prior-session candle. 'skip' = new D/W/M day, session unconfirmed.
      const decision = classifyLiveBar({
        tf: resolvedTf, last, live: liveSnap, tickSec, nowSec: Date.now() / 1000,
      })
      const barTime = decision.time != null ? decision.time : last.time

      // Use liveBarRef if available — it has tick-accurate high/low that survives setData()
      const lb = liveBarRef.current

      if (decision.kind === 'new') {
        const isDW = !isIntradayTf
        const openPrice = (isDW && liveSnap.day_open) ? liveSnap.day_open : (lb ? lb.open : lp)
        const highPrice = isDW ? Math.max(liveSnap.day_high || openPrice, lp) : (lb ? Math.max(lb.high, lp) : lp)
        const lowPrice = isDW ? Math.min((liveSnap.day_low && liveSnap.day_low > 0) ? liveSnap.day_low : openPrice, lp) : (lb ? Math.min(lb.low, lp) : lp)
        const newBar = { time: barTime, open: openPrice, high: highPrice, low: lowPrice, close: lp }
        if (isOhlcType(cs.chartType)) {
          candleSeriesRef.current.update(newBar)
        } else {
          candleSeriesRef.current.update({ time: barTime, value: lp })
        }
        liveBarRef.current = { ...newBar }
        lastBarRef.current = { ...newBar, volume: 0 }
      } else if (decision.kind === 'skip') {
        // New day for D/W/M but no confirmed session — don't corrupt yesterday's bar
      } else {
        // Same bar — restore tick-tracked high/low from liveBarRef
        const high = lb ? Math.max(lb.high, lp) : Math.max(last.high, lp)
        const low = lb ? Math.min(lb.low, lp) : Math.min(last.low, lp)
        last.high = high
        last.low = low
        last.close = lp
        if (lb) { lb.high = high; lb.low = low; lb.close = lp }
        if (isOhlcType(cs.chartType)) {
          candleSeriesRef.current.update({ time: last.time, open: last.open, high, low, close: lp })
        } else {
          candleSeriesRef.current.update({ time: last.time, value: lp })
        }
      }
    }

    // ── Volume-pane indicator overlay ──
    // Chosen oscillators render INSIDE the volume pane on its left axis (volume
    // keeps the right axis) instead of their own stacked band. This requires a
    // real volume pane, so any overlay forces separate-pane mode.
    const volOverlaySet = new Set(
      (showVolume && Array.isArray(cs.volumeOverlayIndicators)) ? cs.volumeOverlayIndicators : [],
    )

    // ── Volume series — overlay band in pane 0 (default) OR its own pane 1 ──
    // Separate-pane mode uses a real LW Charts pane (3rd addSeries arg) with a
    // draggable divider; overlay mode shares pane 0 via computePaneMargins bands.
    const volSeparatePane = volInSeparatePane || volOverlaySet.size > 0
    const paneMargins = computePaneMargins(cs, showVolume && volData.length > 0 && !volSeparatePane, volOverlaySet)
    const VOL_PANE_INDEX = 1
    // Resolve an indicator's target (pane + price-scale id). Overlaid → volume
    // pane's left axis; otherwise its own named scale in pane 0 (= today).
    const indTarget = (key) => (volSeparatePane && volOverlaySet.has(key))
      ? { pane: VOL_PANE_INDEX, scaleId: 'left' }
      : { pane: 0, scaleId: key }
    // Recreate the series when its target scale changes (scale id / pane are
    // fixed at creation). refs = the series ref(s) for that indicator.
    const ensureIndTarget = (key, refs) => {
      const tgt = indTarget(key)
      if (indScaleRef.current[key] != null && indScaleRef.current[key] !== tgt.scaleId) {
        for (const r of refs) { if (r.current) { try { chart.removeSeries(r.current) } catch {}; r.current = null } }
      }
      indScaleRef.current[key] = tgt.scaleId
      return tgt
    }
    // Apply the scale options for an indicator given its target. Overlaid uses a
    // visible, autoscaled left axis; non-overlaid keeps its pane-0 band config.
    const applyIndScale = (key, series, tgt, bandExtra) => {
      try {
        if (tgt.scaleId === 'left') {
          series.priceScale().applyOptions({ borderVisible: false, visible: true, autoScale: true, scaleMargins: { top: 0.12, bottom: 0.04 } })
        } else {
          series.priceScale().applyOptions({ borderVisible: false, scaleMargins: paneMargins[key] || { top: 0.82, bottom: 0 }, ...(bandExtra || {}) })
        }
      } catch {}
    }
    if (showVolume && volData.length) {
      // Separate-pane volume sits on the pane's RIGHT axis (visible) so an
      // overlaid indicator can take the LEFT axis. Overlay mode keeps the
      // invisible overlay scale ('').
      const volScaleId = volSeparatePane ? 'right' : ''
      // priceScaleId / paneIndex are fixed at creation, so recreate when the
      // target scale changes (overlay <-> separate pane, or legacy migration).
      if (volumeSeriesRef.current && volumeSeparatePaneRef.current !== volScaleId) {
        try { chart.removeSeries(volumeSeriesRef.current) } catch {}
        volumeSeriesRef.current = null
      }
      if (!volumeSeriesRef.current) {
        const vs = chart.addSeries(HistogramSeries, {
          priceFormat: { type: 'volume' },
          priceScaleId: volScaleId,
          // Model Book: no dashed last-volume price line / axis tag.
          priceLineVisible: !boldCandles && !hidePriceLine,
          // volumeLastValue opt-in shows the current-volume tag on the right scale
          // (mirrors the main chart's price tag) even in the bold/charts-workspace look.
          lastValueVisible: volumeLastValue || (!boldCandles && !hidePriceLine),
        }, volSeparatePane ? 1 : 0)
        volumeSeriesRef.current = vs
        volumeSeparatePaneRef.current = volScaleId
        lastAppliedVolPctRef.current = null  // fresh pane → force the height (re)apply below
      }
      if (volSeparatePane) {
        // Own pane: small top margin so bars don't kiss the divider; size the
        // pane to ~22% of the chart via stretch factors (main pane gets the rest).
        volumeSeriesRef.current.priceScale().applyOptions({ borderVisible: false, scaleMargins: { top: 0.12, bottom: 0 } })
        try {
          // Stretch factors are relative. Address panes by their series' own
          // pane object (getPane) rather than raw index, so an index-comparison
          // pane on top (Model Book) doesn't get mis-sized when this re-runs.
          const pct = Math.min(45, Math.max(8, volumePaneHeightPct ?? cs.volume.paneHeightPct ?? 22))
          const mainPane = candleSeriesRef.current?.getPane?.()
          const volPane = volumeSeriesRef.current?.getPane?.()
          // Only (re)apply when the TARGET height changed — otherwise a periodic
          // data-poll re-run would snap the pane back and undo a user's drag.
          if (mainPane && volPane && lastAppliedVolPctRef.current !== pct) {
            lastAppliedVolPctRef.current = pct
            if (indexPaneSeriesRef.current) {
              const idxPct = Math.min(40, Math.max(8, indexPaneHeightPct ?? 18))
              try { indexPaneSeriesRef.current.getPane().setStretchFactor(idxPct) } catch {}
              volPane.setStretchFactor(pct)
              mainPane.setStretchFactor(Math.max(20, 100 - pct - idxPct))
            } else {
              mainPane.setStretchFactor(100 - pct)
              volPane.setStretchFactor(pct)
            }
          }
        } catch {}
      } else {
        const volMargins = paneMargins.volume || { top: 0.82, bottom: 0 }
        volumeSeriesRef.current.priceScale().applyOptions({ scaleMargins: volMargins })
      }
      _applyData(volumeSeriesRef.current, volData)

      // Subtle smooth volume MA line on the same pane/scale as the bars.
      if (volumeMa && volMaData.length) {
        // candleFrameFade: split the volume MA into base (≤ setup day) + a fading
        // tail past it, so it crossfades with the candles / volume / price MAs.
        const _vmFade = candleFrameFade && fadeCutoff != null
        const _vmCut = _vmFade ? String(fadeCutoff) : null
        const baseVM = _vmFade ? volMaData.filter(p => String(p.time) <= _vmCut) : volMaData
        const tailVM = _vmFade ? volMaData.filter(p => String(p.time) >= _vmCut) : null
        const _vmPane = volSeparatePane ? VOL_PANE_INDEX : 0
        const _vmOpts = {
          lineWidth: 1, lineType: LineType.Curved, priceScaleId: volScaleId,
          priceLineVisible: false, lastValueVisible: false,
          crosshairMarkerVisible: false, autoscaleInfoProvider: () => null,
        }
        if (!volMaSeriesRef.current) {
          volMaSeriesRef.current = chart.addSeries(LineSeries, { color: VOL_MA_COLOR, ..._vmOpts }, _vmPane)
        }
        _applyData(volMaSeriesRef.current, baseVM)
        if (_vmFade) {
          const vmTailColor = colorMulAlpha(VOL_MA_COLOR, frameFadeAlphaRef.current)
          if (!volMaTailSeriesRef.current) {
            volMaTailSeriesRef.current = chart.addSeries(LineSeries, { color: vmTailColor, ..._vmOpts }, _vmPane)
          } else {
            volMaTailSeriesRef.current.applyOptions({ color: vmTailColor })
          }
          volMaTailSeriesRef.current.setData(tailVM)
        } else if (volMaTailSeriesRef.current) {
          try { chart.removeSeries(volMaTailSeriesRef.current) } catch {}
          volMaTailSeriesRef.current = null
        }
      } else if (volMaSeriesRef.current) {
        try { chart.removeSeries(volMaSeriesRef.current) } catch {}
        volMaSeriesRef.current = null
        if (volMaTailSeriesRef.current) { try { chart.removeSeries(volMaTailSeriesRef.current) } catch {}; volMaTailSeriesRef.current = null }
      }
    } else if (volumeSeriesRef.current) {
      try { chart.removeSeries(volumeSeriesRef.current) } catch {}
      volumeSeriesRef.current = null
      if (volMaSeriesRef.current) { try { chart.removeSeries(volMaSeriesRef.current) } catch {}; volMaSeriesRef.current = null }
      if (volMaTailSeriesRef.current) { try { chart.removeSeries(volMaTailSeriesRef.current) } catch {}; volMaTailSeriesRef.current = null }
    }

    // ── Overlay lines — reuse series where possible ──
    // Remove excess overlay series
    while (overlaySeriesRefs.current.length > overlayData.length) {
      const old = overlaySeriesRefs.current.pop()
      try { chart.removeSeries(old) } catch {}
    }
    // candleFrameFade: each MA is split into a base segment (up to the setup day,
    // always full) + a tail segment (past it) whose opacity crossfades with the
    // candles on a Setup⇄Result flip. At full opacity the two read as one line.
    const _fadeMA = candleFrameFade && fadeCutoff != null
    const _cut = _fadeMA ? String(fadeCutoff) : null
    const _tailAlpha = frameFadeAlphaRef.current
    while (overlayTailSeriesRefs.current.length > (_fadeMA ? overlayData.length : 0)) {
      const old = overlayTailSeriesRefs.current.pop()
      try { chart.removeSeries(old) } catch {}
    }
    // Update existing or add new overlay series. CRITICAL: when an existing
    // overlay's new data is empty (e.g. switched to a recent IPO with too few
    // bars to compute SMA200), we must explicitly clear it. The previous
    // `if (!ovData.length) continue` left the OLD ticker's overlay line visible.
    for (let i = 0; i < overlayData.length; i++) {
      const { data: ovData } = overlayData[i]
      let color = overlayData[i].color
      // Charts workspace: repaint the 9-EMA in the candle up-color (MB_UP) so the
      // fast MA matches the candles. Reliable regardless of saved overlay colors.
      const _ov = resolvedOverlays?.[i]
      if (ema9MatchCandle && _ov?.type === 'EMA' && Number(_ov?.period) === 9) color = MB_UP
      // Split into base (≤ setup day) + tail (≥ setup day) when fading; the shared
      // cutoff point joins them so the line is seamless at full opacity.
      const baseData = _fadeMA ? ovData.filter(p => String(p.time) <= _cut) : ovData
      // The tail is the post-setup segment. In the steady SETUP view the frame ends
      // ON the setup day, so the filter yields exactly one point (the cutoff itself)
      // — and a single-point curved LineSeries renders as a stray flat horizontal
      // dash past the last candle. Collapse it to empty so the MA just ends cleanly
      // at the setup day; the tail only carries real data during the Setup⇄Result
      // fade and in the Result view (where it has many points).
      const _tailRaw = _fadeMA ? ovData.filter(p => String(p.time) >= _cut) : null
      const tailData = _tailRaw && _tailRaw.length >= 2 ? _tailRaw : []
      // Model Book renders MAs as smooth curves (TradingView look) instead of
      // the default straight-segment polyline.
      const _ovLineType = (boldCandles || modelBookLook) ? LineType.Curved : LineType.Simple
      // 0.5 floors to a true 1px hairline on retina (lineWidth*dpr), thinner than
      // the standard 1; non-retina stays ~1px. Model Book (boldCandles) + the
      // intraday popup (modelBookLook) use it.
      const _ovLineWidth = (boldCandles || modelBookLook) ? 0.5 : 1
      // fitPriceToCandles: MAs contribute NO price range, so the scale fits the
      // candles only and a far 200MA clips off-screen instead of squashing price.
      const _ovAutoscale = fitPriceToCandles ? () => ({ priceRange: null }) : () => null
      if (i < overlaySeriesRefs.current.length) {
        // Reuse existing series — always setData (even empty) to clear stale data
        overlaySeriesRefs.current[i].applyOptions({ color, lineType: _ovLineType, lineWidth: _ovLineWidth, autoscaleInfoProvider: _ovAutoscale })
        _applyData(overlaySeriesRefs.current[i], baseData)
      } else if (baseData.length) {
        // Add new series only if there's data to show
        const ls = chart.addSeries(LineSeries, {
          color,
          lineWidth: _ovLineWidth,
          lineType: _ovLineType,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false,
          autoscaleInfoProvider: _ovAutoscale,
        })
        ls.setData(baseData)
        overlaySeriesRefs.current.push(ls)
      }
      // The fading tail (only the post-setup portion).
      if (_fadeMA) {
        const tailColor = colorWithAlpha(color, _tailAlpha)
        if (i < overlayTailSeriesRefs.current.length) {
          overlayTailSeriesRefs.current[i].applyOptions({ color: tailColor, lineType: _ovLineType, lineWidth: _ovLineWidth, autoscaleInfoProvider: _ovAutoscale })
          overlayTailSeriesRefs.current[i].setData(tailData)
        } else {
          const ts = chart.addSeries(LineSeries, {
            color: tailColor,
            lineWidth: _ovLineWidth,
            lineType: _ovLineType,
            crosshairMarkerVisible: false,
            priceLineVisible: false,
            lastValueVisible: false,
            autoscaleInfoProvider: _ovAutoscale,
          })
          ts.setData(tailData)
          overlayTailSeriesRefs.current.push(ts)
        }
      }
    }

    // ── Bollinger Bands (3 LineSeries on main price scale) ──
    const bbColor = cs.indicators?.bb?.color || 'rgba(156,39,176,0.85)'
    const BB_BANDS = [
      { ref: bbUpperRef,  data: indicatorData.bb.upper,  style: 2 },
      { ref: bbMiddleRef, data: indicatorData.bb.middle, style: 0 },
      { ref: bbLowerRef,  data: indicatorData.bb.lower,  style: 2 },
    ]
    for (const { ref, data, style } of BB_BANDS) {
      if (data.length) {
        if (!ref.current) {
          ref.current = chart.addSeries(LineSeries, {
            color: bbColor, lineWidth: 1, lineStyle: style,
            priceLineVisible: false, lastValueVisible: false,
            crosshairMarkerVisible: false, autoscaleInfoProvider: () => null,
          })
        } else {
          ref.current.applyOptions({ color: bbColor })
        }
        _applyData(ref.current, data)
      } else if (ref.current) {
        try { chart.removeSeries(ref.current) } catch {}
        ref.current = null
      }
    }

    // ── Session VWAP (intraday only) ──
    if (indicatorData.vwap.length) {
      const vwapColor = vwapOverride?.color || cs.indicators?.vwap?.color || '#26C6DA'
      const _vwapWidth = (boldCandles || modelBookLook) ? 0.5 : 1
      if (!vwapSeriesRef.current) {
        vwapSeriesRef.current = chart.addSeries(LineSeries, {
          color: vwapColor, lineWidth: _vwapWidth,
          priceLineVisible: false, lastValueVisible: false,
          crosshairMarkerVisible: false, autoscaleInfoProvider: () => null,
        })
      } else {
        vwapSeriesRef.current.applyOptions({ color: vwapColor, lineWidth: _vwapWidth })
      }
      _applyData(vwapSeriesRef.current, indicatorData.vwap)
    } else if (vwapSeriesRef.current) {
      try { chart.removeSeries(vwapSeriesRef.current) } catch {}
      vwapSeriesRef.current = null
    }

    // ── RSI sub-pane ──
    if (indicatorData.rsi.length) {
      const rsiColor = cs.indicators?.rsi?.color || '#7b68ee'
      const rsiTgt = ensureIndTarget('rsi', [rsiSeriesRef])
      if (!rsiSeriesRef.current) {
        rsiSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: rsiTgt.scaleId,
          color: rsiColor,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        }, rsiTgt.pane)
        applyIndScale('rsi', rsiSeriesRef.current, rsiTgt, { autoScale: false, minimum: 0, maximum: 100 })
        rsiSeriesRef.current.createPriceLine({ price: 70, color: 'rgba(123,104,238,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
        rsiSeriesRef.current.createPriceLine({ price: 50, color: 'rgba(123,104,238,0.2)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false })
        rsiSeriesRef.current.createPriceLine({ price: 30, color: 'rgba(123,104,238,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
      } else {
        rsiSeriesRef.current.applyOptions({ color: rsiColor })
        applyIndScale('rsi', rsiSeriesRef.current, rsiTgt)
      }
      _applyData(rsiSeriesRef.current, indicatorData.rsi)
    } else if (rsiSeriesRef.current) {
      try { chart.removeSeries(rsiSeriesRef.current) } catch {}
      rsiSeriesRef.current = null
    }

    // ── Stochastic sub-pane ──
    const stochCfg = cs.indicators?.stoch
    const stochD   = indicatorData.stoch
    if (stochD.k.length) {
      const stochTgt = ensureIndTarget('stoch', [stochKRef, stochDRef])
      if (!stochKRef.current) {
        stochKRef.current = chart.addSeries(LineSeries, {
          priceScaleId: stochTgt.scaleId,
          color: stochCfg?.kColor || '#FF6B6B',
          lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        }, stochTgt.pane)
        stochDRef.current = chart.addSeries(LineSeries, {
          priceScaleId: stochTgt.scaleId,
          color: stochCfg?.dColor || '#4ECDC4',
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        }, stochTgt.pane)
        applyIndScale('stoch', stochKRef.current, stochTgt, { autoScale: false, minimum: 0, maximum: 100 })
        stochKRef.current.createPriceLine({ price: 80, color: 'rgba(255,107,107,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
        stochKRef.current.createPriceLine({ price: 20, color: 'rgba(78,205,196,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
      } else {
        stochKRef.current.applyOptions({ color: stochCfg?.kColor || '#FF6B6B' })
        stochDRef.current.applyOptions({ color: stochCfg?.dColor || '#4ECDC4' })
        applyIndScale('stoch', stochKRef.current, stochTgt)
      }
      _applyData(stochKRef.current, stochD.k)
      _applyData(stochDRef.current, stochD.d)
    } else {
      for (const ref of [stochKRef, stochDRef]) {
        if (ref.current) { try { chart.removeSeries(ref.current) } catch {}; ref.current = null }
      }
    }

    // ── MACD sub-pane ──
    const macdCfg = cs.indicators?.macd
    const macdD   = indicatorData.macd
    if (macdD.macd.length) {
      const macdTgt = ensureIndTarget('macd', [macdLineRef, macdSignalRef, macdHistRef])
      if (!macdLineRef.current) {
        macdLineRef.current = chart.addSeries(LineSeries, {
          priceScaleId: macdTgt.scaleId,
          color: macdCfg?.macdColor || '#2196F3',
          lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        }, macdTgt.pane)
        macdSignalRef.current = chart.addSeries(LineSeries, {
          priceScaleId: macdTgt.scaleId,
          color: macdCfg?.signalColor || '#FF9800',
          lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        }, macdTgt.pane)
        macdHistRef.current = chart.addSeries(HistogramSeries, {
          priceScaleId: macdTgt.scaleId,
          priceFormat: { type: 'price', precision: 5 },
          priceLineVisible: false, lastValueVisible: false,
        }, macdTgt.pane)
        applyIndScale('macd', macdLineRef.current, macdTgt, { autoScale: true })
        macdLineRef.current.createPriceLine({ price: 0, color: 'rgba(255,255,255,0.12)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false })
      } else {
        macdLineRef.current.applyOptions({ color: macdCfg?.macdColor || '#2196F3' })
        macdSignalRef.current.applyOptions({ color: macdCfg?.signalColor || '#FF9800' })
        applyIndScale('macd', macdLineRef.current, macdTgt)
      }
      _applyData(macdLineRef.current, macdD.macd)
      _applyData(macdSignalRef.current, macdD.signal)
      _applyData(macdHistRef.current, macdD.histogram)
    } else {
      for (const ref of [macdLineRef, macdSignalRef, macdHistRef]) {
        if (ref.current) { try { chart.removeSeries(ref.current) } catch {}; ref.current = null }
      }
    }

    // ── ATR sub-pane ──
    if (indicatorData.atr.length) {
      const atrColor = cs.indicators?.atr?.color || '#FFA726'
      const atrTgt = ensureIndTarget('atr', [atrSeriesRef])
      if (!atrSeriesRef.current) {
        atrSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: atrTgt.scaleId,
          color: atrColor,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        }, atrTgt.pane)
        applyIndScale('atr', atrSeriesRef.current, atrTgt, { autoScale: true })
      } else {
        atrSeriesRef.current.applyOptions({ color: atrColor })
        applyIndScale('atr', atrSeriesRef.current, atrTgt)
      }
      _applyData(atrSeriesRef.current, indicatorData.atr)
    } else if (atrSeriesRef.current) {
      try { chart.removeSeries(atrSeriesRef.current) } catch {}
      atrSeriesRef.current = null
    }

    // ── Parabolic SAR (dots on main price scale) ──
    if (indicatorData.sar.length) {
      const sarColor = cs.indicators?.sar?.color || '#ffeb3b'
      if (!sarSeriesRef.current) {
        sarSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'right',
          color: sarColor,
          lineWidth: 0,
          pointMarkersVisible: true,
          pointMarkersRadius: 3,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          autoscaleInfoProvider: () => null,
        })
      } else {
        sarSeriesRef.current.applyOptions({ color: sarColor })
      }
      _applyData(sarSeriesRef.current, indicatorData.sar.map(p => ({ time: p.time, value: p.value })))
    } else if (sarSeriesRef.current) {
      try { chart.removeSeries(sarSeriesRef.current) } catch {}
      sarSeriesRef.current = null
    }

    // ── Ichimoku Cloud (5 LineSeries on main price scale) ──
    const ichiCfg = cs.indicators?.ichimoku
    const ichiD = indicatorData.ichimoku
    if (ichiD.tenkan.length) {
      const createIfNeeded = (ref, opts) => {
        if (!ref.current) {
          ref.current = chart.addSeries(LineSeries, {
            priceScaleId: 'right',
            ...opts,
            priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
            autoscaleInfoProvider: () => null,
          })
        } else {
          ref.current.applyOptions({ color: opts.color })
        }
      }
      createIfNeeded(ichimokuTenkanRef, { color: ichiCfg?.tenkanColor || '#26C6DA', lineWidth: 1 })
      createIfNeeded(ichimokuKijunRef,  { color: ichiCfg?.kijunColor  || '#EF5350', lineWidth: 1 })
      createIfNeeded(ichimokuSpanARef,  { color: ichiCfg?.spanAColor  || 'rgba(76,175,80,0.5)', lineWidth: 1 })
      createIfNeeded(ichimokuSpanBRef,  { color: ichiCfg?.spanBColor  || 'rgba(239,83,80,0.5)', lineWidth: 1 })
      createIfNeeded(ichimokuChikouRef, { color: ichiCfg?.chikouColor || 'rgba(255,235,59,0.7)', lineWidth: 1, lineStyle: 2 })
      _applyData(ichimokuTenkanRef.current, ichiD.tenkan)
      _applyData(ichimokuKijunRef.current, ichiD.kijun)
      _applyData(ichimokuSpanARef.current, ichiD.spanA)
      _applyData(ichimokuSpanBRef.current, ichiD.spanB)
      _applyData(ichimokuChikouRef.current, ichiD.chikou)
    } else {
      for (const ref of [ichimokuTenkanRef, ichimokuKijunRef, ichimokuSpanARef, ichimokuSpanBRef, ichimokuChikouRef]) {
        if (ref.current) { try { chart.removeSeries(ref.current) } catch {}; ref.current = null }
      }
    }

    // ── MFI sub-pane (0-100, 80/20 reference lines) ──
    if (indicatorData.mfi.length) {
      const mfiColor = cs.indicators?.mfi?.color || '#c084fc'
      const mfiTgt = ensureIndTarget('mfi', [mfiSeriesRef])
      if (!mfiSeriesRef.current) {
        mfiSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: mfiTgt.scaleId,
          color: mfiColor,
          lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        }, mfiTgt.pane)
        applyIndScale('mfi', mfiSeriesRef.current, mfiTgt, { autoScale: false, minimum: 0, maximum: 100 })
        mfiSeriesRef.current.createPriceLine({ price: 80, color: 'rgba(192,132,252,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
        mfiSeriesRef.current.createPriceLine({ price: 20, color: 'rgba(192,132,252,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
      } else {
        mfiSeriesRef.current.applyOptions({ color: mfiColor })
        applyIndScale('mfi', mfiSeriesRef.current, mfiTgt)
      }
      _applyData(mfiSeriesRef.current, indicatorData.mfi)
    } else if (mfiSeriesRef.current) {
      try { chart.removeSeries(mfiSeriesRef.current) } catch {}
      mfiSeriesRef.current = null
    }

    // ── CCI sub-pane (±300 typical, +100/0/-100 reference lines) ──
    if (indicatorData.cci.length) {
      const cciColor = cs.indicators?.cci?.color || '#fbbf24'
      const cciTgt = ensureIndTarget('cci', [cciSeriesRef])
      if (!cciSeriesRef.current) {
        cciSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: cciTgt.scaleId,
          color: cciColor,
          lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        }, cciTgt.pane)
        applyIndScale('cci', cciSeriesRef.current, cciTgt, { autoScale: true })
        cciSeriesRef.current.createPriceLine({ price:  100, color: 'rgba(251,191,36,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
        cciSeriesRef.current.createPriceLine({ price:    0, color: 'rgba(251,191,36,0.2)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false })
        cciSeriesRef.current.createPriceLine({ price: -100, color: 'rgba(251,191,36,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
      } else {
        cciSeriesRef.current.applyOptions({ color: cciColor })
        applyIndScale('cci', cciSeriesRef.current, cciTgt)
      }
      _applyData(cciSeriesRef.current, indicatorData.cci)
    } else if (cciSeriesRef.current) {
      try { chart.removeSeries(cciSeriesRef.current) } catch {}
      cciSeriesRef.current = null
    }

    // ── Williams %R sub-pane (-100..0, -20/-80 reference lines) ──
    if (indicatorData.williamsR.length) {
      const wrColor = cs.indicators?.williamsR?.color || '#60a5fa'
      const wrTgt = ensureIndTarget('williamsR', [williamsRSeriesRef])
      if (!williamsRSeriesRef.current) {
        williamsRSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: wrTgt.scaleId,
          color: wrColor,
          lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        }, wrTgt.pane)
        applyIndScale('williamsR', williamsRSeriesRef.current, wrTgt, { autoScale: false, minimum: -100, maximum: 0 })
        williamsRSeriesRef.current.createPriceLine({ price: -20, color: 'rgba(96,165,250,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
        williamsRSeriesRef.current.createPriceLine({ price: -80, color: 'rgba(96,165,250,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
      } else {
        williamsRSeriesRef.current.applyOptions({ color: wrColor })
        applyIndScale('williamsR', williamsRSeriesRef.current, wrTgt)
      }
      _applyData(williamsRSeriesRef.current, indicatorData.williamsR)
    } else if (williamsRSeriesRef.current) {
      try { chart.removeSeries(williamsRSeriesRef.current) } catch {}
      williamsRSeriesRef.current = null
    }

    // ── ADX/DMI sub-pane (ADX + +DI + -DI) ──
    const adxCfg = cs.indicators?.adx
    const adxD = indicatorData.adx
    if (adxD.adx.length) {
      const adxTgt = ensureIndTarget('adx', [adxSeriesRef, adxPlusDIRef, adxMinusDIRef])
      if (!adxSeriesRef.current) {
        adxSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: adxTgt.scaleId,
          color: adxCfg?.adxColor || '#e5e7eb',
          lineWidth: 2,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        }, adxTgt.pane)
        adxPlusDIRef.current = chart.addSeries(LineSeries, {
          priceScaleId: adxTgt.scaleId,
          color: adxCfg?.plusDIColor || '#22c55e',
          lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        }, adxTgt.pane)
        adxMinusDIRef.current = chart.addSeries(LineSeries, {
          priceScaleId: adxTgt.scaleId,
          color: adxCfg?.minusDIColor || '#ef4444',
          lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        }, adxTgt.pane)
        applyIndScale('adx', adxSeriesRef.current, adxTgt, { autoScale: false, minimum: 0, maximum: 100 })
        adxSeriesRef.current.createPriceLine({ price: 25, color: 'rgba(229,231,235,0.3)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
      } else {
        adxSeriesRef.current.applyOptions({  color: adxCfg?.adxColor     || '#e5e7eb' })
        adxPlusDIRef.current.applyOptions({  color: adxCfg?.plusDIColor  || '#22c55e' })
        adxMinusDIRef.current.applyOptions({ color: adxCfg?.minusDIColor || '#ef4444' })
        applyIndScale('adx', adxSeriesRef.current, adxTgt)
      }
      _applyData(adxSeriesRef.current, adxD.adx)
      _applyData(adxPlusDIRef.current, adxD.plusDI)
      _applyData(adxMinusDIRef.current, adxD.minusDI)
    } else {
      for (const ref of [adxSeriesRef, adxPlusDIRef, adxMinusDIRef]) {
        if (ref.current) { try { chart.removeSeries(ref.current) } catch {}; ref.current = null }
      }
    }

    // ── OBV sub-pane (cumulative, autoscale — values can be huge) ──
    if (indicatorData.obv.length) {
      const obvColor = cs.indicators?.obv?.color || '#9ca3af'
      const obvTgt = ensureIndTarget('obv', [obvSeriesRef])
      if (!obvSeriesRef.current) {
        obvSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: obvTgt.scaleId,
          color: obvColor,
          lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        }, obvTgt.pane)
        applyIndScale('obv', obvSeriesRef.current, obvTgt, { autoScale: true })
      } else {
        obvSeriesRef.current.applyOptions({ color: obvColor })
        applyIndScale('obv', obvSeriesRef.current, obvTgt)
      }
      _applyData(obvSeriesRef.current, indicatorData.obv)
    } else if (obvSeriesRef.current) {
      try { chart.removeSeries(obvSeriesRef.current) } catch {}
      obvSeriesRef.current = null
    }

    // ── Donchian Channels (3 LineSeries on main price scale, like BB) ──
    const donchianColor = cs.indicators?.donchian?.color || 'rgba(96,165,250,0.5)'
    const DONCHIAN_BANDS = [
      { ref: donchianUpperRef,  data: indicatorData.donchian.upper,  style: 0 },
      { ref: donchianMiddleRef, data: indicatorData.donchian.middle, style: 3 },
      { ref: donchianLowerRef,  data: indicatorData.donchian.lower,  style: 0 },
    ]
    for (const { ref, data, style } of DONCHIAN_BANDS) {
      if (data.length) {
        if (!ref.current) {
          ref.current = chart.addSeries(LineSeries, {
            color: donchianColor, lineWidth: 1, lineStyle: style,
            priceLineVisible: false, lastValueVisible: false,
            crosshairMarkerVisible: false, autoscaleInfoProvider: () => null,
          })
        } else {
          ref.current.applyOptions({ color: donchianColor })
        }
        _applyData(ref.current, data)
      } else if (ref.current) {
        try { chart.removeSeries(ref.current) } catch {}
        ref.current = null
      }
    }

    // ── Symbol comparison overlay ──
    if (comparisonData.length) {
      if (!compareSeriesRef.current) {
        compareSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'compare',
          color: '#fb923c',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 4,
        })
        chart.priceScale('compare').applyOptions({
          scaleMargins: { top: 0.1, bottom: 0.1 },
          borderVisible: false,
          visible: false,  // hide the right-axis label — value shown in legend instead
        })
      }
      _applyData(compareSeriesRef.current, comparisonData)
    } else if (compareSeriesRef.current) {
      try { chart.removeSeries(compareSeriesRef.current) } catch {}
      compareSeriesRef.current = null
    }

    // ── Price lines — remove old, add new (only when array reference changes) ──
    if (lastPriceLinesRef.current !== allPriceLines) {
      lastPriceLinesRef.current = allPriceLines
      for (const pl of priceLineRefs.current) {
        try { candleSeriesRef.current.removePriceLine(pl) } catch {}
      }
      priceLineRefs.current = []
      if (allPriceLines?.length && candleSeriesRef.current) {
        for (const pl of allPriceLines) {
          const ref = candleSeriesRef.current.createPriceLine({
            price: pl.price,
            color: pl.color || cs.textColor,
            lineWidth: pl.lineWidth || 1,
            lineStyle: pl.lineStyle ?? 2,
            axisLabelVisible: pl.axisLabelVisible ?? true,
            lineVisible: pl.lineVisible ?? true,   // session ext tag = chip only (no line)
            title: pl.title || '',
          })
          priceLineRefs.current.push(ref)
        }
      }
    }

    // ── Markers (BUY/SELL arrows) ──
    // Reuse a single controller per chart instance and feed it new markers.
    // Without this, each updateChart() call stacks new marker layers over old
    // ones — markers from the prior ticker leak into the new ticker's chart.
    // Always call setMarkers (even with []) so old markers clear when the new
    // ticker has none.
    const allMarkers = [...(mergedMarkers || [])]
      .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
    if (candleSeriesRef.current) {
      import('lightweight-charts').then(({ createSeriesMarkers }) => {
        if (!createSeriesMarkers || !candleSeriesRef.current) return
        if (markersControllerRef.current && typeof markersControllerRef.current.setMarkers === 'function') {
          markersControllerRef.current.setMarkers(allMarkers)
        } else {
          markersControllerRef.current = createSeriesMarkers(candleSeriesRef.current, allMarkers)
        }
      }).catch(() => {})
    }

    // ── Swing high/low price labels (custom v5 series primitive, above series) ──
    if (candleSeriesRef.current) {
      if (!swingCtrlRef.current) swingCtrlRef.current = createSwingLabelsPrimitive({})
      if (!swingAttachedRef.current) {
        try {
          candleSeriesRef.current.attachPrimitive(swingCtrlRef.current.primitive)
          swingAttachedRef.current = true
        } catch { /* older series API — primitive optional */ }
      }
      const sl = cs.swingLabels || {}
      swingCtrlRef.current.setOptions({
        enabled: !!sl.enabled,
        color: sl.color || '#d4d0c4',
        tintByType: !!sl.tintByType,
        upColor: sl.upColor || '#4ade80',
        downColor: sl.downColor || '#f87171',
        bg: cs.background,
      })
      swingCtrlRef.current.setPoints(swingPoints)
    }

    // View handling on initial load / timeframe change / ticker switch.
    // (NOT on SWR refetches — those keep zoomKey stable so the user never loses position.)
    //
    // LOCK BEHAVIOR (always on): when ONLY the ticker changes (same timeframe), we carry
    // the user's current view to the next chart instead of snapping back to a default fit:
    //   • Horizontal: re-anchor the visible logical range to the right edge so the same
    //     "scrolled-back distance + zoom width" lines up even when the two tickers have
    //     different history lengths.
    //   • Vertical: auto-fit the new ticker into the candle band defined by chartOpts'
    //     scaleMargins. When the user has dragged the candles to a custom spot, that band
    //     was captured above (vertMarginsRef), so the new stock lands in the same
    //     PROPORTIONAL position — scaled to its own price range, never showing the old
    //     stock's absolute prices. Double-click the axis won't clear it; use the
    //     "Auto-scale" context-menu item to reset to default headroom.
    const zoomKey = `${sym}_${resolvedTf}`
    // Capture the outgoing view BEFORE deciding. setData() preserves the logical
    // range NUMERICALLY, so this reflects where the user was — on the previous
    // ticker (sym switch) or right now (same-ticker data-phase swap / backfill).
    let oldRange = null
    try { oldRange = chart.timeScale().getVisibleLogicalRange() } catch {}
    const oldBarCount = lastBarCountRef.current
    if (zoomKeyRef.current !== zoomKey) {
      const isFirstLoad = zoomKeyRef.current === null
      const tfChanged = lastTfRef.current !== null && lastTfRef.current !== resolvedTf

      zoomKeyRef.current = zoomKey
      lastTfRef.current = resolvedTf
      // A timeframe switch must settle at the new tf's default-latest window. Arm the
      // reframe guard (cleared in the safety net once the bar count stops changing).
      if (tfChanged) pendingTfReframeRef.current = resolvedTf

      // Vertical: always auto-fit the new ticker into the current candle band. chartOpts
      // already applied that band's scaleMargins (= the captured proportional placement,
      // or the default headroom), so autoScale fills it with THIS stock's own range.
      try { mainPriceScale()?.applyOptions({ autoScale: true }) } catch {}

      let didPreserve = false
      if (!isFirstLoad && !tfChanged && !entryDate && oldRange && oldBarCount > 0) {
        const newBarCount = filteredBars.length
        const width = oldRange.to - oldRange.from
        // Symbol switch: keep the user's ZOOM LEVEL (width), but choose the anchor.
        // keepPresentOnSymbolChange (Charts workspace) always pins the newest candle to
        // the right so a newly-typed ticker loads at PRESENT DAY — never inheriting a
        // scrolled-back (past) position from the prior symbol. Otherwise preserve the
        // prior bars-from-right (flip tickers at the exact same historical view).
        let to, from
        if (keepPresentOnSymbolChange) {
          to = (newBarCount - 1) + width * (1 - LAST_CANDLE_POS)
          from = to - width
        } else {
          const barsFromRight = oldBarCount - oldRange.to
          to = newBarCount - barsFromRight
          from = to - width
        }
        if (width > 0 && Number.isFinite(from) && Number.isFinite(to) && to > 1 && from < newBarCount) {
          try {
            chart.timeScale().setVisibleLogicalRange({ from, to })
            didPreserve = true
          } catch {}
        }
      }

      if (!didPreserve) {
        // Holding-period zoom: when entryDate is supplied (e.g. TradeDrawer),
        // center the view on the trade window with 20-bar padding each side.
        if (entryDate && exactDateRange && filteredBars.length > 0) {
          // Exact window: first bar >= entryDate .. last bar <= exitDate, no padding.
          // Used by Model Book to show exactly one calendar year's move.
          let startIdx = filteredBars.findIndex(b => b.t >= entryDate)
          let endIdx = filteredBars.length - 1
          if (exitDate) {
            for (let i = filteredBars.length - 1; i >= 0; i--) {
              if (filteredBars[i].t <= exitDate) { endIdx = i; break }
            }
          }
          // Reused-ticker guard (see the exact-range pin below): if the selected
          // year has no bars in the loaded series (it fell in a delisting gap),
          // show the most recent ~year instead of anchoring to the oldest
          // (delisted-era) bar. Without this, findIndex<0 → startIdx 0 streamed
          // 2016/2008-era data onto a recent-year view.
          const yearHasData = startIdx >= 0 && endIdx >= startIdx
            && (!exitDate || filteredBars[startIdx].t <= exitDate)
          if (!yearHasData) { endIdx = filteredBars.length - 1; startIdx = Math.max(0, endIdx - 251) }
          // Frame start predates the first bar (e.g. before an IPO): pad with
          // blank space on the left instead of clamping to bar 0.
          let fromIdx = startIdx
          if (yearHasData && startIdx === 0) {
            fromIdx = -leadingBlankBars(_dateToMs(entryDate), _dateToMs(filteredBars[0].t), resolvedTf)
          }
          const _padR = frameRightPadFrac > 0 ? Math.round((endIdx - fromIdx) * frameRightPadFrac) : 0
          chart.timeScale().setVisibleLogicalRange({ from: fromIdx, to: endIdx + _padR })
        } else if (entryDate && filteredBars.length > 0) {
          const entryIdx = filteredBars.findIndex(b => b.t >= entryDate)
          const exitIdx  = exitDate
            ? filteredBars.findIndex(b => b.t >= exitDate)
            : -1
          const fromBar = Math.max(0, (entryIdx >= 0 ? entryIdx : 0) - 20)
          const toBar   = (exitIdx >= 0 ? exitIdx : filteredBars.length - 1) + 28
          chart.timeScale().setVisibleLogicalRange({ from: fromBar, to: toBar })
        } else {
          // Canonical default zoom: newest candle at LAST_CANDLE_POS, timeframe's
          // default history (Daily on the workspace = dailyDefaultBars ≈ 6 months).
          // Shared with the right-click "Reset view" so both land identically.
          const { from: _from, to: _to } = computeDefaultLogicalRange(
            filteredBars.length, resolvedTf, { dailyDefaultBars, leftBarPad, rightPadBars }
          )
          chart.timeScale().setVisibleLogicalRange({ from: _from, to: _to })
        }
      }
    } else if (!entryDate && !exactDateRange && oldRange && oldBarCount > 0
               && oldBarCount !== filteredBars.length) {
      // SAME ticker/tf, but the bar COUNT changed since the last render — the
      // IDB-cache → network full-fetch swap OR a viewport-first older-history
      // backfill (FIRST_PAINT→full). LWC preserves the visible logical range
      // NUMERICALLY across setData, so the prior range now maps to older dates
      // ("chart jumps back to ~2019"). Re-anchor to the same bars-from-right +
      // width so the user's date-position holds fixed across data phases.
      // (Restores commit 911dfe91, lost in a later StockChart overwrite; Model
      // Book / entryDate charts have their own pins below.)
      const newBarCount = filteredBars.length
      const barsFromRight = oldBarCount - oldRange.to
      const width = oldRange.to - oldRange.from
      const to = newBarCount - barsFromRight
      const from = to - width
      if (width > 0 && Number.isFinite(from) && Number.isFinite(to) && to > 1 && from < newBarCount) {
        try { chart.timeScale().setVisibleLogicalRange({ from, to }) } catch {}
      }
    }

    // ── Keep-the-newest-candle-pinned-right safety net (workspace live charts) ──
    // After ALL the zoom branches above have run, if the user was viewing the
    // latest bars and the newest candle has drifted off the right edge, snap it
    // back. This is mechanism-agnostic: whatever repositioned the view (a
    // background data-count change re-anchor, LWC's own setData behavior, a
    // backfill, a resize settle), the end state is enforced — the view must not
    // move on its own (user requirement). A deliberately scrolled-back view (last
    // bar NOT near the right before this update) is left completely untouched.
    if (!entryDate && !exactDateRange && oldRange && oldBarCount > 0 && filteredBars.length > 1) {
      const preLastIdx = oldBarCount - 1
      const prePad = oldRange.to - preLastIdx      // empty bars right of the last bar, BEFORE the update
      const preWidth = oldRange.to - oldRange.from
      if (pendingTfReframeRef.current === resolvedTf) {
        // Just switched INTO this timeframe: deterministically re-assert its
        // default-latest window on every settling commit (the bars arrive in phases
        // — IDB cache → network → backfill — each a separate commit). Once the count
        // stops changing, data has settled; release control so ordinary scroll/zoom
        // is respected again. Without this, an intermediate phase can strand the view
        // hard-left and the was-viewing-latest guard below reads that as a deliberate
        // scroll-back and refuses to fix it (the reported 5m→D snap-left bug).
        const { from, to } = computeDefaultLogicalRange(
          filteredBars.length, resolvedTf, { dailyDefaultBars, leftBarPad, rightPadBars }
        )
        try { chart.timeScale().setVisibleLogicalRange({ from, to }) } catch { /* mid-load */ }
        if (filteredBars.length === oldBarCount) pendingTfReframeRef.current = null
      } else {
        // "Was viewing the latest": last bar visible with a normal (not huge) right gap.
        const wasViewingLatest = preWidth > 0 && prePad >= -1 && prePad <= Math.max(8, preWidth * 0.25)
        if (wasViewingLatest) {
          let fr = null
          try { fr = chart.timeScale().getVisibleLogicalRange() } catch { /* mid-load */ }
          if (fr) {
            const w = fr.to - fr.from
            const lastIdx = filteredBars.length - 1
            const pos = w > 0 ? (lastIdx - fr.from) / w : 1  // newest candle's 0..1 screen position
            // Drifted: newest candle pushed left into the middle (pos < 0.85) or shoved
            // off the right edge (pos > 1.02). Re-pin it to the standard load position.
            if (w > 0 && (pos < 0.85 || pos > 1.02)) {
              const to2 = lastIdx + w * (1 - LAST_CANDLE_POS)
              const from2 = to2 - w
              try { chart.timeScale().setVisibleLogicalRange({ from: from2, to: to2 }) } catch { /* out of range mid-load */ }
            }
          }
        }
      }
    }

    // Model Book (exactDateRange): the year frame is DETERMINISTIC for this (stock,
    // year), so re-apply it on EVERY data update — not only on the sym/tf switch
    // handled above. The bars load in phases (IDB cache → network refetch), and a
    // later phase with a different bar count would otherwise leave the prior logical
    // range mapping to the wrong dates for one frame: the chart (and the ^IXIC pane
    // that rides its time scale) glitches to a wrong spot and snaps back while
    // scrolling fast. Applying it here, in the SAME effect as setData above, makes
    // the new bars + correct year frame paint atomically — no transient. Skipped
    // while a setup/catalyst focus zoom owns the view (focusActiveRef).
    if (exactDateRange && entryDate && filteredBars.length > 0) {
      if (focusActiveRef.current) {
        // A setup-focus zoom owns the view. A background bars refetch (SWR network
        // swap after the IDB cache) re-runs updateChart, and the setData() above
        // perturbs the horizontal logical range. Without re-asserting the focus
        // window here the chart snaps back to the default/year view (candles shift
        // left, empty space on the right) WHILE the vertical stays pinned to the
        // focus band via focusPriceRangeRef — the "glitches to the left" bug.
        // Re-pin to the settled focus range; the year re-pin below is skipped.
        const r = focusRangeRef.current
        if (r) { try { chart.timeScale().setVisibleLogicalRange({ from: r.from, to: r.to }) } catch { /* out of range mid-load */ } }
      } else if (exactPinSigRef.current
                 && exactPinSigRef.current.startsWith(`${sym}_${resolvedTf}|`)
                 && exactPinSigRef.current !== `${sym}_${resolvedTf}|${entryDate}|${exitDate}`) {
        // The exact-range dates just changed on the SAME chart (Setup ⇄ Result
        // flip). Don't snap to the new frame here — leave the view at the
        // outgoing frame so the exact-range pin effect (which runs after this in
        // the same commit) can start its animated glide FROM it. Snapping first
        // would zero the animation's start range and kill the transition.
      } else {
        let _s = filteredBars.findIndex(b => b.t >= entryDate)
        let _e = filteredBars.length - 1
        if (exitDate) {
          for (let i = filteredBars.length - 1; i >= 0; i--) {
            if (filteredBars[i].t <= exitDate) { _e = i; break }
          }
        }
        const _has = _s >= 0 && _e >= _s && (!exitDate || filteredBars[_s].t <= exitDate)
        if (!_has) { _e = filteredBars.length - 1; _s = Math.max(0, _e - 251) }  // year fell in a delisting gap → recent ~year
        // Frame start predates the first bar (before an IPO) → blank-space pad.
        let _from = _s
        if (_has && _s === 0) {
          _from = -leadingBlankBars(_dateToMs(entryDate), _dateToMs(filteredBars[0].t), resolvedTf)
        }
        const _padR = frameRightPadFrac > 0 ? Math.round((_e - _from) * frameRightPadFrac) : 0
        try { chart.timeScale().setVisibleLogicalRange({ from: _from, to: _e + _padR }) } catch { /* out of range mid-load */ }
      }
    }

    // Track current bar count + bars so the next ticker switch can right-anchor the
    // preserved view and measure the outgoing vertical placement.
    lastBarCountRef.current = filteredBars.length
    prevBarsRef.current = filteredBars
  }, [filteredBars, ohlcData, closeData, volData, overlayData, indicatorData, comparisonData, sym, showVolume, mergedMarkers, mergedPriceLines, allPriceLines, watermark, watermarkOpacity, cs, adjustTime, resolvedTf, tickerMeta, watermarkMeta, vwapOverride, hideWatermark, hidePriceLine, leftBarPad, modelBookLook, frozen, candleFrameFade, fadeCutoff, fitPriceToCandles, dailyDefaultBars, canvasTheme])

  // Effect: update chart when data or settings change (NO cleanup — chart persists)
  useEffect(() => {
    updateChart()
  }, [updateChart])

  // Suppress the native last-value axis tag while the session tags are shown, so
  // the green tag we render (locked at the RTH close) isn't doubled by LWC's
  // built-in tag following the developing bar. Re-applied on series recreation.
  useEffect(() => {
    if (!chartReady || !candleSeriesRef.current) return
    try { candleSeriesRef.current.applyOptions({ lastValueVisible: !hideLastValue && !sessionTagsActive }) } catch { /* older LWC */ }
  }, [sessionTagsActive, hideLastValue, chartReady, cs.chartType])

  // TradingView-style layering: keep the candle bodies ABOVE the MA / Bollinger /
  // VWAP overlays so those lines pass BEHIND the opaque bodies instead of drawing
  // on top of them. LWC stacks series by their pane index; setSeriesOrder(big)
  // clamps the candle series to the top of its pane. Runs after updateChart (its
  // dep) so it re-asserts the order whenever overlays/series are (re)built.
  useEffect(() => {
    if (!candlesOnTop) return
    const s = candleSeriesRef.current
    if (!s || typeof s.setSeriesOrder !== 'function') return
    try { s.setSeriesOrder(Number.MAX_SAFE_INTEGER) } catch { /* older LWC */ }
  }, [updateChart, candlesOnTop])

  // Gold/white setup-day candle (Model Book). Runs AFTER updateChart so it
  // overrides the plain candle data. A candle-only setData (range preserved) →
  // just a recolor, no flash, no zoom reset. `updateChart` is a dep so this
  // re-fires every time updateChart repaints plain candles (e.g. a markers /
  // indicators / watermark dep changed) — that's what keeps the highlight from
  // intermittently vanishing — WITHOUT pulling the highlight into updateChart's
  // own deps (which would re-run its visible-range logic and fight the focus
  // zoom). Scoped: does nothing unless a highlight is/was set.
  useEffect(() => {
    const series = candleSeriesRef.current
    if (!series || !isOhlcType(cs.chartType)) return
    if (highlightTimeSet) {
      hadHighlightRef.current = true
      try { series.setData(fadedOhlc) } catch { /* range can be out of bounds mid-load */ }
    } else if (hadHighlightRef.current) {
      hadHighlightRef.current = false
      try { series.setData(ohlcData) } catch { /* clear gold back to normal */ }
    }
  }, [fadedOhlc, goldOhlc, ohlcData, highlightTimeSet, chartReady, cs.chartType, updateChart])

  // Volume crossfade re-tint (Setup⇄Result). Mirrors the candle recolor above and
  // MUST run AFTER updateChart so its setData wins over updateChart's full-opacity
  // volume paint (otherwise the post-setup bars flicker during the transition).
  useEffect(() => {
    const s = volumeSeriesRef.current
    if (!s || !candleFrameFade) return
    try { s.setData(fadedVolData) } catch { /* range can be out of bounds mid-load */ }
  }, [fadedVolData, candleFrameFade, chartReady, updateChart])

  // Pre-install the focus autoscale provider as soon as the chart is ready (for
  // glide-capable charts). The frameChanged glide otherwise installs it LAZILY on
  // the first Setup⇄Result flip, and that one applyOptions forces an autoscale
  // recompute mid-glide → the first transition "skips". Installing it up front
  // (inert — returns default autoscale until a glide sets focusPriceRangeRef)
  // makes the first transition as smooth as every later one.
  useEffect(() => {
    if (!chartReady || (!exactDateRange && !candleFrameFade)) return
    const series = candleSeriesRef.current
    if (!series || focusProviderInstalledRef.current) return
    try {
      series.applyOptions({
        autoscaleInfoProvider: (orig) => {
          const r = focusPriceRangeRef.current
          if (r && Number.isFinite(r.lo) && Number.isFinite(r.hi) && r.hi > r.lo) {
            return { priceRange: { minValue: r.lo, maxValue: r.hi } }
          }
          return orig ? orig() : null
        },
      })
      focusProviderInstalledRef.current = true
    } catch { /* provider optional */ }
  }, [chartReady, exactDateRange, candleFrameFade, ohlcData])


  // Exact-range pin (Model Book): lock the view to [entryDate, exitDate].
  // MUST run AFTER updateChart() (above) so the series already holds the
  // current bars — otherwise our logical indices (computed from the new
  // filteredBars) wouldn't match the series and setData would snap the view
  // back to "now". Compares by epoch so it's robust to `t` being a
  // 'YYYY-MM-DD' string OR a unix timestamp number. Re-runs on every data
  // update so the network swap after the IDB cache can't revert it.
  useEffect(() => {
    if (!exactDateRange || !entryDate) return
    const chart = chartRef.current
    if (!chart || !filteredBars || filteredBars.length === 0) return
    // A setup-focus zoom (below) owns the view until the user toggles it off or
    // switches stock/timeframe. Releasing on a sym+tf change keeps the pin
    // correct for the new chart; otherwise yield so data refreshes don't snap
    // the zoomed-in view back to the full year.
    const fk = `${sym}_${resolvedTf}`
    if (focusKeyRef.current !== fk) {
      if (focusRafRef.current != null) { cancelAnimationFrame(focusRafRef.current); focusRafRef.current = null }  // a glide from the previous chart must not keep driving the new one
      focusActiveRef.current = false
      focusPriceRangeRef.current = null  // drop any in-flight focus vertical so the new chart autoscales cleanly
      focusRangeRef.current = null       // and its horizontal window so the year pin takes over
      focusKeyRef.current = fk
      sliceHoldRef.current = null        // a held wider slice belongs to the previous chart
    }
    // Same chart, but the framed dates changed (Setup ⇄ Result flip, or a year
    // switch landing on the same symbol): glide to the new frame instead of
    // snapping. Only when this chart was already framed once — a date change
    // arriving before the first framing (bars still loading) snaps as usual.
    const pinSig = `${fk}|${entryDate}|${exitDate}`
    const prevPinSig = exactPinSigRef.current
    const frameChanged = prevPinSig
      && prevPinSig !== pinSig
      && prevPinSig.startsWith(`${fk}|`)
      && String(yearFramedRef.current || '').startsWith(`${fk}:`)
    if (focusActiveRef.current && !frameChanged) return
    const toMs = v => {
      if (v == null) return NaN
      if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
      const s = String(v)
      return Date.parse(s.length <= 10 ? `${s}T00:00:00Z` : s)
    }
    const lo = toMs(entryDate)
    const hi = toMs(exitDate)
    let startIdx = filteredBars.findIndex(b => toMs(b.t) >= lo)
    let endIdx = filteredBars.length - 1
    if (!Number.isNaN(hi)) {
      for (let i = filteredBars.length - 1; i >= 0; i--) {
        if (toMs(filteredBars[i].t) <= hi) { endIdx = i; break }
      }
    }
    // Does the selected year actually have bars in the loaded series? Reused
    // tickers (e.g. SNDK, BE: an old delisted company, then a multi-year data
    // GAP, then the relisted company) can have the requested year fall entirely
    // in that gap — findIndex then points past the gap while endIdx is stuck
    // before it. The old code anchored startIdx to 0 in that case, which streamed
    // the DELISTED-ERA data (2016/2008) onto a recent-year view. Never do that:
    // if the year has no data, frame the most recent ~year of bars instead.
    const yearHasData = startIdx >= 0 && endIdx >= startIdx
      && toMs(filteredBars[startIdx].t) <= (Number.isNaN(hi) ? Infinity : hi)
    if (!yearHasData) {
      endIdx = filteredBars.length - 1
      startIdx = Math.max(0, endIdx - 251)
    }
    // Frame start predates the first loaded bar (e.g. before an IPO): pad the
    // left with blank space (negative logical index) so the chart honors the
    // requested start instead of clamping to bar 0 and over-zooming.
    let fromIdx = startIdx
    if (yearHasData && startIdx === 0) {
      fromIdx = -leadingBlankBars(lo, toMs(filteredBars[0].t), resolvedTf)
    }
    // Optional replay-style right margin: extend the framed window past the last
    // candle by a fraction of its width so there's blank space to annotate into
    // (Setup Library). Blank because the bars after exitDate are sliced out.
    const padRight = frameRightPadFrac > 0 ? Math.round((endIdx - fromIdx) * frameRightPadFrac) : 0
    // Store the LATEST computed range; the scheduled re-asserts below read this
    // ref (not captured locals) so a partial first data load can't lock stale
    // indices into the pending re-asserts (which showed the earliest bars).
    yearRangeRef.current = { from: fromIdx, to: endIdx + padRight }
    exactPinSigRef.current = pinSig
    const applyYear = () => {
      const r = yearRangeRef.current
      if (!r) return
      try {
        chart.timeScale().setVisibleLogicalRange({ from: r.from, to: r.to })
        mainPriceScale()?.applyOptions({ autoScale: true })
      } catch { /* range can be out of bounds mid-load; next update re-pins */ }
    }
    if (frameChanged && instantFrameFlip) {
      // Instant cut (Setup Library): no glide — snap straight to the new frame,
      // like loading a fresh chart. Cancel any in-flight glide and pin the new
      // frame. yearFramedRef is stamped so the settle-window re-assert burst
      // doesn't fire on top of this.
      if (focusRafRef.current != null) { cancelAnimationFrame(focusRafRef.current); focusRafRef.current = null }
      focusActiveRef.current = false
      focusRangeRef.current = null
      // Let the chart snap via DEFAULT autoscale (it settles in the first painted
      // frame — pinning via the provider instead made LWC animate the price scale
      // over ~1s). Separately compute that SAME edge-to-edge range and hand it to
      // the annotation overlay so it places price-anchored lines at the correct
      // height in the same frame (LWC's own priceToCoordinate is async), then hand
      // back seamlessly once LWC's mapping catches up (identical by construction).
      focusPriceRangeRef.current = null
      const _ov = fitPriceToCandles ? null : overlayData
      const _tv = keepBarsAfterExit ? Math.min(endIdx + padRight, filteredBars.length - 1) : endIdx
      const _mmI = _mainMargins(cs, showVolume && volData.length > 0 && !volInSeparatePane, priceScaleTopMargin, volInSeparatePane ? priceScaleBottomMargin : null)
      const _mt = Math.max(0, Math.min(0.45, _mmI?.top ?? 0))
      const _mb = Math.max(0, Math.min(0.45, _mmI?.bottom ?? 0))
      const _raw = _windowPriceRange(filteredBars, fromIdx, _tv, _ov)
      let targetVert = null
      if (_raw && (1 - _mt - _mb) > 0) {
        const _R = (_raw.hi - _raw.lo) / (1 - _mt - _mb)
        targetVert = { lo: _raw.lo - _mb * _R, hi: _raw.hi + _mt * _R }
      }
      applyYear()
      // Snap the price-anchored annotations to the same target range immediately.
      try { annRedrawRef.current?.(targetVert) } catch { /* overlay not mounted */ }
      yearFramedRef.current = `${fk}:${filteredBars.length}`
      if (sliceHoldRef.current) { sliceHoldRef.current = null; setSliceGen(g => g + 1) }
      return
    }
    if (frameChanged) {
      // Animated Setup ⇄ Result transition: same dual-axis glide as the setup
      // focus zoom — the window slides/stretches across the screen to the new
      // frame while the price scale rides along. focusActiveRef holds the view
      // for the duration so data refreshes / the scheduled re-asserts below
      // can't snap it mid-glide; updateChart's inline pin already skipped this
      // commit (it saw the date change), so the glide starts from the outgoing
      // frame. focusRangeRef stays null so mid-glide setData re-pins are no-ops.
      const series = candleSeriesRef.current
      if (series && !focusProviderInstalledRef.current) {
        try {
          series.applyOptions({
            autoscaleInfoProvider: (orig) => {
              const r = focusPriceRangeRef.current
              if (r && Number.isFinite(r.lo) && Number.isFinite(r.hi) && r.hi > r.lo) {
                return { priceRange: { minValue: r.lo, maxValue: r.hi } }
              }
              return orig ? orig() : null
            },
          })
          focusProviderInstalledRef.current = true
        } catch { /* provider optional */ }
      }
      try { mainPriceScale()?.applyOptions({ autoScale: true }) } catch { /* ignore */ }
      // The vertical is fit to the real candles of each frame. Normally that's the
      // UNPADDED window (the replay pad to the right is blank, so including it would
      // crunch the candles). But in the Result view (keepBarsAfterExit) the pad is
      // filled with REAL post-result candles — a continued run (e.g. TASR) can peak
      // there, above the framed window's high — so the vertical must span the pad
      // too or those candles clip off the top of the settled view.
      const _glideOverlays = fitPriceToCandles ? null : overlayData
      const _tVEnd = keepBarsAfterExit ? Math.min(endIdx + padRight, filteredBars.length - 1) : endIdx
      // An explicit autoscaleInfoProvider price range is used EDGE-TO-EDGE by
      // lightweight-charts — it does NOT get the price scale's scaleMargins (those
      // only pad the default autoscale). So the raw candle high/low would sit flush
      // against the top/bottom of the pane (the tallest candle clipping off the top
      // in the Result view). Bake the same top/bottom headroom the default autoscale
      // would apply into the pinned range so the glide lands with proper margins.
      const _mm = _mainMargins(cs, showVolume && volData.length > 0 && !volInSeparatePane, priceScaleTopMargin, volInSeparatePane ? priceScaleBottomMargin : null)
      const _padVert = (r) => {
        if (!r) return r
        const mt = Math.max(0, Math.min(0.45, _mm?.top ?? 0))
        const mb = Math.max(0, Math.min(0.45, _mm?.bottom ?? 0))
        const denom = 1 - mt - mb
        if (!(denom > 0)) return r
        const R = (r.hi - r.lo) / denom
        return { lo: r.lo - mb * R, hi: r.hi + mt * R }
      }
      const tRangeGlide = _padVert(_windowPriceRange(filteredBars, fromIdx, _tVEnd, _glideOverlays))
      let sRangeGlide = null
      // Start the glide FROM the outgoing frame, re-asserted explicitly (with the
      // same replay pad it's showing, so there's no pre-glide jump). The setData
      // for the new frame (Setup → Result appends bars) can leave the view
      // perturbed in this same commit; effects run before paint, so this restore
      // never flashes. Skipped when a glide is already in flight (rapid flipping)
      // — then we glide from wherever the view currently is.
      if (!focusActiveRef.current) {
        const [oldEntryRaw, oldExitRaw] = prevPinSig.slice(fk.length + 1).split('|')
        const oLo = toMs(oldEntryRaw === 'null' ? null : oldEntryRaw)
        const oHi = toMs(oldExitRaw === 'null' ? null : oldExitRaw)
        let oS = Number.isNaN(oLo) ? 0 : filteredBars.findIndex(b => toMs(b.t) >= oLo)
        if (oS < 0) oS = 0
        // The outgoing frame may have started before the first bar (pre-IPO blank
        // pad, e.g. CRWV's IPO-base setup view sits at a negative `from`). Start the
        // glide from where the view ACTUALLY is, not a snapped bar 0 — otherwise the
        // re-assert below jumps -N → 0 before the glide, glitching the transition.
        if (!Number.isNaN(oLo) && oS === 0) {
          oS = -leadingBlankBars(oLo, toMs(filteredBars[0].t), resolvedTf)
        }
        let oE = filteredBars.length - 1
        if (!Number.isNaN(oHi)) {
          for (let i = filteredBars.length - 1; i >= 0; i--) {
            if (toMs(filteredBars[i].t) <= oHi) { oE = i; break }
          }
        }
        sRangeGlide = _padVert(_windowPriceRange(filteredBars, oS, oE, _glideOverlays))
        const oPad = frameRightPadFrac > 0 ? Math.round((oE - oS) * frameRightPadFrac) : 0
        if (oE > oS) { try { chart.timeScale().setVisibleLogicalRange({ from: oS, to: oE + oPad }) } catch { /* mid-load */ } }
      }
      focusActiveRef.current = true
      focusRangeRef.current = null
      _animateFocusZoom(chart, series, focusRafRef, focusPriceRangeRef, filteredBars,
        { from: fromIdx, to: endIdx + padRight }, 900, () => {
          focusActiveRef.current = false
          // Release a held wider slice (Result → Setup): the outgoing candles
          // are off-screen now, so the tail re-cut is invisible.
          if (sliceHoldRef.current) { sliceHoldRef.current = null; setSliceGen(g => g + 1) }
        }, overlayData, null, null, sRangeGlide, tRangeGlide)
      yearFramedRef.current = `${fk}:${filteredBars.length}`  // already framed — no settle-window re-assert burst needed
      return
    }
    applyYear()
    // First framing of this sym+tf: the chart created with autoSize keeps
    // re-laying-out for several frames after first paint (container 0→real
    // size, ResizeObserver, fonts), and each of those can override the range
    // back to the default latest view — the "shows 2026 until I click another
    // chart" bug. A single rAF fired too early. Re-assert across the whole
    // initial settle window. Guards (same sym+tf, no focus zoom) make a stock
    // switch or a setup click cancel the pending re-asserts; the user can't
    // have manually zoomed this early after load.
    // Re-assert across the settle window on the FIRST framing of this sym+tf AND
    // again whenever the bar count changes for it — the bars load in two phases
    // (instant IDB cache → delayed network swap), and an uncached still-trading
    // stock framed to a PAST year (e.g. the first 2016 name, data running to
    // today) gets its network bars AFTER the first re-assert window closes. Without
    // re-asserting on that swap, the post-network setData snaps the view to the
    // latest bars and it "scrolls back / stays on now until you click another
    // chart". Keying on bar count re-pins through every data phase. (Delisted/
    // custom-bar years end in-year and have a single phase, so they never showed
    // it — this makes every year behave identically.) Tail extended to 1.2s for
    // slow networks.
    const frameSig = `${fk}:${filteredBars.length}`
    if (yearFramedRef.current !== frameSig) {
      yearFramedRef.current = frameSig
      const reassert = () => { if (focusKeyRef.current === fk && !focusActiveRef.current) applyYear() }
      requestAnimationFrame(reassert)
      requestAnimationFrame(() => requestAnimationFrame(reassert))
      setTimeout(reassert, 120)
      setTimeout(reassert, 320)
      setTimeout(reassert, 650)
      setTimeout(reassert, 1200)
    }
    // `mergedMarkers`/`highlightTimeSet` are in the deps so a Model Book tab
    // switch (which swaps markers + highlighted candles → an internal setData
    // that snaps the view to the latest bars) re-runs this pin and re-frames the
    // year. The focusActiveRef guard above means a live setup/catalyst zoom is
    // untouched; all effects run before paint, so there's no flash of "now".
  }, [exactDateRange, entryDate, exitDate, filteredBars, sym, resolvedTf, mergedMarkers, highlightTimeSet, overlayData, frameRightPadFrac, instantFrameFlip])

  // Each stock starts at the year view with setup text hidden; the first focus
  // zoom then eases it in. Without this reset, switching from a focused stock
  // would leave textFadeRef at 1 and the next setup's text would pop in instantly.
  // When annotationsTextVisible drives the fade directly (Setup Library — no focus
  // zoom), seed from it instead of 0 so text is present on first paint (this effect
  // runs AFTER the snap effect above on mount and would otherwise clobber it).
  useEffect(() => {
    textFadeRef.current = annotationsTextVisible == null ? 0 : (annotationsTextVisible ? 1 : 0)
  }, [sym, resolvedTf])  // eslint-disable-line react-hooks/exhaustive-deps -- read at mount only; sym/tf are stable within an example

  // Animated "focus a setup" zoom (Model Book). On a focusNonce bump: if
  // focusDate is set, smoothly zoom so that bar is the last candle on screen
  // (with focusBarsBack bars of lead-up to its left); if focusDate is null,
  // zoom back out to the full [entryDate, exitDate] year and hand the view
  // back to the pin above. Only fires on an actual nonce change so routine
  // data refreshes never re-trigger it.
  useEffect(() => {
    if (focusNonce === lastFocusNonceRef.current) return
    const chart = chartRef.current
    // Leave the nonce unconsumed until we can actually act on it: an initial
    // mount-time focus (Setup Library examples open ON the setup view) fires
    // before the chart/bars exist, and this effect re-runs via the filteredBars
    // dep once they arrive.
    if (!chart || !filteredBars || filteredBars.length === 0) return
    lastFocusNonceRef.current = focusNonce
    const toMs = v => {
      if (v == null) return NaN
      if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
      const s = String(v)
      return Date.parse(s.length <= 10 ? `${s}T00:00:00Z` : s)
    }
    focusKeyRef.current = `${sym}_${resolvedTf}`
    // Install (once) the autoscale provider that lets the focus zoom drive a
    // smoothly-interpolated vertical via focusPriceRangeRef. When the ref is null
    // it defers to the chart's default autoscale, so it's inert outside a focus
    // animation. Model Book only — other charts never call _animateFocusZoom.
    const series = candleSeriesRef.current
    if (series && !focusProviderInstalledRef.current) {
      try {
        series.applyOptions({
          autoscaleInfoProvider: (orig) => {
            const r = focusPriceRangeRef.current
            if (r && Number.isFinite(r.lo) && Number.isFinite(r.hi) && r.hi > r.lo) {
              return { priceRange: { minValue: r.lo, maxValue: r.hi } }
            }
            return orig ? orig() : null
          },
        })
        focusProviderInstalledRef.current = true
      } catch { /* provider optional */ }
    }
    try { mainPriceScale()?.applyOptions({ autoScale: true }) } catch { /* ignore */ }

    if (focusDate) {
      // Last bar on/at-or-before the setup date becomes the rightmost candle.
      const target = toMs(focusDate)
      let idx = -1
      for (let i = filteredBars.length - 1; i >= 0; i--) {
        if (toMs(filteredBars[i].t) <= target) { idx = i; break }
      }
      if (idx < 0) idx = filteredBars.length - 1
      const to = idx                           // integer index = the setup bar is the last fully-shown candle, nothing after it (same as the year pin)
      // Left edge: an explicit start date (first bar on/after it) wins; otherwise
      // fall back to a fixed lead-up. Guard against a start that isn't actually
      // left of the setup bar (bad input) by reverting to the bars-back default.
      let from = Math.max(0, to - focusBarsBack)
      if (focusStartDate) {
        const startMs = toMs(focusStartDate)
        if (!Number.isNaN(startMs)) {
          const sIdx = filteredBars.findIndex(b => toMs(b.t) >= startMs)
          if (sIdx >= 0 && sIdx < idx) from = sIdx
        }
      }
      focusActiveRef.current = true
      focusRangeRef.current = { from, to }   // settled window — updateChart re-asserts it on a bars refetch so the view can't snap back
      _animateFocusZoom(chart, series, focusRafRef, focusPriceRangeRef, filteredBars, { from, to }, 850, null, overlayData, textFadeRef, true)
    } else {
      // Zoom back out to the framed year — same dual-axis glide as the zoom-in.
      // Hold the view (focusActiveRef stays true) until the animation finishes so
      // a data refresh can't snap the pin mid-zoom; release it in onDone.
      const lo = toMs(entryDate)
      const hi = toMs(exitDate)
      let startIdx = filteredBars.findIndex(b => toMs(b.t) >= lo)
      if (startIdx < 0) startIdx = 0
      let endIdx = filteredBars.length - 1
      if (!Number.isNaN(hi)) {
        for (let i = filteredBars.length - 1; i >= 0; i--) {
          if (toMs(filteredBars[i].t) <= hi) { endIdx = i; break }
        }
      }
      if (endIdx < startIdx) endIdx = filteredBars.length - 1
      // Frame start predates the first bar (before an IPO) → blank-space pad so
      // the zoom-out lands on the same framed window as updateChart's year pin.
      let fromIdx = startIdx
      if (startIdx === 0) {
        fromIdx = -leadingBlankBars(lo, toMs(filteredBars[0].t), resolvedTf)
      }
      focusActiveRef.current = true
      focusRangeRef.current = null   // zooming back out to the year — let updateChart's year re-pin resume
      _animateFocusZoom(chart, series, focusRafRef, focusPriceRangeRef, filteredBars,
        { from: fromIdx, to: endIdx }, 850, () => { focusActiveRef.current = false }, overlayData, textFadeRef, false)
    }
  }, [focusNonce, focusDate, focusStartDate, focusBarsBack, filteredBars, entryDate, exitDate, sym, resolvedTf, overlayData])

  // Cancel any in-flight focus animation on unmount.
  useEffect(() => () => { if (focusRafRef.current != null) cancelAnimationFrame(focusRafRef.current) }, [])

  // Manual-interaction escape (Model Book): if the user wheel-zooms or drags the
  // chart while a setup focus is active, they've left the setup view — release
  // focus (annotations were lingering because they track the focus state, not
  // the live view). Skip while authoring annotations (drawing uses the chart).
  const annEditableRef = useRef(annotationsEditable)
  annEditableRef.current = annotationsEditable
  useEffect(() => {
    if (!onFocusEscape) return
    const el = containerRef.current
    if (!el) return
    const escape = () => {
      if (!focusActiveRef.current || annEditableRef.current) return
      focusActiveRef.current = false
      focusPriceRangeRef.current = null
      focusRangeRef.current = null
      try { mainPriceScale()?.applyOptions({ autoScale: true }) } catch { /* ignore */ }
      onFocusEscape()
    }
    // Wheel-zoom escapes immediately. For drag-pan, only escape once the pointer
    // actually moves past a threshold — a plain click (incl. clicking a setup
    // candle to open the intraday popup) shouldn't drop focus. 8px tolerates the
    // few px of jitter a real click carries; a deliberate pan moves far more.
    const onWheel = () => escape()
    let down = null
    const onDown = (e) => { down = { x: e.clientX, y: e.clientY } }
    const onMove = (e) => {
      if (!down) return
      if (Math.abs(e.clientX - down.x) > 8 || Math.abs(e.clientY - down.y) > 8) { down = null; escape() }
    }
    const onUp = () => { down = null }
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
    }
  }, [onFocusEscape])

  // Apply the price-scale mode from effectiveScale (Normal/Log/Percent).
  // Owns the right scale's mode so the A/L/% toggle + forceLogScale default
  // both take effect immediately and persist across data updates.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const mode = effectiveScale === 'pct' ? 2 : (effectiveScale === 'log' ? 1 : 0)
    // Apply to the PRICE scale (via the candle series, robust to the index pane
    // at pane 0) AND the index-comparison pane, so the A/L/% toggle switches
    // both panes together. The index line is raw price, so log/percent are valid.
    try { mainPriceScale()?.applyOptions({ mode }) } catch { /* pre-init */ }
    try { indexPaneSeriesRef.current?.priceScale().applyOptions({ mode }) } catch { /* no index pane */ }
  }, [effectiveScale, chartReady, indexPaneSymbol, indexPaneSeries, mainPriceScale])

  // ── Multi-symbol comparison overlays — add/remove series ──
  // Uses left-side 'comparison' price scale (independent of right price + 'compare' scale).
  // Runs whenever `comparisonSeries` changes (sym list, fetched data, or colors).
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const map = comparisonSeriesRefs.current
    const wanted = new Set(comparisonSeries.map(s => s.sym))

    // Remove series no longer wanted
    for (const [sym, series] of map.entries()) {
      if (!wanted.has(sym)) {
        try { chart.removeSeries(series) } catch {}
        map.delete(sym)
      }
    }

    // Add or update wanted series
    for (const cmp of comparisonSeries) {
      let series = map.get(cmp.sym)
      if (!series) {
        try {
          series = chart.addSeries(LineSeries, {
            priceScaleId: 'left',
            color: cmp.color,
            lineWidth: 2,
            lastValueVisible: true,
            priceLineVisible: false,
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 3,
            title: cmp.sym,
          })
          map.set(cmp.sym, series)
        } catch {
          continue
        }
      } else {
        try { series.applyOptions({ color: cmp.color }) } catch {}
      }
      try { series.setData(cmp.points) } catch {}
    }

    // Toggle left price scale visibility based on whether any comparisons are active
    try {
      if (wanted.size > 0) {
        chart.priceScale('left').applyOptions({
          visible: true,
          scaleMargins: { top: 0.1, bottom: 0.1 },
          borderVisible: false,
        })
      } else {
        chart.priceScale('left').applyOptions({ visible: false })
      }
    } catch {}
  }, [comparisonSeries])

  // ── Index comparison pane (Model Book) — white line in a pane ON TOP ──
  // Creates a LineSeries in its own pane, moves that pane to index 0 (above the
  // price pane) and sizes the three panes [index | price | volume]. Fully
  // additive: when indexPaneSymbol is null, nothing here runs and the chart is
  // byte-identical. Main-pane references elsewhere use getPane() so they stay
  // correct with the extra pane on top. The line is raw price; its scale mode
  // (Normal/Log/Percent) follows the A/L/% toggle so both panes switch together.
  useEffect(() => {
    const chart = chartRef.current
    const mainPane = candleSeriesRef.current?.getPane?.()
    if (!chart || !mainPane) return

    // Tear down ONLY when the feature is turned off (symbol null). Do NOT remove
    // the pane just because the data is transiently empty during a ticker switch —
    // removing it shrinks the price pane and makes the watermark/annotations skip.
    if (!indexPaneSymbol) {
      if (indexMaSeriesRef.current) {
        try { chart.removeSeries(indexMaSeriesRef.current) } catch {}
        indexMaSeriesRef.current = null
      }
      if (indexPaneSeriesRef.current) {
        try { chart.removeSeries(indexPaneSeriesRef.current) } catch {}
        indexPaneSeriesRef.current = null
        // Restore 2-pane (price + volume) or single-pane sizing.
        try {
          const volPane = volumeSeriesRef.current?.getPane?.()
          if (volPane && volPane !== mainPane) {
            const pct = Math.min(45, Math.max(8, volumePaneHeightPct ?? cs.volume?.paneHeightPct ?? 22))
            mainPane.setStretchFactor(100 - pct)
            volPane.setStretchFactor(pct)
          } else {
            mainPane.setStretchFactor(100)
          }
        } catch {}
      }
      return
    }
    // Data not ready yet (e.g. mid ticker-transition) — keep the pane mounted and
    // its current line, skip the update, so the layout (and the overlays pinned to
    // it) stays put instead of shrinking and snapping back.
    if (!indexPaneSeries.length) return

    // Create the series in a fresh bottom pane, then hoist that pane to the top.
    if (!indexPaneSeriesRef.current) {
      try {
        const paneCount = chart.panes().length
        const s = chart.addSeries(LineSeries, {
          color: indexPaneColor,
          lineWidth: 1.5,
          priceLineVisible: false,
          lastValueVisible: false,  // no floating "IXIC <price>" box — label sits top-left of the pane instead
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 2,
          priceScaleId: 'right',
          // Pin the vertical scale to the year's FULL ^IXIC range (same for every
          // stock in the year) so the Nasdaq line + its % annotations stay put when
          // flipping tickers instead of re-autoscaling to each stock's clipped slice.
          autoscaleInfoProvider: () => {
            const sc = indexScaleRef.current
            return (sc.pin && sc.range)
              ? { priceRange: { minValue: sc.range.min, maxValue: sc.range.max } }
              : null
          },
        }, paneCount)
        indexPaneSeriesRef.current = s
        try { s.getPane().moveTo(0) } catch {}
        try { s.priceScale().applyOptions({ borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.2 } }) } catch {}
      } catch { /* pane API unavailable — index pane optional */ }
    }

    if (indexPaneSeriesRef.current) {
      try { indexPaneSeriesRef.current.applyOptions({ color: indexPaneColor }) } catch {}
      // Mode (Normal/Log/Percent) follows the A/L/% toggle — applied here too (not
      // just the mode effect) because that effect runs before this series exists on
      // first load. Cheap + doesn't move the pane, so always applied.
      try {
        const idxMode = effectiveScale === 'pct' ? 2 : (effectiveScale === 'log' ? 1 : 0)
        indexPaneSeriesRef.current.priceScale().applyOptions({ mode: idxMode })
      } catch {}

      // SKIP the line/MA setData + pane relayout when the index data is unchanged
      // since the last draw. Flipping tickers WITHIN a year yields the identical
      // ^IXIC line (same year window), so re-running setData + setStretchFactor only
      // caused a one-frame flicker/shift. A signature (length + sampled times/values
      // + pane sizes) detects a real change — a year switch, a settings change, or a
      // gappy reused ticker whose index coverage actually differs — and only THEN
      // redraws. Result: the Nasdaq pane sits perfectly still during fast scrolling.
      const _isig = indexPaneSeries
      const _mid = _isig[Math.floor(_isig.length / 2)]
      const sig = [
        _isig.length, _isig[0]?.time, _isig[0]?.value, _mid?.time, _mid?.value,
        _isig[_isig.length - 1]?.time, _isig[_isig.length - 1]?.value,
        indexPaneMaSeries.length, indexPaneHeightPct, volumePaneHeightPct, showVolume,
      ].join('|')
      if (sig === lastIndexSigRef.current) return  // identical — leave the pane untouched
      lastIndexSigRef.current = sig

      try { indexPaneSeriesRef.current.setData(indexPaneSeries) } catch {}
      // Keep extra room below the line so a decline's "-X%" label fits under the
      // trough without crowding the pane edge (idempotent — also set at creation).
      try { indexPaneSeriesRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.2 } }) } catch {}

      // 50-period SMA line on the index pane. Shares the index line's pane +
      // 'right' price scale (so it tracks log/pct mode and aligns with the
      // index). Color AND line width/type match the price chart's 50 SMA
      // exactly (same hairline in Model Book's boldCandles mode) so the two
      // blues render as the identical shade — a thicker line dodges the
      // anti-aliasing dimming the hairline gets and would look brighter.
      // autoscaleInfoProvider null = the index line drives the pane's scale,
      // the MA just rides inside it.
      const _idxMaWidth = boldCandles ? 0.5 : 1
      const _idxMaLineType = boldCandles ? LineType.Curved : LineType.Simple
      if (indexPaneMaSeries.length) {
        if (!indexMaSeriesRef.current) {
          try {
            const idxPaneIndex = indexPaneSeriesRef.current.getPane().paneIndex()
            indexMaSeriesRef.current = chart.addSeries(LineSeries, {
              color: indexMaColor,
              lineWidth: _idxMaWidth,
              lineType: _idxMaLineType,
              priceScaleId: 'right',
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: false,
              autoscaleInfoProvider: () => null,
            }, idxPaneIndex)
          } catch { /* pane API unavailable — index MA optional */ }
        }
        if (indexMaSeriesRef.current) {
          try { indexMaSeriesRef.current.applyOptions({ color: indexMaColor, lineWidth: _idxMaWidth, lineType: _idxMaLineType }) } catch {}
          try { indexMaSeriesRef.current.setData(indexPaneMaSeries) } catch {}
        }
      } else if (indexMaSeriesRef.current) {
        try { chart.removeSeries(indexMaSeriesRef.current) } catch {}
        indexMaSeriesRef.current = null
      }
      // Size [index | price | volume].
      try {
        const idxPct = Math.min(40, Math.max(8, indexPaneHeightPct ?? 18))
        const idxPane = indexPaneSeriesRef.current.getPane()
        const volPane = volumeSeriesRef.current?.getPane?.()
        if (volPane && volPane !== mainPane) {
          const volPct = Math.min(45, Math.max(8, volumePaneHeightPct ?? cs.volume?.paneHeightPct ?? 22))
          idxPane.setStretchFactor(idxPct)
          volPane.setStretchFactor(volPct)
          mainPane.setStretchFactor(Math.max(20, 100 - idxPct - volPct))
        } else {
          idxPane.setStretchFactor(idxPct)
          mainPane.setStretchFactor(100 - idxPct)
        }
      } catch {}
    }
  }, [indexPaneSymbol, indexPaneSeries, indexPaneMaSeries, indexMaColor, indexPaneColor, indexPaneHeightPct, volumePaneHeightPct, cs, chartReady, effectiveScale])

  // Remove the index-pane series on unmount.
  useEffect(() => {
    return () => {
      const chart = chartRef.current
      if (chart && indexMaSeriesRef.current) {
        try { chart.removeSeries(indexMaSeriesRef.current) } catch {}
        indexMaSeriesRef.current = null
      }
      if (chart && indexPaneSeriesRef.current) {
        try { chart.removeSeries(indexPaneSeriesRef.current) } catch {}
        indexPaneSeriesRef.current = null
      }
    }
  }, [])

  // Track the price pane's on-screen box so the annotation/callout overlays
  // align to it when the index pane shifts it down. Measures the pane's DOM
  // element (v5.1 getHTMLElement) vs the container; re-measures on container OR
  // pane resize plus a couple of post-layout ticks. No index pane → bounds null.
  useEffect(() => {
    const container = containerRef.current
    if (!container || !indexPaneSymbol) { setOverlayBounds(null); return }
    let raf = null
    const measure = () => {
      try {
        const paneEl = candleSeriesRef.current?.getPane?.()?.getHTMLElement?.()
        if (!paneEl) return
        const c = container.getBoundingClientRect()
        const p = paneEl.getBoundingClientRect()
        const top = Math.max(0, p.top - c.top)
        const height = p.height
        if (!height) return
        setOverlayBounds(prev =>
          (prev && Math.abs(prev.top - top) < 0.5 && Math.abs(prev.height - height) < 0.5)
            ? prev : { top, height })
      } catch { /* pane not ready */ }
    }
    const schedule = () => { if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(measure) }
    measure()
    const ro = new ResizeObserver(schedule)
    ro.observe(container)
    const paneEl = candleSeriesRef.current?.getPane?.()?.getHTMLElement?.()
    if (paneEl) ro.observe(paneEl)
    const t1 = setTimeout(measure, 60)
    const t2 = setTimeout(measure, 300)
    return () => { ro.disconnect(); clearTimeout(t1); clearTimeout(t2); if (raf) cancelAnimationFrame(raf) }
    // NOTE: keyed on whether the index pane EXISTS (length>0), not on the data
    // itself — so a ticker switch (new data, pane unchanged) doesn't re-measure
    // and momentarily shift the overlays. The ResizeObserver catches real resizes.
  }, [indexPaneSymbol, indexPaneSeries.length > 0, indexPaneHeightPct, volumePaneHeightPct, showVolume, chartReady])

  // Track the INDEX pane's on-screen box (same approach as the price-pane
  // overlayBounds above, but measuring the index pane via indexPaneSeriesRef) so
  // the index annotation overlay aligns to the top pane. Only when an index
  // annotation layer is in use.
  const idxOverlayActive = indexAnnotations != null && indexPaneSymbol
    && (indexAnnotationsEditable || indexAnnotations.length > 0)
  useEffect(() => {
    const container = containerRef.current
    if (!container || !idxOverlayActive) { setIndexOverlayBounds(null); return }
    let raf = null
    const paneOf = () => indexPaneSeriesRef.current?.getPane?.()?.getHTMLElement?.()
    const measure = () => {
      try {
        const paneEl = paneOf()
        if (!paneEl) return
        const c = container.getBoundingClientRect()
        const p = paneEl.getBoundingClientRect()
        const top = Math.max(0, p.top - c.top)
        const height = p.height
        if (!height) return
        setIndexOverlayBounds(prev =>
          (prev && Math.abs(prev.top - top) < 0.5 && Math.abs(prev.height - height) < 0.5)
            ? prev : { top, height })
      } catch { /* pane not ready */ }
    }
    const schedule = () => { if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(measure) }
    measure()
    const ro = new ResizeObserver(schedule)
    ro.observe(container)
    const paneEl = paneOf()
    if (paneEl) ro.observe(paneEl)
    const t1 = setTimeout(measure, 60)
    const t2 = setTimeout(measure, 300)
    return () => { ro.disconnect(); clearTimeout(t1); clearTimeout(t2); if (raf) cancelAnimationFrame(raf) }
  }, [idxOverlayActive, indexPaneSeries.length > 0, indexPaneHeightPct, volumePaneHeightPct, showVolume, chartReady])

  // ── Multi-symbol comparison overlays — cleanup on unmount ──
  useEffect(() => {
    return () => {
      const chart = chartRef.current
      const map = comparisonSeriesRefs.current
      if (chart) {
        for (const series of map.values()) {
          try { chart.removeSeries(series) } catch {}
        }
      }
      map.clear()
    }
  }, [])

  // ── Multi-symbol comparison overlays — live tick subscription ──
  // For each enabled comparison sym, subscribe to its realtimeCandle stream and
  // compute fresh % change vs the base close (first valid bar in the fetched series).
  useEffect(() => {
    if (!enabledComparisons.length || !comparisonsData) return
    const unsubs = []
    for (const c of enabledComparisons) {
      const symKey = String(c.sym).toUpperCase()
      const rawBars = comparisonsData[symKey] || []
      // Find first valid close (mirrors normalizeToPctChange base logic)
      let baseClose = null
      for (const b of rawBars) {
        if (b?.c != null && Number.isFinite(b.c)) { baseClose = b.c; break }
      }
      if (!baseClose) continue
      const unsub = realtimeCandle.subscribe(symKey, () => {
        const candle = realtimeCandle.getCandle(symKey, '1')
        if (!candle || !Number.isFinite(candle.c)) return
        const series = comparisonSeriesRefs.current.get(symKey)
        if (!series) return
        const pct = ((candle.c - baseClose) / baseClose) * 100
        try {
          series.update({ time: adjustTime(candle.t), value: pct })
        } catch {}
      })
      unsubs.push(unsub)
    }
    return () => { for (const u of unsubs) { try { u() } catch {} } }
  }, [enabledComparisons, comparisonsData, adjustTime])

  // Mirror rapidly-changing values into refs so processCrosshair reads them
  // without forcing the subscription useEffect below to re-run on every change.
  useEffect(() => {
    overlayDataRef.current = overlayData
    indicatorDataRef.current = indicatorData
    comparisonDataRef.current = comparisonData
    livePricesRef.current = livePrices
    resolvedOverlaysRef.current = resolvedOverlays
    symRef.current = sym
    resolvedTfRef.current = resolvedTf
    onCrosshairMoveRef.current = onCrosshairMove
  })

  // ── Crosshair legend: subscribe to hover events ──
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    // Remove previous subscriber
    if (crosshairSubRef.current) {
      try { chart.unsubscribeCrosshairMove(crosshairSubRef.current) } catch {}
    }

    // Lightweight Charts can fire crosshair-move at 1000Hz on fast mouse
    // polling. Doing a React setState per event blocks the canvas paint loop
    // and the crosshair visibly lags behind the cursor. Coalesce via rAF so
    // we update at most once per animation frame (~60Hz). Read data from refs
    // so the subscription survives live ticks without tearing down.
    const processCrosshair = (param) => {
      const overlayData = overlayDataRef.current
      const indicatorData = indicatorDataRef.current
      const comparisonData = comparisonDataRef.current
      const livePrices = livePricesRef.current
      const resolvedOverlays = resolvedOverlaysRef.current
      const sym = symRef.current
      const onCrosshairMove = onCrosshairMoveRef.current

      const priceData = candleSeriesRef.current ? param.seriesData.get(candleSeriesRef.current) : null
      if (!priceData) { legendHoveringRef.current = false; setCrosshairData(alwaysShowLegend ? computeLatestCrosshair() : null); return }

      const volSeriesData = volumeSeriesRef.current ? param.seriesData.get(volumeSeriesRef.current) : null
      // If volume is 0 or missing (developing bar), use session volume from live data
      let vol = volSeriesData?.value
      if ((!vol || vol === 0) && livePrices[sym]?.volume) {
        vol = livePrices[sym].volume
      }

      // Get overlay values (SMA/EMA) — if missing for current bar, use last available
      const ovValues = overlaySeriesRefs.current.map((s, i) => {
        let d = param.seriesData.get(s)
        if (!d && overlayData[i]?.data?.length) {
          // Developing bar has no MA point — use the last computed value
          const lastOv = overlayData[i].data[overlayData[i].data.length - 1]
          d = lastOv ? { value: lastOv.value } : null
        }
        const ov = resolvedOverlays?.[i]
        if (!d || !ov) return null
        // Match the DISPLAYED line color (ema9MatchCandle repaints the 9-EMA to MB_UP).
        const color = (ema9MatchCandle && ov.type === 'EMA' && Number(ov.period) === 9) ? mbUp : ov.color
        return { label: `${ov.type} ${ov.period}`, value: d.value, color }
      }).filter(Boolean)

      // For OHLC types (candles/bars/hollow)
      const o = priceData.open ?? priceData.value
      const h = priceData.high ?? priceData.value
      const l = priceData.low ?? priceData.value
      const c = priceData.close ?? priceData.value
      // Change is vs the PREVIOUS bar's close (true daily/period % move), not
      // this bar's open. Pull the prior bar straight from the rendered series.
      let prevClose = null
      if (param.logical != null && candleSeriesRef.current) {
        try {
          const pb = candleSeriesRef.current.dataByIndex(param.logical - 1)
          if (pb) prevClose = pb.close ?? pb.value ?? null
        } catch { /* first bar / out of range */ }
      }
      const change = (prevClose != null) ? (c - prevClose) : (c - o)
      const changePct = (prevClose != null && prevClose) ? ((change / prevClose) * 100) : (o ? ((change / o) * 100) : 0)

      let rsiValue = null
      if (rsiSeriesRef.current) {
        const d = param.seriesData.get(rsiSeriesRef.current)
        rsiValue = d?.value ?? (indicatorData.rsi.at(-1)?.value ?? null)
      }

      let macdValue = null, macdSignalValue = null
      if (macdLineRef.current) {
        const dm = param.seriesData.get(macdLineRef.current)
        const ds = macdSignalRef.current ? param.seriesData.get(macdSignalRef.current) : null
        macdValue       = dm?.value ?? (indicatorData.macd.macd.at(-1)?.value   ?? null)
        macdSignalValue = ds?.value ?? (indicatorData.macd.signal.at(-1)?.value ?? null)
      }

      let stochKValue = null, stochDValue = null
      if (stochKRef.current) {
        const dk = param.seriesData.get(stochKRef.current)
        const dd = stochDRef.current ? param.seriesData.get(stochDRef.current) : null
        stochKValue = dk?.value ?? (indicatorData.stoch.k.at(-1)?.value ?? null)
        stochDValue = dd?.value ?? (indicatorData.stoch.d.at(-1)?.value ?? null)
      }

      let atrValue = null
      if (atrSeriesRef.current) {
        const da = param.seriesData.get(atrSeriesRef.current)
        atrValue = da?.value ?? (indicatorData.atr.at(-1)?.value ?? null)
      }

      let sarValue = null
      if (sarSeriesRef.current) {
        const ds = param.seriesData.get(sarSeriesRef.current)
        sarValue = ds?.value ?? (indicatorData.sar.at(-1)?.value ?? null)
      }

      let ichimokuTenkan = null, ichimokuKijun = null
      if (ichimokuTenkanRef.current) {
        const dt = param.seriesData.get(ichimokuTenkanRef.current)
        const dk = ichimokuKijunRef.current ? param.seriesData.get(ichimokuKijunRef.current) : null
        ichimokuTenkan = dt?.value ?? null
        ichimokuKijun  = dk?.value ?? null
      }

      let compareValue = null
      if (compareSeriesRef.current) {
        const dc = param.seriesData.get(compareSeriesRef.current)
        compareValue = dc?.value ?? (comparisonData.at(-1)?.value ?? null)
      }

      legendHoveringRef.current = true
      setCrosshairData({
        time: param.time,
        open: o, high: h, low: l, close: c,
        volume: vol,
        change: change.toFixed(2),
        changePct: changePct.toFixed(2),
        overlays: ovValues,
        rsi: rsiValue, macd: macdValue, macdSig: macdSignalValue,
        stochK: stochKValue, stochD: stochDValue,
        atr: atrValue, sar: sarValue,
        ichimokuTenkan, ichimokuKijun,
        compare: compareValue,
      })

      // ── Multi-chart sync: report crosshair to parent (Task 5) ──
      // Guard above (`if (!param.point) return`) ensures this only fires when
      // the user is actively hovering THIS chart with the mouse. External
      // `setCrosshairPosition` calls don't trigger `param.point`, so this
      // can't self-fire in a loop when the parent sync context dispatches an
      // external crosshair back to this same chart.
      if (typeof onCrosshairMove === 'function' && param.time) {
        onCrosshairMove({
          time: param.time,
          price: candleSeriesRef.current ? param.seriesData.get(candleSeriesRef.current) : null,
        })
      }
    }

    const flush = () => {
      crosshairRafRef.current = null
      const param = crosshairParamRef.current
      crosshairParamRef.current = null
      if (!param) return
      processCrosshair(param)
    }

    const handler = (param) => {
      // Empty-state events bypass the rAF queue so the legend clears immediately
      if (!param.point || !param.time) {
        if (crosshairRafRef.current != null) { cancelAnimationFrame(crosshairRafRef.current); crosshairRafRef.current = null }
        crosshairParamRef.current = null
        legendHoveringRef.current = false
        setCrosshairData(alwaysShowLegend ? computeLatestCrosshair() : null)
        // Tell the sync bus the local user left the chart — but not when this
        // empty event was self-induced by applying an external crosshair.
        if (!applyingExternalRef.current && typeof onCrosshairMoveRef.current === 'function') {
          onCrosshairMoveRef.current(null)
        }
        return
      }
      crosshairParamRef.current = param
      if (crosshairRafRef.current == null) {
        crosshairRafRef.current = requestAnimationFrame(flush)
      }
    }

    chart.subscribeCrosshairMove(handler)
    crosshairSubRef.current = handler

    return () => {
      try { chart.unsubscribeCrosshairMove(handler) } catch {}
      if (crosshairRafRef.current != null) {
        cancelAnimationFrame(crosshairRafRef.current)
        crosshairRafRef.current = null
      }
      crosshairParamRef.current = null
    }
  }, [chartReady])

  // Keep the off-chart legend fresh with the latest bar when the cursor isn't hovering.
  useEffect(() => {
    if (!alwaysShowLegend || !chartReady) return
    if (legendHoveringRef.current) return
    setCrosshairData(computeLatestCrosshair())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alwaysShowLegend, chartReady, ohlcData, overlayData])

  // Live legend ticking. Two pieces, deliberately split so the legend tracks the
  // fast Massive feed (like the theme tracker) WITHOUT re-rendering the whole
  // chart per tick (that storm froze the UI — do NOT reintroduce it):
  //   1. A direct bars-WS subscription writes the newest tick to liveTickRef —
  //      a REF, so ticks cause NO re-render.
  //   2. A BOUNDED ~4/sec timer re-renders just the legend from that ref.
  useEffect(() => {
    if (!liveUpdates || !sym) return undefined
    const unsub = barsStreamManager.subscribe(sym, '1', {
      onBar: (data) => {
        const c = data?.bar?.c ?? data?.trade?.p
        if (!Number.isFinite(c)) return
        liveTickRef.current = { price: c, ts: Date.now() }
        // ── Writer E: fast developing candle for D/W/M ──
        // The Massive PUSH feed (writer B) streams intraday rollups only, so on
        // D/W/M the developing candle otherwise crawls on the slow Finnhub feed.
        // Paint it imperatively here from the fast 1-min tick so the candle + the
        // right-edge price label tick as fast as the legend/theme tracker — NO
        // React re-render (same series.update() path). Guards mirror the other
        // writers: daily+ only, never fight writer B (intraday), skip HA.
        const tf = resolvedTfRef.current
        const isDailyPlus = tf === 'D' || tf === 'W' || tf === 'M'
        if (!isDailyPlus || cs.heikinAshi || barsPushActiveRef.current) return
        // Session-preview owns the D/W/M bar (Include-mode preview candle or the
        // Regular-mode frozen-at-4pm candle) — don't let this fast tick fight it.
        if (sessionOwnsDailyRef.current) return
        // Regular Hours: never fold a pre/post-market tick into the RTH daily
        // candle — even in the up-to-60s window before useMarketOpen flips (which
        // sessionOwnsDailyRef keys off). This tick is live, so wall-clock ET is an
        // accurate, lag-independent session check. (Writer E was the path still
        // seaming post-market onto the daily candle after Writers A/D were gated.)
        if (sessionViewRef.current === 'regular') {
          const _m = etMinutes(Math.floor(Date.now() / 1000))
          if (_m < 570 || _m >= 960) return
        }
        const series = candleSeriesRef.current
        const last = lastBarRef.current
        if (!series || !last) return
        if (!isSaneLivePrice(c, last.close, lastServerCloseRef.current)) return
        const updated = {
          time: last.time,
          open: last.open,
          high: Math.max(last.high, c),
          low: Math.min(last.low, c),
          close: c,
        }
        try {
          if (isOhlcType(cs.chartType)) series.update(updated)
          else series.update({ time: last.time, value: c })
        } catch { /* out of range mid-load */ }
        lastBarRef.current = { ...updated, volume: last.volume }
      },
    })
    return () => { try { unsub() } catch { /* already gone */ } liveTickRef.current = null }
  }, [liveUpdates, sym, cs.heikinAshi, cs.chartType])

  useEffect(() => {
    if (!alwaysShowLegend || !chartReady) return undefined
    const id = setInterval(() => {
      if (legendHoveringRef.current) return   // hover owns the legend — don't fight it
      // crosshairData lives on StockChart, so setting it re-renders this whole
      // (heavy) component. The old code set a FRESH object every 250ms
      // unconditionally → ~4 full re-renders/sec per chart, forever. With several
      // chart widgets open that constant churn janked the live-quote feed
      // (freezes) and destabilized the chart's redraw/resize (jitter). Only set
      // state when the displayed legend actually changed, at a calmer cadence.
      setCrosshairData(prev => {
        const next = computeLatestCrosshair()
        try { if (JSON.stringify(prev) === JSON.stringify(next)) return prev } catch { /* fall through */ }
        return next
      })
    }, 500)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alwaysShowLegend, chartReady, sym])

  // ── Multi-chart sync: report visible time-range changes to parent (Task 5 Step 3) ──
  // No-op when onTimeRangeChange is absent. Uses Lightweight Charts'
  // subscribeVisibleTimeRangeChange so we report in time-space (not logical-space),
  // which means cells with differing bar counts can still align.
  useEffect(() => {
    if (!chartRef.current || typeof onTimeRangeChange !== 'function') return
    const ts = chartRef.current.timeScale()
    const handler = (range) => {
      if (range) onTimeRangeChange({ from: range.from, to: range.to })
    }
    try { ts.subscribeVisibleTimeRangeChange(handler) } catch { return }
    return () => {
      try { ts.unsubscribeVisibleTimeRangeChange(handler) } catch {}
    }
  }, [onTimeRangeChange])

  // ── Multi-chart sync: apply external time range from parent (Task 5 Step 4) ──
  // No-op when externalTimeRange is null. Wrapped in try/catch because
  // setVisibleRange will throw if the range falls outside the loaded data.
  useEffect(() => {
    if (!chartRef.current || !externalTimeRange) return
    try {
      chartRef.current.timeScale().setVisibleRange({
        from: externalTimeRange.from,
        to: externalTimeRange.to,
      })
    } catch {}
  }, [externalTimeRange])

  // ── Multi-chart sync: render external crosshair from parent (Task 5 Step 5) ──
  // No-op when externalCrosshair is null. Uses Lightweight Charts v5's
  // setCrosshairPosition / clearCrosshairPosition API. Wrapped in try/catch
  // so charts on older LWC versions silently skip rather than crash.
  // Critical: this API does NOT trigger `param.point` on the subscribed
  // crosshair handler, so the local-report effect above won't re-fire and
  // create an infinite loop.
  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current) return
    // Never let the multi-chart sync override the LOCAL user's crosshair while
    // they're actively hovering THIS chart — the crosshair must only follow their
    // own mouse. (Bug: with a 2nd synced widget carrying a live chart, its
    // broadcast snapped the hovered chart's crosshair to the current bar/price
    // the moment the mouse stopped moving.) When not hovering, the sync applies
    // normally so you still see the other chart's crosshair.
    if (legendHoveringRef.current) return
    // Suppress clear-echo: applying a crosshair fires a point-less crosshair
    // event that must not be re-broadcast as a "mouse left" clear.
    applyingExternalRef.current = true
    if (!externalCrosshair?.time) {
      try { chartRef.current.clearCrosshairPosition() } catch {}
    } else {
      try {
        // Snap the incoming crosshair time to THIS chart's nearest bar so linked
        // widgets on DIFFERENT timeframes sync correctly: hovering an intraday bar
        // for a given day moves the daily chart's crosshair to that day's daily
        // candle (and vice-versa). For same-TF the nearest bar IS the exact bar,
        // so behavior is unchanged. Times are compared in the adjusted (ET) space
        // both charts render in. Bars are time-sorted → binary search for nearest.
        const T = externalCrosshair.time
        let snapTime = T
        let priceVal =
          externalCrosshair.price?.close ??
          externalCrosshair.price?.value ??
          (typeof externalCrosshair.price === 'number' ? externalCrosshair.price : 0)
        const cbars = prevBarsRef.current
        if (cbars && cbars.length && typeof T === 'number') {
          let lo = 0, hi = cbars.length - 1
          while (hi - lo > 1) {
            const mid = (lo + hi) >> 1
            if (adjustTime(cbars[mid].t) < T) lo = mid; else hi = mid
          }
          const bLo = cbars[lo], bHi = cbars[hi]
          const nearest =
            Math.abs(adjustTime(bLo.t) - T) <= Math.abs(adjustTime(bHi.t) - T) ? bLo : bHi
          snapTime = adjustTime(nearest.t)
          if (typeof nearest.c === 'number') priceVal = nearest.c
        }
        chartRef.current.setCrosshairPosition(
          priceVal,
          snapTime,
          candleSeriesRef.current,
        )
      } catch {}
    }
    const raf = requestAnimationFrame(() => { applyingExternalRef.current = false })
    return () => cancelAnimationFrame(raf)
  }, [externalCrosshair])

  // ── Right-click on a bar → fire callback or dispatch global event ──
  // Behavior:
  //   • If `onBarContextMenu` prop is supplied (explicit opt-in), fire it —
  //     the consumer owns the flow (e.g. Journal 2.0 ChartModal).
  //   • Otherwise, dispatch a global `uct:chart-contextmenu` CustomEvent on
  //     `window`. The GlobalAddPositionProvider mounted at the app root
  //     catches it and shows the "+ Add to Portfolio" menu. Every StockChart
  //     across the dashboard gets the right-click-to-add flow for free,
  //     with zero Journal 2.0 coupling inside StockChart.
  //   • Pass `onBarContextMenu={() => {}}` to suppress both behaviors on a
  //     specific chart.
  //
  // Bar lookup strategy: track the hovered bar via the chart's crosshair
  // subscription. On contextmenu, read the ref. The data reported by
  // `param.seriesData.get(candleSeries)` IS the canonical bar as rendered
  // by LW Charts (time + OHLC), which means zero time-format guessing
  // across TFs — works uniformly on 1min through Monthly. Falls back to
  // coordinateToLogical if the cursor hasn't moved over a bar yet.
  const hoveredBarRef = useRef(null)
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const sub = (param) => {
      const priceData = candleSeriesRef.current
        ? param?.seriesData?.get(candleSeriesRef.current)
        : null
      if (!priceData) {
        hoveredBarRef.current = null
        return
      }
      // priceData has { time, open, high, low, close } in LW Chart's own
      // format. Normalize `time` into a UTC-seconds number so the rest
      // of the pipeline (date rendering, prefill, etc.) can treat it
      // uniformly.
      let tUtcSec
      if (typeof priceData.time === 'number') {
        // Intraday: data was fed with +_ET_OFFSET; undo it.
        tUtcSec = priceData.time - _ET_OFFSET
      } else if (typeof priceData.time === 'string') {
        // "YYYY-MM-DD" — midnight UTC
        tUtcSec = Math.floor(new Date(priceData.time + 'T00:00:00Z').getTime() / 1000)
      } else if (priceData.time && typeof priceData.time === 'object') {
        // BusinessDay { year, month, day }
        const { year, month, day } = priceData.time
        tUtcSec = Math.floor(Date.UTC(year, month - 1, day) / 1000)
      } else {
        hoveredBarRef.current = null
        return
      }
      hoveredBarRef.current = {
        t: tUtcSec,
        o: priceData.open,
        h: priceData.high,
        l: priceData.low,
        c: priceData.close,
      }
    }
    chart.subscribeCrosshairMove(sub)
    return () => { try { chart.unsubscribeCrosshairMove(sub) } catch {} }
  }, [chartReady])

  // ── Drag-to-measure (Charts workspace, TC2000-style) ──────────────────────
  const dragMeasureCanvasRef = useRef(null)
  const dragMeasureStateRef = useRef(null)   // { startX, startY, startPrice, startLogical } while dragging
  const [measureReadout, setMeasureReadout] = useState(null)  // { x, y, pct, bars, span, flip } | null

  // Plain mouse-drag pans (default). The Ctrl+drag measure locks scrolling only for
  // the duration of the drag (in onDown/end below); frozen (Setup Library) stays
  // non-pannable. This effect just holds the default so a data-poll re-applyOptions
  // can't clobber it.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !chartReady) return
    if (measureLockRef.current) return   // don't clobber an in-progress measure lock
    try { chart.applyOptions({ handleScroll: frozen ? false : true }) } catch { /* not ready */ }
  }, [frozen, chartReady])

  // Press-drag A→B: dashed line on a transient canvas + a cursor-following
  // % / bars / time readout. Free cursor price (coordinateToPrice, unsnapped).
  // Everything clears on release. Move/up listen on window so a fast drag that
  // leaves the chart still tracks + always releases; no pointer-capture, so
  // LWC keeps updating its own crosshair underneath.
  useEffect(() => {
    const el = containerRef.current
    if (!el || !chartReady || !dragMeasure) return
    if (activeTool && activeTool !== 'cursor') return

    const getPos = (e) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height } }
    const clearLine = () => {
      const c = dragMeasureCanvasRef.current; if (!c) return
      const ctx = c.getContext('2d'); if (ctx) ctx.clearRect(0, 0, c.width, c.height)
    }
    const drawLine = (x1, y1, x2, y2, w, h) => {
      const c = dragMeasureCanvasRef.current; if (!c) return
      const dpr = window.devicePixelRatio || 1
      const W = Math.round(w * dpr), H = Math.round(h * dpr)
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; c.style.width = w + 'px'; c.style.height = h + 'px' }
      const ctx = c.getContext('2d'); if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.strokeStyle = 'rgba(224,218,200,0.85)'; ctx.lineWidth = 1; ctx.setLineDash([5, 4])
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
      ctx.setLineDash([]); ctx.fillStyle = 'rgba(224,218,200,0.95)'
      ctx.beginPath(); ctx.arc(x1, y1, 2.5, 0, 6.283); ctx.fill()
      ctx.beginPath(); ctx.arc(x2, y2, 2.5, 0, 6.283); ctx.fill()
    }
    const onMove = (e) => {
      const st = dragMeasureStateRef.current; if (!st) return
      const series = candleSeriesRef.current, chart = chartRef.current
      if (!series || !chart) return
      const { x, y, w, h } = getPos(e)
      if (Math.abs(x - st.startX) < 3 && Math.abs(y - st.startY) < 3) { clearLine(); setMeasureReadout(null); return }
      const curPrice = series.coordinateToPrice(y)
      const curLogical = chart.timeScale().coordinateToLogical(x)
      if (curPrice == null || curLogical == null) return
      drawLine(st.startX, st.startY, x, y, w, h)
      const dollar = curPrice - st.startPrice
      const pct = st.startPrice ? dollar / st.startPrice * 100 : 0
      const barsN = Math.abs(Math.round(curLogical - st.startLogical))
      const arr = prevBarsRef.current || []
      const clamp = (i) => Math.max(0, Math.min(arr.length - 1, Math.round(i)))
      const b1 = arr[clamp(st.startLogical)], b2 = arr[clamp(curLogical)]
      const span = (b1 && b2) ? _formatMeasureSpan(b1.t, b2.t) : ''
      setMeasureReadout({ x, y, dollar, pct, bars: barsN, span, flip: x > w - 200 })
    }
    const end = () => {
      dragMeasureStateRef.current = null
      measureLockRef.current = false
      clearLine(); setMeasureReadout(null)
      // Restore pan + zoom after the Ctrl+drag measure.
      try { chartRef.current?.applyOptions({ handleScroll: frozen ? false : true, handleScale: !frozen }) } catch { /* noop */ }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    const onDown = (e) => {
      if (e.button !== 0 || (e.pointerType && e.pointerType !== 'mouse')) return
      // Only measure while Ctrl is held — a plain drag pans the chart (LWC handles it).
      if (!e.ctrlKey) return
      const series = candleSeriesRef.current, chart = chartRef.current
      if (!series || !chart) return
      const { x, y } = getPos(e)
      const startPrice = series.coordinateToPrice(y)
      const startLogical = chart.timeScale().coordinateToLogical(x)
      if (startPrice == null || startLogical == null) return
      // Lock the chart in place for the whole measure so it can't pan/zoom while
      // you drag A→B; end() restores it. measureLockRef also survives data-poll
      // re-applyOptions (see the creation handleScroll site).
      measureLockRef.current = true
      try { chart.applyOptions({ handleScroll: false, handleScale: false }) } catch { /* noop */ }
      dragMeasureStateRef.current = { startX: x, startY: y, startPrice, startLogical }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    }
    el.addEventListener('pointerdown', onDown)
    return () => { el.removeEventListener('pointerdown', onDown); end() }
  }, [dragMeasure, chartReady, activeTool, frozen])

  // ── Persist a user's volume-pane resize ───────────────────────────────────
  // LWC has no separator-drag event, so poll the actual volume-pane fraction; when
  // it diverges from what we last applied (the user dragged the separator), fire
  // onVolumePaneResize so the caller can persist it + feed it back as
  // volumePaneHeightPct. Only active when a caller wants to persist (workspace).
  useEffect(() => {
    if (!chartReady || !onVolumePaneResize) return undefined
    const chart = chartRef.current
    if (!chart) return undefined
    const id = setInterval(() => {
      try {
        const mainPane = candleSeriesRef.current?.getPane?.()
        const volPane = volumeSeriesRef.current?.getPane?.()
        if (!mainPane || !volPane || mainPane === volPane) return
        const hMain = mainPane.getHeight(), hVol = volPane.getHeight()
        const total = hMain + hVol
        if (!(total > 0)) return
        const actual = Math.round((hVol / total) * 100)
        const applied = lastAppliedVolPctRef.current
        // Detect + fire only — do NOT touch lastAppliedVolPctRef here. Leaving it at
        // the code-applied value keeps updateChart's gate (lastApplied === pct)
        // TRUE during the drag, so a data poll won't re-apply the old height and
        // snap the pane back. Once the persisted value feeds back as the prop,
        // updateChart applies it, lastApplied catches up, and this stops firing.
        if (applied != null && Math.abs(actual - applied) >= 2 && actual >= 5 && actual <= 60) {
          onVolumePaneResize(actual)
        }
      } catch { /* not ready */ }
    }, 300)
    return () => clearInterval(id)
  }, [chartReady, onVolumePaneResize])

  // ── Time-scroll grip ──────────────────────────────────────────────────────
  // Because drag-pan is repurposed for measuring, this small grip (bottom-right,
  // at the time axis) lets the user drag left/right to scroll the chart through
  // time. Shown only with dragMeasure. Position tracks the price-axis width +
  // time-axis height so it sits just left of the axis, at the date row.
  const GRIP_W = 34   // grip button width — used to center it on the last candle
  const [scrollGripPos, setScrollGripPos] = useState({ left: null, top: null })
  useEffect(() => {
    if (!dragMeasure || !chartReady) return
    const chart = chartRef.current; if (!chart) return
    const ts = chart.timeScale()
    let raf = null
    let lastTop = -1, lastLeft = -1
    // rAF sampler: recompute the grip's top/left every frame but only re-render on
    // a change. This tracks the price/volume pane BOUNDARY as you drag the pane
    // separator (resize the volume pane) — the grip stays pinned to the top of the
    // volume pane — as well as pan/zoom (horizontal) and window resize.
    const tick = () => {
      let top = null
      try {
        const panes = chart.panes ? chart.panes() : null
        const h0 = (panes && panes[0] && panes[0].getHeight) ? panes[0].getHeight() : 0
        if (h0 > 0) top = Math.max(4, h0 - 22)   // just above the price/volume boundary
      } catch { /* pane API missing → bottom fallback in JSX */ }
      // Center the grip horizontally on the LAST candle so it lines up with the
      // most recent bar as the chart pans/zooms.
      let left = null
      try {
        const t = lastBarRef.current?.time
        const x = (t != null) ? ts.timeToCoordinate(t) : null
        if (x != null && Number.isFinite(x)) {
          const plotW = ts.width() || 0
          const maxLeft = plotW > 0 ? plotW - GRIP_W - 2 : x
          left = Math.max(2, Math.min(maxLeft, x - GRIP_W / 2))
        }
      } catch { /* range not ready */ }
      if (top !== lastTop || left !== lastLeft) {
        lastTop = top; lastLeft = left
        setScrollGripPos({ left, top })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { if (raf) cancelAnimationFrame(raf) }
  }, [dragMeasure, chartReady])

  const onScrollGripDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const chart = chartRef.current, el = containerRef.current
    if (!chart || !el) return
    const ts = chart.timeScale()
    const startRange = ts.getVisibleLogicalRange(); if (!startRange) return
    // bars-per-pixel from the chart's OWN coordinate mapping — robust. Deriving it
    // from ts.width() read 0 in the event handler → barSpacing ~0.008 → a tiny drag
    // jumped the view thousands of bars ("skips back 20 years"). This is exact 1:1.
    const l0 = ts.coordinateToLogical(0), l100 = ts.coordinateToLogical(100)
    const barsPerPx = (l0 != null && l100 != null && l100 !== l0)
      ? (l100 - l0) / 100
      : (startRange.to - startRange.from) / Math.max(1, el.getBoundingClientRect().width)
    const startX = e.clientX
    const move = (ev) => {
      const dxBars = (ev.clientX - startX) * barsPerPx
      // Move the last candle the SAME direction as the grip: drag left → last
      // candle moves left (whitespace opens on the right). This repositions the
      // right edge, not a history-scroll. The grip itself re-centers on the last
      // candle via the visibleLogicalRange subscription that this setter fires.
      try { ts.setVisibleLogicalRange({ from: startRange.from - dxBars, to: startRange.to - dxBars }) } catch {}
    }
    const up = () => {
      // Leave the grip where the user released it (don't snap back home).
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  useEffect(() => {
    const el = containerRef.current
    const chart = chartRef.current
    if (!el || !chart || !bars || bars.length === 0) return

    // Shared open-menu routine: invoked by desktop right-click (`contextmenu`)
    // and by touch long-press. Reads the anchor from `clientX`/`clientY` so it
    // works regardless of which input triggered it.
    const openMenuAt = (clientX, clientY, e) => {
      const rect = el.getBoundingClientRect()
      const px = clientX - rect.left
      const py = clientY - rect.top

      // Prefer the currently-hovered bar (from crosshair tracking). Falls
      // back to coordinateToLogical if crosshair hasn't fired yet (edge
      // case: user right-clicks immediately without moving the mouse).
      let closest = hoveredBarRef.current
      if (!closest) {
        let logical = null
        try { logical = chart.timeScale().coordinateToLogical(px) } catch { return }
        if (logical == null) return
        const idx = Math.max(0, Math.min(bars.length - 1, Math.round(logical)))
        closest = bars[idx]
      }
      if (!closest) return

      // Only block the browser default menu once we know we have a bar.
      e?.preventDefault?.()

      // ── Resolve which region of the chart was clicked ──────────────────
      // Axis widths + pane heights come straight from the chart; band layout
      // mirrors the render path's computePaneMargins so the menu matches what
      // the user sees.
      const separateVolume = showVolume && (!!cs.volume.separatePane || (Array.isArray(cs.volumeOverlayIndicators) && cs.volumeOverlayIndicators.length > 0))
      let axisWidth = 0, timeAxisHeight = 0, pane0Height = rect.height
      try { axisWidth = (mainPriceScale()?.width?.()) ?? chart.priceScale('right').width() } catch {}
      try { timeAxisHeight = chart.timeScale().height() } catch {}
      try { pane0Height = (candleSeriesRef.current?.getPane?.()?.getHeight?.()) ?? chart.panes()[0]?.getHeight() ?? (rect.height - timeAxisHeight) } catch { pane0Height = rect.height - timeAxisHeight }
      const paneMargins = computePaneMargins(cs, showVolume && !separateVolume, cs.volumeOverlayIndicators)
      let region = resolveChartRegion({
        x: px, y: py, width: rect.width, height: rect.height,
        axisWidth, timeAxisHeight, paneMargins, separateVolume, pane0Height,
      })

      // Refine the open price area to a specific MA/overlay line when the
      // click lands within a few px of one. Only when overlays come from
      // chart settings (not a prop override on embedded charts).
      if (region.type === 'price' && overlaysProp === undefined) {
        let logical = null
        try { logical = chart.timeScale().coordinateToLogical(px) } catch {}
        if (logical != null) {
          const idx = Math.round(logical)
          let best = -1, bestDist = 7
          const series = overlaySeriesRefs.current || []
          for (let i = 0; i < series.length; i++) {
            let val = null, yc = null
            try { val = series[i].dataByIndex(idx)?.value } catch {}
            if (val == null) continue
            try { yc = series[i].priceToCoordinate(val) } catch {}
            if (yc == null) continue
            const dist = Math.abs(yc - py)
            if (dist < bestDist) { bestDist = dist; best = i }
          }
          if (best >= 0) region = { type: 'overlay', index: best }
        }
      }

      // Price under the cursor (for "draw line here" / "set alert here").
      // Only meaningful in price/axis regions where y maps to the price scale.
      let clickPrice = null
      if (region.type === 'price' || region.type === 'priceAxis') {
        try {
          const p = candleSeriesRef.current?.coordinateToPrice(py)
          if (Number.isFinite(p) && p > 0) clickPrice = p
        } catch {}
      }
      const currentPrice = Number.isFinite(lastPriceRef.current) ? lastPriceRef.current : (closest?.c ?? null)

      const sections = buildRegionSections(region, clickPrice)

      // Lazy chart screenshot: only invoked if the consumer actually needs
      // it (e.g. "Save to Notebook"). Lightweight Charts v5 exposes
      // takeScreenshot() → HTMLCanvasElement; we wrap it as a Promise<Blob>.
      const getScreenshotBlob = () => new Promise((resolve, reject) => {
        try {
          const c = chart.takeScreenshot()
          if (!c) return reject(new Error('no canvas'))
          c.toBlob((blob) => blob ? resolve(blob) : reject(new Error('toBlob failed')), 'image/png')
        } catch (err) {
          reject(err)
        }
      })

      if (onBarContextMenu) {
        onBarContextMenu({
          bar: closest,
          clientX,
          clientY,
          event: e,
          getScreenshotBlob,
          region,
          sections,
          clickPrice,
          currentPrice,
          resetView: () => {
            try {
              const ts = chartRef.current?.timeScale(); if (!ts) return
              const len = lastBarCountRef.current || 0
              if (len > 1) {
                const { from, to } = computeDefaultLogicalRange(len, resolvedTf, { dailyDefaultBars, leftBarPad, rightPadBars })
                ts.setVisibleLogicalRange({ from, to })
              } else {
                ts.resetTimeScale()
              }
            } catch { /* noop */ }
          },
          openSettings: () => { try { toolbarRef.current?.openSettings() } catch { /* noop */ } },
          clearDrawings: () => { try { clearAll?.() } catch { /* noop */ } },
          hasDrawings: (drawings?.length || 0) > 0,
        })
      } else {
        window.dispatchEvent(new CustomEvent('uct:chart-contextmenu', {
          detail: {
            sym,
            tf: resolvedTf,
            bar: closest,
            clientX,
            clientY,
            getScreenshotBlob,
            region,
            sections,
            clickPrice,
            currentPrice,
          },
        }))
      }
    }

    // Desktop: native right-click fires immediately.
    const onContextMenu = (e) => openMenuAt(e.clientX, e.clientY, e)

    // Touch: long-press (≥450ms, no significant movement) opens the same menu.
    // Skipped while a drawing/position tool is armed so a long-press never
    // collides with placing/dragging a drawing. Mirrors useLongPress + the
    // TickerActions long-press pattern.
    let lpTimer = null
    let lpStart = { x: 0, y: 0 }
    const clearLp = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null } }
    const onPointerDown = (e) => {
      if (e.pointerType === 'mouse') return            // mouse uses native contextmenu
      if (activeToolRef.current) return                // a drawing tool is armed — don't intercept
      lpStart = { x: e.clientX, y: e.clientY }
      const cx = e.clientX, cy = e.clientY
      clearLp()
      lpTimer = setTimeout(() => {
        lpTimer = null
        if (activeToolRef.current) return              // tool armed mid-press
        try { navigator.vibrate?.(10) } catch { /* noop */ }
        openMenuAt(cx, cy, null)
      }, 450)
    }
    const onPointerMove = (e) => {
      if (!lpTimer) return
      if (Math.abs(e.clientX - lpStart.x) > 10 || Math.abs(e.clientY - lpStart.y) > 10) clearLp()
    }

    el.addEventListener('contextmenu', onContextMenu)
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', clearLp)
    el.addEventListener('pointercancel', clearLp)
    return () => {
      el.removeEventListener('contextmenu', onContextMenu)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', clearLp)
      el.removeEventListener('pointercancel', clearLp)
      clearLp()
    }
  }, [onBarContextMenu, bars, sym, resolvedTf, cs, showVolume, showVolumeProp, overlaysProp, resolvedOverlays, showDrawingTools, handleUpdateChartSettings, buildRegionSections])

  // ── News marker click handler ──
  // Lightweight Charts doesn't expose a direct marker-click event, so we
  // subscribe to all clicks and match the clicked time against news markers
  // with a tolerance of half a bar. On match → open the article URL.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !newsMarkers?.length) return
    const tfSec = PERIOD_SECONDS[resolvedTf] || (resolvedTf === 'D' ? 23400 : 86400)
    const handler = (param) => {
      if (!param || param.time == null) return
      // Compare based on time-type alignment (number vs string).
      const matching = newsMarkers.find(m => {
        if (typeof m.time === 'number' && typeof param.time === 'number') {
          return Math.abs(m.time - param.time) < tfSec * 0.5
        }
        return String(m.time) === String(param.time)
      })
      if (matching?._newsData?.url) {
        window.open(matching._newsData.url, '_blank', 'noopener,noreferrer')
      }
    }
    chart.subscribeClick(handler)
    return () => {
      try { chart.unsubscribeClick(handler) } catch {}
    }
  }, [newsMarkers, resolvedTf])

  // ── Highlighted setup/catalyst candle click → onHighlightClick (Model Book) ──
  // Clicking a painted setup/catalyst candle opens the intraday 5-min popup. We
  // match the clicked time against the highlight set, resolve it back to the
  // original YYYY-MM-DD via highlightTimeMap, and hand the parent screen coords
  // (from the click point + container rect) to anchor the popover.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !onHighlightClick || !highlightTimeMap || highlightTimeMap.size === 0) return
    const tfSec = PERIOD_SECONDS[resolvedTf] || (resolvedTf === 'D' ? 23400 : 86400)
    const handler = (param) => {
      if (!param || param.time == null) return
      const t = param.time
      let origDate = highlightTimeMap.get(t) ?? null
      if (origDate == null) {  // tolerance match (intraday number times / business-day objects)
        for (const [adj, orig] of highlightTimeMap) {
          if (typeof adj === 'number' && typeof t === 'number') {
            if (Math.abs(adj - t) < tfSec * 0.5) { origDate = orig; break }
          } else if (String(adj) === String(t)) { origDate = orig; break }
        }
      }
      if (origDate == null) return
      const rect = containerRef.current?.getBoundingClientRect()
      const clientX = rect && param.point ? rect.left + param.point.x : null
      const clientY = rect && param.point ? rect.top + param.point.y : null
      // Pin the main chart's view across the click. Clicking a setup/catalyst
      // candle only opens the intraday popup — it must NEVER move the underlying
      // chart. A bare click can still trip the focus-escape pan-detector (a few
      // px of pointer jitter), which drops the setup focus and lets the next
      // updateChart snap the view back to the full year ("glitches to the left").
      // Capturing the current logical range and re-asserting it across the settle
      // window makes the open visually inert regardless of what fired underneath.
      let pinned = null
      try { pinned = chart.timeScale().getVisibleLogicalRange() } catch { /* ignore */ }
      if (pinned) {
        const reassert = () => {
          try { chart.timeScale().setVisibleLogicalRange({ from: pinned.from, to: pinned.to }) } catch { /* out of range mid-load */ }
        }
        requestAnimationFrame(reassert)
        requestAnimationFrame(() => requestAnimationFrame(reassert))
        setTimeout(reassert, 60)
        setTimeout(reassert, 180)
      }
      onHighlightClick({ date: String(origDate), clientX, clientY })
    }
    chart.subscribeClick(handler)
    return () => { try { chart.unsubscribeClick(handler) } catch {} }
  }, [onHighlightClick, highlightTimeMap, resolvedTf])

  // ── Volume Profile canvas overlay ──
  useEffect(() => {
    const canvas = vpCanvasRef.current
    const chart = chartRef.current
    if (!chart || !canvas) return
    const vpCfg = cs.indicators?.volumeProfile
    const series = candleSeriesRef.current

    // Resize canvas to match container
    const container = containerRef.current
    if (container) {
      canvas.width  = container.offsetWidth
      canvas.height = container.offsetHeight
    }

    const redraw = () => drawVolumeProfile(canvas, chart, series, filteredBars, vpCfg)
    redraw()
    const unsub = chart.timeScale().subscribeVisibleLogicalRangeChange(redraw)
    return () => {
      try { unsub() } catch {}
      const ctx = canvas.getContext('2d')
      ctx?.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [cs.indicators?.volumeProfile, filteredBars])

  // Viewport-first backfill (Phase 2): while at the shallow first-paint depth,
  // bump to the full target when the user pans toward the oldest loaded bar.
  // setFetchDepth changes the SWR key → a no-`since` full fetch lands the deeper
  // superset, and the same-ticker re-anchor holds the view. Disabled for overlay
  // modes (they already fetch full) and pinned charts (entryDate / exactDateRange
  // / barsOverride). Mirrors the existing visible-range subscription pattern.
  useEffect(() => {
    if (_overlayActive || entryDate || exactDateRange || _hasOverride) return undefined
    if (fetchDepth >= _fullTarget) return undefined
    const chart = chartRef.current
    if (!chart) return undefined
    let raf = null
    const onRange = () => {
      if (raf != null) return
      raf = requestAnimationFrame(() => {
        raf = null
        let range = null
        try { range = chart.timeScale().getVisibleLogicalRange() } catch { /* mid-load */ }
        if (!range) return
        if (shouldBackfill({
          fromIndex: range.from,
          toIndex: range.to,
          loadedCount: lastBarCountRef.current,
          fullTarget: _fullTarget,
        })) {
          // Progressive: step to the next depth tier, not straight to full. A
          // deep intraday jump (600->20000) is a single ~20s fetch before any
          // history appears; stepping lands a fast first chunk and only fetches
          // full if the user keeps panning past it. The re-anchor holds the view
          // across each step. (D/W/M reach full in one step or via dwell-warm.)
          setFetchDepth(d => nextBackfillDepth(d, _fullTarget))
        }
      })
    }
    let unsub = null
    try { unsub = chart.timeScale().subscribeVisibleLogicalRangeChange(onRange) } catch { /* ignore */ }
    return () => {
      if (unsub) { try { unsub() } catch { /* ignore */ } }
      if (raf != null) cancelAnimationFrame(raf)
    }
  }, [sym, resolvedTf, fetchDepth, _overlayActive, entryDate, exactDateRange, _hasOverride, _fullTarget])

  // Proactive deep-history warm (dwell-gated) — makes scroll-back INSTANT.
  // The viewport-first first paint is shallow (FIRST_PAINT_BARS) for an instant
  // open; the pan-backfill above then loads full history on demand, which costs
  // ~1-3s the FIRST time a user scrolls back on a given stock. Here we remove
  // that wait for daily/weekly/monthly: once a chart has been studied for ~2.5s
  // (so we don't warm on quick ticker-flipping), we quietly bump to the full
  // depth in the background. It reuses the exact same setFetchDepth path as the
  // pan-backfill, so the same-ticker re-anchor holds the visible view (no jump)
  // — by the time the user pans left, the deep history is already loaded. Server
  // SQLite caches it once for everyone, so this is a one-time fetch per stock.
  // Intraday is excluded: its deep windows are 20-30k bars, too heavy to load on
  // every chart that's merely open — those stay on-demand via the pan backfill.
  useEffect(() => {
    if (_overlayActive || entryDate || exactDateRange || _hasOverride) return undefined
    if (fetchDepth >= _fullTarget) return undefined
    if (!['D', 'W', 'M'].includes(resolvedTf)) return undefined
    const id = setTimeout(() => setFetchDepth(_fullTarget), 2500)
    return () => clearTimeout(id)
  }, [sym, resolvedTf, fetchDepth, _overlayActive, entryDate, exactDateRange, _hasOverride, _fullTarget])

  // Cleanup: destroy chart only on unmount
  useEffect(() => {
    return () => {
      try { markersControllerRef.current?.detach?.() } catch {}
      markersControllerRef.current = null
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
        candleSeriesRef.current = null
        volumeSeriesRef.current = null
        overlaySeriesRefs.current = []
        priceLineRefs.current = []
      }
    }
  }, [])

  // ── Clear drawing selection on symbol/tf change ──
  useEffect(() => {
    setActiveTool(null)
    setSelectedId(null)
  }, [sym, resolvedTf])

  // ── Bar-correction flash subscription (P4-7) ──
  // Fires the visible "Bar corrected" pill for 2s when minute-close
  // reconciliation overrides the WS-built bar for this symbol.
  useEffect(() => {
    if (!sym) return
    const unsub = realtimeCandle.onCorrection(sym, () => {
      setCorrectionFlash(true)
      setTimeout(() => setCorrectionFlash(false), 2000)
    })
    return unsub
  }, [sym])

  // ── Tick-by-tick developing-candle update via realtimeCandle registry ──
  // (Plan 4 / Goal 3) — drive series.update() on every SSE tick instead of
  // waiting for the 2s REST poll cycle. Coexists with the REST-driven live-
  // price effect above (line ~851) as a SAFETY FALLBACK; both paths write to
  // the same series and the latest write wins. SSE will dominate when the
  // stream is connected (target: tick-to-pixel <200ms); REST keeps the chart
  // alive when SSE drops or for tickers not in the WS subscription set.
  //
  // The registry stores tf="1" only (built from raw ticks). For:
  //   - resolvedTf="1": use registry candle directly.
  //   - resolvedTf in {5,15,30,60}: use the registry's latest tick price to
  //     update the developing bar tracked in liveBarRef (set by the REST/AM
  //     paths). We extend h/l and update close, mirroring the same logic the
  //     REST effect uses, but firing at SSE cadence.
  useEffect(() => {
    if (!sym) return
    if (!candleSeriesRef.current) return
    if (replayMode) return
    if (cs.heikinAshi) return
    const isIntradayTf = ['1', '5', '15', '30', '60'].includes(resolvedTf)
    if (!isIntradayTf) return

    const useOhlc = isOhlcType(cs.chartType)

    const update = () => {
      if (!candleSeriesRef.current) return
      // Writer C of the single-writer invariant (index @ barsPushActiveRef decl): the
      // Finnhub-fed registry is suppressed when the Massive push feed is the authoritative
      // developing-bar writer (onRealtimeBar owns it).
      if (barsPushActiveRef.current) return
      const candle = realtimeCandle.getCandle(sym, '1')
      if (!candle) return
      const price = candle.c
      if (!Number.isFinite(price) || price <= 0) return
      // RTH-only intraday (EXT/RTH toggle off): don't paint a pre/post-market
      // developing bar, matching sessionBars' 9:30–16:00 ET fetch filter.
      if (!showExtendedRef.current) {
        const _m = etMinutes(candle.t)
        if (_m < 570 || _m >= 960) return
      }
      // Sanity bound vs last known close — protects against bad ticks.
      const lastClose = lastBarRef.current?.close
      if (lastClose && lastClose > 0 && Math.abs(price - lastClose) / lastClose > 0.5) return

      try {
        if (resolvedTf === '1') {
          // Registry's 1m candle IS the developing bar. Apply it directly,
          // but offset to ET like all other series timestamps.
          const tSec = candle.t + _ET_OFFSET
          // Never apply a BACKWARDS update. The SSE tick feed and the 30s REST/SWR
          // poll have different latencies, so at a minute rollover the registry can
          // momentarily lag the series' newest bar; a stale/lagged tick applied at an
          // older time throws LWC "Cannot update oldest data" (once/minute console
          // spam) and is lost anyway. Skip it — equal time updates in place, newer
          // appends a legit new bar. (The deeper single-writer fix is Phase C.)
          const _lastT = lastBarRef.current?.time
          if (typeof _lastT === 'number' && tSec < _lastT) return
          if (useOhlc) {
            candleSeriesRef.current.update({
              time: tSec,
              open: candle.o,
              high: candle.h,
              low: candle.l,
              close: candle.c,
            })
          } else {
            candleSeriesRef.current.update({ time: tSec, value: candle.c })
          }
          if (volumeSeriesRef.current) {
            // match the candle palette (same derivation as volData) so the
            // developing bar's volume color matches the historical bars
            const _vUp = boldCandles ? mbUp : modelBookLook ? BOLD_UP : cs.volume.upColor
            const _vDown = boldCandles ? mbDown : modelBookLook ? BOLD_DOWN : cs.volume.downColor
            const _pbC = prevBarsRef.current
            const _prevCC = colorByNetChange && _pbC && _pbC.length >= 2 ? _pbC[_pbC.length - 2].c : null
            const _upC = _prevCC != null ? (candle.c >= _prevCC) : (candle.c >= candle.o)
            volumeSeriesRef.current.update({
              time: tSec,
              value: candle.v || 0,
              color: _upC ? _vUp : _vDown,
            })
          }
          // Sync trackers so REST path stays consistent
          if (liveBarRef.current && liveBarRef.current.time === tSec) {
            liveBarRef.current = {
              time: tSec, open: candle.o, high: candle.h, low: candle.l, close: candle.c,
            }
          }
          if (lastBarRef.current && lastBarRef.current.time === tSec) {
            lastBarRef.current = { ...lastBarRef.current, open: candle.o, high: candle.h, low: candle.l, close: candle.c }
          }
        } else {
          // 5/15/30/60 — registry only has 1m bars, so use its latest price
          // to extend the developing bar's h/l and update close. Bar's `t`
          // comes from liveBarRef (set by REST/AM paths).
          const lb = liveBarRef.current
          const last = lastBarRef.current
          if (!lb || !last || lb.time !== last.time) return
          const newHigh = Math.max(lb.high, price)
          const newLow = Math.min(lb.low, price)
          liveBarRef.current = { ...lb, high: newHigh, low: newLow, close: price }
          const updated = {
            time: last.time,
            open: last.open,
            high: newHigh,
            low: newLow,
            close: price,
          }
          if (useOhlc) {
            candleSeriesRef.current.update(updated)
          } else {
            candleSeriesRef.current.update({ time: last.time, value: price })
          }
          lastBarRef.current = { ...updated, volume: last.volume }
        }
      } catch (e) {
        // "Cannot update oldest data" is the benign rollover race guarded above (the
        // candle is never corrupted — LWC just refuses the backwards write). Don't
        // spam the console for it; surface any other, genuinely unexpected error.
        if (e?.message && !/oldest data/i.test(e.message)) {
          console.warn('[StockChart] registry tick update error:', e.message)
        }
      }
    }

    // Fire once on subscribe in case a tick already landed before mount,
    // then subscribe to future ticks.
    update()
    const unsub = realtimeCandle.subscribe(sym, update)
    return unsub
  }, [sym, resolvedTf, replayMode, cs.heikinAshi, cs.chartType, cs.volume.upColor, cs.volume.downColor])

  // ── Render ──
  // Date-range bar (bottom-left, above the volume pane). Reframes the visible window
  // to the requested price-history span on the CURRENT bars via a date-based cutoff,
  // so it works precisely on daily (its intended use) and degrades gracefully to
  // "all available" on shorter-history intraday timeframes.
  const applyRange = (val) => {
    try {
      const ts = chartRef.current?.timeScale()
      const _bars = filteredBars
      if (!ts || !_bars || _bars.length < 2) return
      const lastMs = _dateToMs(_bars[_bars.length - 1].t)
      if (!Number.isFinite(lastMs)) return
      const d = new Date(lastMs)
      const cutoffMs = val === 'ytd'
        ? Date.UTC(d.getUTCFullYear(), 0, 1)
        : Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - val, d.getUTCDate())
      let fromIdx = _bars.findIndex(b => _dateToMs(b.t) >= cutoffMs)
      if (fromIdx < 0) fromIdx = 0
      const lastIdx = _bars.length - 1
      if (lastIdx - fromIdx < 1) return
      ts.setVisibleLogicalRange({ from: fromIdx, to: lastIdx + (rightPadBars || 3) })
    } catch { /* noop */ }
  }
  const _rangeVolPct = Math.min(45, Math.max(8, volumePaneHeightPct ?? cs.volume?.paneHeightPct ?? 22))

  return (
    <div className={`${styles.wrapper} ${className}`} style={{ height }}>
      {replayMode && sessionBars?.length > 0 && (
        <div className={styles.replayBadge} title="Time Machine — historical replay active">
          <UIcon name="skipBack" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />REPLAY {Math.round(((replayIndex ?? 0) / Math.max(1, sessionBars.length - 1)) * 100)}%
        </div>
      )}
      {liveUpdates && realtimeTfEligible && (
        <div
          className={feed.state === 'live' ? styles.liveIndicator : styles.staleIndicator}
          title={
            feed.state === 'reconnecting' ? 'Reconnecting to the live feed…'
            : feed.state === 'stale' ? 'Live feed has paused — last tick is older than expected'
            : 'Live feed connected'
          }
        >
          {feed.state === 'live' ? '● LIVE' : feed.state === 'reconnecting' ? '⟳ RECONNECTING' : <><UIcon name="pause" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />STALE</>}
        </div>
      )}
      {correctionFlash && (
        <div className={styles.correctionFlash} title="Server corrected this bar after reconciliation">
          ↻ Bar corrected
        </div>
      )}
      {cs.countdown && !hideCountdown && countdownTfSec && currentBarStart && (
        <div className={styles.countdownPosition}>
          <CountdownTimer barStartTime={currentBarStart} tfSeconds={countdownTfSec} />
        </div>
      )}
      {enabledComparisons.length > 0 && (
        <div className={styles.comparisonLegend}>
          <span className={styles.legendLabel}>vs {sym}:</span>
          {comparisonSeries.map(s => {
            const last = s.points && s.points.length ? s.points[s.points.length - 1] : null
            const pct = last?.value
            const valid = Number.isFinite(pct)
            return (
              <span key={s.sym} className={styles.legendItem} style={{ color: s.color }}>
                {s.sym} {valid ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '—'}
              </span>
            )
          })}
        </div>
      )}
      {loading && <ChartSkeleton label={`Loading ${sym}…`} />}
      {showFatalError && (
        <div className={styles.error}>
          <span>Failed to load chart for {sym}</span>
          <button className={styles.retryBtn} onClick={() => mutate()}>Retry</button>
        </div>
      )}
      {!loading && !showFatalError && selectedRangeEmpty && (
        <div className={styles.error}>
          <span>No {sym} chart data for the selected dates.</span>
          <span style={{ fontSize: 10, opacity: 0.8, maxWidth: 280, textAlign: 'center', lineHeight: 1.5 }}>
            The data provider has no bars in this window (the ticker may have been
            delisted, renamed, or not yet listed then). Pick a date range the ticker
            actually traded.
          </span>
        </div>
      )}
      <div
        ref={containerRef}
        className={styles.chart}
        style={{
          display: (showFatalError || selectedRangeEmpty) ? 'none' : 'block',
          // Sunrise: paint the continuous sky gradient here, BEHIND the transparent
          // LWC canvas, so it flows unbroken through the price + volume panes.
          background: canvasTheme === 'sunrise' ? SUNRISE_GRADIENT : undefined,
        }}
      />
      {/* ── Dark Pool volume profile bars — uses series.priceToCoordinate() to
          stay aligned with candles at any zoom/pan level. Updates every frame
          via rAF (see darkPoolBarsLayout effect above). The container is
          pointer-events:none so chart hover passes through; individual bars
          set pointer-events:auto so the hover tooltip works on them. ── */}
      {!showFatalError && chartReady && darkPoolBarsLayout.length > 0 && (
        <div
          ref={dpBarsContainerRef}
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 10,
            overflow: 'hidden',
          }}
        >
          {darkPoolBarsLayout.map((b) => (
            <div
              key={`dp-${b.idx}-${b.price}`}
              data-dp-bar=""
              data-price={b.price}
              style={{
                position: 'absolute',
                right: 60,        // leave room for LWC's right price axis
                height: 0,
                display: 'none',  // rAF will set display:block once positioned
                pointerEvents: 'auto',
                cursor: 'help',
              }}
              onMouseEnter={(e) => setDpHover({ bar: b, x: e.clientX, y: e.clientY })}
              onMouseMove={(e) => setDpHover({ bar: b, x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setDpHover(null)}
            >
              <div style={{
                position: 'absolute',
                right: 0,
                top: -b.height / 2,
                width: b.width,
                height: b.height,
                background: b.color,
                opacity: b.opacity,
                borderRadius: 1,
              }}/>
              {b.showLabel && (
                <span
                  style={{
                    position: 'absolute',
                    right: b.width + 3,
                    top: -7,
                    fontSize: 9.5,
                    color: b.color,
                    fontWeight: 700,
                    // Top 3 always need to be legible — bar opacity caps at
                    // 0.50, so push label opacity to ~0.95 for high contrast.
                    opacity: Math.min(1, b.opacity + 0.45),
                    whiteSpace: 'nowrap',
                    fontFamily: "'Instrument Sans','SF Pro Display',system-ui,sans-serif",
                    pointerEvents: 'none',
                  }}>
                  {formatDpNotional(b.notional)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {/* Dark Pool hover tooltip — rendered into document.body via Portal
          so it always escapes any parent that has `transform`, `filter`, or
          `will-change` set (common CSS perf hacks that silently re-anchor
          `position: fixed` to the transformed ancestor instead of the
          viewport — which was making the tooltip clip off-screen no matter
          how we clamped the math).
          Position policy: always to the LEFT of the cursor, because dark
          pool bars are anchored to the chart's right edge so the cursor is
          guaranteed to be on the right side. Always-left is simpler and
          more predictable than a flip-based approach. Final left/top are
          clamped to the viewport so the tooltip can never overflow. */}
      {dpHover && typeof document !== 'undefined' && createPortal((() => {
        const TOOLTIP_W = 260
        const TOOLTIP_H = 150
        const vw = window.innerWidth || document.documentElement.clientWidth || 1920
        const vh = window.innerHeight || document.documentElement.clientHeight || 1080
        // Always position to the LEFT of cursor — bars sit on the chart's
        // right edge so cursor is always near the right side of the screen,
        // and opening leftward is the natural direction. Clamp to ≥8 so
        // even an edge-case left-side cursor doesn't push us off-screen.
        const rawLeft = dpHover.x - 14 - TOOLTIP_W
        const left = Math.max(8, Math.min(rawLeft, vw - TOOLTIP_W - 8))
        const top = Math.max(8, Math.min(dpHover.y - 90, vh - TOOLTIP_H - 8))
        return (
          <div style={{
            position: 'fixed',
            left,
            top,
            background: '#0e0f0d',
            border: '1px solid #c9a84c66',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 11,
            color: '#e0dac8',
            pointerEvents: 'none',
            zIndex: 9999,
            boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
            minWidth: 200,
            maxWidth: TOOLTIP_W,
            lineHeight: 1.5,
            fontFamily: "'Instrument Sans','SF Pro Display',system-ui,sans-serif",
          }}>
            <div style={{ fontWeight: 700, color: '#c9a84c', fontSize: 12, marginBottom: 5 }}>
              🟡 Dark Pool Print{dpHover.bar.isLatest ? ' · LATEST' : ''}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px' }}>
              <span style={{ color: '#706b5e' }}>Date</span>
              <span style={{ color: '#e0dac8', fontWeight: 600 }}>
                {dpHover.bar.dateLong || dpHover.bar.dateRaw || dpHover.bar.date || '—'}
              </span>
              <span style={{ color: '#706b5e' }}>Price</span>
              <span style={{ color: '#c9a84c', fontWeight: 700 }}>
                ${Number(dpHover.bar.price).toFixed(2)}
              </span>
              <span style={{ color: '#706b5e' }}>Premium</span>
              <span style={{ color: '#6ba3be', fontWeight: 600 }}>
                {formatDpNotional(dpHover.bar.notional)}
              </span>
              {dpHover.bar.pctAvgVol > 0 && (
                <>
                  <span style={{ color: '#706b5e' }}>Vs avg vol</span>
                  <span style={{ color: '#a78bfa', fontWeight: 600 }}>
                    {Math.round(dpHover.bar.pctAvgVol)}%
                  </span>
                </>
              )}
            </div>
          </div>
        )
      })(), document.body)}
      {!showFatalError && (
        <img
          src={brandMark}
          alt="Uncharted Territory"
          className={styles.brandLogo}
          draggable={false}
        />
      )}
      {/* Price-scale mode toggle — sits on the right price axis, just above the
          volume/indicator pane stack (top of the sub-panes = main.bottom frac).
          26px allows for the time axis below the price-pane drawing area. */}
      {!showFatalError && chartReady && (
        <div
          className={styles.scaleToggle}
          style={{ bottom: boldCandles ? '3px' : `calc(26px + (100% - 26px) * ${computePaneMargins(cs, showVolume && volData.length > 0 && !volInSeparatePane).main.bottom})` }}
          title="Price scale: Arithmetic / Logarithmic / Percent"
        >
          <button
            className={`${styles.scaleToggleBtn} ${effectiveScale === 'arith' ? styles.scaleToggleActive : ''}`}
            onClick={() => setScale('arith')}
            title="Arithmetic (linear) scale"
            aria-label="Arithmetic price scale"
          >A</button>
          <button
            className={`${styles.scaleToggleBtn} ${effectiveScale === 'log' ? styles.scaleToggleActive : ''}`}
            onClick={() => setScale('log')}
            title="Logarithmic scale"
            aria-label="Logarithmic price scale"
          >L</button>
          <button
            className={`${styles.scaleToggleBtn} ${effectiveScale === 'pct' ? styles.scaleToggleActive : ''}`}
            onClick={() => setScale('pct')}
            title="Percentage scale"
            aria-label="Percentage price scale"
          >%</button>
        </div>
      )}
      {crosshairData && !hideLegend && (
        <div
          className={`${styles.legend}${verticalLegend ? ' ' + styles.legendVertical : ''}`}
          /* Drop below the index pane so the OHLCV legend never covers it. */
          style={overlayBounds ? { top: overlayBounds.top + 6 } : undefined}
        >
          {verticalLegend ? (
            <>
              <span className={styles.vlHead}>{formatLegendTime(crosshairData.time)}</span>
              <span className={styles.vlChange} style={{ color: parseFloat(crosshairData.change) >= 0 ? '#1ae51a' : '#c41f2d' }}>
                {parseFloat(crosshairData.change) >= 0 ? '+' : ''}{crosshairData.change} ({crosshairData.changePct}%)
              </span>
              <span className={styles.vlLabel}>Open</span><span className={styles.vlVal}>{crosshairData.open?.toFixed(2)}</span>
              <span className={styles.vlLabel}>High</span><span className={styles.vlVal}>{crosshairData.high?.toFixed(2)}</span>
              <span className={styles.vlLabel}>Low</span><span className={styles.vlVal}>{crosshairData.low?.toFixed(2)}</span>
              <span className={styles.vlLabel}>Close</span><span className={styles.vlVal}>{crosshairData.close?.toFixed(2)}</span>
              {crosshairData.volume != null && (
                <><span className={styles.vlLabel}>Vol</span><span className={styles.vlVal}>{formatVolume(crosshairData.volume)}</span></>
              )}
              {crosshairData.overlays.flatMap((ov, i) => [
                <span key={'l' + i} className={styles.vlLabel} style={{ color: ov.color }}>{ov.label}</span>,
                <span key={'v' + i} className={styles.vlVal} style={{ color: ov.color }}>{ov.value?.toFixed(2)}</span>,
              ])}
              {crosshairData.rsi != null && (<span className={styles.vlFull} style={{ color: cs.indicators?.rsi?.color || '#7b68ee' }}>RSI({cs.indicators?.rsi?.period || 14}) {crosshairData.rsi.toFixed(1)}</span>)}
              {crosshairData.macd != null && (<span className={styles.vlFull} style={{ color: cs.indicators?.macd?.macdColor || '#2196F3' }}>MACD {crosshairData.macd.toFixed(4)}</span>)}
              {crosshairData.macdSig != null && (<span className={styles.vlFull} style={{ color: cs.indicators?.macd?.signalColor || '#FF9800' }}>SIG {crosshairData.macdSig.toFixed(4)}</span>)}
              {crosshairData.stochK != null && (<span className={styles.vlFull} style={{ color: cs.indicators?.stoch?.kColor || '#FF6B6B' }}>%K {crosshairData.stochK.toFixed(1)}</span>)}
              {crosshairData.stochD != null && (<span className={styles.vlFull} style={{ color: cs.indicators?.stoch?.dColor || '#4ECDC4' }}>%D {crosshairData.stochD.toFixed(1)}</span>)}
              {crosshairData.atr != null && (<span className={styles.vlFull} style={{ color: cs.indicators?.atr?.color || '#FFA726' }}>ATR({cs.indicators?.atr?.period || 14}) {crosshairData.atr.toFixed(4)}</span>)}
              {crosshairData.sar != null && (<span className={styles.vlFull} style={{ color: cs.indicators?.sar?.color || '#ffeb3b' }}>SAR {crosshairData.sar.toFixed(4)}</span>)}
              {crosshairData.ichimokuTenkan != null && (<span className={styles.vlFull} style={{ color: cs.indicators?.ichimoku?.tenkanColor || '#26C6DA' }}>TK {crosshairData.ichimokuTenkan.toFixed(2)}</span>)}
              {crosshairData.ichimokuKijun != null && (<span className={styles.vlFull} style={{ color: cs.indicators?.ichimoku?.kijunColor || '#EF5350' }}>KJ {crosshairData.ichimokuKijun.toFixed(2)}</span>)}
              {crosshairData.compare != null && compareSymbol && (<span className={styles.vlFull} style={{ color: '#fb923c' }}>{compareSymbol.toUpperCase()} {crosshairData.compare > 0 ? '+' : ''}{crosshairData.compare.toFixed(2)}%</span>)}
            </>
          ) : (
          <>
          <span className={styles.legendTime}>{formatLegendTime(crosshairData.time)}</span>
          <span className={styles.legendLabel}>O <span className={styles.legendVal}>{crosshairData.open?.toFixed(2)}</span></span>
          <span className={styles.legendLabel}>H <span className={styles.legendVal}>{crosshairData.high?.toFixed(2)}</span></span>
          <span className={styles.legendLabel}>L <span className={styles.legendVal}>{crosshairData.low?.toFixed(2)}</span></span>
          <span className={styles.legendLabel}>C <span className={styles.legendVal}>{crosshairData.close?.toFixed(2)}</span></span>
          {crosshairData.volume != null && (
            <span className={styles.legendLabel}>V <span className={styles.legendVal}>{formatVolume(crosshairData.volume)}</span></span>
          )}
          <span className={parseFloat(crosshairData.change) >= 0 ? styles.legendUp : styles.legendDown}>
            {parseFloat(crosshairData.change) >= 0 ? '+' : ''}{crosshairData.change} ({crosshairData.changePct}%)
          </span>
          {crosshairData.overlays.map((ov, i) => (
            <span key={i} style={{ color: ov.color }}>{ov.label} <strong>{ov.value?.toFixed(2)}</strong></span>
          ))}
          {crosshairData.rsi != null && (
            <span style={{ color: cs.indicators?.rsi?.color || '#7b68ee' }}>
              RSI({cs.indicators?.rsi?.period || 14}) {crosshairData.rsi.toFixed(1)}
            </span>
          )}
          {crosshairData.macd != null && (
            <span style={{ color: cs.indicators?.macd?.macdColor || '#2196F3' }}>
              MACD {crosshairData.macd.toFixed(4)}
            </span>
          )}
          {crosshairData.macdSig != null && (
            <span style={{ color: cs.indicators?.macd?.signalColor || '#FF9800' }}>
              SIG {crosshairData.macdSig.toFixed(4)}
            </span>
          )}
          {crosshairData.stochK != null && (
            <span style={{ color: cs.indicators?.stoch?.kColor || '#FF6B6B' }}>
              %K {crosshairData.stochK.toFixed(1)}
            </span>
          )}
          {crosshairData.stochD != null && (
            <span style={{ color: cs.indicators?.stoch?.dColor || '#4ECDC4' }}>
              %D {crosshairData.stochD.toFixed(1)}
            </span>
          )}
          {crosshairData.atr != null && (
            <span style={{ color: cs.indicators?.atr?.color || '#FFA726' }}>
              ATR({cs.indicators?.atr?.period || 14}) {crosshairData.atr.toFixed(4)}
            </span>
          )}
          {crosshairData.sar != null && (
            <span style={{ color: cs.indicators?.sar?.color || '#ffeb3b' }}>
              SAR {crosshairData.sar.toFixed(4)}
            </span>
          )}
          {crosshairData.ichimokuTenkan != null && (
            <span style={{ color: cs.indicators?.ichimoku?.tenkanColor || '#26C6DA' }}>
              TK {crosshairData.ichimokuTenkan.toFixed(2)}
            </span>
          )}
          {crosshairData.ichimokuKijun != null && (
            <span style={{ color: cs.indicators?.ichimoku?.kijunColor || '#EF5350' }}>
              KJ {crosshairData.ichimokuKijun.toFixed(2)}
            </span>
          )}
          {crosshairData.compare != null && compareSymbol && (
            <span style={{ color: '#fb923c' }}>
              {compareSymbol.toUpperCase()} {crosshairData.compare > 0 ? '+' : ''}{crosshairData.compare.toFixed(2)}%
            </span>
          )}
          </>
          )}
        </div>
      )}
      <canvas
        ref={vpCanvasRef}
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 2 }}
      />
      {/* Drag-to-measure: transient dashed line + cursor-following readout. */}
      {dragMeasure && (
        <canvas
          ref={dragMeasureCanvasRef}
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 5 }}
        />
      )}
      {dragMeasure && measureReadout && (
        <div style={{
          position: 'absolute',
          left: measureReadout.x, top: measureReadout.y,
          /* Positive/up move → readout sits top-left of the crosshair; negative/down
             move → bottom-right. Keeps it clear of the measure line either way. */
          transform: measureReadout.pct >= 0
            ? 'translate(calc(-100% - 12px), calc(-100% - 12px))'
            : 'translate(12px, 12px)',
          pointerEvents: 'none', zIndex: 6, whiteSpace: 'nowrap',
          fontFamily: "'Instrument Sans', system-ui, sans-serif", fontSize: 12, lineHeight: 1.35,
          /* No box — float the data on the canvas; dark text-shadow keeps it legible over candles. */
          textShadow: '0 1px 3px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.95)',
        }}>
          <div style={{ fontWeight: 700, color: measureReadout.pct >= 0 ? '#1ae51a' : '#c41f2d' }}>
            {measureReadout.dollar >= 0 ? '+' : '-'}${Math.abs(measureReadout.dollar).toFixed(2)}
            <span style={{ marginLeft: 8 }}>
              ({measureReadout.pct >= 0 ? '+' : ''}{measureReadout.pct.toFixed(2)}%)
            </span>
          </div>
          <div style={{ color: '#a8a290', fontSize: 11 }}>
            {measureReadout.bars} {measureReadout.bars === 1 ? 'bar' : 'bars'}{measureReadout.span ? ` · ${measureReadout.span}` : ''}
          </div>
        </div>
      )}
      {/* Time-scroll grip — drag left/right to pan the chart through time (since
          drag-pan is repurposed for measuring). */}
      {dragMeasure && chartReady && (
        <div
          onPointerDown={onScrollGripDown}
          title="Drag left / right to scroll the chart through time"
          style={{
            position: 'absolute',
            ...(scrollGripPos.left != null ? { left: scrollGripPos.left } : { right: 56 }),
            ...(scrollGripPos.top != null ? { top: scrollGripPos.top } : { bottom: 30 }),
            zIndex: 7, cursor: 'ew-resize', pointerEvents: 'auto', touchAction: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 34, height: 16, borderRadius: 8,
            background: 'rgba(201,168,76,0.18)', border: '1px solid rgba(201,168,76,0.5)',
            color: '#c9a84c', userSelect: 'none',
            boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
          }}
        >
          <svg width="22" height="10" viewBox="0 0 22 10" style={{ display: 'block' }}>
            <path d="M6 1 L2 5 L6 9 M16 1 L20 5 L16 9" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
      {showRangeSelector && chartReady && filteredBars?.length > 1 && (
        <div className={styles.rangeBar} style={{ bottom: `calc(${_rangeVolPct}% + 30px)` }}>
          {RANGE_OPTS.map(([label, val], i) => (
            <button
              key={label + i}
              type="button"
              className={styles.rangeBtn}
              title={`Show ${label} of price history`}
              onClick={() => applyRange(val)}
            >{label}</button>
          ))}
        </div>
      )}
      {bars?.length > 0 && (
        <PatternOverlay
          chart={chartRef.current}
          series={candleSeriesRef.current}
          containerRef={containerRef}
          detections={patternDetections}
          enabled={showPatterns}
          onDetectionClick={setActiveDetection}
        />
      )}
      {showDrawingTools && bars?.length > 0 && (
        <>
          <ChartDrawingOverlay
            chartRef={chartRef}
            seriesRef={candleSeriesRef}
            bars={bars}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            color={drawColor}
            lineWidth={drawWidth}
            magnet={magnet}
            drawings={cs.hideDrawings ? [] : drawings}
            addDrawing={addDrawing}
            updateDrawing={updateDrawing}
            removeDrawing={removeDrawing}
            reorderDrawing={reorderDrawing}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            repeatMode={repeatMode}
            undo={undo}
            redo={redo}
            snapshotHistory={snapshotHistory}
          />
          <ChartToolbar
            ref={toolbarRef}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            color={drawColor}
            setColor={setDrawColor}
            lineWidth={drawWidth}
            setLineWidth={setDrawWidth}
            hasSelection={!!selectedId}
            onDelete={() => { removeDrawing(selectedId); setSelectedId(null) }}
            onClearAll={clearAll}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
            drawingCount={drawings.length}
            repeatMode={repeatMode}
            setRepeatMode={handleSetRepeatMode}
            magnet={magnet}
            setMagnet={setMagnet}
            chartSettings={cs}
            onUpdateSettings={handleUpdateChartSettings}
            showExtended={isIntraday && !hideExtHoursToolbarToggle ? showExtended : null}
            onToggleExtended={isIntraday && !hideExtHoursToolbarToggle ? handleToggleExtended : null}
            onScreenshot={() => setScreenshotPopoverOpen(true)}
            onShowHelp={() => setHelpOpen(true)}
            tf={resolvedTf}
            currentSym={sym}
            compareSymbol={compareSymbol}
            onCompareChange={onCompareChange}
            replayMode={replayMode}
            replayPlaying={replayPlaying}
            replaySpeed={replaySpeed}
            replayDate={replayMode && filteredBars?.length ? filteredBars[filteredBars.length - 1]?.t : null}
            replayIndex={replayIndex ?? 0}
            replayTotal={sessionBars?.length || 0}
            onReplayToggle={() => {
              if (replayMode) {
                setReplayMode(false)
                setReplayPlaying(false)
                setReplayIndex(null)
              } else {
                setReplayMode(true)
                setReplayPlaying(false)
                setReplayIndex(Math.floor((sessionBars?.length || 1) * 0.7))
              }
            }}
            onReplayPlayPause={() => setReplayPlaying(p => !p)}
            onReplayStep={dir => {
              setReplayPlaying(false)
              setReplayIndex(i => {
                const max = (sessionBars?.length || 1) - 1
                return Math.max(0, Math.min(max, (i ?? 0) + dir))
              })
            }}
            onReplayIndexChange={idx => {
              setReplayPlaying(false)
              const max = (sessionBars?.length || 1) - 1
              setReplayIndex(Math.max(0, Math.min(max, idx)))
            }}
            onReplaySpeedChange={setReplaySpeed}
            showPatterns={showPatterns}
            onTogglePatterns={handleTogglePatterns}
            hideReplay={hideReplay}
            hidePatterns={hidePatterns}
            hideCompare={hideCompare}
            hideCountdown={hideCountdown}
          />
          {screenshotPopoverOpen && (
            <ScreenshotPopover
              onDownload={handleDownload}
              onCopy={handleCopyImage}
              onShare={handleCopyShareUrl}
              onClose={() => setScreenshotPopoverOpen(false)}
            />
          )}
          {activeTool === 'position' && (
            <PositionPanel
              entry={positionTool.entry}
              stop={positionTool.stop}
              target={positionTool.target}
              accountSize={cs.positionCalc?.accountSize ?? 50000}
              riskPct={cs.positionCalc?.riskPct ?? 1}
              onChange={({ entry, stop, target }) => setPositionTool(p => ({ ...p, entry, stop, target }))}
              onConfigChange={({ accountSize, riskPct }) =>
                handleUpdateChartSettings({
                  ...cs,
                  positionCalc: { accountSize, riskPct },
                })
              }
              onClear={() => setPositionTool(p => ({ ...p, entry: '', stop: '', target: '' }))}
              onClose={() => setActiveTool(null)}
            />
          )}
        </>
      )}

      {/* Per-setup annotations (Model Book). Separate from the normal drawing
          tools (Model Book runs with showDrawingTools=false). Read-only by
          default — activeTool=null makes the overlay canvas pointer-transparent
          so the focus zoom still works underneath. The wrapper fades the whole
          layer in/out as the chart zooms onto / away from the setup. */}
      {annotations != null && bars?.length > 0 && (!indexPaneSymbol || overlayBounds) && (
        <div
          style={overlayWrapStyle({
            zIndex: 4,
            opacity: annotationsVisible ? annotationsOpacity : 0,
            transition: 'opacity 150ms ease',
            pointerEvents: annotationsEditable ? 'auto' : 'none',
          })}
        >
          <ChartDrawingOverlay
            chartRef={chartRef}
            seriesRef={candleSeriesRef}
            bars={bars}
            hidePriceLabels
            redrawHandleRef={annRedrawRef}
            textFadeRef={annotationsEditable ? null : textFadeRef}
            fadeWholeLayer={!annotationsEditable && annotationsFadeWhole}
            activeTool={annotationsEditable ? activeTool : null}
            setActiveTool={setActiveTool}
            color={drawColor}
            lineWidth={drawWidth}
            lineStyle={drawLineStyle}
            fontSize={drawFontSize}
            magnet={magnet}
            drawings={annotations}
            addDrawing={annAdd}
            updateDrawing={annUpdate}
            removeDrawing={annRemove}
            onMigrate={onAnnotationsMigrate}
            selectedId={annotationsEditable ? selectedId : null}
            setSelectedId={setSelectedId}
            repeatMode={repeatMode}
          />
          {annotationsEditable && (
            <ChartToolbar
              activeTool={activeTool}
              setActiveTool={setActiveTool}
              color={drawColor}
              setColor={setDrawColor}
              lineWidth={drawWidth}
              setLineWidth={setDrawWidth}
              hasSelection={!!selectedId}
              onDelete={() => { annRemove(selectedId); setSelectedId(null) }}
              onClearAll={annClear}
              drawingCount={annotations.length}
              repeatMode={repeatMode}
              setRepeatMode={handleSetRepeatMode}
              chartSettings={cs}
              onUpdateSettings={handleUpdateChartSettings}
              lineStyle={drawLineStyle}
              setLineStyle={setAnnLineStyle}
              fontSize={drawFontSize}
              setFontSize={setAnnFontSize}
              magnet={magnet}
              setMagnet={setMagnet}
              prominent
              hideReplay
              hidePatterns
              hideCompare
              hideCountdown
            />
          )}
        </div>
      )}
      {/* Stock-level annotations (Model Book): an always-on, read-only layer drawn
          on the full-year view, independent of any setup (text never fades). */}
      {staticAnnotations != null && staticAnnotations.length > 0 && bars?.length > 0 && (!indexPaneSymbol || overlayBounds) && (
        <div style={overlayWrapStyle({ zIndex: 4, pointerEvents: 'none' })}>
          <ChartDrawingOverlay
            chartRef={chartRef}
            seriesRef={candleSeriesRef}
            bars={bars}
            activeTool={null}
            setActiveTool={NOOP}
            color={drawColor}
            lineWidth={drawWidth}
            drawings={staticAnnotations}
            addDrawing={NOOP}
            updateDrawing={NOOP}
            removeDrawing={NOOP}
            selectedId={null}
            setSelectedId={NOOP}
          />
        </div>
      )}
      {/* Index-pane annotations (Model Book): GLOBAL measure marks on the ^IXIC
          line — read-only for everyone, a measure-only toolbar for admins.
          Bound to the index pane (indexPaneSeriesRef + its measured box) so the
          Y coords map to the top pane, not the price pane. */}
      {/* NOTE: gated on the (stable) measured bounds, NOT indexPaneSeries.length — the
          global Nasdaq marks stay put while flipping tickers. The index pane + line
          persist through a ticker switch (the index effect keeps them mounted on an
          empty-data frame), so requiring length>0 here only caused the overlay to
          unmount/remount on each switch = a blink. Bounds stay measured across the
          switch, so the canvas survives and just redraws as the chart reframes. */}
      {indexAnnotations != null && indexPaneSymbol && indexOverlayBounds
        && (indexAnnotationsEditable || indexAnnotations.length > 0) && (
        <div style={indexOverlayWrapStyle({ zIndex: 4, pointerEvents: indexAnnotationsEditable ? 'auto' : 'none' })}>
          <ChartDrawingOverlay
            chartRef={chartRef}
            seriesRef={indexPaneSeriesRef}
            bars={bars}
            lineData={indexPaneSeries}
            hidePriceLabels
            activeTool={indexAnnotationsEditable ? indexActiveTool : null}
            setActiveTool={setIndexActiveTool}
            color={drawColor}
            lineWidth={drawWidth}
            lineStyle={drawLineStyle}
            fontSize={drawFontSize}
            magnet={magnet}
            drawings={indexAnnotations}
            addDrawing={idxAnnAdd}
            updateDrawing={idxAnnUpdate}
            removeDrawing={idxAnnRemove}
            selectedId={indexAnnotationsEditable ? indexSelectedId : null}
            setSelectedId={setIndexSelectedId}
            repeatMode={repeatMode}
          />
          {indexAnnotationsEditable && (
            <ChartToolbar
              activeTool={indexActiveTool}
              setActiveTool={setIndexActiveTool}
              color={drawColor}
              setColor={setDrawColor}
              lineWidth={drawWidth}
              setLineWidth={setDrawWidth}
              hasSelection={!!indexSelectedId}
              onDelete={() => { idxAnnRemove(indexSelectedId); setIndexSelectedId(null) }}
              onClearAll={idxAnnClear}
              drawingCount={indexAnnotations.length}
              repeatMode={repeatMode}
              setRepeatMode={handleSetRepeatMode}
              chartSettings={cs}
              onUpdateSettings={handleUpdateChartSettings}
              magnet={magnet}
              setMagnet={setMagnet}
              toolFilter={['cursor', 'advance']}
              prominent
              hideReplay
              hidePatterns
              hideCompare
              hideCountdown
            />
          )}
        </div>
      )}
      {/* Catalyst callouts (Model Book): labels in blank space + leader lines. */}
      {/* Wait for the price-pane box to be measured before mounting the callout
          overlay on an index-pane chart, so labels are placed with the correct
          bounds from the first paint (no first-click jump). */}
      {callouts != null && callouts.length > 0 && bars?.length > 0 && (!indexPaneSymbol || overlayBounds) && (
        <div style={overlayWrapStyle({ zIndex: 4, pointerEvents: 'none' })}>
          <ChartCalloutOverlay
            chartRef={chartRef}
            seriesRef={candleSeriesRef}
            bars={bars}
            callouts={callouts}
            bottomFrac={overlayBounds ? 0.96 : 0.82}
          />
        </div>
      )}
      {/* Setup-to-setup % advance labels (Model Book): "+X%" above each setup
          candle showing the move from the previous setup. */}
      {setupMoves != null && setupMoves.length > 1 && bars?.length > 0 && (!indexPaneSymbol || overlayBounds) && (
        <div style={overlayWrapStyle({ zIndex: 4, pointerEvents: 'none' })}>
          <SetupMoveOverlay
            chartRef={chartRef}
            seriesRef={candleSeriesRef}
            bars={bars}
            setups={setupMoves}
          />
        </div>
      )}
      {/* Index pane label — top-left of the pane (replaces the floating last-value box). */}
      {indexPaneSymbol && indexPaneSeries.length > 0 && (
        <div
          style={{
            position: 'absolute', top: 4, left: 10, zIndex: 5, pointerEvents: 'none',
            font: '600 11px "Instrument Sans", system-ui, sans-serif',
            letterSpacing: '0.04em', color: cs.watermark.color, opacity: 0.85,
            textShadow: '0 0 3px rgba(0,0,0,0.85)',
          }}
        >
          {indexPaneLabel || String(indexPaneSymbol).replace(/^\^/, '')}
        </div>
      )}
      <KeyboardHelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
      <PatternSidePanel
        detection={activeDetection}
        onClose={() => setActiveDetection(null)}
      />
    </div>
  )
}
