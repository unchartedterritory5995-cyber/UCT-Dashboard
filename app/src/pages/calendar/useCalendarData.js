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
  // C6: also carry hist_stats for post-earnings reaction display
  return {
    ...entry,
    expected_move: e.expected_move,
    beat_history:  e.beat_history,
    hist_stats:    e.hist_stats ?? null,
  }
}

export function isMine(sym, sets, sources) {
  if (!sym || !sets) return false
  const S = sym.toUpperCase()
  return (sources || []).some(src => (sets[src] || []).includes(S))
}

// The calendar hook's fetcher THROWS on !ok (unlike the shared null-mapping
// fetcher) so an HTTP failure reaches SWR's `error` and the page renders the
// Retry branch — a paged week has refreshInterval 0, so a null-mapped 502
// would otherwise be a permanent skeleton with no way out.
const calendarFetcher = async (url) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`calendar ${r.status}`)
  return r.json()
}

export function useCalendar(week) {
  // week = Monday ISO (YYYY-MM-DD) for paged weeks, or null/undefined for the
  // current week. Non-current weeks are near-static server-side (1-6 h cache),
  // so the client polls only the current week.
  const url = week ? `/api/calendar?week=${week}` : '/api/calendar'
  return useMobileSWR(url, calendarFetcher, {
    refreshInterval: week ? 0 : 2 * 60 * 1000,
    revalidateOnFocus: false,
    marketHoursOnly: !week,
    keepPreviousData: false,
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

// Live post-print reaction (todaysChangePerc) for reported tickers on a given
// day → { SYM: number }. Called per-DayGroup (stable component-level hook).
export function useReactions(ds) {
  return useMobileSWR(
    ds ? `/api/calendar/reactions?date=${ds}` : null,
    fetcher,
    { refreshInterval: 30 * 1000, revalidateOnFocus: false, marketHoursOnly: true },
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
    // ONE batch request for the whole week (was one fetch per day → N round-trips
    // + N backend threadpool slots). Falls back to {} on any failure.
    () => fetch(`/api/calendar/enrichment-batch?dates=${weekDates.join(',')}`)
      .then(r => (r.ok ? r.json() : {}))
      .then(e => e || {})
      .catch(() => ({})),
    { refreshInterval: 300000, revalidateOnFocus: false }
  )
}

// Day-level metrics: price, avg_vol, mc_b — consumed by FeedView DayGroup
// to enable A3 vol/price/mcap filtering on entries.
export function useDayMetrics(ds) {
  return useMobileSWR(
    ds ? `/api/calendar/day-metrics?date=${ds}` : null,
    fetcher,
    { refreshInterval: 2 * 60 * 1000, revalidateOnFocus: false, marketHoursOnly: true },
  )
}

// Whole-week metrics in ONE request — merged into the day map BEFORE the
// importance tiering runs (the hierarchy ranks on mc_b/dollar-volume; per-day
// fetches inside DayGroup arrived AFTER tiering and left paged weeks ranking
// on nothing). Single stable hook, same pattern as useWeekEnrichment.
export function useWeekMetrics(weekDates) {
  const key = weekDates && weekDates.length ? `metrics:${weekDates.join(',')}` : null
  return useSWR(
    key,
    () => fetch(`/api/calendar/day-metrics-batch?dates=${weekDates.join(',')}`)
      .then(r => (r.ok ? r.json() : {}))
      .then(m => m || {})
      .catch(() => ({})),
    { refreshInterval: 2 * 60 * 1000, revalidateOnFocus: false }
  )
}

// Full-month earnings from /api/calendar/month
export function useMonthCalendar(year, month) {
  return useSWR(
    year && month ? `/api/calendar/month?year=${year}&month=${month}` : null,
    fetcher,
    { refreshInterval: _MONTH_REFRESH, revalidateOnFocus: false },
  )
}

const _MONTH_REFRESH = 30 * 60 * 1000 // 30 min — matches backend TTL

// ── B3: IPO calendar hook ─────────────────────────────────────────────────────

/**
 * useIpos(from, to) — SWR hook for GET /api/calendar/ipos?from=&to=
 *
 * Returns { data: [{ sym, name, date, exchange, price_range, shares, value, status }], ... }
 * Null key when from/to are not yet known → SWR skips.
 * Cached 6 h on the server; client refreshes every 30 min.
 */
export function useIpos(from, to) {
  const key = from && to ? `/api/calendar/ipos?from=${from}&to=${to}` : null
  return useSWR(key, fetcher, {
    refreshInterval: 30 * 60 * 1000,
    revalidateOnFocus: false,
  })
}

// ── B3: Dividends/splits hook ─────────────────────────────────────────────────

/**
 * useDividends(syms) — SWR hook for GET /api/calendar/dividends?syms=A,B,...
 *
 * syms: comma-separated string OR null (→ uses server-side My-Stocks default).
 * Returns { data: [{ sym, type, date, amount?, ratio? }], ... }
 * Cached 12 h on the server; client refreshes every 30 min.
 */
export function useDividends(syms) {
  // Null-gate: skip the request entirely when syms is falsy (chip is off or
  // data not ready). When syms is provided, scope to that sym list; when
  // truthy but empty string, fall back to server-side My-Stocks default.
  const url = syms ? `/api/calendar/dividends?syms=${syms}` : null
  return useSWR(url, fetcher, {
    refreshInterval: 30 * 60 * 1000,
    revalidateOnFocus: false,
  })
}
