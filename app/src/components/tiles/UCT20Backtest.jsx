// app/src/components/tiles/UCT20Backtest.jsx
import { useState, useMemo } from 'react'
import useSWR from 'swr'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ReferenceLine, Cell,
} from 'recharts'
import styles from './UCT20Backtest.module.css'

const fetcher = url => fetch(url).then(r => r.json())

/* ── Helpers ─────────────────────────────────────────────────────────── */

function fmtPct(v, sign = true) {
  if (v == null) return '—'
  return `${sign && v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

function monthLabel(ym) {
  // "2026-03" → "Mar"
  const [, m] = ym.split('-')
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1] ?? ym
}

/* ── Monthly heatmap cell color ──────────────────────────────────────── */
function monthColor(pct) {
  if (pct >= 5) return 'var(--gain)'
  if (pct >= 2) return 'rgba(74,222,128,0.7)'
  if (pct >= 0) return 'rgba(74,222,128,0.35)'
  if (pct >= -2) return 'rgba(248,113,113,0.35)'
  if (pct >= -5) return 'rgba(248,113,113,0.7)'
  return 'var(--loss)'
}

function monthBg(pct) {
  if (pct >= 5) return 'rgba(10,50,22,0.8)'
  if (pct >= 2) return 'rgba(22,100,48,0.4)'
  if (pct >= 0) return 'rgba(74,222,128,0.08)'
  if (pct >= -2) return 'rgba(248,113,113,0.08)'
  if (pct >= -5) return 'rgba(160,25,25,0.4)'
  return 'rgba(55,6,6,0.8)'
}

/* ── Drawdown tooltip ────────────────────────────────────────────────── */
function DDTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipDate}>{label}</div>
      <div className={styles.tooltipRow}>
        <span>Drawdown</span>
        <span className={styles.loss}>{payload[0]?.value?.toFixed(2)}%</span>
      </div>
    </div>
  )
}

/* ── Alpha tooltip ───────────────────────────────────────────────────── */
function AlphaTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const v = payload[0]?.value
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipDate}>{label}</div>
      <div className={styles.tooltipRow}>
        <span>Alpha vs QQQ</span>
        <span className={v >= 0 ? styles.gain : styles.loss}>{fmtPct(v)}</span>
      </div>
    </div>
  )
}

/* ── Distribution tooltip ────────────────────────────────────────────── */
function DistTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipRow}>
        <span>{payload[0]?.payload?.bucket}</span>
        <span>{payload[0]?.value} trades</span>
      </div>
    </div>
  )
}

/* ── Distribution bar color ──────────────────────────────────────────── */
function distColor(bucket) {
  if (bucket.startsWith('<') || bucket.startsWith('-')) return 'var(--loss)'
  if (bucket.startsWith('0%')) return 'var(--text-muted)'
  return 'var(--gain)'
}

/* ═══════════════════════════════════════════════════════════════════════ */

export default function UCT20Backtest() {
  const { data, isLoading } = useSWR('/api/uct20/backtest', fetcher, { refreshInterval: 3600000 })
  const [open, setOpen] = useState(false)

  const hasData = !!data && !!data.equity_curve?.length

  const monthlyData = useMemo(() => data?.monthly_returns ?? [], [data])
  const drawdownData = useMemo(() => data?.drawdown_series ?? [], [data])
  const distData = useMemo(() => (data?.trade_distribution ?? []).filter(d => d.count > 0), [data])
  const alphaData = useMemo(() => data?.rolling_alpha ?? [], [data])

  if (isLoading || !hasData) return null

  return (
    <div className={styles.wrap}>
      <button className={styles.toggle} onClick={() => setOpen(o => !o)}>
        <span>BACKTEST ANALYTICS</span>
        <span className={styles.chevron}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className={styles.content}>

          {/* ── Key stats row ── */}
          <div className={styles.keyStats}>
            <div className={styles.keyStat}>
              <span className={styles.keyLabel}>MAX DRAWDOWN</span>
              <span className={`${styles.keyVal} ${styles.loss}`}>{fmtPct(data.max_drawdown, false)}</span>
            </div>
            <div className={styles.keyStat}>
              <span className={styles.keyLabel}>PROFIT FACTOR</span>
              <span className={styles.keyVal}>{data.profit_factor ?? '—'}</span>
            </div>
            <div className={styles.keyStat}>
              <span className={styles.keyLabel}>STOP-OUT RATE</span>
              <span className={styles.keyVal}>{data.stop_out_rate ?? 0}%</span>
            </div>
            <div className={styles.keyStat}>
              <span className={styles.keyLabel}>WIN STREAK</span>
              <span className={`${styles.keyVal} ${styles.gain}`}>{data.max_win_streak ?? 0}</span>
            </div>
            <div className={styles.keyStat}>
              <span className={styles.keyLabel}>LOSS STREAK</span>
              <span className={`${styles.keyVal} ${styles.loss}`}>{data.max_loss_streak ?? 0}</span>
            </div>
          </div>

          {/* ── Best / worst trades ── */}
          {(data.best_trade || data.worst_trade) && (
            <div className={styles.extremes}>
              {data.best_trade && (
                <div className={styles.extremeCard}>
                  <span className={styles.extremeLabel}>BEST TRADE</span>
                  <span className={styles.extremeSym}>{data.best_trade.symbol}</span>
                  <span className={`${styles.extremePct} ${styles.gain}`}>{fmtPct(data.best_trade.pct_return)}</span>
                  <span className={styles.extremeMeta}>{data.best_trade.days_held}d · {data.best_trade.entry_date?.slice(5)} → {data.best_trade.exit_date?.slice(5)}</span>
                </div>
              )}
              {data.worst_trade && (
                <div className={styles.extremeCard}>
                  <span className={styles.extremeLabel}>WORST TRADE</span>
                  <span className={styles.extremeSym}>{data.worst_trade.symbol}</span>
                  <span className={`${styles.extremePct} ${styles.loss}`}>{fmtPct(data.worst_trade.pct_return)}</span>
                  <span className={styles.extremeMeta}>{data.worst_trade.days_held}d · {data.worst_trade.entry_date?.slice(5)} → {data.worst_trade.exit_date?.slice(5)}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Monthly returns heatmap ── */}
          {monthlyData.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>MONTHLY RETURNS</div>
              <div className={styles.monthGrid}>
                {monthlyData.map(m => (
                  <div
                    key={m.month}
                    className={styles.monthCell}
                    style={{ background: monthBg(m.return_pct) }}
                  >
                    <span className={styles.monthName}>{monthLabel(m.month)}</span>
                    <span className={styles.monthPct} style={{ color: monthColor(m.return_pct) }}>
                      {fmtPct(m.return_pct)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Drawdown chart ── */}
          {drawdownData.length >= 2 && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>DRAWDOWN</div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height={120}>
                  <AreaChart data={drawdownData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--loss)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--loss)" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
                      tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={50}
                      tickFormatter={d => d?.slice(5)}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
                      tickLine={false} axisLine={false} width={36}
                      tickFormatter={v => `${v.toFixed(0)}%`}
                    />
                    <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />
                    <Tooltip content={<DDTooltip />} />
                    <Area dataKey="drawdown" stroke="var(--loss)" fill="url(#ddGrad)" strokeWidth={1.5} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Rolling alpha chart ── */}
          {alphaData.length >= 2 && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>CUMULATIVE ALPHA vs QQQ</div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height={120}>
                  <AreaChart data={alphaData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="alphaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--ut-gold)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--ut-gold)" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
                      tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={50}
                      tickFormatter={d => d?.slice(5)}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
                      tickLine={false} axisLine={false} width={36}
                      tickFormatter={v => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
                    />
                    <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />
                    <Tooltip content={<AlphaTooltip />} />
                    <Area dataKey="alpha" stroke="var(--ut-gold)" fill="url(#alphaGrad)" strokeWidth={1.5} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Trade distribution ── */}
          {distData.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>TRADE DISTRIBUTION</div>
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height={100}>
                  <BarChart data={distData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <XAxis
                      dataKey="bucket" tick={{ fontSize: 8, fill: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}
                      tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={30}
                    />
                    <YAxis hide />
                    <Tooltip content={<DistTooltip />} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      {distData.map((d, i) => (
                        <Cell key={i} fill={distColor(d.bucket)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
