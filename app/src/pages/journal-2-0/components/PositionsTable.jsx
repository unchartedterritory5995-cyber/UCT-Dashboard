/**
 * Open Positions table — Journal 2.0.
 * Spec §7.2 (columns) + §7.4 (styling).
 *
 * Phase 3 is read-only. "Actions" column renders placeholder buttons
 * whose handlers fire `onEdit(position)`, `onClose(position)`, and
 * `onDelete(position)` callbacks — the parent supplies them when the
 * action modals arrive in Phase 4.
 */

import { useMemo } from 'react'
import {
  activeStop,
  positionPnlDollar,
  positionPnlPercent,
  positionRiskDollar,
  positionHeatDollar,
  positionStopDistancePercent,
  positionBeSellShares,
  positionInvestedPercent,
  positionRiskAccountPercent,
  money,
  moneySigned,
  percent,
  shares as fmtShares,
  dateShort,
} from '../../../lib/journal-2-0'
import styles from './PositionsTable.module.css'

export const POSITIONS_COLUMNS = [
  { key: 'symbol', label: 'Symbol', nonHideable: true, align: 'left', tooltip: 'Ticker. Default sort.' },
  { key: 'side', label: 'Side', align: 'left', tooltip: 'LONG or SHORT direction.' },
  { key: 'date', label: 'Date', align: 'left', tooltip: 'Entry date.' },
  { key: 'sharesCol', label: 'Shares', align: 'right', tooltip: 'Current remaining shares.' },
  { key: 'entry', label: 'Entry', align: 'right', tooltip: 'Weighted-average entry price.' },
  { key: 'current', label: 'Current', align: 'right', tooltip: 'Live price. — if feed is stale > 5 min.' },
  { key: 'stop', label: 'Stop', align: 'right', tooltip: 'Active stop (breakevenStop when raise-to-BE is on, else original stop).' },
  { key: 'pnlDollar', label: 'P&L $', align: 'right', tooltip: '(current − entry) × shares for Long. Sign-flipped for Short.' },
  { key: 'pnlPercent', label: 'P&L %', align: 'right', tooltip: '(current − entry) / entry. Long; inverted for Short.' },
  { key: 'accountPct', label: '% of Acct', align: 'right', tooltip: '(current × shares) / account size.' },
  { key: 'stopDist', label: 'Stop Dist', align: 'right', tooltip: 'Distance from current to active stop as a percent of current.' },
  { key: 'riskDollar', label: 'Risk $', align: 'right', tooltip: '(entry − activeStop) × shares, clamped ≥ 0.' },
  { key: 'riskAcct', label: 'Risk/Acct', align: 'right', tooltip: 'Risk $ as a percent of account size.' },
  { key: 'beSell', label: 'B/E Sell', align: 'right', tooltip: 'Shares to sell now at current price to break even if the stop hits on remainder. round(), not ceil().' },
  { key: 'heat', label: 'Heat', align: 'right', tooltip: '(current − activeStop) × shares, clamped ≥ 0. Unrealized open P&L above active stop.' },
  { key: 'actions', label: 'Actions', nonHideable: true, align: 'right', tooltip: null },
]

// Whether to round shares to 4dp (fractional) or to nearest whole share.
// Derived per-position from the position's own share count: a position
// holding integer shares rounds B/E Sell + share displays to integer; a
// fractional position (e.g. IBKR fractional) rounds to 4dp. This matches
// §14.7 YSS reference (250 shares → B/E Sell 55, not 54.7182).
const isFractional = (position) =>
  Number.isFinite(position.shares) && !Number.isInteger(position.shares)

function sideBadge(side) {
  const cls = side === 'Long' ? styles.badgeLong : styles.badgeShort
  return (
    <span className={`${styles.sideBadge} ${cls}`}>
      {side.toUpperCase()}
    </span>
  )
}

function pnlCell(value, fmt) {
  if (value == null) return <span className={styles.dash}>—</span>
  const cls = value > 0 ? styles.pos : value < 0 ? styles.neg : ''
  return <span className={cls}>{fmt(value)}</span>
}

function Row({ position, current, accountSize, visibleColumns, onEdit, onClose, onDelete }) {
  const active = activeStop(position)
  const hasPrice = typeof current === 'number' && Number.isFinite(current)
  const allowFractional = isFractional(position)

  const pnlD = hasPrice ? positionPnlDollar(position, current) : null
  const pnlP = hasPrice ? positionPnlPercent(position, current) : null
  const stopDist = hasPrice ? positionStopDistancePercent(position, current) : null
  const riskD = positionRiskDollar(position)
  const heatD = hasPrice ? positionHeatDollar(position, current) : null
  const accountPct = hasPrice
    ? positionInvestedPercent(position, current, accountSize)
    : null
  const riskAcctPct = positionRiskAccountPercent(position, accountSize)
  const beSell = hasPrice ? positionBeSellShares(position, current, allowFractional) : null

  const cellFor = (key) => {
    switch (key) {
      case 'symbol':
        return position.symbol
      case 'side':
        return sideBadge(position.side)
      case 'date':
        return dateShort(position.entryDate)
      case 'sharesCol':
        return fmtShares(position.shares, allowFractional)
      case 'entry':
        return money(position.entryPrice)
      case 'current':
        return hasPrice ? money(current) : <span className={styles.dash}>—</span>
      case 'stop':
        return money(active)
      case 'pnlDollar':
        return pnlCell(pnlD, moneySigned)
      case 'pnlPercent':
        return pnlCell(pnlP, (v) => percent(v, { signed: true, dp: 2 }))
      case 'accountPct':
        return accountPct == null ? <span className={styles.dash}>—</span> : percent(accountPct, { dp: 1 })
      case 'stopDist':
        return stopDist == null ? <span className={styles.dash}>—</span> : percent(stopDist, { dp: 1 })
      case 'riskDollar':
        return money(riskD)
      case 'riskAcct':
        return percent(riskAcctPct, { dp: 2 })
      case 'beSell':
        if (beSell == null) return <span className={styles.dash}>—</span>
        // Display: "55 (22%)" — count plus percent of remaining shares
        return (
          <span>
            {fmtShares(beSell, allowFractional)}
            <span className={styles.beSellPct}>
              {' '}
              ({percent(beSell / position.shares, { dp: 0 })})
            </span>
          </span>
        )
      case 'heat':
        return pnlCell(heatD, money)
      case 'actions':
        return (
          <div className={styles.actionsCell}>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => onEdit?.(position)}
              aria-label={`Edit ${position.symbol}`}
              disabled={!onEdit}
            >
              Edit
            </button>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => onClose?.(position)}
              aria-label={`Close ${position.symbol}`}
              disabled={!onClose}
            >
              Close
            </button>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
              onClick={() => onDelete?.(position)}
              aria-label={`Delete ${position.symbol}`}
              disabled={!onDelete}
            >
              Del
            </button>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <tr className={styles.row}>
      {visibleColumns.map((c) => (
        <td
          key={c.key}
          className={`${styles.td} ${c.align === 'right' ? styles.tdRight : styles.tdLeft}`}
        >
          {cellFor(c.key)}
        </td>
      ))}
    </tr>
  )
}

export default function PositionsTable({
  positions,
  prices,
  accountSize,
  visibleColumns,
  onEdit,
  onClose,
  onDelete,
}) {
  const sorted = useMemo(
    () => [...positions].sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [positions],
  )

  if (sorted.length === 0) {
    return (
      <div className={styles.empty}>
        <p>No open positions.</p>
        <p className={styles.emptyHint}>
          Add one with the <strong>+ Add Position</strong> button above.
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
          {sorted.map((p) => (
            <Row
              key={p.id}
              position={p}
              current={prices?.[p.symbol]?.price}
              accountSize={accountSize}
              visibleColumns={visibleColumns}
              onEdit={onEdit}
              onClose={onClose}
              onDelete={onDelete}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
