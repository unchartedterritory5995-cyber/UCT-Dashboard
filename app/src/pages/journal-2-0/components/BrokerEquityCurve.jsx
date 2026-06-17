/**
 * BrokerEquityCurve — the user's REAL account equity curve, from broker
 * net-liquidation snapshots (cash + equity MV + option MV) recorded each sync.
 *
 * Self-contained SVG area chart (no chart-lib dependency) to keep the layout
 * simple + fast. Renders nothing until there are ≥2 daily points, so it's inert
 * for users who haven't connected a broker (or only synced once).
 */
import { useMemo, useState } from 'react'
import { money, moneySigned, percent } from '../../../lib/journal-2-0'
import useBrokerEquityCurve from '../hooks/useBrokerEquityCurve'
import styles from './BrokerEquityCurve.module.css'

const RANGES = [
  { label: '1M', days: 31 },
  { label: '3M', days: 93 },
  { label: '1Y', days: 365 },
  { label: 'All', days: 1825 },
]

export default function BrokerEquityCurve() {
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
    const change = last - first
    const changePct = first ? change / Math.abs(first) : null
    const up = change >= 0
    return { line, area, first, last, change, changePct, up, min, max }
  }, [points])

  // Inert until there's a curve to draw (no broker / single sync).
  if (!model) return null

  return (
    <section className={styles.card} aria-label="Account equity curve">
      <header className={styles.header}>
        <div>
          <div className={styles.title}>Account Equity</div>
          <div className={styles.value}>{money(model.last)}</div>
          <div className={`${styles.change} ${model.up ? styles.pos : styles.neg}`}>
            {moneySigned(model.change)}
            {model.changePct != null && (
              <span className={styles.changePct}>
                {' '}({percent(model.changePct, { signed: true, dp: 1, isRatio: true })})
              </span>
            )}
            <span className={styles.changeLabel}> · {range.label}</span>
          </div>
        </div>
        <div className={styles.ranges} role="tablist" aria-label="Equity curve range">
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

      <div className={styles.chartWrap}>
        <svg
          className={styles.svg}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={model.up ? 'var(--color-success)' : 'var(--color-danger)'} stopOpacity="0.28" />
              <stop offset="100%" stopColor={model.up ? 'var(--color-success)' : 'var(--color-danger)'} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={model.area} fill="url(#eqFill)" />
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
    </section>
  )
}
