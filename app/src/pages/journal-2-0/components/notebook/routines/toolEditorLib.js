// Notebook widgets phase 2, wave 9 (Task 9.16): what the routine and tracker editors say, and the pure rules they share.
//
// ⛔ LAZY. Only the two editor sheets import this file, and only their openers (dynamic imports) reach the sheets.
// ⛔ Member words only (spec 4.1): routine, tracker, item, note. Never "checklist", "definition", "source", "plan" or
// "scope". The server's refusals are shown VERBATIM; the client's own checks below say the same thing before a request.
import { TOOL_COPY } from '../../../lib/blocks/toolsApi'
import { CRUD_COPY } from '../../../lib/toolsCrud'

/** The caps the server keeps (routines.py / trackers.py); the client checks them too so a refusal costs no request. */
export const NAME_MAX = 80
export const ITEMS_MAX = 25
export const ITEM_MAX = 200
export const UNIT_MAX = 16
export const RECENTLY_DELETED_DAYS = 30

export const COPY = Object.freeze({
  newRoutine: 'New routine',
  editRoutine: 'Edit routine',
  newTracker: 'New tracker',
  editTracker: 'Edit tracker',
  loading: 'Loading…',
  keep: 'Keep your changes?',
  keepHint: "They aren't saved yet.",
  conflict: CRUD_COPY.conflict,
  reloaded: 'Showing the newer version.',
  cleanFirst: 'Save or discard your changes first.',
  archivedRoutine: TOOL_COPY.archivedRoutine,
  archivedTracker: TOOL_COPY.archivedTracker,
  builtin: 'Mood and focus come from your check-ins.',
  importNone: 'Your day notes have no rules to import yet.',
  remindLine: 'Through the alert bell only.',
  notInNote: 'Not in any note',
  usedInLoading: 'Loading the notes…',
  usedInFailed: "The notes couldn't be loaded just now.",
  usedInEmpty: "It isn't in any note yet.",
  loadFailed: "Can't open this right now.",
})

/**
 * THE server's refusal sentences, each with the field it belongs beside (null: no one field, so the notice line).
 * ONE table: field placement (`fieldOf`) and the client's own checks (`CHECK`) are both read from it, never retyped.
 * ⛔ The server sends no field with a refusal (every field refusal is `code: "invalid"` with its sentence: ToolError
 * carries status, code and sentence only), so placement is an EXACT match on these sentences. A sentence the server
 * rewords is no longer matched and shows in the notice line (never lost). routines/__fixtures__/serverSentences.json is
 * the server's text, extracted from its source, and toolEditorLib.test.js pins this table to it word for word.
 * Owner follow-up: a `field` on ToolError would let the client key on it instead.
 */
export const SERVER_SENTENCES = Object.freeze({
  routine: Object.freeze({
    S_BAD_NAME: ['Give the routine a name.', 'name'],
    S_NAME_LONG: ['A name can be at most 80 characters.', 'name'],
    S_NO_ITEMS: ['Add at least one item.', 'items'],
    S_TOO_MANY_ITEMS: ['A routine can hold up to 25 items.', 'items'],
    S_ITEM_LONG: ['An item can be at most 200 characters.', 'items'],
    S_BAD_SCHEDULE: ['Pick when this routine runs.', 'schedule'],
    S_BAD_SHARE: ['Pick how much of the routine counts as done.', 'doneShare'],
    S_BAD_TIME: ['Pick a reminder time in 5-minute steps.', 'reminder'],
    S_BAD_SETTINGS: ["These routine settings couldn't be saved.", null],
    S_CAP: ['You have 30 routines. Archive one in My tools to make room.', null],
    S_CONFLICT: ['Changed in another tab. Reload to see the newer version.', null],
    S_ARCHIVE_FIRST: ['Archive this routine before deleting it.', null],
    S_TYPE_NAME: ["Type the routine's name exactly to delete it.", null],
  }),
  tracker: Object.freeze({
    S_BAD_NAME: ['Give the tracker a name.', 'name'],
    S_NAME_LONG: ['A name can be at most 80 characters.', 'name'],
    S_UNIT: ['A unit can be at most 16 characters.', 'unit'],
    S_KIND: ['Pick a tracker type.', 'kind'],
    S_KIND_FIXED: ["A tracker's type can't change. Make a new tracker instead.", 'kind'],
    S_BAD_DAYS: ['Pick which days this tracker logs.', 'days'],
    S_BAD_SETTINGS: ["These tracker settings couldn't be saved.", null],
    S_CAP: ['You have 30 trackers. Archive one in My tools to make room.', null],
    S_CONFLICT: ['Changed in another tab. Reload to see the newer version.', null],
    S_ARCHIVE_FIRST: ['Archive this tracker before deleting it.', null],
    S_TYPE_NAME: ["Type the tracker's name exactly to delete it.", null],
  }),
})
const said = (kind, key) => SERVER_SENTENCES[kind][key][0]

/** The field a server refusal belongs beside, by its exact sentence; null shows it in the notice line. */
export function fieldOf(kind, message) {
  const table = SERVER_SENTENCES[kind]
  const m = String(message || '').trim()
  if (!table || !m) return null
  const hit = Object.values(table).find(([text]) => text === m)
  return hit ? hit[1] : null
}

/** The client's own checks before a request, in the SERVER'S words for the same rule (read from the table above). */
export const CHECK = Object.freeze({
  routineName: said('routine', 'S_BAD_NAME'),
  trackerName: said('tracker', 'S_BAD_NAME'),
  nameLong: said('routine', 'S_NAME_LONG'),
  noItems: said('routine', 'S_NO_ITEMS'),
  tooMany: said('routine', 'S_TOO_MANY_ITEMS'),
  itemLong: said('routine', 'S_ITEM_LONG'),
  noWeekday: said('routine', 'S_BAD_SCHEDULE'),
  unitLong: said('tracker', 'S_UNIT'),
  kindFixed: said('tracker', 'S_KIND_FIXED'),
})

/** Length as the server counts it (Python's `len`): code points, so an emoji is one character, not two. */
export const charCount = (s) => [...String(s ?? '')].length

export const notesWord = (n) => `${n} note${n === 1 ? '' : 's'}`
/** How many notes place a tool: the server's `usedIn`, or 0 for anything that is not a whole number. THE one guard. */
export const usedCount = (tool) => (Number.isInteger(tool?.usedIn) ? tool.usedIn : 0)
export const usedInText = (n) => `Used in ${notesWord(n)}`
export const usedInHeading = (name, n) => `“${name}” is in ${notesWord(n)}`
/** What archiving does (Task 9.18's sentence, shared). */
export const archiveSentence = (n) => (n > 0 ? `It stays in your ${notesWord(n)}. Its history is kept.` : 'Its history is kept.')
/** The one restore sentence (the editor's Restore and My tools' Restore from Archived say the same words). */
export const restoredSentence = (name) => `Restored “${name}”.`
/** Where a panel's Back goes, said on the button: the tool (inside its editor) or the list (inside My tools). ONE
 *  source for both labels; ToolManage takes the label as a prop and defaults to the editor's. */
export const BACK_LABEL = Object.freeze({
  tool: (kind) => `Back to the ${kind === 'tracker' ? 'tracker' : 'routine'}`,
  list: (kind) => `Back to your ${kind === 'tracker' ? 'trackers' : 'routines'}`,
})
export const deletedSentence = (name) => `“${name}” moved to Recently deleted. It's kept for ${RECENTLY_DELETED_DAYS} days.`

// ── the notes a tool is in ──────────────────────────────────────────────────────────────────────
// ⛔ THE owner of the note link, the note count and the edited line: myTools/myToolsLib re-exports these (it may
// import this file; this file may not import it, since My tools stays lazy on its own, MyToolsSheet.test.jsx).

// The note link and the in-place note navigation live in `lib/noteHref.js` (no dependency, so a built widget's drill
// panel can import them without putting this lazy file on the eager path, rule 9.16); re-exported here unchanged.
export { noteHref, openNoteInPlace } from '../../../lib/noteHref'

/** "Edited today", "Edited Oct 24" (with the year outside the current one); '' for an unreadable stamp. */
export function editedText(iso, now = new Date()) {
  const d = typeof iso === 'string' && iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  const same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (same) return 'Edited today'
  const opts = { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) }
  return `Edited ${new Intl.DateTimeFormat('en-US', opts).format(d)}`
}

// ── routines ────────────────────────────────────────────────────────────────────────────────────

export const WEEKDAYS = Object.freeze([[0, 'Mon'], [1, 'Tue'], [2, 'Wed'], [3, 'Thu'], [4, 'Fri']])
export const SCHEDULES = Object.freeze([['every', 'Every trading day'], ['weekdays', 'Chosen weekdays'], ['traded', 'Only days I trade']])
export const DONE_SHARES = Object.freeze([[1, 'All items'], [0.75, '3 of 4 items'], [0.5, 'Half the items']])
export const DEFAULT_REMINDER_TIME = '09:00'

/** The suggestion rules an item can ask for (routine_insights.SUGGEST_RULES), in trader words. `n` is the rule's
 *  number where it has one: the most trades in a day (1-20), or the minutes after a losing exit. */
export const SUGGEST_RULES = Object.freeze([
  { rule: 'stop_every_trade', label: 'Stop on every trade', words: () => 'Stop on every trade' },
  { rule: 'max_trades', label: 'Max trades in a day', words: (n) => `Max ${n} trades`, n: { label: 'Most trades in a day', def: 3, choices: Array.from({ length: 20 }, (_, i) => i + 1) } },
  { rule: 'under_daily_loss_limit', label: 'Stayed under my daily loss limit', words: () => 'Stayed under my daily loss limit' },
  { rule: 'no_trade_after_loss', label: 'No trade soon after a loss', words: (n) => `No trade within ${n} min of a loss`, n: { label: 'Minutes after a loss', def: 10, choices: [5, 10, 15, 20, 30, 45, 60, 90, 120] } },
  { rule: 'no_revenge', label: 'No revenge trades', words: () => 'No revenge trades' },
])
export const ruleOf = (rule) => SUGGEST_RULES.find((r) => r.rule === rule) || null

/** "Max 5 trades": what the suggestion reads, in its own words and number. */
export function suggestWords(suggest) {
  const r = ruleOf(suggest?.rule)
  if (!r) return ''
  return r.words(r.n ? (Number.isInteger(suggest.n) ? suggest.n : r.n.def) : undefined)
}

/** Every 5 minutes of the day as `HH:MM` (the server takes 5-minute steps). */
export const REMINDER_TIMES = Object.freeze(Array.from({ length: 288 }, (_, i) => {
  const h = Math.floor(i / 12)
  const m = (i % 12) * 5
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}))
/** "09:05" reads "9:05" (the clock the reminder line uses). */
export const timeLabel = (t) => String(t).replace(/^0(\d):/, '$1:')

let keySeq = 0
const nextKey = () => `k${(keySeq += 1)}`

/** A suggestion as the server keeps it: `{rule}` or `{rule, n}` for a rule with a number; anything else is none. */
export function cleanSuggest(s) {
  const r = ruleOf(s?.rule)
  if (!r) return null
  if (!r.n) return { rule: r.rule }
  return { rule: r.rule, n: Number.isInteger(s.n) ? s.n : r.n.def }
}

export function blankItem(text = '') {
  return { key: nextKey(), id: null, text, negative: false, suggest: null }
}

export function itemFrom(it) {
  return {
    key: nextKey(),
    id: typeof it?.id === 'string' && it.id ? it.id : null,
    text: typeof it?.text === 'string' ? it.text : '',
    negative: it?.negative === true,
    suggest: cleanSuggest(it?.suggest),
  }
}

export function blankRoutine() {
  return {
    name: '', items: [blankItem()], schedule: 'every', days: [0, 1, 2, 3, 4], doneShare: 1, strict: false,
    reminderOn: false, reminderTime: DEFAULT_REMINDER_TIME, hadReminder: false,
  }
}

export function routineDraft(tool) {
  const d = blankRoutine()
  if (!tool) return d
  const sched = tool.schedule && typeof tool.schedule === 'object' ? tool.schedule : { kind: 'every' }
  const s = tool.settings && typeof tool.settings === 'object' ? tool.settings : {}
  const rem = s.reminder && typeof s.reminder === 'object' ? s.reminder : null
  const items = Array.isArray(tool.items) ? tool.items.map(itemFrom) : []
  return {
    name: typeof tool.name === 'string' ? tool.name : '',
    items: items.length ? items : [blankItem()],
    schedule: SCHEDULES.some(([k]) => k === sched.kind) ? sched.kind : 'every',
    days: sched.kind === 'weekdays' && Array.isArray(sched.days) ? [...sched.days].sort() : [0, 1, 2, 3, 4],
    doneShare: DONE_SHARES.some(([v]) => v === s.done_share) ? s.done_share : 1,
    strict: s.strict === true,
    reminderOn: rem?.on === true,
    reminderTime: typeof rem?.time_et === 'string' && REMINDER_TIMES.includes(rem.time_et) ? rem.time_et : DEFAULT_REMINDER_TIME,
    hadReminder: !!rem,
  }
}

/** A starter's name and items, as the form holds them (each item with a new client key and no id). */
export function starterDraft(base, starter) {
  return { ...base, name: starter.name, items: (starter.items || []).map((it) => itemFrom({ ...it, id: null })) }
}

/** The body the server takes: blank items dropped, kept items with their ids (so their history stays). */
export function routineBody(d) {
  const items = d.items.filter((it) => it.text.trim()).map((it) => ({
    ...(it.id ? { id: it.id } : {}), text: it.text.trim(), negative: it.negative === true, suggest: cleanSuggest(it.suggest),
  }))
  return {
    name: d.name.trim(),
    items,
    schedule: d.schedule === 'weekdays' ? { kind: 'weekdays', days: [...d.days].sort((a, b) => a - b) } : { kind: d.schedule },
    settings: {
      done_share: d.doneShare,
      strict: d.strict === true,
      // Off by default and sent as none; a routine that had a reminder keeps its time, switched off.
      reminder: d.reminderOn || d.hadReminder ? { on: d.reminderOn === true, time_et: d.reminderTime } : null,
    },
  }
}

/** `{field: sentence}` for what the server would refuse; empty when the draft can be sent. */
export function checkRoutine(d) {
  const out = {}
  const name = d.name.trim()
  if (!name) out.name = CHECK.routineName
  else if (charCount(name) > NAME_MAX) out.name = CHECK.nameLong
  const items = d.items.filter((it) => it.text.trim())
  if (!items.length) out.items = CHECK.noItems
  else if (items.length > ITEMS_MAX) out.items = CHECK.tooMany
  else if (items.some((it) => charCount(it.text.trim()) > ITEM_MAX)) out.items = CHECK.itemLong
  if (d.schedule === 'weekdays' && !d.days.length) out.schedule = CHECK.noWeekday
  return out
}

export function scheduleWords(tool) {
  const s = tool?.schedule
  if (s?.kind === 'weekdays' && Array.isArray(s.days)) {
    return WEEKDAYS.filter(([v]) => s.days.includes(v)).map(([, l]) => l).join(', ')
  }
  return (SCHEDULES.find(([k]) => k === s?.kind) || SCHEDULES[0])[1]
}

// ── trackers ────────────────────────────────────────────────────────────────────────────────────

export const TRACKER_KINDS = Object.freeze([['yesno', 'Yes / no'], ['number', 'Number'], ['scale', '1-5 scale'], ['duration', 'Duration']])
export const TRACKER_DAYS = Object.freeze([['trading', 'Trading days'], ['any', 'Any day']])

export function blankTracker() {
  return { name: '', kind: 'yesno', unit: '', days: 'trading' }
}

export function trackerDraft(tool) {
  if (!tool) return blankTracker()
  return {
    name: typeof tool.name === 'string' ? tool.name : '',
    kind: TRACKER_KINDS.some(([k]) => k === tool.kind) ? tool.kind : 'yesno',
    unit: typeof tool.unit === 'string' ? tool.unit : '',
    days: tool.settings?.days === 'any' ? 'any' : 'trading',
  }
}

/** Create: the kind, and a unit only for a number. Edit: never the kind (fixed after create); a number's unit is sent,
 *  cleared as null; another kind's unit is left as it is. */
export function trackerBody(d, mode) {
  const unit = d.unit.trim()
  const body = { name: d.name.trim() }
  if (mode === 'new') {
    body.kind = d.kind
    if (d.kind === 'number' && unit) body.unit = unit
  } else if (d.kind === 'number') {
    body.unit = unit || null
  }
  body.settings = { days: d.days }
  return body
}

export function checkTracker(d) {
  const out = {}
  const name = d.name.trim()
  if (!name) out.name = CHECK.trackerName
  else if (charCount(name) > NAME_MAX) out.name = CHECK.nameLong
  if (d.kind === 'number' && charCount(d.unit.trim()) > UNIT_MAX) out.unit = CHECK.unitLong
  return out
}

export const kindWords = (kind) => (TRACKER_KINDS.find(([k]) => k === kind) || TRACKER_KINDS[0])[1]
