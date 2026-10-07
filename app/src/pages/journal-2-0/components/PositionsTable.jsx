/**
 * Open Positions table — Journal 2.0.
 * Spec §7.2 (columns) + §7.4 (styling).
 *
 * Phase 3 is read-only. "Actions" column renders placeholder buttons
 * whose handlers fire `onEdit(position)`, `onClose(position)`, and
 * `onDelete(position)` callbacks — the parent supplies them when the
 * action modals arrive in Phase 4.
 */

import { useCallback, useMemo, useRef } from 'react'
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
  hasNoRealStop,
} from '../../../lib/journal-2-0'
import TickerPopup from '../../../components/TickerPopup'
import UIcon from '../../../components/ui/UIcon'
import { useGridSort } from '../../../lib/presentation/dataGrid'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import ThesisChip from './notebook/ThesisChip'
import useThesisChips from '../hooks/useThesisChips'
import { thesisChipsEnabled } from '../lib/thesisChips'
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

function Row({ position, current, accountSize, visibleColumns, onEdit, onClose, onDelete, onOptionClose, onOptionDelete, thesisChip }) {
  // Option rows (merged into the same table as shares): all option-specific
  // values are precomputed on the row (no per-share price formula applies).
  const isOpt = !!position.isOption
  // Row click-through (Portfolio/Position Intelligence Convergence V1 Part A2):
  // the whole row opens the SAME TickerPopup the chart-icon button already
  // opens — reused verbatim (isTouch→Ticker Hub branch, prefetch-on-hover,
  // long-press props, tag dot, aria-label all included) by programmatically
  // clicking that button's own DOM node, rather than re-implementing any of
  // its open logic via TickerPopup's separate controlled-mode API.
  const chartTriggerWrapRef = useRef(null)
  const actionsCellRef = useRef(null)
  const handleRowClick = (e) => {
    if (actionsCellRef.current?.contains(e.target)) return
    chartTriggerWrapRef.current?.querySelector('button')?.click()
  }
  const optAcctPct = (position.optMarketValue != null && accountSize)
    ? position.optMarketValue / accountSize : null

  const active = activeStop(position)
  const hasPrice = typeof current === 'number' && Number.isFinite(current)
  const allowFractional = isFractional(position)
  // No usable stop ⇒ blank every stop-derived column until the user sets one.
  // ⛔ `hasNoRealStop`, NOT `isBrokerPlaceholderStop`: the latter answers only
  // "is this the broker's NOT-NULL seed", so a MANUAL row created without a
  // stop (positions.py stores 0.0) rendered `stop $0.00` here and the full
  // notional as Risk $, while the dashboard cockpit correctly called it no
  // stop — the client holding two answers about one position's protection.
  const noRealStop = hasNoRealStop(position)
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
            <div className={styles.actionsCell} ref={actionsCellRef}>
              <span ref={chartTriggerWrapRef}>
                <TickerPopup sym={position.underlying} as="button" className={styles.actionBtn}>
                  <span title="Open underlying chart"><UIcon name="equity" size={14} /></span>
                </TickerPopup>
              </span>
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
        // ⛔ Flag-off must be byte-identical to before the thesis chip existed
        // (journalGrids.seedParity.test.jsx's snapshot: "a member-visible change,
        // never updated through"). The flex wrapper exists only to lay the chip
        // beside the ticker, so with no chip the cell is the bare symbol, exactly
        // as it rendered before wave 13G-2.
        if (!thesisChip) return position.symbol
        return (
          <span className={styles.symCell}>
            {position.symbol}
            {thesisChip && <ThesisChip chip={thesisChip} currentPrice={hasPrice ? current : null} />}
          </span>
        )
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
        return noRealStop ? DASH('No stop set on this position') : money(active)
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
          <div className={styles.actionsCell} ref={actionsCellRef}>
            <span ref={chartTriggerWrapRef}>
              <TickerPopup
                sym={position.symbol}
                as="button"
                className={styles.actionBtn}
              >
                <span title="Chart, Research & Ask AI (right-click a bar to add)"><UIcon name="equity" size={14} /></span>
              </TickerPopup>
            </span>
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
    <tr
      className={styles.row}
      /* Joystick hub carrier (§3.4) — the table surface. Bare position/strategy id. */
      data-hub-pos={String(position.id)}
      onClick={handleRowClick}
      // Seam: PositionsTable was a bare `<tr onClick>` -- a keyboard/switch-
      // control member could not open ANY position on this paid core
      // surface, a wider blast radius than AlertBell's own pre-fix gap
      // (Seam 5). Reuses handleRowClick verbatim -- it already guards
      // against the actions cell via `actionsCellRef`, so the same guard
      // covers a bubbled Enter from a focused action button inside it.
      // Deliberately NO role="button" here -- overriding a <tr>'s native
      // row role breaks table enumeration for real assistive tech (and
      // for this file's own `getAllByRole('row')` tests), the opposite of
      // an accessibility fix. tabIndex + onKeyDown alone close the actual
      // reported gap (no keyboard path to activate the row at all).
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleRowClick(e)
        }
      }}
    >
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
function PhoneCard({ position, current, onEdit, onClose, onDelete, onOptionClose, onOptionDelete, thesisChip }) {
  const isOpt = !!position.isOption
  const hasPrice = typeof current === 'number' && Number.isFinite(current)
  const allowFractional = isFractional(position)
  const active = activeStop(position)
  const noRealStop = hasNoRealStop(position)
  // Whole-card click-through (mirrors Row()'s — see its comment): reuses the
  // same TickerPopup trigger button the chart icon already renders.
  const chartTriggerWrapRef = useRef(null)
  const cardActionsRef = useRef(null)
  const handleCardClick = (e) => {
    if (cardActionsRef.current?.contains(e.target)) return
    chartTriggerWrapRef.current?.querySelector('button')?.click()
  }

  const pnlD = isOpt ? position.optPnlDollar : (hasPrice ? positionPnlDollar(position, current) : null)
  const pnlP = isOpt ? position.optPnlPercent : (hasPrice ? positionPnlPercent(position, current) : null)
  const curDisplay = isOpt
    ? (position.optCurrent == null ? '—' : money(position.optCurrent))
    : (hasPrice ? money(current) : '—')
  const pnlCls = pnlD > 0 ? styles.pos : pnlD < 0 ? styles.neg : ''

  return (
    <div
      className={styles.card}
      data-testid="position-card"
      /* Joystick hub carrier (§3.4) — the phone card surface. The plan cited the CALL SITE
         (`:525-527`), which renders `<PhoneCard>`, a component: a data attribute there would
         land on a React prop, not on a DOM node, so it sits on the card's own root instead. */
      data-hub-pos={String(position.id)}
      /* ⛔ Lane FIN-A11Y round 2: the card is a named GROUP, not a button. It used to be
         `role="button"` with the thesis chip and Edit/Close/Delete inside it, and interactive
         content inside a button is ONE control to a screen reader. The primary action is the
         real <button> on the title below; the chip and the three actions are its siblings.
         The click handler stays as a pointer convenience (a tap anywhere on the card still
         opens it); the keyboard and screen-reader door is the title button. tabIndex -1 keeps
         the card focusable FROM A SCRIPT, which the delete-focus fallback relies on
         (OpenPositionsTab: the card after a deleted one takes focus by this attribute). */
      onClick={handleCardClick}
      role="group"
      tabIndex={-1}
      aria-label={`${position.symbol} position`}
    >
      <div className={styles.cardHead}>
        <div className={styles.cardIdent}>
          <button
            type="button"
            className={`${styles.cardSym} ${styles.cardOpen}`}
            aria-label={`${position.symbol} position — open chart, research, and actions`}
          >
            {position.symbol}
          </button>
          {thesisChip && <ThesisChip chip={thesisChip} currentPrice={hasPrice ? current : null} />}
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
      <div className={styles.cardActions} ref={cardActionsRef}>
        <span ref={chartTriggerWrapRef}>
          <TickerPopup sym={isOpt ? position.underlying : position.symbol} as="button" className={styles.cardBtn}>
            <UIcon name="equity" size={14} />
          </TickerPopup>
        </span>
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

const isNumericSortKey = (key) => !TEXT_SORT_KEYS.has(key)

// Stable tiebreak: symbol A→Z, then id.
function positionsTiebreak(a, b) {
  const s = a.symbol.localeCompare(b.symbol)
  if (s !== 0) return s
  return String(a.id) < String(b.id) ? -1 : 1
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
  const noRealStop = hasNoRealStop(position)
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
  // Must match the flag the hero composed with — see useBrokerMarkPreference.
  preferBrokerMarks = false,
  accountSize,
  visibleColumns,
  onEdit,
  onClose,
  onDelete,
  onOptionClose,
  onOptionDelete,
}) {
  const isPhone = useIsPhone()

  // Wave 13 lane 13G-2: one batch read for every (non-option) symbol on screen. Option
  // rows are excluded -- their "current" is the contract's own mark, not the underlying's
  // price, so a stop-distance number here would be wrong; a note on the underlying is
  // reached through its own equity row when one exists.
  const thesisSymbols = useMemo(
    () => [...new Set(positions.filter((p) => !p.isOption).map((p) => p.symbol))],
    [positions],
  )
  const { chips: thesisChips } = useThesisChips(thesisSymbols)
  const thesisOn = thesisChipsEnabled()

  // Sort on the price the ROWS display (live tick → broker mark), not the
  // raw feed — otherwise after-hours broker rows show values but sort as
  // blanks and sink to the bottom.
  const valueOf = useCallback(
    (key, p) => sortKeyFor(key, p, currentPriceFor(p, prices, preferBrokerMarks), accountSize),
    [prices, preferBrokerMarks, accountSize],
  )
  // Sort state, the blanks-sink comparator and the header semantics come from
  // the S10 DataGrid seed (TERM-065); the markup below is unchanged. An
  // inactive column carries NO aria-sort attribute here (Trades says 'none').
  const { sorted, requestSort, ariaSort, caret, sort } = useGridSort(positions, {
    initialKey: 'symbol',
    initialDir: 'asc',
    defaultDirFor: defaultDirForPos,
    valueOf,
    isNumeric: isNumericSortKey,
    tiebreak: positionsTiebreak,
    omitInactiveAria: true,
  })

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
            current={currentPriceFor(p, prices, preferBrokerMarks)}
            onEdit={onEdit}
            onClose={onClose}
            onDelete={onDelete}
            onOptionClose={onOptionClose}
            onOptionDelete={onOptionDelete}
            thesisChip={(!p.isOption && thesisOn) ? thesisChips[p.symbol] : null}
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
                  aria-sort={sortable ? ariaSort(c.key) : undefined}
                >
                  {sortable ? (
                    <button
                      type="button"
                      className={`${styles.thBtn} ${activeCol ? styles.thBtnActive : ''}`}
                      onClick={() => requestSort(c.key)}
                    >
                      <span>{c.label}</span>
                      <span className={styles.sortCaret} aria-hidden="true">
                        {caret(c.key)}
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
              current={currentPriceFor(p, prices, preferBrokerMarks)}
              accountSize={accountSize}
              visibleColumns={visibleColumns}
              onEdit={onEdit}
              onClose={onClose}
              onDelete={onDelete}
              onOptionClose={onOptionClose}
              onOptionDelete={onOptionDelete}
              thesisChip={(!p.isOption && thesisOn) ? thesisChips[p.symbol] : null}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
