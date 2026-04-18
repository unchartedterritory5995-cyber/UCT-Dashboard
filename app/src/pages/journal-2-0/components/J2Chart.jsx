/**
 * Lightweight-charts wrapper for Journal 2.0.
 * Spec §8.2 — right-click a bar → context menu → Add to Portfolio.
 *
 * Kept minimal and Journal-2.0-scoped (per Phase 0 audit): no coupling
 * to the existing StockChart, no cross-page reuse. Fetches from
 * /api/bars/{ticker}. On right-click, fires `onBarContextMenu(event)`
 * with {symbol, price, date, clientX, clientY} — the parent renders
 * the ChartContextMenu and handles the selection.
 */

import { useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries, HistogramSeries } from 'lightweight-charts'
import styles from './J2Chart.module.css'

const TIMEFRAMES = [
  { key: 'D', label: '1D' },
  { key: 'W', label: '1W' },
  { key: '60', label: '1H' },
  { key: '30', label: '30m' },
  { key: '15', label: '15m' },
]

export default function J2Chart({ symbol, onBarContextMenu }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const candleSeriesRef = useRef(null)
  const volumeSeriesRef = useRef(null)
  const barsRef = useRef([])
  const [tf, setTf] = useState('D')
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  // Build the chart once on mount
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#0d0f13' },
        textColor: '#c2c6cf',
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: '#1b1e25' },
        horzLines: { color: '#1b1e25' },
      },
      rightPriceScale: { borderColor: '#242730' },
      timeScale: {
        borderColor: '#242730',
        timeVisible: true,
      },
      crosshair: { mode: 0 },
      autoSize: true,
    })
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      borderVisible: false,
    })
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#3b82f6',
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    })
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    })

    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    volumeSeriesRef.current = volumeSeries

    return () => chart.remove()
  }, [])

  // Fetch bars when symbol or timeframe changes
  useEffect(() => {
    if (!symbol) return
    let cancelled = false
    setLoading(true)
    setErrorMsg('')
    fetch(`/api/bars/${encodeURIComponent(symbol)}?tf=${tf}&bars=400`, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`)
        return r.json()
      })
      .then((data) => {
        if (cancelled) return
        const bars = (data.bars || []).map((b) => ({
          time: Number(b.t),
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          volume: b.v,
        }))
        barsRef.current = bars
        candleSeriesRef.current?.setData(bars)
        volumeSeriesRef.current?.setData(
          bars.map((b) => ({
            time: b.time,
            value: b.volume || 0,
            color: b.close >= b.open ? 'rgba(34, 197, 94, 0.35)' : 'rgba(239, 68, 68, 0.35)',
          })),
        )
        chartRef.current?.timeScale().fitContent()
      })
      .catch((e) => {
        if (!cancelled) setErrorMsg(String(e?.message || e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [symbol, tf])

  // Right-click handler — map client coords to a bar, fire callback.
  useEffect(() => {
    const el = containerRef.current
    if (!el || !onBarContextMenu) return
    const handler = (e) => {
      e.preventDefault()
      const chart = chartRef.current
      const candle = candleSeriesRef.current
      if (!chart || !candle) return
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const timeAtX = chart.timeScale().coordinateToTime(x)
      if (timeAtX == null) return
      // Find the nearest bar (lightweight-charts returns a time; match by t)
      const bars = barsRef.current
      let closest = null
      let minDelta = Infinity
      for (const b of bars) {
        const d = Math.abs(Number(b.time) - Number(timeAtX))
        if (d < minDelta) {
          minDelta = d
          closest = b
        }
      }
      if (!closest) return
      const d = new Date(Number(closest.time) * 1000)
      const iso = d.toISOString().slice(0, 10)
      onBarContextMenu({
        symbol,
        price: closest.close,
        date: iso,
        clientX: e.clientX,
        clientY: e.clientY,
      })
    }
    el.addEventListener('contextmenu', handler)
    return () => el.removeEventListener('contextmenu', handler)
  }, [onBarContextMenu, symbol])

  const resetView = () => chartRef.current?.timeScale().fitContent()

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <div className={styles.tfRow}>
          {TIMEFRAMES.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`${styles.tfBtn} ${tf === opt.key ? styles.tfBtnActive : ''}`}
              onClick={() => setTf(opt.key)}
              aria-pressed={tf === opt.key}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className={styles.hint}>Right-click a bar to add a position</div>
      </div>
      <div ref={containerRef} className={styles.chart}>
        {loading && <div className={styles.overlay}>Loading {symbol}…</div>}
        {errorMsg && (
          <div className={styles.overlayError}>Failed to load {symbol}: {errorMsg}</div>
        )}
      </div>
    </div>
  )
}
