/**
 * Today — compact week strip (P4 B3).
 *
 * A COMPACT skin of the Calendar week view: 7 Sun–Sat day cells for the CURRENT
 * ISO week, each showing per-day P&L + trade count and deep-linking to the same
 * Journal day page as the full WeekView (`/journal-2-0/calendar/${date}`).
 *
 * Reuses WeekView's LOGIC (option (b) from the plan) rather than the full-size
 * card component — the raw `WeekView.dayCard` is a 220px card that can't be
 * compacted cleanly across CSS-module boundaries, so this is a thin custom row
 * over the SAME `useJ2Calendar({view:'week'})` feed + the SAME per-cell
 * `navigate('/journal-2-0/calendar/${date}')` deep-link. The ISO-week date math
 * mirrors WeekView's `isoWeekToDates` so the strip lines up with the full week
 * view AND the backend feed's `_iso_week_bounds`.
 *
 * Scoped to the selected account (All-Accounts aggregates). Phone stays a
 * compact 7-cell row via CSS `@media (max-width:640px)` (never a JS breakpoint).
 * No emoji — the header glyph is a `UIcon`.
 */
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import useJ2SelectedAccount from '../../hooks/useJ2SelectedAccount'
import useJ2Calendar from '../../hooks/useJ2Calendar'
import { todayET, dowLabels, fmtSignedDollar } from '../../lib/calendar'
import UIcon from '../../../../components/ui/UIcon'
import styles from './TodayWeekStrip.module.css'

/** ISO 8601 week (Thursday-based) → `{ year, week }` for a YYYY-MM-DD date. */
function isoWeekOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const dow = dt.getUTCDay() === 0 ? 7 : dt.getUTCDay() // Mon=1 … Sun=7
  dt.setUTCDate(dt.getUTCDate() + 4 - dow) // shift to the Thursday of this week
  const isoYear = dt.getUTCFullYear()
  const yearStart = new Date(Date.UTC(isoYear, 0, 1))
  const week = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7)
  return { year: isoYear, week }
}

/**
 * ISO week `(year, week)` → 7 Sun–Sat `YYYY-MM-DD` strings. IDENTICAL to
 * `WeekView.isoWeekToDates` so the strip and the full week view frame the same
 * days (the leading Sunday is the one before the ISO Monday — US display
 * convention).
 */
function isoWeekToDates(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Dow = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay()
  const week1Mon = new Date(jan4)
  week1Mon.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1))
  const monday = new Date(week1Mon)
  monday.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() - 1)
  const days = []
  for (let i = 0; i < 7; i++) {
    const dd = new Date(sunday)
    dd.setUTCDate(sunday.getUTCDate() + i)
    days.push(
      `${dd.getUTCFullYear()}-${String(dd.getUTCMonth() + 1).padStart(2, '0')}-${String(dd.getUTCDate()).padStart(2, '0')}`,
    )
  }
  return days
}

export default function TodayWeekStrip() {
  const navigate = useNavigate()
  const { accountId, account } = useJ2SelectedAccount()

  const today = todayET()
  const { year, week } = useMemo(() => isoWeekOf(today), [today])
  const weekDates = useMemo(() => isoWeekToDates(year, week), [year, week])

  // Broker accounts read account-balance P&L (net-liq marks even with no closed
  // trades); manual accounts read closed-trade P&L. Mirrors CalendarTab.
  const isBroker = !!account && account.balanceSource && account.balanceSource !== 'manual'
  const requestBasis = isBroker ? 'account' : 'closed'
  const { days, basis: serverBasis } = useJ2Calendar({
    view: 'week',
    year,
    week,
    accountId,
    basis: requestBasis,
  })
  const dataBasis = serverBasis || requestBasis

  const summaryByDate = useMemo(() => {
    const m = {}
    for (const d of days) m[d.date] = d
    return m
  }, [days])
  const dows = dowLabels()

  return (
    <section className={styles.strip} aria-label="This week">
      <div className={styles.head}>
        <span className={styles.dot}><UIcon name="calendar" size={14} /></span>
        <h3 className={styles.title}>This week</h3>
      </div>

      <div className={styles.row}>
        {weekDates.map((date, i) => {
          const s = summaryByDate[date]
          const hasDelta = Number.isFinite(s?.pnlDollar)
          const showPnl = s?.tradeCount > 0 || (dataBasis === 'account' && hasDelta)
          const isToday = date === today
          const positive = (s?.pnlDollar ?? 0) >= 0
          const dayNum = Number(date.slice(8, 10))
          return (
            <button
              key={date}
              type="button"
              data-testid="week-cell"
              className={`${styles.cell} ${isToday ? styles.cellToday : ''}`}
              onClick={() => navigate(`/journal-2-0/calendar/${date}`)}
              aria-label={`${dows[i]} ${dayNum}${showPnl ? `, ${fmtSignedDollar(s.pnlDollar)}` : ', no trades'}`}
            >
              <span className={styles.dow}>{dows[i]}</span>
              <span className={styles.dayNum}>{dayNum}</span>
              {showPnl ? (
                <>
                  <span className={`${styles.pnl} ${positive ? styles.pos : styles.neg}`}>
                    {fmtSignedDollar(s.pnlDollar)}
                  </span>
                  <span className={styles.count}>
                    {s.tradeCount > 0
                      ? `${s.tradeCount} trade${s.tradeCount === 1 ? '' : 's'}`
                      : '—'}
                  </span>
                </>
              ) : (
                <span className={styles.empty}>·</span>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}
