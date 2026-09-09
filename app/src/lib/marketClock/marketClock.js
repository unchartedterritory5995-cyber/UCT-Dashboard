// app/src/lib/marketClock/marketClock.js
//
// S11 — Session & Market Clock. product-architecture.md's S11 block names
// this system's exact contract:
//   Responsibility: "Exchange sessions, half-days, holidays, the pre/RTH/
//     post/closed boundary, minutes since the boundary, per-pack as-of —
//     as a versioned dataset, not constants."
//   Outputs: `sessionState(now)`, `nextBoundary`, `isHalfDay`, `asOfLabel`.
//   Dependencies: "None on applications; D1 only if the calendar is
//     vendor-sourced" (it is not — nyseCalendar.js ships as code).
//   Must NOT own: BMO/AMC earnings bucketing (calendarTime.js stays with
//     the calendar app), the week anchor (weekAnchor.js), polling-cadence
//     decisions (S11 is read, it does not decide).
//
// This module is the ONE place that computes "what session is it, and when
// did/will it change" for the Terminal. Every consumer (useMarketOpen.js,
// MarketClock.jsx, ChartMarketClock.jsx, S8's FreshnessBadge session-stale
// wiring) reads THIS, never a second parallel clock computation — the
// existing precedent (MarketClock.jsx and ChartMarketClock.jsx already
// "can never disagree" because both go through one shared hook) is
// preserved and now backed by a real calendar instead of a fixed-hours
// weekday guess.
//
// ⛔ SOURCE STALENESS (D1's FreshnessClass) vs SESSION STALENESS (this
// module's boundary-crossing model, consumed by S8) are computed by
// completely different code paths and must stay that way — see
// `app/src/components/provenance/freshnessContract.js`'s header and
// `app/src/components/provenance/sessionStale.js`.

import { hasCoverage, holidayOn, earlyCloseOn } from './nyseCalendar'

const SUPPORTED_VENUES = Object.freeze(['NYSE'])
const DEFAULT_VENUE = 'NYSE'

// Regular-session minute-of-day boundaries, ET. Only `close` varies (early
// close on a half day) — see `_dayBoundaries`.
const PRE_START_MIN = 4 * 60 // 4:00 AM
const OPEN_MIN = 9 * 60 + 30 // 9:30 AM
const REGULAR_CLOSE_MIN = 16 * 60 // 4:00 PM
const EXT_END_MIN = 20 * 60 // 8:00 PM

// How far to search for boundary events around "today." NYSE's longest real
// gap between trading days is a long holiday weekend (≤4 calendar days) —
// this window is generous on purpose so `nextBoundary`/`sessionState` never
// come up empty near a covered year's edges.
const DAYS_WINDOW = 14

function _assertVenue(venue) {
  if (!SUPPORTED_VENUES.includes(venue)) {
    throw new Error(
      `marketClock: unsupported venue ${JSON.stringify(venue)}. Only `
      + `${SUPPORTED_VENUES.join(', ')} is currently modeled — S11 is deliberately `
      + 'scoped to the current US-equity Terminal surface, not a universal '
      + 'cross-asset calendar (product-architecture.md S11 "Must NOT own").',
    )
  }
}

const _ET_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
})

/** Wall-clock ET parts of a real instant. Uses `Intl`'s own timezone
 *  database — no manual DST arithmetic needed in THIS direction. */
function _etParts(date) {
  const parts = Object.fromEntries(_ET_PARTS_FORMATTER.formatToParts(date).map((p) => [p.type, p.value]))
  let hour = Number(parts.hour)
  if (hour === 24) hour = 0 // some locales report midnight as "24"
  return {
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    minutesSinceMidnight: hour * 60 + Number(parts.minute),
  }
}

const _ET_OFFSET_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', timeZoneName: 'shortOffset',
})

/** UTC offset (minutes, e.g. -300 for EST / -240 for EDT) in effect for
 *  `approxInstant` in America/New_York. Used only to convert an ET
 *  wall-clock time back into a real instant (`_etWallClockToDate`) — the
 *  one direction `Intl` has no built-in for. Safe here because every
 *  boundary this module places is well clear of the 2 AM ET DST-transition
 *  instant (earliest boundary is 4:00 AM ET), so a single-pass offset probe
 *  at the naive guess never straddles the transition. */
function _etOffsetMinutes(approxInstant) {
  const parts = _ET_OFFSET_FORMATTER.formatToParts(approxInstant)
  const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT-5'
  const m = /GMT([+-]\d+)/.exec(tzName)
  const hours = m ? Number(m[1]) : -5
  return hours * 60
}

/** Convert an ET calendar date + minutes-since-midnight into a real Date
 *  instant, DST-aware. */
function _etWallClockToDate(isoDate, minutesSinceMidnight) {
  const hour = Math.floor(minutesSinceMidnight / 60)
  const minute = minutesSinceMidnight % 60
  const hh = String(hour).padStart(2, '0')
  const mm = String(minute).padStart(2, '0')
  const naiveUtcGuess = new Date(`${isoDate}T${hh}:${mm}:00.000Z`)
  const offsetMin = _etOffsetMinutes(naiveUtcGuess)
  return new Date(naiveUtcGuess.getTime() - offsetMin * 60000)
}

function _addDaysIso(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function _weekdayOf(isoDate) {
  // A calendar date's day-of-week is timezone-independent — safe to read via UTC.
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay() // 0=Sun..6=Sat
}

/** Everything about one ET calendar date this module needs: is it a
 *  trading day, is it a half day, and (if so) its four boundary minutes.
 *  Degrades honestly when `isoDate`'s year has no real calendar coverage —
 *  see `nyseCalendar.hasCoverage` — rather than guessing holiday dates. */
function _dayBoundaries(isoDate) {
  const weekday = _weekdayOf(isoDate)
  const coverage = hasCoverage(Number(isoDate.slice(0, 4)))
  if (weekday === 0 || weekday === 6) {
    return {
      tradingDay: false, isHalfDay: false, holidayName: null, coverage,
    }
  }
  const holiday = coverage ? holidayOn(isoDate) : null
  if (holiday) {
    return {
      tradingDay: false, isHalfDay: false, holidayName: holiday.name, coverage,
    }
  }
  const earlyClose = coverage ? earlyCloseOn(isoDate) : null
  return {
    tradingDay: true,
    isHalfDay: !!earlyClose,
    holidayName: null,
    coverage,
    preStart: PRE_START_MIN,
    open: OPEN_MIN,
    close: earlyClose ? earlyClose.closeHour * 60 + earlyClose.closeMinute : REGULAR_CLOSE_MIN,
    extEnd: EXT_END_MIN,
  }
}

function _eventsForDay(isoDate, day) {
  const closeLabel = day.isHalfDay ? 'Early close (1:00 PM ET)' : 'Market close'
  return [
    { minutes: day.preStart, kind: 'preStart', label: 'Pre-market open' },
    { minutes: day.open, kind: 'open', label: day.isHalfDay ? 'Market open (early-close day)' : 'Market open' },
    { minutes: day.close, kind: 'close', label: closeLabel },
    { minutes: day.extEnd, kind: 'extEnd', label: 'After-hours close' },
  ].map((e) => ({ ...e, at: _etWallClockToDate(isoDate, e.minutes) }))
}

// Memoized by center ET calendar date — recomputing a ~28-day event window
// on every 1s tick (FreshnessBadge) would be wasteful; a browser tab only
// ever needs one fresh window per ET calendar day (S11 "must not... create
// duplicate market-clock calculations").
let _eventsCache = null

function _allBoundaryEvents(centerIsoDate) {
  if (_eventsCache && _eventsCache.centerIsoDate === centerIsoDate) return _eventsCache.events
  const events = []
  for (let i = -DAYS_WINDOW; i <= DAYS_WINDOW; i += 1) {
    const isoDate = _addDaysIso(centerIsoDate, i)
    const day = _dayBoundaries(isoDate)
    if (!day.tradingDay) continue
    events.push(..._eventsForDay(isoDate, day))
  }
  events.sort((a, b) => a.at.getTime() - b.at.getTime())
  _eventsCache = { centerIsoDate, events }
  return events
}

/**
 * The current session state — S11's primary output.
 *
 * Returns `{ venue, session, isOpen, isPremarket, isExtended, isHalfDay,
 * holidayName, calendarCoverage, boundaryAt, boundaryLabel,
 * minutesSinceBoundary }`.
 *
 * `session` is exactly one of `'pre' | 'regular' | 'post' | 'closed'` —
 * never ambiguous, never guessed. `boundaryAt`/`minutesSinceBoundary` are
 * "minutes since the [most recent] boundary" per product-architecture.md's
 * own S11 responsibility text — this is what S8's session-stale computation
 * (`components/provenance/sessionStale.js`) reads; S11 itself does not know
 * about "staleness," only about session boundaries.
 */
export function sessionState(now = new Date(), venue = DEFAULT_VENUE) {
  _assertVenue(venue)
  const { isoDate, minutesSinceMidnight } = _etParts(now)
  const today = _dayBoundaries(isoDate)

  let session
  if (!today.tradingDay) {
    session = 'closed'
  } else if (minutesSinceMidnight < today.preStart) {
    session = 'closed'
  } else if (minutesSinceMidnight < today.open) {
    session = 'pre'
  } else if (minutesSinceMidnight < today.close) {
    session = 'regular'
  } else if (minutesSinceMidnight < today.extEnd) {
    session = 'post'
  } else {
    session = 'closed'
  }

  const events = _allBoundaryEvents(isoDate)
  const nowMs = now.getTime()
  let boundaryEvent = null
  for (const ev of events) {
    if (ev.at.getTime() <= nowMs) boundaryEvent = ev
    else break
  }

  return Object.freeze({
    venue,
    session,
    isOpen: session === 'regular',
    isPremarket: session === 'pre',
    isExtended: session === 'post',
    isHalfDay: today.tradingDay ? today.isHalfDay : false,
    holidayName: today.holidayName,
    calendarCoverage: today.coverage,
    boundaryAt: boundaryEvent ? boundaryEvent.at : null,
    boundaryLabel: boundaryEvent ? boundaryEvent.label : null,
    minutesSinceBoundary: boundaryEvent ? Math.round((nowMs - boundaryEvent.at.getTime()) / 60000) : null,
  })
}

/**
 * The next session-transition boundary strictly after `now` — S11's second
 * named output. Returns `{ label, at, kind }` or `null` if the search
 * window is exhausted (should not happen inside `DAYS_WINDOW`).
 */
export function nextBoundary(now = new Date(), venue = DEFAULT_VENUE) {
  _assertVenue(venue)
  const { isoDate } = _etParts(now)
  const events = _allBoundaryEvents(isoDate)
  const nowMs = now.getTime()
  const ev = events.find((e) => e.at.getTime() > nowMs)
  if (!ev) return null
  return Object.freeze({ label: ev.label, at: ev.at, kind: ev.kind })
}

/**
 * Whether `date`'s ET calendar day is an NYSE early-close (half) day — S11's
 * third named output.
 */
export function isHalfDay(date = new Date(), venue = DEFAULT_VENUE) {
  _assertVenue(venue)
  const { isoDate } = _etParts(date)
  return _dayBoundaries(isoDate).isHalfDay
}

/**
 * A formatted "as of" ET time label — S11's fourth named output.
 */
export function asOfLabel(now = new Date(), venue = DEFAULT_VENUE) {
  _assertVenue(venue)
  const time = now.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
  })
  return `${time} ET`
}

export const SUPPORTED_MARKET_CLOCK_VENUES = SUPPORTED_VENUES
