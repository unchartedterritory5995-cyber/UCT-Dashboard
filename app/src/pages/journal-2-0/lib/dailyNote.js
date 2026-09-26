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

/** Open (or make) today's note. Resolves `{note, created, templateMissing}`. */
export async function openDailyNote({ templateId, today = todayET } = {}) {
  const res = await fetch('/api/j2/notes/daily', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: today(), ...(templateId ? { templateId } : {}) }),
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
