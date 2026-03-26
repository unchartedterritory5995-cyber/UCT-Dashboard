// app/src/components/tiles/UCT20Performance.jsx
import { useState, useMemo } from 'react'
import useMobileSWR from '../../hooks/useMobileSWR'
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, Tooltip, ReferenceLine,
} from 'recharts'
import { SkeletonChart } from '../Skeleton'
import styles from './UCT20Performance.module.css'

const fetcher = url => fetch(url).then(r => r.json())

const PERIODS = [
  { label: '7D',  days: 7   },
  { label: '1M',  days: 30  },
  { label: '3M',  days: 90  },
  { label: 'YTD', days: null },
  { label: 'ALL', days: 0   },
]

function ytdStart() {
  return `${new Date().getFullYear()}-01-01`
}

function filterByPeriod(curve, days) {
  if (!curve?.length) return []
  if (days === 0) return curve
  const cutoff = days === null
    ? ytdStart()
    : new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  return curve.filter(pt => pt.date >= cutoff)
}

function buildChartData(equityCurve, qqqCurve, days) {
  const eq = filterByPeriod(equityCurve, days)
  if (!eq.length) return []

  const qqqMap = {}
  if (qqqCurve?.length) {
    for (const pt of qqqCurve) qqqMap[pt.date] = pt.pct
  }

  const firstVal  = eq[0].value
  const qqqBase   = qqqMap[eq[0].date] ?? 0

  return eq.map(pt => {
    const uct20Pct = firstVal > 0 ? ((pt.value / firstVal) - 1) * 100 : 0
    const qqqRaw   = qqqMap[pt.date] ?? null
    const qqqAdj   = qqqRaw !== null ? qqqRaw - qqqBase : null
    return {
      date:  pt.date,
      uct20: parseFloat(uct20Pct.toFixed(2)),
      qqq:   qqqAdj !== null ? parseFloat(qqqAdj.toFixed(2)) : null,
    }
  })
}

function fmtPct(v, sign = true) {
  if (v == null) return '—'
  return `${sign && v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

function fmtDollar(v) {
  if (v == null) return '—'
  const abs = Math.abs(v)
  return `${v < 0 ? '-' : '+'}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const uct20 = payload.find(p => p.dataKey === 'uct20')
  const qqq   = payload.find(p => p.dataKey === 'qqq')
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipDate}>{label}</div>
      {uct20 && (
        <div className={styles.tooltipRow}>
          <span className={styles.tooltipDotGreen} />
          <span>UCT 20</span>
          <span className={uct20.value >= 0 ? styles.gain : styles.loss}>{fmtPct(uct20.value)}</span>
        </div>
      )}
      {qqq && qqq.value != null && (
        <div className={styles.tooltipRow}>
          <span className={styles.tooltipDotGray} />
          <span>QQQ</span>
          <span className={qqq.value >= 0 ? styles.gain : styles.loss}>{fmtPct(qqq.value)}</span>
        </div>
      )}
    </div>
  )
}

function StatBox({ label, value, className }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={`${styles.statVal} ${className ?? ''}`}>{value}</span>
    </div>
  )
}

export default function UCT20Performance() {
  const { data, isLoading } = useMobileSWR('/api/uct20/portfolio', fetcher, { refreshInterval: 3600000 })
  const [period, setPeriod]       = useState('ALL')
  const [tradesOpen, setTradesOpen] = useState(false)

  const periodDays = PERIODS.find(p => p.label === period)?.days ?? 0

  const chartData = useMemo(() => {
    if (!data?.equity_curve) return []
    return buildChartData(data.equity_curve, data.qqq_curve, periodDays)
  }, [data, periodDays])

  const uct20WindowPct = chartData.length >= 2 ? chartData[chartData.length - 1].uct20 : (data?.total_return_pct ?? null)
  const qqqWindowPct   = chartData.length >= 2 ? chartData[chartData.length - 1].qqq   : null
  const alpha          = data?.alpha_vs_qqq ?? (uct20WindowPct != null && qqqWindowPct != null ? uct20WindowPct - qqqWindowPct : null)

  const hasData = !!data && Object.keys(data).length > 0
  const trades  = data?.trades ?? []

  return (
    <div className={styles.wrap}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>UCT 20 PORTFOLIO TRACKER</span>
        <span className={styles.sectionSub}>$50K equal-weight · -6% hard stop · buys/sells at market open</span>
      </div>

      {isLoading && <SkeletonChart height={200} />}
      {!isLoading && !hasData && (
        <p className={styles.loading}>No portfolio data yet — run the Morning Wire engine to populate.</p>
      )}

      {!isLoading && hasData && (
        <>
          {/* ── Performance header ── */}
          <div className={styles.perfHeader}>
            <div className={styles.perfStat}>
              <span className={styles.perfDotGreen} />
              <span className={styles.perfLabel}>Holdings</span>
              <span className={`${styles.perfPct} ${uct20WindowPct != null && uct20WindowPct >= 0 ? styles.gain : styles.loss}`}>
                {fmtPct(uct20WindowPct)}
              </span>
            </div>
            <div className={styles.perfStat}>
              <span className={styles.perfDotGray} />
              <span className={styles.perfLabel}>QQQ</span>
              <span className={`${styles.perfPct} ${qqqWindowPct != null && qqqWindowPct >= 0 ? styles.gain : styles.loss}`}>
                {fmtPct(qqqWindowPct)}
              </span>
            </div>
            {alpha != null && (
              <div className={styles.perfStat}>
                <span className={styles.perfLabel}>Alpha</span>
                <span className={`${styles.perfPct} ${styles.perfAlpha} ${alpha >= 0 ? styles.gain : styles.loss}`}>
                  {fmtPct(alpha)}
                </span>
              </div>
            )}
            <div className={styles.perfPeriods}>
              {PERIODS.map(p => (
                <button
                  key={p.label}
                  className={`${styles.periodBtn} ${period === p.label ? styles.periodActive : ''}`}
                  onClick={() => setPeriod(p.label)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Chart ── */}
          {chartData.length >= 2 ? (
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
                    tickLine={false} axisLine={false}
                    interval="preserveStartEnd" minTickGap={50}
                    tickFormatter={d => d?.slice(5)}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
                    tickLine={false} axisLine={false} width={36}
                    tickFormatter={v => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
                  />
                  <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />
                  <Tooltip content={<CustomTooltip />} />
                  <Line dataKey="qqq"   stroke="var(--text-muted)"      strokeWidth={1.5} dot={false} strokeDasharray="4 3" connectNulls />
                  <Line dataKey="uct20" stroke="var(--ut-green-bright)" strokeWidth={2}   dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className={styles.loading}>Not enough data points for selected period.</p>
          )}

          {/* ── Stats grid ── */}
          <div className={styles.statsGrid}>
            <StatBox label="CURRENT VALUE"
              value={`$${(data.current_value ?? 50000).toLocaleString('en-US', { maximumFractionDigits: 0 })}`} />
            <StatBox label="TOTAL P&L"
              value={fmtDollar(data.total_pnl)}
              className={(data.total_pnl ?? 0) >= 0 ? styles.gain : styles.loss} />
            <StatBox label="ALPHA vs QQQ"
              value={fmtPct(data.alpha_vs_qqq)}
              className={data.alpha_vs_qqq != null && data.alpha_vs_qqq >= 0 ? styles.gain : styles.loss} />
            <StatBox label="WIN RATE"       value={`${data.win_rate ?? '—'}%`} />
            <StatBox label="AVG WIN"
              value={fmtPct(data.avg_win_pct)}
              className={styles.gain} />
            <StatBox label="AVG LOSS"
              value={fmtPct(data.avg_loss_pct)}
              className={styles.loss} />
            <StatBox label="OPEN POSITIONS" value={`${data.open_count ?? 0} / 20`} />
            <StatBox label="AVG HOLD"       value={`${data.avg_hold_days ?? '—'}d`} />
          </div>

          {/* ── Open positions ── */}
          {data.open_positions?.length > 0 && (
            <div className={styles.openWrap}>
              <div className={styles.openHeader}>OPEN POSITIONS ({data.open_positions.length})</div>
              <div className={styles.openList}>
                {data.open_positions.map(pos => (
                  <div key={pos.symbol} className={styles.openRow}>
                    <span className={styles.openSym}>{pos.symbol}</span>
                    <span className={styles.openEntry}>${pos.entry_price}</span>
                    {pos.stop_price != null && (
                      <span className={styles.openStop}>stop ${pos.stop_price}</span>
                    )}
                    <span className={`${styles.openPct} ${pos.pct_return >= 0 ? styles.gain : styles.loss}`}>
                      {fmtPct(pos.pct_return)}
                    </span>
                    <span className={styles.openDays}>{pos.days_held}d</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Trades dropdown ── */}
          {trades.length > 0 && (
            <div className={styles.tradesWrap}>
              <button
                className={styles.tradesToggle}
                onClick={() => setTradesOpen(o => !o)}
              >
                <span>ALL TRADES ({trades.length})</span>
                <span className={styles.tradesChevron}>{tradesOpen ? '▾' : '▸'}</span>
              </button>

              {tradesOpen && (
                <div className={styles.tradesTableScroll}>
                  <div className={styles.tradesTable}>
                    <div className={styles.tradesHead}>
                      <span>SYM</span>
                      <span>ENTRY</span>
                      <span>EXIT</span>
                      <span className={styles.alignRight}>ENTRY $</span>
                      <span className={styles.alignRight}>EXIT $</span>
                      <span className={styles.alignRight}>RETURN</span>
                      <span className={styles.alignRight}>DAYS</span>
                      <span className={styles.alignRight}>REASON</span>
                    </div>
                    {trades.map((t, i) => (
                      <div key={i} className={`${styles.tradesRow} ${t.win ? styles.tradeWin : styles.tradeLoss}`}>
                        <span className={styles.tradeSym}>{t.symbol}</span>
                        <span>{t.entry_date?.slice(5)}</span>
                        <span>{t.exit_date?.slice(5)}</span>
                        <span className={styles.alignRight}>${t.entry_price}</span>
                        <span className={styles.alignRight}>${t.exit_price}</span>
                        <span className={`${styles.alignRight} ${t.win ? styles.gain : styles.loss}`}>
                          {fmtPct(t.pct_return)}
                        </span>
                        <span className={styles.alignRight}>{t.days_held}d</span>
                        <span className={`${styles.alignRight} ${t.exit_reason === 'stop_loss' ? styles.stopTag : styles.listTag}`}>
                          {t.exit_reason === 'stop_loss' ? 'STOP' : 'LIST'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
