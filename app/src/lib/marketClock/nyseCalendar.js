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
// continue") — the data reflects NYSE's real published calendar, not the
// matrix row's paraphrase of it.
//
// ⭐ TERM-035 follow-up #1 (2026-09-28): THIS FILE NO LONGER TYPES A DATE.
// `COVERED_YEARS`, every per-year holiday / early-close table and the three
// lookups below are DERIVED from `./market_calendar.json`, read through
// `./sessionCalendar.js` (HOLIDAY_ROWS, EARLY_CLOSE_ROWS, COVERAGE_START,
// horizon()). `api/services/session_calendar.py` reads the same bytes and
// `api/services/nyse_calendar.py` derives the backend's `YYYYMMDD` sets from
// it, so the browser and the server cannot hold two different calendars.
// Refresh the JSON (holidays AND early closes, `horizon`, `version`), never
// this file. The exported names and shapes are unchanged, so marketClock.js,
// extSession.js, marketSession.js and every reader behind them are untouched.
//
// Coverage is every WHOLE calendar year inside [coverage_start, horizon]
// (2025-2028 when this was written). A date outside `COVERED_YEARS` still
// degrades gracefully (see marketClock.js's `calendarCoverage` flag) rather
// than guessing a future year's holiday dates -- "no throw, no guess" -- and
// the horizon rail in tests/test_session_calendar.py goes red 12 months before
// that degrade can become the normal case.
//
// `tests/test_nyse_calendar_parity.py` rails that this file stays derived (no
// date literal, reads sessionCalendar.js) and that the backend sets equal the
// same JSON; `sessionCalendar.test.js` holds these tables equal to the dataset.

import {
  COVERAGE_START,
  EARLY_CLOSE_ROWS,
  HOLIDAY_ROWS,
  horizon,
} from './sessionCalendar.js'

function _yearOf(isoDate) {
  return Number(isoDate.slice(0, 4))
}

function _closeParts(hhmm) {
  const [hh, mm] = hhmm.split(':').map(Number)
  return { closeHour: hh, closeMinute: mm }
}

// Only WHOLE years are covered: `hasCoverage` answers per year, so a partially
// covered year would claim holidays it cannot see. A dataset that starts on
// Jan 1 and ends on Dec 31 (the Python rail pins the horizon to a Dec 31)
// covers its full span.
const _HORIZON = horizon()
const _FIRST_YEAR = _yearOf(COVERAGE_START) + (COVERAGE_START.endsWith('-01-01') ? 0 : 1)
const _LAST_YEAR = _yearOf(_HORIZON) - (_HORIZON.endsWith('-12-31') ? 0 : 1)

export const COVERED_YEARS = Object.freeze(
  Array.from({ length: Math.max(0, _LAST_YEAR - _FIRST_YEAR + 1) }, (_, i) => _FIRST_YEAR + i),
)

function _tableFor(year) {
  const inYear = (r) => _yearOf(r.date) === year
  return Object.freeze({
    /** Full-day NYSE closures: `{date, name}`, ISO ET calendar dates. */
    holidays: Object.freeze(
      HOLIDAY_ROWS.filter(inYear).map((h) => Object.freeze({ date: h.date, name: h.name })),
    ),
    /** Early-close trading days: `{date, name, closeHour, closeMinute}` (ET). */
    earlyCloses: Object.freeze(
      EARLY_CLOSE_ROWS.filter(inYear).map((e) =>
        Object.freeze({ date: e.date, name: e.name, ..._closeParts(e.close) })),
    ),
  })
}

const _BY_YEAR = Object.freeze(
  Object.fromEntries(COVERED_YEARS.map((y) => [y, _tableFor(y)])),
)

/** Every covered year's `{holidays, earlyCloses}` table, keyed by year. */
export const NYSE_CALENDAR_BY_YEAR = _BY_YEAR

// The per-year named exports that predate the dataset, kept so no importer
// has to change. They are views into `_BY_YEAR`, not literals; a year that
// ever fell outside coverage would read as empty rather than throw.
const _EMPTY = Object.freeze([])
export const NYSE_HOLIDAYS_2026 = _BY_YEAR[2026]?.holidays ?? _EMPTY
export const NYSE_EARLY_CLOSES_2026 = _BY_YEAR[2026]?.earlyCloses ?? _EMPTY
export const NYSE_HOLIDAYS_2027 = _BY_YEAR[2027]?.holidays ?? _EMPTY
export const NYSE_EARLY_CLOSES_2027 = _BY_YEAR[2027]?.earlyCloses ?? _EMPTY

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
