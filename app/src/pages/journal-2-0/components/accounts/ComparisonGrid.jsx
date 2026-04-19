/**
 * Side-by-side per-account metrics. One card per account.
 */

import { colorHex } from '../../lib/accountColors'
import { money } from '../../../../lib/journal-2-0'
import styles from './ComparisonGrid.module.css'

const fmtPct = (v, dp = 1) => v == null ? '—' : `${(v * 100).toFixed(dp)}%`
const fmtPf = (v) => {
  if (v == null) return '∞'
  return v.toFixed(2)
}
const fmtSignedDollar = (v) => v == null ? '—' : (v >= 0 ? `+${money(v)}` : `-${money(Math.abs(v))}`)

export default function ComparisonGrid({ accounts = [], isLoading }) {
  if (isLoading && accounts.length === 0) {
    return <p className={styles.hint}>Loading comparison…</p>
  }
  if (accounts.length === 0) {
    return <p className={styles.empty}>No accounts to compare yet.</p>
  }
  return (
    <div className={styles.grid}>
      {accounts.map((a) => (
        <div key={a.id} className={styles.card} style={{ borderTopColor: colorHex(a.color) }}>
          <div className={styles.head}>
            <span className={styles.dot} style={{ background: colorHex(a.color) }} />
            <span className={styles.name}>{a.name}</span>
          </div>
          <div className={styles.balanceRow}>
            <span className={styles.balance}>{money(a.currentBalance)}</span>
            <span className={`${styles.return} ${a.totalReturn > 0 ? styles.pos : a.totalReturn < 0 ? styles.neg : ''}`}>
              {fmtPct(a.totalReturn, 2)}
            </span>
          </div>
          <div className={styles.metricsList}>
            <Row label="Total P&L" value={fmtSignedDollar(a.totalPnl)}
                 positive={a.totalPnl > 0} negative={a.totalPnl < 0} />
            <Row label="Trades" value={a.tradeCount} />
            <Row label="Win Rate" value={fmtPct(a.winRate)} />
            <Row label="Profit Factor" value={fmtPf(a.profitFactor)} />
            <Row label="Max DD" value={fmtSignedDollar(a.maxDrawdown)} negative={a.maxDrawdown < 0} />
            <Row label="Max DD %" value={fmtPct(a.maxDrawdownPct, 2)} negative={a.maxDrawdownPct < 0} />
            <Row label="Avg Win" value={a.avgWin == null ? '—' : `+${money(a.avgWin)}`} positive={a.avgWin > 0} />
            <Row label="Avg Loss" value={a.avgLoss == null ? '—' : money(a.avgLoss)} negative={a.avgLoss < 0} />
            <Row label="Expectancy" value={a.expectancy == null ? '—' : fmtSignedDollar(a.expectancy)}
                 positive={a.expectancy > 0} negative={a.expectancy < 0} />
          </div>
        </div>
      ))}
    </div>
  )
}

function Row({ label, value, positive, negative }) {
  return (
    <div className={styles.metricRow}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={`${styles.metricValue} ${positive ? styles.pos : ''} ${negative ? styles.neg : ''}`}>
        {value}
      </span>
    </div>
  )
}
