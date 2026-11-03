// ── UCT Agent: a member's DATE WORDS → an ET calendar day (Wave 1 W1-B, 2026-11-02) ─────────────
//
// One resolver for the operator capabilities that take a date ("a trendline from Oct 15 to last
// Friday", "NVDA close last Friday", "TSLA range last week"). It is PURE given `now` (tests pass a
// fixed clock); production passes Date.now(). It resolves only the OBVIOUS words — anything else is
// null, never a guess — and it never decides a trading session: the bars adapter (`to`) and the
// drawing layer (`drawingTimeFor`) do that from the day it hands back.
//
//   resolveDateWord('2026-10-15')            → { to: '2026-10-15' }
//   resolveDateWord('last friday', now)      → { to: <the most recent Friday strictly before today> }
//   resolveDateWord('friday', now)           → { to: <the most recent Friday on or before today> }
//   resolveDateWord('yesterday' | 'today')   → { to }
//   resolveDateWord('last week', now)        → { to: <last Friday>, sessions: 5 }       a window
//   resolveDateWord('this week', now)        → { to: today, sessions: <weekdays so far> }
//   resolveDateWord('last month', now)       → { to: <last day of the month>, month: 'YYYY-MM' }
//   resolveDateWord('oct 15' | '10/15' | 'october 15, 2026') → { to }   (a missing year = this year)
//   a day AFTER today → { to, future: true }  (callers refuse it — never guessed into the past)
//
// Days are ET calendar days: "today" is the trading calendar's today, whatever the browser's zone.

const DAY = 86400000
const ET = 'America/New_York'
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const WEEKDAYS = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 }
const MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 }

/** Today's ET calendar date, 'YYYY-MM-DD'. */
export function etToday(now = Date.now()) {
  return new Date(now).toLocaleDateString('en-CA', { timeZone: ET })
}
/** 'YYYY-MM-DD' → UTC-midnight ms, or null for anything that is not a real calendar date. */
export function isoDayMs(s) {
  const m = ISO.exec(String(s || '').trim())
  if (!m) return null
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3])
  const d = new Date(ms)
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? ms : null
}
export const fmtDay = (ms) => new Date(ms).toISOString().slice(0, 10)
const dow = (ms) => new Date(ms).getUTCDay()
const lastDayOfMonth = (y, m) => fmtDay(Date.UTC(y, m, 0))    // m is 1-based: day 0 of the next month

/** The most recent `weekday` (0–6) on or before `ms`; `strict` = strictly before. */
function backToWeekday(ms, weekday, strict) {
  let d = strict ? ms - DAY : ms
  while (dow(d) !== weekday) d -= DAY
  return d
}
/** Monday of the week `ms` falls in (Sunday counts as the END of the previous week, as traders read it). */
function mondayOf(ms) {
  const w = dow(ms)
  return ms - ((w === 0 ? 6 : w - 1) * DAY)
}

const clean = (raw) => String(raw || '').trim().toLowerCase().replace(/[.,!?]+$/, '').replace(/\s+/g, ' ')
  .replace(/^(?:on|for|as of|at|from|since|the|this past|the past)\s+/, '').replace(/^(?:the )?close (?:of|on) /, '').replace(/'s$/, '')

/**
 * @returns {{ to: string, sessions?: number, month?: string, future?: boolean, word: string } | null}
 */
export function resolveDateWord(raw, now = Date.now()) {
  const word = clean(raw)
  if (!word) return null
  const today = isoDayMs(etToday(now))
  const done = (ms, extra = {}) => ({ to: fmtDay(ms), ...(ms > today ? { future: true } : {}), word, ...extra })

  if (ISO.test(word)) { const ms = isoDayMs(word); return ms == null ? null : done(ms) }
  if (word === 'today') return done(today)
  if (word === 'yesterday') return done(today - DAY)
  let m = /^(\d{1,3}) (day|days|session|sessions) ago$/.exec(word)
  if (m) return done(today - Number(m[1]) * DAY)
  m = /^(a|one|1|two|2|three|3) weeks? ago$/.exec(word)
  if (m) return done(today - ({ a: 1, one: 1, 1: 1, two: 2, 2: 2, three: 3, 3: 3 })[m[1]] * 7 * DAY)

  // weekdays: "last friday" = strictly before today; "friday" / "this friday" = on or before today
  m = /^(last |this |past )?([a-z]+)$/.exec(word)
  if (m && WEEKDAYS[m[2]] != null) {
    const strict = m[1] === 'last ' || m[1] === 'past '
    return done(backToWeekday(today, WEEKDAYS[m[2]], strict))
  }
  // windows: a week (5 sessions ending on its Friday), a month (its calendar days)
  if (/^(last|previous|prior) week$/.test(word)) return done(mondayOf(today) - 3 * DAY, { sessions: 5 })
  if (/^(this|current) week$/.test(word)) { const w = dow(today); return done(today, { sessions: w === 0 || w === 6 ? 5 : Math.max(1, w) }) }
  if (/^(last|previous|prior) month$/.test(word)) {
    const d = new Date(today)
    const y = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear()
    const mo = d.getUTCMonth() === 0 ? 12 : d.getUTCMonth()
    const to = lastDayOfMonth(y, mo)
    return done(isoDayMs(to), { month: to.slice(0, 7) })
  }
  if (/^(this|current) month$/.test(word)) return done(today, { month: fmtDay(today).slice(0, 7) })

  // named dates: "oct 15", "october 15th 2026", "15 oct", "10/15", "10/15/2026"
  const y0 = new Date(today).getUTCFullYear()
  m = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?$/.exec(word) || /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?(?:,? (\d{4}))?$/.exec(word)
  if (m) {
    const [a, b] = MONTHS[m[1]] != null ? [m[1], m[2]] : [m[2], m[1]]
    const mo = MONTHS[a]
    if (mo != null) {
      const ms = isoDayMs(`${m[3] || y0}-${String(mo).padStart(2, '0')}-${String(b).padStart(2, '0')}`)
      return ms == null ? null : done(ms)
    }
  }
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(word)
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : y0
    const ms = isoDayMs(`${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`)
    return ms == null ? null : done(ms)
  }
  return null
}

/** "Fri, Oct 30" for a day; the year when it is not this year. */
export function dayWord(iso, now = Date.now()) {
  const ms = isoDayMs(iso)
  if (ms == null) return String(iso)
  const sameYear = iso.slice(0, 4) === etToday(now).slice(0, 4)
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(new Date(ms))
}
