// TERM-033: the Options Flow ER-badge look-ahead week, read with its failure NAMED.
//
// The page builds its "earnings within 14 days" set from `/api/calendar` (this week) plus the
// next two weeks (`/api/calendar?week=YYYY-MM-DD`). Each look-ahead read used to end in
// `.catch(() => null)`: a failed week and a week with no reporters became the same `null`, and
// the badges for that week vanished as though nobody reported.
//
// Now a failed week resolves to `ER_WEEK_FAILED`, a frozen sentinel with no `days`. The page's
// own loop (`for (const p of weeks) if (p) flatten(p, map)`) reads it as a week contributing no
// badges -- the same rendering as before, by design, since the badge is a hint and the row flag
// is the fallback -- but the failure is now a stated outcome: `isErWeekFailed` says which, and
// the reason is logged once per week with the status or error that caused it.
//
// ⛔ PARTNER FILE, REBASE-SAFE HOOK. `OptionsFlow.jsx` calls `readErWeek(week)` in place of the
// inline fetch chain (one line). All logic and wording live here.

/** A look-ahead calendar week that could not be read. Truthy, frozen, carries no `days`. */
export const ER_WEEK_FAILED = Object.freeze({ ok: false, reason: 'er-week-read-failed' })

/** True when a look-ahead read failed (as opposed to a week that simply has no reporters). */
export const isErWeekFailed = (p) => p === ER_WEEK_FAILED

function note(week, why) {
  // eslint-disable-next-line no-console
  console.warn(`[flow] ER badges: calendar week ${week} could not be read (${why}); that week shows no ER badges`)
  return ER_WEEK_FAILED
}

/**
 * Read one look-ahead calendar week. Resolves the payload, or `ER_WEEK_FAILED` on a non-OK
 * status, an unreadable body or a network error. Never rejects.
 */
export async function readErWeek(week, fetchImpl) {
  const doFetch = fetchImpl || fetch
  let res
  try {
    res = await doFetch(`/api/calendar?week=${week}`)
  } catch (e) {
    return note(week, `network: ${(e && e.message) || 'error'}`)
  }
  if (!res || !res.ok) return note(week, `HTTP ${res ? res.status : 'none'}`)
  try {
    const body = await res.json()
    return body && typeof body === 'object' ? body : note(week, 'empty body')
  } catch {
    return note(week, 'unreadable body')
  }
}
