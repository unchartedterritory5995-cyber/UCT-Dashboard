// app/src/components/StockChart.jsx — TradingView Lightweight Charts v5 wrapper
import { useEffect, useRef, useCallback, useState } from 'react'
import useSWR from 'swr'
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, ColorType } from 'lightweight-charts'
import usePreferences from '../hooks/usePreferences'
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
  // Seed with SMA of first `period` bars
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

// ─── Chart theme (matches UCT design tokens) ────────────────────────────────

const CHART_OPTIONS = {
  layout: {
    background: { type: ColorType.Solid, color: '#1a1c17' },
    textColor: '#706b5e',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
  },
  grid: {
    vertLines: { color: 'rgba(46,49,39,0.25)' },
    horzLines: { color: 'rgba(46,49,39,0.25)' },
  },
  crosshair: {
    mode: 0, // Normal
    vertLine: { color: '#706b5e', width: 1, style: 3, labelBackgroundColor: '#22251e' },
    horzLine: { color: '#706b5e', width: 1, style: 3, labelBackgroundColor: '#22251e' },
  },
  rightPriceScale: { borderColor: '#2e3127' },
  timeScale: {
    borderColor: '#2e3127',
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 8,
  },
  autoSize: true,
}

const CANDLE_OPTIONS = {
  upColor: '#3cb868',
  downColor: '#e74c3c',
  borderUpColor: '#3cb868',
  borderDownColor: '#e74c3c',
  wickUpColor: '#3cb868',
  wickDownColor: '#e74c3c',
}

// ─── Default overlays ────────────────────────────────────────────────────────

const DEFAULT_OVERLAYS = [
  { type: 'EMA', period: 9,   color: '#4ade80' },  // bright green
  { type: 'EMA', period: 20,  color: '#f472b6' },  // pink
  { type: 'SMA', period: 50,  color: '#60a5fa' },  // blue
  { type: 'SMA', period: 200, color: '#fb923c' },  // orange
]

// ─── Component ───────────────────────────────────────────────────────────────

export default function StockChart({
  sym,
  tf,
  height = '100%',
  markers = null,
  priceLines = null,
  showVolume = true,
  overlays = DEFAULT_OVERLAYS,
  watermark = null,
  className = '',
  showDrawingTools = true,
}) {
  const { prefs } = usePreferences()
  // Use user's preferred default timeframe when caller doesn't pass an explicit tf
  const resolvedTf = tf || prefs.default_chart_tf || 'D'

  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const candleSeriesRef = useRef(null)

  // ── Drawing tools state ──
  const [activeTool, setActiveTool] = useState(null)
  const [drawColor, setDrawColor] = useState('#c9a84c')
  const [drawWidth, setDrawWidth] = useState(1)
  const [selectedId, setSelectedId] = useState(null)
  const { drawings, addDrawing, removeDrawing, clearAll } = useChartDrawings(sym)

  const { data, error, mutate } = useSWR(
    sym ? `/api/bars/${encodeURIComponent(sym)}?tf=${resolvedTf}&bars=${resolvedTf === 'D' ? 5000 : resolvedTf === 'W' ? 2000 : 300}` : null,
    fetcher,
    { dedupingInterval: 30000, revalidateOnFocus: false }
  )

  const bars = data?.bars
  const loading = !data && !error

  // Build chart when data arrives
  const buildChart = useCallback(() => {
    if (!containerRef.current || !bars?.length) return

    // Destroy previous chart
    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
      candleSeriesRef.current = null
    }

    const chart = createChart(containerRef.current, {
      ...CHART_OPTIONS,
      watermark: watermark || sym ? {
        visible: true,
        text: watermark ?? sym,
        color: 'rgba(168,162,144,0.07)',
        fontSize: 48,
        fontFamily: "'IBM Plex Mono', monospace",
        fontWeight: '700',
      } : undefined,
    })
    chartRef.current = chart

    // ── Candlestick series (pane 0) ──
    const candleSeries = chart.addSeries(CandlestickSeries, CANDLE_OPTIONS)
    candleSeriesRef.current = candleSeries

    const candleData = bars.map(b => ({
      time: b.t,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
    }))
    candleSeries.setData(candleData)

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
      if (bars.length > 20) {
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
          ? 'rgba(201,168,76,0.9)'  // Gold for HVC days
          : b.c >= b.o ? 'rgba(60,184,104,0.35)' : 'rgba(231,76,60,0.35)',
      }))
      volumeSeries.setData(volData)

      // Make volume pane shorter
      try {
        const panes = chart.panes()
        if (panes.length > 1) panes[1].setHeight(80)
      } catch (_) { /* pane API may vary */ }
    }

    // ── Overlay lines (SMA/EMA on pane 0) ──
    if (overlays?.length) {
      for (const ov of overlays) {
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
    if (allMarkers.length && candleSeries) {
      import('lightweight-charts').then(({ createSeriesMarkers }) => {
        if (createSeriesMarkers) {
          createSeriesMarkers(candleSeries, allMarkers)
        }
      }).catch(() => {})
    }

    // ── Price lines (stop/target) ──
    if (priceLines?.length && candleSeries) {
      for (const pl of priceLines) {
        candleSeries.createPriceLine({
          price: pl.price,
          color: pl.color || '#706b5e',
          lineWidth: pl.lineWidth || 1,
          lineStyle: pl.lineStyle ?? 2, // Dashed
          axisLabelVisible: true,
          title: pl.title || '',
        })
      }
    }

    // Zoom to last ~200 bars on load with right padding (full history still scrollable)
    if (bars.length > 200) {
      chart.timeScale().setVisibleLogicalRange({
        from: bars.length - 200,
        to: bars.length + 8,  // +8 bars of right padding
      })
    } else {
      chart.timeScale().setVisibleLogicalRange({
        from: 0,
        to: bars.length + 8,
      })
    }
  }, [bars, sym, resolvedTf, showVolume, overlays, markers, priceLines, watermark])

  // Effect: build chart when data changes
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
            selectedId={selectedId}
            setSelectedId={setSelectedId}
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
          />
        </>
      )}
    </div>
  )
}
