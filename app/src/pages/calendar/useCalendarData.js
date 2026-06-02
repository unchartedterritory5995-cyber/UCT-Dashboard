// app/src/pages/calendar/useCalendarData.js
import useSWR from 'swr'
import useMobileSWR from '../../hooks/useMobileSWR'

const fetcher = (url) => fetch(url).then(r => r.ok ? r.json() : null)

export function buildWeekDates(weekStart) {
  if (!weekStart) return []
  const out = []
  const start = new Date(weekStart + 'T00:00:00')
  for (let i = 0; i < 5; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

export function mergeEnrichment(entry, enrichment) {
  const e = enrichment?.[entry.sym]
  if (!e) return entry
  return { ...entry, expected_move: e.expected_move, beat_history: e.beat_history }
}

export function isMine(sym, sets, sources) {
  if (!sym || !sets) return false
  const S = sym.toUpperCase()
  return (sources || []).some(src => (sets[src] || []).includes(S))
}

export function useCalendar() {
  return useMobileSWR('/api/calendar', fetcher, {
    refreshInterval: 2 * 60 * 1000, revalidateOnFocus: false, marketHoursOnly: true,
  })
}

export function useCalendarMySets() {
  return useMobileSWR('/api/calendar/my-sets', fetcher, {
    refreshInterval: 5 * 60 * 1000, revalidateOnFocus: false,
  })
}

export function useEnrichment(activeDate) {
  return useMobileSWR(
    activeDate ? `/api/calendar/enrichment?date=${activeDate}` : null,
    fetcher,
    { refreshInterval: 5 * 60 * 1000, revalidateOnFocus: false, marketHoursOnly: true },
  )
}

// One SWR subscription for the whole week — fetcher fans out to the per-day
// enrichment endpoint and returns a { [ds]: {SYM:{expected_move,beat_history}} } map.
// MUST be a single stable hook (not a loop) to avoid "rendered more hooks than during
// the previous render" crash when weekDates length changes between renders.
export function useWeekEnrichment(weekDates) {
  const key = weekDates && weekDates.length ? `enrich:${weekDates.join(',')}` : null
  return useSWR(
    key,
    () => Promise.all(
      weekDates.map(ds =>
        fetch(`/api/calendar/enrichment?date=${ds}`)
          .then(r => (r.ok ? r.json() : {}))
          .then(e => [ds, e || {}])
          .catch(() => [ds, {}])
      )
    ).then(Object.fromEntries),
    { refreshInterval: 300000, revalidateOnFocus: false }
  )
}
