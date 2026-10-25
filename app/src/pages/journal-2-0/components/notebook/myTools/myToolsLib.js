// Notebook widgets phase 2 (wave 8, Task 8.17): what My tools says and how it reads its answers.
//
// ⛔ LAZY. Only the My tools sheet imports this file, and only openMyTools.js (a dynamic import) reaches the sheet.
//
// ⛔ Member words only (spec 4.1 and the global constraints): widget, note, version, archive, chart sets, presets.
// Never the engine's own nouns. The server's sentences (count cap, conflict, archive first, type the name) are shown
// VERBATIM (`actionFailure`), never retyped here.
import { FAILURE_COPY, failureText } from '../../../lib/builtWidgets'

/** The four tabs (spec 5.8). Wave 8 builds Widgets, wave 9 Routines and Trackers (Task 9.18); Templates says so and
 *  carries no controls (wave 11). */
export const TABS = Object.freeze([
  ['widgets', 'Widgets'], ['routines', 'Routines'], ['trackers', 'Trackers'], ['templates', 'Templates'],
])
export const TAB_KEYS = Object.freeze(TABS.map(([k]) => k))

/** The Widgets tab's three lists, keyed by the server's `?view=` (GET /api/j2/widget-definitions). */
export const FILTERS = Object.freeze([['live', 'Active'], ['archived', 'Archived'], ['deleted', 'Recently deleted']])

/** How long Recently deleted keeps a widget. The server's `RECENTLY_DELETED_DAYS` decides; this only words it. */
export const RECENTLY_DELETED_DAYS = 30

/** A list draws at most this many rows. Active is capped at 100 widgets by the server; Archived and Recently deleted
 *  are not, so they say how many more there are rather than drawing an unbounded list. */
export const LIST_RENDER_MAX = 100

export const COMING_SOON = Object.freeze({
  templates: 'Templates are coming soon.',
})

/** The Routines and Trackers tabs' three lists, keyed by the server's `?filter=` (GET /api/j2/routines|trackers). */
export const TOOL_FILTERS = Object.freeze([['active', 'Active'], ['archived', 'Archived'], ['deleted', 'Recently deleted']])

/** What the Routines and Trackers tabs say (Task 9.18), in the tab's own noun. The server's sentences (refusals, the
 *  count cap, the conflict, the typed name) are shown as they came, never retyped here; the archive, delete and
 *  check-in sentences are the editors' own (routines/toolEditorLib), so the two doors say the same words. */
const toolCopy = (one, many) => Object.freeze({
  noun: one,
  loading: `Loading your ${many}…`,
  loadFailed: `Your ${many} couldn't be loaded just now.`,
  offlineList: `You're offline. Your ${many} show here when you're back online.`,
  emptyActive: `No ${many} yet. Make one here.`,
  emptyArchived: `Nothing archived. An archived ${one} stays in its notes, read-only, with its history.`,
  emptyDeleted: `Nothing deleted in the last ${RECENTLY_DELETED_DAYS} days.`,
  make: `New ${one}`,
  editorFailed: `The ${one} editor couldn't open. Try again.`,
  heading: (n) => `${n} ${n === 1 ? one : many}`,
  restored: (name) => `Restored “${name}” to your ${many}.`,
})
export const TOOL_LIST_COPY = Object.freeze({ routine: toolCopy('routine', 'routines'), tracker: toolCopy('tracker', 'trackers') })

export const COPY = Object.freeze({
  loading: 'Loading your widgets…',
  loadFailed: "Your widgets couldn't be loaded just now.",
  offlineList: "You're offline. Your widgets show here when you're back online.",
  offlineAction: "You're offline. Try again when you're back online.",
  actionFailed: "That didn't go through. Try again.",
  builderFailed: "The widget builder couldn't open. Try again.",
  setsFailed: "Chart sets couldn't open. Try again.",
  emptyLive: 'No widgets yet. Build one here, or type /build in a note.',
  emptyArchived: 'Nothing archived. An archived widget stays in its notes as a snapshot.',
  emptyDeleted: `Nothing deleted in the last ${RECENTLY_DELETED_DAYS} days.`,
  usedInLoading: 'Loading the notes…',
  usedInFailed: "The notes couldn't be loaded just now.",
  usedInEmpty: "This widget isn't in any note yet.",
  revsLoading: 'Loading the versions…',
  revsFailed: "The versions couldn't be loaded just now.",
  revsEmpty: 'No saved versions yet.',
  tooNew: FAILURE_COPY.too_new,
  setsHint: 'Chart sets and presets have their own place.',
  paid: 'My tools needs a paid plan.',
  gone: "That widget isn't available.",
  revertFailed: "Saved a copy as a new widget. This widget couldn't go back to the version before; it now has the restored version as its newest.",
  revertRetry: 'Go back to the version before',
})

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export const notesWord = (n) => `${n} note${n === 1 ? '' : 's'}`

/** "Used in 3 notes" (a link to the notes), or "Not in any note" (nothing to list). */
export const usedInText = (n) => (n > 0 ? `Used in ${notesWord(n)}` : 'Not in any note')

/** Spec 5.6: archiving a widget that is in notes says what happens to those notes. */
export const archiveSentence = (n) =>
  `It stays in your ${notesWord(n)} as a snapshot. See it now keeps working from its saved copy.`

export const usedInHeading = (name, n) => `“${name}” is in ${notesWord(n)}`

// ── dates ───────────────────────────────────────────────────────────────────────────────────────────

const parse = (iso) => {
  if (typeof iso !== 'string' || !iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** "Oct 24", or "Oct 24, 2025" outside the current year; '' for an unreadable stamp. */
export function dayText(iso, now = new Date()) {
  const d = parse(iso)
  if (!d) return ''
  const opts = { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) }
  return new Intl.DateTimeFormat('en-US', opts).format(d)
}

/** "Edited today", "Edited Oct 24". */
export function editedText(iso, now = new Date()) {
  const d = parse(iso)
  if (!d) return ''
  return sameDay(d, now) ? 'Edited today' : `Edited ${dayText(iso, now)}`
}

/** A version's stamp, to the minute: "Oct 24, 3:12 PM" (with the year outside the current one). */
export function versionDate(iso, now = new Date()) {
  const d = parse(iso)
  if (!d) return 'Unknown date'
  const opts = {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  }
  return new Intl.DateTimeFormat('en-US', opts).format(d)
}

/** "Kept until Nov 23" for a widget deleted at `iso`. */
export function keptUntilText(iso, now = new Date()) {
  const d = parse(iso)
  if (!d) return ''
  const until = new Date(d.getTime() + RECENTLY_DELETED_DAYS * 24 * 60 * 60 * 1000)
  return `Kept until ${dayText(until.toISOString(), now)}`
}

// ── answers ─────────────────────────────────────────────────────────────────────────────────────────

/** The sentence for a refused list or panel read. 404 on a LIST is the dark wave; a 402 is the plan, and neither
 *  has anything to retry. */
export function readFailure(code, fallback) {
  if (code === 'offline') return COPY.offlineList
  if (code === 'paid') return COPY.paid
  if (code === 'unavailable') return FAILURE_COPY.unavailable
  return fallback
}

/** Codes whose refusal has nothing a retry can change. */
export const NO_RETRY = Object.freeze(new Set(['unavailable', 'paid']))

/** Codes where the SERVER'S sentence is the authority, shown as it came (the count cap, a stale tab, a plan too new,
 *  and `invalid`: "Archive this widget before deleting it.", "Type the widget's name exactly to delete it.").
 *  `failureText` (lib/builtWidgets FAILURE_COPY) is only the fallback when the server sent no sentence. */
const SERVER_SAYS = new Set(['count_cap', 'conflict', 'too_new', 'invalid'])

/** The sentence for a refused action. A 404 on ONE widget means it went away (another tab deleted it). A plain
 *  network failure is not the refresh failure `failureText` falls back to: nothing here touches a snapshot. */
export function actionFailure(got) {
  const code = isRecord(got) ? got.code : null
  if (code === 'offline') return COPY.offlineAction
  if (code === 'paid') return COPY.paid
  if (code === 'unavailable') return COPY.gone
  const message = isRecord(got) && typeof got.message === 'string' ? got.message.trim() : ''
  if (SERVER_SAYS.has(code) && message) return message
  if (code === 'failed' || typeof code !== 'string' || !code) return COPY.actionFailed
  return failureText(code, message) || COPY.actionFailed
}

// ── requests ────────────────────────────────────────────────────────────────────────────────────
// My tools reads and writes through lib/builtWidgets' getJson / postJson / putJson, the ONE client for
// `/api/j2/widget-definitions` (wave 8 consolidation): `{ok: true, data}` or `{ok: false, code, message, status}`, never a
// throw; offline makes no request; 404 is `unavailable`, 402 `paid`, 428 (no If-Match, ruling R-27) a conflict; `etag`
// goes as If-Match (ruling R-15), on a POST too (a version restore). The sentences above read only the `code`, and the
// server's `message` for SERVER_SAYS.

// ── plans ───────────────────────────────────────────────────────────────────────────────────────────

/** The plan with the member's own name as its title: once a member names a widget, the name is theirs (spec 5.2,
 *  "the name keeps following the plan until the member types in it"). The builder reads the title from the plan, so
 *  a rename that left it behind would be undone by the next save from the builder. */
export function namedPlan(plan, name) {
  if (!isRecord(plan)) return plan
  const display = isRecord(plan.display) ? plan.display : {}
  return { ...plan, display: { ...display, title: name, titleAuto: false } }
}

/** The plan a duplicate saves: the same widget; a member-named title follows the copy's name. */
export function copiedPlan(plan, name) {
  if (!isRecord(plan)) return plan
  const display = isRecord(plan.display) ? plan.display : {}
  return display.titleAuto === false ? namedPlan(plan, name) : { ...plan }
}

/** The name a duplicate gets, as the server names a "Save as a new widget" copy. */
export const copyName = (name) => `${String(name || 'Widget')} copy`.slice(0, 200)

// ── the notes a widget is in ────────────────────────────────────────────────────────────────────────

export const noteHref = (id) => `/journal/notebook?note=${encodeURIComponent(String(id))}`

/** Open a note from My tools. My tools is mounted on its OWN root, outside the app's router, so it cannot call the
 *  router's navigate. A plain left click pushes the location the way the router's own history does (its state shape,
 *  the next index) and tells the router with the `popstate` it listens for; a modified click (a new tab, a new window)
 *  is left to the browser, since the row is a real link. Returns true when it navigated in place. */
export function openNoteInPlace(e, id) {
  if (!e || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false
  if (typeof window === 'undefined' || !window.history?.pushState) return false
  e.preventDefault()
  const prev = window.history.state
  const idx = isRecord(prev) && Number.isInteger(prev.idx) ? prev.idx + 1 : 0
  window.history.pushState({ usr: null, key: Math.random().toString(36).slice(2, 10), idx }, '', noteHref(id))
  window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
  return true
}

// ── what changed between two versions ───────────────────────────────────────────────────────────────

/** `other` as runs of `{text, changed}`, where `changed` marks the words that are not in `base` (a word-level longest
 *  common subsequence; summaries are one sentence, so the table is small). Whitespace is never marked on its own. */
export function diffWords(base, other) {
  const a = String(base || '').split(/(\s+)/).filter((t) => t !== '')
  const b = String(other || '').split(/(\s+)/).filter((t) => t !== '')
  const n = a.length
  const m = b.length
  if (!m) return []
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
    }
  }
  const marks = new Array(m).fill(true)
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { marks[j] = false; i += 1; j += 1 } else if (L[i + 1][j] >= L[i][j + 1]) i += 1
    else j += 1
  }
  // Whitespace takes the mark of what surrounds it: a space between two changed words is part of the change.
  for (let k = 0; k < m; k += 1) {
    if (/^\s+$/.test(b[k])) marks[k] = k > 0 && k < m - 1 && marks[k - 1] && marks[k + 1]
  }
  const runs = []
  for (let k = 0; k < m; k += 1) {
    const last = runs[runs.length - 1]
    if (last && last.changed === marks[k]) last.text += b[k]
    else runs.push({ text: b[k], changed: marks[k] })
  }
  return runs
}
