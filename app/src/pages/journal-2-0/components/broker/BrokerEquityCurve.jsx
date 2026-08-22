/**
 * BrokerEquityCurve — the REAL account-value chart, drawn from the daily
 * net-liquidation snapshots the sync has been writing all along
 * (`GET /api/j2/broker/equity-curve` over j2_broker_equity_snapshots —
 * 1,514 rows backfilled 2026-08-20, one appended per sync day since).
 *
 * Self-gating: renders null with fewer than 2 points (manual-only accounts
 * never see an empty card). When a live net-liq is supplied (Open Positions
 * streaming summary), today's LIVE value is appended as a dashed gold point —
 * labeled live, never blended into the recorded history.
 *
 * `compact` renders the Analytics variant (shorter, same data).
 */

import { useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import useMobileSWR from '../../../../hooks/useMobileSWR'
import styles from './BrokerEquityCurve.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

const RANGES = [
  { key: '1M', days: 31 },
  { key: '3M', days: 93 },
  { key: '1Y', days: 366 },
  { key: 'ALL', days: 1830 },
]

const GOLD = '#c9a84c'
const GREEN = '#3cb868'
const RED = '#e74c3c'
const MUTED = '#8a8a8a'

const usd = (v) => (v == null ? '—' : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`)

export default function BrokerEquityCurve({ liveNetLiq = null, compact = false }) {
  const [range, setRange] = useState('3M')
  const days = RANGES.find((r) => r.key === range)?.days ?? 93

  const { data } = useMobileSWR(
    `/api/j2/broker/equity-curve?days=${days}`, fetcher,
    { revalidateOnFocus: false, refreshInterval: 0 },
  )
  const points = Array.isArray(data?.points) ? data.points : []

  const option = useMemo(() => {
    if (points.length < 2) return null
    const dates = points.map((p) => p.date)
    const equity = points.map((p) => p.equity)
    const first = equity.find((v) => v != null)
    const last = [...equity].reverse().find((v) => v != null)
    const up = last != null && first != null && last >= first
    const lineColor = up ? GREEN : RED

    // Live "now" point — dashed, separate series, never merged into history.
    let liveSeries = null
    if (liveNetLiq != null && Number.isFinite(liveNetLiq)) {
      dates.push('now')
      liveSeries = new Array(equity.length).fill(null)
      liveSeries[liveSeries.length - 1] = last
      liveSeries.push(liveNetLiq)
      equity.push(null)
    }

    return {
      grid: { left: 8, right: 12, top: 12, bottom: 24, containLabel: true },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#101013',
        borderColor: '#2a2a2e',
        textStyle: { color: '#e8e6e1', fontSize: 12 },
        formatter: (params) => {
          const p = points[params[0]?.dataIndex]
          if (!p) {
            return `<b>now</b><br/>Live net-liq: ${usd(liveNetLiq)}`
          }
          return `<b>${p.date}</b><br/>Equity: ${usd(p.equity)}<br/>` +
            `Cash: ${usd(p.cash)} · Positions: ${usd(p.marketValue)}`
        },
      },
      xAxis: {
        type: 'category', data: dates, boundaryGap: false,
        axisLine: { lineStyle: { color: '#2a2a2e' } },
        axisLabel: { color: MUTED, fontSize: 10 },
      },
      yAxis: {
        type: 'value', scale: true,
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
        axisLabel: { color: MUTED, fontSize: 10, formatter: (v) => `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` },
      },
      series: [
        {
          name: 'Account value', type: 'line', data: equity,
          smooth: true, symbol: 'none',
          lineStyle: { color: lineColor, width: 2 },
          areaStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: up ? 'rgba(60,184,104,0.25)' : 'rgba(231,76,60,0.25)' },
                { offset: 1, color: 'rgba(0,0,0,0)' },
              ],
            },
          },
        },
        ...(liveSeries ? [{
          name: 'Live', type: 'line', data: liveSeries, connectNulls: true,
          symbol: 'circle', symbolSize: 7,
          lineStyle: { color: GOLD, type: 'dashed' },
          itemStyle: { color: GOLD },
        }] : []),
      ],
    }
  }, [points, liveNetLiq])

  if (!option) return null

  const first = points.find((p) => p.equity != null)
  const last = [...points].reverse().find((p) => p.equity != null)
  const cur = (liveNetLiq != null && Number.isFinite(liveNetLiq)) ? liveNetLiq : last?.equity
  const change = (cur != null && first?.equity != null) ? cur - first.equity : null
  const changePct = (change != null && first.equity > 0) ? change / first.equity : null

  return (
    <div className={`${styles.card} ${compact ? styles.compact : ''}`}>
      <div className={styles.head}>
        <div className={styles.titleWrap}>
          <h4 className={styles.title}>Account Value</h4>
          {change != null && (
            <span className={`${styles.change} ${change >= 0 ? styles.pos : styles.neg}`}>
              {change >= 0 ? '+' : '-'}${Math.abs(change).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              {changePct != null && ` (${(changePct * 100).toFixed(1)}%)`}
              <span className={styles.rangeNote}> {range}</span>
            </span>
          )}
        </div>
        <div className={styles.pills}>
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`${styles.pill} ${range === r.key ? styles.pillOn : ''}`}
              onClick={() => setRange(r.key)}
            >
              {r.key}
            </button>
          ))}
        </div>
      </div>
      <ReactECharts option={option} style={{ height: compact ? 180 : 240 }} notMerge />
      <p className={styles.footnote}>
        Real broker net-liquidation, one point per synced day
        {liveNetLiq != null ? ' · gold point = live' : ''}.
      </p>
    </div>
  )
}
