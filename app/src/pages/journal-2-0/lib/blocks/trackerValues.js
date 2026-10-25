// Tracker values on the client (Notebook widgets phase 2, wave 9, Task 9.14): how a value reads, how a typed value
// is turned into what is sent. Pure functions: no network, no state. The summary (average, latest, count) is the
// SERVER's (W9-R40): nothing here recomputes it.
//
// ⛔ The server (api/services/journal_two/tracker_days.py) is the authority on what may be STORED: this module never
// range-checks. A typed number is sent as typed and a refusal carries the server's own sentence; a duration that is
// neither h:mm nor whole minutes is refused here, with no request (W9-R41). What this module
// does refuse to do is turn text into a number it does not spell (JSON has no NaN: `Number('abc')` would be sent as
// `null`, which CLEARS the day), so text that is not plainly a number is sent as the text, and the server says why.
// ⛔ A missing value is "no value", never a 0 (`null` in, `null` out, everywhere below).

/** The server's RECENT_MAX: the summary and the chart cover the newest 30 entries (the server bounds the list). */
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

/** Ruling W9-R41: what a duration box says for anything that is not a time it can read (never "Enter a number."). */
export const DURATION_HINT = 'Enter a time like 1:30.'
const MINUTES_RE = /^\d+$/
// M-8: a comma decimal ("2,5"). A single comma followed by EXACTLY three digits ("1,000") reads as a thousands
// separator in English, so it is not guessed at: it is sent as typed and the server says "Enter a number."
const COMMA_DECIMAL_RE = /^[-+]?\d+,(\d{1,2}|\d{4,})$/

/** What a typed number or duration sends: `{ clear: true }` for an empty box, `{ value }` to send, or (a duration
 *  only) `{ refused: DURATION_HINT }`, sent nowhere.
 *  · A duration is `h:mm` or whole minutes (`90`); anything else is refused here, with no request (W9-R41).
 *  · A number is sent as a number only when the text spells one in plain decimals (a comma decimal counts); anything
 *    else is sent as the text itself, so the server refuses it with its own sentence (and a stray exponent can never
 *    overflow into a clear). */
export function typedValue(kind, text) {
  const t = String(text ?? '').trim()
  if (!t) return { clear: true }
  if (kind === 'duration') {
    const mins = MINUTES_RE.test(t) ? Number(t) : parseHmm(t)
    return mins == null || !Number.isFinite(mins) ? { refused: DURATION_HINT } : { value: mins }
  }
  const dotted = COMMA_DECIMAL_RE.test(t) ? t.replace(',', '.') : t
  if (DECIMAL_RE.test(dotted)) {
    const n = Number(dotted)
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

/** "from 12 entries" (never "from 0 entries": no count is no line). */
export function entriesText(n) {
  if (!Number.isInteger(n) || n < 1) return ''
  return n === 1 ? 'from 1 entry' : `from ${n} entries`
}
