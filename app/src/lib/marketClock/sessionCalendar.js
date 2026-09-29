// app/src/lib/marketClock/sessionCalendar.js
//
// TERM-035 — the market clock as code: ONE session authority, with a horizon.
//
// The dataset is `./market_calendar.json`. `api/services/session_calendar.py`
// reads THE SAME BYTES, so the browser and the server cannot hold two lists of
// holidays or half-days. `tests/fixtures/market_calendar_cases.json` is answered
// by both sides (sessionCalendar.test.js + tests/test_session_calendar.py).
//
// API — three functions plus the horizon:
//   sessionAt(ts)       -> 'pre' | 'rth' | 'post' | 'closed'
//   isTradingDay(day)   -> boolean            (a half-day IS a trading day)
//   closeTime(day)      -> Date | null        (13:00 ET on a half-day)
//   horizon()           -> 'YYYY-MM-DD'       (last date the dataset covers)
// `day` is an ET calendar date 'YYYY-MM-DD', or a Date (read as its ET date).
//
// Boundaries, ET, DST-aware via Intl: pre 04:00, RTH 09:30–16:00 (13:00 on a
// half-day), post to 20:00 on every trading day including half-days — the
// convention marketClock.js (EXT_END_MIN) already ships.
//
// Outside [coverage_start, horizon] the answer degrades to weekday + hours (the
// "no throw, no guess" convention marketClock.js pins); `covers(day)` says
// whether an answer was calendar-backed. The horizon rail lives in
// tests/test_session_calendar.py.
//
// READ IN PRODUCTION since TERM-035 follow-up #1: nyseCalendar.js builds its
// per-year holiday / early-close tables and COVERED_YEARS from HOLIDAY_ROWS,
// EARLY_CLOSE_ROWS, COVERAGE_START and horizon() below, so marketClock.js and
// every reader behind it (useMarketOpen, sessionModel, sessionStale,
// FreshnessBadge, freshnessAge, extSession, marketSession) answer from this
// dataset. sessionCalendar.test.js still holds marketClock.sessionState equal
// to this module on every shared-fixture row both cover.

import RAW from './market_calendar.json'
import { expandCalendar } from './calendarCompact.js'

// The production bundle carries the file with its row names interned
// (`calendarCompact.js`, applied by the vite build); this rebuilds the exact rows.
// The file itself, which dev and every test read, passes through unchanged.
const DATA = expandCalendar(RAW)

function _hm(s) {
  const [hh, mm] = s.split(':').map(Number)
  return hh * 60 + mm
}

const PRE_START_MIN = _hm(DATA.sessions.pre_start)
const OPEN_MIN = _hm(DATA.sessions.open)
const CLOSE_MIN = _hm(DATA.sessions.close)
const POST_END_MIN = _hm(DATA.sessions.post_end)

const HOLIDAYS = new Map(DATA.holidays.map((h) => [h.date, h.name]))
const EARLY_CLOSES = new Map(DATA.early_closes.map((e) => [e.date, _hm(e.close)]))

export const CALENDAR_VERSION = DATA.version
export const COVERAGE_START = DATA.coverage_start

/** Every full closure in the dataset, `{ date, name }`, frozen. */
export const HOLIDAY_ROWS = Object.freeze(
  DATA.holidays.map((h) => Object.freeze({ date: h.date, name: h.name })),
)

/** Every early close in the dataset, `{ date, name, close }` ('HH:MM' ET), frozen. */
export const EARLY_CLOSE_ROWS = Object.freeze(
  DATA.early_closes.map((e) => Object.freeze({ date: e.date, name: e.name, close: e.close })),
)

const _ET_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
})

function _toDate(ts) {
  const d = ts instanceof Date ? ts : new Date(ts)
  if (Number.isNaN(d.getTime())) throw new TypeError(`sessionCalendar: not an instant: ${String(ts)}`)
  return d
}

/** ET wall-clock parts of an instant: { isoDate, minutes, epochAsUtcWall }. */
function _etParts(instant) {
  const p = Object.fromEntries(_ET_PARTS.formatToParts(instant).map((x) => [x.type, x.value]))
  const hour = Number(p.hour) % 24
  return {
    isoDate: `${p.year}-${p.month}-${p.day}`,
    minutes: hour * 60 + Number(p.minute),
    // The ET wall clock read as if it were UTC — used to measure the offset.
    wallAsUtcMs: Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second)),
  }
}

function _dayKey(day) {
  if (typeof day === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new TypeError(`sessionCalendar: expected YYYY-MM-DD, got ${day}`)
    return day
  }
  return _etParts(_toDate(day)).isoDate
}

function _weekday(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay() // 0=Sun..6=Sat, zone-free
}

/** The last date the dataset covers, 'YYYY-MM-DD'. */
export function horizon() {
  return DATA.horizon
}

/** Whether `day`'s answer is backed by the published calendar. */
export function covers(day) {
  const k = _dayKey(day)
  return k >= DATA.coverage_start && k <= DATA.horizon
}

export function isTradingDay(day) {
  const k = _dayKey(day)
  const wd = _weekday(k)
  return wd !== 0 && wd !== 6 && !HOLIDAYS.has(k)
}

export function isHalfDay(day) {
  return EARLY_CLOSES.has(_dayKey(day))
}

export function holidayName(day) {
  return HOLIDAYS.get(_dayKey(day)) ?? null
}

function _closeMin(isoDate) {
  return EARLY_CLOSES.get(isoDate) ?? CLOSE_MIN
}

/** An ET wall-clock time on `isoDate` as a real instant, DST-aware. Two passes
 *  of "guess, measure the offset at the guess, correct" converge for any time
 *  not inside the 02:00 transition hour, and every boundary here is ≥ 04:00. */
function _etWallToInstant(isoDate, minutes) {
  const [y, m, d] = isoDate.split('-').map(Number)
  const wall = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60)
  let guess = wall
  for (let i = 0; i < 2; i += 1) {
    const offset = _etParts(new Date(guess)).wallAsUtcMs - guess
    guess = wall - offset
  }
  return new Date(guess)
}

/** The regular-session close of `day` (13:00 ET on a half-day), or null. */
export function closeTime(day) {
  const k = _dayKey(day)
  if (!isTradingDay(k)) return null
  return _etWallToInstant(k, _closeMin(k))
}

/** 'pre' | 'rth' | 'post' | 'closed' at instant `ts` (Date, epoch ms or ISO string). */
export function sessionAt(ts) {
  const { isoDate, minutes } = _etParts(_toDate(ts))
  if (!isTradingDay(isoDate)) return 'closed'
  if (minutes < PRE_START_MIN) return 'closed'
  if (minutes < OPEN_MIN) return 'pre'
  if (minutes < _closeMin(isoDate)) return 'rth'
  if (minutes < POST_END_MIN) return 'post'
  return 'closed'
}
