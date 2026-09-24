/**
 * Tasks across notes — the client half (wave 6, Phase 2).
 *
 * The server lists every `taskItem` in every live note
 * (`GET /api/j2/notes/tasks`, `api/services/journal_two/note_tasks.py`). This
 * file groups them for the view, labels their due dates, and — the part that
 * must agree with the server exactly — says WHICH task a row points at.
 *
 * ⛔ THE ORDINAL IS A CONTRACT. A row opens its note at `?task=<index>`, where
 * `index` is the task's position among ALL `taskItem` nodes in the document,
 * pre-order (a parent before its children). `findTaskItemPos` counts the same
 * way over the live ProseMirror doc, so the editor can scroll to that node.
 * Both sides are held to ONE fixture, `tests/fixtures_note_tasks.json`
 * (`noteTasks.test.js` here, `tests/test_note_tasks.py` there).
 *
 * The due date is the editor lane's `dateMention` node, attr `date` =
 * `YYYY-MM-DD`. ⚠️ Not built in this branch yet — everything here is railed
 * against fixture documents that carry it.
 */
import { notePath } from '../../../hooks/useNoteBacklinks'

export const TASK_PARAM = 'task'

export const TASK_GROUPS = Object.freeze([
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'none', label: 'No date' },
])

/** The note, opened at one of its tasks. */
export function noteTaskPath(noteId, index) {
  const base = notePath(noteId)
  return Number.isInteger(index) && index >= 0 ? `${base}&${TASK_PARAM}=${index}` : base
}

/** `?task=<n>` read back, or null. */
export function taskIndexFromParams(params) {
  const raw = params && typeof params.get === 'function' ? params.get(TASK_PARAM) : null
  if (raw === null || !/^\d+$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) ? n : null
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

/** A strict `YYYY-MM-DD` as a UTC day number, or null. Never `new Date(str)`,
 *  which reads a bare date as UTC midnight and lands an ET member a day early. */
function dayNumber(ymd) {
  const m = typeof ymd === 'string' ? YMD.exec(ymd) : null
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = Date.UTC(y, mo - 1, d)
  const back = new Date(t)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null
  return t / 86400000
}

/** overdue | today | upcoming | none — same rule as the server's `due_bucket`. */
export function dueBucket(due, today) {
  const d = dayNumber(due)
  const t = dayNumber(today)
  if (d === null || t === null) return 'none'
  if (d < t) return 'overdue'
  if (d === t) return 'today'
  return 'upcoming'
}

/** Plain words for a due date, relative to `today` (both `YYYY-MM-DD`). */
export function dueLabel(due, today) {
  const d = dayNumber(due)
  const t = dayNumber(today)
  if (d === null) return ''
  if (t !== null) {
    const diff = d - t
    if (diff === 0) return 'Due today'
    if (diff === 1) return 'Due tomorrow'
    if (diff === -1) return 'Due yesterday'
    if (diff < 0) return `${-diff} days overdue`
  }
  const when = new Date(d * 86400000).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })
  return `Due ${when}`
}

/** Tasks into the four groups the view shows, keeping the server's order. */
export function groupTasks(tasks, today) {
  const out = { overdue: [], today: [], upcoming: [], none: [] }
  for (const t of tasks || []) {
    const key = t.bucket && t.bucket in out ? t.bucket : dueBucket(t.due, today)
    out[key].push(t)
  }
  return out
}

/** The ordinal walk over stored TipTap JSON: `{index, checked, depth}` per
 *  `taskItem`, pre-order. Mirrors `note_tasks.extract_tasks`. */
export function taskIndexesFromJson(doc) {
  const out = []
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object') return
    const isTask = node.type === 'taskItem'
    if (isTask) {
      const attrs = node.attrs && typeof node.attrs === 'object' ? node.attrs : {}
      out.push({ index: out.length, checked: attrs.checked === true, depth })
    }
    const kids = Array.isArray(node.content) ? node.content : []
    for (const c of kids) walk(c, isTask ? depth + 1 : depth)
  }
  walk(doc, 0)
  return out
}

/**
 * For the editor: the document position of task number `index` in a live
 * ProseMirror doc, or null. Counts `taskItem` nodes in the same pre-order as
 * the server (ProseMirror's `descendants` visits a node before its children).
 */
export function findTaskItemPos(doc, index) {
  if (!doc || typeof doc.descendants !== 'function' || !Number.isInteger(index) || index < 0) return null
  let seen = 0
  let found = null
  doc.descendants((node, pos) => {
    if (found !== null) return false
    if (node.type?.name === 'taskItem') {
      if (seen === index) {
        found = pos
        return false
      }
      seen += 1
    }
    return true
  })
  return found
}
