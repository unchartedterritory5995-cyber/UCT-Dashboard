// app/src/components/research-kit/charts/MetricTrendChart.jsx
import EmptyState from '../EmptyState'
import EChart, { CHART_INK, GRID_BASE, TOOLTIP_BASE, axisBase } from './echartsCore'
import { formatSigned } from './HeatGrid'
import styles from './MetricTrendChart.module.css'

/** §3.4 skeleton size contract. */
export const SIZE = { width: '100%', height: 140 }

const num = (v) => {
  // Explicit null check BEFORE Number conversion to avoid Number(null) === 0 trap
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * One metric across periods as signed bars. Pure.
 *
 * Only the LAST value is direct-labelled (Part C rule 5: kill the grid, label
 * the terminal value instead of forcing an axis read). A null period keeps its
 * slot so the axis never silently shifts.
 */
export function buildTrendOption(periods, values, { valueFormatter } = {}) {
  const p = periods || []
  const fmt = valueFormatter || ((v) => formatSigned(v, { unit: '%' }))
  const last = p.length - 1

  return {
    grid: { ...GRID_BASE, left: 30, top: 20, bottom: 22 },
    xAxis: { type: 'category', data: p, ...axisBase() },
    yAxis: {
      type: 'value',
      splitNumber: 2,
      ...axisBase({ splitLine: { show: true, lineStyle: { color: CHART_INK.grid } } }),
    },
    tooltip: {
      ...TOOLTIP_BASE,
      trigger: 'axis',
      formatter: (ps) => {
        const i = ps?.[0]?.dataIndex ?? 0
        return `${p[i] ?? ''}<br/>${fmt(num((values || [])[i]))}`
      },
    },
    series: [{
      type: 'bar',
      barMaxWidth: 22,
      markLine: {
        silent: true,
        symbol: 'none',
        label: { show: false },
        lineStyle: { color: CHART_INK.muted, width: 1, opacity: 0.7 },
        data: [{ yAxis: 0 }],
      },
      data: p.map((_, i) => {
        const v = num((values || [])[i])
        return {
          value: v,
          itemStyle: { color: v == null ? CHART_INK.muted : v >= 0 ? CHART_INK.gain : CHART_INK.loss },
          label: {
            show: i === last && v != null,
            position: v != null && v < 0 ? 'bottom' : 'top',
            color: CHART_INK.bright,
            fontSize: 10,
            formatter: () => fmt(v),
          },
        }
      }),
    }],
  }
}

/**
 * The inline trend a HeatGrid row opens (spec §5.3: click any row → 8q/5y
 * trend). Deliberately chrome-light — it is a detail view inside a table, not a
 * hero.
 */
export default function MetricTrendChart({
  periods,
  values,
  label,
  valueFormatter,
  height = SIZE.height,
  className = '',
  ariaLabel,
}) {
  const p = Array.isArray(periods) ? periods : []
  const v = Array.isArray(values) ? values : []
  const finite = v.map(num).filter((x) => x != null)

  if (!p.length || !finite.length) {
    return (
      <EmptyState
        compact
        icon="chart"
        title="No trend for this metric"
        hint="This metric has no reported values in the available periods."
        className={className}
      />
    )
  }

  const fmt = valueFormatter || ((x) => formatSigned(x, { unit: '%' }))
  const latest = num(v[v.length - 1])
  const built = ariaLabel
    || `${label || 'Metric'} by period, ${p[0]} to ${p[p.length - 1]}.${latest == null ? '' : ` Latest ${fmt(latest)}.`}`

  return (
    <div className={`${styles.wrap} ${className}`}>
      <EChart
        option={buildTrendOption(p, v, { valueFormatter })}
        height={height}
        ariaLabel={built}
        testId="rk-metric-trend"
      />
    </div>
  )
}
