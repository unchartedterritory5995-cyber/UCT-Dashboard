/**
 * Wave 6 (lane E, item 6) — the Timeline view's layout, as pure functions.
 *
 * Notes sit on a horizontal time axis by created / updated / a DATE property,
 * zoomable by week (7 day columns), month (a column per day) or quarter (a
 * column per week), in lanes grouped by folder or by tag.
 *
 * ⛔ EVERY DAY IS AN ET DAY, AND NO BARE DATE STRING IS EVER PARSED AS A DATE
 * (`new Date('2026-09-24')` is UTC midnight — the previous evening in ET).
 *   · created/updated are UTC instants → their ET calendar day through Intl
 *     (`America/New_York`), the same way `todayET` computes today, so a note
 *     edited at 9 pm ET sits on that day, not tomorrow's UTC one;
 *   · a date property is a FREE-FORM STRING → the calendar view's own strict
 *     parser (`noteDateKey`: a leading YYYY-MM-DD, impossible dates refused);
 *   · day arithmetic runs on `Date.UTC(y, m, d)` built from the key's own
 *     digits, so no local time zone can move a day.
 *
 * ⛔ UNDATED NOTES GO UNDER "UNSCHEDULED" — the calendar view's rule, for the
 * same reason: a note with no date is exactly what a member opens a time view to
 * notice, so it is shown, never dropped. And notes dated OUTSIDE the window are
 * COUNTED, so an empty week never reads as "nothing happened".
 */
import { noteDateKey } from '../components/notebook/NoteCalendarView'

export const TIMELINE_ZOOMS = ['week', 'month', 'quarter']
export const TIMELINE_GROUPS = ['folder', 'tag']
export const DEFAULT_TIMELINE = { timeBy: 'updated', zoom: 'month', groupBy: 'folder' }
export const UNFILED_LANE = 'Unfiled'
export const UNTAGGED_LANE = 'No tag'

const ET_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
})

/** The ET calendar day of a UTC instant (ISO string), or null. */
export function etDateKey(iso) {
  if (typeof iso !== 'string' || !iso) return null
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  return ET_DAY.format(new Date(ms))
}

const parts = (key) => key.split('-').map(Number)
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10)

/** `key` moved by `n` days. */
export function addDays(key, n) {
  const [y, m, d] = parts(key)
  return fromUtc(Date.UTC(y, m - 1, d + n))
}

/** The Monday on or before `key` (weeks start Monday, as the trading week does). */
export function mondayOf(key) {
  const [y, m, d] = parts(key)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
  return addDays(key, -((dow + 6) % 7))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayLabel = (key) => { const [, m, d] = parts(key); return `${MONTHS[m - 1]} ${d}` }

/**
 * The window the axis shows around `anchor`, with its columns (`buckets`):
 * `{zoom, start, end, label, buckets: [{key, start, end, label}]}` — each
 * bucket covers `start..end` inclusive.
 */
export function timelineWindow(anchor, zoom) {
  const [y, m] = parts(anchor)
  if (zoom === 'week') {
    const start = mondayOf(anchor)
    const buckets = Array.from({ length: 7 }, (_, i) => {
      const k = addDays(start, i)
      return { key: k, start: k, end: k, label: dayLabel(k) }
    })
    return { zoom, start, end: addDays(start, 6), label: `Week of ${dayLabel(start)}`, buckets }
  }
  if (zoom === 'quarter') {
    const q0 = Math.floor((m - 1) / 3) * 3 // 0, 3, 6, 9
    const start = fromUtc(Date.UTC(y, q0, 1))
    const end = fromUtc(Date.UTC(y, q0 + 3, 0))
    const buckets = []
    for (let wk = mondayOf(start); wk <= end; wk = addDays(wk, 7)) {
      buckets.push({ key: wk, start: wk, end: addDays(wk, 6), label: dayLabel(wk) })
    }
    return { zoom, start, end, label: `Q${q0 / 3 + 1} ${y}`, buckets }
  }
  // month
  const start = fromUtc(Date.UTC(y, m - 1, 1))
  const end = fromUtc(Date.UTC(y, m, 0))
  const buckets = []
  for (let k = start; k <= end; k = addDays(k, 1)) buckets.push({ key: k, start: k, end: k, label: String(parts(k)[2]) })
  return { zoom, start, end, label: `${MONTHS[m - 1]} ${y}`, buckets }
}

/** The anchor moved one window forward (+1) or back (-1). */
export function shiftAnchor(anchor, zoom, dir) {
  if (zoom === 'week') return addDays(anchor, 7 * dir)
  const [y, m] = parts(anchor)
  const months = zoom === 'quarter' ? 3 : 1
  return fromUtc(Date.UTC(y, m - 1 + months * dir, 1))
}

/** The day a note sits on for `timeBy` ('created' | 'updated' | a date property id). */
export function noteTimelineDay(note, timeBy, defsById) {
  if (timeBy === 'created') return etDateKey(note.createdAt)
  if (timeBy === 'updated') return etDateKey(note.updatedAt)
  const def = defsById?.get?.(timeBy)
  return def ? noteDateKey(note, def) : null
}

/**
 * Lay the notes out: `{window, lanes: [{key, label, cells: {bucketKey: note[]}}],
 * unscheduled: note[], outside: number}`. Lanes are sorted by label with the
 * catch-all lane ("Unfiled" / "No tag") last, and only lanes with a note in the
 * window are drawn. A note with several tags sits in each tag's lane.
 */
export function layoutTimeline(notes, { timeBy, zoom, groupBy, anchor, defsById, folderName }) {
  const win = timelineWindow(anchor, zoom)
  const lanes = new Map()
  const unscheduled = []
  let outside = 0
  for (const note of notes || []) {
    const day = noteTimelineDay(note, timeBy, defsById)
    if (!day) { unscheduled.push(note); continue }
    if (day < win.start || day > win.end) { outside += 1; continue }
    const bucket = win.buckets.find((b) => day >= b.start && day <= b.end)
    if (!bucket) { outside += 1; continue }
    let laneKeys
    if (groupBy === 'tag') {
      const tags = [...new Set((note.tags || []).filter(Boolean))]
      laneKeys = tags.length ? tags.map((t) => [`tag:${t.toLowerCase()}`, `#${t}`]) : [['tag:', UNTAGGED_LANE]]
    } else {
      laneKeys = note.folderId
        ? [[`folder:${note.folderId}`, folderName?.(note.folderId) || 'Folder']]
        : [['folder:', UNFILED_LANE]]
    }
    for (const [key, label] of laneKeys) {
      if (!lanes.has(key)) lanes.set(key, { key, label, catchAll: key.endsWith(':'), cells: {} })
      const lane = lanes.get(key)
      ;(lane.cells[bucket.key] ||= []).push(note)
    }
  }
  const ordered = [...lanes.values()].sort((a, b) => (a.catchAll - b.catchAll) || a.label.localeCompare(b.label))
  return { window: win, lanes: ordered, unscheduled, outside }
}
