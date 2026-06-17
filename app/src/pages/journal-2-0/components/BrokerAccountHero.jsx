/**
 * BrokerAccountHero — broker-app-style summary at the top of Open Positions.
 * Dominant account value + Today / period P&L + large equity curve + a
 * secondary balances strip.
 *
 * Curve + period P&L come from the cash-flow-adjusted performance engine
 * (/api/j2/broker/performance → equitySeries), which includes ESTIMATED
 * pre-snapshot history walked back through realized trades — so the curve is
 * populated from day one and converges to accurate daily net-liq snapshots over
 * time. Account value/cash/buying-power come straight from the account object;
 * Open P&L / Invested% from the already-computed portfolioAggregates (passed in,
 * so no live-price refetch). Renders null for non-broker accounts.
 */
import { useMemo, useState } from 'react'
import { money, moneySigned, percent } from '../../../lib/journal-2-0'
import useJ2BrokerPerformance from '../hooks/useJ2BrokerPerformance'
import styles from './BrokerAccountHero.module.css'

const RANGES = [
  { label: '1M', period: '1M' },
  { label: '3M', period: '3M' },
  { label: '1Y', period: '1Y' },
  { label: 'All', period: 'ALL' },
]

export default function BrokerAccountHero({ account, aggregates }) {
  const [range, setRange] = useState(RANGES[1]) // default 3M
  const { data, isLoading } = useJ2BrokerPerformance(account?.id, range.period)

  const model = useMemo(() => {
    const series = data?.equitySeries || []
    if (series.length < 2) return null
    const ys = series.map((p) => p.value)
    const min = Math.min(...ys)
    const max = Math.max(...ys)
    const span = max - min || 1
    const n = series.length
    const coords = series.map((p, i) => ({
      x: (i / (n - 1)) * 100,
      y: 100 - ((p.value - min) / span) * 100,
    }))
    const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(2)} ${c.y.toFixed(2)}`).join(' ')
    const area = `${line} L100 100 L0 100 Z`
    // Today = change across the last two REAL (non-estimated) daily snapshots.
    const real = series.filter((p) => !p.estimated)
    let todayChange = null
    let todayPct = null
    if (real.length >= 2) {
      const prev = real[real.length - 2].value
      todayChange = real[real.length - 1].value - prev
      todayPct = prev ? todayChange / Math.abs(prev) : null
    }
    // Curve color follows the period return (deposit-adjusted).
    const up = (data?.timeWeighted ?? data?.dollarPnl ?? 0) >= 0
    return {
      line, area, up,
      todayChange, todayPct, todayUp: (todayChange ?? 0) >= 0,
      estimated: series.some((p) => p.estimated),
    }
  }, [data])

  const isBroker = account?.balanceSource === 'broker' && account?.brokerTotalEquity != null
  if (!isBroker) return null

  const marginUsed = account.brokerCash != null && account.brokerCash < 0 ? -account.brokerCash : 0
  const periodPnl = data?.dollarPnl
  const periodPct = data?.timeWeighted

  return (
    <section className={styles.hero} aria-label="Account summary">
      <header className={styles.top}>
        <div className={styles.valueBlock}>
          <div className={styles.label}>Account Value</div>
          <div className={styles.value}>{money(account.brokerTotalEquity)}</div>
          <div className={styles.changes}>
            {model && model.todayChange != null && (
              <span className={`${styles.change} ${model.todayUp ? styles.pos : styles.neg}`}>
                {model.todayUp ? '▲' : '▼'} {moneySigned(model.todayChange)}
                {model.todayPct != null && <>{' '}({percent(model.todayPct, { signed: true, dp: 1, isRatio: true })})</>}
                <span className={styles.changeLabel}> Today</span>
              </span>
            )}
            {periodPnl != null && (
              <span className={`${styles.change} ${periodPnl >= 0 ? styles.pos : styles.neg}`}>
                {periodPnl >= 0 ? '▲' : '▼'} {moneySigned(periodPnl)}
                {periodPct != null && <>{' '}({percent(periodPct, { signed: true, dp: 1, isRatio: true })})</>}
                <span className={styles.changeLabel}> · {range.label}{model?.estimated ? ' · est.' : ''}</span>
              </span>
            )}
          </div>
        </div>
        <div className={styles.ranges} role="tablist" aria-label="Range">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              role="tab"
              aria-selected={r.label === range.label}
              className={`${styles.rangeBtn} ${r.label === range.label ? styles.rangeActive : ''}`}
              onClick={() => setRange(r)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {model && (
        <div className={styles.chartWrap}>
          <svg className={styles.svg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={model.up ? 'var(--color-success)' : 'var(--color-danger)'} stopOpacity="0.28" />
                <stop offset="100%" stopColor={model.up ? 'var(--color-success)' : 'var(--color-danger)'} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={model.area} fill="url(#heroFill)" />
            <path
              d={model.line}
              fill="none"
              stroke={model.up ? 'var(--color-success)' : 'var(--color-danger)'}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
          {isLoading && <span className={styles.loading}>…</span>}
        </div>
      )}

      <div className={styles.strip}>
        <Metric label="Open P&L" value={moneySigned(aggregates?.unrealized ?? 0)}
                tone={(aggregates?.unrealized ?? 0) >= 0 ? 'pos' : 'neg'} />
        {account.brokerCash != null && <Metric label="Cash" value={money(account.brokerCash)} />}
        {account.brokerBuyingPower != null && <Metric label="Buying Power" value={money(account.brokerBuyingPower)} />}
        <Metric label="Margin Used" value={money(marginUsed)} tone={marginUsed > 0 ? 'neg' : undefined} />
        <Metric label="Invested"
                value={aggregates?.invested == null ? '—' : percent(aggregates.invested, { dp: 1 })} />
      </div>
    </section>
  )
}

function Metric({ label, value, tone }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={`${styles.metricValue} ${tone === 'pos' ? styles.pos : tone === 'neg' ? styles.neg : ''}`}>
        {value}
      </span>
    </div>
  )
}
