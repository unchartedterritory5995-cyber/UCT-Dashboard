// app/src/components/StockChart.jsx — TradingView Lightweight Charts v5 wrapper
import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import useSWR from 'swr'
import { createChart, CandlestickSeries, BarSeries, HistogramSeries, LineSeries, AreaSeries, ColorType } from 'lightweight-charts'
import usePreferences from '../hooks/usePreferences'
import { mergeChartSettings } from './chart/chartDefaults'
import useChartDrawings from './chart/useChartDrawings'
import ChartDrawingOverlay from './chart/ChartDrawingOverlay'
import ChartToolbar from './chart/ChartToolbar'
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

  // Prop overrides take precedence (e.g. Journal trade drawer passes showVolume=false)
  const showVolume = showVolumeProp !== undefined ? showVolumeProp : cs.volume.visible
  const resolvedOverlays = overlaysProp !== undefined
    ? overlaysProp
    : cs.overlays.filter(o => o.enabled)

  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const candleSeriesRef = useRef(null)

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

  // Build chart when data arrives or settings change
  const buildChart = useCallback(() => {
    if (!containerRef.current || !bars?.length) return

    // Destroy previous chart
    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
      candleSeriesRef.current = null
    }

    // ── Build chart options from settings ──
    const chartOptions = {
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
      },
      autoSize: true,
      watermark: cs.watermark.visible && (watermark || sym) ? {
        visible: true,
        text: watermark ?? sym,
        color: `rgba(168,162,144,${cs.watermark.opacity})`,
        fontSize: 48,
        fontFamily: "'IBM Plex Mono', monospace",
        fontWeight: '700',
      } : undefined,
    }

    const chart = createChart(containerRef.current, chartOptions)
    chartRef.current = chart

    // ── Price data series (pane 0) — based on chart type ──
    let priceSeries

    const ohlcData = bars.map(b => ({
      time: b.t, open: b.o, high: b.h, low: b.l, close: b.c,
    }))
    const closeData = bars.map(b => ({ time: b.t, value: b.c }))

    switch (cs.chartType) {
      case 'hollow': {
        priceSeries = chart.addSeries(CandlestickSeries, {
          upColor: 'transparent',
          downColor: cs.candles.downColor,
          borderUpColor: cs.candles.upColor,
          borderDownColor: cs.candles.downColor,
          wickUpColor: cs.candles.upWick,
          wickDownColor: cs.candles.downWick,
        })
        priceSeries.setData(ohlcData)
        break
      }
      case 'bars': {
        priceSeries = chart.addSeries(BarSeries, {
          upColor: cs.candles.upColor,
          downColor: cs.candles.downColor,
        })
        priceSeries.setData(ohlcData)
        break
      }
      case 'line': {
        priceSeries = chart.addSeries(LineSeries, {
          color: cs.candles.upColor,
          lineWidth: 2,
        })
        priceSeries.setData(closeData)
        break
      }
      case 'area': {
        priceSeries = chart.addSeries(AreaSeries, {
          lineColor: cs.candles.upColor,
          topColor: cs.candles.upColor + '66',
          bottomColor: cs.candles.upColor + '08',
          lineWidth: 2,
        })
        priceSeries.setData(closeData)
        break
      }
      default: { // 'candles'
        priceSeries = chart.addSeries(CandlestickSeries, {
          upColor: cs.candles.upColor,
          downColor: cs.candles.downColor,
          borderUpColor: cs.candles.upBorder,
          borderDownColor: cs.candles.downBorder,
          wickUpColor: cs.candles.upWick,
          wickDownColor: cs.candles.downWick,
        })
        priceSeries.setData(ohlcData)
        break
      }
    }
    candleSeriesRef.current = priceSeries

    // ── Volume series (pane 1) ──
    if (showVolume) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      }, 1)
      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.1, bottom: 0 },
      })

      // Pre-compute HVC set for gold volume bars
      const hvcSet = new Set()
      if (cs.volume.hvcEnabled && bars.length > 20) {
        const lb = Math.min(252, bars.length - 1)
        for (let i = Math.max(20, lb); i < bars.length; i++) {
          const start = Math.max(0, i - lb)
          const priorMax = Math.max(...bars.slice(start, i).map(b => b.v || 0))
          if (bars[i].v > priorMax) hvcSet.add(bars[i].t)
        }
      }

      const volData = bars.map(b => ({
        time: b.t,
        value: b.v,
        color: hvcSet.has(b.t)
          ? 'rgba(201,168,76,0.9)'
          : b.c >= b.o ? cs.volume.upColor : cs.volume.downColor,
      }))
      volumeSeries.setData(volData)

      try {
        const panes = chart.panes()
        if (panes.length > 1) panes[1].setHeight(80)
      } catch (_) {}
    }

    // ── Overlay lines (SMA/EMA on pane 0) ──
    if (resolvedOverlays?.length) {
      for (const ov of resolvedOverlays) {
        const computed = ov.type === 'EMA'
          ? computeEMA(bars, ov.period)
          : computeSMA(bars, ov.period)
        if (!computed.length) continue

        const lineSeries = chart.addSeries(LineSeries, {
          color: ov.color,
          lineWidth: 1,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false,
        })
        lineSeries.setData(computed)
      }
    }

    // ── Markers (BUY/SELL arrows) ──
    const allMarkers = [...(markers || [])]
      .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
    if (allMarkers.length && priceSeries) {
      import('lightweight-charts').then(({ createSeriesMarkers }) => {
        if (createSeriesMarkers) {
          createSeriesMarkers(priceSeries, allMarkers)
        }
      }).catch(() => {})
    }

    // ── Price lines (stop/target) ──
    if (priceLines?.length && priceSeries) {
      for (const pl of priceLines) {
        priceSeries.createPriceLine({
          price: pl.price,
          color: pl.color || cs.textColor,
          lineWidth: pl.lineWidth || 1,
          lineStyle: pl.lineStyle ?? 2,
          axisLabelVisible: true,
          title: pl.title || '',
        })
      }
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
  }, [bars, sym, resolvedTf, showVolume, resolvedOverlays, markers, priceLines, watermark, cs])

  // Effect: build chart when data or settings change
  useEffect(() => {
    buildChart()
    return () => {
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
        candleSeriesRef.current = null
      }
    }
  }, [buildChart])

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
