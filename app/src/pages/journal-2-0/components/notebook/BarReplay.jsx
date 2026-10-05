/**
 * BarReplay — bar-by-bar playback of ONE symbol's bars, in its own tiny chart (wave 13 lane
 * 13H-2, generalised from TradeReplay.jsx, which is now a thin caller of this file).
 *
 * ⛔ DELIBERATELY ITS OWN lightweight-charts INSTANCE inside a modal — NEVER a mode of
 * StockChart: that file's single-writer invariant governs six developing-bar writers and a
 * replay writer would be a seventh (`singleWriterIndex.test.js` would go red BY NAME). This
 * chart is created on open, destroyed on close, touches no shared stream/cache state, and reads
 * bars from the SAME `/api/bars` rail every chart uses. There is ONE replay engine; the two
 * callers differ only in WHAT they window and WHAT they mark:
 *
 *   * TradeReplay — a closed trade: window around entry..exit, entry/exit markers, running P&L.
 *   * The note chart's "what happened next" (ChartPlanPanel) — the window starts at the note's
 *     as-of, the bars up to it are already revealed, and the member steps FORWARD into what
 *     printed after, with the note's drawn plan levels as price lines.
 *
 * Props (all data, no fetch of their own beyond the bars):
 *   symbol, tf, title, tfNote          what is replayed, and the tier stated honestly
 *   windowBars(all) -> {bars, startIdx} | {error}
 *                                      cut the bar list; startIdx = bars revealed on open
 *   priceLines [{price, color, title}] fixed horizontal lines (entry/exit, plan levels)
 *   markersAt(idx, bars) -> markers    what to mark once playback has revealed `idx` bars
 *   statusAt(idx, bars) -> {label, value, tone}   the status row (tone: 'pos' | 'neg' | null)
 *   autoplay                           start playing on open (TradeReplay) or wait (a note)
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createChart, CandlestickSeries, createSeriesMarkers, LineStyle, ColorType,
} from 'lightweight-charts'
import styles from './BarReplay.module.css'

export const SPEEDS = [1, 2, 4, 8]
const BASE_MS = 350          // per bar at 1×

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

/** Bar time (ISO day string or unix seconds) → unix seconds for compares. Daily bars anchor at
 *  NOON UTC of their day. */
export function barTs(t) {
  if (typeof t === 'number') return t
  const p = Date.parse(`${t}T12:00:00Z`)
  return Number.isFinite(p) ? Math.floor(p / 1000) : 0
}

const toRow = (b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c })

export default function BarReplay({
  symbol, tf, title, tfNote, windowBars, priceLines = [], markersAt = null, statusAt = null,
  autoplay = true, onClose,
}) {
  const [bars, setBars] = useState(null)
  const [startIdx, setStartIdx] = useState(0)
  const [error, setError] = useState(null)
  const [idx, setIdx] = useState(0)          // bars revealed so far
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(2)

  const chartElRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const markersRef = useRef(null)
  const revealedRef = useRef(0)
  // The window function is the caller's; read it through a ref so a caller passing a fresh
  // closure each render does not refetch.
  const windowRef = useRef(windowBars)
  windowRef.current = windowBars
  const linesKey = JSON.stringify(priceLines || [])

  // ── Fetch + window the bars ─────────────────────────────────────────────
  useEffect(() => {
    let dead = false
    fetcher(`/api/bars/${encodeURIComponent(symbol)}?tf=${tf}&bars=5000`)
      .then((d) => {
        if (dead) return
        const all = Array.isArray(d?.bars) ? d.bars : []
        const w = windowRef.current ? windowRef.current(all) : { bars: all, startIdx: 0 }
        if (w?.error) { setError(w.error); return }
        setStartIdx(Math.max(0, Math.min(w.startIdx || 0, w.bars.length)))
        setBars(w.bars)
      })
      .catch(() => { if (!dead) setError('Couldn’t load bars.') })
    return () => { dead = true }
  }, [symbol, tf])

  // ── Chart lifecycle (create on bars-ready, destroy on close) ────────────
  useEffect(() => {
    if (!bars || !chartElRef.current) return undefined
    const chart = createChart(chartElRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0b0b0d' },
        textColor: '#8a8a8a', fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      timeScale: { borderColor: '#2a2a2e', rightOffset: 4 },
      rightPriceScale: { borderColor: '#2a2a2e' },
      height: 320,
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      borderVisible: false,
    })
    chartRef.current = chart
    seriesRef.current = series
    markersRef.current = createSeriesMarkers(series, [])
    // Fix the visible range to the WHOLE window up front so playback never re-zooms under
    // the member.
    series.setData(bars.map(toRow))
    chart.timeScale().setVisibleRange({ from: bars[0].t, to: bars[bars.length - 1].t })
    series.setData([])           // then blank it — playback reveals from the start index
    revealedRef.current = 0
    setIdx(startIdx)
    setPlaying(!!autoplay)
    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      markersRef.current = null
    }
  }, [bars, startIdx, autoplay])

  // ── Price lines, applied IN PLACE: a caller's levels can arrive after the bars (a note's
  // plan is read by the server), and recreating the chart for them would throw away the
  // member's replay position. ─────────────────────────────────────────────────────────────
  const priceLineRefs = useRef([])
  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    for (const pl of priceLineRefs.current) series.removePriceLine?.(pl)
    priceLineRefs.current = []
    for (const line of JSON.parse(linesKey)) {
      if (!Number.isFinite(line?.price)) continue
      priceLineRefs.current.push(series.createPriceLine({
        price: line.price, color: line.color || '#c9a84c', lineStyle: LineStyle.Dashed,
        lineWidth: 1, title: line.title || '',
      }))
    }
  }, [linesKey, bars])

  // ── Apply reveal state to the chart (append fast-path, setData on scrub) ─
  useEffect(() => {
    const series = seriesRef.current
    if (!series || !bars) return
    if (idx === revealedRef.current + 1) {
      series.update(toRow(bars[idx - 1]))
    } else if (idx !== revealedRef.current) {
      series.setData(bars.slice(0, idx).map(toRow))
    }
    revealedRef.current = idx
  }, [idx, bars])

  useEffect(() => {
    if (!markersRef.current || !bars) return
    markersRef.current.setMarkers(markersAt ? markersAt(idx, bars) : [])
  }, [idx, bars, markersAt])

  // ── Playback clock ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing || !bars) return undefined
    const h = setInterval(() => {
      setIdx((i) => {
        if (i >= bars.length) { setPlaying(false); return i }
        return i + 1
      })
    }, BASE_MS / speed)
    return () => clearInterval(h)
  }, [playing, speed, bars])

  const status = useMemo(
    () => (bars && statusAt ? statusAt(idx, bars) : null),
    [bars, idx, statusAt],
  )

  const atEnd = !!bars && idx >= bars.length
  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <h3 className={styles.title}>
            {title}
            {tfNote && <span className={styles.tfNote}>{tfNote}</span>}
          </h3>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close replay">✕</button>
        </div>

        {error && <p className={styles.err} role="alert">{error}</p>}
        {!error && !bars && <p className={styles.hint}>Loading bars…</p>}

        <div ref={chartElRef} className={styles.chart} />

        {bars && (
          <>
            {status && (
              <div className={styles.statusRow} aria-live="polite">
                <span className={styles.statusLabel}>{status.label}</span>
                {status.value != null && (
                  <span className={`${styles.pnl} ${status.tone === 'pos' ? styles.pos : status.tone === 'neg' ? styles.neg : ''}`}>
                    {status.value}
                  </span>
                )}
              </div>
            )}
            <div className={styles.controls} data-tour="chart-replay-controls">
              <button
                type="button"
                className={styles.playBtn}
                onClick={() => {
                  if (atEnd) { setIdx(startIdx); setPlaying(true) } else setPlaying((p) => !p)
                }}
              >
                {atEnd ? '↻ Restart' : playing ? '❚❚ Pause' : '▶ Play'}
              </button>
              <button
                type="button"
                className={styles.stepBtn}
                disabled={atEnd}
                onClick={() => { setPlaying(false); setIdx((i) => Math.min(bars.length, i + 1)) }}
                aria-label="Step forward one bar"
              >
                Step ▸
              </button>
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`${styles.speedBtn} ${speed === s ? styles.speedOn : ''}`}
                  aria-pressed={speed === s}
                  aria-label={`Speed ${s}×`}
                  onClick={() => setSpeed(s)}
                >
                  {s}×
                </button>
              ))}
              <input
                type="range"
                className={styles.scrub}
                min={0}
                max={bars.length}
                value={idx}
                onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)) }}
                aria-label="Replay position"
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
