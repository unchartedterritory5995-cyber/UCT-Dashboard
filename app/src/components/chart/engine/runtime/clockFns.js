// app/src/components/chart/engine/runtime/clockFns.js
//
// ─── P3 WS-B: PINE'S CLOCK OVER AN ARBITRARY INSTANT ────────────────────────
//
// `timestamp(…)` and the calendar functions `year(t)`, `month(t)`,
// `dayofmonth(t)`, `dayofweek(t)`, `hour(t)`, `minute(t)`, `second(t)` when `t` is
// NOT the bar's own `time` (`dayofweek(time + offset)`, `year(_time)`), or a zone
// is named. The bar's own clock stays `OP.READ_CLOCK` / the columnar clock
// columns; these answer the question for an instant the RUN computes.
//
// ⭐ UNITS ARE PINE'S: an instant is UNIX MILLISECONDS (the reference: "UNIX
// time is the number of milliseconds that have elapsed since 00:00:00 UTC").
//
// ⭐ THE ZONES ARE THE ONES THE REFERENCE NAMES AND THIS ENGINE CAN ANSWER
// EXACTLY: the exchange's (`syminfo.timezone`, which on this platform is
// America/New_York, the zone every clock column already reads), the IANA name
// "America/New_York" itself, and a FIXED UTC/GMT offset ("UTC", "GMT+0",
// "UTC-5", "GMT+0530", "GMT+5:30"), which is arithmetic on the instant. Any
// other IANA name is refused by the front end by name — answering a Tokyo
// question with New York hours would be wrong by a fixed offset and look right.
//
// ⛔ NO CLOCK READ, NO MODULE STATE BEYOND A BOUNDED CACHE — the VM's purity
// contract (`vm.js:19-22`). `Intl.DateTimeFormat` is a pure function of its input.
//
// ⚠️ NEEDS CAPTURE (named in the P3 WS-B report): what TradingView does with an
// OUT-OF-RANGE component (`timestamp(y, m, 32, …)`, minute 75) and with a New
// York wall time that does not exist (the spring-forward hour) or exists twice
// (the fall-back hour). This normalises out-of-range components the way a
// lenient calendar does (`Date.UTC`'s rule: minute 75 is 01:15 of the next hour)
// and reads a missing wall time at the standard-time offset, an ambiguous one at
// the EARLIER instant.

/** A zone, canonicalised: `'exchange'`, or `'fixed:<minutes east of UTC>'`, or
 *  `null` when this engine does not answer for it. */
export function canonicalZone(text) {
  if (text === null || text === undefined) return 'exchange'
  const s = String(text).trim()
  if (s === '' || s === 'America/New_York' || s === 'US/Eastern') return 'exchange'
  if (s === 'UTC' || s === 'GMT' || s === 'Etc/UTC' || s === 'Etc/GMT' || s === 'Z') return 'fixed:0'
  const m = /^(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/.exec(s)
  if (!m) return null
  const h = Number(m[2])
  const mi = m[3] === undefined ? 0 : Number(m[3])
  if (h > 14 || mi > 59) return null
  return `fixed:${(m[1] === '-' ? -1 : 1) * (h * 60 + mi)}`
}

const NY = typeof Intl !== 'undefined'
  ? new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: 'numeric',
    day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short',
  })
  : null
const WEEKDAY = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })
// ⭐ BOUNDED, keyed by the UTC HOUR: every New York offset change happens on an
// hour boundary, so the hour's parts plus the minutes inside it are the answer.
const NY_BY_HOUR = new Map()
const NY_CAP = 4096

/** New York wall-clock parts of a UNIX-milliseconds instant, or null. */
function nyParts(ms) {
  if (!Number.isFinite(ms) || NY === null) return null
  const hourMs = Math.floor(ms / 3600000) * 3600000
  let p = NY_BY_HOUR.get(hourMs)
  if (p === undefined) {
    if (NY_BY_HOUR.size >= NY_CAP) NY_BY_HOUR.clear()
    const d = new Date(hourMs)
    if (Number.isNaN(d.getTime())) return null
    p = { y: 0, m: 0, d: 0, wd: 0, h: 0 }
    for (const part of NY.formatToParts(d)) {
      if (part.type === 'year') p.y = Number(part.value)
      else if (part.type === 'month') p.m = Number(part.value)
      else if (part.type === 'day') p.d = Number(part.value)
      else if (part.type === 'weekday') p.wd = WEEKDAY[part.value] ?? 0
      else if (part.type === 'hour') p.h = Number(part.value) % 24
    }
    NY_BY_HOUR.set(hourMs, p)
  }
  const inHour = ms - hourMs
  return { y: p.y, m: p.m, d: p.d, wd: p.wd, h: p.h,
    min: Math.floor(inHour / 60000), sec: Math.floor((inHour % 60000) / 1000) }
}

/** UTC parts of an instant shifted by a fixed offset, or null. */
function shiftedParts(ms, offsetMin) {
  if (!Number.isFinite(ms)) return null
  const d = new Date(ms + offsetMin * 60000)
  if (Number.isNaN(d.getTime())) return null
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay(),
    h: d.getUTCHours(), min: d.getUTCMinutes(), sec: d.getUTCSeconds() }
}

const partsIn = (ms, zone) => {
  if (zone === 'exchange') return nyParts(ms)
  if (typeof zone === 'string' && zone.startsWith('fixed:')) return shiftedParts(ms, Number(zone.slice(6)))
  return null
}

/** The wall clock `y-mo-d h:mi:s`, NORMALISED (a lenient calendar: day 32 is the
 *  1st of the next month), read as UTC milliseconds. `Date.UTC` maps years 0–99
 *  onto 1900–1999, so the year is set separately. */
function wallAsUtc(y, mo, d, h, mi, s) {
  const dt = new Date(Date.UTC(2000, 0, 1, 0, 0, 0))
  dt.setUTCFullYear(y, mo - 1, d)
  dt.setUTCHours(h, mi, s, 0)
  return dt.getTime()
}

/** Pine's `timestamp(zone, y, mo, d, h, mi, s)` in UNIX milliseconds, or NaN. */
export function timestampMs(zone, y, mo, d, h, mi, s) {
  const xs = [y, mo, d, h, mi, s]
  if (!xs.every(Number.isFinite)) return NaN
  const [Y, MO, D, H, MI, S] = xs.map((v) => Math.trunc(v))
  const wall = wallAsUtc(Y, MO, D, H, MI, S)
  if (!Number.isFinite(wall)) return NaN
  if (typeof zone === 'string' && zone.startsWith('fixed:')) return wall - Number(zone.slice(6)) * 60000
  if (zone !== 'exchange') return NaN
  // ⭐ New York is UTC-4 or UTC-5 at every instant this engine draws; exactly one
  // candidate reads the wall time back unless it is the fall-back hour (both do:
  // the EARLIER instant, EDT, is taken) or the spring-forward hour (neither does:
  // the standard-time reading is taken). Both are NEEDS CAPTURE.
  const want = new Date(wall)
  for (const off of [4, 5]) {
    const cand = wall + off * 3600000
    const p = nyParts(cand)
    if (p && p.y === want.getUTCFullYear() && p.m === want.getUTCMonth() + 1 && p.d === want.getUTCDate()
      && p.h === want.getUTCHours() && p.min === want.getUTCMinutes()) return cand
  }
  return wall + 5 * 3600000
}

/** The calendar fields Pine's functions answer, from the parts. Pine's
 *  `dayofweek` is 1 = Sunday … 7 = Saturday. */
const FIELD = Object.freeze({
  year: (p) => p.y, month: (p) => p.m, dayofmonth: (p) => p.d, dayofweek: (p) => p.wd + 1,
  hour: (p) => p.h, minute: (p) => p.min, second: (p) => p.sec,
})
export const INSTANT_FIELDS = Object.freeze(Object.keys(FIELD))

/** Pine's `<field>(t, zone)` for a UNIX-milliseconds instant, or NaN. */
export function instantField(field, ms, zone) {
  const f = FIELD[field]
  if (!f) return NaN
  const p = partsIn(ms, zone)
  return p === null ? NaN : f(p)
}

const MONTHS = Object.freeze({ jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 })

/** ⭐⭐ COV-TIME u2 (capmatrix C3, 2026-11-26) — THE ONE READER OF A DATE STRING. Pine's
 *  `timestamp(dateString)`, the bare call's value on the runtime lane AND every `input.time` default
 *  (`runtimeInputs.js::timestampOfDateString` IS this function; there is no second grammar).
 *  The reference (v6): RFC 2822 ("DD MMM YYYY hh:mm:ss ±hhmm") or ISO 8601
 *  ("YYYY-MM-DDThh:mm:ss±hh:mm"); "If the time is not specified, 00:00 is used. If the time zone is
 *  not specified, GMT+0 is used" (this form diverges from the exchange default).
 *
 *  It reads ONLY the shapes a capture holds or the reference states, and nothing else:
 *    · day-first RFC 2822, optional `Www, ` — T16 `"18 May 2022 00:00 +0000"`, C3e
 *      `"20 Jul 2021 00:00 +0300"`, C3c `"01 Jan 2000 00:00:00 GMT+10"`;
 *    · MONTH-first `"Jan 01 2023 00:00:00"` (C3a, C3b `"Feb 01 2020 22:10:05"`): not RFC 2822, but
 *      TradingView reads it, as GMT+0 when no zone is written;
 *    · ISO 8601 `YYYY-MM-DD[Thh:mm[:ss]][Z|±hh:mm|±hhmm]` — C3d `"2023-01-01T12:00:00"` (no zone: GMT+0).
 *  A zone is none / `GMT` / `UTC` / `Z` (GMT+0), `±hhmm` (RFC 2822), or `GMT±h[h][[:]mm]` /
 *  `UTC±h[h][[:]mm]`, an offset EAST of UTC: C3c reads `GMT+10` as 14:00 UTC the day before
 *  (`Etc/GMT+10`'s opposite sign is NOT what TradingView does).
 *  Captures: `vw-cap-c3-timestamp-{a..e}-spy-{1d,15}-2026-11-26` (FRED capmatrix runA): the input
 *  and the bare call read the SAME instant on every bar, on both timeframes.
 *  Returns UNIX milliseconds, or null when the text is not one of those shapes. */
// The time and zone tails are ONE source for both RFC-shaped forms (`.source`, never retyped).
const DATE_TIME = /(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.source
const DATE_ZONE = /(?:\s+(GMT|UTC|Z|[+-]\d{4}|(?:GMT|UTC)[+-]\d{1,2}(?::?\d{2})?))?/.source
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/
const DAY_FIRST_DATE = new RegExp(/^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/.source + DATE_TIME + DATE_ZONE + '$')
const MONTH_FIRST_DATE = new RegExp(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/.source + DATE_TIME + DATE_ZONE + '$')

/** A date string's zone as minutes EAST of UTC, or null when it is not one of the read spellings. */
function dateZoneMinutes(tz) {
  if (tz === undefined || tz === 'Z' || tz === 'GMT' || tz === 'UTC') return 0
  const t = /^(?:(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?|([+-])(\d{2}):?(\d{2}))$/.exec(tz)
  if (!t) return null
  const sign = t[1] || t[4]
  const h = Number(t[2] !== undefined ? t[2] : t[5])
  const mi = Number((t[2] !== undefined ? t[3] : t[6]) || 0)
  if (h > 14 || mi > 59) return null
  return (sign === '-' ? -1 : 1) * (h * 60 + mi)
}

export function dateStringMs(text) {
  const s = String(text).trim()
  let y, mo, d, h = 0, mi = 0, sec = 0, tz
  let m = ISO_DATE.exec(s)
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (m[4] !== undefined) { h = Number(m[4]); mi = Number(m[5]); sec = m[6] === undefined ? 0 : Number(m[6]) }
    tz = m[7]
  } else {
    let mon
    m = DAY_FIRST_DATE.exec(s)
    if (m) {
      mon = MONTHS[m[2].toLowerCase()]
      ;[d, y] = [Number(m[1]), Number(m[3])]
    } else {
      m = MONTH_FIRST_DATE.exec(s)
      if (!m) return null
      mon = MONTHS[m[1].toLowerCase()]
      ;[d, y] = [Number(m[2]), Number(m[3])]
    }
    if (!mon) return null
    mo = mon
    if (m[4] !== undefined) { h = Number(m[4]); mi = Number(m[5]); sec = m[6] === undefined ? 0 : Number(m[6]) }
    tz = m[7]
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return null
  const offset = dateZoneMinutes(tz)
  if (offset === null) return null
  const wall = wallAsUtc(y, mo, d, h, mi, sec)
  const back = new Date(wall)
  // ⛔ A DATE THAT DOES NOT EXIST ("2021-02-30") is not normalised here: the
  // reference gives this form a fixed text, and reading it leniently would answer
  // for a different day than the one written.
  if (back.getUTCMonth() + 1 !== mo || back.getUTCDate() !== d) return null
  return wall - offset * 60000
}
