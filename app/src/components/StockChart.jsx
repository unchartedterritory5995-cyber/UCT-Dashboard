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

  const { data, error, mutate } = useSWR(
    sym ? `/api/bars/${encodeURIComponent(sym)}?tf=${resolvedTf}&bars=${resolvedTf === 'D' ? 5000 : resolvedTf === 'W' ? 2000 : 300}` : null,
    fetcher,
    { dedupingInterval: 30000, revalidateOnFocus: false }
  )

  const bars = data?.bars
  const loading = !data && !error

  // Real-time price streaming for live candle updates
  const { prices: livePrices } = useRealtimePrices(sym ? [sym] : [])

  // ── Memoized data transforms (only recompute when bars change) ─────────────

  const ohlcData = useMemo(
    () => bars ? bars.map(b => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c })) : [],
    [bars]
  )
  const closeData = useMemo(
    () => bars ? bars.map(b => ({ time: b.t, value: b.c })) : [],
    [bars]
  )
  const hvcSet = useMemo(
    () => cs.volume.hvcEnabled && bars?.length > 20 ? computeHVC(bars) : new Set(),
    [bars, cs.volume.hvcEnabled]
  )
  const volData = useMemo(() => {
    if (!bars?.length) return []
    return bars.map(b => ({
      time: b.t,
      value: b.v,
      color: hvcSet.has(b.t)
        ? 'rgba(201,168,76,0.9)'
        : b.c >= b.o ? cs.volume.upColor : cs.volume.downColor,
    }))
  }, [bars, hvcSet, cs.volume.upColor, cs.volume.downColor])
  const overlayData = useMemo(() => {
    if (!bars?.length || !resolvedOverlays?.length) return []
    return resolvedOverlays.map(ov => ({
      data: ov.type === 'EMA' ? computeEMA(bars, ov.period) : computeSMA(bars, ov.period),
      color: ov.color,
    }))
  }, [bars, resolvedOverlays])

  // Update the last candle in real-time as trades come in
  useEffect(() => {
    const liveData = livePrices[sym]
    if (!liveData?.price || !candleSeriesRef.current || !lastBarRef.current) return
    const price = liveData.price
    const last = lastBarRef.current

    // Update the last candle's close, and extend high/low if needed
    const updated = {
      time: last.time,
      open: last.open,
      high: Math.max(last.high, price),
      low: Math.min(last.low, price),
      close: price,
    }

    try {
      candleSeriesRef.current.update(updated)
      // Update volume too
      if (volumeSeriesRef.current && liveData.volume) {
        volumeSeriesRef.current.update({
          time: last.time,
          value: liveData.volume,
          color: price >= last.open ? 'rgba(74,222,128,0.35)' : 'rgba(248,113,113,0.35)',
        })
      }
      // Keep ref current
      lastBarRef.current = { ...updated, volume: liveData.volume || last.volume }
    } catch {}
  }, [livePrices, sym])

  // ── Chart update — reuses chart instance, swaps data via setData() ─────────
  const updateChart = useCallback(() => {
    if (!containerRef.current || !bars?.length) return

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
    if (bars.length) {
      const last = bars[bars.length - 1]
      lastBarRef.current = { time: last.t, open: last.o, high: last.h, low: last.l, close: last.c, volume: last.v || 0 }
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

    // Zoom to last ~200 bars
    if (bars.length > 200) {
      chart.timeScale().setVisibleLogicalRange({
        from: bars.length - 200,
        to: bars.length + 8,
      })
    } else {
      chart.timeScale().setVisibleLogicalRange({
        from: 0,
        to: bars.length + 8,
      })
    }
  }, [bars, ohlcData, closeData, volData, overlayData, sym, showVolume, markers, priceLines, watermark, cs])

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
        </>
      )}
    </div>
  )
}
