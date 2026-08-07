import { useState, useMemo, useEffect, useRef } from 'react'
import useSWR from 'swr'
import { useLiveBreadth } from '../hooks/useLiveBreadth'
import ReactECharts from 'echarts-for-react'
import { CHART_FONT_FAMILY } from '../utils/chartFont'
import UIcon from '../components/ui/UIcon'
import ErrorState from '../components/ErrorState'
import usePreferences, { parsePref } from '../hooks/usePreferences'
import {
  CHART_GROUPS, LABEL_MAP, CHART_PRESETS, PRESET_GROUP_ORDER,
  UNIT, UNIT_LABEL, unitOf, resolveAxes, matchPreset, axisForUnit,
  scaleForUnit, resolveColors, resolveLines,
} from './breadth/chartMetrics'
import { ftdMarkers } from './breadth/ftdMarkers'
import PresetRow from './breadth/PresetRow'
import MetricReadout from './breadth/MetricReadout'
import styles from './BreadthCharts.module.css'

const fetcher = url => fetch(url).then(r => r.json())

const PREF_KEY = 'breadth_charts_state'
const DEFAULT_SELECTED = ['breadth_score', 'pct_above_50sma']
// Stable reference so the chart's useMemo doesn't rerun on every render.
const NO_EXTREMES = {}

// ECharts sizes a value axis from its SERIES alone. Participation tops out near
// 70, so the axis ended around 80 and the 90 reference line silently never drew.
// Widen only the axis the band sits on, and only far enough to contain it —
// genuine outliers (uct_exposure 102, aaii_spread −22) still expand it normally.
const EXTREMES_BAND = {
  min: v => Math.min(0, v.min),
  max: v => Math.max(100, v.max),
}

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
  const live = useLiveBreadth()
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
  const [ftdOverride, setFtdOverride] = useState(null)
  const saveTimerRef = useRef(null)
  const chartRef = useRef(null)
  const [hidden, setHidden] = useState(() => new Set())

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
      ftd: saved.ftd === true,
    }
  }, [storedRaw])

  const selected = selectedOverride ?? stored?.selected ?? DEFAULT_SELECTED
  const notableExtremes = extremesOverride ?? stored?.extremes ?? NO_EXTREMES
  const showFtd = ftdOverride ?? stored?.ftd ?? false

  // Persist only what the user actually changed — a page load must never write
  // its own restored state back to the server.
  useEffect(() => {
    if (selectedOverride === null && extremesOverride === null && ftdOverride === null) return
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      setPref(PREF_KEY, { selected, extremes: notableExtremes, ftd: showFtd })
    }, 600)
    return () => clearTimeout(saveTimerRef.current)
  }, [selectedOverride, extremesOverride, ftdOverride, selected, notableExtremes, showFtd, setPref])

  // The provisional row extends every line to NOW. It is appended, never
  // substituted: the backend withholds it the moment the 4:15 collector writes
  // the day, so a stored point and an estimate of that same point can't both
  // appear. The date filter still applies — scrolling back in time drops it.
  const rows = useMemo(() => {
    if (!data?.rows) return []
    const all = live.row ? [...data.rows, live.row] : data.rows
    return all
      .filter(r => r.date >= fromDate && r.date <= toDate)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [data, live.row, fromDate, toDate])

  const liveIndex = useMemo(
    () => (live.row ? rows.findIndex(r => r._live) : -1),
    [rows, live.row],
  )

  const activePreset = useMemo(() => matchPreset(selected), [selected])
  const activePresetDef = useMemo(
    () => CHART_PRESETS.find(p => p.id === activePreset) ?? null,
    [activePreset],
  )

  // ReactECharts runs with notMerge, so any new option rebuilds the chart and
  // its legend selection resets to all-visible. Every path that changes the
  // selection must drop the hidden set with it, or the readout dims a row for
  // a line the chart is drawing.
  const NOTHING_HIDDEN = useRef(new Set())

  function applyPreset(preset) {
    setSelectedOverride(preset.metrics)
    setHidden(NOTHING_HIDDEN.current)
    // Replace rather than merge — a previous preset's reference lines left on
    // would draw MA washout levels over, say, a VIX axis.
    setExtremesOverride(
      Object.fromEntries((preset.extremes ?? []).map(g => [g, true]))
    )
    // Only ever widens, and never touches `toDate` — a preset must not narrow
    // what the reader framed. Only ad-line asks: adv_decline_cum keeps just 55%
    // of its travel at the 90-day default, with the April trough off-screen.
    if (preset.minWindowDays) {
      const earliest = offsetDate(-preset.minWindowDays)
      setFromDate(prev => (earliest < prev ? earliest : prev))
    }
  }

  function toggleMetric(key) {
    setSelectedOverride(
      selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key]
    )
    setHidden(NOTHING_HIDDEN.current)
  }

  function toggleGroup(group) {
    setExpanded(prev => ({ ...prev, [group]: !prev[group] }))
  }

  function toggleExtremes(group) {
    setExtremesOverride({ ...notableExtremes, [group]: !notableExtremes[group] })
  }

  // Drives the hidden legend rather than the selection, so hiding a series to
  // read another one can't re-resolve the axes underneath it.
  function toggleSeries(key) {
    const name = LABEL_MAP[key] ?? key
    chartRef.current?.getEchartsInstance().dispatchAction({ type: 'legendToggleSelect', name })
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const option = useMemo(() => {
    const { axisByKey, hasRight, leftUnit, rightUnits } = resolveAxes(selected)

    const colors = resolveColors(selected)

    const series = selected.map(key => ({
      name: LABEL_MAP[key] ?? key,
      type: 'line',
      data: rows.map(r => [r.date, r[key] ?? null]),
      yAxisIndex: axisByKey[key] ?? 0,
      // Every line is dotless EXCEPT its provisional tip, so the eye can tell
      // where measured history stops and the intraday estimate begins.
      symbol: liveIndex >= 0
        ? (v, prm) => (prm.dataIndex === liveIndex ? 'circle' : 'none')
        : 'none',
      symbolSize: 7,
      smooth: 0.35,
      lineStyle: { width: 2 },
      itemStyle: { color: colors[key] },
      connectNulls: false,
    }))

    // resolveLines suppresses a line that would expand an auto-framed axis, so
    // it needs the extent of what is actually on screen.
    const extentOf = unit => {
      const values = selected
        .filter(k => unitOf(k) === unit)
        .flatMap(k => rows.map(r => r[k]))
        .filter(v => typeof v === 'number' && Number.isFinite(v))
      return values.length ? [Math.min(...values), Math.max(...values)] : null
    }

    // Every preset declares lines for a single family, which the "line has a
    // series to sit beside" test keeps true — so one series carries them all.
    // Split this per axis if a preset ever marks two families.
    const refLines = resolveLines(selected, activePresetDef?.lines, extentOf)
    if (refLines.length) {
      series.push({
        name: '__ref_lines__',
        type: 'line',
        data: [],
        yAxisIndex: refLines[0].axis,
        silent: true,
        markLine: {
          silent: true,
          symbol: ['none', 'none'],
          animation: false,
          label: {
            formatter: p => p.data.label,
            color: '#706b5e',
            fontSize: 10,
            position: 'insideEndTop',
          },
          lineStyle: { color: '#4a4d3f', type: 'dashed', width: 1 },
          data: refLines.map(l => ({ yAxis: l.at, label: l.label })),
        },
      })
    }

    if (showFtd) {
      const marks = ftdMarkers(rows)
      if (marks.length) {
        series.push({
          name: '__ftd__',
          type: 'line',
          data: [],
          yAxisIndex: 0,
          silent: true,
          markLine: {
            silent: true,
            symbol: ['none', 'none'],
            animation: false,
            lineStyle: { color: '#a78bfa', type: 'dotted', width: 1, opacity: 0.7 },
            label: {
              formatter: p => (p.data.showLabel ? 'FTD' : ''),
              color: '#a78bfa',
              fontSize: 10,
              rotate: 0,
              position: 'insideEndTop',
            },
            data: marks.map(m => ({ xAxis: m.date, showLabel: m.label })),
          },
        })
      }
    }

    if (liveIndex >= 0) {
      series.push({
        name: '__live_now__',
        type: 'line',
        data: [],
        yAxisIndex: 0,
        silent: true,
        markLine: {
          silent: true,
          symbol: ['none', 'none'],
          animation: false,
          label: {
            formatter: `LIVE ${live.clock ?? ''}`.trim(),
            position: 'insideEndTop',
            // ECharts rotates a markLine label to follow its line, which on a
            // VERTICAL line means 90° — the stamp rendered sideways and clipped
            // against the right edge. Unrotate it and grow it leftward into the
            // plot so it stays readable and inside.
            rotate: 0,
            align: 'right',
            distance: [4, 2],
            color: '#c9a84c',
            fontSize: 10,
            fontWeight: 600,
            backgroundColor: 'rgba(8,11,16,0.78)',
            padding: [2, 5],
            borderRadius: 3,
          },
          lineStyle: { color: '#c9a84c', type: 'dashed', width: 1, opacity: 0.65 },
          data: [{ xAxis: rows[liveIndex].date }],
        },
      })
    }

    // The 5–90 levels only mean anything against a percentage axis, so draw
    // them on whichever axis the pct family landed on — and not at all when no
    // percentage metric is plotted.
    const hasPct = selected.some(k => unitOf(k) === UNIT.PCT)
    const showExtremes = Boolean(notableExtremes['MA Breadth']) && hasPct
    const extremesAxis = showExtremes ? axisForUnit(selected, UNIT.PCT, axisByKey) : null
    if (showExtremes) {
      series.push({
        name: '__ma_extremes__',
        type: 'line',
        data: [],
        yAxisIndex: extremesAxis,
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
      // MetricReadout is the legend now. The component stays mounted but
      // hidden so its selection state survives — that is what lets a readout
      // row keep toggling a series via legendToggleSelect.
      legend: {
        show: false,
        data: selected.map(key => LABEL_MAP[key] ?? key),
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
      grid: { left: 64, right: hasRight ? 64 : 24, top: 24, bottom: 56 },
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
          scale: scaleForUnit(leftUnit),
          ...(extremesAxis === 0 ? EXTREMES_BAND : {}),
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
          // Only frame when a single family is on it. Two families already
          // share a compromised axis; framing to their union helps neither.
          scale: rightUnits.length === 1 && scaleForUnit(rightUnits[0]),
          ...(extremesAxis === 1 ? EXTREMES_BAND : {}),
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
  }, [selected, rows, notableExtremes, liveIndex, live.clock, activePresetDef, showFtd])

  return (
    <div className={styles.container}>
      {/* ── Controls ─────────────────────────────────────────────────── */}
      <div className={styles.controls}>
        <PresetRow
          presets={CHART_PRESETS}
          groupOrder={PRESET_GROUP_ORDER}
          activePreset={activePreset}
          onApply={applyPreset}
        />

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
          {/* Default off — an existing view must not change shape unasked. */}
          <label className={styles.ftdToggle}>
            <input
              type="checkbox"
              checked={showFtd}
              onChange={e => setFtdOverride(e.target.checked)}
            />
            Follow-through days
          </label>
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
          <>
            <MetricReadout
              rows={rows}
              selected={selected}
              hidden={hidden}
              onToggle={toggleSeries}
            />
            <ReactECharts
              ref={chartRef}
              option={option}
              style={{ height: 680, width: '100%' }}
              notMerge
              lazyUpdate
            />
          </>
        )}
      </div>
    </div>
  )
}
