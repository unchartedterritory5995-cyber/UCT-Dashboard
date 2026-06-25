/**
 * Trade Journal table — Journal 2.0.
 * Spec §11.3.
 */

import { useMemo, useState } from 'react'
import {
  money,
  moneySigned,
  percent,
  rMultiple as fmtR,
  shares as fmtShares,
  dateShort,
  holdDaysDisplay,
} from '../../../lib/journal-2-0'
import UIcon from '../../../components/ui/UIcon'
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

function cellFor(key, trade, opts) {
  switch (key) {
    case 'symbol': {
      const reviewed = opts?.reviewedIds?.has?.(String(trade.id))
      return (
        <span className={styles.symbolCell}>
          {trade.symbol}
          {trade.source === 'broker' && (
            <span
              title="Auto-imported from your connected brokerage"
              aria-label="Imported from brokerage"
              style={{ marginLeft: 4, opacity: 0.7, fontSize: '0.85em' }}
            >
              <UIcon name="link" size={12} />
            </span>
          )}
          {reviewed && (
            <span
              className={styles.compassDot}
              title="Compass has a post-mortem for this trade"
              aria-label="Compass post-mortem available"
            >
              <UIcon name="compass" size={12} />
            </span>
          )}
        </span>
      )
    }
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

// Columns that sort numerically; everything else sorts as text. Dates are
// ISO strings, so lexical comparison already orders them chronologically.
const NUMERIC_SORT_KEYS = new Set([
  'shares', 'entryPrice', 'exitPrice', 'pnlDollar', 'pnlDollarNet',
  'fees', 'pnlPercent', 'rMultiple', 'holdDays', 'originalStop',
])
const DATE_SORT_KEYS = new Set(['entryDate', 'exitDate'])

// First click on a column picks the most useful direction: biggest/newest
// first for numbers + dates, A→Z for text.
function defaultDirFor(key) {
  return NUMERIC_SORT_KEYS.has(key) || DATE_SORT_KEYS.has(key) ? 'desc' : 'asc'
}

function sortValue(key, trade) {
  if (key === 'pnlDollarNet') return trade.pnlDollarNet ?? trade.pnlDollar
  return trade[key]
}

export default function TradesTable({ trades, visibleColumns, onRowAction, reviewedIds }) {
  // Default sort: entryDate DESC (spec §11.3). Clicking a header re-sorts.
  const [sort, setSort] = useState({ key: 'entryDate', dir: 'desc' })

  const handleSort = (key) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: defaultDirFor(key) },
    )
  }

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    const numeric = NUMERIC_SORT_KEYS.has(sort.key)
    return [...trades].sort((a, b) => {
      const av = sortValue(sort.key, a)
      const bv = sortValue(sort.key, b)
      const aEmpty = av == null || av === ''
      const bEmpty = bv == null || bv === ''
      // Blanks always sink to the bottom, regardless of direction.
      if (aEmpty && bEmpty) { /* fall through to tiebreak */ }
      else if (aEmpty) return 1
      else if (bEmpty) return -1
      else {
        let c
        if (numeric) c = av - bv
        else c = String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0
        if (c !== 0) return c * dir
      }
      // Stable tiebreak: newest entry first, then id.
      if (a.entryDate !== b.entryDate) return a.entryDate > b.entryDate ? -1 : 1
      return String(a.id) < String(b.id) ? -1 : 1
    })
  }, [trades, sort])

  if (sorted.length === 0) {
    return (
      <div className={styles.empty}>
        <p>No trades yet.</p>
        <p className={styles.emptyHint}>
          Close a position or use <strong>+ Add Trade</strong> to record one.
        </p>
        <p className={styles.emptyHint}>
          Or <a href="/settings">connect your brokerage</a> to auto-import every trade.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {visibleColumns.map((c) => {
              const active = sort.key === c.key
              return (
                <th
                  key={c.key}
                  className={`${styles.th} ${c.align === 'right' ? styles.thRight : styles.thLeft}`}
                  title={c.tooltip || undefined}
                  scope="col"
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    className={`${styles.thBtn} ${active ? styles.thBtnActive : ''}`}
                    onClick={() => handleSort(c.key)}
                  >
                    <span>{c.label}</span>
                    <span className={styles.sortCaret} aria-hidden="true">
                      {active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
              )
            })}
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
                  {cellFor(c.key, t, { reviewedIds })}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
