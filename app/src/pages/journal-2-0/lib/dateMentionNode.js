import { InputRule, Node, mergeAttributes } from '@tiptap/core'
import { todayET } from './calendar'

/**
 * Wave 6 item 7 — @date mentions.
 *
 * Typing `@today`, `@tomorrow`, `@yesterday`, `@next monday` (or `@monday`) or
 * `@2026-10-02`, then a space or punctuation, turns the words into an inline
 * `dateMention` atom: `{ date: 'YYYY-MM-DD' }`. It shows RELATIVE to the day it
 * is read on ("Today", "Tomorrow", "Fri Oct 2") and stores the absolute date.
 *
 * ⭐ THE CONTRACT WITH LANE F (fixed; do not rename). The tasks service
 * (api/services/journal_two/note_tasks.py) reads a `dateMention` inside a
 * `taskItem` as that task's due date: node name `dateMention`, attr `date`,
 * strict `YYYY-MM-DD` (tests/fixtures_note_tasks.json is the binding shape).
 *
 * ⛔ DATES ARE DAY NUMBERS, NEVER `new Date(str)`. A bare `YYYY-MM-DD` read by
 * `new Date` is UTC midnight — the previous day for a member in New York in
 * the evening. "Today" is `todayET()` (lib/calendar.js); every other day is
 * arithmetic on UTC day numbers, formatted in UTC, so no time zone can move it.
 *
 * Its citation text (leafText) is the ISO date — askCitation.js
 * `citationLeafText` ⇄ note_citation_text.py `_ATOM_TEXT` (an INLINE leaf: no
 * separator). Registered at schema 2 (a NEW node type).
 */

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86400000
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December']
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** A strict, real `YYYY-MM-DD` as a UTC day number, or null. */
export function dayNumber(ymd) {
  const m = typeof ymd === 'string' ? YMD.exec(ymd) : null
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const t = Date.UTC(y, mo - 1, d)
  const back = new Date(t)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null
  return t / DAY_MS
}

export const isIsoDate = (value) => dayNumber(value) !== null

function fromDayNumber(n) {
  const d = new Date(n * DAY_MS)
  const p = (v) => String(v).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

/** `ymd` moved by `days`, or null. */
export function addDays(ymd, days) {
  const n = dayNumber(ymd)
  return n === null ? null : fromDayNumber(n + days)
}

/**
 * What the member typed after `@`, as a date relative to `today`, or null.
 * A weekday ("monday", "next monday") is the first one AFTER today.
 */
export function resolveDateWord(word, today = todayET()) {
  const t = dayNumber(today)
  if (t === null || typeof word !== 'string') return null
  const w = word.trim().toLowerCase().replace(/\s+/g, ' ')
  if (w === 'today') return fromDayNumber(t)
  if (w === 'tomorrow') return fromDayNumber(t + 1)
  if (w === 'yesterday') return fromDayNumber(t - 1)
  if (isIsoDate(w)) return w
  const day = WEEKDAYS.indexOf(w.startsWith('next ') ? w.slice(5) : w)
  if (day < 0) return null
  const todayDow = new Date(t * DAY_MS).getUTCDay()
  const ahead = ((day - todayDow + 7) % 7) || 7
  return fromDayNumber(t + ahead)
}

/** "Today" · "Tomorrow" · "Yesterday" · "Fri Oct 2" · "Fri Oct 2, 2027" (another year). */
export function dateMentionLabel(date, today = todayET()) {
  const n = dayNumber(date)
  if (n === null) return 'Date'
  const t = dayNumber(today)
  if (t !== null) {
    if (n === t) return 'Today'
    if (n === t + 1) return 'Tomorrow'
    if (n === t - 1) return 'Yesterday'
  }
  const d = new Date(n * DAY_MS)
  const label = `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`
  const sameYear = t !== null && new Date(t * DAY_MS).getUTCFullYear() === d.getUTCFullYear()
  return sameYear ? label : `${label}, ${d.getUTCFullYear()}`
}

/** "Friday, October 2, 2026" — the full date, for the tooltip and screen readers. */
export function dateMentionLongLabel(date) {
  const n = dayNumber(date)
  if (n === null) return 'Date'
  const d = new Date(n * DAY_MS)
  return `${DOW_LONG[d.getUTCDay()]}, ${MON_LONG[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

/**
 * ⛔ M16 (wave 6 fix round 1): A RELATIVE LABEL IS ONLY TRUE ON THE DAY IT WAS
 * PAINTED. ⚰️ It was computed once, when the node view was built, so a note left
 * open overnight still said "Tomorrow" about today. Every live mention is
 * registered here, and when the page comes back into view (a tab switched back
 * to, a laptop woken, the window focused) each one repaints if ITS "today" has
 * moved. One pair of listeners for the whole page, installed on first use.
 */
const LIVE_MENTIONS = new Set()
let repaintListening = false
function repaintStaleMentions() {
  LIVE_MENTIONS.forEach((recheck) => { try { recheck() } catch { /* one view never stops the rest */ } })
}
function listenForANewDay() {
  if (repaintListening || typeof document === 'undefined') return
  repaintListening = true
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') repaintStaleMentions() })
  if (typeof window !== 'undefined') window.addEventListener('focus', repaintStaleMentions)
}

// `@word` preceded by the start of the text or a space/bracket (never an email
// address), ended by a space or punctuation. No lookbehind (iOS 16 floor): the
// leading character is matched, and the handler starts at the `@`.
const DAY_WORDS = 'today|tomorrow|yesterday|(?:next\\s+)?(?:mon|tues|wednes|thurs|fri|satur|sun)day|\\d{4}-\\d{2}-\\d{2}'
export const DATE_MENTION_INPUT = new RegExp(`(?:^|[\\s(\\[])@(${DAY_WORDS})([\\s.,;:!?)\\]])$`, 'i')

export const DateMention = Node.create({
  name: 'dateMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addOptions() {
    return { today: () => todayET() }
  },
  addAttributes() {
    return {
      date: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute('data-date')
          return isIsoDate(v) ? v : null
        },
        renderHTML: (attrs) => (isIsoDate(attrs.date) ? { 'data-date': attrs.date } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-type="date-mention"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    // Static HTML (the clipboard, an HTML export) carries the ABSOLUTE date: a
    // relative word would be wrong the day after it was copied.
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'date-mention' }),
      isIsoDate(node.attrs.date) ? node.attrs.date : '']
  },
  // The plain-text clipboard (and editor.getText()) read the ISO date too.
  renderText: ({ node }) => (isIsoDate(node.attrs.date) ? node.attrs.date : ''),
  addNodeView() {
    const today = this.options.today
    return ({ node }) => {
      const dom = document.createElement('span')
      dom.setAttribute('data-type', 'date-mention')
      dom.className = 'uctDateMention'
      dom.contentEditable = 'false'
      let paintedFor = null
      const paint = (n) => {
        const date = isIsoDate(n.attrs.date) ? n.attrs.date : null
        paintedFor = today()
        if (date) dom.setAttribute('data-date', date)
        else dom.removeAttribute('data-date')
        dom.textContent = date ? dateMentionLabel(date, paintedFor) : 'Date'
        dom.setAttribute('title', date ? dateMentionLongLabel(date) : '')
        dom.setAttribute('aria-label', date ? `Date: ${dateMentionLongLabel(date)}` : 'Date')
      }
      paint(node)
      let current = node
      // M16: repaint when THIS view's "today" is no longer the day it painted.
      const recheck = () => { if (today() !== paintedFor) paint(current) }
      LIVE_MENTIONS.add(recheck)
      listenForANewDay()
      return {
        dom,
        update(next) {
          if (next.type !== current.type) return false
          const changed = next.attrs.date !== current.attrs.date
          current = next
          if (changed) paint(next)
          return true
        },
        destroy() { LIVE_MENTIONS.delete(recheck) },
      }
    }
  },
  addInputRules() {
    const type = this.type
    const today = this.options.today
    return [new InputRule({
      find: DATE_MENTION_INPUT,
      handler: ({ state, range, match }) => {
        const date = resolveDateWord(match[1], today())
        if (!date) return null
        const at = range.from + match[0].indexOf('@')
        const tr = state.tr
        tr.replaceWith(at, range.to, type.create({ date }))
        tr.insertText(match[2], at + 1)
        return undefined
      },
    })]
  },
})
