/**
 * Broker performance panel — cash-flow-adjusted returns for a broker account.
 * User-selectable headline metric (TWR / Money-Weighted / Simple / $ P&L) +
 * summary line items + equity curve with deposit/withdrawal markers + the
 * secondary-transactions list. Mounted in AnalyticsTab for broker accounts.
 */

import { useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { CHART_FONT_FAMILY } from '../../../utils/chartFont'
import { money, moneySigned, effectiveBrokerCash } from '../../../lib/journal-2-0'
import useJ2BrokerPerformance from '../hooks/useJ2BrokerPerformance'

const METRICS = [
  { key: 'twr', label: 'Time-Weighted', field: 'timeWeighted', kind: 'pct' },
  { key: 'mwr', label: 'Money-Weighted', field: 'moneyWeighted', kind: 'pct' },
  { key: 'simple', label: 'Simple', field: 'simple', kind: 'pct' },
  { key: 'dollar', label: '$ P&L', field: 'dollarPnl', kind: 'money' },
]
const PERIODS = ['1W', '1M', '3M', 'YTD', '1Y', 'ALL']
const PREF_KEY = 'j2_perf_metric'
const TX_PREF_KEY = 'j2_perf_tx_open'

const GOLD = 'var(--ut-gold, #c9a84c)'
const GREEN = 'var(--color-success, #4ade80)'
const RED = 'var(--color-danger, #f87171)'

function fmtPct(v) {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
}

function Stat({ label, value, tone }) {
  const color = tone === 'pos' ? GREEN : tone === 'neg' ? RED : 'var(--text-bright)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color }}>{value}</span>
    </div>
  )
}

export default function PerformancePanel({ accountId, account }) {
  const [metric, setMetric] = useState(() => localStorage.getItem(PREF_KEY) || 'twr')
  const [period, setPeriod] = useState('ALL')
  const [showTx, setShowTx] = useState(() => localStorage.getItem(TX_PREF_KEY) === '1')
  const { data, isLoading, error } = useJ2BrokerPerformance(accountId, period)

  const pickMetric = (k) => {
    setMetric(k)
    try { localStorage.setItem(PREF_KEY, k) } catch { /* ignore */ }
  }
  const toggleTx = () => {
    setShowTx((v) => {
      const next = !v
      try { localStorage.setItem(TX_PREF_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }
  const active = METRICS.find((m) => m.key === metric) || METRICS[0]

  if (error) return <div style={{ color: RED, padding: 16 }}>Couldn&apos;t load performance.</div>
  if (isLoading || !data) return <div style={{ opacity: 0.6, padding: 16 }}>Loading performance…</div>

  const headVal = data[active.field]
  const headline = active.kind === 'money' ? moneySigned(headVal) : fmtPct(headVal)
  const headColor = (headVal ?? 0) >= 0 ? GREEN : RED

  const series = data.equitySeries || []
  const flowMarks = (data.flows || []).filter((f) => f.isExternal).map((f) => ({
    xAxis: f.date,
    yAxis: (series.find((p) => p.date === f.date) || {}).value ?? null,
    symbol: 'triangle',
    symbolRotate: f.amount >= 0 ? 0 : 180,
    itemStyle: { color: f.amount >= 0 ? GREEN : RED },
  }))
  // Fill-derived live cash when the backend serves it; sync-stale otherwise.
  const brokerCash = effectiveBrokerCash(account)

  const option = {
    grid: { left: 56, right: 16, top: 16, bottom: 28 },
    textStyle: { fontFamily: CHART_FONT_FAMILY },
    xAxis: { type: 'category', data: series.map((p) => p.date), boundaryGap: false },
    yAxis: { type: 'value', scale: true, axisLabel: { formatter: (v) => money(v) } },
    tooltip: { trigger: 'axis', valueFormatter: (v) => money(v) },
    series: [{
      type: 'line', smooth: true, showSymbol: false,
      data: series.map((p) => p.value),
      lineStyle: { color: GOLD },
      areaStyle: { opacity: 0.08, color: GOLD },
      markPoint: { data: flowMarks, symbolSize: 13 },
    }],
  }

  const btn = (activeIt) => ({
    padding: '4px 10px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
    border: activeIt ? `1px solid ${GOLD}` : '1px solid var(--border, #333)',
    background: activeIt ? 'rgba(201,168,76,0.12)' : 'transparent',
    color: activeIt ? GOLD : 'var(--text-muted)',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16,
                  border: '1px solid var(--border, #333)', borderRadius: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <strong style={{ fontSize: 14 }}>
          Performance
          {data.estimated && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
              {' '}· includes estimated history
            </span>
          )}
        </strong>
        <div style={{ display: 'flex', gap: 4 }}>
          {PERIODS.map((p) => (
            <button key={p} type="button" onClick={() => setPeriod(p)} style={btn(period === p)}>{p}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {METRICS.map((m) => (
          <button key={m.key} type="button" onClick={() => pickMetric(m.key)}
                  aria-pressed={metric === m.key} style={btn(metric === m.key)}>
            {m.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 30, fontWeight: 700, color: headColor }}>{headline}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{active.label} · {period}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 12 }}>
        <Stat label="$ P&L" value={moneySigned(data.dollarPnl)} tone={data.dollarPnl >= 0 ? 'pos' : 'neg'} />
        <Stat label="Net Deposits" value={money(data.netDeposits)} />
        <Stat label="Net Withdrawals" value={money(Math.abs(data.netWithdrawals || 0))} />
        <Stat label="Dividends" value={money(data.dividends)} />
        <Stat label="Interest" value={moneySigned(data.interest)} tone={data.interest < 0 ? 'neg' : undefined} />
        <Stat label="Fees" value={moneySigned(data.fees)} tone={data.fees < 0 ? 'neg' : undefined} />
      </div>

      {account && (account.brokerBuyingPower != null || brokerCash != null) && (
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap',
                      paddingTop: 4, borderTop: '1px solid var(--border, #2a2a2a)' }}>
          {account.brokerBuyingPower != null && (
            <Stat label="Buying Power" value={money(account.brokerBuyingPower)} />
          )}
          <Stat
            label="Margin Used"
            value={money(brokerCash < 0 ? -brokerCash : 0)}
            tone={brokerCash < 0 ? 'neg' : undefined}
          />
        </div>
      )}

      <ReactECharts option={option} style={{ height: 240 }} />

      <div>
        {(data.flows || []).length === 0 ? (
          <>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Transactions</div>
            <div style={{ fontSize: 12, opacity: 0.6 }}>No cash flows in this period.</div>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={toggleTx}
              aria-expanded={showTx}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                background: 'transparent', border: 'none', padding: '2px 0', cursor: 'pointer',
                fontSize: 12, color: 'var(--text-muted)', textAlign: 'left',
              }}
            >
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5"
                style={{ transform: showTx ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}
                aria-hidden="true"
              >
                <polyline points="9 6 15 12 9 18" />
              </svg>
              <span>Transactions ({data.flows.length})</span>
            </button>
            {showTx && (
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginTop: 6 }}>
                <tbody>
                  {data.flows.map((f, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border, #2a2a2a)' }}>
                      <td style={{ padding: '5px 8px', color: 'var(--text-muted)' }}>{f.date}</td>
                      <td style={{ padding: '5px 8px', textTransform: 'capitalize' }}>{f.type}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: f.amount >= 0 ? GREEN : RED }}>
                        {moneySigned(f.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  )
}
