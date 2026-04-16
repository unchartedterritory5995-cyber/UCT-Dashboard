// app/src/components/StockChart.jsx — TradingView Lightweight Charts v5 wrapper
// Optimized: chart instance reuse, O(n) HVC, memoized data transforms
import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import useSWR from 'swr'
import { createChart, CandlestickSeries, BarSeries, HistogramSeries, LineSeries, AreaSeries, ColorType } from 'lightweight-charts'
import usePreferences from '../hooks/usePreferences'
import { mergeChartSettings } from './chart/chartDefaults'
import useChartDrawings from './chart/useChartDrawings'
import ChartDrawingOverlay from './chart/ChartDrawingOverlay'
import ChartToolbar from './chart/ChartToolbar'
import useRealtimePrices from '../hooks/useRealtimePrices'
import styles from './StockChart.module.css'

const fetcher = url => fetch(url).then(r => r.json())

// ─── Indicator computations ──────────────────────────────────────────────────

function computeSMA(bars, period) {
  const result = []
  for (let i = period - 1; i < bars.length; i++) {
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

const PERIOD_SECONDS = { '5': 300, '30': 1800, '60': 3600 }

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
  // Intraday: floor to period boundary in UTC, then offset to ET for display
  const period = PERIOD_SECONDS[tf] || 300
  return Math.floor(tickTimeSec / period) * period + _ET_OFFSET
}

// ─── Series type helpers ─────────────────────────────────────────────────────

const OHLC_TYPES = new Set(['candles', 'hollow', 'bars'])

function isOhlcType(chartType) {
  return !chartType || OHLC_TYPES.has(chartType)
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
}) {
  const { prefs, setPref } = usePreferences()
  const resolvedTf = tf || prefs.default_chart_tf || 'D'

  // ── Chart settings from user preferences ──
  const cs = useMemo(() => mergeChartSettings(prefs.chart_settings), [prefs.chart_settings])

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
  const priceLineRefs = useRef([])
  const lastBarRef = useRef(null)
  const prevChartTypeRef = useRef(null)
  const zoomKeyRef = useRef(null)  // Track sym+tf to only zoom on initial load, not refetches
  const latestLiveRef = useRef(null)  // Latest live price — used to re-apply after setData() wipes

  // ── Extended hours toggle (regular session only vs all hours) ──
  const [showExtended, setShowExtended] = useState(() => {
    try { return localStorage.getItem('uct-chart-extended') !== 'false' } catch { return true }
  })
  const handleToggleExtended = useCallback((val) => {
    setShowExtended(val)
    try { localStorage.setItem('uct-chart-extended', val ? 'true' : 'false') } catch {}
  }, [])

  // ── Drawing tools state ──
  const [activeTool, setActiveTool] = useState(null)
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
  const { drawings, addDrawing, removeDrawing, updateDrawing, clearAll } = useChartDrawings(sym)

  const barCount = 5000

  // Intraday refetches more often to keep candles current during market hours
  const isIntraday = ['5', '30', '60'].includes(resolvedTf)
  const dedupMs = isIntraday ? 15000 : 60000  // 15s intraday, 60s daily/weekly

  const { data, error, mutate } = useSWR(
    sym ? `/api/bars/${encodeURIComponent(sym)}?tf=${resolvedTf}&bars=${barCount}` : null,
    fetcher,
    { dedupingInterval: dedupMs, revalidateOnFocus: false }
  )

  const bars = data?.bars
  const loading = !data && !error

  // Real-time price streaming for live candle updates
  const { prices: livePrices } = useRealtimePrices(sym ? [sym] : [])

  // ── Memoized data transforms (only recompute when bars change) ─────────────

  // Offset intraday timestamps from UTC → ET so chart axis shows Eastern Time
  const adjustTime = useCallback(
    (t) => typeof t === 'number' ? t + _ET_OFFSET : t,
    []
  )

  // Filter bars to regular session only (9:30 AM - 4:00 PM ET) when extended hours hidden
  const filteredBars = useMemo(() => {
    if (!bars || !isIntraday || showExtended) return bars
    return bars.filter(b => {
      if (typeof b.t !== 'number') return true
      // Convert UTC timestamp to ET hour/minute
      const d = new Date(b.t * 1000)
      const etStr = d.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' })
      const [h, m] = etStr.split(':').map(Number)
      const mins = h * 60 + m
      return mins >= 570 && mins < 960 // 9:30 AM (570min) to 4:00 PM (960min) ET
    })
  }, [bars, isIntraday, showExtended])

  const ohlcData = useMemo(
    () => filteredBars ? filteredBars.map(b => ({ time: adjustTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })) : [],
    [filteredBars, adjustTime]
  )
  const closeData = useMemo(
    () => filteredBars ? filteredBars.map(b => ({ time: adjustTime(b.t), value: b.c })) : [],
    [filteredBars, adjustTime]
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

  // Reset lastBarRef on symbol change to prevent wrong-symbol price race
  useEffect(() => { lastBarRef.current = null }, [sym])

  // Real-time candle updates — tick-by-tick via WebSocket.
  // Detects bar period boundaries and creates NEW candles automatically.
  // Handles both OHLC types (candles/bars) and close-only types (line/area).
  useEffect(() => {
    const liveData = livePrices[sym]
    if (!liveData?.price) return
    latestLiveRef.current = { sym, price: liveData.price, updated_at: liveData.updated_at,
      day_open: liveData.day_open, day_high: liveData.day_high, day_low: liveData.day_low }
    if (!candleSeriesRef.current || !lastBarRef.current) return
    const price = liveData.price
    const last = lastBarRef.current
    const useOhlc = isOhlcType(cs.chartType)

    // Compute which bar period this tick belongs to
    const tickSec = liveData.updated_at || (Date.now() / 1000)
    const barTime = computeBarTime(resolvedTf, tickSec)

    // Detect new bar period (new candle should form)
    const isNewBar = barTime !== last.time && barTime > last.time

    try {
      if (isNewBar) {
        // ── NEW CANDLE: use actual session OHLC from REST data for proper candle ──
        const live = latestLiveRef.current || {}
        const openPrice = live.day_open || last.close
        const highPrice = Math.max(live.day_high || openPrice, price)
        const lowPrice = Math.min((live.day_low && live.day_low > 0) ? live.day_low : openPrice, price)
        if (useOhlc) {
          const newBar = { time: barTime, open: openPrice, high: highPrice, low: lowPrice, close: price }
          candleSeriesRef.current.update(newBar)
          lastBarRef.current = { ...newBar, volume: 0 }
        } else {
          candleSeriesRef.current.update({ time: barTime, value: price })
          lastBarRef.current = { time: barTime, open: openPrice, high: highPrice, low: lowPrice, close: price, volume: 0 }
        }
        if (volumeSeriesRef.current) {
          volumeSeriesRef.current.update({ time: barTime, value: 0, color: 'rgba(74,222,128,0.35)' })
        }
      } else {
        // ── SAME CANDLE: update close, extend high/low ──
        const updated = {
          time: last.time,
          open: last.open,
          high: Math.max(last.high, price),
          low: Math.min(last.low, price),
          close: price,
        }
        if (useOhlc) {
          candleSeriesRef.current.update(updated)
        } else {
          candleSeriesRef.current.update({ time: last.time, value: price })
        }
        if (volumeSeriesRef.current && liveData.volume) {
          volumeSeriesRef.current.update({
            time: last.time,
            value: liveData.volume,
            color: price >= last.open ? 'rgba(74,222,128,0.35)' : 'rgba(248,113,113,0.35)',
          })
        }
        lastBarRef.current = { ...updated, volume: liveData.volume || last.volume }
      }
    } catch {}
  }, [livePrices, sym, resolvedTf, cs.chartType])

  // ── Chart update — reuses chart instance, swaps data via setData() ─────────
  const updateChart = useCallback(() => {
    if (!containerRef.current || !filteredBars?.length) return

    let chart = chartRef.current

    // ── Create or update chart instance ──
    const chartOpts = {
      layout: {
        background: { type: ColorType.Solid, color: cs.background },
        textColor: cs.textColor,
        fontFamily: "'IBM Plex Mono', monospace",
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
      rightPriceScale: { borderColor: cs.grid.color },
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
        fontFamily: "'IBM Plex Mono', monospace",
        fontWeight: '700',
      } : { visible: false },
    }

    if (!chart) {
      chart = createChart(containerRef.current, { ...chartOpts, autoSize: true })
      chartRef.current = chart
    } else {
      chart.applyOptions(chartOpts)
    }

    // ── Price series — reuse if chart type unchanged, else swap ──
    if (prevChartTypeRef.current !== cs.chartType && candleSeriesRef.current) {
      try { chart.removeSeries(candleSeriesRef.current) } catch {}
      candleSeriesRef.current = null
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
      const tickSec = latestLiveRef.current.updated_at || (Date.now() / 1000)
      const barTime = computeBarTime(resolvedTf, tickSec)
      const last = lastBarRef.current
      const isNew = barTime !== last.time && barTime > last.time

      if (isNew) {
        // Today's developing candle — use actual session OHLC from REST data
        const live = latestLiveRef.current
        const openPrice = live.day_open || last.close
        const highPrice = Math.max(live.day_high || openPrice, lp)
        const lowPrice = Math.min((live.day_low && live.day_low > 0) ? live.day_low : openPrice, lp)
        const newBar = {
          time: barTime,
          open: openPrice,
          high: highPrice,
          low: lowPrice,
          close: lp,
        }
        if (isOhlcType(cs.chartType)) {
          candleSeriesRef.current.update(newBar)
        } else {
          candleSeriesRef.current.update({ time: barTime, value: lp })
        }
        lastBarRef.current = { ...newBar, volume: 0 }
      } else {
        // Same bar — update close/high/low
        last.high = Math.max(last.high, lp)
        last.low = Math.min(last.low, lp)
        last.close = lp
        if (isOhlcType(cs.chartType)) {
          candleSeriesRef.current.update({ time: last.time, open: last.open, high: last.high, low: last.low, close: lp })
        } else {
          candleSeriesRef.current.update({ time: last.time, value: lp })
        }
      }
    }

    // ── Volume series (pane 1) — reuse if exists ──
    if (showVolume && volData.length) {
      if (!volumeSeriesRef.current) {
        const vs = chart.addSeries(HistogramSeries, {
          priceFormat: { type: 'volume' },
          priceScaleId: '',
        }, 1)
        vs.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0 } })
        volumeSeriesRef.current = vs
      }
      volumeSeriesRef.current.setData(volData)
      try {
        const panes = chart.panes()
        if (panes.length > 1) panes[1].setHeight(80)
      } catch (_) {}
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
    // Update existing or add new overlay series
    for (let i = 0; i < overlayData.length; i++) {
      const { data: ovData, color } = overlayData[i]
      if (!ovData.length) continue
      if (i < overlaySeriesRefs.current.length) {
        // Reuse existing series
        overlaySeriesRefs.current[i].applyOptions({ color })
        overlaySeriesRefs.current[i].setData(ovData)
      } else {
        // Add new series
        const ls = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false,
        })
        ls.setData(ovData)
        overlaySeriesRefs.current.push(ls)
      }
    }

    // ── Price lines — remove old, add new ──
    for (const pl of priceLineRefs.current) {
      try { candleSeriesRef.current.removePriceLine(pl) } catch {}
    }
    priceLineRefs.current = []
    if (priceLines?.length && candleSeriesRef.current) {
      for (const pl of priceLines) {
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
    const allMarkers = [...(markers || [])]
      .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
    if (allMarkers.length && candleSeriesRef.current) {
      import('lightweight-charts').then(({ createSeriesMarkers }) => {
        if (createSeriesMarkers) {
          createSeriesMarkers(candleSeriesRef.current, allMarkers)
        }
      }).catch(() => {})
    }

    // Default zoom — only set on initial load or sym/tf change, NOT on SWR refetches
    // (prevents losing user's scroll/zoom position every 15 seconds)
    const zoomKey = `${sym}_${resolvedTf}`
    if (zoomKeyRef.current !== zoomKey) {
      zoomKeyRef.current = zoomKey
      const defaultVisible = {
        '5': 78,    // ~1 trading day of 5min bars
        '30': 65,   // ~5 trading days of 30min bars
        '60': 65,   // ~10 trading days of 1hr bars
        'D': 65,    // ~3 months of daily bars
        'W': 52,    // ~1 year of weekly bars
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
  }, [filteredBars, ohlcData, closeData, volData, overlayData, sym, showVolume, markers, priceLines, watermark, cs, adjustTime, resolvedTf])

  // Effect: update chart when data or settings change (NO cleanup — chart persists)
  useEffect(() => {
    updateChart()
  }, [updateChart])

  // Cleanup: destroy chart only on unmount
  useEffect(() => {
    return () => {
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
          />
          {isIntraday && (
            <button
              className={`${styles.extHoursBtn} ${showExtended ? styles.extHoursActive : ''}`}
              onClick={() => handleToggleExtended(!showExtended)}
              title={showExtended ? 'Hide extended hours (show regular session only)' : 'Show extended hours (pre-market + after-hours)'}
            >
              {showExtended ? 'EXT' : 'RTH'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
