// app/src/pages/calendar/weekAnchor.js
//
// ⭐ THE ONE PLACE the calendar decides which week "now" belongs to, plus the
// two date primitives that answer is built from. Pure — no React, no SWR, no
// ambient clock read: every function here takes the day it should reason about.
//
// ── Why this module exists ──────────────────────────────────────────────────
// There used to be TWO rules for "the current week's Monday" and they
// disagreed on exactly two days out of seven:
//
//     api/routers/calendar.py::_week_dates()   Sat/Sun → rolls FORWARD to the
//                                              Monday about to start
//     Calendar.jsx  mondayOf(todayIso())       Sat/Sun → snaps BACK to the
//                                              Monday just past
//
//     2026-08-07 Fri  backend 2026-08-03   frontend 2026-08-03   AGREE
//     2026-08-08 Sat  backend 2026-08-10   frontend 2026-08-03   7 DAYS APART
//     2026-08-09 Sun  backend 2026-08-10   frontend 2026-08-03   7 DAYS APART
//     2026-08-10 Mon  backend 2026-08-10   frontend 2026-08-10   AGREE
//
// The forward roll is the PRODUCT DECISION and is preserved: a member opening
// the calendar on a Saturday should see the upcoming week. The bug was the
// disagreement about it. Every weekend it made "Next week ▶" a visual no-op
// (the grid already showed the backend's week, so +7 from the frontend's
// stale base asked for the week already on screen, and the backend served the
// same payload) and made "◀ Prev week" skip a week.
//
// ⛔ DO NOT add a third derivation. `currentWeekMonday` below is the frontend's
// single expression of the backend's `_current_week_monday`, and
// `tests/test_calendar_week_anchor.py` EXECUTES BOTH and compares them on
// every day of the week — change one side alone and that test goes red.
//
// ⛔ Never `toISOString()` a local-midnight Date to get a calendar date: it
// converts to UTC and moves the day back one for every browser east of UTC
// (Tokyo, NZDT, Samoa). That is what `localIso` is for.

/**
 * A Date's LOCAL calendar parts as an ISO day string (YYYY-MM-DD).
 * @param {Date} d
 * @returns {string}
 */
export function localIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * ISO Monday of the week CONTAINING an ISO day (Sat/Sun snap back to that
 * Monday). Mirrors the backend's `_monday_of`, which is what the `?week=`
 * handler snaps an arbitrary URL date with — so a deep link normalizes the
 * same way on both sides.
 *
 * Returns null for calendar-invalid input ('2026-13-05' passes the URL regex
 * but must fall back to the current week, not crash the render).
 *
 * @param {string} iso
 * @returns {string|null}
 */
export function mondayOf(iso) {
  const d = new Date(iso + 'T12:00:00')       // noon-anchored: DST-safe date math
  if (Number.isNaN(d.getTime())) return null
  const shift = (d.getDay() + 6) % 7          // Mon=0 … Sun=6
  d.setDate(d.getDate() - shift)
  return localIso(d)
}

/**
 * `iso` if it is a weekday; the next Monday if it is a Saturday or Sunday.
 * An earnings week IS Monday–Friday, so a weekend day has no session of its
 * own — it belongs to the week about to start.
 *
 * @param {string} iso
 * @returns {string|null}
 */
export function nextSessionDay(iso) {
  const d = new Date(iso + 'T12:00:00')
  if (Number.isNaN(d.getTime())) return null
  const dow = (d.getDay() + 6) % 7            // Mon=0 … Sun=6
  if (dow >= 5) d.setDate(d.getDate() + (7 - dow))
  return localIso(d)
}

/**
 * ⭐ The Monday of the week the calendar SHOWS for `todayIsoStr`.
 *
 * Same rule, same words, as `api/routers/calendar.py::_current_week_monday`:
 * the ISO Monday of the next session day. Identity on a weekday; a roll
 * forward on Sat/Sun.
 *
 * Takes the day as an argument rather than reading the clock so the caller
 * derives "today" ONCE (see commit 184042e5: two derivations of one value are
 * how a 22-minute suite ended up 7 days out of step with itself).
 *
 * @param {string} todayIsoStr  YYYY-MM-DD, already ET-anchored by the caller
 * @returns {string|null}
 */
export function currentWeekMonday(todayIsoStr) {
  const session = nextSessionDay(todayIsoStr)
  return session === null ? null : mondayOf(session)
}
