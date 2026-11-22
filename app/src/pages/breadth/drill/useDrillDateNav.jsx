import { useCallback, useMemo } from 'react'
import { stepDate } from './scan/scanDeckModel'
import JoinedDateNav from './JoinedDateNav'

// The drill windows' date box (‹ date ›, a calendar, a year list) and their [ ] keys: one copy
// for the scan window and the reading-only window. A picked day snaps to the nearest session on
// or before it; a picked year opens that year's last session.
export default function useDrillDateNav({ rows, colKey, date, live, onNavigate }) {
  const prevTarget = rows && onNavigate ? stepDate(rows, date, live, -1) : null
  const nextTarget = rows && onNavigate ? stepDate(rows, date, live, 1) : null
  const step = useCallback((dir) => {
    const t = dir < 0 ? prevTarget : nextTarget
    if (t && colKey) onNavigate?.({ colKey, ...t })
  }, [prevTarget, nextTarget, colKey, onNavigate])
  const settledDates = useMemo(() => (rows || []).filter(r => !r?._live && r?.date).map(r => r.date), [rows])
  const goDate = useCallback((iso) => {
    const hit = settledDates.find(d => d <= iso) || settledDates[settledDates.length - 1]
    if (hit && colKey) onNavigate?.({ colKey, date: hit, live: false })
  }, [settledDates, colKey, onNavigate])
  const goYear = useCallback((y) => goDate(`${y}-12-31`), [goDate])
  const dateNav = onNavigate && settledDates.length ? (
    <JoinedDateNav
      topDate={live ? settledDates[0] : date}
      minDate={settledDates[settledDates.length - 1]}
      maxDate={settledDates[0]}
      canForward={!!nextTarget}
      onStep={step}
      onPickDate={goDate}
      onPickYear={goYear}
    />
  ) : null
  return { dateNav, step }
}
