/**
 * TradeReplay — bar-by-bar playback of ONE closed trade (v1).
 *
 * DELIBERATELY its own tiny lightweight-charts instance inside a modal —
 * NEVER a mode of StockChart: that file's single-writer invariant governs
 * six developing-bar writers and a replay writer would be a seventh
 * (`singleWriterIndex.test.js` would go red BY NAME). This chart is created
 * on open, destroyed on close, touches no shared stream/cache state, and
 * reads bars from the SAME `/api/bars` rail every chart uses.
 *
 * Timeframe: 5-minute bars when the hold is short and recent enough for the
 * intraday window to cover it, else daily — stated in the header, never
 * silently substituted. Controls: play/pause · speed 1×/2×/4×/8× · scrubber.
 * Entry/exit markers appear only when playback REACHES them; the running
 * P&L reads from each bar's close (side-aware), realized at exit.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createChart, CandlestickSeries, createSeriesMarkers, LineStyle, ColorType,
} from 'lightweight-charts'
import { money, moneySigned } from '../../../../lib/journal-2-0'
import styles from './TradeReplay.module.css'

const SPEEDS = [1, 2, 4, 8]
const BASE_MS = 350          // per bar at 1×
const PAD_BEFORE = 20        // context bars before entry
const PAD_AFTER = 10

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

function tsOf(iso) {
  const t = Date.parse(iso || '')
  return Number.isFinite(t) ? Math.floor(t / 1000) : null
}

/** Bar time (ISO day string or unix seconds) → unix seconds for compares. */
function barTs(t) {
  if (typeof t === 'number') return t
  const p = Date.parse(`${t}T12:00:00Z`)
  return Number.isFinite(p) ? Math.floor(p / 1000) : 0
}

export default function TradeReplay({ trade, onClose }) {
  const entryTs = tsOf(trade.entryDate)
  const exitTs = tsOf(trade.exitDate)
  // 5m intraday history reaches ~55 trading days back on the bars rail;
  // outside that (or long holds) the honest tier is daily.
  const ageDays = entryTs ? (Date.now() / 1000 - entryTs) / 86400 : Infinity
  const tf = (trade.holdDays != null && trade.holdDays <= 5 && ageDays <= 55) ? '5' : 'D'

  const [bars, setBars] = useState(null)
  const [error, setError] = useState(null)
  const [idx, setIdx] = useState(0)          // bars revealed so far
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(2)

  const chartElRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const markersRef = useRef(null)
  const revealedRef = useRef(0)

  // Daily bars anchor at NOON UTC of their day, so timestamp compares must
  // be DAY-floored on the daily tier — an entry at 14:30Z otherwise lands
  // PAST its own day's bar and the entry marker slips a day late (the same
  // bug class the excursion engine's contract window hit).
  const dayFloor = (ts) => (ts == null ? ts : ts - (ts % 86400))
  const cmpTs = (ts) => (tf === 'D' ? dayFloor(ts) : ts)

  // ── Fetch + window the bars ─────────────────────────────────────────────
  useEffect(() => {
    let dead = false
    fetcher(`/api/bars/${encodeURIComponent(trade.symbol)}?tf=${tf}&bars=5000`)
      .then((d) => {
        if (dead) return
        const all = Array.isArray(d?.bars) ? d.bars : []
        const lo = cmpTs(entryTs ?? 0)
        const hi = (cmpTs(exitTs) ?? lo) + (tf === 'D' ? 86400 : 0)
        let start = all.findIndex((b) => barTs(b.t) >= lo)
        if (start < 0) start = all.length
        let end = all.length - 1
        for (let i = all.length - 1; i >= 0; i--) {
          if (barTs(all[i].t) <= hi) { end = i; break }
        }
        const w = all.slice(Math.max(0, start - PAD_BEFORE),
                            Math.min(all.length, end + 1 + PAD_AFTER))
        if (w.length < 3) setError('No bar history covers this trade’s window.')
        else setBars(w)
      })
      .catch(() => { if (!dead) setError('Couldn’t load bars.') })
    return () => { dead = true }
  }, [trade.symbol, tf, entryTs, exitTs])

  // Bar indexes where entry/exit land (first bar at-or-after each ts).
  const { entryIdx, exitIdx } = useMemo(() => {
    if (!bars) return { entryIdx: -1, exitIdx: -1 }
    const find = (ts) => {
      if (ts == null) return -1
      const t0 = cmpTs(ts)
      for (let i = 0; i < bars.length; i++) {
        if (barTs(bars[i].t) >= t0) return i
      }
      return bars.length - 1
    }
    return { entryIdx: find(entryTs), exitIdx: find(exitTs) }
  }, [bars, entryTs, exitTs])

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
    series.createPriceLine({
      price: trade.entryPrice, color: '#c9a84c', lineStyle: LineStyle.Dashed,
      lineWidth: 1, title: 'entry',
    })
    if (trade.exitPrice != null) {
      series.createPriceLine({
        price: trade.exitPrice, color: '#8a8a8a', lineStyle: LineStyle.Dashed,
        lineWidth: 1, title: 'exit',
      })
    }
    chartRef.current = chart
    seriesRef.current = series
    markersRef.current = createSeriesMarkers(series, [])
    // Fix the visible range to the WHOLE window up front so playback never
    // re-zooms under the user.
    const first = bars[0].t
    const last = bars[bars.length - 1].t
    series.setData(bars.map((b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c })))
    chart.timeScale().setVisibleRange({ from: first, to: last })
    series.setData([])           // then blank it — playback reveals from zero
    revealedRef.current = 0
    setIdx(0)
    setPlaying(true)
    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      markersRef.current = null
    }
  }, [bars, trade.entryPrice, trade.exitPrice])

  // ── Apply reveal state to the chart (append fast-path, setData on scrub) ─
  useEffect(() => {
    const series = seriesRef.current
    if (!series || !bars) return
    const toRow = (b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c })
    if (idx === revealedRef.current + 1) {
      series.update(toRow(bars[idx - 1]))
    } else {
      series.setData(bars.slice(0, idx).map(toRow))
    }
    revealedRef.current = idx
    const marks = []
    if (entryIdx >= 0 && idx > entryIdx) {
      marks.push({
        time: bars[entryIdx].t, position: 'belowBar', color: '#22c55e',
        shape: 'arrowUp', text: `${trade.side === 'Short' ? 'SHORT' : 'BUY'} ${money(trade.entryPrice)}`,
      })
    }
    if (exitIdx >= 0 && idx > exitIdx) {
      marks.push({
        time: bars[exitIdx].t, position: 'aboveBar', color: '#ef4444',
        shape: 'arrowDown', text: `EXIT ${money(trade.exitPrice)}`,
      })
    }
    markersRef.current?.setMarkers(marks)
  }, [idx, bars, entryIdx, exitIdx, trade])

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

  // Running P&L off the last revealed close, side-aware; realized past exit.
  const status = useMemo(() => {
    if (!bars || idx === 0) return { label: 'Waiting…', pnl: null, done: false }
    const last = bars[Math.min(idx, bars.length) - 1]
    if (entryIdx < 0 || idx <= entryIdx) return { label: 'Before entry', pnl: null, done: false }
    const sign = trade.side === 'Short' ? -1 : 1
    if (exitIdx >= 0 && idx > exitIdx) {
      const realized = sign * (trade.exitPrice - trade.entryPrice) * (trade.shares || 0)
      return { label: 'Closed', pnl: realized, done: true }
    }
    const open = sign * (last.c - trade.entryPrice) * (trade.shares || 0)
    return { label: 'In trade', pnl: open, done: false }
  }, [bars, idx, entryIdx, exitIdx, trade])

  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={`Replay — ${trade.symbol}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <h3 className={styles.title}>
            Replay · {trade.symbol}
            <span className={styles.tfNote}>{tf === '5' ? '5-minute bars' : 'daily bars'}</span>
          </h3>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close replay">✕</button>
        </div>

        {error && <p className={styles.err} role="alert">{error}</p>}
        {!error && !bars && <p className={styles.hint}>Loading bars…</p>}

        <div ref={chartElRef} className={styles.chart} />

        {bars && (
          <>
            <div className={styles.statusRow}>
              <span className={styles.statusLabel}>{status.label}</span>
              {status.pnl != null && (
                <span className={`${styles.pnl} ${status.pnl >= 0 ? styles.pos : styles.neg}`}>
                  {moneySigned(status.pnl)}{status.done ? ' realized' : ''}
                </span>
              )}
            </div>
            <div className={styles.controls}>
              <button
                type="button"
                className={styles.playBtn}
                onClick={() => {
                  if (idx >= bars.length) { setIdx(0); setPlaying(true) }
                  else setPlaying((p) => !p)
                }}
              >
                {idx >= bars.length ? '↻ Restart' : playing ? '❚❚ Pause' : '▶ Play'}
              </button>
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`${styles.speedBtn} ${speed === s ? styles.speedOn : ''}`}
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
