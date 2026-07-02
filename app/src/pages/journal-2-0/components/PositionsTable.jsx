/**
 * Open Positions table — Journal 2.0.
 * Spec §7.2 (columns) + §7.4 (styling).
 *
 * Phase 3 is read-only. "Actions" column renders placeholder buttons
 * whose handlers fire `onEdit(position)`, `onClose(position)`, and
 * `onDelete(position)` callbacks — the parent supplies them when the
 * action modals arrive in Phase 4.
 */

import { useMemo, useState } from 'react'
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
  currentPriceFor,
  money,
  moneySigned,
  percent,
  shares as fmtShares,
  dateShort,
} from '../../../lib/journal-2-0'
import TickerPopup from '../../../components/TickerPopup'
import UIcon from '../../../components/ui/UIcon'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import styles from './PositionsTable.module.css'

export const POSITIONS_COLUMNS = [
  { key: 'symbol', label: 'Symbol', nonHideable: true, align: 'left', tooltip: 'Ticker. Default sort.' },
  { key: 'side', label: 'Side', align: 'left', tooltip: 'LONG or SHORT direction.' },
  { key: 'date', label: 'Date', align: 'left', tooltip: 'Entry date.' },
  { key: 'sharesCol', label: 'Shares', align: 'right', tooltip: 'Current remaining shares.' },
  { key: 'entry', label: 'Entry', align: 'right', tooltip: 'Weighted-average entry price.' },
  { key: 'current', label: 'Current', align: 'right', tooltip: 'Live price when the market is open; the broker’s last-synced mark after hours. — if unavailable.' },
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

function sideBadge(label, isLong) {
  const long = isLong ?? (label === 'Long')
  const cls = long ? styles.badgeLong : styles.badgeShort
  return (
    <span className={`${styles.sideBadge} ${cls}`}>
      {label.toUpperCase()}
    </span>
  )
}

function pnlCell(value, fmt) {
  if (value == null) return <span className={styles.dash}>—</span>
  const cls = value > 0 ? styles.pos : value < 0 ? styles.neg : ''
  return <span className={cls}>{fmt(value)}</span>
}

const DASH = (title) => <span className={styles.dash} title={title || undefined}>—</span>

function Row({ position, current, accountSize, visibleColumns, onEdit, onClose, onDelete, onOptionClose, onOptionDelete }) {
  // Option rows (merged into the same table as shares): all option-specific
  // values are precomputed on the row (no per-share price formula applies).
  const isOpt = !!position.isOption
  const optAcctPct = (position.optMarketValue != null && accountSize)
    ? position.optMarketValue / accountSize : null

  const active = activeStop(position)
  const hasPrice = typeof current === 'number' && Number.isFinite(current)
  const allowFractional = isFractional(position)
  // Broker-imported positions have no stop; the importer stores stop_price =
  // entry_price as a NOT-NULL placeholder. Treat that as "no stop set" and blank
  // the stop-derived columns until the user sets a real stop.
  const noRealStop =
    position.source === 'broker' && active != null && active === position.entryPrice
  // Broker holdings imported before activity history reconstructs the real fill
  // have an unknown (placeholder) entry date — show "est." not a misleading day.
  const dateEstimated = !!position.entryEstimated

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
    if (isOpt) {
      switch (key) {
        case 'symbol':
          return position.symbol
        case 'side':
          return sideBadge(position.side, position.sideKind === 'long')
        case 'date':
          return position.entryDate ? dateShort(position.entryDate) : DASH()
        case 'sharesCol':
          return `${position.shares}`  // contracts
        case 'entry':
          return money(position.entryPrice)  // premium per contract
        case 'current':
          return position.optCurrent == null
            ? DASH('Mark updates on each broker sync') : money(position.optCurrent)
        case 'pnlDollar':
          return pnlCell(position.optPnlDollar, moneySigned)
        case 'pnlPercent':
          return pnlCell(position.optPnlPercent,
            (v) => percent(v, { signed: true, dp: 1, isRatio: true }))
        case 'accountPct':
          return optAcctPct == null ? DASH() : percent(optAcctPct, { dp: 1 })
        case 'stop':
        case 'stopDist':
        case 'riskDollar':
        case 'riskAcct':
        case 'beSell':
        case 'heat':
          return DASH('Not applicable to options')
        case 'actions':
          return (
            <div className={styles.actionsCell}>
              <TickerPopup sym={position.underlying} as="button" className={styles.actionBtn}>
                <span title="Open underlying chart"><UIcon name="equity" size={14} /></span>
              </TickerPopup>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => onOptionClose?.(position.strategy)}
                aria-label={`Close ${position.symbol}`}
                disabled={!onOptionClose}
              >
                Close
              </button>
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                onClick={() => onOptionDelete?.(position.strategy)}
                aria-label={`Delete ${position.symbol}`}
                disabled={!onOptionDelete}
              >
                Del
              </button>
            </div>
          )
        default:
          return null
      }
    }
    switch (key) {
      case 'symbol':
        return position.symbol
      case 'side':
        return sideBadge(position.side)
      case 'date':
        return dateEstimated
          ? <span className={styles.dash} title="Entry date unknown — imported from broker holdings, no activity history yet">est.</span>
          : dateShort(position.entryDate)
      case 'sharesCol':
        return fmtShares(position.shares, allowFractional)
      case 'entry':
        return money(position.entryPrice)
      case 'current':
        return hasPrice ? money(current) : <span className={styles.dash}>—</span>
      case 'stop':
        return noRealStop ? DASH('No stop set on this broker-imported position') : money(active)
      case 'pnlDollar':
        return pnlCell(pnlD, moneySigned)
      case 'pnlPercent':
        return pnlCell(pnlP, (v) => percent(v, { signed: true, dp: 2 }))
      case 'accountPct':
        return accountPct == null ? <span className={styles.dash}>—</span> : percent(accountPct, { dp: 1 })
      case 'stopDist':
        if (noRealStop) return DASH('No stop set')
        return stopDist == null ? <span className={styles.dash}>—</span> : percent(stopDist, { dp: 1 })
      case 'riskDollar':
        return noRealStop ? DASH('No stop set — risk undefined') : money(riskD)
      case 'riskAcct':
        return noRealStop ? DASH('No stop set — risk undefined') : percent(riskAcctPct, { dp: 2 })
      case 'beSell':
        if (noRealStop) return DASH('No stop set')
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
        return noRealStop ? DASH('No stop set') : pnlCell(heatD, money)
      case 'actions':
        return (
          <div className={styles.actionsCell}>
            <TickerPopup
              sym={position.symbol}
              as="button"
              className={styles.actionBtn}
            >
              <span title="Open full chart (right-click a bar to add)"><UIcon name="equity" size={14} /></span>
            </TickerPopup>
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

/**
 * Phone card — one position per card (3-5 key fields + 44px actions),
 * replacing the dense table on ≤640px. Same sorted order as the table.
 */
function PhoneCard({ position, current, onEdit, onClose, onDelete, onOptionClose, onOptionDelete }) {
  const isOpt = !!position.isOption
  const hasPrice = typeof current === 'number' && Number.isFinite(current)
  const allowFractional = isFractional(position)
  const active = activeStop(position)
  const noRealStop =
    position.source === 'broker' && active != null && active === position.entryPrice

  const pnlD = isOpt ? position.optPnlDollar : (hasPrice ? positionPnlDollar(position, current) : null)
  const pnlP = isOpt ? position.optPnlPercent : (hasPrice ? positionPnlPercent(position, current) : null)
  const curDisplay = isOpt
    ? (position.optCurrent == null ? '—' : money(position.optCurrent))
    : (hasPrice ? money(current) : '—')
  const pnlCls = pnlD > 0 ? styles.pos : pnlD < 0 ? styles.neg : ''

  return (
    <div className={styles.card} data-testid="position-card">
      <div className={styles.cardHead}>
        <div className={styles.cardIdent}>
          <span className={styles.cardSym}>{position.symbol}</span>
          {sideBadge(position.side, isOpt ? position.sideKind === 'long' : undefined)}
        </div>
        <div className={styles.cardFigures}>
          <span className={styles.cardPrice}>{curDisplay}</span>
          <span className={`${styles.cardPnl} ${pnlCls}`}>
            {pnlD == null ? '—' : moneySigned(pnlD)}
            {/* both branches produce RATIOS (positionPnlPercent + optPnlPercent) */}
            {pnlP != null && <> ({percent(pnlP, { signed: true, dp: 1, isRatio: true })})</>}
          </span>
        </div>
      </div>
      <div className={styles.cardMeta}>
        {isOpt ? (
          <>{position.shares} {position.shares === 1 ? 'contract' : 'contracts'} @ {money(position.entryPrice)}</>
        ) : (
          <>
            {fmtShares(position.shares, allowFractional)} @ {money(position.entryPrice)}
            {' · '}stop {noRealStop ? '—' : money(active)}
          </>
        )}
        {' · '}
        {position.entryEstimated ? 'est.' : (position.entryDate ? dateShort(position.entryDate) : '—')}
      </div>
      <div className={styles.cardActions}>
        <TickerPopup sym={isOpt ? position.underlying : position.symbol} as="button" className={styles.cardBtn}>
          <UIcon name="equity" size={14} />
        </TickerPopup>
        {!isOpt && (
          <button type="button" className={styles.cardBtn} disabled={!onEdit}
                  onClick={() => onEdit?.(position)} aria-label={`Edit ${position.symbol}`}>
            Edit
          </button>
        )}
        <button type="button" className={styles.cardBtn} disabled={isOpt ? !onOptionClose : !onClose}
                onClick={() => (isOpt ? onOptionClose?.(position.strategy) : onClose?.(position))}
                aria-label={`Close ${position.symbol}`}>
          Close
        </button>
        <button type="button" className={`${styles.cardBtn} ${styles.cardBtnDanger}`}
                disabled={isOpt ? !onOptionDelete : !onDelete}
                onClick={() => (isOpt ? onOptionDelete?.(position.strategy) : onDelete?.(position))}
                aria-label={`Delete ${position.symbol}`}>
          Del
        </button>
      </div>
    </div>
  )
}

// ── Sorting ──────────────────────────────────────────────────────────────────
// Most columns sort numerically; symbol/side are text and date is an ISO
// string (lexical = chronological). 'actions' is not sortable.
const TEXT_SORT_KEYS = new Set(['symbol', 'side', 'date'])

function defaultDirForPos(key) {
  // text → A→Z; numbers + date → biggest/newest first.
  return key === 'symbol' || key === 'side' ? 'asc' : 'desc'
}

// Comparable value for a column, mirroring Row's display logic (including
// option rows + broker "no real stop" blanking). Returns null for blanks,
// which always sink to the bottom.
function sortKeyFor(key, position, current, accountSize) {
  const hasPrice = typeof current === 'number' && Number.isFinite(current)
  if (position.isOption) {
    switch (key) {
      case 'symbol': return position.symbol
      case 'side': return position.side
      case 'date': return position.entryDate ?? null
      case 'sharesCol': return position.shares
      case 'entry': return position.entryPrice
      case 'current': return position.optCurrent ?? null
      case 'pnlDollar': return position.optPnlDollar ?? null
      case 'pnlPercent': return position.optPnlPercent ?? null
      case 'accountPct':
        return (position.optMarketValue != null && accountSize)
          ? position.optMarketValue / accountSize : null
      default: return null  // stop/risk/heat/beSell N/A for options
    }
  }
  const active = activeStop(position)
  const noRealStop =
    position.source === 'broker' && active != null && active === position.entryPrice
  switch (key) {
    case 'symbol': return position.symbol
    case 'side': return position.side
    case 'date': return position.entryEstimated ? null : (position.entryDate ?? null)
    case 'sharesCol': return position.shares
    case 'entry': return position.entryPrice
    case 'current': return hasPrice ? current : null
    case 'stop': return noRealStop ? null : active
    case 'pnlDollar': return hasPrice ? positionPnlDollar(position, current) : null
    case 'pnlPercent': return hasPrice ? positionPnlPercent(position, current) : null
    case 'accountPct': return hasPrice ? positionInvestedPercent(position, current, accountSize) : null
    case 'stopDist': return (noRealStop || !hasPrice) ? null : positionStopDistancePercent(position, current)
    case 'riskDollar': return noRealStop ? null : positionRiskDollar(position)
    case 'riskAcct': return noRealStop ? null : positionRiskAccountPercent(position, accountSize)
    case 'beSell': return (noRealStop || !hasPrice) ? null : positionBeSellShares(position, current, isFractional(position))
    case 'heat': return (noRealStop || !hasPrice) ? null : positionHeatDollar(position, current)
    default: return null
  }
}

export default function PositionsTable({
  positions,
  prices,
  accountSize,
  visibleColumns,
  onEdit,
  onClose,
  onDelete,
  onOptionClose,
  onOptionDelete,
}) {
  const [sort, setSort] = useState({ key: 'symbol', dir: 'asc' })
  const isPhone = useIsPhone()

  const handleSort = (key) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: defaultDirForPos(key) },
    )
  }

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    const text = TEXT_SORT_KEYS.has(sort.key)
    return [...positions].sort((a, b) => {
      // Sort on the price the ROWS display (live tick → broker mark), not the
      // raw feed — otherwise after-hours broker rows show values but sort as
      // blanks and sink to the bottom.
      const av = sortKeyFor(sort.key, a, currentPriceFor(a, prices), accountSize)
      const bv = sortKeyFor(sort.key, b, currentPriceFor(b, prices), accountSize)
      const aEmpty = av == null || av === ''
      const bEmpty = bv == null || bv === ''
      if (aEmpty && bEmpty) { /* fall through to tiebreak */ }
      else if (aEmpty) return 1
      else if (bEmpty) return -1
      else {
        let c
        if (text) c = String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0
        else c = av - bv
        if (c !== 0) return c * dir
      }
      // Stable tiebreak: symbol A→Z, then id.
      const s = a.symbol.localeCompare(b.symbol)
      if (s !== 0) return s
      return String(a.id) < String(b.id) ? -1 : 1
    })
  }, [positions, prices, accountSize, sort])

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

  if (isPhone) {
    return (
      <div className={styles.cardList}>
        {sorted.map((p) => (
          <PhoneCard
            key={p.id}
            position={p}
            current={currentPriceFor(p, prices)}
            onEdit={onEdit}
            onClose={onClose}
            onDelete={onDelete}
            onOptionClose={onOptionClose}
            onOptionDelete={onOptionDelete}
          />
        ))}
      </div>
    )
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {visibleColumns.map((c) => {
              const sortable = c.key !== 'actions'
              const activeCol = sort.key === c.key
              return (
                <th
                  key={c.key}
                  className={`${styles.th} ${c.align === 'right' ? styles.thRight : styles.thLeft}`}
                  title={c.tooltip || undefined}
                  scope="col"
                  aria-sort={
                    sortable && activeCol
                      ? (sort.dir === 'asc' ? 'ascending' : 'descending')
                      : undefined
                  }
                >
                  {sortable ? (
                    <button
                      type="button"
                      className={`${styles.thBtn} ${activeCol ? styles.thBtnActive : ''}`}
                      onClick={() => handleSort(c.key)}
                    >
                      <span>{c.label}</span>
                      <span className={styles.sortCaret} aria-hidden="true">
                        {activeCol ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                      </span>
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <Row
              key={p.id}
              position={p}
              current={currentPriceFor(p, prices)}
              accountSize={accountSize}
              visibleColumns={visibleColumns}
              onEdit={onEdit}
              onClose={onClose}
              onDelete={onDelete}
              onOptionClose={onOptionClose}
              onOptionDelete={onOptionDelete}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
