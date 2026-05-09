// app/src/components/StockChart.jsx — TradingView Lightweight Charts v5 wrapper
// Optimized: chart instance reuse, O(n) HVC, memoized data transforms
import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import useSWR from 'swr'
import { createChart, CandlestickSeries, BarSeries, HistogramSeries, LineSeries, AreaSeries, ColorType } from 'lightweight-charts'
import usePreferences from '../hooks/usePreferences'
import { mergeChartSettings } from './chart/chartDefaults'
import { toHeikinAshi, computeBB, computeVWAP, computeRSI, computeMACD, computeStochastic, computeATR, computeParabolicSAR, computeIchimoku } from './chart/indicators'
import useChartDrawings from './chart/useChartDrawings'
import ChartDrawingOverlay from './chart/ChartDrawingOverlay'
import ChartToolbar from './chart/ChartToolbar'
import useRealtimePrices from '../hooks/useRealtimePrices'
import useRealtimeBars from '../hooks/useRealtimeBars'
import useJ2ChartMarkers from '../pages/journal-2-0/hooks/useJ2ChartMarkers'
import styles from './StockChart.module.css'
import { idbGet, idbPut, mergeDelta } from '../utils/barsIDB'

const fetcher = url => fetch(url).then(r => r.json())

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
    { key: 'atr',    enabled: !!ind.atr?.enabled,   baseH: 0.13 },
    { key: 'macd',   enabled: !!ind.macd?.enabled,  baseH: 0.17 },
    { key: 'stoch',  enabled: !!ind.stoch?.enabled, baseH: 0.15 },
    { key: 'rsi',    enabled: !!ind.rsi?.enabled,   baseH: 0.15 },
    { key: 'volume', enabled: hasVolume,             baseH: 0.15 },
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
  out.main = { top: 0.02, bottom: bottom }
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
}) {
  const { prefs, setPref } = usePreferences()
  const resolvedTf = tf || prefs.default_chart_tf || 'D'

  // ── Chart settings from user preferences ──
  const cs = useMemo(() => mergeChartSettings(prefs.chart_settings), [prefs.chart_settings])

  // ── Chart event markers (earnings + splits) — fetched from /api/chart/markers ──
  const markersEnabled = cs.markers?.earnings || cs.markers?.splits
  const { data: markersData } = useSWR(
    markersEnabled && sym ? `/api/chart/markers/${encodeURIComponent(sym)}` : null,
    fetcher,
    { dedupingInterval: 21_600_000 }  // 6 hours — markers don't change often
  )
  const chartEventMarkers = useMemo(() => {
    // Only show event markers on daily/weekly — intraday bars don't line up with quarter dates
    const isDailyWeekly = !['1', '5', '15', '30', '60'].includes(resolvedTf)
    if (!markersData || !isDailyWeekly) return []
    const eventMarkers = []
    if (cs.markers?.earnings && Array.isArray(markersData.earnings)) {
      for (const e of markersData.earnings) {
        if (!e.date) continue
        eventMarkers.push({
          time: e.date,
          position: 'belowBar',
          color: e.beat === true ? '#4ade80' : e.beat === false ? '#f87171' : '#94a3b8',
          shape: e.beat === true ? 'arrowUp' : e.beat === false ? 'arrowDown' : 'circle',
          text: 'E',
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
          color: '#60a5fa',
          shape: 'square',
          text: s.ratio || 'S',
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
    () => [...(markers || []), ...(j2.markers || []), ...chartEventMarkers],
    [markers, j2.markers, chartEventMarkers],
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
  const vpCanvasRef = useRef(null)
  const ichimokuTenkanRef = useRef(null)
  const ichimokuKijunRef  = useRef(null)
  const ichimokuSpanARef  = useRef(null)
  const ichimokuSpanBRef  = useRef(null)
  const ichimokuChikouRef = useRef(null)
  const macdLineRef   = useRef(null)
  const macdSignalRef = useRef(null)
  const macdHistRef   = useRef(null)
  const priceLineRefs = useRef([])
  const markersControllerRef = useRef(null)  // lightweight-charts SeriesMarkers controller — must be reused/detached, not recreated
  const lastBarRef = useRef(null)
  const prevChartTypeRef = useRef(null)
  const zoomKeyRef = useRef(null)  // Track sym+tf to only zoom on initial load, not refetches
  const latestLiveRef = useRef(null)  // Latest live price — used to re-apply after setData() wipes
  const liveBarRef = useRef(null)     // Developing bar OHLCV tracked tick-by-tick (survives setData)
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

  const [activeTool, setActiveTool] = useState(null)
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
  const handleScreenshot = useCallback(() => {
    if (!chartRef.current) return
    try {
      const imageData = chartRef.current.takeScreenshot()
      const canvas = document.createElement('canvas')
      canvas.width = imageData.width
      canvas.height = imageData.height
      canvas.getContext('2d').putImageData(imageData, 0, 0)
      const link = document.createElement('a')
      link.download = `${sym || 'chart'}-${new Date().toISOString().slice(0, 10)}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } catch (err) {
      console.warn('Screenshot failed:', err)
    }
  }, [sym])
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
    if (e > 0) positionPriceLines.current.push(cs2.createPriceLine({ price: e, color: '#60a5fa', lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: 'Entry' }))
    if (s > 0) positionPriceLines.current.push(cs2.createPriceLine({ price: s, color: '#f87171', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Stop' }))
    if (t > 0) positionPriceLines.current.push(cs2.createPriceLine({ price: t, color: '#4ade80', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'Target' }))
  }, [activeTool, positionTool])

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
  // Compute the `since` param ONE BAR BACK from idbSinceRef. The server's
  // since-filter is strict `>`, so passing the last cached bar's t directly
  // makes the server skip that bar and never refresh it. The boundary bar
  // is the currently-developing one (today's daily, this week's weekly, the
  // last in-progress intraday minute) — without backing off by one, today's
  // bar gets baked into IDB at whatever intraday-snapshot values it had at
  // first fetch and stays frozen there even as the actual close moves on.
  // Symptom this fixes: dashboard chart shows H/C from earlier in the day
  // for the last several days while Polygon canonical (and TV) show the
  // final close — a multi-day visual divergence the user kept seeing.
  // The mergeDelta logic at line ~514 already REPLACES existing bars whose
  // timestamps appear in the delta, so re-fetching the boundary bar is
  // safe: the fresh server value wins.
  const _idbSinceForServer = (() => {
    const v = idbSinceRef.current
    if (v == null) return null
    // Daily/Weekly/Monthly: t is an ISO date string "YYYY-MM-DD". Subtract
    // 1 day so the most recent cached bar gets re-fetched. (The server
    // returns calendar-aligned bars regardless, so over-fetching by a
    // single day is the cheapest, safest way to ensure the boundary bar
    // refreshes.)
    if (typeof v === 'string') {
      try {
        const d = new Date(v + 'T00:00:00Z')
        d.setUTCDate(d.getUTCDate() - 1)
        return d.toISOString().slice(0, 10)
      } catch { return v }
    }
    // Intraday: t is unix seconds. Subtract 1 so the boundary minute bar
    // gets re-fetched. The mergeDelta logic deduplicates by timestamp.
    if (typeof v === 'number') return Math.max(0, v - 1)
    return v
  })()
  const swrUrl = (sym && idbLoaded && idbReadyForRef.current === `${sym}_${resolvedTf}`)
    ? `/api/bars/${encodeURIComponent(sym)}?tf=${resolvedTf}&bars=${barCount}${_idbSinceForServer != null ? `&since=${encodeURIComponent(String(_idbSinceForServer))}` : ''}`
    : null

  const { data, error, mutate } = useSWR(
    swrUrl,
    fetcher,
    { dedupingInterval: dedupMs, revalidateOnFocus: false }
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
          // Skip if IDB has fresh data (D/W: 24 h; intraday: 4 h)
          const maxAge = (['D', 'W'].includes(tf) ? 86400 : 14400) * 1000
          if (entry?.bars?.length && Date.now() - (entry.savedAt || 0) < maxAge) continue
          const bc    = BC[tf] ?? 5000
          const since = entry?.lastT
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
  const bars = (data && !data.delta && data.bars?.length)
    ? data.bars
    : (idbBars?.length ? idbBars : data?.bars)
  const loading = !bars && !error

  // Real-time price streaming for live candle updates
  const { prices: livePrices } = useRealtimePrices(liveUpdates && sym ? [sym] : [])

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

  // ── Drawing tool + TF keyboard shortcuts ──
  // (Moved from above sessionBars/replay state declarations to fix a TDZ
  // ReferenceError — see the comment higher up the file.)
  useEffect(() => {
    if (!showDrawingTools && !onTfChange && !replayMode) return
    const TF_KEYS = { '1': '1', '5': '5', 'd': 'D', 'w': 'W' }
    const TOOL_KEYS = { t: 'trendline', h: 'horizontal', r: 'rect', f: 'fib', x: 'text', m: 'measure', p: 'position' }
    const handler = (e) => {
      // Skip if user is typing in an input
      const tag = document.activeElement?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (document.activeElement?.isContentEditable) return
      const key = e.key.toLowerCase()
      // Replay shortcuts — checked first
      if (replayMode) {
        if (e.key === ' ') { e.preventDefault(); setReplayPlaying(p => !p); return }
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          setReplayPlaying(false)
          setReplayIndex(i => Math.max(0, (i ?? 0) - 1))
          return
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          setReplayPlaying(false)
          setReplayIndex(i => Math.min((sessionBars?.length || 1) - 1, (i ?? 0) + 1))
          return
        }
      }
      // TF shortcuts (1=1min, 5=5min, d=daily, w=weekly)
      if (onTfChange) {
        const tfKey = TF_KEYS[key]
        if (tfKey) { e.preventDefault(); onTfChange(tfKey); return }
      }
      // Drawing tool shortcuts
      if (showDrawingTools) {
        if (e.key === 'Escape') { setActiveTool(null); return }
        if (key === 'v') { setActiveTool(t => t === 'cursor' ? null : 'cursor'); return }
        const tool = TOOL_KEYS[key]
        if (tool) { e.preventDefault(); setActiveTool(t => t === tool ? null : tool) }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [showDrawingTools, setActiveTool, onTfChange, replayMode, sessionBars?.length])

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
    if (!Number.isFinite(_p) || _p <= 0) return
    // Sanity bound vs last known close — protects against bad WS ticks during
    // reconnects / market-maker pulls that briefly emit nonsense quotes.
    const _last = lastBarRef.current?.close
    if (_last && _last > 0 && Math.abs(_p - _last) / _last > 0.5) return
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
  // Only on intraday timeframes 1/5/15/30 (60-min uses ET-anchor REST path until v1.1).
  // Keep this list in sync with backend ROLLUP_TFS (api/services/bar_broadcaster.py)
  // and the tf allow-list in api/routers/stream.py:stream_bars.
  // Coexists with the tick-driven useEffect above:
  //  - Tick logic drives sub-second flicker on the current developing candle
  //  - AM events deliver authoritative just-closed minute bars (1m chart) or
  //    server-rolled partial bucket bars (5/15/30m charts)
  //  - When an AM bar matches liveBarRef/lastBarRef.time, we sync them so the
  //    next tick iteration doesn't overwrite the authoritative values
  const realtimeTfEligible = ['1', '5', '15', '30'].includes(resolvedTf)

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
    // Sanity bound: if the last known price differs from this bar's close
    // by >50%, this is almost certainly bad data (penny stock split, bad
    // tick, etc). Skip to protect the chart's auto-scale from one bad bar
    // dominating the y-axis.
    const lastKnown = lastBarRef.current?.close
    if (lastKnown && lastKnown > 0 && Math.abs(c - lastKnown) / lastKnown > 0.5) {
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
        background: { type: ColorType.Solid, color: cs.background },
        textColor: cs.textColor,
        fontFamily: "'Instrument Sans', sans-serif",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: cs.grid.visible ? cs.grid.color : 'transparent' },
        horzLines: { color: cs.grid.visible ? cs.grid.color : 'transparent' },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: cs.crosshair.color, width: 1, style: cs.crosshair.style, labelBackgroundColor: cs.background },
        horzLine: { color: cs.crosshair.color, width: 1, style: cs.crosshair.style, labelBackgroundColor: cs.background },
      },
      rightPriceScale: {
        borderColor: cs.grid.color,
        scaleMargins: computePaneMargins(cs, showVolume && volData.length > 0).main,
      },
      timeScale: {
        borderColor: cs.grid.color,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        rightBarStaysOnScroll: true,
      },
      watermark: cs.watermark.visible && (watermark || sym) ? {
        visible: true,
        text: watermark ?? sym,
        color: `rgba(168,162,144,${cs.watermark.opacity})`,
        fontSize: 48,
        fontFamily: "'Instrument Sans', sans-serif",
        fontWeight: '700',
      } : { visible: false },
    }

    if (!chart) {
      chart = createChart(containerRef.current, { ...chartOpts, autoSize: true })
      chartRef.current = chart
    } else {
      chart.applyOptions(chartOpts)
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

    // ── Price lines — remove old, add new ──
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
          axisLabelVisible: true,
          title: pl.title || '',
        })
        priceLineRefs.current.push(ref)
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
            to: filteredBars.length + 8,
          })
        } else {
          chart.timeScale().setVisibleLogicalRange({
            from: 0,
            to: filteredBars.length + 8,
          })
        }
      }
    }
  }, [filteredBars, ohlcData, closeData, volData, overlayData, indicatorData, comparisonData, sym, showVolume, mergedMarkers, mergedPriceLines, watermark, cs, adjustTime, resolvedTf])

  // Effect: update chart when data or settings change (NO cleanup — chart persists)
  useEffect(() => {
    updateChart()
  }, [updateChart])

  // ── Crosshair legend: subscribe to hover events ──
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    // Remove previous subscriber
    if (crosshairSubRef.current) {
      try { chart.unsubscribeCrosshairMove(crosshairSubRef.current) } catch {}
    }

    const handler = (param) => {
      if (!param.point || !param.time) { setCrosshairData(null); return }

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
    }

    chart.subscribeCrosshairMove(handler)
    crosshairSubRef.current = handler

    return () => {
      try { chart.unsubscribeCrosshairMove(handler) } catch {}
    }
  }, [updateChart, resolvedOverlays, overlayData, indicatorData, comparisonData, livePrices, sym])

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
  }, [bars])

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

  // ── Render ──
  return (
    <div className={`${styles.wrapper} ${className}`} style={{ height }}>
      {loading && (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>Loading {sym} chart…</span>
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
        style={{ display: loading || error ? 'none' : 'block' }}
      />
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
            onScreenshot={handleScreenshot}
            tf={resolvedTf}
            compareSymbol={compareSymbol}
            onCompareChange={onCompareChange}
            replayMode={replayMode}
            replayPlaying={replayPlaying}
            replaySpeed={replaySpeed}
            replayDate={replayMode && filteredBars?.length ? filteredBars[filteredBars.length - 1]?.t : null}
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
            onReplaySpeedChange={setReplaySpeed}
          />
          {activeTool === 'position' && (
            <div style={{
              position: 'absolute', right: 8, top: 40, zIndex: 20,
              background: 'rgba(26,28,23,0.95)', border: '1px solid #3a3d2e',
              borderRadius: 6, padding: '10px 12px', width: 200,
              fontSize: 11, color: '#c8c4b0',
            }}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: '#e8e4d0' }}>Position Tool</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                {['long', 'short'].map(d => (
                  <button key={d} onClick={() => setPositionTool(p => ({ ...p, direction: d }))}
                    style={{
                      flex: 1, padding: '2px 0', fontSize: 10, cursor: 'pointer', borderRadius: 3,
                      background: positionTool.direction === d ? (d === 'long' ? '#1a4a2e' : '#4a1a1a') : 'transparent',
                      border: `1px solid ${d === 'long' ? '#4ade80' : '#f87171'}`,
                      color: d === 'long' ? '#4ade80' : '#f87171',
                    }}>
                    {d.toUpperCase()}
                  </button>
                ))}
              </div>
              {[['entry', '#60a5fa', 'Entry $'], ['stop', '#f87171', 'Stop $'], ['target', '#4ade80', 'Target $']].map(([field, color, label]) => (
                <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ color, minWidth: 40 }}>{label}</span>
                  <input type="number" step="0.01" value={positionTool[field]}
                    onChange={ev => setPositionTool(p => ({ ...p, [field]: ev.target.value }))}
                    style={{
                      flex: 1, background: '#2a2d1e', border: '1px solid #3a3d2e', borderRadius: 3,
                      color: '#e8e4d0', padding: '2px 4px', fontSize: 11, width: '100%',
                    }} />
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ minWidth: 40 }}>Risk $</span>
                <input type="number" value={positionTool.risk}
                  onChange={ev => setPositionTool(p => ({ ...p, risk: parseFloat(ev.target.value) || 200 }))}
                  style={{
                    flex: 1, background: '#2a2d1e', border: '1px solid #3a3d2e', borderRadius: 3,
                    color: '#e8e4d0', padding: '2px 4px', fontSize: 11, width: '100%',
                  }} />
              </div>
              {(() => {
                const e = parseFloat(positionTool.entry), s = parseFloat(positionTool.stop), t = parseFloat(positionTool.target), r = positionTool.risk
                const riskPerShare = Math.abs(e - s)
                const rewardPerShare = Math.abs(t - e)
                const shares = riskPerShare > 0 ? Math.floor(r / riskPerShare) : 0
                const rr = riskPerShare > 0 ? (rewardPerShare / riskPerShare).toFixed(2) : '—'
                const profit = shares * rewardPerShare
                if (!e || !s) return null
                return (
                  <div style={{ borderTop: '1px solid #3a3d2e', paddingTop: 8, lineHeight: 1.7 }}>
                    <div>R:R <span style={{ color: '#c9a84c', fontWeight: 600 }}>{rr}</span></div>
                    <div>Shares <span style={{ color: '#e8e4d0' }}>{shares.toLocaleString()}</span></div>
                    <div>Risk <span style={{ color: '#f87171' }}>${r.toFixed(0)}</span></div>
                    {t > 0 && <div>Profit <span style={{ color: '#4ade80' }}>${profit.toFixed(0)}</span></div>}
                  </div>
                )
              })()}
              <button onClick={() => setPositionTool({ entry: '', stop: '', target: '', risk: positionTool.risk, direction: positionTool.direction })}
                style={{ marginTop: 8, width: '100%', padding: '3px 0', fontSize: 10, cursor: 'pointer', background: 'transparent', border: '1px solid #3a3d2e', borderRadius: 3, color: '#706b5e' }}>
                Clear
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
