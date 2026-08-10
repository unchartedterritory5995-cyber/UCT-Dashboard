// app/src/components/research-kit/charts/SeriesChart.jsx
//
// Multi-series companion to MetricTrendChart, which draws exactly one measure.
// Three modes, because three of this repo's datasets need shapes it cannot make:
//
//   line    — several measures on one axis (gross / operating / net margin)
//   stacked — parts of a whole over time (analyst consensus buckets)
//   band    — a range with a centre line (forward EPS low / avg / high)
//   bars    — discrete periods (statement history), grouped
//   rank    — categories, horizontal (largest holders)
//
// ⛔ EVERY SERIES CARRIES ITS OWN COLOUR. There is deliberately no internal
// palette to index into: `PALETTE[i]` is exactly how this repo once drew every
// bearish breadth line GREEN. A caller plotting sell-side ratings has to say
// which one is the sell bucket; the chart will not guess from position.
import EmptyState from '../EmptyState'
import EyebrowLabel from '../EyebrowLabel'
import EChart, { CHART_INK, GRID_BASE, TOOLTIP_BASE, axisBase } from './echartsCore'
import { toNum } from './format'
import styles from './MetricTrendChart.module.css'

export const SIZE = { width: '100%', height: 200 }

// One shared coercion — see toNum for why the obvious one-liner is wrong.
const num = toNum

/** True when at least one series has two or more real points to connect. */
export function hasPlottableData(series, mode = 'line') {
  const min = mode === 'rank' ? 1 : 2   // a ranking of one is still a ranking
  return (series || []).some(
    (s) => (s?.values || []).filter((v) => num(v) !== null).length >= min,
  )
}

/**
 * Pure option builder — separately testable, same convention as the rest of
 * the kit.
 *
 * `band` expects exactly three series in the order [low, centre, high]: the low
 * is drawn transparent and the high stacked on top of it, which is how ECharts
 * paints a filled range without a dedicated band type.
 */
export function buildSeriesOption(periods, series, { mode = 'line', valueFormatter } = {}) {
  const p = periods || []
  const list = series || []
  const fmt = valueFormatter || ((v) => (v == null ? '—' : String(v)))

  const tooltip = {
    ...TOOLTIP_BASE,
    trigger: 'axis',
    formatter: (ps) => {
      const i = ps?.[0]?.dataIndex ?? 0
      const lines = list.map(
        (s) => `${s.name}: ${fmt(num((s.values || [])[i]))}`)
      return `${p[i] ?? ''}<br/>${lines.join('<br/>')}`
    },
  }

  const base = {
    grid: { ...GRID_BASE, left: 38, top: 22, bottom: 22 },
    xAxis: { type: 'category', boundaryGap: mode === 'stacked', data: p, ...axisBase() },
    yAxis: {
      type: 'value',
      splitNumber: 3,
      scale: mode !== 'stacked',
      ...axisBase({ splitLine: { show: true, lineStyle: { color: CHART_INK.grid } } }),
    },
    tooltip,
  }

  if (mode === 'bars') {
    // Grouped bars, not lines: a statement is a set of DISCRETE periods, and a
    // line implies a continuous quantity between two quarters that never
    // existed. Over 24 quarters the labels are unreadable at every tick, so the
    // axis thins them and the tooltip carries the exact period.
    return {
      ...base,
      xAxis: { ...base.xAxis, boundaryGap: true,
               axisLabel: { ...(base.xAxis.axisLabel || {}),
                            interval: Math.max(0, Math.floor(p.length / 6) - 1),
                            hideOverlap: true } },
      series: list.map((s) => ({
        type: 'bar',
        name: s.name,
        barMaxWidth: 14,
        barGap: '10%',
        itemStyle: { color: s.color },
        data: (s.values || []).map(num),
      })),
    }
  }

  if (mode === 'rank') {
    // Categories, not time: horizontal bars so long names (institutional
    // holders, sectors) stay readable instead of being rotated or truncated.
    // ECharts draws the value axis at the BOTTOM, so the category order is
    // reversed to put the largest bar at the top where it is read first.
    const s0 = list[0] || {}
    const cats = [...p].reverse()
    const vals = [...(s0.values || [])].reverse().map(num)
    return {
      grid: { ...GRID_BASE, left: 4, right: 18, top: 10, bottom: 22, containLabel: true },
      xAxis: { type: 'value', ...axisBase({ splitLine: { show: true, lineStyle: { color: CHART_INK.grid } } }) },
      yAxis: { type: 'category', data: cats, ...axisBase() },
      tooltip: {
        ...TOOLTIP_BASE, trigger: 'axis',
        formatter: (ps) => {
          const i = ps?.[0]?.dataIndex ?? 0
          return `${cats[i] ?? ''}<br/>${fmt(vals[i])}`
        },
      },
      series: [{
        type: 'bar', barMaxWidth: 14,
        itemStyle: { color: s0.color || CHART_INK.ink, borderRadius: [0, 3, 3, 0] },
        data: vals,
      }],
    }
  }

  if (mode === 'band') {
    const [low, centre, high] = list
    return {
      ...base,
      series: [
        // The floor of the band: invisible, but it is what `high` stacks on.
        {
          type: 'line', name: low?.name || 'low', stack: 'band', symbol: 'none',
          lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 },
          data: (low?.values || []).map(num),
        },
        {
          type: 'line', name: high?.name || 'high', stack: 'band', symbol: 'none',
          lineStyle: { opacity: 0 },
          areaStyle: { color: high?.color || CHART_INK.muted, opacity: 0.18 },
          // Stacked, so the value plotted is the SPAN, not the high itself.
          data: (high?.values || []).map((v, i) => {
            const hi = num(v)
            const lo = num((low?.values || [])[i])
            return hi == null || lo == null ? null : hi - lo
          }),
        },
        {
          type: 'line', name: centre?.name || 'avg', symbol: 'circle', symbolSize: 5,
          lineStyle: { color: centre?.color || CHART_INK.ink, width: 2 },
          itemStyle: { color: centre?.color || CHART_INK.ink },
          data: (centre?.values || []).map(num),
        },
      ],
    }
  }

  return {
    ...base,
    series: list.map((s) => ({
      type: 'line',
      name: s.name,
      stack: mode === 'stacked' ? 'total' : undefined,
      symbol: mode === 'stacked' ? 'none' : 'circle',
      symbolSize: 4,
      smooth: false,
      lineStyle: { color: s.color, width: 2 },
      itemStyle: { color: s.color },
      areaStyle: mode === 'stacked' ? { color: s.color, opacity: 0.55 } : undefined,
      data: (s.values || []).map(num),
    })),
  }
}

export default function SeriesChart({
  periods,
  series,
  mode = 'line',
  label,
  info,
  valueFormatter,
  height = SIZE.height,
  className = '',
  ariaLabel,
  emptyMessage = 'Not enough history to chart yet.',
}) {
  if (!hasPlottableData(series, mode)) {
    // A single point draws a dot and reads as a broken chart — say it in words.
    return (
      <div className={className}>
        {label ? <EyebrowLabel info={info}>{label}</EyebrowLabel> : null}
        <EmptyState icon="chart" title={emptyMessage} />
      </div>
    )
  }
  return (
    <div className={className}>
      {label ? <EyebrowLabel info={info}>{label}</EyebrowLabel> : null}
      <EChart
        option={buildSeriesOption(periods, series, { mode, valueFormatter })}
        height={height}
        ariaLabel={ariaLabel || label}
        className={styles.chart}
      />
      {mode !== 'rank' && (
      <ul className={styles.legend} aria-hidden="true">
        {(series || []).map((s) => (
          <li key={s.name}>
            <span style={{ background: s.color }} /> {s.name}
          </li>
        ))}
      </ul>
      )}
    </div>
  )
}
