/**
 * Week view — 7 day cards in a row. Each card shows the day's P&L,
 * count, and a compact trade list below. Click → day-detail page.
 */

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  cellBackground,
  dowLabels,
  fmtSignedDollar,
  fmtSignedPct,
  fmtSignedR,
  todayET,
} from '../../lib/calendar'
import UIcon from '../../../../components/ui/UIcon'
import styles from './WeekView.module.css'

function isoWeekToDates(year, week) {
  // ISO 8601 week 1 = the week containing Jan 4. Week starts Monday.
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Dow = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay() // Sun=7
  const week1Mon = new Date(jan4)
  week1Mon.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1))
  const monday = new Date(week1Mon)
  monday.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7)
  // Build Sunday-Saturday view (US convention) from the ISO Monday.
  // We display Sun-Sat: shift back 1 from Monday to Sunday.
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() - 1)
  const days = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday)
    d.setUTCDate(sunday.getUTCDate() + i)
    days.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`)
  }
  return days
}

export default function WeekView({ year, week, days = [], mode = 'pct', basis = 'closed' }) {
  const navigate = useNavigate()
  const weekDates = useMemo(() => isoWeekToDates(year, week), [year, week])
  const summaryByDate = useMemo(() => {
    const m = {}
    for (const d of days) m[d.date] = d
    return m
  }, [days])
  const today = todayET()
  const dows = dowLabels()

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        {weekDates.map((date, i) => {
          const summary = summaryByDate[date]
          const value =
            mode === 'dollar' ? summary?.pnlDollar :
            mode === 'r'      ? summary?.rSum :
                                summary?.pnlPercent
          const bg = cellBackground(value, mode)
          const isToday = date === today
          const dayNum = Number(date.slice(8, 10))
          // Account basis: every snapshot day has a real net-liq change → show it
          // even with no closed trades (open positions still mark to market).
          const hasDelta = Number.isFinite(summary?.pnlDollar)
          const showPnl =
            summary?.tradeCount > 0 || (basis === 'account' && hasDelta)
          return (
            <div
              key={date}
              className={`${styles.dayCard} ${isToday ? styles.today : ''}`}
              style={{ background: bg !== 'transparent' ? bg : undefined }}
            >
              <button
                type="button"
                className={styles.headBtn}
                onClick={() => navigate(`/journal-2-0/calendar/${date}`)}
              >
                <div className={styles.dowLabel}>{dows[i]}</div>
                <div className={styles.dayNum}>{dayNum}</div>
                {summary?.hasNotes && (
                  <span className={styles.notesBadge} title="Has notes"><UIcon name="edit" size={12} /></span>
                )}
              </button>
              {showPnl ? (
                <div className={styles.summary}>
                  <div className={styles.pnl}>{fmtSignedDollar(summary.pnlDollar)}</div>
                  <div className={styles.subtle}>
                    {fmtSignedPct(summary.pnlPercent)}
                    {summary.tradeCount > 0 ? ` · ${fmtSignedR(summary.rSum)}` : ''}
                  </div>
                  {summary.tradeCount > 0 && (
                    <div className={styles.count}>
                      {summary.tradeCount} trade{summary.tradeCount === 1 ? '' : 's'} · {summary.winners}W/{summary.losers}L
                    </div>
                  )}
                </div>
              ) : (
                <div className={styles.empty}>{basis === 'account' ? '—' : 'No trades'}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
