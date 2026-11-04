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

/** Pine's `timestamp(dateString)`: RFC 2822 (`"20 Feb 2020 15:30:00 +0200"`) or
 *  ISO 8601 (`"2020-02-20T15:30:00+02:00"`); no time is 00:00, no zone is GMT+0
 *  (the reference, which says this form diverges from the exchange default).
 *  Returns UNIX milliseconds, or null when the text is not one of those shapes. */
export function dateStringMs(text) {
  const s = String(text).trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s)
  let y, mo, d, h = 0, mi = 0, sec = 0, tz
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (m[4] !== undefined) { h = Number(m[4]); mi = Number(m[5]); sec = m[6] === undefined ? 0 : Number(m[6]) }
    tz = m[7]
  } else {
    m = /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\s+(GMT|UTC|Z|[+-]\d{4}))?$/.exec(s)
    if (!m) return null
    const mon = MONTHS[m[2].toLowerCase()]
    if (!mon) return null
    ;[d, mo, y] = [Number(m[1]), mon, Number(m[3])]
    if (m[4] !== undefined) { h = Number(m[4]); mi = Number(m[5]); sec = m[6] === undefined ? 0 : Number(m[6]) }
    tz = m[7]
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return null
  let offset = 0
  if (tz && tz !== 'Z' && tz !== 'GMT' && tz !== 'UTC') {
    const t = /^([+-])(\d{2}):?(\d{2})$/.exec(tz)
    if (!t) return null
    offset = (t[1] === '-' ? -1 : 1) * (Number(t[2]) * 60 + Number(t[3]))
  }
  const wall = wallAsUtc(y, mo, d, h, mi, sec)
  const back = new Date(wall)
  // ⛔ A DATE THAT DOES NOT EXIST ("2021-02-30") is not normalised here: the
  // reference gives this form a fixed text, and reading it leniently would answer
  // for a different day than the one written.
  if (back.getUTCMonth() + 1 !== mo || back.getUTCDate() !== d) return null
  return wall - offset * 60000
}
