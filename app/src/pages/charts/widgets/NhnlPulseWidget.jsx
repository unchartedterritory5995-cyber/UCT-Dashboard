/**
 * H/L Pulse — a live line chart of New Highs vs New Lows through the trading day,
 * the temporal companion to the "New Highs / Lows" scanner. Two lines (green =
 * new-high activity, red = new-low activity) sampled every ~15s, plus a left
 * bull/bear ratio bar (share of distinct names at a new high vs new low today).
 *
 * Same UCT skin as the scanner: it reuses the scanner's chrome (card / toolbar /
 * LIVE stamp) and the same per-widget theme settings, so the two line up side by
 * side and follow "Apply to: All widgets" chart themes together.
 *
 * Data: GET /api/nhnl/series (the nhnl_live accumulator's intraday time series).
 */
import { useEffect, useMemo, useRef } from 'react'
import ReactECharts from 'echarts-for-react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import { CHART_FONT_FAMILY } from '../../../utils/chartFont'
import { mergeNhnlSettings, nhnlWidgetStyleVars } from './nhnlSettings'
import chrome from './NewHighsLowsWidget.module.css'
import styles from './NhnlPulseWidget.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).catch(() => null)

const WINDOW_LABEL = { rth: 'LIVE', pre: 'PRE-MARKET', post: 'POST-MARKET', closed: 'CLOSED' }
const GREEN = '#34d17c'   // matches --ut-green-bright (the scanner's new-high green)
const RED = '#f24b42'     // matches --ut-red-bright

function fmtClock(v) {
  try {
    return new Date(v).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
    })
  } catch { return '' }
}

function makeOption(series) {
  const highs = series.map(p => [new Date(p.t).getTime(), p.hi])
  const lows = series.map(p => [new Date(p.t).getTime(), p.lo])
  const axisText = { color: '#a9a9b2', fontSize: 10, fontFamily: CHART_FONT_FAMILY }
  const lastIdx = series.length - 1
  // Reserve a little whitespace to the right of the live point so its glowing dot
  // sits just inside the border instead of being clipped at the edge.
  const times = highs.map(p => p[0])
  const lastT = times.length ? times[times.length - 1] : undefined
  const span = times.length ? (lastT - times[0]) : 0
  const xMax = lastT ? lastT + Math.max(span * 0.04, 25000) : undefined
  // A line series with a single glowing "live tick" dot at its most recent point.
  const liveLine = (name, data, color, glow, z) => ({
    name, type: 'line', data, smooth: true, z,
    showSymbol: true, symbol: 'circle',
    symbolSize: (_v, p) => (p.dataIndex === lastIdx ? 7 : 0),
    lineStyle: { color, width: 2 },
    itemStyle: { color, borderColor: '#0c0c0f', borderWidth: 1.5, shadowBlur: 16, shadowColor: glow },
  })
  return {
    // Glide on update: each new point eases in over ~1.5s (linear) instead of
    // snapping — smooth, but short enough that it stays close to real time.
    animation: true,
    animationDuration: 500,
    animationDurationUpdate: 1500,
    animationEasing: 'cubicOut',
    animationEasingUpdate: 'linear',
    grid: { left: 6, right: 18, top: 24, bottom: 22, containLabel: true },
    legend: {
      data: ['New Highs', 'New Lows'],
      right: 6, top: 2, itemWidth: 16, itemHeight: 8, itemGap: 14,
      textStyle: { color: '#ededf2', fontSize: 11, fontWeight: 600, fontFamily: CHART_FONT_FAMILY },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(18,18,22,0.96)',
      borderColor: 'rgba(255,255,255,0.12)',
      textStyle: { color: '#f2f2f5', fontSize: 11.5, fontFamily: CHART_FONT_FAMILY },
      axisPointer: { type: 'line', lineStyle: { color: 'rgba(255,255,255,0.28)' } },
      valueFormatter: (v) => (Math.round(v * 10) / 10).toFixed(1),
    },
    xAxis: {
      type: 'time', max: xMax,
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.18)' } },
      axisTick: { show: false },
      axisLabel: { ...axisText, hideOverlap: true, formatter: fmtClock },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value', min: 0,
      name: 'alerts / sec', nameGap: 8, nameLocation: 'end',
      nameTextStyle: { color: '#c7c7cf', fontSize: 10, fontFamily: CHART_FONT_FAMILY, align: 'left' },
      axisLabel: axisText,
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.07)' } },
    },
    series: [
      liveLine('New Highs', highs, GREEN, 'rgba(52,209,124,0.95)', 3),
      liveLine('New Lows', lows, RED, 'rgba(242,75,66,0.95)', 2),
    ],
  }
}

export default function NhnlPulseWidget({ opts }) {
  const settings = useMemo(() => mergeNhnlSettings(opts?.settings || null), [opts?.settings])
  const styleVars = useMemo(() => nhnlWidgetStyleVars(settings), [settings])

  const { data } = useMobileSWR('/api/nhnl/series', fetcher, {
    refreshInterval: 3000,       // pull new ~5s points promptly; the chart glides between
    dedupingInterval: 2000,
    marketHoursOnly: true,
    revalidateOnFocus: false,
  })

  const window = data?.window || 'rth'
  const isActive = window !== 'closed'
  const stamp = WINDOW_LABEL[window] || ''
  const series = data?.series || []
  const option = useMemo(() => makeOption(series), [series])

  // Live readout (alerts/sec): average the last few points so the numbers don't jitter.
  const round1 = (n) => Math.round(n * 10) / 10
  const recent = series.slice(-4)
  const avg = (k) => (recent.length ? recent.reduce((s, p) => s + (p[k] || 0), 0) / recent.length : 0)
  const curHi = round1(avg('hi'))
  const curLo = round1(avg('lo'))
  const net = round1(curHi - curLo)
  const tot = curHi + curLo
  const pctHi = tot ? Math.round((curHi / tot) * 100) : 50
  const pctLo = 100 - pctHi
  const peakHi = round1(series.reduce((m, p) => Math.max(m, p.hi || 0), 0))
  const peakLo = round1(series.reduce((m, p) => Math.max(m, p.lo || 0), 0))

  // RGL resizes the container without a window resize event, so drive echarts' resize
  // off a ResizeObserver on the chart wrapper.
  const chartRef = useRef(null)
  const wrapRef = useRef(null)
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => {
      try { chartRef.current?.getEchartsInstance?.().resize() } catch { /* not ready */ }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className={chrome.wrap} style={styleVars}>
      <div className={chrome.toolbar}>
        <span className={`${chrome.live} ${isActive ? chrome.liveOn : ''}`}>
          <span className={chrome.dot} aria-hidden="true" />{stamp}
        </span>
        {data?.asof && <span className={chrome.asof}>{fmtClock(data.asof)} ET</span>}
        <span className={chrome.spacer} />
      </div>

      {!isActive ? (
        <div className={chrome.empty}>
          <div className={chrome.emptyTitle}>Market closed</div>
          <div className={chrome.emptySub}>
            The H/L Pulse tracks new-high vs new-low activity 4:00 AM – 8:00 PM ET.
          </div>
        </div>
      ) : (
        <>
          {/* Breadth readout: live count chips + a horizontal tilt meter (our take on
              the ratio, not a vertical rail). */}
          <div className={styles.statStrip}>
            <span className={`${styles.stat} ${styles.statHigh}`}>
              <i aria-hidden="true" />New Highs <b>{curHi}</b>
            </span>
            <span className={`${styles.stat} ${styles.statLow}`}>
              <i aria-hidden="true" />New Lows <b>{curLo}</b>
            </span>
            <span className={`${styles.stat} ${net >= 0 ? styles.statHigh : styles.statLow}`}>
              Net <b>{net >= 0 ? '+' : ''}{net}</b>
            </span>
            <span className={styles.spacer} />
            <span className={styles.peak} title="Session peak — highs / lows">
              peak {peakHi} / {peakLo}
            </span>
          </div>
          <div className={styles.tiltBar} title={`${pctHi}% new highs · ${pctLo}% new lows (now)`}>
            <div className={styles.tiltHigh} style={{ width: `${pctHi}%` }} />
            <div className={styles.tiltLow} style={{ width: `${pctLo}%` }} />
            <div className={styles.tiltCenter} aria-hidden="true" />
          </div>
          <div ref={wrapRef} className={styles.chartWrap}>
            <ReactECharts ref={chartRef} option={option} notMerge={false} lazyUpdate
              style={{ height: '100%', width: '100%' }} />
          </div>
        </>
      )}
    </div>
  )
}
