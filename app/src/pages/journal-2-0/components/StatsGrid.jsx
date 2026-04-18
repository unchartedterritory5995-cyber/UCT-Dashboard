/**
 * Trade Journal stats grid — 6×2 = 12 stat cards.
 * Spec §11.1, §14.6.
 *
 * Pure presentational. Consumes a summary object from `summaryStats()`
 * in calculations.js. BE trades excluded from Win Rate, Avg Win, Avg
 * Loss per §14.6 — the summary object already honors this.
 */

import {
  money,
  moneySigned,
  percent,
  profitFactor as formatPF,
  holdDaysDisplay,
} from '../../../lib/journal-2-0'
import styles from './StatsGrid.module.css'

function Card({ label, value, sublabel, valueClass }) {
  return (
    <div className={styles.card}>
      <div className={styles.label}>{label}</div>
      <div className={`${styles.value} ${valueClass || ''}`}>{value}</div>
      {sublabel && <div className={styles.sublabel}>{sublabel}</div>}
    </div>
  )
}

export default function StatsGrid({ summary }) {
  if (!summary) {
    return <div className={styles.empty}>No data</div>
  }

  const hasTrades = summary.totalTrades > 0
  const dash = '—'

  return (
    <div className={styles.grid} role="group" aria-label="Trade summary stats">
      <Card
        label="Total Trades"
        value={summary.totalTrades}
        sublabel={
          hasTrades
            ? `${summary.wins}W / ${summary.losses}L / ${summary.bes}BE`
            : null
        }
      />
      <Card
        label="Win Rate"
        value={summary.winRate == null ? dash : percent(summary.winRate, { dp: 1, isRatio: false })}
      />
      <Card
        label="Avg Win"
        value={summary.avgWinPercent == null ? dash : percent(summary.avgWinPercent, { dp: 2, signed: true })}
        valueClass={summary.avgWinPercent != null ? styles.pos : ''}
      />
      <Card
        label="Avg Loss"
        value={summary.avgLossPercent == null ? dash : percent(summary.avgLossPercent, { dp: 2, signed: true })}
        valueClass={summary.avgLossPercent != null ? styles.neg : ''}
      />
      <Card
        label="Avg P&L / Trade"
        value={summary.avgPnlPerTrade == null ? dash : moneySigned(summary.avgPnlPerTrade)}
        valueClass={
          summary.avgPnlPerTrade > 0
            ? styles.pos
            : summary.avgPnlPerTrade < 0
              ? styles.neg
              : ''
        }
      />
      <Card
        label="Profit Factor"
        value={hasTrades ? formatPF(summary.profitFactor) : dash}
      />
      <Card
        label="Total P&L"
        value={hasTrades ? moneySigned(summary.totalPnl) : dash}
        valueClass={
          summary.totalPnl > 0 ? styles.pos : summary.totalPnl < 0 ? styles.neg : ''
        }
      />
      <Card
        label="Largest Win"
        value={hasTrades && summary.largestWin > 0 ? money(summary.largestWin) : dash}
        valueClass={summary.largestWin > 0 ? styles.pos : ''}
      />
      <Card
        label="Largest Loss"
        value={hasTrades && summary.largestLoss < 0 ? money(summary.largestLoss) : dash}
        valueClass={summary.largestLoss < 0 ? styles.neg : ''}
      />
      <Card
        label="Avg Hold"
        value={summary.avgHold == null ? dash : holdDaysDisplay(summary.avgHold)}
      />
      <Card label="Max Consec. Wins" value={summary.maxConsecWins} />
      <Card label="Max Consec. Losses" value={summary.maxConsecLosses} />
    </div>
  )
}
