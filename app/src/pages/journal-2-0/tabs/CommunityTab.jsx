/**
 * Community tab — shared trades from every user who opted in.
 *
 * Read-only feed. Filters: symbol starts-with + trader starts-with.
 * Columns: Trader, Symbol, Side, Entry, Exit, R, P&L %, Hold,
 * Result, Setup. Share counts and $ P&L are server-side stripped —
 * NEVER shown here.
 *
 * Summary strip at the top: trader count, trade count, win rate.
 */

import { useMemo, useState } from 'react'
import useJ2CommunityTrades from '../hooks/useJ2CommunityTrades'
import {
  percent,
  rMultiple as fmtR,
  dateShort,
  holdDaysDisplay,
} from '../../../lib/journal-2-0'
import styles from './CommunityTab.module.css'

function resultBadge(result) {
  const cls =
    result === 'Win'
      ? styles.badgeWin
      : result === 'Loss'
        ? styles.badgeLoss
        : styles.badgeBe
  return <span className={`${styles.resultBadge} ${cls}`}>{result}</span>
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

export default function CommunityTab() {
  const { trades, isLoading, error } = useJ2CommunityTrades()
  const [symbolQ, setSymbolQ] = useState('')
  const [traderQ, setTraderQ] = useState('')

  const filtered = useMemo(() => {
    const s = symbolQ.trim().toUpperCase()
    const t = traderQ.trim().toLowerCase()
    return trades.filter((tr) => {
      if (s && !(tr.symbol || '').toUpperCase().startsWith(s)) return false
      if (t && !(tr.trader || '').toLowerCase().includes(t)) return false
      return true
    })
  }, [trades, symbolQ, traderQ])

  const summary = useMemo(() => {
    const traders = new Set(filtered.map((t) => t.trader))
    const wins = filtered.filter((t) => t.result === 'Win').length
    const losses = filtered.filter((t) => t.result === 'Loss').length
    const bes = filtered.filter((t) => t.result === 'BE').length
    const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : null
    return {
      traderCount: traders.size,
      tradeCount: filtered.length,
      wins,
      losses,
      bes,
      winRate,
    }
  }, [filtered])

  if (error) {
    return (
      <div className={styles.errorBanner} role="alert">
        Failed to load community trades: {String(error.message || error)}
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.intro}>
        <h3 className={styles.introTitle}>Community Trades</h3>
        <p className={styles.introBody}>
          Closed trades from traders who opted in via Portfolio Settings.
          Account size, share count, and $ P&amp;L are never shared — only
          scale-independent analytical data.
        </p>
      </div>

      <div className={styles.statsRow}>
        <StatPill label="Traders" value={summary.traderCount} />
        <StatPill
          label="Trades"
          value={summary.tradeCount}
          sub={summary.tradeCount > 0 ? `${summary.wins}W / ${summary.losses}L / ${summary.bes}BE` : null}
        />
        <StatPill
          label="Win Rate"
          value={summary.winRate == null ? '—' : percent(summary.winRate, { dp: 1, isRatio: false })}
        />
      </div>

      <div className={styles.filters}>
        <label className={styles.filterField}>
          <span className={styles.filterLabel}>Symbol</span>
          <input
            type="text"
            value={symbolQ}
            onChange={(e) => setSymbolQ(e.target.value)}
            placeholder="starts with…"
            className={styles.input}
          />
        </label>
        <label className={styles.filterField}>
          <span className={styles.filterLabel}>Trader</span>
          <input
            type="text"
            value={traderQ}
            onChange={(e) => setTraderQ(e.target.value)}
            placeholder="name contains…"
            className={styles.input}
          />
        </label>
      </div>

      {isLoading && trades.length === 0 ? (
        <div className={styles.loading}>Loading community trades…</div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          {trades.length === 0 ? (
            <>
              <p>No shared trades yet.</p>
              <p className={styles.emptyHint}>
                Be the first — turn on <strong>Community Sharing</strong> in
                Portfolio Settings.
              </p>
            </>
          ) : (
            <p>No trades match the current filters.</p>
          )}
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thLeft}>Trader</th>
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
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className={styles.row}>
                  <td className={styles.tdLeft}>
                    <span className={styles.trader}>{t.trader}</span>
                  </td>
                  <td className={styles.tdLeft}>
                    <strong>{t.symbol}</strong>
                  </td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatPill({ label, value, sub }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {sub && <span className={styles.statSub}>{sub}</span>}
    </div>
  )
}
