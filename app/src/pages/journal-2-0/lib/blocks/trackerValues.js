// Tracker values on the client (Notebook widgets phase 2, wave 9, Task 9.14): how a value reads, how a typed value
// is turned into what is sent, and the block's summary after a log. Pure functions: no network, no state.
//
// ⛔ The server (api/services/journal_two/tracker_days.py) is the authority on what may be STORED: this module never
// range-checks. A typed value is sent as typed and a refusal carries the server's own sentence. What this module
// does refuse to do is turn text into a number it does not spell (JSON has no NaN: `Number('abc')` would be sent as
// `null`, which CLEARS the day), so text that is not plainly a number is sent as the text, and the server says why.
// ⛔ A missing value is "no value", never a 0 (`null` in, `null` out, everywhere below).

/** The server's RECENT_MAX: the summary and the chart cover the newest 30 entries. */
export const RECENT_MAX = 30

const DECIMAL_RE = /^[-+]?(\d+(\.\d*)?|\.\d+)$/
const HMM_RE = /^(\d{1,2}):([0-5]\d)$/

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/** Fixed notation, at most 2 decimals, never an exponent (tracker_days._num_text): 6.5 -> "6.5", 1e9 -> "1000000000". */
export function numText(v) {
  const text = (Math.round(v * 100) / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return text === '-0' || text === '' ? '0' : text
}

/** 450 -> "7h 30m", 480 -> "8h", 45 -> "45m" (tracker_days._duration_text). */
export function durationText(minutes) {
  const total = Math.round(minutes)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

/** A value as the member reads it (tracker_days.format_value, except that a scale AVERAGE keeps its decimals).
 *  `null` for no value: the caller shows nothing, never a 0. */
export function valueText(kind, v, unit) {
  if (!finite(v)) return null
  if (kind === 'yesno') return v >= 0.5 ? 'Yes' : 'No'
  if (kind === 'duration') return durationText(v)
  if (kind === 'scale') return numText(v)
  return unit ? `${numText(v)} ${unit}` : numText(v)
}

/** `7:30` -> 450 minutes. Anything else -> null. */
export function parseHmm(text) {
  const m = HMM_RE.exec(String(text ?? '').trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** What a typed number or duration sends: `{ clear: true }` for an empty box, `{ value }` otherwise. A number is
 *  sent as a number only when the text spells one in plain decimals; anything else is sent as the text itself, so
 *  the server refuses it with its own sentence (and a stray exponent can never overflow into a clear). */
export function typedValue(kind, text) {
  const t = String(text ?? '').trim()
  if (!t) return { clear: true }
  if (kind === 'duration') {
    const mins = parseHmm(t)
    return { value: mins == null ? t : mins }
  }
  if (DECIMAL_RE.test(t)) {
    const n = Number(t)
    if (Number.isFinite(n)) return { value: n }
  }
  return { value: t }
}

/** The box's text for a stored value: the number as typed back, a duration as h:mm. */
export function inputText(kind, v) {
  if (!finite(v)) return ''
  if (kind === 'duration') {
    const total = Math.round(v)
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
  }
  return numText(v)
}

/** The recent entries after one day's value changed (a log here, in another block, or in another tab): that day's
 *  entry replaced, added or removed (a clear), oldest first, the newest RECENT_MAX kept. */
export function mergeRecent(recent, day, value) {
  const list = (Array.isArray(recent) ? recent : []).filter((r) => r && typeof r.day === 'string' && r.day !== day)
  if (value !== null && value !== undefined) list.push({ day, value: finite(value) ? value : null })
  list.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  return list.slice(-RECENT_MAX)
}

/** The server's summary rule over the recent entries (trackers._summary): the average of the readable values (an
 *  entry with no readable value is not averaged, never read as 0), the newest entry when it has a value, and the
 *  count, never 0. */
export function summaryOf(recent) {
  const list = Array.isArray(recent) ? recent : []
  const nums = list.map((r) => r.value).filter(finite)
  const last = list[list.length - 1]
  return {
    average: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null,
    latest: last && finite(last.value) ? { day: last.day, value: last.value } : null,
    n: list.length || null,
  }
}

/** "from 12 entries" (never "from 0 entries": no count is no line). */
export function entriesText(n) {
  if (!Number.isInteger(n) || n < 1) return ''
  return n === 1 ? 'from 1 entry' : `from ${n} entries`
}
