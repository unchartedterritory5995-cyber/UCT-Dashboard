import { useState, useMemo, useEffect, useRef } from 'react'
import useSWR from 'swr'
import ReactECharts from 'echarts-for-react'
import { CHART_FONT_FAMILY } from '../utils/chartFont'
import UIcon from '../components/ui/UIcon'
import ErrorState from '../components/ErrorState'
import usePreferences, { parsePref } from '../hooks/usePreferences'
import {
  CHART_GROUPS, LABEL_MAP, CHART_PRESETS,
  UNIT, UNIT_LABEL, unitOf, resolveAxes, matchPreset, axisForUnit,
} from './breadth/chartMetrics'
import styles from './BreadthCharts.module.css'

const fetcher = url => fetch(url).then(r => r.json())

const PREF_KEY = 'breadth_charts_state'
const DEFAULT_SELECTED = ['breadth_score', 'pct_above_50sma']
// Stable reference so the chart's useMemo doesn't rerun on every render.
const NO_EXTREMES = {}

const PALETTE = [
  '#60a5fa', '#34d399', '#f59e0b', '#f87171',
  '#a78bfa', '#fb923c', '#38bdf8', '#4ade80',
  '#e879f9', '#fbbf24',
]

// MA Breadth reference lines — red overbought (70/80/90), green oversold (20/15/10/5)
const MA_EXTREME_LINES = [
  { yAxis: 90, color: '#b91c1c', opacity: 0.90 },
  { yAxis: 80, color: '#ef4444', opacity: 0.72 },
  { yAxis: 70, color: '#fca5a5', opacity: 0.55 },
  { yAxis: 20, color: '#bbf7d0', opacity: 0.55 },
  { yAxis: 15, color: '#4ade80', opacity: 0.70 },
  { yAxis: 10, color: '#22c55e', opacity: 0.85 },
  { yAxis: 5,  color: '#15803d', opacity: 0.95 },
]

function offsetDate(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export default function BreadthCharts() {
  const { data, isLoading, error, mutate } = useSWR('/api/breadth-monitor?days=365', fetcher)
  const { prefs, setPref } = usePreferences()

  const [expanded, setExpanded] = useState({})
  const [fromDate, setFromDate] = useState(() => offsetDate(-90))
  const [toDate, setToDate]     = useState(() => offsetDate(0))

  // The stored selection is DERIVED from prefs rather than copied into state by
  // an effect — SWR resolves after mount, so an effect would mean a cascading
  // render and a default-then-swap flash. Once the user touches anything, the
  // override wins and prefs stop mattering.
  const [selectedOverride, setSelectedOverride] = useState(null)
  const [extremesOverride, setExtremesOverride] = useState(null)
  const saveTimerRef = useRef(null)

  const storedRaw = prefs[PREF_KEY]
  const stored = useMemo(() => {
    const saved = parsePref(storedRaw, null)
    if (!saved) return null
    // Drop any metric that no longer exists so a renamed key can't blank the chart.
    const keys = Array.isArray(saved.selected)
      ? saved.selected.filter(k => k in LABEL_MAP)
      : []
    return {
      selected: keys.length ? keys : null,
      extremes: saved.extremes && typeof saved.extremes === 'object' ? saved.extremes : null,
    }
  }, [storedRaw])

  const selected = selectedOverride ?? stored?.selected ?? DEFAULT_SELECTED
  const notableExtremes = extremesOverride ?? stored?.extremes ?? NO_EXTREMES

  // Persist only what the user actually changed — a page load must never write
  // its own restored state back to the server.
  useEffect(() => {
    if (selectedOverride === null && extremesOverride === null) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      setPref(PREF_KEY, { selected, extremes: notableExtremes })
    }, 600)
    return () => clearTimeout(saveTimerRef.current)
  }, [selectedOverride, extremesOverride, selected, notableExtremes, setPref])

  const rows = useMemo(() => {
    if (!data?.rows) return []
    return data.rows
      .filter(r => r.date >= fromDate && r.date <= toDate)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [data, fromDate, toDate])

  const activePreset = useMemo(() => matchPreset(selected), [selected])

  function applyPreset(preset) {
    setSelectedOverride(preset.metrics)
    // Replace rather than merge — a previous preset's reference lines left on
    // would draw MA washout levels over, say, a VIX axis.
    setExtremesOverride(
      Object.fromEntries((preset.extremes ?? []).map(g => [g, true]))
    )
  }

  function toggleMetric(key) {
    setSelectedOverride(
      selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key]
    )
  }

  function toggleGroup(group) {
    setExpanded(prev => ({ ...prev, [group]: !prev[group] }))
  }

  function toggleExtremes(group) {
    setExtremesOverride({ ...notableExtremes, [group]: !notableExtremes[group] })
  }

  const option = useMemo(() => {
    const { axisByKey, hasRight, leftUnit, rightUnits } = resolveAxes(selected)

    const series = selected.map((key, i) => ({
      name: LABEL_MAP[key] ?? key,
      type: 'line',
      data: rows.map(r => [r.date, r[key] ?? null]),
      yAxisIndex: axisByKey[key] ?? 0,
      symbol: 'none',
      smooth: 0.35,
      lineStyle: { width: 2 },
      itemStyle: { color: PALETTE[i % PALETTE.length] },
      connectNulls: false,
    }))

    // The 5–90 levels only mean anything against a percentage axis, so draw
    // them on whichever axis the pct family landed on — and not at all when no
    // percentage metric is plotted.
    const hasPct = selected.some(k => unitOf(k) === UNIT.PCT)
    if (notableExtremes['MA Breadth'] && hasPct) {
      series.push({
        name: '__ma_extremes__',
        type: 'line',
        data: [],
        yAxisIndex: axisForUnit(selected, UNIT.PCT, axisByKey),
        silent: true,
        markLine: {
          silent: true,
          symbol: ['none', 'none'],
          animation: false,
          data: MA_EXTREME_LINES.map(l => ({
            yAxis: l.yAxis,
            lineStyle: { color: l.color, width: 1, type: 'dashed', opacity: l.opacity },
            label: {
              show: true,
              position: 'end',
              formatter: String(l.yAxis),
              color: l.color,
              fontSize: 10,
              fontWeight: 600,
              backgroundColor: 'transparent',
            },
          })),
        },
      })
    }

    const axisNameStyle = { color: '#706b5e', fontSize: 10, padding: [0, 0, 4, 0] }

    return {
      backgroundColor: 'transparent',
      textStyle: { color: '#e0dac8', fontFamily: CHART_FONT_FAMILY },
      legend: {
        top: 8,
        data: selected.map(key => LABEL_MAP[key] ?? key),
        textStyle: { color: '#a8a290', fontSize: 12 },
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', crossStyle: { color: '#3a3d32' } },
        backgroundColor: '#22251e',
        borderColor: '#2e3127',
        textStyle: { color: '#e0dac8', fontSize: 12 },
        formatter(params) {
          if (!params.length) return ''
          const date = params[0].axisValue
          const lines = params
            .filter(p => p.value[1] != null)
            .map(p => {
              const color = p.color
              const val = typeof p.value[1] === 'number'
                ? p.value[1] % 1 === 0 ? p.value[1] : p.value[1].toFixed(2)
                : p.value[1]
              return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px"></span>${p.seriesName}: <b>${val}</b>`
            })
          return `<div style="font-size:11px;color:#706b5e;margin-bottom:4px">${date}</div>` + lines.join('<br/>')
        },
      },
      grid: { left: 64, right: hasRight ? 64 : 24, top: 56, bottom: 56 },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#2e3127' } },
        axisTick: { lineStyle: { color: '#2e3127' } },
        axisLabel: {
          color: '#706b5e',
          fontSize: 11,
          formatter: v => v.slice(5).replace('-', '/'),
        },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: leftUnit ? UNIT_LABEL[leftUnit] : '',
          nameTextStyle: axisNameStyle,
          axisLine: { lineStyle: { color: '#2e3127' } },
          axisTick: { show: false },
          axisLabel: { color: '#706b5e', fontSize: 11 },
          splitLine: { lineStyle: { color: '#22251e' } },
        },
        {
          type: 'value',
          show: hasRight,
          name: rightUnits.map(u => UNIT_LABEL[u]).join(' / '),
          nameTextStyle: axisNameStyle,
          axisLine: { lineStyle: { color: '#2e3127' } },
          axisTick: { show: false },
          axisLabel: { color: '#706b5e', fontSize: 11 },
          splitLine: { show: false },
        },
      ],
      dataZoom: [
        { type: 'inside', zoomOnMouseWheel: true },
        {
          type: 'slider',
          bottom: 4,
          height: 22,
          fillerColor: 'rgba(201,168,76,0.10)',
          borderColor: '#2e3127',
          handleStyle: { color: '#c9a84c' },
          textStyle: { color: '#706b5e' },
        },
      ],
      series,
    }
  }, [selected, rows, notableExtremes])

  return (
    <div className={styles.container}>
      {/* ── Controls ─────────────────────────────────────────────────── */}
      <div className={styles.controls}>
        <div className={styles.presetRow}>
          <span className={styles.presetLabel}>Presets</span>
          {CHART_PRESETS.map(p => (
            <button
              key={p.id}
              type="button"
              title={p.hint}
              aria-pressed={activePreset === p.id}
              className={`${styles.presetBtn} ${activePreset === p.id ? styles.presetBtnActive : ''}`}
              onClick={() => applyPreset(p)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className={styles.metricPanel}>
          <div className={styles.groupRow}>
            {CHART_GROUPS.map(g => {
              const selectedInGroup = g.metrics.filter(m => selected.includes(m.key)).length
              return (
                <button
                  key={g.group}
                  className={`${styles.groupBtn} ${expanded[g.group] ? styles.groupBtnActive : ''}`}
                  onClick={() => toggleGroup(g.group)}
                >
                  {g.group}
                  {selectedInGroup > 0 && (
                    <span className={styles.badge}>{selectedInGroup}</span>
                  )}
                  <span className={styles.arrow}>{expanded[g.group] ? '▾' : '▸'}</span>
                </button>
              )
            })}
          </div>

          {CHART_GROUPS.map(g => expanded[g.group] && (
            <div key={g.group} className={styles.metricList}>
              <div className={styles.extremesRow}>
                <button
                  className={`${styles.extremesBtn} ${notableExtremes[g.group] ? styles.extremesBtnActive : ''}`}
                  onClick={() => toggleExtremes(g.group)}
                >
                  <UIcon name="bolt" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Notable Extremes
                </button>
              </div>
              {g.metrics.map(m => (
                <label key={m.key} className={styles.metricItem}>
                  <input
                    type="checkbox"
                    checked={selected.includes(m.key)}
                    onChange={() => toggleMetric(m.key)}
                  />
                  <span>{m.label}</span>
                </label>
              ))}
            </div>
          ))}
        </div>

        <div className={styles.dateRow}>
          <label className={styles.dateLabel}>
            From
            <input
              type="date"
              className={styles.dateInput}
              value={fromDate}
              max={toDate}
              onChange={e => setFromDate(e.target.value)}
            />
          </label>
          <label className={styles.dateLabel}>
            To
            <input
              type="date"
              className={styles.dateInput}
              value={toDate}
              min={fromDate}
              onChange={e => setToDate(e.target.value)}
            />
          </label>
          {rows.length > 0 && (
            <span className={styles.rowCount}>{rows.length} days</span>
          )}
        </div>
      </div>

      {/* ── Chart ────────────────────────────────────────────────────── */}
      <div className={styles.chartWrap}>
        {error && !data && (
          <ErrorState message="Couldn't load breadth history right now." onRetry={mutate} compact />
        )}
        {!error && isLoading && <div className={styles.placeholder}>Loading data…</div>}
        {!error && !isLoading && rows.length === 0 && (
          <div className={styles.placeholder}>No data in selected range.</div>
        )}
        {!isLoading && rows.length > 0 && selected.length === 0 && (
          <div className={styles.placeholder}>Pick a preset above, or check individual metrics.</div>
        )}
        {!isLoading && rows.length > 0 && selected.length > 0 && (
          <ReactECharts
            option={option}
            style={{ height: 680, width: '100%' }}
            notMerge
            lazyUpdate
          />
        )}
      </div>
    </div>
  )
}
