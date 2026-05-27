// app/src/components/StockChart.jsx — TradingView Lightweight Charts v5 wrapper
// Optimized: chart instance reuse, O(n) HVC, memoized data transforms
import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import useSWR from 'swr'
import { createChart, CandlestickSeries, BarSeries, HistogramSeries, LineSeries, AreaSeries, ColorType } from 'lightweight-charts'
import usePreferences from '../hooks/usePreferences'
import { mergeChartSettings } from './chart/chartDefaults'
import { createWatermarkPrimitive, composeWatermarkLines } from './chart/watermarkPrimitive'
import useTickerMeta from '../hooks/useTickerMeta'
import useWatermarkDrag from '../hooks/useWatermarkDrag'
import { toHeikinAshi, computeBB, computeVWAP, computeRSI, computeMACD, computeStochastic, computeATR, computeParabolicSAR, computeIchimoku, computeMFI, computeCCI, computeWilliamsR, computeADX, computeOBV, computeDonchian } from './chart/indicators'
import useChartDrawings from './chart/useChartDrawings'
import ChartDrawingOverlay from './chart/ChartDrawingOverlay'
import PatternOverlay from './chart/PatternOverlay'
import PatternSidePanel from './chart/PatternSidePanel'
import ChartToolbar from './chart/ChartToolbar'
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

function computePaneMargins(cs, hasVolume) {
  const ind = cs.indicators || {}
  // Define all possible sub-panes in stacking order (bottom of chart → top)
  // Each entry: key (used in returned object), enabled flag, base height fraction
  const PANES = [
    { key: 'obv',       enabled: !!ind.obv?.enabled,       baseH: 0.13 },
    { key: 'atr',       enabled: !!ind.atr?.enabled,       baseH: 0.13 },
    { key: 'adx',       enabled: !!ind.adx?.enabled,       baseH: 0.15 },
    { key: 'macd',      enabled: !!ind.macd?.enabled,      baseH: 0.17 },
    { key: 'cci',       enabled: !!ind.cci?.enabled,       baseH: 0.15 },
    { key: 'williamsR', enabled: !!ind.williamsR?.enabled, baseH: 0.15 },
    { key: 'mfi',       enabled: !!ind.mfi?.enabled,       baseH: 0.15 },
    { key: 'stoch',     enabled: !!ind.stoch?.enabled,     baseH: 0.15 },
    { key: 'rsi',       enabled: !!ind.rsi?.enabled,       baseH: 0.15 },
    { key: 'volume',    enabled: hasVolume,                baseH: 0.15 },
  ]
  const active = PANES.filter(p => p.enabled)
  const totalBase = active.reduce((s, p) => s + p.baseH, 0)
  // Cap sub-panes at 72% so price area always gets ≥28%
  const scale = totalBase > 0.72 ? 0.72 / totalBase : 1
  let bottom = 0
  const out = {}
  for (const { key, baseH } of active) {
    const h = +((baseH * scale).toFixed(2))
    out[key] = { top: +((1 - bottom - h).toFixed(2)), bottom: +bottom.toFixed(2) }
    bottom = +(bottom + h).toFixed(2)
  }
  // Top margin 0.30 leaves the highest candle ~30% from the top of the chart
  // so there's deliberate headroom above price action (matches TC2000-style layout).
  out.main = { top: 0.30, bottom: bottom }
  return out
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

export default function StockChart({
  sym,
  tf,
  height = '100%',
  markers = null,
  priceLines = null,
  showVolume: showVolumeProp,
  overlays: overlaysProp,
  watermark = null,
  className = '',
  showDrawingTools = true,
  onSymbolChange = null,
  onBarContextMenu = null,  // Journal 2.0: right-click a bar → callback({bar, clientX, clientY})
  entryDate = null,         // ISO date string — zoom centers on trade holding period
  exitDate = null,          // ISO date string — end of holding period zoom
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

  // ── Keyboard help overlay state ──
  const [helpOpen, setHelpOpen] = useState(false)
  // Flips true once the LWC chart instance is first created (in updateChart).
  // Used by the crosshair-legend effect to subscribe exactly once, instead of
  // re-subscribing on every render of updateChart (which would happen ~once
  // per real-time tick and visibly stutter the crosshair).
  const [chartReady, setChartReady] = useState(false)

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
  const resolvedOverlays = useMemo(
    () => overlaysProp !== undefined ? overlaysProp : cs.overlays.filter(o => o.enabled),
    [overlaysProp, cs.overlays]
  )

  const containerRef = useRef(null)
  const wmCtrlRef = useRef(null)        // watermark primitive controller
  const wmAttachedRef = useRef(false)   // guard: primitive attached once
  const tickerMeta = useTickerMeta(sym)
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
  const lastBarRef = useRef(null)
  const prevChartTypeRef = useRef(null)
  const zoomKeyRef = useRef(null)  // Track sym+tf to only zoom on initial load, not refetches
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
  const swrUrl = (sym && idbLoaded && idbReadyForRef.current === `${sym}_${resolvedTf}`)
    ? `/api/bars/${encodeURIComponent(sym)}?tf=${resolvedTf}&bars=${barCount}${_sinceParam != null ? `&since=${encodeURIComponent(String(_sinceParam))}` : ''}`
    : null

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
  const bars = (data && !data.delta && data.bars?.length)
    ? data.bars
    : ((idbBars?.length && !idbStaleIntraday) ? idbBars : data?.bars)
  const loading = !bars && !error

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
  const closeData = useMemo(
    () => displayBars ? displayBars.map(b => ({ time: adjustTime(b.t), value: b.c })) : [],
    [displayBars, adjustTime]
  )
  const hvcSet = useMemo(
    () => cs.volume.hvcEnabled && filteredBars?.length > 20 ? computeHVC(filteredBars) : new Set(),
    [filteredBars, cs.volume.hvcEnabled]
  )
  const volData = useMemo(() => {
    if (!filteredBars?.length) return []
    return filteredBars.map(b => ({
      time: adjustTime(b.t),
      value: b.v,
      color: hvcSet.has(b.t)
        ? 'rgba(201,168,76,0.9)'
        : b.c >= b.o ? cs.volume.upColor : cs.volume.downColor,
    }))
  }, [filteredBars, hvcSet, cs.volume.upColor, cs.volume.downColor, adjustTime])
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

    // ── Create or update chart instance ──
    const chartOpts = {
      layout: {
        background: { type: ColorType.Solid, color: themeColors.background },
        textColor: themeColors.textColor,
        fontFamily: "'Instrument Sans', sans-serif",
        fontSize: 10,
        attributionLogo: false,  // hide built-in TradingView logo; we overlay the UCT mark instead
      },
      grid: {
        vertLines: { color: cs.grid.visible ? themeColors.gridColor : 'transparent' },
        horzLines: { color: cs.grid.visible ? themeColors.gridColor : 'transparent' },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: themeColors.crosshairColor, width: 1, style: cs.crosshair.style, labelBackgroundColor: themeColors.background },
        horzLine: { color: themeColors.crosshairColor, width: 1, style: cs.crosshair.style, labelBackgroundColor: themeColors.background },
      },
      rightPriceScale: {
        borderColor: themeColors.borderColor,
        scaleMargins: computePaneMargins(cs, showVolume && volData.length > 0).main,
      },
      timeScale: {
        borderColor: themeColors.borderColor,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 3,
        rightBarStaysOnScroll: true,
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
        ? composeWatermarkLines(watermark ?? sym, tickerMeta, cs.watermark.lines)
        : []
      wmCtrlRef.current.setOptions({
        lines: wmLines,
        color: cs.watermark.color,
        opacity: cs.watermark.opacity,
        sizeScale: cs.watermark.sizeScale,
        x: cs.watermark.x,
        y: cs.watermark.y,
      })
    }

    // Log scale: mode 0 = Normal, 1 = Logarithmic (Lightweight Charts v5)
    chart.priceScale('right').applyOptions({ mode: cs.logScale ? 1 : 0 })

    // ── Price series — reuse if chart type unchanged, else swap ──
    // When swapping the candle series, the markers controller is bound to the
    // old series — detach it so the next markers update creates a fresh
    // controller against the new series.
    if (prevChartTypeRef.current !== cs.chartType && candleSeriesRef.current) {
      try { chart.removeSeries(candleSeriesRef.current) } catch {}
      candleSeriesRef.current = null
      try { markersControllerRef.current?.detach?.() } catch {}
      markersControllerRef.current = null
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

    // ── Volume series (pane 0 overlay) — dynamic margins via computePaneMargins ──
    const paneMargins = computePaneMargins(cs, showVolume && volData.length > 0)
    if (showVolume && volData.length) {
      if (!volumeSeriesRef.current) {
        const vs = chart.addSeries(HistogramSeries, {
          priceFormat: { type: 'volume' },
          priceScaleId: '',
        })
        volumeSeriesRef.current = vs
      }
      const volMargins = paneMargins.volume || { top: 0.82, bottom: 0 }
      volumeSeriesRef.current.priceScale().applyOptions({ scaleMargins: volMargins })
      volumeSeriesRef.current.setData(volData)
    } else if (volumeSeriesRef.current) {
      try { chart.removeSeries(volumeSeriesRef.current) } catch {}
      volumeSeriesRef.current = null
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
      if (i < overlaySeriesRefs.current.length) {
        // Reuse existing series — always setData (even empty) to clear stale data
        overlaySeriesRefs.current[i].applyOptions({ color })
        overlaySeriesRefs.current[i].setData(ovData)
      } else if (ovData.length) {
        // Add new series only if there's data to show
        const ls = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
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
      if (!rsiSeriesRef.current) {
        rsiSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'rsi',
          color: rsiColor,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        chart.priceScale('rsi').applyOptions({
          borderVisible: false,
          scaleMargins: paneMargins.rsi || { top: 0.82, bottom: 0 },
          autoScale: false,
          minimum: 0,
          maximum: 100,
        })
        rsiSeriesRef.current.createPriceLine({ price: 70, color: 'rgba(123,104,238,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
        rsiSeriesRef.current.createPriceLine({ price: 50, color: 'rgba(123,104,238,0.2)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false })
        rsiSeriesRef.current.createPriceLine({ price: 30, color: 'rgba(123,104,238,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
      } else {
        rsiSeriesRef.current.applyOptions({ color: rsiColor })
        chart.priceScale('rsi').applyOptions({ scaleMargins: paneMargins.rsi || { top: 0.82, bottom: 0 } })
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
      if (!stochKRef.current) {
        stochKRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'stoch',
          color: stochCfg?.kColor || '#FF6B6B',
          lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        stochDRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'stoch',
          color: stochCfg?.dColor || '#4ECDC4',
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        chart.priceScale('stoch').applyOptions({
          borderVisible: false,
          scaleMargins: paneMargins.stoch || { top: 0.82, bottom: 0 },
          autoScale: false,
          minimum: 0,
          maximum: 100,
        })
        stochKRef.current.createPriceLine({ price: 80, color: 'rgba(255,107,107,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
        stochKRef.current.createPriceLine({ price: 20, color: 'rgba(78,205,196,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
      } else {
        stochKRef.current.applyOptions({ color: stochCfg?.kColor || '#FF6B6B' })
        stochDRef.current.applyOptions({ color: stochCfg?.dColor || '#4ECDC4' })
        chart.priceScale('stoch').applyOptions({ scaleMargins: paneMargins.stoch || { top: 0.82, bottom: 0 } })
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
      if (!macdLineRef.current) {
        macdLineRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'macd',
          color: macdCfg?.macdColor || '#2196F3',
          lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        macdSignalRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'macd',
          color: macdCfg?.signalColor || '#FF9800',
          lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        macdHistRef.current = chart.addSeries(HistogramSeries, {
          priceScaleId: 'macd',
          priceFormat: { type: 'price', precision: 5 },
          priceLineVisible: false, lastValueVisible: false,
        })
        chart.priceScale('macd').applyOptions({
          borderVisible: false,
          scaleMargins: paneMargins.macd || { top: 0.80, bottom: 0 },
          autoScale: true,
        })
        macdLineRef.current.createPriceLine({ price: 0, color: 'rgba(255,255,255,0.12)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false })
      } else {
        macdLineRef.current.applyOptions({ color: macdCfg?.macdColor || '#2196F3' })
        macdSignalRef.current.applyOptions({ color: macdCfg?.signalColor || '#FF9800' })
        chart.priceScale('macd').applyOptions({ scaleMargins: paneMargins.macd || { top: 0.80, bottom: 0 } })
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
      if (!atrSeriesRef.current) {
        atrSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'atr',
          color: atrColor,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        chart.priceScale('atr').applyOptions({
          borderVisible: false,
          scaleMargins: paneMargins.atr || { top: 0.86, bottom: 0 },
          autoScale: true,
        })
      } else {
        atrSeriesRef.current.applyOptions({ color: atrColor })
        chart.priceScale('atr').applyOptions({ scaleMargins: paneMargins.atr || { top: 0.86, bottom: 0 } })
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
      if (!mfiSeriesRef.current) {
        mfiSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'mfi',
          color: mfiColor,
          lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        chart.priceScale('mfi').applyOptions({
          borderVisible: false,
          scaleMargins: paneMargins.mfi || { top: 0.82, bottom: 0 },
          autoScale: false,
          minimum: 0,
          maximum: 100,
        })
        mfiSeriesRef.current.createPriceLine({ price: 80, color: 'rgba(192,132,252,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
        mfiSeriesRef.current.createPriceLine({ price: 20, color: 'rgba(192,132,252,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
      } else {
        mfiSeriesRef.current.applyOptions({ color: mfiColor })
        chart.priceScale('mfi').applyOptions({ scaleMargins: paneMargins.mfi || { top: 0.82, bottom: 0 } })
      }
      mfiSeriesRef.current.setData(indicatorData.mfi)
    } else if (mfiSeriesRef.current) {
      try { chart.removeSeries(mfiSeriesRef.current) } catch {}
      mfiSeriesRef.current = null
    }

    // ── CCI sub-pane (±300 typical, +100/0/-100 reference lines) ──
    if (indicatorData.cci.length) {
      const cciColor = cs.indicators?.cci?.color || '#fbbf24'
      if (!cciSeriesRef.current) {
        cciSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'cci',
          color: cciColor,
          lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        chart.priceScale('cci').applyOptions({
          borderVisible: false,
          scaleMargins: paneMargins.cci || { top: 0.82, bottom: 0 },
          autoScale: true,
        })
        cciSeriesRef.current.createPriceLine({ price:  100, color: 'rgba(251,191,36,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
        cciSeriesRef.current.createPriceLine({ price:    0, color: 'rgba(251,191,36,0.2)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false })
        cciSeriesRef.current.createPriceLine({ price: -100, color: 'rgba(251,191,36,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
      } else {
        cciSeriesRef.current.applyOptions({ color: cciColor })
        chart.priceScale('cci').applyOptions({ scaleMargins: paneMargins.cci || { top: 0.82, bottom: 0 } })
      }
      cciSeriesRef.current.setData(indicatorData.cci)
    } else if (cciSeriesRef.current) {
      try { chart.removeSeries(cciSeriesRef.current) } catch {}
      cciSeriesRef.current = null
    }

    // ── Williams %R sub-pane (-100..0, -20/-80 reference lines) ──
    if (indicatorData.williamsR.length) {
      const wrColor = cs.indicators?.williamsR?.color || '#60a5fa'
      if (!williamsRSeriesRef.current) {
        williamsRSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'williamsR',
          color: wrColor,
          lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        chart.priceScale('williamsR').applyOptions({
          borderVisible: false,
          scaleMargins: paneMargins.williamsR || { top: 0.82, bottom: 0 },
          autoScale: false,
          minimum: -100,
          maximum: 0,
        })
        williamsRSeriesRef.current.createPriceLine({ price: -20, color: 'rgba(96,165,250,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
        williamsRSeriesRef.current.createPriceLine({ price: -80, color: 'rgba(96,165,250,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
      } else {
        williamsRSeriesRef.current.applyOptions({ color: wrColor })
        chart.priceScale('williamsR').applyOptions({ scaleMargins: paneMargins.williamsR || { top: 0.82, bottom: 0 } })
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
      if (!adxSeriesRef.current) {
        adxSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'adx',
          color: adxCfg?.adxColor || '#e5e7eb',
          lineWidth: 2,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        adxPlusDIRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'adx',
          color: adxCfg?.plusDIColor || '#22c55e',
          lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        adxMinusDIRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'adx',
          color: adxCfg?.minusDIColor || '#ef4444',
          lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        chart.priceScale('adx').applyOptions({
          borderVisible: false,
          scaleMargins: paneMargins.adx || { top: 0.80, bottom: 0 },
          autoScale: false,
          minimum: 0,
          maximum: 100,
        })
        adxSeriesRef.current.createPriceLine({ price: 25, color: 'rgba(229,231,235,0.3)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
      } else {
        adxSeriesRef.current.applyOptions({  color: adxCfg?.adxColor     || '#e5e7eb' })
        adxPlusDIRef.current.applyOptions({  color: adxCfg?.plusDIColor  || '#22c55e' })
        adxMinusDIRef.current.applyOptions({ color: adxCfg?.minusDIColor || '#ef4444' })
        chart.priceScale('adx').applyOptions({ scaleMargins: paneMargins.adx || { top: 0.80, bottom: 0 } })
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
      if (!obvSeriesRef.current) {
        obvSeriesRef.current = chart.addSeries(LineSeries, {
          priceScaleId: 'obv',
          color: obvColor,
          lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        chart.priceScale('obv').applyOptions({
          borderVisible: false,
          scaleMargins: paneMargins.obv || { top: 0.86, bottom: 0 },
          autoScale: true,
        })
      } else {
        obvSeriesRef.current.applyOptions({ color: obvColor })
        chart.priceScale('obv').applyOptions({ scaleMargins: paneMargins.obv || { top: 0.86, bottom: 0 } })
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

    // Default zoom — only set on initial load or sym/tf change, NOT on SWR refetches
    // (prevents losing user's scroll/zoom position every 15 seconds)
    const zoomKey = `${sym}_${resolvedTf}`
    if (zoomKeyRef.current !== zoomKey) {
      zoomKeyRef.current = zoomKey

      // Re-enable price-scale auto-fit on ticker/timeframe change. Lightweight-charts
      // flips the right price scale into manual mode the first time a user drags it,
      // and stays manual until reset — without this, switching from a $290 ticker to a
      // $4 ticker leaves the Y-axis stuck and the new candles render below the viewport.
      try { chart.priceScale('right').applyOptions({ autoScale: true }) } catch {}

      // Holding-period zoom: when entryDate is supplied (e.g. TradeDrawer),
      // center the view on the trade window with 20-bar padding each side.
      if (entryDate && filteredBars.length > 0) {
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
  }, [filteredBars, ohlcData, closeData, volData, overlayData, indicatorData, comparisonData, sym, showVolume, mergedMarkers, mergedPriceLines, watermark, cs, adjustTime, resolvedTf, tickerMeta])

  // Effect: update chart when data or settings change (NO cleanup — chart persists)
  useEffect(() => {
    updateChart()
  }, [updateChart])

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
    if (!externalCrosshair?.time) {
      try { chartRef.current.clearCrosshairPosition() } catch {}
      return
    }
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
      // Prefer the currently-hovered bar (from crosshair tracking). Falls
      // back to coordinateToLogical if crosshair hasn't fired yet (edge
      // case: user right-clicks immediately without moving the mouse).
      let closest = hoveredBarRef.current
      if (!closest) {
        const rect = el.getBoundingClientRect()
        const x = e.clientX - rect.left
        let logical = null
        try { logical = chart.timeScale().coordinateToLogical(x) } catch { return }
        if (logical == null) return
        const idx = Math.max(0, Math.min(bars.length - 1, Math.round(logical)))
        closest = bars[idx]
      }
      if (!closest) return

      // Only block the browser default menu once we know we have a bar.
      e.preventDefault()

      if (onBarContextMenu) {
        onBarContextMenu({
          bar: closest,
          clientX: e.clientX,
          clientY: e.clientY,
          event: e,
        })
      } else {
        window.dispatchEvent(new CustomEvent('uct:chart-contextmenu', {
          detail: {
            sym,
            tf: resolvedTf,
            bar: closest,
            clientX: e.clientX,
            clientY: e.clientY,
          },
        }))
      }
    }
    el.addEventListener('contextmenu', handler)
    return () => el.removeEventListener('contextmenu', handler)
  }, [onBarContextMenu, bars, sym, resolvedTf])

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
      {error && (
        <div className={styles.error}>
          <span>Failed to load chart for {sym}</span>
          <button className={styles.retryBtn} onClick={() => mutate()}>Retry</button>
        </div>
      )}
      <div
        ref={containerRef}
        className={styles.chart}
        style={{ display: error ? 'none' : 'block' }}
      />
      {!error && (
        <img
          src={brandMark}
          alt="Uncharted Territory"
          className={styles.brandLogo}
          draggable={false}
        />
      )}
      {crosshairData && (
        <div className={styles.legend}>
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
            drawings={drawings}
            addDrawing={addDrawing}
            updateDrawing={updateDrawing}
            removeDrawing={removeDrawing}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            repeatMode={repeatMode}
          />
          <ChartToolbar
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
      <KeyboardHelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
      <PatternSidePanel
        detection={activeDetection}
        onClose={() => setActiveDetection(null)}
      />
    </div>
  )
}
