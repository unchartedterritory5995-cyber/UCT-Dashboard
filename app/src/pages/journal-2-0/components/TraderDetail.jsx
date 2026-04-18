/**
 * Trader detail — full profile for a selected trader.
 * Hero header with name + badges → 12-stat grid → trade table.
 * Back button returns to the Community grid.
 *
 * Reuses StatsGrid from the user's own Trade Journal so the
 * analytics visual is identical across personal and community views.
 */

import { useMemo } from 'react'
import StatsGrid from './StatsGrid'
import { summaryStats, dateShort, percent, rMultiple as fmtR, holdDaysDisplay } from '../../../lib/journal-2-0'
import styles from './TraderDetail.module.css'

function resultBadge(result) {
  const cls =
    result === 'Win'
      ? styles.badgeWin
      : result === 'Loss'
        ? styles.badgeLoss
        : styles.badgeBe
  return <span className={`${styles.badge} ${cls}`}>{result}</span>
}

function sideBadge(side) {
  return (
    <span
      className={`${styles.sideBadge} ${side === 'Long' ? styles.sideLong : styles.sideShort}`}
    >
      {side.toUpperCase()}
    </span>
  )
}

function Initials({ name }) {
  const letters = (name || 'T')
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() || '')
    .join('') || 'T'
  return <span className={styles.initials} aria-hidden="true">{letters}</span>
}

export default function TraderDetail({ trader, trades, onBack }) {
  // summaryStats consumes Trade shape with pnlDollar — shared trades don't
  // have that field (stripped for privacy). Synthesize pnlDollar = 0 since
  // it's only used for Σ in aggregate rank cards that aren't shown here
  // (Total P&L card would render as $0, but we HIDE the $ cards below).
  // Also: wrap with the 'pnlDollar: 0' synth so summaryStats can classify
  // streaks via result field (which IS present).
  const tradesForStats = useMemo(
    () => trades.map((t) => ({ ...t, pnlDollar: 0 })),
    [trades],
  )
  const summary = useMemo(() => summaryStats(tradesForStats), [tradesForStats])

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={onBack}
          aria-label="Back to traders"
        >
          ← Traders
        </button>
      </div>

      <div className={styles.hero}>
        <Initials name={trader.trader} />
        <div className={styles.heroBody}>
          <div className={styles.heroTitle}>
            {trader.trader}
            {trader.isMe && <span className={styles.youBadge}>You</span>}
          </div>
          <div className={styles.heroMeta}>
            {trader.tradeCount} trade{trader.tradeCount === 1 ? '' : 's'}
            {trader.firstTradeDate && <> · since {dateShort(trader.firstTradeDate)}</>}
            {trader.lastTradeDate && <> · last {dateShort(trader.lastTradeDate)}</>}
          </div>
        </div>
      </div>

      {/* Privacy note: $ cards (Total P&L, Largest Win, Largest Loss, Avg
          P&L/Trade) would render as $0 since shares and pnlDollar are
          server-stripped. We hide them explicitly below via CSS; the other
          cards (Win Rate, Avg Win %, Avg Loss %, Profit Factor, Avg Hold,
          streaks) use scale-independent pnlPercent + result + holdDays
          fields which ARE shared. */}
      <div className={styles.statsWrap}>
        <StatsGrid summary={summary} />
        <p className={styles.privacyNote}>
          Win rate, average % return, R-multiple, and streaks reflect scale-
          independent performance. Dollar amounts are hidden from community
          stats by design — sharers' portfolio sizes stay private.
        </p>
      </div>

      <div className={styles.tradesHeader}>
        <h3 className={styles.tradesTitle}>Trade history</h3>
        <span className={styles.tradesCount}>{trades.length}</span>
      </div>

      {trades.length === 0 ? (
        <div className={styles.empty}>
          No shared trades yet.
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thLeft}>Symbol</th>
                <th className={styles.thLeft}>Side</th>
                <th className={styles.thLeft}>Result</th>
                <th className={styles.thRight}>Entry $</th>
                <th className={styles.thLeft}>Entry Date</th>
                <th className={styles.thRight}>Exit $</th>
                <th className={styles.thLeft}>Exit Date</th>
                <th className={styles.thRight}>P&amp;L %</th>
                <th className={styles.thRight}>R</th>
                <th className={styles.thRight}>Hold</th>
                <th className={styles.thLeft}>Setup</th>
                <th className={styles.thLeft}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id} className={styles.row}>
                  <td className={styles.tdLeft}><strong>{t.symbol}</strong></td>
                  <td className={styles.tdLeft}>{sideBadge(t.side)}</td>
                  <td className={styles.tdLeft}>{resultBadge(t.result)}</td>
                  <td className={styles.tdRight}>${Number(t.entryPrice).toFixed(2)}</td>
                  <td className={styles.tdLeft}>{dateShort(t.entryDate)}</td>
                  <td className={styles.tdRight}>${Number(t.exitPrice).toFixed(2)}</td>
                  <td className={styles.tdLeft}>{dateShort(t.exitDate)}</td>
                  <td
                    className={`${styles.tdRight} ${
                      t.pnlPercent > 0 ? styles.pos : t.pnlPercent < 0 ? styles.neg : ''
                    }`}
                  >
                    {percent(t.pnlPercent, { signed: true, dp: 2 })}
                  </td>
                  <td className={styles.tdRight}>{fmtR(t.rMultiple)}</td>
                  <td className={styles.tdRight}>{holdDaysDisplay(t.holdDays)}</td>
                  <td className={styles.tdLeft}>{t.setup || <span className={styles.dash}>—</span>}</td>
                  <td className={styles.tdLeft}>
                    <span className={styles.notes} title={t.notes || ''}>
                      {t.notes || <span className={styles.dash}>—</span>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
