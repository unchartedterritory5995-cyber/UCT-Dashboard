/**
 * Wave 6 (lane E, item 4) — the member's daily note.
 *
 * `POST /api/j2/notes/daily {date, templateId?}` opens the member's note for
 * the day, creating it the first time (`YYYY-MM-DD · Weekday`, in a root
 * `Daily` folder). Exactly one per member per day is the SERVER's to enforce (a
 * unique index), so two tabs pressing Today at once still land on one note.
 *
 * ⛔ THE DAY IS THE MEMBER'S ET DAY, from `todayET` (lib/calendar.js, Intl-based,
 * right across DST) — never `new Date().toISOString()`, which is the UTC day
 * and turns over at 8 pm ET.
 *
 * Nothing to land: the note is made in one insert (its day and its template's
 * properties included), so no existing revision moves.
 */
import { todayET } from './calendar'

/** The preference that names the member's daily template (a template id, or ''). */
export const DAILY_TEMPLATE_PREF = 'notebook_daily_template'

/** What both doors say when the member's chosen daily template no longer exists (`templateMissing`): the
 *  Notebook's Ctrl+Alt+D shortcut (tabs/NotebookTab.jsx) and the Today panel. One sentence, one place. */
export const DAILY_TEMPLATE_MISSING = "Your daily template no longer exists, so today's note started blank."

/** Audit 2026-11-05, spec S2 (B12): what a door says when it MADE the day's note. The server files a
 *  new daily note in the member's root daily folder (creating it the first time); a member who never
 *  made that folder deserves to know where the note went. One sentence, one place.
 *  Simplify pass 2 (A3): that folder is "Daily notes" for a new member and stays "Daily" for one who
 *  already has it, so the sentence names neither (it said "Saved in your Daily folder."). */
export const DAILY_FOLDER_NOTICE = 'Saved with your daily notes.'

/** Fix round 1 (review finding 7): a door OUTSIDE the Notebook (Today, the Compass recap card,
 *  Insights) that made the day's note navigates away at once, so it cannot say where the note went.
 *  It queues the sentence here; the Notebook says it once when it opens (NotebookTab). Session
 *  storage survives the navigation and any redirect on the way; a blocked store says nothing. */
const PENDING_NOTICE_KEY = 'uct.nb.pendingNotice'
/** Fix round 2 (re-review N3): a queued sentence lives this long, and is said only on the arrival it
 *  was queued for -- the note it names (or any Notebook visit when it names none). Anything else
 *  drops it, so it can never surface an hour later on an unrelated visit. */
export const NOTICE_MAX_AGE_MS = 30_000
export function queueNotebookNotice(message, { noteId = null, now = Date.now() } = {}) {
  try {
    sessionStorage.setItem(PENDING_NOTICE_KEY, JSON.stringify({ message: String(message || ''), at: now, noteId }))
  } catch { /* nothing said */ }
}
export function takeQueuedNotebookNotice({ noteId = null, now = Date.now() } = {}) {
  try {
    const raw = sessionStorage.getItem(PENDING_NOTICE_KEY)
    sessionStorage.removeItem(PENDING_NOTICE_KEY)
    if (!raw) return null
    const q = JSON.parse(raw)
    if (!q || typeof q.message !== 'string' || !q.message) return null
    if (!Number.isFinite(q.at) || now - q.at > NOTICE_MAX_AGE_MS || now < q.at) return null
    if (q.noteId && q.noteId !== noteId) return null
    return q.message
  } catch { return null }
}

/** Open (or make) today's note. Resolves `{note, created, templateMissing}`. `seedToday` (Tier 3b fix round 1, I3/I9):
 *  a note this call MAKES starts with the Today home's plan -- the first run's Build and Today's "Start a fresh one". */
export async function openDailyNote({ templateId, today = todayET, seedToday = false } = {}) {
  const res = await fetch('/api/j2/notes/daily', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: today(), ...(templateId ? { templateId } : {}), ...(seedToday ? { seedToday: true } : {}) }),
  })
  if (!res.ok) {
    const err = new Error(`daily note request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return res.json()
}

/**
 * Ctrl+Alt+D (Cmd+Option+D on a Mac). Read by the physical KEY, because Option
 * changes the character a Mac types (Option+D is "∂"). ⛔ Never AltGr: on many
 * layouts Ctrl+Alt IS AltGr, and AltGr+D types a character a member meant to type.
 */
export function isDailyShortcut(e) {
  if (!e || !e.altKey || e.shiftKey) return false
  if (!(e.ctrlKey || e.metaKey)) return false
  if (typeof e.getModifierState === 'function' && e.getModifierState('AltGraph')) return false
  return e.code === 'KeyD'
}
