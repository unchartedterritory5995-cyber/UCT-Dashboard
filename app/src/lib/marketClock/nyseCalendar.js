// app/src/lib/marketClock/nyseCalendar.js
//
// S11 (Session & Market Clock) — the versioned calendar dataset itself.
// product-architecture.md's S11 block: "a versioned calendar (published
// years ahead), shipped as code" (§4.1 evidence C7-02 §4.1/§4.2). NYSE
// publishes its full-year holiday + early-close schedule years in advance,
// so this is public, non-vendor information — no D1 dependency needed
// (product-architecture.md S11 row: "Dependencies: None on applications; D1
// only if the calendar is vendor-sourced" — it is not, here).
//
// ⛔ CORRECTION vs capability-infrastructure-matrix.md's own S11 row: that
// row names "NYSE's 2026 early closes (3 July, 27 November, 24 December)"
// as the dataset's shape. NYSE's actual published 2026 schedule has July 3
// as a FULL holiday closure (July 4 falls on a Saturday; NYSE observes the
// holiday on the preceding Friday as a full close, not a half day) — only
// November 27 (day after Thanksgiving) and December 24 (Christmas Eve) are
// early closes (1:00 PM ET). This is the one factual correction this S11
// slice makes to that document, per the contract-verification instruction
// ("if only minor documentation corrections are required, correct them and
// continue") — the data below reflects NYSE's real published calendar, not
// the matrix row's paraphrase of it.
//
// Coverage started at ONE year (2026) — "small, well-bounded" per the
// matrix's own sizing — and is extended by hand, one year at a time, well
// ahead of the prior year's Dec 31 cliff (Seam 7 architecture adjudication,
// 2026-09-07: `extSession.test.js`/`marketSession.dailypaint.test.js` pin
// the out-of-coverage degrade as intentional -- "no throw, no guess" -- but
// that degrade silently reintroduces Seam 6's exact defect class once a
// year's coverage lapses, so this table must stay at least one year ahead
// of `today`, not just "the current year"). A date outside `COVERED_YEARS`
// still degrades gracefully (see marketClock.js's `calendarCoverage` flag)
// rather than guessing a future year's holiday dates -- this is the safety
// net for a year nobody has added yet, not a substitute for adding it.
//
// `tests/test_nyse_calendar_parity.py` cross-checks every year here against
// `bars_fetch.py::_NYSE_HOLIDAYS_YYYYMMDD` (the backend's own independently
// hand-maintained table) -- add a year to BOTH together, or the parity test
// fails on the year this table stops matching.

export const COVERED_YEARS = Object.freeze([2026, 2027])

/** Full-day NYSE closures, 2026. ISO date strings (NYSE's own local/ET
 *  calendar date — these are whole-day closures, never partial). */
export const NYSE_HOLIDAYS_2026 = Object.freeze([
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-01-19', name: 'Martin Luther King, Jr. Day' },
  { date: '2026-02-16', name: "Washington's Birthday" },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-05-25', name: 'Memorial Day' },
  { date: '2026-06-19', name: 'Juneteenth National Independence Day' },
  { date: '2026-07-03', name: 'Independence Day (observed)' },
  { date: '2026-09-07', name: 'Labor Day' },
  { date: '2026-11-26', name: 'Thanksgiving Day' },
  { date: '2026-12-25', name: 'Christmas Day' },
])

/** Early-close (1:00 PM ET regular-session close) trading days, 2026. */
export const NYSE_EARLY_CLOSES_2026 = Object.freeze([
  { date: '2026-11-27', name: 'Day after Thanksgiving', closeHour: 13, closeMinute: 0 },
  { date: '2026-12-24', name: 'Christmas Eve', closeHour: 13, closeMinute: 0 },
])

/** Full-day NYSE closures, 2027. Matches `bars_fetch.py::_NYSE_HOLIDAYS_YYYYMMDD`'s
 *  already-existing 2027 dates (verified via the Seam 7 parity adjudication,
 *  2026-09-07) -- June 19 2027 falls on a Saturday (observed Fri Jun 18), July 4
 *  2027 falls on a Sunday (observed Mon Jul 5), Dec 25 2027 falls on a Saturday
 *  (observed Fri Dec 24 -- a FULL closure, NOT an early close, unlike Dec 24 2026). */
export const NYSE_HOLIDAYS_2027 = Object.freeze([
  { date: '2027-01-01', name: "New Year's Day" },
  { date: '2027-01-18', name: 'Martin Luther King, Jr. Day' },
  { date: '2027-02-15', name: "Washington's Birthday" },
  { date: '2027-03-26', name: 'Good Friday' },
  { date: '2027-05-31', name: 'Memorial Day' },
  { date: '2027-06-18', name: 'Juneteenth National Independence Day (observed)' },
  { date: '2027-07-05', name: 'Independence Day (observed)' },
  { date: '2027-09-06', name: 'Labor Day' },
  { date: '2027-11-25', name: 'Thanksgiving Day' },
  { date: '2027-12-24', name: 'Christmas Day (observed)' },
])

/** Early-close (1:00 PM ET regular-session close) trading days, 2027. Only
 *  the day after Thanksgiving -- Dec 24 2027 is a FULL closure this year
 *  (see NYSE_HOLIDAYS_2027 above), not an early close. */
export const NYSE_EARLY_CLOSES_2027 = Object.freeze([
  { date: '2027-11-26', name: 'Day after Thanksgiving', closeHour: 13, closeMinute: 0 },
])

const _BY_YEAR = Object.freeze({
  2026: Object.freeze({
    holidays: NYSE_HOLIDAYS_2026,
    earlyCloses: NYSE_EARLY_CLOSES_2026,
  }),
  2027: Object.freeze({
    holidays: NYSE_HOLIDAYS_2027,
    earlyCloses: NYSE_EARLY_CLOSES_2027,
  }),
})

function _yearOf(isoDate) {
  return Number(isoDate.slice(0, 4))
}

/** Whether `year` has real published-calendar coverage in this module. */
export function hasCoverage(year) {
  return Object.prototype.hasOwnProperty.call(_BY_YEAR, year)
}

/** `{name}` if `isoDate` (YYYY-MM-DD, ET calendar date) is a full NYSE
 *  holiday closure, else `null`. Returns `null` (not a guess) for a year
 *  outside coverage — the caller degrades via `calendarCoverage`. */
export function holidayOn(isoDate) {
  const year = _yearOf(isoDate)
  const table = _BY_YEAR[year]
  if (!table) return null
  const hit = table.holidays.find((h) => h.date === isoDate)
  return hit ? { name: hit.name } : null
}

/** `{name, closeHour, closeMinute}` if `isoDate` is an NYSE early-close
 *  trading day, else `null`. */
export function earlyCloseOn(isoDate) {
  const year = _yearOf(isoDate)
  const table = _BY_YEAR[year]
  if (!table) return null
  const hit = table.earlyCloses.find((e) => e.date === isoDate)
  return hit || null
}
