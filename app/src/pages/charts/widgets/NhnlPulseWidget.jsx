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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import usePlacedTheme from '../../../hooks/usePlacedTheme'
import { menuThemeVars } from '../../../utils/dividerColor'
import UIcon from '../../../components/ui/UIcon'
import NhnlSettingsPanel from './NhnlSettingsPanel'
import { CHART_FONT_FAMILY } from '../../../utils/chartFont'
import { mergeNhnlSettings, nhnlDefaultsForTheme, nhnlWidgetStyleVars } from './nhnlSettings'
import chrome from './NewHighsLowsWidget.module.css'
import styles from './NhnlPulseWidget.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).catch(() => null)

const WINDOW_LABEL = { rth: 'LIVE', pre: 'PRE-MARKET', post: 'POST-MARKET', closed: 'CLOSED' }
const GREEN = '#34d17c'   // default new-high line (matches --ut-green-bright); overridden
const RED = '#f24b42'     // default new-low line — both follow the widget's Highs/Lows theme

function fmtClock(v) {
  try {
    return new Date(v).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
    })
  } catch { return '' }
}

function makeOption(series, green, red) {
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
  // A line series with a single "live tick" dot welded to its most recent point.
  const liveLine = (name, data, color, z) => ({
    name, type: 'line', data, z,
    smooth: 0.35, smoothMonotone: 'x',   // mild spline that still passes through the points
    showSymbol: true, symbol: 'circle',
    symbolSize: (_v, p) => (p.dataIndex === lastIdx ? 6 : 0),
    lineStyle: { color, width: 2 },
    itemStyle: { color, borderColor: '#0c0c0f', borderWidth: 1.5 },   // no glow
  })
  return {
    // No update animation: the line + its live dot update together each tick (dot
    // never lags the line, and there's no glide delay — as real-time as the feed).
    animation: true,
    animationDuration: 500,
    animationDurationUpdate: 0,
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
      liveLine('New Highs', highs, green, 3),
      liveLine('New Lows', lows, red, 2),
    ],
  }
}

export default function NhnlPulseWidget({ opts, onOptsChange }) {
  const placedTheme = usePlacedTheme(opts?.placedTheme)
  const settings = useMemo(() => mergeNhnlSettings(opts?.settings || null), [opts?.settings])
  const styleVars = useMemo(() => nhnlWidgetStyleVars(settings), [settings])
  // Chart lines follow the widget's Highs/Lows theme colors (fall back to the defaults).
  const green = settings.upColor || GREEN
  const red = settings.downColor || RED

  const rootRef = useRef(null)
  const gearRef = useRef(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const patchSettings = useCallback(
    (p) => onOptsChange?.({ ...opts, settings: { ...settings, ...p } }),
    [opts, onOptsChange, settings])
  const resetSettings = useCallback(
    () => onOptsChange?.({ ...opts, settings: nhnlDefaultsForTheme(placedTheme) }),
    [opts, onOptsChange, placedTheme])
  const panelThemeVars = useMemo(
    () => (styleVars['--nh-bg'] ? menuThemeVars(settings.bgMode === 'gradient' ? settings.bgGradient?.top : settings.bg) : null) || null,
    [styleVars, settings])

  const { data } = useMobileSWR('/api/nhnl/series', fetcher, {
    refreshInterval: 2000,       // pull new points as fast as the accumulator produces them
    dedupingInterval: 1500,
    marketHoursOnly: true,
    revalidateOnFocus: false,
  })

  const window = data?.window || 'rth'
  const isActive = window !== 'closed'
  const stamp = WINDOW_LABEL[window] || ''
  const series = data?.series || []
  const option = useMemo(() => makeOption(series, green, red), [series, green, red])

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
    <div ref={rootRef} className={chrome.wrap} style={styleVars}>
      {settingsOpen && (
        <NhnlSettingsPanel
          settings={settings}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          gearEl={gearRef.current}
          hostEl={rootRef.current}
          themeVars={panelThemeVars}
        />
      )}
      <div className={chrome.toolbar}>
        <span className={`${chrome.live} ${isActive ? chrome.liveOn : ''}`}>
          <span className={chrome.dot} aria-hidden="true" />{stamp}
        </span>
        {data?.asof && <span className={chrome.asof}>{fmtClock(data.asof)} ET</span>}
        <span className={chrome.spacer} />
        <button
          ref={gearRef}
          type="button"
          className={`${chrome.gear} ${settingsOpen ? chrome.gearOn : ''}`}
          onClick={() => setSettingsOpen(o => !o)}
          title="H/L Pulse settings"
          aria-label="H/L Pulse settings"
        >
          <UIcon name="gear" size={13} gold={false} />
        </button>
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
            <span className={`${styles.stat} ${styles.statHigh}`}>New Highs <b>{curHi}</b></span>
            <span className={`${styles.stat} ${styles.statLow}`}>New Lows <b>{curLo}</b></span>
            <span className={styles.stat}>Net <b>{net >= 0 ? '+' : ''}{net}</b></span>
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
