/**
 * Trade Journal table — Journal 2.0.
 * Spec §11.3.
 */

import { useMemo } from 'react'
import {
  money,
  moneySigned,
  percent,
  rMultiple as fmtR,
  shares as fmtShares,
  dateShort,
  holdDaysDisplay,
} from '../../../lib/journal-2-0'
import styles from './TradesTable.module.css'

export function buildTradesColumns() {
  return [
    { key: 'symbol', label: 'Symbol', nonHideable: true, align: 'left', tooltip: 'Ticker.' },
    { key: 'result', label: 'Result', align: 'left', tooltip: 'Win / Loss / BE per settings.breakevenRange.' },
    { key: 'shares', label: 'Shares', align: 'right', tooltip: 'Shares closed in this trade record.' },
    { key: 'entryPrice', label: 'Entry $', align: 'right', tooltip: 'Entry price.' },
    { key: 'entryDate', label: 'Entry Date', align: 'left', tooltip: 'Entry date. Default sort (newest first).' },
    { key: 'exitPrice', label: 'Exit $', align: 'right', tooltip: 'Exit price.' },
    { key: 'exitDate', label: 'Exit Date', align: 'left', tooltip: 'Exit date.' },
    { key: 'pnlDollar', label: 'P&L $', align: 'right', tooltip: 'Gross (exit − entry) × shares (Long); sign-flipped for Short.' },
    { key: 'pnlDollarNet', label: 'Net P&L', align: 'right', tooltip: 'P&L minus fees/commissions.' },
    { key: 'fees', label: 'Fees', align: 'right', tooltip: 'Commissions and fees for this trade.', hiddenByDefault: true },
    { key: 'pnlPercent', label: 'P&L %', align: 'right', tooltip: '(exit − entry) / entry.' },
    { key: 'rMultiple', label: 'R', align: 'right', tooltip: 'Reward / risk, using the ORIGINAL stop — frozen for R math.' },
    { key: 'holdDays', label: 'Hold', align: 'right', tooltip: 'Calendar days between entry and exit, UTC.' },
    { key: 'setup', label: 'Setup', align: 'left', tooltip: 'Setup classification.' },
    { key: 'originalStop', label: 'Stop', align: 'right', tooltip: 'Original stop (frozen — used for R math).', hiddenByDefault: true },
  ]
}

function resultBadge(result) {
  const cls =
    result === 'Win'
      ? styles.badgeWin
      : result === 'Loss'
        ? styles.badgeLoss
        : styles.badgeBe
  return <span className={`${styles.resultBadge} ${cls}`}>{result}</span>
}

const dash = <span className={styles.dash}>—</span>

function cellFor(key, trade) {
  switch (key) {
    case 'symbol':
      return trade.symbol
    case 'result':
      return resultBadge(trade.result)
    case 'shares':
      return fmtShares(trade.shares, !Number.isInteger(trade.shares))
    case 'entryPrice':
      return money(trade.entryPrice)
    case 'entryDate':
      return dateShort(trade.entryDate)
    case 'exitPrice':
      return money(trade.exitPrice)
    case 'exitDate':
      return dateShort(trade.exitDate)
    case 'pnlDollar':
      return (
        <span
          className={
            trade.pnlDollar > 0 ? styles.pos : trade.pnlDollar < 0 ? styles.neg : ''
          }
        >
          {moneySigned(trade.pnlDollar)}
        </span>
      )
    case 'pnlDollarNet': {
      const net = trade.pnlDollarNet ?? trade.pnlDollar
      return (
        <span className={net > 0 ? styles.pos : net < 0 ? styles.neg : ''}>
          {moneySigned(net)}
        </span>
      )
    }
    case 'fees':
      return trade.fees && trade.fees > 0
        ? <span>{moneySigned(-trade.fees)}</span>
        : dash
    case 'pnlPercent':
      return (
        <span
          className={
            trade.pnlPercent > 0 ? styles.pos : trade.pnlPercent < 0 ? styles.neg : ''
          }
        >
          {percent(trade.pnlPercent, { signed: true, dp: 2 })}
        </span>
      )
    case 'rMultiple':
      return fmtR(trade.rMultiple)
    case 'holdDays':
      return holdDaysDisplay(trade.holdDays)
    case 'originalStop':
      return money(trade.originalStop)
    case 'setup':
      return trade.setup || dash
    default:
      return null
  }
}

export default function TradesTable({ trades, visibleColumns, onRowAction }) {
  // Default sort: entryDate DESC (spec §11.3). Callers may pre-sort; we
  // sort again here to be safe.
  const sorted = useMemo(
    () =>
      [...trades].sort((a, b) => {
        if (a.entryDate === b.entryDate) return 0
        return a.entryDate > b.entryDate ? -1 : 1
      }),
    [trades],
  )

  if (sorted.length === 0) {
    return (
      <div className={styles.empty}>
        <p>No trades yet.</p>
        <p className={styles.emptyHint}>
          Close a position or use <strong>+ Add Trade</strong> to record one.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {visibleColumns.map((c) => (
              <th
                key={c.key}
                className={`${styles.th} ${c.align === 'right' ? styles.thRight : styles.thLeft}`}
                title={c.tooltip || undefined}
                scope="col"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <tr key={t.id} className={styles.row}>
              {visibleColumns.map((c) => (
                <td
                  key={c.key}
                  className={`${styles.td} ${c.align === 'right' ? styles.tdRight : styles.tdLeft}`}
                  onClick={
                    onRowAction && c.key === 'symbol'
                      ? () => onRowAction('open', t)
                      : undefined
                  }
                  style={
                    onRowAction && c.key === 'symbol' ? { cursor: 'pointer' } : undefined
                  }
                >
                  {cellFor(c.key, t)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
