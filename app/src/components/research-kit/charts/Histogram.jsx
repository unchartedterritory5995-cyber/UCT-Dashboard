// app/src/components/research-kit/charts/Histogram.jsx
import EmptyState from '../EmptyState'
import EyebrowLabel from '../EyebrowLabel'
import EChart, { CHART_INK, GRID_BASE, TOOLTIP_BASE, axisBase } from './echartsCore'
import styles from './Histogram.module.css'

/** §3.4 skeleton size contract. */
export const SIZE = { width: '100%', height: 160 }

/**
 * Equal-width bins over the finite values. Pure.
 *
 * The maximum lands in the LAST bin (a naive floor() would push it into a
 * phantom bin N+1 and silently drop the highest price target — exactly the
 * value a reader looks for). Identical values collapse to one bin rather than
 * dividing by a zero-width range.
 */
export function binValues(values, bins = 8) {
  const nums = (values || []).filter((v) => v != null && Number.isFinite(Number(v))).map(Number)
  if (!nums.length) return []
  const lo = Math.min(...nums)
  const hi = Math.max(...nums)
  if (hi === lo) return [{ x0: lo, x1: lo, count: nums.length }]

  const n = Math.max(1, Math.floor(bins))
  const w = (hi - lo) / n
  const out = Array.from({ length: n }, (_, i) => ({ x0: lo + i * w, x1: lo + (i + 1) * w, count: 0 }))
  for (const v of nums) {
    const i = Math.min(n - 1, Math.max(0, Math.floor((v - lo) / w)))
    out[i].count += 1
  }
  return out
}

/**
 * Index of the bin containing `v`, or -1 when it falls outside the
 * distribution. Pure.
 *
 * Uses the SAME floor rule as binValues — a `x <= bin.x1` scan would put a
 * boundary value (a target sitting exactly on a bin edge) one bin to the left
 * of where its own count was tallied, and the marker would point at the wrong
 * bar.
 */
function binIndexOf(bins, v) {
  const x = Number(v)
  if (!Number.isFinite(x) || !bins.length) return -1
  const lo = bins[0].x0
  const hi = bins[bins.length - 1].x1
  if (x < lo || x > hi) return -1
  const w = bins[0].x1 - bins[0].x0
  if (!(w > 0)) return 0
  return Math.min(bins.length - 1, Math.floor((x - lo) / w))
}

export function buildHistogramOption(bins, { marker, markerLabel, valueFormatter } = {}) {
  const fmt = valueFormatter || ((v) => (v == null ? '—' : Number(v).toFixed(0)))
  const markIdx = binIndexOf(bins, marker)

  const series = {
    type: 'bar',
    barCategoryGap: '18%',
    itemStyle: { color: CHART_INK.muted, borderRadius: [2, 2, 0, 0] },
    data: bins.map((b) => b.count),
  }
  if (markIdx >= 0) {
    series.markLine = {
      silent: true,
      symbol: 'none',
      lineStyle: { color: CHART_INK.gold, width: 1, type: 'dashed' },
      label: { color: CHART_INK.bright, fontSize: 9, formatter: () => markerLabel || fmt(marker) },
      data: [{ xAxis: markIdx, name: markerLabel || fmt(marker) }],
    }
  }

  return {
    grid: { ...GRID_BASE, left: 30, bottom: 26 },
    xAxis: {
      type: 'category',
      data: bins.map((b) => (b.x0 === b.x1 ? fmt(b.x0) : `${fmt(b.x0)}–${fmt(b.x1)}`)),
      ...axisBase({ axisLabel: { color: CHART_INK.muted, fontSize: 9, interval: 0, rotate: bins.length > 5 ? 30 : 0 } }),
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitNumber: 2,
      ...axisBase({ splitLine: { show: true, lineStyle: { color: CHART_INK.grid } } }),
    },
    tooltip: { ...TOOLTIP_BASE, trigger: 'axis' },
    series: [series],
  }
}

/**
 * Simple distribution histogram (spec §5.3 Estimates; dataviz "distribution is
 * the message" — 12 buys and 1 sell is not "consensus: buy").
 *
 * GATED (§5.3/§6): the analyst price-target distribution ships **only after**
 * the FMP `price-target-news` probe passes via
 * `GET /api/debug/earnings-sources/{sym}`. If the probe fails, the page ships
 * the PT `RangeSlider` alone, permanently — do not mount this on unverified
 * data.
 */
export default function Histogram({
  values,
  bins = 8,
  marker,
  markerLabel,
  valueFormatter,
  label = 'Distribution',
  info,
  height = SIZE.height,
  className = '',
  ariaLabel,
}) {
  const binned = binValues(values, bins)

  if (!binned.length) {
    return (
      <EmptyState
        icon="chart"
        title="No distribution to show"
        hint="This needs at least one published number from covering analysts."
        className={className}
      />
    )
  }

  const fmt = valueFormatter || ((v) => Number(v).toFixed(0))
  const total = binned.reduce((a, b) => a + b.count, 0)
  const built = ariaLabel
    || `Distribution of ${total} values from ${fmt(binned[0].x0)} to ${fmt(binned[binned.length - 1].x1)}.`

  return (
    <div className={`${styles.wrap} ${className}`}>
      {label && <EyebrowLabel info={info}>{label}</EyebrowLabel>}
      <EChart
        option={buildHistogramOption(binned, { marker, markerLabel, valueFormatter })}
        height={height}
        ariaLabel={built}
        testId="rk-histogram"
      />
    </div>
  )
}
