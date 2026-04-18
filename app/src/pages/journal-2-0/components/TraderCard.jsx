/**
 * Trader summary card — clickable tile in the Community grid.
 * Shows at-a-glance metrics: trade count, win rate, avg R, profit factor.
 * Own card gets a "You" badge and blue border.
 */

import {
  percent,
  rMultiple as fmtR,
  profitFactor as fmtPF,
  dateShort,
} from '../../../lib/journal-2-0'
import styles from './TraderCard.module.css'

function Initials({ name }) {
  const letters = (name || 'T')
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || '')
    .join('') || 'T'
  return <span className={styles.initials} aria-hidden="true">{letters}</span>
}

function winRateTone(winRate) {
  if (winRate == null) return ''
  if (winRate >= 60) return styles.tonePos
  if (winRate < 40) return styles.toneNeg
  return styles.toneMeh
}

export default function TraderCard({ trader, onClick }) {
  const pfValue = trader.profitFactor == null
    ? (trader.wins > 0 && trader.losses === 0 ? '∞' : '—')
    : fmtPF(trader.profitFactor)

  return (
    <button
      type="button"
      className={`${styles.card} ${trader.isMe ? styles.cardMine : ''}`}
      onClick={() => onClick?.(trader)}
      aria-label={`View ${trader.trader}'s journal`}
    >
      <div className={styles.head}>
        <Initials name={trader.trader} />
        <div className={styles.identity}>
          <span className={styles.name}>
            {trader.trader}
            {trader.isMe && <span className={styles.youBadge}>You</span>}
          </span>
          <span className={styles.activity}>
            Last: {dateShort(trader.lastTradeDate)}
          </span>
        </div>
      </div>

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Trades</span>
          <span className={styles.metricValue}>{trader.tradeCount}</span>
          <span className={styles.metricSub}>
            {trader.wins}W / {trader.losses}L{trader.bes > 0 ? ` / ${trader.bes}BE` : ''}
          </span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Win Rate</span>
          <span className={`${styles.metricValue} ${winRateTone(trader.winRate)}`}>
            {trader.winRate == null ? '—' : percent(trader.winRate, { dp: 1, isRatio: false })}
          </span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Avg R</span>
          <span
            className={`${styles.metricValue} ${
              trader.avgRMultiple > 0
                ? styles.tonePos
                : trader.avgRMultiple < 0
                  ? styles.toneNeg
                  : ''
            }`}
          >
            {fmtR(trader.avgRMultiple)}
          </span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Profit Factor</span>
          <span className={styles.metricValue}>{pfValue}</span>
        </div>
      </div>
    </button>
  )
}
