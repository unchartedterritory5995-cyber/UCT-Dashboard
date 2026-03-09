// app/src/components/tiles/UCT20Performance.jsx
import { useState, useMemo } from 'react'
import useSWR from 'swr'
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, Tooltip, ReferenceLine,
} from 'recharts'
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
  const n = new Date()
  return `${n.getFullYear()}-01-01`
}

function filterByPeriod(curve, days) {
  if (!curve?.length) return []
  if (days === 0) return curve  // ALL
  const cutoff = days === null
    ? ytdStart()
    : new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  return curve.filter(pt => pt.date >= cutoff)
}

function buildChartData(equityCurve, spyCurve, accountSize, days) {
  const eq = filterByPeriod(equityCurve, days)
  if (!eq.length) return []

  // Build spy lookup
  const spyMap = {}
  if (spyCurve?.length) {
    for (const pt of spyCurve) spyMap[pt.date] = pt.pct
  }

  // Normalise UCT20 to % from the first visible point
  const firstVal = eq[0].value
  return eq.map(pt => {
    const uct20Pct = firstVal > 0 ? ((pt.value / firstVal) - 1) * 100 : 0
    const spyPct   = spyMap[pt.date] ?? null
    // Adjust spy to be relative to the same start point
    const spyBase  = spyMap[eq[0].date] ?? 0
    const spyAdj   = spyPct !== null ? spyPct - spyBase : null
    return {
      date:   pt.date,
      uct20:  parseFloat(uct20Pct.toFixed(2)),
      spy:    spyAdj !== null ? parseFloat(spyAdj.toFixed(2)) : null,
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
  const spy   = payload.find(p => p.dataKey === 'spy')
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipDate}>{label}</div>
      {uct20 && (
        <div className={styles.tooltipRow}>
          <span className={styles.tooltipDotGreen}/>
          <span>UCT 20</span>
          <span className={uct20.value >= 0 ? styles.gain : styles.loss}>
            {fmtPct(uct20.value)}
          </span>
        </div>
      )}
      {spy && spy.value != null && (
        <div className={styles.tooltipRow}>
          <span className={styles.tooltipDotGray}/>
          <span>S&P 500</span>
          <span className={spy.value >= 0 ? styles.gain : styles.loss}>
            {fmtPct(spy.value)}
          </span>
        </div>
      )}
    </div>
  )
}

export default function UCT20Performance() {
  const { data, isLoading } = useSWR('/api/uct20/portfolio', fetcher, {
    refreshInterval: 3600000,
  })
  const [period, setPeriod] = useState('ALL')

  const periodDays = PERIODS.find(p => p.label === period)?.days ?? 0

  const chartData = useMemo(() => {
    if (!data?.equity_curve) return []
    return buildChartData(
      data.equity_curve,
      data.spy_curve,
      data.account_size ?? 50000,
      periodDays,
    )
  }, [data, periodDays])

  // Header numbers: total return from the filtered window
  const uct20WindowPct = chartData.length >= 2
    ? chartData[chartData.length - 1].uct20
    : (data?.total_return_pct ?? null)
  const spyWindowPct = chartData.length >= 2
    ? chartData[chartData.length - 1].spy
    : null

  const hasData = !!data && Object.keys(data).length > 0

  return (
    <div className={styles.wrap}>
      {/* ── Section header ── */}
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>UCT 20 PORTFOLIO TRACKER</span>
        <span className={styles.sectionSub}>$50K equal-weight · enters/exits with list</span>
      </div>

      {isLoading && <p className={styles.loading}>Loading portfolio data…</p>}

      {!isLoading && !hasData && (
        <p className={styles.loading}>
          No portfolio data yet — run the Morning Wire engine to populate.
        </p>
      )}

      {!isLoading && hasData && (
        <>
          {/* ── Performance header (Holdings vs US Market) ── */}
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
              <span className={styles.perfLabel}>US Market</span>
              <span className={`${styles.perfPct} ${spyWindowPct != null && spyWindowPct >= 0 ? styles.gain : styles.loss}`}>
                {fmtPct(spyWindowPct)}
              </span>
            </div>
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
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    minTickGap={50}
                    tickFormatter={d => d?.slice(5)}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
                    tickLine={false}
                    axisLine={false}
                    width={36}
                    tickFormatter={v => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
                  />
                  <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    dataKey="spy"
                    stroke="var(--text-muted)"
                    strokeWidth={1.5}
                    dot={false}
                    strokeDasharray="4 3"
                    connectNulls
                  />
                  <Line
                    dataKey="uct20"
                    stroke="var(--ut-green-bright)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className={styles.loading}>Not enough data points for selected period.</p>
          )}

          {/* ── Stats grid ── */}
          <div className={styles.statsGrid}>
            <div className={styles.stat}>
              <span className={styles.statLabel}>CURRENT VALUE</span>
              <span className={styles.statVal}>
                ${(data.current_value ?? 50000).toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>TOTAL P&amp;L</span>
              <span className={`${styles.statVal} ${(data.total_pnl ?? 0) >= 0 ? styles.gain : styles.loss}`}>
                {fmtDollar(data.total_pnl)}
              </span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>WIN RATE</span>
              <span className={styles.statVal}>{data.win_rate ?? '—'}%</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>OPEN POSITIONS</span>
              <span className={styles.statVal}>{data.open_count ?? 0} / 20</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>AVG HOLD</span>
              <span className={styles.statVal}>{data.avg_hold_days ?? '—'}d</span>
            </div>
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
                    <span className={`${styles.openPct} ${pos.pct_return >= 0 ? styles.gain : styles.loss}`}>
                      {fmtPct(pos.pct_return)}
                    </span>
                    <span className={styles.openDays}>{pos.days_held}d</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
