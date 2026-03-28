// app/src/pages/journal/tabs/CalendarReview.jsx
import { useState, useMemo, useCallback } from 'react'
import useSWR from 'swr'
import styles from './CalendarReview.module.css'

const fetcher = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json() })

const REVIEW_COLORS = {
  draft: { bg: 'rgba(148,163,184,0.1)', color: 'var(--text-muted)', border: 'var(--border)' },
  logged: { bg: 'rgba(107,163,190,0.12)', color: 'var(--info)', border: 'var(--info-border)' },
  partial: { bg: 'var(--warn-bg)', color: 'var(--warn)', border: 'var(--warn-border)' },
  reviewed: { bg: 'var(--gain-bg)', color: 'var(--gain)', border: 'var(--gain-border)' },
  flagged: { bg: 'var(--loss-bg)', color: 'var(--loss)', border: 'var(--loss-border)' },
  follow_up: { bg: 'var(--warn-bg)', color: 'var(--ut-gold)', border: 'var(--warn-border)' },
}

const DOT_CLASS_MAP = {
  reviewed: 'dotReviewed',
  partial: 'dotPartial',
  logged: 'dotLogged',
  draft: 'dotDraft',
  flagged: 'dotFlagged',
  follow_up: 'dotFollowUp',
}

function formatMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number)
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  return `${months[m - 1]} ${y}`
}

function formatDayHeading(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`
}

function buildCalendarGrid(monthStr) {
  const [y, m] = monthStr.split('-').map(Number)
  const firstDay = new Date(y, m - 1, 1)
  const daysInMonth = new Date(y, m, 0).getDate()

  // Monday = 0, Sunday = 6
  let startDow = firstDay.getDay() - 1
  if (startDow < 0) startDow = 6

  const grid = []
  // Leading empty cells
  for (let i = 0; i < startDow; i++) {
    grid.push(null)
  }
  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const dd = String(d).padStart(2, '0')
    const mm = String(m).padStart(2, '0')
    grid.push(`${y}-${mm}-${dd}`)
  }
  // Trailing empty cells to complete last row
  while (grid.length % 7 !== 0) {
    grid.push(null)
  }
  return grid
}

export default function CalendarReview({ onOpenTrade }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [selectedDay, setSelectedDay] = useState(null)

  const { data: calData, error, isLoading } = useSWR(
    `/api/journal/calendar?month=${month}`,
    fetcher,
    { refreshInterval: 120000, dedupingInterval: 30000, revalidateOnFocus: false }
  )

  const grid = useMemo(() => buildCalendarGrid(month), [month])
  const todayStr = new Date().toISOString().slice(0, 10)

  const prevMonth = useCallback(() => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    setMonth(d.toISOString().slice(0, 7))
    setSelectedDay(null)
  }, [month])

  const nextMonth = useCallback(() => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m, 1)
    setMonth(d.toISOString().slice(0, 7))
    setSelectedDay(null)
  }, [month])

  // Fetch trades for selected day
  const { data: dayTrades } = useSWR(
    selectedDay ? `/api/journal?date_from=${selectedDay}&date_to=${selectedDay}&limit=50` : null,
    fetcher,
    { dedupingInterval: 10000, revalidateOnFocus: false }
  )

  // Fetch daily journal for selected day
  const { data: dayJournal } = useSWR(
    selectedDay ? `/api/journal/daily/${selectedDay}` : null,
    fetcher,
    { dedupingInterval: 10000, revalidateOnFocus: false }
  )

  const dayData = selectedDay ? calData?.days?.[selectedDay] : null
  const trades = dayTrades?.trades || []

  if (error) {
    return (
      <div className={styles.wrap}>
        <div className={styles.error}>
          Failed to load calendar data. Check your connection.
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      {/* Month navigation */}
      <div className={styles.calHeader}>
        <button onClick={prevMonth} className={styles.calNav} aria-label="Previous month">&#x2190;</button>
        <span className={styles.calMonth}>{formatMonth(month)}</span>
        <button onClick={nextMonth} className={styles.calNav} aria-label="Next month">&#x2192;</button>
      </div>

      {/* Day headers */}
      <div className={styles.dayHeaders}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
          <div key={d} className={styles.dayHeader}>{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      {isLoading && !calData ? (
        <div className={styles.loading}>
          <div className={styles.loadingBar} />
          <span>Loading calendar...</span>
        </div>
      ) : (
        <div className={styles.calGrid}>
          {grid.map((dateStr, i) => {
            if (!dateStr) {
              return <div key={i} className={`${styles.cell} ${styles.cellEmpty}`} />
            }

            const day = parseInt(dateStr.slice(-2))
            const data = calData?.days?.[dateStr]
            const isToday = dateStr === todayStr
            const isSelected = dateStr === selectedDay
            const hasTrades = data && data.trade_count > 0

            const cellCls = [
              styles.cell,
              isToday ? styles.cellToday : '',
              isSelected ? styles.cellSelected : '',
              hasTrades && data.net_pnl_pct >= 0 ? styles.cellGain : '',
              hasTrades && data.net_pnl_pct < 0 ? styles.cellLoss : '',
            ].filter(Boolean).join(' ')

            if (!hasTrades) {
              return (
                <div key={i} className={cellCls} onClick={() => setSelectedDay(dateStr)}>
                  <span className={styles.cellDay}>{day}</span>
                </div>
              )
            }

            const winRate = data.trade_count > 0 ? ((data.wins || 0) / data.trade_count) * 100 : 0

            return (
              <div key={i} className={cellCls} onClick={() => setSelectedDay(dateStr)}>
                <span className={styles.cellDay}>{day}</span>
                <span className={data.net_pnl_pct >= 0 ? styles.cellPnlGain : styles.cellPnlLoss}>
                  {data.net_pnl_pct > 0 ? '+' : ''}{Number(data.net_pnl_pct).toFixed(1)}%
                </span>
                <span className={styles.cellCount}>
                  {data.trade_count} trade{data.trade_count !== 1 ? 's' : ''}
                </span>
                <div className={styles.winBar}>
                  <div className={styles.winBarFill} style={{ width: `${winRate}%` }} />
                </div>
                <div className={styles.cellDots}>
                  {data.review_statuses?.map((s, j) => (
                    <span key={j} className={`${styles.dot} ${styles[DOT_CLASS_MAP[s]] || styles.dotDraft}`} />
                  ))}
                  {data.has_daily_journal && (
                    <span className={`${styles.dot} ${styles.dotJournal}`} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Day detail panel */}
      {selectedDay && (
        <div className={styles.dayDetail}>
          <div className={styles.dayDetailHeader}>
            <span className={styles.dayDetailDate}>{formatDayHeading(selectedDay)}</span>
            <button className={styles.dayDetailClose} onClick={() => setSelectedDay(null)}>&#x00D7;</button>
          </div>

          {dayData ? (
            <>
              {/* Day metrics */}
              <div className={styles.dayMetrics}>
                <div className={styles.dayMetric}>
                  <span className={styles.dayMetricLabel}>Net P&L</span>
                  <span className={`${styles.dayMetricValue} ${
                    dayData.net_pnl_pct >= 0 ? styles.dayMetricGain : styles.dayMetricLoss
                  }`}>
                    {dayData.net_pnl_pct > 0 ? '+' : ''}{Number(dayData.net_pnl_pct).toFixed(2)}%
                  </span>
                </div>
                <div className={styles.dayMetric}>
                  <span className={styles.dayMetricLabel}>Trades</span>
                  <span className={styles.dayMetricValue}>{dayData.trade_count}</span>
                </div>
                <div className={styles.dayMetric}>
                  <span className={styles.dayMetricLabel}>Win Rate</span>
                  <span className={styles.dayMetricValue}>
                    {dayData.trade_count > 0
                      ? `${((dayData.wins || 0) / dayData.trade_count * 100).toFixed(0)}%`
                      : '--'}
                  </span>
                </div>
                {dayData.avg_process_score != null && (
                  <div className={styles.dayMetric}>
                    <span className={styles.dayMetricLabel}>Process</span>
                    <span className={styles.dayMetricValue}>{Math.round(dayData.avg_process_score)}</span>
                  </div>
                )}
                {dayData.net_pnl_dollar != null && (
                  <div className={styles.dayMetric}>
                    <span className={styles.dayMetricLabel}>P&L $</span>
                    <span className={`${styles.dayMetricValue} ${
                      dayData.net_pnl_dollar >= 0 ? styles.dayMetricGain : styles.dayMetricLoss
                    }`}>
                      {dayData.net_pnl_dollar >= 0 ? '+' : ''}${Math.abs(dayData.net_pnl_dollar).toFixed(0)}
                    </span>
                  </div>
                )}
              </div>

              {/* Trades list */}
              {trades.length > 0 && (
                <>
                  <div className={styles.dayTradesHeader}>Trades ({trades.length})</div>
                  {trades.map(trade => {
                    const rs = REVIEW_COLORS[trade.review_status] || REVIEW_COLORS.draft
                    const rLabel = trade.review_status === 'follow_up' ? 'FOLLOW-UP' : (trade.review_status || 'DRAFT').toUpperCase()
                    return (
                      <div
                        key={trade.id}
                        className={styles.dayTradeRow}
                        onClick={() => onOpenTrade && onOpenTrade(trade.id)}
                      >
                        <span className={styles.dtSym}>{trade.sym}</span>
                        <span className={styles.dtDir}>{(trade.direction || 'long').toUpperCase()}</span>
                        <span className={styles.dtSetup}>{trade.setup || '--'}</span>
                        <span className={trade.pnl_pct >= 0 ? styles.dtPnlGain : styles.dtPnlLoss}>
                          {trade.pnl_pct != null
                            ? `${trade.pnl_pct > 0 ? '+' : ''}${Number(trade.pnl_pct).toFixed(2)}%`
                            : '--'}
                        </span>
                        <span
                          className={styles.dtReview}
                          style={{ background: rs.bg, color: rs.color, borderColor: rs.border }}
                        >
                          {rLabel}
                        </span>
                      </div>
                    )
                  })}
                </>
              )}

              {/* Daily journal excerpt */}
              {dayJournal && (dayJournal.eod_recap || dayJournal.premarket_thesis) && (
                <div className={styles.journalExcerpt}>
                  <div className={styles.excerptLabel}>Journal Excerpt</div>
                  <div className={styles.excerptText}>
                    {dayJournal.eod_recap || dayJournal.premarket_thesis || ''}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className={styles.dayDetailEmpty}>
              No trading activity on this day.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
