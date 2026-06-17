/**
 * OptionStrategiesSection — renders a list of option strategies as a table.
 *
 * Used in OpenPositionsTab (status='open') and TradeJournalTab (status='closed').
 * Live Greeks + current-price Mark are out of scope v1 (spec §0); for open
 * strategies we show entry-time numbers + DTE.
 */

import { useMemo, useState } from 'react'
import { money, moneySigned, percent } from '../../../../lib/journal-2-0'
import {
  buildStrategyLabel,
  computeDaysToExpiration,
  computeMaxRisk,
  prettyStrategyType,
  classifyDebitCredit,
} from '../../lib/optionCalcs'
import { formatETDate } from '../../../../utils/timeAgo'
import StrategyIcon from './StrategyIcon'
import styles from './OptionStrategiesSection.module.css'

/**
 * @param {{
 *   strategies: Array,
 *   variant: 'open' | 'closed',
 *   isLoading?: boolean,
 *   error?: any,
 *   onSelect?: (strategy: object) => void,
 *   onAddClick?: () => void,
 *   onExpire?: (strategy: object) => void,
 *   onClose?: (strategy: object) => void,
 *   onDelete?: (strategy: object) => void,
 * }} props
 */
export default function OptionStrategiesSection({
  strategies,
  variant,
  isLoading,
  error,
  onSelect,
  onAddClick,
  onExpire,
  onClose,
  onDelete,
}) {
  const [expandedId, setExpandedId] = useState(null)

  const summary = useMemo(() => buildSummary(strategies, variant), [strategies, variant])

  return (
    <section className={styles.wrap} aria-label={variant === 'open' ? 'Option strategies (open)' : 'Option strategies (closed)'}>
      <header className={styles.header}>
        <h3 className={styles.title}>
          {variant === 'open' ? 'Option Strategies' : 'Closed Option Strategies'}
          <span className={styles.count}>
            {isLoading && strategies.length === 0
              ? '…'
              : strategies.length === 0
                ? 'none'
                : `${strategies.length} ${strategies.length === 1 ? 'strategy' : 'strategies'}`}
          </span>
        </h3>
        {variant === 'open' && onAddClick && (
          <button
            type="button"
            className={styles.addBtn}
            onClick={onAddClick}
            title="Add Option Strategy"
          >
            + Option Strategy
          </button>
        )}
      </header>

      {error && (
        <div className={styles.errorBanner} role="alert">
          Failed to load option strategies: {String(error.message || error)}
        </div>
      )}

      {summary && (
        <div className={styles.summaryBar}>
          <Stat label="Strategies" value={summary.count} />
          {variant === 'open' ? (
            <>
              {summary.hasMarks && (
                <>
                  <Stat label="Market Value" value={money(summary.totalCurrentValue)} />
                  <Stat
                    label="Open P&L"
                    value={moneySigned(summary.totalOpenPnl)}
                    tone={summary.totalOpenPnl > 0 ? 'pos' : summary.totalOpenPnl < 0 ? 'neg' : null}
                  />
                </>
              )}
              <Stat label="Net Debit" value={money(summary.totalDebit)} />
              <Stat label="Net Credit" value={money(summary.totalCredit)} />
              <Stat label="Expiring ≤ 7d" value={summary.expiringSoon} warn={summary.expiringSoon > 0} />
            </>
          ) : (
            <>
              <Stat label="Total P&L" value={moneySigned(summary.totalPnl)} tone={summary.totalPnl > 0 ? 'pos' : summary.totalPnl < 0 ? 'neg' : null} />
              <Stat label="Win Rate" value={summary.winRate != null ? percent(summary.winRate, { dp: 0 }) : '—'} />
              <Stat label="Avg R" value={summary.avgR != null ? summary.avgR.toFixed(2) + 'R' : '—'} />
            </>
          )}
        </div>
      )}

      {isLoading && strategies.length === 0 && (
        <p className={styles.loading}>Loading strategies…</p>
      )}

      {!isLoading && strategies.length === 0 && (
        <div className={styles.empty}>
          <p className={styles.emptyMain}>
            {variant === 'open' ? 'No open option strategies.' : 'No closed option strategies yet.'}
          </p>
          {variant === 'open' && onAddClick && (
            <button type="button" className={styles.emptyBtn} onClick={onAddClick}>
              Add your first strategy
            </button>
          )}
        </div>
      )}

      {strategies.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th aria-label="expand" />
                <th>Strategy</th>
                <th>Type</th>
                <th className={styles.right}>Entry</th>
                {variant === 'open' ? (
                  <>
                    <th className={styles.right}>Current</th>
                    <th className={styles.right}>P&L $</th>
                    <th className={styles.right}>P&L %</th>
                    <th className={styles.right}>Fees</th>
                    <th className={styles.right}>DTE</th>
                    <th className={styles.right}>Max Risk</th>
                    <th>Status</th>
                  </>
                ) : (
                  <>
                    <th className={styles.right}>Exit</th>
                    <th className={styles.right}>P&L $</th>
                    <th className={styles.right}>P&L %</th>
                    <th className={styles.right}>R</th>
                    <th>Result</th>
                    <th>Closed</th>
                  </>
                )}
                <th aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {strategies.map((s) => (
                <StrategyRow
                  key={s.id}
                  strategy={s}
                  variant={variant}
                  expanded={expandedId === s.id}
                  onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
                  onSelect={onSelect}
                  onExpire={onExpire}
                  onClose={onClose}
                  onDelete={onDelete}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Stat({ label, value, tone, warn }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span
        className={[
          styles.statValue,
          tone === 'pos' ? styles.pos : '',
          tone === 'neg' ? styles.neg : '',
          warn ? styles.warn : '',
        ].filter(Boolean).join(' ')}
      >
        {value}
      </span>
    </div>
  )
}

function StrategyRow({
  strategy, variant, expanded, onToggle, onSelect, onExpire, onClose, onDelete,
}) {
  const label = buildStrategyLabel(strategy)
  const typeLabel = prettyStrategyType(strategy.strategyType)
  const dte = computeDaysToExpiration(strategy.legs)
  const isDebit = classifyDebitCredit(strategy.netEntry) === 'debit'
  const isCredit = classifyDebitCredit(strategy.netEntry) === 'credit'
  const expiringSoon = dte != null && dte >= 0 && dte <= 7
  const expired = dte != null && dte < 0 && strategy.status === 'open'
  const maxRisk = computeMaxRisk(strategy.strategyType, strategy.legs, strategy.netEntry)
  // Live-ish current value + P&L from the broker mark (refreshed each sync),
  // so open broker options read like equity positions. brokerCurrentValue is
  // signed on the same convention as netEntry (long +, short −).
  const hasMark = strategy.brokerCurrentValue != null
  const curVal = hasMark ? strategy.brokerCurrentValue : null
  const openPnl = hasMark ? curVal - strategy.netEntry : null
  const openPnlPct = hasMark && strategy.netEntry ? openPnl / Math.abs(strategy.netEntry) : null

  return (
    <>
      <tr
        className={`${styles.row} ${expanded ? styles.rowOpen : ''} ${expired ? styles.rowExpired : ''}`}
        onClick={onSelect ? () => onSelect(strategy) : undefined}
      >
        <td
          className={styles.chevCell}
          onClick={(e) => { e.stopPropagation(); onToggle() }}
          role="button"
          aria-label={expanded ? 'Collapse legs' : 'Expand legs'}
          title="Show legs"
        >
          <span className={styles.chev}>{expanded ? '▾' : '▸'}</span>
        </td>
        <td className={styles.strategyCell}>
          <div className={styles.strategyHead}>
            <StrategyIcon type={strategy.strategyType} size={24} />
            <div>
              <div className={styles.strategyLabel}>{label}</div>
              {strategy.setup && <div className={styles.strategySub}>{strategy.setup}</div>}
            </div>
          </div>
        </td>
        <td>
          <span className={`${styles.typeBadge} ${isDebit ? styles.debit : ''} ${isCredit ? styles.credit : ''}`}>
            {typeLabel}
          </span>
        </td>
        <td className={styles.right} title={isCredit ? 'Credit received' : isDebit ? 'Debit paid' : 'Even entry'}>
          {money(Math.abs(strategy.netEntry))}
          <span className={styles.entryTag}>
            {isCredit ? ' cr' : isDebit ? ' dr' : ''}
          </span>
        </td>
        {variant === 'open' ? (
          <>
            <td className={styles.right}>
              {curVal == null
                ? <span className={styles.muted} title="Current value updates on each broker sync">—</span>
                : money(Math.abs(curVal))}
            </td>
            <td className={`${styles.right} ${openPnl > 0 ? styles.pos : openPnl < 0 ? styles.neg : ''}`}>
              {openPnl == null ? <span className={styles.muted}>—</span> : moneySigned(openPnl)}
            </td>
            <td className={`${styles.right} ${openPnlPct > 0 ? styles.pos : openPnlPct < 0 ? styles.neg : ''}`}>
              {openPnlPct == null ? <span className={styles.muted}>—</span> : percent(openPnlPct, { dp: 1, isRatio: true, signed: true })}
            </td>
            <td className={styles.right}>{money(strategy.fees)}</td>
            <td className={`${styles.right} ${expiringSoon ? styles.warn : ''} ${expired ? styles.neg : ''}`}>
              {dte == null ? '—' : expired ? `${dte}d` : `${dte}d`}
            </td>
            <td className={styles.right}>
              {maxRisk != null ? money(maxRisk) : (
                <span className={styles.muted} title="Undefined (naked short)">—</span>
              )}
            </td>
            <td>
              <span className={`${styles.statusBadge} ${expired ? styles.statusExpired : styles.statusOpen}`}>
                {expired ? 'Expired (unmarked)' : 'Open'}
              </span>
            </td>
          </>
        ) : (
          <>
            <td className={styles.right}>
              {strategy.netExit == null ? '—' : moneySigned(strategy.netExit)}
            </td>
            <td className={`${styles.right} ${strategy.pnlDollar > 0 ? styles.pos : strategy.pnlDollar < 0 ? styles.neg : ''}`}>
              {strategy.pnlDollar == null ? '—' : moneySigned(strategy.pnlDollar)}
            </td>
            <td className={`${styles.right} ${strategy.pnlPercent > 0 ? styles.pos : strategy.pnlPercent < 0 ? styles.neg : ''}`}>
              {strategy.pnlPercent == null ? '—' : percent(strategy.pnlPercent, { dp: 1, isRatio: true, signed: true })}
            </td>
            <td className={styles.right}>
              {strategy.rMultiple == null ? (
                <span className={styles.muted}>—</span>
              ) : (
                `${strategy.rMultiple >= 0 ? '+' : ''}${strategy.rMultiple.toFixed(2)}R`
              )}
            </td>
            <td>
              <span className={`${styles.resultBadge} ${
                strategy.result === 'Win' ? styles.resWin
                  : strategy.result === 'Loss' ? styles.resLoss
                  : styles.resBe
              }`}>
                {strategy.result || '—'}
              </span>
            </td>
            <td>
              {strategy.closedAt
                ? formatETDate(strategy.closedAt)
                : '—'}
              {strategy.status !== 'closed' && (
                <span className={styles.statusTag}> · {strategy.status}</span>
              )}
            </td>
          </>
        )}
        <td className={styles.actionsCell} onClick={(e) => e.stopPropagation()}>
          {variant === 'open' ? (
            <>
              {expired && onExpire && (
                <button
                  type="button"
                  className={styles.miniBtnGold}
                  onClick={() => onExpire(strategy)}
                  title="Mark as expired (auto-zero all legs)"
                >
                  Mark expired
                </button>
              )}
              {onClose && !expired && (
                <button
                  type="button"
                  className={styles.miniBtn}
                  onClick={() => onClose(strategy)}
                  title="Close strategy"
                >
                  Close
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  className={styles.miniBtnDanger}
                  onClick={() => onDelete(strategy)}
                  title="Delete strategy"
                >
                  ✕
                </button>
              )}
            </>
          ) : (
            onSelect && (
              <button
                type="button"
                className={styles.miniBtn}
                onClick={() => onSelect(strategy)}
                title="View detail"
              >
                View
              </button>
            )
          )}
        </td>
      </tr>
      {expanded && (
        <tr className={styles.legsRow}>
          <td colSpan={variant === 'open' ? 12 : 10}>
            <LegsTable legs={strategy.legs} variant={variant} />
          </td>
        </tr>
      )}
    </>
  )
}

function LegsTable({ legs, variant }) {
  if (!legs || legs.length === 0) return <div className={styles.muted}>No legs recorded.</div>
  return (
    <table className={styles.legsTable}>
      <thead>
        <tr>
          <th>#</th>
          <th>Side</th>
          <th>C/P</th>
          <th className={styles.right}>Strike</th>
          <th>Exp</th>
          <th className={styles.right}>Qty</th>
          <th className={styles.right}>Entry $</th>
          {variant === 'closed' && <th className={styles.right}>Exit $</th>}
        </tr>
      </thead>
      <tbody>
        {legs.map((l) => (
          <tr key={l.id}>
            <td>{l.legIndex}</td>
            <td>
              <span className={`${styles.sideChip} ${l.side === 'buy' ? styles.pos : styles.neg}`}>
                {l.side.toUpperCase()}
              </span>
            </td>
            <td>{l.contractType === 'call' ? 'Call' : 'Put'}</td>
            <td className={styles.right}>${Number(l.strike).toFixed(2)}</td>
            <td>{l.expiration}</td>
            <td className={styles.right}>{l.qty}</td>
            <td className={styles.right}>${Number(l.entryPrice).toFixed(2)}</td>
            {variant === 'closed' && (
              <td className={styles.right}>
                {l.exitPrice == null ? '—' : `$${Number(l.exitPrice).toFixed(2)}`}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function buildSummary(strategies, variant) {
  if (!strategies || strategies.length === 0) return null
  if (variant === 'open') {
    const totalDebit = strategies
      .filter(s => s.netEntry > 0)
      .reduce((sum, s) => sum + s.netEntry + (s.fees || 0), 0)
    const totalCredit = strategies
      .filter(s => s.netEntry < 0)
      .reduce((sum, s) => sum + Math.abs(s.netEntry), 0)
    const expiringSoon = strategies.filter((s) => {
      const dte = computeDaysToExpiration(s.legs)
      return dte != null && dte >= 0 && dte <= 7
    }).length
    const marked = strategies.filter((s) => s.brokerCurrentValue != null)
    const hasMarks = marked.length > 0
    const totalCurrentValue = marked.reduce((sum, s) => sum + Math.abs(s.brokerCurrentValue), 0)
    const totalOpenPnl = marked.reduce((sum, s) => sum + (s.brokerCurrentValue - s.netEntry), 0)
    return { count: strategies.length, totalDebit, totalCredit, expiringSoon,
             hasMarks, totalCurrentValue, totalOpenPnl }
  }
  // closed
  const totalPnl = strategies.reduce((sum, s) => sum + (s.pnlDollar || 0), 0)
  const decided = strategies.filter(s => s.result === 'Win' || s.result === 'Loss')
  const wins = decided.filter(s => s.result === 'Win').length
  const winRate = decided.length > 0 ? (wins / decided.length) * 100 : null
  const rVals = strategies.map(s => s.rMultiple).filter(v => v != null)
  const avgR = rVals.length > 0 ? rVals.reduce((a, b) => a + b, 0) / rVals.length : null
  return { count: strategies.length, totalPnl, winRate, avgR }
}
