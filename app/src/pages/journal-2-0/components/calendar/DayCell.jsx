/**
 * Calendar day cell — shown in Month/Week grids.
 *
 * Layout: day number top-left, hasNotes badge top-right, big P&L $
 * centered, % return + R-sum stacked below in small. Background tinted
 * by metric intensity (% / $ / R modes).
 */

import { useNavigate } from 'react-router-dom'
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
 */
export default function DayCell({ cell, summary, mode = 'pct', isToday = false }) {
  const navigate = useNavigate()
  if (!cell) return <div className={styles.blank} />

  const value =
    mode === 'dollar' ? summary?.pnlDollar :
    mode === 'r'      ? summary?.rSum :
                        summary?.pnlPercent
  const bg = cellBackground(value, mode)

  const onClick = () => navigate(`/journal-2-0/calendar/${cell.date}`)

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
        {summary?.hasNotes && (
          <span className={styles.notesBadge} title="Has reflection notes">📝</span>
        )}
        {summary?.tradeCount > 0 && (
          <span className={styles.tradeCount}>
            {summary.tradeCount} trade{summary.tradeCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {summary?.tradeCount > 0 ? (
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
