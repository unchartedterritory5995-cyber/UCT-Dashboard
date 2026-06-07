// app/src/components/StockChart.jsx — TradingView Lightweight Charts v5 wrapper
// Optimized: chart instance reuse, O(n) HVC, memoized data transforms
import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
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
import useRealtimeBars from '../hooks/useRealtimeBars'
import * as realtimeCandle from '../lib/realtimeCandle'
import useJ2ChartMarkers from '../pages/journal-2-0/hooks/useJ2ChartMarkers'
import CountdownTimer from './chart/CountdownTimer'
import styles from './StockChart.module.css'
import brandMark from './intro/assets/compass-mark.png'
import { idbGet, idbPut, mergeDelta } from '../utils/barsIDB'
import { normalizeToPctChange } from './chart/comparisonUtils'
import { composeScreenshot, downloadBlob, copyBlobToClipboard, chartStateToUrl, urlToChartState } from './chart/chartScreenshot'
import ScreenshotPopover from './chart/ScreenshotPopover'
import { matchShortcut } from './chart/keyboardShortcuts'
import KeyboardHelpOverlay from './chart/KeyboardHelpOverlay'
import PositionPanel from './chart/PositionPanel'

const NOOP = () => {}

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
export function computeSMA(bars, period) {
  if (bars.length < period) return []
  const result = []
  for (let i = period - 1; i < bars.length; i++) {
    // Re-sum the full window at every bar to guarantee exact FP parity
    // with the naive reference — rolling subtract accumulates rounding
    // error that can flip .toFixed(2) results at cent boundaries.
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += bars[j].c
    result.push({ time: bars[i].t, value: +(sum / period).toFixed(2) })
  }
  return result
}

function computeEMA(bars, period) {
  if (bars.length < period) return []
  const k = 2 / (period + 1)
  let sum = 0
  for (let i = 0; i < period; i++) sum += bars[i].c
  let ema = sum / period
  const result = [{ time: bars[period - 1].t, value: +ema.toFixed(2) }]
  for (let i = period; i < bars.length; i++) {
    ema = bars[i].c * k + ema * (1 - k)
    result.push({ time: bars[i].t, value: +ema.toFixed(2) })
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

// ─── Bar period computation (for real-time new candle creation) ──────────────

const PERIOD_SECONDS = { '1': 60, '5': 300, '15': 900, '30': 1800, '60': 3600 }

function computeBarTime(tf, tickTimeSec) {
  if (tf === 'D') {
    // Daily: ET date string "YYYY-MM-DD" (matches LW Charts BusinessDay format)
    return new Date(tickTimeSec * 1000)
      .toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  }
  if (tf === 'W') {
    // Weekly: Monday of current week in ET
    const d = new Date(tickTimeSec * 1000)
    const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const day = et.getDay()
    et.setDate(et.getDate() - day + (day === 0 ? -6 : 1))
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

// Bold candle/volume palette (Model Book "TC2000" look — boldCandles instances).
const BOLD_UP = '#21c45c'
const BOLD_DOWN = '#f23645'

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
function _animateFocusZoom(chart, series, rafRef, priceRangeRef, bars, target, duration = 1150, onDone = null, overlays = null, textFadeRef = null, targetTextVisible = null) {
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
  const sRange = _windowPriceRange(bars, start.from, start.to, overlays)
  const tRange = _windowPriceRange(bars, target.from, target.to, overlays)
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
  exactDateRange = false,   // zoom to exactly [entryDate, exitDate] with no padding
  forceLogScale = false,    // default the price scale to logarithmic
  boldCandles = false,      // bold solid green/red candles (Model Book look)
  hideLastValue = false,    // hide the last-price axis tag on the price series
  volumeSeparatePane = false, // force volume into its own draggable bottom pane
  priceScaleBottomMargin = null, // small gap below price (above a separate vol pane)
  markVolumeExtremes = false, // gold the highest-volume-ever bar (Model Book)
  volumePaneHeightPct = null, // override the separate volume pane height (%)
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
  staticAnnotations = null,     // Model Book: stock-level drawings shown always on the full-year view (read-only, independent of any setup)
  onAnnotationsChange = null,   // (drawings[]) => void — called when admin adds/edits/removes an annotation
  highlightBarTime = null,      // ISO/time (or array of them) of bar(s) to paint (Model Book: focused setup's day, or all setup/catalyst days)
  highlightColor = '#e6b800',   // color for highlighted bars (gold for setups; Model Book passes white for catalysts)
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
  darkPoolMaxBarWidth = 250,      // max bar width in pixels
  // ── Override candle series priceFormat (e.g. integer-only axis labels) ──
  // Pass { type: 'price', precision: 0, minMove: 1 } to show "200" instead of "200.00"
  priceFormat = null,
}) {
  const { prefs, setPref } = usePreferences()
  const resolvedTf = tf || prefs.default_chart_tf || 'D'

  // ── Chart settings from user preferences ──
  const cs = useMemo(() => mergeChartSettings(prefs.chart_settings), [prefs.chart_settings])

  // ── Theme colors (light / dark) layered over user chart settings ──
  // Returns layout/grid/crosshair/candle colors based on cs.theme. Used in
  // chartOpts below and re-applied via useEffect when theme changes.
  const themeColors = useMemo(() => {
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
      background: cs.background,
      textColor: cs.textColor,
      gridColor: cs.grid?.color,
      borderColor: cs.grid?.color,
      crosshairColor: cs.crosshair?.color,
      candleUp: cs.candles?.upColor,
      candleDown: cs.candles?.downColor,
    }
  }, [cs.theme, cs.background, cs.textColor, cs.grid?.color, cs.crosshair?.color, cs.candles?.upColor, cs.candles?.downColor])

  // ── Price-scale: forceLogScale (Model Book) defaults to log without touching
  // the user's global chart-settings pref. A per-instance override lets the
  // A/L/% toggle still switch locally. 'arith' | 'log' | 'pct' | null. ──
  const [scaleOverride, setScaleOverride] = useState(null)
  const effectiveScale = scaleOverride
    || (forceLogScale ? 'log' : (cs.percentScale ? 'pct' : (cs.logScale ? 'log' : 'arith')))
  const setScale = (kind) => {
    if (forceLogScale) {
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
        // 0.40 max for smaller bars. The label below gets a separate opacity
        // bump so the $ amount stays readable even when the bar fades.
        opacity: isGoldTier ? 0.20 + ratio * 0.30 : 0.14 + ratio * 0.26,
        isGoldTier,
      }
    })
  }, [darkPoolBars, darkPoolMaxBarWidth])

  // Position bars vertically by calling series.priceToCoordinate() on each
  // animation frame. This is what the SVG overlay approach couldn't do — only
  // the chart instance knows the exact pixel Y for a given price, especially
  // after pan/zoom. By running in rAF, bars stay glued to candles regardless
  // of how the user interacts with the chart.
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
  const j2 = useJ2ChartMarkers(sym, resolvedTf)
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
    getActiveTool: () => activeToolRef.current,
    onCommit: ({ x, y }) => {
      const next = mergeChartSettings(prefs.chart_settings)
      next.watermark = { ...next.watermark, x, y }
      next.preset = 'custom'
      setPref('chart_settings', JSON.stringify(next))
    },
  })
  const chartRef = useRef(null)
  const candleSeriesRef = useRef(null)
  const volumeSeriesRef = useRef(null)
  const indexPaneSeriesRef = useRef(null) // LineSeries for the index-comparison pane (Model Book ^IXIC)
  const indexMaSeriesRef = useRef(null)   // 50-period SMA line drawn on the index pane (matches the price chart's 50 SMA color)
  const indexScaleRef = useRef({ range: null, pin: false })  // fixed price range for the index pane's autoscaleInfoProvider (pins it steady across ticker switches; pin=false in Percent mode)
  const lastIndexSigRef = useRef(null)  // signature of the last-drawn index line/MA so we SKIP setData+relayout when flipping tickers in the same year (the index line is identical → no millisecond glitch)
  const volumeSeparatePaneRef = useRef(false)  // tracks current volume render mode so a toggle recreates the series in the right pane
  const indScaleRef = useRef({})               // per-indicator last price-scale id, so an overlay toggle recreates it in the right pane
  const overlaySeriesRefs = useRef([])
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
  const lastBarRef = useRef(null)
  const prevChartTypeRef = useRef(null)
  const zoomKeyRef = useRef(null)  // Track sym+tf to only zoom on initial load, not refetches
  const lastTfRef = useRef(null)   // Last resolved timeframe — distinguishes tf change from ticker switch
  const lastBarCountRef = useRef(0) // Last bar count — lets a ticker switch right-anchor the preserved view
  const prevBarsRef = useRef(null) // Previous render's bars — used to measure outgoing vertical placement
  const focusRafRef = useRef(null)        // in-flight focus-zoom animation frame id
  const focusActiveRef = useRef(false)    // true while a setup-focus zoom owns the view (suppresses the year-range pin)
  const focusKeyRef = useRef(null)        // sym+tf the focus belongs to — a change releases focus back to the pin
  const lastFocusNonceRef = useRef(0)     // last processed focusNonce — only act when it actually changes
  const yearFramedRef = useRef(null)      // sym+tf the exact-range year frame has been rAF-reapplied for (first-load layout race)
  const yearRangeRef = useRef(null)       // latest {from,to} logical range for the framed year — re-asserts read this so staged data loads can't lock in stale indices
  const focusPriceRangeRef = useRef(null) // {lo,hi} interpolated price range during a focus zoom (smooth vertical via autoscaleInfoProvider); null = default autoscale
  const focusProviderInstalledRef = useRef(false) // whether the candle series has the focus autoscale provider attached
  const textFadeRef = useRef(0)           // 0..1 opacity for setup TEXT annotations — driven by the focus zoom (Model Book): hidden zoomed out, eases in as it lands on a setup
  const hadHighlightRef = useRef(false)   // whether a gold highlight bar is currently applied (so we only clear when needed)
  const vertMarginsRef = useRef(null) // Captured proportional candle placement {top,bottom}; null = default headroom
  const latestLiveRef = useRef(null)  // Latest live price — used to re-apply after setData() wipes
  const liveBarRef = useRef(null)     // Developing bar OHLCV tracked tick-by-tick (survives setData)
  const lastServerCloseRef = useRef(null)  // Last close from CLEAN server bars — poison-proof live-tick baseline
  const barStartVolRef = useRef(0)    // Cumulative volume at start of current bar (for per-bar delta)

  // ── Extended hours toggle (regular session only vs all hours) ──
  const [showExtended, setShowExtended] = useState(() => {
    try { return localStorage.getItem('uct-chart-extended') !== 'false' } catch { return true }
  })
  const handleToggleExtended = useCallback((val) => {
    setShowExtended(val)
    try { localStorage.setItem('uct-chart-extended', val ? 'true' : 'false') } catch {}
  }, [])

  // ── Drawing tools state ──
  // ── Crosshair legend state ──
  const [crosshairData, setCrosshairData] = useState(null)
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
    try { return localStorage.getItem('uct-draw-repeat') !== 'false' } catch { return true }
  })
  const handleSetRepeatMode = useCallback((val) => {
    setRepeatMode(val)
    try { localStorage.setItem('uct-draw-repeat', val ? 'true' : 'false') } catch {}
  }, [])
  const handleUpdateChartSettings = useCallback((newSettings) => {
    setPref('chart_settings', JSON.stringify(newSettings))
  }, [setPref])

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
    const resetView = () => { try { chartRef.current?.timeScale().resetTimeScale() } catch {} }
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
      label: `➖ Draw line at $${fmtPrice(clickPrice)}`,
      onSelect: () => { try { addDrawingRef.current?.({ type: 'horizontal', points: [{ price: clickPrice }], color: cs.drawingDefaults?.color || '#c9a84c', lineWidth: cs.drawingDefaults?.width || 1 }) } catch {} },
    } : null
    const copyPriceItem = hasPrice ? {
      id: 'copy-price',
      label: `📋 Copy $${fmtPrice(clickPrice)}`,
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
      id: 'indicators', label: '📊 Indicators', kind: 'submenu',
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
      id: 'voloverlay', label: '🔗 Overlay on volume', kind: 'submenu',
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
        items.push({ id: 'pr-eh', label: 'Extended-hours shading', kind: 'toggle', checked: !!cs.extendedHoursShading, onSelect: () => setCs('extendedHoursShading', !cs.extendedHoursShading) })
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
  const { drawings, addDrawing, removeDrawing, updateDrawing, clearAll } = useChartDrawings(sym)
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

  // 8000 daily bars ≈ 32 years — covers dot-com era for tickers that go
  // back that far (CIEN since 1997, etc.). Other timeframes don't need
  // more than 5000 (5000 weeks ≈ 96 years; 5000 months ≈ 416 years).
  const barCount = (resolvedTf === 'D' || resolvedTf === 'W') ? 8000 : 5000

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
      if (sameLength && sameTail) return  // nothing changed — don't repaint
      setIdbBars(merged)
      if (merged.length) idbSinceRef.current = merged[merged.length - 1].t
      idbPut(sym, resolvedTf, merged)
    } else if (!data.delta && data.bars.length) {
      setIdbBars(data.bars)
      idbSinceRef.current = data.bars[data.bars.length - 1]?.t ?? null
      idbPut(sym, resolvedTf, data.bars)
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
    const BC    = { D: 8000, W: 8000 }
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
          const bc    = BC[tf] ?? 5000
          const since = entryStaleIntraday ? null : entry?.lastT
          const url   = `/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${bc}${since != null ? `&since=${encodeURIComponent(String(since))}` : ''}`
          const r = await fetch(url)
          if (cancelled || !r.ok) continue
          const d = await r.json()
          if (cancelled || !d.bars?.length) continue
          const next = (d.delta && entry?.bars?.length) ? mergeDelta(entry.bars, d.bars) : d.bars
          idbPut(sym, tf, next)
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
  const bars = _overrideArr
    ? barsOverride
    : (barsOverridePending
        ? null  // override expected but not here yet → render nothing (spinner), don't fall back to provider data
        : ((_netMatches && !data.delta)
            ? data.bars
            : (_idbFresh ? idbBars : (_netMatches ? data.bars : null))))
  const loading = !bars && !error
  // Only surface the "Failed to load chart" overlay when we have NOTHING
  // to render. If IDB has cached bars (or the SWR data was already painted
  // before the error), keep showing them and let the 30s SWR refresh
  // recover silently. Otherwise a transient backend 5xx pins the chart at
  // a hard-fail state for the user even though usable history is sitting
  // in IndexedDB. The retry button below still mutate()'s on click.
  const showFatalError = !!error && !bars?.length

  // Real-time price streaming for live candle updates
  const { prices: livePrices, staleSymbols } = useRealtimePrices(liveUpdates && sym ? [sym] : [])
  const isStale = !!(sym && staleSymbols && staleSymbols.has(String(sym).toUpperCase()))

  // Keep lastPriceRef / lastChangePctRef in sync for screenshot composition.
  // Prefers live stream values; falls back to last bar close / intra-bar change.
  useEffect(() => {
    const live = sym ? livePrices[sym] : null
    if (live && Number.isFinite(live.price)) {
      lastPriceRef.current = live.price
    } else if (lastBarRef.current && Number.isFinite(lastBarRef.current.close)) {
      lastPriceRef.current = lastBarRef.current.close
    }
    if (live && Number.isFinite(live.change_pct)) {
      lastChangePctRef.current = live.change_pct
    } else if (lastBarRef.current && Number.isFinite(lastBarRef.current.open) && Number.isFinite(lastBarRef.current.close) && lastBarRef.current.open) {
      lastChangePctRef.current = ((lastBarRef.current.close - lastBarRef.current.open) / lastBarRef.current.open) * 100
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

  // Restore filteredBars as the replay-sliced version.
  // All downstream code continues to use `filteredBars` unchanged.
  const filteredBars = useMemo(
    () => (replayMode && replayIndex != null)
      ? sessionBars?.slice(0, replayIndex + 1)
      : sessionBars,
    [sessionBars, replayMode, replayIndex]
  )

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

  const displayBars = useMemo(() => {
    if (!filteredBars?.length) return filteredBars
    return cs.heikinAshi ? toHeikinAshi(filteredBars) : filteredBars
  }, [filteredBars, cs.heikinAshi])

  const ohlcData = useMemo(
    () => displayBars ? displayBars.map(b => ({ time: adjustTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })) : [],
    [displayBars, adjustTime]
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
  const highlightTimeSet = useMemo(() => {
    if (highlightBarTime == null) return null
    const arr = Array.isArray(highlightBarTime) ? highlightBarTime : [highlightBarTime]
    const s = new Set()
    for (const t of arr) { if (t != null) s.add(adjustTime(t)) }
    return s.size ? s : null
  }, [highlightBarTime, adjustTime])
  const goldOhlc = useMemo(() => {
    if (!highlightTimeSet) return ohlcData
    return ohlcData.map(d => (highlightTimeSet.has(d.time)
      ? { ...d, color: highlightColor, borderColor: highlightColor, wickColor: highlightColor }
      : d))
  }, [ohlcData, highlightTimeSet, highlightColor])
  const closeData = useMemo(
    () => displayBars ? displayBars.map(b => ({ time: adjustTime(b.t), value: b.c })) : [],
    [displayBars, adjustTime]
  )
  const hvcSet = useMemo(
    () => cs.volume.hvcEnabled && filteredBars?.length > 20 ? computeHVC(filteredBars) : new Set(),
    [filteredBars, cs.volume.hvcEnabled]
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
    if (!filteredBars?.length) return []
    // Dim the bold volume to the same hue at lower opacity — dense solid bars
    // otherwise read brighter than the thin candles and look out of place.
    const upC = boldCandles ? 'rgba(33,196,92,0.82)' : cs.volume.upColor
    const downC = boldCandles ? 'rgba(242,54,69,0.82)' : cs.volume.downColor
    const gold = '#e6b800'
    return filteredBars.map(b => ({
      time: adjustTime(b.t),
      value: b.v,
      color: volExtremes?.goldTimes.has(b.t)        // HVE / HV1 bars → gold
        ? gold
        : (!boldCandles && hvcSet.has(b.t))         // legacy HVC highlight
          ? 'rgba(201,168,76,0.9)'
          : b.c >= b.o ? upC : downC,
    }))
  }, [filteredBars, hvcSet, cs.volume.upColor, cs.volume.downColor, adjustTime, boldCandles, volExtremes])
  // Smooth N-SMA line for the volume pane (subtle, white).
  const volMaData = useMemo(() => {
    if (!volumeMa || volumeMa < 2 || !filteredBars?.length) return []
    const out = []
    const q = []
    let sum = 0
    for (const b of filteredBars) {
      const v = b.v || 0
      q.push(v); sum += v
      if (q.length > volumeMa) sum -= q.shift()
      if (q.length === volumeMa) out.push({ time: adjustTime(b.t), value: sum / volumeMa })
    }
    return out
  }, [filteredBars, volumeMa, adjustTime])
  const overlayData = useMemo(() => {
    if (!filteredBars?.length || !resolvedOverlays?.length) return []
    return resolvedOverlays.map(ov => {
      const raw = ov.type === 'EMA' ? computeEMA(filteredBars, ov.period) : computeSMA(filteredBars, ov.period)
      return { data: raw.map(p => ({ time: adjustTime(p.time), value: p.value })), color: ov.color }
    })
  }, [filteredBars, resolvedOverlays, adjustTime])

  const indicatorData = useMemo(() => {
    const ind = cs.indicators || {}
    const rsiRaw = ind.rsi?.enabled
      ? computeRSI(filteredBars, ind.rsi.period).map(p => ({ time: adjustTime(p.time), value: p.value }))
      : []
    const bbRaw = ind.bb?.enabled
      ? computeBB(filteredBars, ind.bb.period, ind.bb.stdDev)
      : { upper: [], middle: [], lower: [] }
    const vwapRaw = (ind.vwap?.enabled && VWAP_TFS.has(resolvedTf))
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
  }, [filteredBars, cs.indicators, resolvedTf, adjustTime])

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
    // Defensive: drop ticks with bad price BEFORE they touch liveBarRef.
    // Mirror of onRealtimeBar's guard. A single NaN / 0 / extreme price baked
    // into liveBarRef.current.high or .low persists across setData() refreshes
    // because the post-setData re-apply (~line 1170) trusts liveBarRef as the
    // authoritative developing-bar state. Without this guard the chart can
    // get stuck with a low of 0 (or extreme) until full page reload, dragging
    // EMA/SMA series into a V-shape collapse on intraday charts.
    const _p = liveData.price
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
    latestLiveRef.current = { sym, price: _p, updated_at: liveData.updated_at,
      day_open: _do, day_high: _dh, day_low: _dl }
    if (!candleSeriesRef.current || !lastBarRef.current) return
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
    const barTime = tickSec ? computeBarTime(resolvedTf, tickSec) : last.time

    // Detect new bar period (new candle should form).
    // For D/W/M: only create a new bar when the REST session OHLC is available
    // (day_open > 0), confirming the new session is actually underway.
    // Without this guard, pre-market ticks with a new date would spawn a phantom
    // candle before the session opens. When NOT creating a new bar for D/W/M on a
    // new day, we skip updating the last bar entirely to avoid corrupting yesterday's
    // candle with today's pre-market price.
    const isIntradayTf = !['D', 'W', 'M'].includes(resolvedTf)
    const isNewPeriod = barTime !== last.time && barTime > last.time
    const live = latestLiveRef.current || {}
    const sessionConfirmed = isIntradayTf || (live.day_open > 0)
    const isNewBar = isNewPeriod && sessionConfirmed

    try {
      if (isNewBar) {
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
          volumeSeriesRef.current.update({ time: barTime, value: 0, color: 'rgba(74,222,128,0.35)' })
        }
      } else {
        // ── SAME CANDLE (or new D/W/M day without session data yet) ──
        // If it's a new day for D/W/M but we don't have session OHLC, skip the
        // update entirely — don't corrupt yesterday's bar with today's pre-market price.
        if (!isIntradayTf && isNewPeriod) return

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
  }, [livePrices, sym, resolvedTf, cs.chartType])

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
    // AM `t` is bucket-start in ms. Convert to seconds AND add _ET_OFFSET so
    // the time matches the rest of the chart series — REST bars stored via
    // setData(ohlcData) where ohlcData uses adjustTime(b.t) = b.t + _ET_OFFSET.
    // Without this offset, Phase 4 update() lands at a time that conflicts
    // with the series and is silently dropped by lightweight-charts.
    const tSec = Math.floor(data.bar.t / 1000) + _ET_OFFSET
    const useOhlc = isOhlcType(cs.chartType)

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
        volumeSeriesRef.current.update({
          time: tSec,
          value: data.bar.v,
          color: data.bar.c >= data.bar.o ? 'rgba(74,222,128,0.5)' : 'rgba(239,83,80,0.5)',
        })
      }
      // Sync the tick-logic refs so the next tick starts from authoritative state.
      // Only sync if the AM bar matches the current developing/last bar's time —
      // otherwise this is an older bar's update and shouldn't disturb live state.
      if (liveBarRef.current && liveBarRef.current.time === tSec) {
        liveBarRef.current = {
          time: tSec, open: data.bar.o, high: data.bar.h, low: data.bar.l, close: data.bar.c,
        }
      }
      if (lastBarRef.current && lastBarRef.current.time === tSec) {
        lastBarRef.current = {
          time: tSec, open: data.bar.o, high: data.bar.h, low: data.bar.l, close: data.bar.c,
          volume: data.bar.v,
        }
      }
    } catch {
      // lightweight-charts throws if `time` regresses below the series' last bar.
      // Silently ignore — out-of-order frames are rare and self-correct on next bar.
    }
  }, [cs.chartType])

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

  useRealtimeBars({
    symbol: realtimeTfEligible && liveUpdates ? sym : null,
    tf: realtimeTfEligible && liveUpdates ? resolvedTf : null,
    onBar: onRealtimeBar,
    onReconnect: onRealtimeReconnect,
  })

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
      return
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
    if (exactDateRange) {
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
        background: { type: ColorType.Solid, color: themeColors.background },
        textColor: themeColors.textColor,
        fontFamily: "'Instrument Sans', sans-serif",
        fontSize: 10,
        attributionLogo: false,  // hide built-in TradingView logo; we overlay the UCT mark instead
        // Model Book: subtle (not bold gray) pane divider; still draggable.
        ...(boldCandles ? { panes: { separatorColor: 'rgba(255,255,255,0.18)', separatorHoverColor: 'rgba(255,255,255,0.32)', enableResize: true } } : {}),
      },
      grid: {
        vertLines: { color: cs.grid.visible ? themeColors.gridColor : 'transparent' },
        horzLines: { color: cs.grid.visible ? themeColors.gridColor : 'transparent' },
      },
      crosshair: {
        mode: cs.crosshair.magnet ? 1 : 0,  // 1 = Magnet (snaps to OHLC), 0 = Normal
        vertLine: { color: themeColors.crosshairColor, width: 1, style: cs.crosshair.style, labelBackgroundColor: themeColors.background },
        horzLine: { color: themeColors.crosshairColor, width: 1, style: cs.crosshair.style, labelBackgroundColor: themeColors.background },
      },
      rightPriceScale: {
        borderColor: themeColors.borderColor,
        // Locked proportional placement (carried across ticker switches) wins over the
        // default headroom. vertMarginsRef is captured in fractions of the pane, so the
        // candles land in the same relative spot regardless of the stock's price.
        scaleMargins: vertMarginsRef.current || _mainMargins(cs, showVolume && volData.length > 0 && !volInSeparatePane, priceScaleTopMargin, volInSeparatePane ? priceScaleBottomMargin : null),
      },
      timeScale: {
        borderColor: themeColors.borderColor,
        timeVisible: true,
        secondsVisible: false,
        // Exact-range (Model Book) locks to a historical window, so don't pin the
        // latest bar to the right edge — that re-expands the view to "now".
        rightOffset: exactDateRange ? 0 : 3,
        rightBarStaysOnScroll: exactDateRange ? false : true,
      },
    }

    if (!chart) {
      chart = createChart(containerRef.current, { ...chartOpts, autoSize: true })
      chartRef.current = chart
      setChartReady(true)
    } else {
      chart.applyOptions(chartOpts)
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
      const wmLines = cs.watermark.visible
        ? composeWatermarkLines(watermark ?? sym, watermarkMeta, cs.watermark.lines)
        : []
      wmCtrlRef.current.setOptions({
        lines: wmLines,
        color: cs.watermark.color,
        opacity: watermarkOpacity ?? cs.watermark.opacity,
        sizeScale: cs.watermark.sizeScale,
        x: watermarkX ?? cs.watermark.x,
        y: watermarkY ?? cs.watermark.y,
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
        bands: shadeOn ? computeSessionBands(filteredBars) : [],
      })
    }

    // Price-scale mode (Normal/Log/Percent) is applied by a dedicated effect
    // keyed on `effectiveScale`, so the A/L/% toggle and the forceLogScale
    // default both take effect immediately (and survive data updates).

    // ── Price series — reuse if chart type unchanged, else swap ──
    // When swapping the candle series, the markers controller is bound to the
    // old series — detach it so the next markers update creates a fresh
    // controller against the new series.
    if (prevChartTypeRef.current !== cs.chartType && candleSeriesRef.current) {
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
        const _bold = boldCandles ? {
          upColor: BOLD_UP, downColor: BOLD_DOWN,
          borderVisible: false,                       // pure solid bodies (TC2000 look)
          wickUpColor: BOLD_UP, wickDownColor: BOLD_DOWN,
        } : {}
        // Optional integer-only price axis (DarkPool page passes precision:0
        // for large-cap stocks so the axis shows "200" not "200.00").
        const _priceFormat = priceFormat ? { priceFormat } : {}
        priceSeries.applyOptions({ priceLineVisible: !exactDateRange, lastValueVisible: !hideLastValue, ..._bold, ..._priceFormat })
      } catch { /* older LWC */ }
      prevChartTypeRef.current = cs.chartType
    }

    // Set price data
    candleSeriesRef.current.setData(isOhlcType(cs.chartType) ? ohlcData : closeData)

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

    // Re-apply live price immediately after setData() to prevent snap-back.
    // setData() overwrites with API data (stale by seconds/minutes), so we
    // re-apply the latest WebSocket tick to keep the current candle accurate.
    if (latestLiveRef.current?.sym === sym && latestLiveRef.current?.price && lastBarRef.current) {
      const lp = latestLiveRef.current.price
      const tickSec = latestLiveRef.current.updated_at
      const barTime = tickSec ? computeBarTime(resolvedTf, tickSec) : lastBarRef.current.time
      const last = lastBarRef.current
      const isIntradayTf = !['D', 'W', 'M'].includes(resolvedTf)
      const isNewPeriod = barTime !== last.time && barTime > last.time
      const liveSnap = latestLiveRef.current
      const sessionConfirmed = isIntradayTf || (liveSnap.day_open > 0)
      const isNew = isNewPeriod && sessionConfirmed

      // Use liveBarRef if available — it has tick-accurate high/low that survives setData()
      const lb = liveBarRef.current

      if (isNew) {
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
      } else if (!isIntradayTf && isNewPeriod) {
        // New day for D/W/M but no session data — don't corrupt yesterday's bar
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
          priceLineVisible: !boldCandles,
          lastValueVisible: !boldCandles,
        }, volSeparatePane ? 1 : 0)
        volumeSeriesRef.current = vs
        volumeSeparatePaneRef.current = volScaleId
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
          if (mainPane && volPane) {
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
      volumeSeriesRef.current.setData(volData)

      // Subtle smooth volume MA line on the same pane/scale as the bars.
      if (volumeMa && volMaData.length) {
        if (!volMaSeriesRef.current) {
          volMaSeriesRef.current = chart.addSeries(LineSeries, {
            color: 'rgba(255,255,255,0.45)',
            lineWidth: 1,
            lineType: LineType.Curved,
            priceScaleId: volScaleId,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            autoscaleInfoProvider: () => null,
          }, volSeparatePane ? VOL_PANE_INDEX : 0)
        }
        volMaSeriesRef.current.setData(volMaData)
      } else if (volMaSeriesRef.current) {
        try { chart.removeSeries(volMaSeriesRef.current) } catch {}
        volMaSeriesRef.current = null
      }
    } else if (volumeSeriesRef.current) {
      try { chart.removeSeries(volumeSeriesRef.current) } catch {}
      volumeSeriesRef.current = null
      if (volMaSeriesRef.current) { try { chart.removeSeries(volMaSeriesRef.current) } catch {}; volMaSeriesRef.current = null }
    }

    // ── Overlay lines — reuse series where possible ──
    // Remove excess overlay series
    while (overlaySeriesRefs.current.length > overlayData.length) {
      const old = overlaySeriesRefs.current.pop()
      try { chart.removeSeries(old) } catch {}
    }
    // Update existing or add new overlay series. CRITICAL: when an existing
    // overlay's new data is empty (e.g. switched to a recent IPO with too few
    // bars to compute SMA200), we must explicitly clear it. The previous
    // `if (!ovData.length) continue` left the OLD ticker's overlay line visible.
    for (let i = 0; i < overlayData.length; i++) {
      const { data: ovData, color } = overlayData[i]
      // Model Book renders MAs as smooth curves (TradingView look) instead of
      // the default straight-segment polyline.
      const _ovLineType = boldCandles ? LineType.Curved : LineType.Simple
      // 0.5 floors to a true 1px hairline on retina (lineWidth*dpr), thinner than
      // the standard 1; non-retina stays ~1px. Only Model Book (boldCandles) uses it.
      const _ovLineWidth = boldCandles ? 0.5 : 1
      if (i < overlaySeriesRefs.current.length) {
        // Reuse existing series — always setData (even empty) to clear stale data
        overlaySeriesRefs.current[i].applyOptions({ color, lineType: _ovLineType, lineWidth: _ovLineWidth })
        overlaySeriesRefs.current[i].setData(ovData)
      } else if (ovData.length) {
        // Add new series only if there's data to show
        const ls = chart.addSeries(LineSeries, {
          color,
          lineWidth: _ovLineWidth,
          lineType: _ovLineType,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false,
          autoscaleInfoProvider: () => null,
        })
        ls.setData(ovData)
        overlaySeriesRefs.current.push(ls)
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
        ref.current.setData(data)
      } else if (ref.current) {
        try { chart.removeSeries(ref.current) } catch {}
        ref.current = null
      }
    }

    // ── Session VWAP (intraday only) ──
    if (indicatorData.vwap.length) {
      const vwapColor = cs.indicators?.vwap?.color || '#26C6DA'
      if (!vwapSeriesRef.current) {
        vwapSeriesRef.current = chart.addSeries(LineSeries, {
          color: vwapColor, lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false,
          crosshairMarkerVisible: false, autoscaleInfoProvider: () => null,
        })
      } else {
        vwapSeriesRef.current.applyOptions({ color: vwapColor })
      }
      vwapSeriesRef.current.setData(indicatorData.vwap)
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
      rsiSeriesRef.current.setData(indicatorData.rsi)
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
      stochKRef.current.setData(stochD.k)
      stochDRef.current.setData(stochD.d)
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
      macdLineRef.current.setData(macdD.macd)
      macdSignalRef.current.setData(macdD.signal)
      macdHistRef.current.setData(macdD.histogram)
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
      atrSeriesRef.current.setData(indicatorData.atr)
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
      sarSeriesRef.current.setData(indicatorData.sar.map(p => ({ time: p.time, value: p.value })))
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
      ichimokuTenkanRef.current.setData(ichiD.tenkan)
      ichimokuKijunRef.current.setData(ichiD.kijun)
      ichimokuSpanARef.current.setData(ichiD.spanA)
      ichimokuSpanBRef.current.setData(ichiD.spanB)
      ichimokuChikouRef.current.setData(ichiD.chikou)
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
      mfiSeriesRef.current.setData(indicatorData.mfi)
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
      cciSeriesRef.current.setData(indicatorData.cci)
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
      williamsRSeriesRef.current.setData(indicatorData.williamsR)
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
      adxSeriesRef.current.setData(adxD.adx)
      adxPlusDIRef.current.setData(adxD.plusDI)
      adxMinusDIRef.current.setData(adxD.minusDI)
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
      obvSeriesRef.current.setData(indicatorData.obv)
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
        ref.current.setData(data)
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
      compareSeriesRef.current.setData(comparisonData)
    } else if (compareSeriesRef.current) {
      try { chart.removeSeries(compareSeriesRef.current) } catch {}
      compareSeriesRef.current = null
    }

    // ── Price lines — remove old, add new (only when array reference changes) ──
    if (lastPriceLinesRef.current !== mergedPriceLines) {
      lastPriceLinesRef.current = mergedPriceLines
      for (const pl of priceLineRefs.current) {
        try { candleSeriesRef.current.removePriceLine(pl) } catch {}
      }
      priceLineRefs.current = []
      if (mergedPriceLines?.length && candleSeriesRef.current) {
        for (const pl of mergedPriceLines) {
          const ref = candleSeriesRef.current.createPriceLine({
            price: pl.price,
            color: pl.color || cs.textColor,
            lineWidth: pl.lineWidth || 1,
            lineStyle: pl.lineStyle ?? 2,
            axisLabelVisible: pl.axisLabelVisible ?? true,
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
    if (zoomKeyRef.current !== zoomKey) {
      const isFirstLoad = zoomKeyRef.current === null
      const tfChanged = lastTfRef.current !== null && lastTfRef.current !== resolvedTf
      // Capture the outgoing view BEFORE deciding. setData() preserves the logical range
      // numerically, so this still reflects where the user was on the previous ticker.
      let oldRange = null
      try { oldRange = chart.timeScale().getVisibleLogicalRange() } catch {}
      const oldBarCount = lastBarCountRef.current

      zoomKeyRef.current = zoomKey
      lastTfRef.current = resolvedTf

      // Vertical: always auto-fit the new ticker into the current candle band. chartOpts
      // already applied that band's scaleMargins (= the captured proportional placement,
      // or the default headroom), so autoScale fills it with THIS stock's own range.
      try { mainPriceScale()?.applyOptions({ autoScale: true }) } catch {}

      let didPreserve = false
      if (!isFirstLoad && !tfChanged && !entryDate && oldRange && oldBarCount > 0) {
        const newBarCount = filteredBars.length
        const barsFromRight = oldBarCount - oldRange.to
        const width = oldRange.to - oldRange.from
        const to = newBarCount - barsFromRight
        const from = to - width
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
          chart.timeScale().setVisibleLogicalRange({ from: startIdx, to: endIdx })
        } else if (entryDate && filteredBars.length > 0) {
          const entryIdx = filteredBars.findIndex(b => b.t >= entryDate)
          const exitIdx  = exitDate
            ? filteredBars.findIndex(b => b.t >= exitDate)
            : -1
          const fromBar = Math.max(0, (entryIdx >= 0 ? entryIdx : 0) - 20)
          const toBar   = (exitIdx >= 0 ? exitIdx : filteredBars.length - 1) + 28
          chart.timeScale().setVisibleLogicalRange({ from: fromBar, to: toBar })
        } else {
          const defaultVisible = {
            '1': 390,   // ~1 trading day of 1min bars
            '5': 78,    // ~1 trading day of 5min bars
            '15': 78,   // ~3 trading days of 15min bars
            '30': 65,   // ~5 trading days of 30min bars
            '60': 65,   // ~10 trading days of 1hr bars
            'D': 65,    // ~3 months of daily bars
            'W': 52,    // ~1 year of weekly bars
            'M': 36,    // ~3 years of monthly bars
          }
          const visibleBars = defaultVisible[resolvedTf] || 65
          if (filteredBars.length > visibleBars) {
            chart.timeScale().setVisibleLogicalRange({
              from: filteredBars.length - visibleBars,
              to: filteredBars.length + 3,
            })
          } else {
            chart.timeScale().setVisibleLogicalRange({
              from: 0,
              to: filteredBars.length + 3,
            })
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
    if (exactDateRange && entryDate && filteredBars.length > 0 && !focusActiveRef.current) {
      let _s = filteredBars.findIndex(b => b.t >= entryDate)
      let _e = filteredBars.length - 1
      if (exitDate) {
        for (let i = filteredBars.length - 1; i >= 0; i--) {
          if (filteredBars[i].t <= exitDate) { _e = i; break }
        }
      }
      const _has = _s >= 0 && _e >= _s && (!exitDate || filteredBars[_s].t <= exitDate)
      if (!_has) { _e = filteredBars.length - 1; _s = Math.max(0, _e - 251) }  // year fell in a delisting gap → recent ~year
      try { chart.timeScale().setVisibleLogicalRange({ from: _s, to: _e }) } catch { /* out of range mid-load */ }
    }

    // Track current bar count + bars so the next ticker switch can right-anchor the
    // preserved view and measure the outgoing vertical placement.
    lastBarCountRef.current = filteredBars.length
    prevBarsRef.current = filteredBars
  }, [filteredBars, ohlcData, closeData, volData, overlayData, indicatorData, comparisonData, sym, showVolume, mergedMarkers, mergedPriceLines, watermark, watermarkOpacity, cs, adjustTime, resolvedTf, tickerMeta, watermarkMeta])

  // Effect: update chart when data or settings change (NO cleanup — chart persists)
  useEffect(() => {
    updateChart()
  }, [updateChart])

  // Gold setup-day candle (Model Book). Runs AFTER updateChart so it overrides
  // the plain candle data. A candle-only setData (range preserved) → just a
  // recolor, no flash. Scoped: does nothing unless a highlight is/was set, so
  // every other chart is untouched.
  useEffect(() => {
    const series = candleSeriesRef.current
    if (!series || !isOhlcType(cs.chartType)) return
    if (highlightTimeSet) {
      hadHighlightRef.current = true
      try { series.setData(goldOhlc) } catch { /* range can be out of bounds mid-load */ }
    } else if (hadHighlightRef.current) {
      hadHighlightRef.current = false
      try { series.setData(ohlcData) } catch { /* clear gold back to normal */ }
    }
  }, [goldOhlc, ohlcData, highlightTimeSet, chartReady, cs.chartType])


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
      focusActiveRef.current = false
      focusPriceRangeRef.current = null  // drop any in-flight focus vertical so the new chart autoscales cleanly
      focusKeyRef.current = fk
    }
    if (focusActiveRef.current) return
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
    // Store the LATEST computed range; the scheduled re-asserts below read this
    // ref (not captured locals) so a partial first data load can't lock stale
    // indices into the pending re-asserts (which showed the earliest bars).
    yearRangeRef.current = { from: startIdx, to: endIdx }
    const applyYear = () => {
      const r = yearRangeRef.current
      if (!r) return
      try {
        chart.timeScale().setVisibleLogicalRange({ from: r.from, to: r.to })
        mainPriceScale()?.applyOptions({ autoScale: true })
      } catch { /* range can be out of bounds mid-load; next update re-pins */ }
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
  }, [exactDateRange, entryDate, exitDate, filteredBars, sym, resolvedTf, mergedMarkers, highlightTimeSet])

  // Each stock starts at the year view with setup text hidden; the first focus
  // zoom then eases it in. Without this reset, switching from a focused stock
  // would leave textFadeRef at 1 and the next setup's text would pop in instantly.
  useEffect(() => { textFadeRef.current = 0 }, [sym, resolvedTf])

  // Animated "focus a setup" zoom (Model Book). On a focusNonce bump: if
  // focusDate is set, smoothly zoom so that bar is the last candle on screen
  // (with focusBarsBack bars of lead-up to its left); if focusDate is null,
  // zoom back out to the full [entryDate, exitDate] year and hand the view
  // back to the pin above. Only fires on an actual nonce change so routine
  // data refreshes never re-trigger it.
  useEffect(() => {
    if (focusNonce === lastFocusNonceRef.current) return
    lastFocusNonceRef.current = focusNonce
    const chart = chartRef.current
    if (!chart || !filteredBars || filteredBars.length === 0) return
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
      focusActiveRef.current = true
      _animateFocusZoom(chart, series, focusRafRef, focusPriceRangeRef, filteredBars,
        { from: startIdx, to: endIdx }, 850, () => { focusActiveRef.current = false }, overlayData, textFadeRef, false)
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
      try { mainPriceScale()?.applyOptions({ autoScale: true }) } catch { /* ignore */ }
      onFocusEscape()
    }
    // Wheel-zoom escapes immediately. For drag-pan, only escape once the pointer
    // actually moves past a small threshold — a plain click shouldn't drop focus.
    const onWheel = () => escape()
    let down = null
    const onDown = (e) => { down = { x: e.clientX, y: e.clientY } }
    const onMove = (e) => {
      if (!down) return
      if (Math.abs(e.clientX - down.x) > 4 || Math.abs(e.clientY - down.y) > 4) { down = null; escape() }
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
      if (!priceData) { setCrosshairData(null); return }

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
        return d && ov ? { label: `${ov.type} ${ov.period}`, value: d.value, color: ov.color } : null
      }).filter(Boolean)

      // For OHLC types (candles/bars/hollow)
      const o = priceData.open ?? priceData.value
      const h = priceData.high ?? priceData.value
      const l = priceData.low ?? priceData.value
      const c = priceData.close ?? priceData.value
      const change = c - o
      const changePct = o ? ((change / o) * 100) : 0

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
        setCrosshairData(null)
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
    // Suppress clear-echo: applying a crosshair fires a point-less crosshair
    // event that must not be re-broadcast as a "mouse left" clear.
    applyingExternalRef.current = true
    if (!externalCrosshair?.time) {
      try { chartRef.current.clearCrosshairPosition() } catch {}
    } else {
      try {
        const priceVal =
          externalCrosshair.price?.close ??
          externalCrosshair.price?.value ??
          (typeof externalCrosshair.price === 'number' ? externalCrosshair.price : 0)
        chartRef.current.setCrosshairPosition(
          priceVal,
          externalCrosshair.time,
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

  useEffect(() => {
    const el = containerRef.current
    const chart = chartRef.current
    if (!el || !chart || !bars || bars.length === 0) return

    const handler = (e) => {
      const rect = el.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top

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
      e.preventDefault()

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
          clientX: e.clientX,
          clientY: e.clientY,
          event: e,
          getScreenshotBlob,
          region,
          sections,
          clickPrice,
          currentPrice,
        })
      } else {
        window.dispatchEvent(new CustomEvent('uct:chart-contextmenu', {
          detail: {
            sym,
            tf: resolvedTf,
            bar: closest,
            clientX: e.clientX,
            clientY: e.clientY,
            getScreenshotBlob,
            region,
            sections,
            clickPrice,
            currentPrice,
          },
        }))
      }
    }
    el.addEventListener('contextmenu', handler)
    return () => el.removeEventListener('contextmenu', handler)
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
      const candle = realtimeCandle.getCandle(sym, '1')
      if (!candle) return
      const price = candle.c
      if (!Number.isFinite(price) || price <= 0) return
      // Sanity bound vs last known close — protects against bad ticks.
      const lastClose = lastBarRef.current?.close
      if (lastClose && lastClose > 0 && Math.abs(price - lastClose) / lastClose > 0.5) return

      try {
        if (resolvedTf === '1') {
          // Registry's 1m candle IS the developing bar. Apply it directly,
          // but offset to ET like all other series timestamps.
          const tSec = candle.t + _ET_OFFSET
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
            volumeSeriesRef.current.update({
              time: tSec,
              value: candle.v || 0,
              color: candle.c >= candle.o ? cs.volume.upColor : cs.volume.downColor,
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
        if (e?.message) console.warn('[StockChart] registry tick update error:', e.message)
      }
    }

    // Fire once on subscribe in case a tick already landed before mount,
    // then subscribe to future ticks.
    update()
    const unsub = realtimeCandle.subscribe(sym, update)
    return unsub
  }, [sym, resolvedTf, replayMode, cs.heikinAshi, cs.chartType, cs.volume.upColor, cs.volume.downColor])

  // ── Render ──
  return (
    <div className={`${styles.wrapper} ${className}`} style={{ height }}>
      {replayMode && sessionBars?.length > 0 && (
        <div className={styles.replayBadge} title="Time Machine — historical replay active">
          ⏮ REPLAY {Math.round(((replayIndex ?? 0) / Math.max(1, sessionBars.length - 1)) * 100)}%
        </div>
      )}
      {isStale && (
        <div className={styles.staleIndicator} title="Live feed has paused — last tick is older than expected">
          ⏸ STALE
        </div>
      )}
      {correctionFlash && (
        <div className={styles.correctionFlash} title="Server corrected this bar after reconciliation">
          ↻ Bar corrected
        </div>
      )}
      {cs.countdown && countdownTfSec && currentBarStart && (
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
      {loading && (
        <div className={styles.skeletonOverlay}>
          <div className={styles.skeletonText}>Loading {sym}…</div>
        </div>
      )}
      {showFatalError && (
        <div className={styles.error}>
          <span>Failed to load chart for {sym}</span>
          <button className={styles.retryBtn} onClick={() => mutate()}>Retry</button>
        </div>
      )}
      <div
        ref={containerRef}
        className={styles.chart}
        style={{ display: showFatalError ? 'none' : 'block' }}
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
              <span style={{
                position: 'absolute',
                right: b.width + 3,
                top: -7,
                fontSize: 9.5,
                color: b.color,
                fontWeight: b.isGoldTier ? 700 : 500,
                // Bigger boost than before (was +0.18, then +0.30) — bars
                // now max at 0.50 opacity but the $ label needs to stay
                // legible. +0.45 lifts top-tier labels to ~0.95 (visible)
                // and small bars to ~0.55.
                opacity: Math.min(1, b.opacity + 0.45),
                whiteSpace: 'nowrap',
                fontFamily: "'Instrument Sans','SF Pro Display',system-ui,sans-serif",
                pointerEvents: 'none',
              }}>
                {formatDpNotional(b.notional)}
              </span>
            </div>
          ))}
        </div>
      )}
      {/* Dark Pool hover tooltip — fixed positioned near cursor, rendered last
          so it sits above the chart and other overlays. */}
      {dpHover && (
        <div style={{
          position: 'fixed',
          left: dpHover.x + 14,
          top: Math.max(8, dpHover.y - 90),
          background: '#0e0f0d',
          border: '1px solid #c9a84c66',
          borderRadius: 6,
          padding: '8px 12px',
          fontSize: 11,
          color: '#e0dac8',
          pointerEvents: 'none',
          zIndex: 1000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
          minWidth: 200,
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
              ${Math.round(dpHover.bar.notional).toLocaleString()}
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
      )}
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
      {crosshairData && (
        <div
          className={styles.legend}
          /* Drop below the index pane so the OHLCV legend never covers it. */
          style={overlayBounds ? { top: overlayBounds.top + 6 } : undefined}
        >
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
        </div>
      )}
      <canvas
        ref={vpCanvasRef}
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 2 }}
      />
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
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            repeatMode={repeatMode}
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
            drawingCount={drawings.length}
            repeatMode={repeatMode}
            setRepeatMode={handleSetRepeatMode}
            magnet={magnet}
            setMagnet={setMagnet}
            chartSettings={cs}
            onUpdateSettings={handleUpdateChartSettings}
            showExtended={isIntraday ? showExtended : null}
            onToggleExtended={isIntraday ? handleToggleExtended : null}
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
