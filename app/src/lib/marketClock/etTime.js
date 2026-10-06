// app/src/lib/marketClock/etTime.js
//
// Small, DST-correct America/New_York helpers for the research panels.
//
// ⛔ Several providers (FMP news `publishedDate`, earnings dates) send an ET
// WALL-CLOCK string with no zone ("2026-08-09 18:00:00"). `Date.parse` reads
// that as BROWSER-LOCAL time, so a member outside ET sees every timestamp
// shifted by their offset — a Pacific member saw fresh news as "in the future"
// (clamped to "just now"), a European one saw it hours older than it was.
// These helpers resolve the wall clock against the real ET offset FOR THAT
// DATE (EDT or EST), via Intl, never a hard-coded -4/-5.
//
// The same trap on the calendar side: "N days ago" computed from UTC midnights
// or raw millisecond deltas is off by one for most of the evening in ET.
// Calendar-day differences here are taken between ET calendar dates.

export const ET_ZONE = 'America/New_York'

const _PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: ET_ZONE,
  hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
})

function _etParts(ms) {
  const out = {}
  for (const p of _PARTS.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  }
  if (out.hour === 24) out.hour = 0
  return out
}

/** ET's offset from UTC at instant `ms`, in milliseconds (e.g. -4h in EDT). */
export function etOffsetMs(ms) {
  const p = _etParts(ms)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

/** An ET wall-clock date/time -> epoch ms. Two-pass so the offset used is the
 *  one in force at the RESULT instant, which is what makes it DST-correct. */
export function etWallToEpochMs(year, month, day, hour = 0, minute = 0, second = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second)
  const first = guess - etOffsetMs(guess)
  const second2 = guess - etOffsetMs(first)
  return second2
}

const _WALL = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/
const _HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i

/**
 * Parse a provider timestamp. A string carrying its own zone (`Z`, `+00:00`)
 * is honoured as-is; a zone-less "YYYY-MM-DD[ HH:MM[:SS]]" is read as ET wall
 * clock. Returns epoch ms, or NaN when it is not a timestamp at all.
 */
export function parseEtTimestamp(value) {
  if (value == null) return NaN
  const s = String(value).trim()
  if (!s) return NaN
  if (_HAS_ZONE.test(s)) return Date.parse(s.replace(' ', 'T'))
  const m = _WALL.exec(s)
  if (!m) return NaN
  const [, y, mo, d, h = '0', mi = '0', se = '0'] = m
  const ms = etWallToEpochMs(+y, +mo, +d, +h, +mi, +se)
  // Reject impossible dates (2026-02-31) rather than letting Date roll them.
  const back = _etParts(ms)
  if (back.year !== +y || back.month !== +mo || back.day !== +d) return NaN
  return ms
}

/** The ET calendar date of an instant, "YYYY-MM-DD". */
export function etYmd(ms) {
  const p = _etParts(ms)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

function _ymdToDayNumber(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''))
  if (!m) return NaN
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000)
}

/**
 * Whole ET calendar days from `from` to `to` (positive when `to` is later).
 * Each side is an epoch-ms instant or a bare "YYYY-MM-DD" calendar date (taken
 * as already being an ET date — a date has no time zone to convert).
 */
export function etCalendarDaysBetween(from, to) {
  const day = (v) => (typeof v === 'number' ? _ymdToDayNumber(etYmd(v)) : _ymdToDayNumber(v))
  const a = day(from)
  const b = day(to)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN
  return b - a
}
