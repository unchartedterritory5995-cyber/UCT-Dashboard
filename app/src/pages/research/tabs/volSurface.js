// BRK-01 increment 3 (roadmap RM-L01): pure helpers for the implied-vol surface under the chain.
// The server (api/services/vol_surface.py) decides what is a valid point and what is drawable;
// this file only turns its payload into chart options and sentences. It never recomputes
// validity, so there is ONE authority on which strike is refused and why.
//
// ⛔ Only a side the server marked `drawable` becomes a line. A side that is not drawable is a
//    sentence (its `reason`), never a line through two or three points.
// ⛔ Every plotted point carries its quote time into the tooltip.
import { CHART_INK, GRID_BASE, TOOLTIP_BASE, axisBase } from '../../../components/research-kit/charts/echartsCore'
import { fractionPct } from '../researchFormat'
import { formatDateTimeEt, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { num } from '../../optionsAnalytics/optionsFormat'

export const pct = (v) => fractionPct(v, 1)

const secondsOf = (t) => { const ms = Date.parse(t); return Number.isFinite(ms) ? ms / 1000 : NaN }

/** An instant as a full ET date-time ("10/1/2026, 11:30:09 AM ET"), or null. The chain's and the
 *  surface's "as of": the server stamps UTC, a member reads the market's clock (audit 2026-10-08,
 *  it printed "2026-10-01 15:30:09 UTC" beside panels that all read ET). */
export function etStamp(t) { return t ? formatDateTimeEt(secondsOf(t)) : null }

/** The ET calendar day of an instant ("10/1/2026"): the key `quoteClock` compares a quote's day on. */
export function etDay(t) {
  const s = etStamp(t)
  return s ? s.split(',')[0] : null
}

/** "2026-10-01T15:30:00+00:00" → "11:30:00 AM ET" (its ET date kept when it is not the served day;
 *  `servedDay` is `etDay(served_at)`). */
export function quoteClock(t, servedDay) {
  if (!t) return '—'
  const clock = formatTimeEt(t, { seconds: true, zoneSuffix: 'ET' })
  if (!clock) return '—'
  const d = etDay(t)
  return servedDay && d !== servedDay ? `${d} ${clock}` : clock
}

/** The span of quote times across points, as text: "11:29:58 AM–11:30:04 AM ET". */
export function quoteSpan(points, servedDay) {
  const ts = (points || []).map((p) => p.t).filter(Boolean).sort()
  if (!ts.length) return null
  const a = quoteClock(ts[0], servedDay)
  const b = quoteClock(ts[ts.length - 1], servedDay)
  return a === b ? a : `${a.replace(/ ET$/, '')}–${b}`
}

const pointTip = (servedDay) => (p) => {
  const [x, y, t] = p.data || []
  return `${p.seriesName} ${num(x)}: ${formatPercent(Number(y), { decimals: 1 })}<br/>quoted ${quoteClock(t, servedDay)}`
}

const yPct = () => ({
  type: 'value', scale: true, splitNumber: 3,
  ...axisBase({ splitLine: { show: true, lineStyle: { color: CHART_INK.grid } },
                axisLabel: { color: CHART_INK.muted, fontSize: 10, formatter: (v) => `${v}%` } }),
})

/** Smile: IV by strike, one line per DRAWABLE side, a dashed spot marker. */
export function buildSmileOption(smile, spot, servedDay) {
  const series = []
  for (const [key, name, color] of [['calls', 'Call', CHART_INK.gain], ['puts', 'Put', CHART_INK.loss]]) {
    const side = smile?.[key]
    if (!side?.drawable) continue
    series.push({
      type: 'line', name, symbolSize: 5, showSymbol: true,
      lineStyle: { color, width: 2 }, itemStyle: { color },
      data: side.points.map((p) => [p.strike, +(p.iv * 100).toFixed(2), p.t]),
    })
  }
  if (series.length && Number.isFinite(spot)) {
    series[0].markLine = {
      silent: true, symbol: 'none',
      lineStyle: { color: CHART_INK.muted, type: 'dashed', width: 1 },
      label: { color: CHART_INK.muted, fontSize: 10, formatter: `spot ${num(spot)}` },
      data: [{ xAxis: spot }],
    }
  }
  return {
    grid: { ...GRID_BASE, left: 44, top: 18 },
    xAxis: { type: 'value', scale: true, ...axisBase() },
    yAxis: yPct(),
    tooltip: { ...TOOLTIP_BASE, trigger: 'item', formatter: pointTip(servedDay) },
    series,
  }
}

/** Term structure: ATM IV by days to expiration (a value axis, so spacing is honest). */
export function buildTermOption(term, servedDay) {
  const pts = (term?.points || []).filter((p) => p.atm_iv != null && p.dte != null)
  return {
    grid: { ...GRID_BASE, left: 44, top: 18 },
    xAxis: { type: 'value', scale: true, ...axisBase({ axisLabel: { color: CHART_INK.muted, fontSize: 10, formatter: (v) => `${v}d` } }) },
    yAxis: yPct(),
    tooltip: {
      ...TOOLTIP_BASE, trigger: 'item',
      formatter: (p) => {
        const [dte, iv, t, exp, strike, basis] = p.data || []
        return `${exp} (${dte}d) ATM ${num(strike)}: ${formatPercent(Number(iv), { decimals: 1 })}<br/>${basis} · quoted ${quoteClock(t, servedDay)}`
      },
    },
    series: term?.drawable ? [{
      type: 'line', name: 'ATM IV', symbolSize: 6, showSymbol: true,
      lineStyle: { color: CHART_INK.gold, width: 2 }, itemStyle: { color: CHART_INK.gold },
      data: pts.map((p) => [p.dte, +(p.atm_iv * 100).toFixed(2), p.t, p.expiration, p.atm_strike, p.atm_basis]),
    }] : [],
  }
}

/** 0..1 position of an IV inside the grid's own range, for the cell tint. */
export function heatOf(iv, lo, hi) {
  if (iv == null || !Number.isFinite(lo) || !Number.isFinite(hi)) return null
  return hi > lo ? (iv - lo) / (hi - lo) : 0.5
}
