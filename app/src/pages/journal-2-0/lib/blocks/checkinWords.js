// The mood and focus check-in's words and its ONE day rule (P2 Tier 3, R-T3-2).
// ⛔ LAZY-ONLY: imported by the block body (MoodCheckInBlock.jsx) and the psychology leaf, never by an
// eager file, so none of this rides the Notebook's first open. NO IMPORTS (lib/blocks/blockDoors.test.js
// scans this directory).
// ⛔ R-T3-V1: the registry types mood and focus as plain strings (an enum there would need catalog
// settings the check-in does not have), so THIS is where a level is checked: '1'..'5', or '' for unpicked.
// The server sidecar checks the same set on its own side.

export const MOOD_WORDS = Object.freeze({ 1: 'Rough', 2: 'Low', 3: 'Okay', 4: 'Good', 5: 'Great' })
export const FOCUS_WORDS = Object.freeze({ 1: 'Scattered', 2: 'Distracted', 3: 'Steady', 4: 'Focused', 5: 'Locked in' })

/** The five levels, in order: the only values a pick may hold besides '' (unpicked). */
export const CHECKIN_LEVELS = Object.freeze(['1', '2', '3', '4', '5'])
const KEYS = Object.freeze(['mood', 'focus'])
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const level = (v) => (CHECKIN_LEVELS.includes(v) ? v : '')
const validDay = (d) => {
  const m = typeof d === 'string' && DAY_RE.exec(d)
  if (!m) return false
  const month = Number(m[2])
  const day = Number(m[3])
  return month >= 1 && month <= 12 && day >= 1 && day <= 31
}

/**
 * The params after one press. Pure: `params` is never changed, and a new object comes back.
 * `value` is a level ('1'..'5') or '' to clear; anything else (or a key other than mood / focus)
 * changes nothing. R-T3-2: `day` is set from `today` (the ET date) on the FIRST pick, kept by every
 * later pick, and cleared only when both mood and focus are cleared.
 */
export function nextCheckinParams(params, key, value, today) {
  const p = params && typeof params === 'object' ? params : {}
  const cur = { mood: level(p.mood), focus: level(p.focus), day: validDay(p.day) ? p.day : '' }
  if (!KEYS.includes(key) || (value !== '' && !CHECKIN_LEVELS.includes(value))) {
    if (cur.mood || cur.focus) return cur
    return { ...cur, day: '' }
  }
  const next = { ...cur, [key]: value }
  if (!next.mood && !next.focus) next.day = ''
  else if (!next.day) next.day = validDay(today) ? today : ''
  return next
}

/** "Mood: Good · Focus: Steady", only the picks a member made; '' when there is none. */
export function checkinText(params) {
  const p = params || {}
  const parts = []
  if (level(p.mood)) parts.push(`Mood: ${MOOD_WORDS[p.mood]}`)
  if (level(p.focus)) parts.push(`Focus: ${FOCUS_WORDS[p.focus]}`)
  return parts.join(' · ')
}

const MONTHS = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])

/** "Oct 17" for '2026-10-17', read from the string itself (a Date would move it across a time zone). */
export function checkinDayText(day) {
  if (!validDay(day)) return null
  const [, , m, d] = DAY_RE.exec(day)
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`
}
