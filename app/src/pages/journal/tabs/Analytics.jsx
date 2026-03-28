// app/src/pages/journal/tabs/Analytics.jsx
import { useState, useMemo } from 'react'
import useSWR from 'swr'
import ReactECharts from 'echarts-for-react'
import StatCard from '../components/StatCard'
import styles from './Analytics.module.css'

const fetcher = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json() })

const DIMENSIONS = [
  { key: 'setup', label: 'Setup' },
  { key: 'symbol', label: 'Symbol' },
  { key: 'direction', label: 'Direction' },
  { key: 'day_of_week', label: 'Day of Week' },
  { key: 'session', label: 'Session' },
  { key: 'holding_period_bucket', label: 'Holding Period' },
  { key: 'process_score_bucket', label: 'Process Score' },
  { key: 'mistake_tag', label: 'Mistake' },
  { key: 'playbook', label: 'Playbook' },
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
]

const PERIODS = [
  { key: '7', label: '1W' },
  { key: '30', label: '1M' },
  { key: '90', label: '3M' },
  { key: '180', label: '6M' },
  { key: '365', label: '1Y' },
  { key: '', label: 'All' },
]

function fmtPnl(v) {
  if (v == null) return '--'
  return `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`
}

function fmtR(v) {
  if (v == null) return '--'
  return `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}R`
}

export default function Analytics() {
  const [dimension, setDimension] = useState('setup')
  const [periodDays, setPeriodDays] = useState('')

  const dateFrom = periodDays
    ? new Date(Date.now() - parseInt(periodDays) * 86400000).toISOString().slice(0, 10)
    : ''

  const queryParams = new URLSearchParams()
  queryParams.set('group_by', dimension)
  if (dateFrom) queryParams.set('date_from', dateFrom)

  const { data, error, isLoading } = useSWR(
    `/api/journal/analytics?${queryParams.toString()}`,
    fetcher,
    { refreshInterval: 120000, dedupingInterval: 30000, revalidateOnFocus: false }
  )

  const buckets = data?.buckets || []
  const totals = data?.totals
  const equityCurve = data?.equity_curve || []

  // ECharts equity curve option
  const chartOption = useMemo(() => {
    if (equityCurve.length < 2) return null
    return {
      backgroundColor: 'transparent',
      grid: {
        top: 30,
        right: 20,
        bottom: 60,
        left: 60,
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1a1c17',
        borderColor: '#2e3127',
        textStyle: {
          color: '#e0dac8',
          fontFamily: 'IBM Plex Mono',
          fontSize: 11,
        },
        formatter: (params) => {
          const p = params[0]
          if (!p) return ''
          const val = p.value[1]
          const color = val >= 0 ? '#3cb868' : '#e74c3c'
          return `<div style="font-size:10px;color:#706b5e;">${p.value[0]}</div>
            <div style="font-size:13px;font-weight:700;color:${color};">
              ${val >= 0 ? '+' : ''}${val.toFixed(2)}%
            </div>
            ${p.value[2] ? `<div style="font-size:10px;color:#706b5e;">${p.value[2]}</div>` : ''}`
        },
      },
      xAxis: {
        type: 'category',
        data: equityCurve.map(e => e.date),
        axisLine: { lineStyle: { color: '#2e3127' } },
        axisLabel: {
          color: '#706b5e',
          fontFamily: 'IBM Plex Mono',
          fontSize: 9,
          rotate: 45,
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: {
          color: '#706b5e',
          fontFamily: 'IBM Plex Mono',
          fontSize: 10,
          formatter: v => `${v >= 0 ? '+' : ''}${v}%`,
        },
        splitLine: { lineStyle: { color: '#2e312720' } },
      },
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
        {
          type: 'slider',
          height: 20,
          bottom: 8,
          borderColor: '#2e3127',
          fillerColor: 'rgba(201,168,76,0.1)',
          handleStyle: { color: '#c9a84c' },
          textStyle: { color: '#706b5e', fontFamily: 'IBM Plex Mono', fontSize: 9 },
        },
      ],
      series: [
        {
          type: 'line',
          data: equityCurve.map(e => [e.date, e.cum_pnl, e.sym]),
          smooth: false,
          symbol: 'none',
          lineStyle: { color: '#c9a84c', width: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(201,168,76,0.15)' },
                { offset: 1, color: 'rgba(201,168,76,0)' },
              ],
            },
          },
        },
      ],
    }
  }, [equityCurve])

  if (isLoading && !data) {
    return (
      <div className={styles.wrap}>
        <div className={styles.loading}>
          <div className={styles.loadingBar} />
          <span>Loading analytics...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.wrap}>
        <div className={styles.error}>
          Failed to load analytics. Check your connection.
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      {/* Dimension chip bar */}
      <div className={styles.dimBar}>
        {DIMENSIONS.map(d => (
          <button
            key={d.key}
            className={`${styles.dimChip} ${dimension === d.key ? styles.dimActive : ''}`}
            onClick={() => setDimension(d.key)}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Period selector */}
      <div className={styles.periodBar}>
        {PERIODS.map(p => (
          <button
            key={p.key}
            className={`${styles.periodBtn} ${periodDays === p.key ? styles.periodActive : ''}`}
            onClick={() => setPeriodDays(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Totals strip */}
      {totals && (
        <div className={styles.totalsStrip}>
          <StatCard label="Total Trades" value={totals.trade_count} format="number" accent="neutral" />
          <StatCard label="Net P&L" value={totals.total_pnl_pct} format="pct" accent="auto" />
          <StatCard label="Win Rate" value={totals.win_rate} format="pct" accent="neutral" />
          <StatCard label="Avg R" value={totals.avg_r} format="r" accent="auto" />
          <StatCard label="Profit Factor" value={totals.profit_factor} format="ratio" accent="neutral" />
        </div>
      )}

      {/* Results table */}
      {buckets.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>&#x25B3;</div>
          <div className={styles.emptyTitle}>No data for this period</div>
          <div className={styles.emptyText}>
            Try a longer time period or log more closed trades.
          </div>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>
                  {dimension === 'month' ? 'Month' : dimension === 'week' ? 'Week' : 'Bucket'}
                </th>
                <th className={`${styles.th} ${styles.thRight}`}>Trades</th>
                <th className={`${styles.th} ${styles.thRight}`}>Win %</th>
                <th className={`${styles.th} ${styles.thRight}`}>Avg P&L</th>
                <th className={`${styles.th} ${styles.thRight}`}>Total P&L</th>
                <th className={`${styles.th} ${styles.thRight}`}>Avg R</th>
                <th className={`${styles.th} ${styles.thRight}`}>PF</th>
                <th className={`${styles.th} ${styles.thRight}`}>Process</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map(b => {
                const wrClass = b.win_rate >= 55 ? styles.wrBarGood
                  : b.win_rate >= 40 ? styles.wrBarOk
                  : styles.wrBarBad

                return (
                  <tr key={b.key} className={styles.row}>
                    <td className={styles.bucketKey}>{b.key}</td>
                    <td className={styles.numCell}>{b.trade_count}</td>
                    <td className={styles.numCell}>
                      <div className={styles.wrBarWrap}>
                        <span>{b.win_rate}%</span>
                        <div className={styles.wrBar}>
                          <div
                            className={`${styles.wrBarFill} ${wrClass}`}
                            style={{ width: `${Math.min(b.win_rate, 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className={b.avg_pnl_pct >= 0 ? styles.pnlGain : styles.pnlLoss}>
                      {fmtPnl(b.avg_pnl_pct)}
                    </td>
                    <td className={b.total_pnl_pct >= 0 ? styles.pnlGain : styles.pnlLoss}>
                      {fmtPnl(b.total_pnl_pct)}
                    </td>
                    <td className={styles.muted}>{fmtR(b.avg_r)}</td>
                    <td className={styles.muted}>{b.profit_factor != null ? b.profit_factor.toFixed(2) : '--'}</td>
                    <td className={styles.muted}>
                      {b.avg_process_score != null ? Math.round(b.avg_process_score) : '--'}
                    </td>
                  </tr>
                )
              })}

              {/* Totals row */}
              {totals && (
                <tr className={`${styles.row} ${styles.rowTotals}`}>
                  <td className={styles.bucketKey}>TOTAL</td>
                  <td className={styles.numCell}>{totals.trade_count}</td>
                  <td className={styles.numCell}>{totals.win_rate}%</td>
                  <td className={totals.avg_pnl_pct >= 0 ? styles.pnlGain : styles.pnlLoss}>
                    {fmtPnl(totals.avg_pnl_pct)}
                  </td>
                  <td className={totals.total_pnl_pct >= 0 ? styles.pnlGain : styles.pnlLoss}>
                    {fmtPnl(totals.total_pnl_pct)}
                  </td>
                  <td className={styles.muted}>{fmtR(totals.avg_r)}</td>
                  <td className={styles.muted}>{totals.profit_factor != null ? totals.profit_factor.toFixed(2) : '--'}</td>
                  <td className={styles.muted}>
                    {totals.avg_process_score != null ? Math.round(totals.avg_process_score) : '--'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Equity curve chart */}
      {chartOption && (
        <div className={styles.chartSection}>
          <div className={styles.chartHeader}>Equity Curve (Cumulative P&L %)</div>
          <ReactECharts
            option={chartOption}
            style={{ height: 300 }}
            notMerge={true}
            lazyUpdate={true}
          />
        </div>
      )}
    </div>
  )
}
