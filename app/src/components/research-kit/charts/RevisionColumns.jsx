// app/src/components/research-kit/charts/RevisionColumns.jsx
import EmptyState from '../EmptyState'
import EyebrowLabel from '../EyebrowLabel'
import EChart, { CHART_INK, GRID_BASE, TOOLTIP_BASE, axisBase } from './echartsCore'
import styles from './RevisionColumns.module.css'

/** §3.4 skeleton size contract. */
export const SIZE = { width: '100%', height: 180 }

const count = (v) => {
  const n = Math.abs(Number(v))
  return Number.isFinite(n) ? n : 0
}

/** Totals for the caption + aria-label. Pure. */
export function revisionTotals(buckets) {
  const list = buckets || []
  const up = list.reduce((a, b) => a + count(b?.up), 0)
  const down = list.reduce((a, b) => a + count(b?.down), 0)
  return { up, down, net: up - down, buckets: list.length }
}

/**
 * Diverging up/down columns (dataviz pattern 3).
 *
 * Ups are positive, downs negative, drawn at the SAME x with barGap '-100%' —
 * the position channel carries the direction, so colour is redundant (§3.3).
 */
export function buildRevisionOption(buckets) {
  const list = buckets || []
  return {
    grid: { ...GRID_BASE, left: 34 },
    xAxis: { type: 'category', data: list.map((b) => b?.label ?? ''), ...axisBase() },
    yAxis: {
      type: 'value',
      splitNumber: 3,
      ...axisBase({ splitLine: { show: true, lineStyle: { color: CHART_INK.grid } } }),
    },
    tooltip: {
      ...TOOLTIP_BASE,
      trigger: 'axis',
      formatter: (ps) => {
        const i = ps?.[0]?.dataIndex ?? 0
        const b = list[i] || {}
        return `${b.label ?? ''}<br/>▲ ${count(b.up)} up<br/>▼ ${count(b.down)} down`
      },
    },
    series: [
      {
        name: 'Up',
        type: 'bar',
        barMaxWidth: 14,
        itemStyle: { color: CHART_INK.gain },
        data: list.map((b) => count(b?.up)),
        // The zero rule is semantic in finance: above vs below. One rule, no box.
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { color: CHART_INK.muted, width: 1, type: 'solid', opacity: 0.7 },
          data: [{ yAxis: 0 }],
        },
      },
      {
        name: 'Down',
        type: 'bar',
        barMaxWidth: 14,
        barGap: '-100%',
        itemStyle: { color: CHART_INK.loss },
        // `-0` is a real value in JS and is NOT equal to 0 under Object.is —
        // return plain 0 for an empty bucket.
        data: list.map((b) => {
          const d = count(b?.down)
          return d === 0 ? 0 : -d
        }),
      },
    ],
  }
}

/**
 * Estimate-revision momentum (spec §5.3 Estimates hero; dataviz pattern 3).
 *
 * `buckets` is DELIBERATELY neutral: `[{ label, up, down }]`. Spec §6 promises
 * weekly server-side bucketing; `/api/research/estimates/{sym}` currently
 * returns fiscal-period buckets (`{ period, up30, down30 }`). Both map on with
 * a one-line adapter at the call site, e.g.
 *
 *   buckets={revisions.map(r => ({ label: r.period, up: r.up30, down: r.down30 }))}
 *
 * so this component does not change when the weekly endpoint lands.
 */
export default function RevisionColumns({
  buckets,
  label = 'Estimate revisions',
  info,
  height = SIZE.height,
  className = '',
  ariaLabel,
}) {
  const list = Array.isArray(buckets) ? buckets : []
  const totals = revisionTotals(list)

  // An all-zero chart draws a flat nothing and reads as "no revisions data" —
  // say that in words instead.
  if (!list.length || (totals.up === 0 && totals.down === 0)) {
    return (
      <EmptyState
        icon="chart"
        title="No estimate revisions"
        hint="Analysts have not moved their numbers in this window."
        className={className}
      />
    )
  }

  const sign = totals.net > 0 ? '+' : ''
  const built = ariaLabel
    || `Estimate revisions across ${totals.buckets} periods: ${totals.up} up, ${totals.down} down, net ${sign}${totals.net}.`

  return (
    <div className={`${styles.wrap} ${className}`}>
      {label && <EyebrowLabel info={info}>{label}</EyebrowLabel>}
      <EChart
        option={buildRevisionOption(list)}
        height={height}
        ariaLabel={built}
        testId="rk-revisions"
      />
    </div>
  )
}
