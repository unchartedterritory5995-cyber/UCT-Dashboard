// The ET wall clock of an instant, as a Date whose LOCAL getters (getFullYear / getMonth / getDate / getDay / getHours /
// getMinutes / getSeconds) read the America/New_York wall time: marketSession.js's established idiom, re-parsing a
// `toLocaleString('en-US', { timeZone: 'America/New_York' })` string. ONE place for it, so its cost and its
// correctness are decided once.
//
// ⭐ (2026-11-23, next-row key task helpers, item 1) NO FORMATTER PER CALL. `toLocaleString` with a timeZone builds a
// date formatter on every call, and a next-row press reached it hundreds of times (the bar store derives each key's
// status on every change, and each derivation asks for the last closed session and the ET date of a bar: ~3 ms a
// press, profiled). Now:
//   · ONE module-level Intl.DateTimeFormat answers the wall clock of an instant (`formatToParts`);
//   · the ET offset (wall minus instant) is asked of it ONCE per UTC hour and kept, when both ends of that hour agree
//     (America/New_York changes at 02:00 local, which is on a UTC hour; an hour whose ends disagree is never kept and
//     is answered per call), so most calls are arithmetic. Nothing about DST is written here: the offset is the
//     formatter's own answer;
//   · the Date is built from the wall-clock fields with the LOCAL constructor, which resolves a wall time that falls
//     in the local zone's own DST gap or overlap the way the re-parse of the string did (etWall.test.js W1, five
//     process time zones).

const _fmt = typeof Intl !== 'undefined'
  ? new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  })
  : null

const HOUR = 3_600_000
const OFFSET_CACHE_MAX = 10_000
/** UTC hour -> ET wall minus instant (ms), or null for an hour whose two ends disagree (a change inside it). */
const _offsetByHour = new Map()

/** The ET wall clock of whole-second instant `sec0` (ms), as the UTC epoch ms of those wall fields. */
function _wallAsUtc(sec0) {
  let y = 0, mo = 1, d = 1, h = 0, mi = 0, s = 0
  for (const p of _fmt.formatToParts(new Date(sec0))) {
    switch (p.type) {
      case 'year': y = Number(p.value); break
      case 'month': mo = Number(p.value); break
      case 'day': d = Number(p.value); break
      case 'hour': h = Number(p.value); break
      case 'minute': mi = Number(p.value); break
      case 'second': s = Number(p.value); break
      default: break
    }
  }
  const u = new Date(0)
  u.setUTCFullYear(y, mo - 1, d)            // (setUTCFullYear: a year below 100 is that year, not 19xx)
  u.setUTCHours(h, mi, s, 0)
  return u.getTime()
}

/** ET wall minus instant (ms) at whole-second instant `sec0`. */
function _offsetAt(sec0) {
  const key = Math.floor(sec0 / HOUR)
  let off = _offsetByHour.get(key)
  if (off === undefined) {
    const a = key * HOUR
    const b = a + HOUR - 1000
    const oa = _wallAsUtc(a) - a
    const ob = _wallAsUtc(b) - b
    off = oa === ob ? oa : null
    if (_offsetByHour.size >= OFFSET_CACHE_MAX) _offsetByHour.clear()
    _offsetByHour.set(key, off)
  }
  return off === null ? _wallAsUtc(sec0) - sec0 : off
}

/** `new Date(new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York' }))`, without the formatter per call. */
export function etWallDate(ms) {
  const t = new Date(ms).getTime()
  if (!Number.isFinite(t) || !_fmt) return new Date(new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const sec0 = Math.floor(t / 1000) * 1000          // the re-parse kept whole seconds
  const w = new Date(sec0 + _offsetAt(sec0))         // its UTC fields ARE the ET wall clock
  return new Date(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), w.getUTCHours(), w.getUTCMinutes(), w.getUTCSeconds())
}
