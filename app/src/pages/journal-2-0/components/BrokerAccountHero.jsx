/**
 * BrokerAccountHero — broker-app-style summary at the top of Open Positions.
 * Dominant account value + Today / period P&L + large equity curve + a
 * secondary balances strip. Reuses useBrokerEquityCurve + the account object +
 * the already-computed portfolioAggregates (passed in, so no live-price refetch).
 * Renders null for non-broker accounts (the normal stats row renders below).
 */
import { useMemo, useState } from 'react'
import { money, moneySigned, percent } from '../../../lib/journal-2-0'
import useBrokerEquityCurve from '../hooks/useBrokerEquityCurve'
import styles from './BrokerAccountHero.module.css'

const RANGES = [
  { label: '1M', days: 31 },
  { label: '3M', days: 93 },
  { label: '1Y', days: 365 },
  { label: 'All', days: 1825 },
]

export default function BrokerAccountHero({ account, aggregates }) {
  const [range, setRange] = useState(RANGES[1]) // default 3M
  const { points, isLoading } = useBrokerEquityCurve(range.days)

  const model = useMemo(() => {
    if (!points || points.length < 2) return null
    const ys = points.map((p) => p.equity)
    const min = Math.min(...ys)
    const max = Math.max(...ys)
    const span = max - min || 1
    const n = points.length
    const coords = points.map((p, i) => ({
      x: (i / (n - 1)) * 100,
      y: 100 - ((p.equity - min) / span) * 100,
    }))
    const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(2)} ${c.y.toFixed(2)}`).join(' ')
    const area = `${line} L100 100 L0 100 Z`
    const first = points[0].equity
    const last = points[n - 1].equity
    const prev = points[n - 2].equity
    const change = last - first
    const todayChange = last - prev
    return {
      line, area,
      change, changePct: first ? change / Math.abs(first) : null, up: change >= 0,
      todayChange, todayPct: prev ? todayChange / Math.abs(prev) : null, todayUp: todayChange >= 0,
    }
  }, [points])

  const isBroker = account?.balanceSource === 'broker' && account?.brokerTotalEquity != null
  if (!isBroker) return null

  const marginUsed = account.brokerCash != null && account.brokerCash < 0 ? -account.brokerCash : 0

  return (
    <section className={styles.hero} aria-label="Account summary">
      <header className={styles.top}>
        <div className={styles.valueBlock}>
          <div className={styles.label}>Account Value</div>
          <div className={styles.value}>{money(account.brokerTotalEquity)}</div>
          <div className={styles.changes}>
            {model && (
              <span className={`${styles.change} ${model.todayUp ? styles.pos : styles.neg}`}>
                {model.todayUp ? '▲' : '▼'} {moneySigned(model.todayChange)}
                {model.todayPct != null && <>{' '}({percent(model.todayPct, { signed: true, dp: 1, isRatio: true })})</>}
                <span className={styles.changeLabel}> Today</span>
              </span>
            )}
            {model && (
              <span className={`${styles.change} ${model.up ? styles.pos : styles.neg}`}>
                {model.up ? '▲' : '▼'} {moneySigned(model.change)}
                {model.changePct != null && <>{' '}({percent(model.changePct, { signed: true, dp: 1, isRatio: true })})</>}
                <span className={styles.changeLabel}> · {range.label}</span>
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
