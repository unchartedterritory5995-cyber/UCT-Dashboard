/**
 * Calendar day cell — shown in Month/Week grids.
 *
 * Layout: day number top-left, hasNotes badge top-right, big P&L $
 * centered, % return + R-sum stacked below in small. Background tinted
 * by metric intensity (% / $ / R modes).
 */

import { useNavigate } from 'react-router-dom'
import UIcon from '../../../../components/ui/UIcon'
import { useFeatureFlag } from '../../featureFlags'
import {
  cellBackground,
  fmtSignedDollar,
  fmtSignedPct,
  fmtSignedR,
} from '../../lib/calendar'
import styles from './DayCell.module.css'

/**
 * @param {Object} props
 * @param {Object|null} props.cell - { date, day, inMonth }
 * @param {Object|undefined} props.summary - { pnlDollar, pnlPercent, rSum, tradeCount, hasNotes }
 * @param {'pct'|'dollar'|'r'} props.mode
 * @param {boolean} props.isToday
 * @param {'closed'|'account'} props.basis
 */
export default function DayCell({ cell, summary, mode = 'pct', isToday = false, basis = 'closed' }) {
  const navigate = useNavigate()
  // Tilt is a psychology signal — gate its glyph on the same kill-switch as the
  // Analytics psychology section so the two revert together.
  const psychologyOn = useFeatureFlag('psychology')
  if (!cell) return <div className={styles.blank} />

  const value =
    mode === 'dollar' ? summary?.pnlDollar :
    mode === 'r'      ? summary?.rSum :
                        summary?.pnlPercent
  const bg = cellBackground(value, mode)

  const onClick = () => navigate(`/journal-2-0/calendar/${cell.date}`)

  // In account-balance basis, every day carries a real net-liq change (even
  // with no closed trades — open positions still mark to market), so show the
  // $ figure whenever a delta exists. Closed-trade basis keeps the old gate
  // (only days with trades show a number).
  const hasDelta = Number.isFinite(summary?.pnlDollar)
  const showPnl =
    summary?.tradeCount > 0 || (basis === 'account' && hasDelta)

  return (
    <button
      type="button"
      className={`${styles.cell} ${isToday ? styles.today : ''}`}
      style={{ background: bg }}
      onClick={onClick}
      aria-label={`${cell.date}${summary ? `, P&L ${fmtSignedDollar(summary.pnlDollar)}` : ', no trades'}`}
    >
      <div className={styles.head}>
        <span className={styles.day}>{cell.day}</span>
        {psychologyOn && summary?.tilt && (
          <span
            className={styles.tiltBadge}
            title="Tilt day — rapid losses or revenge pattern"
            aria-label="Tilt day — rapid losses or revenge pattern"
          >
            <UIcon name="flame" size={13} />
          </span>
        )}
        {summary?.hasNotes && (
          <span className={styles.notesBadge} title="Has reflection notes"><UIcon name="edit" size={13} /></span>
        )}
        {summary?.expiringCount > 0 && (
          <span
            className={styles.expBadge}
            title={`${summary.expiringCount} option ${summary.expiringCount === 1 ? 'strategy' : 'strategies'} expiring`}
          >
            <UIcon name="clock" size={13} style={{ verticalAlign: '-2px', marginRight: 2 }} />{summary.expiringCount}
          </span>
        )}
        {summary?.tradeCount > 0 && (
          <span className={styles.tradeCount}>
            {summary.tradeCount} trade{summary.tradeCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {showPnl ? (
        <div className={styles.body}>
          <div className={styles.pnlBig}>{fmtSignedDollar(summary.pnlDollar)}</div>
          <div className={styles.pnlSmall}>
            <span>{fmtSignedPct(summary.pnlPercent)}</span>
            {summary.rSum !== 0 && (
              <span className={styles.rSum}>{fmtSignedR(summary.rSum)}</span>
            )}
          </div>
        </div>
      ) : null}
    </button>
  )
}
