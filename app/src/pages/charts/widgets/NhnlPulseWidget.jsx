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
  const axisText = { color: '#8a8a90', fontSize: 9.5, fontFamily: CHART_FONT_FAMILY }
  return {
    animation: false,
    grid: { left: 6, right: 12, top: 24, bottom: 22, containLabel: true },
    legend: {
      data: ['New Highs', 'New Lows'],
      right: 6, top: 2, itemWidth: 16, itemHeight: 8, itemGap: 14,
      textStyle: { color: '#b7b7bd', fontSize: 10, fontFamily: CHART_FONT_FAMILY },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(18,18,22,0.96)',
      borderColor: 'rgba(255,255,255,0.12)',
      textStyle: { color: '#e9e9ee', fontSize: 11, fontFamily: CHART_FONT_FAMILY },
      axisPointer: { type: 'line', lineStyle: { color: 'rgba(255,255,255,0.22)' } },
      valueFormatter: (v) => Math.round(v),
    },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: 'rgba(255,255,255,0.14)' } },
      axisTick: { show: false },
      axisLabel: { ...axisText, hideOverlap: true, formatter: fmtClock },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value', min: 0,
      name: 'names at new H/L', nameGap: 8, nameLocation: 'end',
      nameTextStyle: { ...axisText, align: 'left' },
      axisLabel: axisText,
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
    },
    series: [
      { name: 'New Highs', type: 'line', data: highs, showSymbol: false, smooth: true,
        lineStyle: { color: GREEN, width: 2 }, itemStyle: { color: GREEN }, z: 3 },
      { name: 'New Lows', type: 'line', data: lows, showSymbol: false, smooth: true,
        lineStyle: { color: RED, width: 2 }, itemStyle: { color: RED }, z: 2 },
    ],
  }
}

export default function NhnlPulseWidget({ opts }) {
  const settings = useMemo(() => mergeNhnlSettings(opts?.settings || null), [opts?.settings])
  const styleVars = useMemo(() => nhnlWidgetStyleVars(settings), [settings])

  const { data } = useMobileSWR('/api/nhnl/series', fetcher, {
    refreshInterval: 5000,       // the chart doesn't need the scanner's 2s cadence
    dedupingInterval: 3000,
    marketHoursOnly: true,
    revalidateOnFocus: false,
  })

  const window = data?.window || 'rth'
  const isActive = window !== 'closed'
  const stamp = WINDOW_LABEL[window] || ''
  const series = data?.series || []
  const option = useMemo(() => makeOption(series), [series])

  // Live readout: average the last ~4 points (~1 min) so the numbers don't jitter.
  const recent = series.slice(-4)
  const curHi = recent.length ? Math.round(recent.reduce((s, p) => s + (p.hi || 0), 0) / recent.length) : 0
  const curLo = recent.length ? Math.round(recent.reduce((s, p) => s + (p.lo || 0), 0) / recent.length) : 0
  const net = curHi - curLo
  const tot = curHi + curLo
  const pctHi = tot ? Math.round((curHi / tot) * 100) : 50
  const pctLo = 100 - pctHi
  const peakHi = series.reduce((m, p) => Math.max(m, p.hi || 0), 0)
  const peakLo = series.reduce((m, p) => Math.max(m, p.lo || 0), 0)

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
