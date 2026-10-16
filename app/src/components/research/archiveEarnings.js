// app/src/components/research/archiveEarnings.js
//
// Which of the team's archived calls sat around each past earnings report. Pure: it takes the
// quarters the Earnings history section already built (earningsHistoryModel.buildQuarters) and
// the archive's calls for the ticker, and pairs them by DATE — nothing is fetched here.
//
// ⛔ A quarter with no `report_date` is skipped, never guessed. `report_date` and `period_end`
// are different days (earningsHistoryModel's DECISION 3), and pairing calls to a period end
// would put a call made weeks before the report beside it as if it were a reaction to it.

/** Calendar days either side of a report a call still counts as "around" it. */
export const AROUND_REPORT_DAYS = 5

const DAY_MS = 86_400_000

function dayNumber(value) {
  if (typeof value !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(t) ? Math.round(t / DAY_MS) : null
}

/**
 * [{quarter, report_date, calls: [call, ...]}] for every reported quarter that has at least one
 * team call within ±`days` calendar days of its report date. Calls are oldest first; a call is
 * placed beside the NEAREST report only, so two close reports never both claim it.
 */
export function callsAroundReports(quarters, calls, { days = AROUND_REPORT_DAYS } = {}) {
  const reports = (Array.isArray(quarters) ? quarters : [])
    .filter((q) => q?.reported && dayNumber(q.report_date) != null)
    .map((q) => ({ quarter: q.quarter, report_date: q.report_date.slice(0, 10), day: dayNumber(q.report_date), calls: [] }))
  if (!reports.length) return []
  for (const c of Array.isArray(calls) ? calls : []) {
    const d = dayNumber(c?.posted)
    if (d == null) continue
    let best = null
    for (const r of reports) {
      const gap = Math.abs(d - r.day)
      if (gap <= days && (best == null || gap < best.gap)) best = { r, gap }
    }
    if (best) best.r.calls.push(c)
  }
  return reports
    .filter((r) => r.calls.length)
    .map(({ quarter, report_date, calls: cs }) => ({
      quarter,
      report_date,
      calls: [...cs].sort((a, b) => String(a.posted || '').localeCompare(String(b.posted || ''))),
    }))
}
