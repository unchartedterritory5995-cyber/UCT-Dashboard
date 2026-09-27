/**
 * Notebook telemetry — the ONE door for the Notebook's core-action events
 * (wave 6, D14). It wraps the existing `POST /api/j2/telemetry`.
 *
 * ⛔ EVERY NAME IN `NOTEBOOK_EVENTS` MUST ALSO BE IN `_J2_TELEMETRY_EVENTS`
 * (`api/routers/journal_two.py`), or the POST is a 400 and the count is
 * silently zero — which reads exactly like "nobody used it".
 * `tests/test_notebook_telemetry_events.py` reads the names out of THIS file
 * and asserts each one is accepted; nothing restates them.
 *
 * ⛔ NEVER NOTE CONTENT, AND NEVER WHAT A MEMBER TYPED. Every event has a
 * SCHEMA below: a prop not on it is dropped, a number must be finite, and a
 * string prop is kept ONLY if it is one of that prop's enumerated values —
 * anything else becomes 'other'. So a caller who passes a search query, a note
 * title or an Ask question in a string prop sends 'other', never the text.
 * (A free-form "short string" rule would not do: a search for "nvda" is a
 * perfectly short string.)
 *
 * Best-effort by contract: it never throws into a caller and never blocks one.
 * An instrument that can break the thing it measures is worse than none.
 *
 * Call sites are wired by the owning lanes, not here — see the wave-6 F report.
 *
 * ⭐ WAVE 10 (lane 10D, ruling R-16): "every core action" is a NAMED list — the
 * user study's tasks T1-T10 plus export, import, save_success, share, publish,
 * writing_help_used and dictation_used. The eight events below the line are
 * that list's missing half (`bulk_used` is T5's bulk move/tag), and each fires
 * from its door on SUCCESS only. Which event carries which task is the table in
 * `CORE_ACTION_EVENTS` below, railed by notebookTelemetry.doors.test.jsx.
 * ⚰️ `capture_used`, `search_used` and `switcher_used` were declared in wave 6
 * and fired from NO door until wave 10 — declared is not wired.
 */

export const NOTEBOOK_EVENTS = Object.freeze({
  NOTE_OPEN_MS: 'note_open_ms',
  SAVE_FAILED: 'save_failed',
  CONFLICT_FORKED: 'conflict_forked',
  ASK_USED: 'ask_used',
  CAPTURE_USED: 'capture_used',
  SEARCH_USED: 'search_used',
  SWITCHER_USED: 'switcher_used',
  SAVE_SUCCESS: 'save_success',
  EXPORT_USED: 'export_used',
  IMPORT_USED: 'import_used',
  SHARE_USED: 'share_used',
  PUBLISH_USED: 'publish_used',
  WRITING_HELP_USED: 'writing_help_used',
  DICTATION_USED: 'dictation_used',
  BULK_USED: 'bulk_used',
})

/**
 * R-16's core actions, each with the event(s) that count it. The study tasks
 * are `docs/notebook/user-study-kit.md` §4. ⛔ A task maps to what fires when it
 * SUCCEEDS; T3 (formatting) and T9 (the phone) are note edits, so the save that
 * lands them is their event.
 */
export const CORE_ACTION_EVENTS = Object.freeze({
  'T1 start a note': ['note_open_ms', 'save_success'],
  'T2 save a passage with its source': ['capture_used', 'save_success'],
  'T3 heading, checklist, highlight': ['save_success'],
  'T4 find a note by title': ['switcher_used', 'search_used'],
  'T5 bulk move and tag': ['bulk_used'],
  'T6 attach a PDF and excerpt a page': ['capture_used'],
  'T7 ask the notebook, insert the answer': ['ask_used'],
  'T8 offline sentence survives': ['save_success', 'save_failed'],
  'T9 add a line on the phone': ['save_success'],
  'T10 get the note out': ['export_used', 'share_used'],
  export: ['export_used'],
  import: ['import_used'],
  save_success: ['save_success'],
  share: ['share_used'],
  publish: ['publish_used'],
  writing_help_used: ['writing_help_used'],
  dictation_used: ['dictation_used'],
})

const OTHER = 'other'
const num = { type: 'number' }
const bool = { type: 'bool' }
const oneOf = (...values) => ({ type: 'enum', values: new Set(values) })

/** Per-event prop schemas. A key not listed here never leaves the browser. */
export const EVENT_SCHEMAS = Object.freeze({
  note_open_ms: {
    ms: num,
    source: oneOf('list', 'switcher', 'link', 'search', 'deeplink', 'new', 'tasks', 'mention'),
    cached: bool,
  },
  save_failed: {
    status: num,
    reason: oneOf('network', 'http', 'conflict', 'quota', 'offline', 'too-large', 'unknown'),
    offline: bool,
    retrying: bool,
  },
  conflict_forked: {
    door: oneOf('editor', 'outbox', 'restore', 'board', 'capture', 'import', 'unknown'),
    queued: bool,
  },
  ask_used: {
    scope: oneOf('note', 'notebook', 'selection'),
    inserted: bool,
    ms: num,
  },
  capture_used: {
    target: oneOf('current', 'new', 'inbox'),
    widget: oneOf('chart', 'widget', 'fact', 'excerpt', 'web', 'quote', 'unknown'),
  },
  search_used: {
    results: num,
    filters: num,
    mode: oneOf('text', 'tag', 'ticker', 'filter'),
    ms: num,
  },
  switcher_used: {
    results: num,
    rank: num,
    picked: bool,
    mode: oneOf('title', 'recent', 'favorite', 'create'),
  },
  save_success: {
    door: oneOf('editor', 'outbox'),
    queued: bool,
  },
  export_used: {
    format: oneOf('md', 'html', 'json', 'docx', 'png', 'print'),
    scope: oneOf('note', 'selection', 'notebook'),
    count: num,
  },
  import_used: {
    source: oneOf('uct-export', 'evernote', 'notion', 'obsidian', 'logseq', 'keep', 'file'),
    created: num,
    updated: num,
    failed: num,
  },
  share_used: {
    action: oneOf('create', 'copy', 'revoke'),
  },
  publish_used: {
    action: oneOf('publish', 'unpublish', 'copy'),
    kind: oneOf('note', 'folder'),
    door: oneOf('editor', 'sidebar'),
  },
  writing_help_used: {
    action: oneOf('summarize', 'rewrite', 'continue', 'translate', 'autofill'),
    scope: oneOf('selection', 'whole', 'property'),
    replaced: bool,
  },
  dictation_used: {
    words: num,
  },
  bulk_used: {
    op: oneOf('move', 'addTag', 'removeTag', 'favorite', 'unfavorite', 'trash', 'restore', 'archive', 'unarchive', 'renameTag'),
    changed: num,
    failed: num,
  },
})

const KNOWN = new Set(Object.values(NOTEBOOK_EVENTS))

/** The props this event may carry, cleaned. Pure — the rail reads it. */
export function sanitizeProps(event, props) {
  const schema = EVENT_SCHEMAS[event]
  if (!schema || !props || typeof props !== 'object') return {}
  const out = {}
  for (const [key, spec] of Object.entries(schema)) {
    if (!Object.prototype.hasOwnProperty.call(props, key)) continue
    const v = props[key]
    if (spec.type === 'number') {
      if (typeof v === 'number' && Number.isFinite(v)) out[key] = Math.round(v)
    } else if (spec.type === 'bool') {
      if (typeof v === 'boolean') out[key] = v
    } else if (spec.type === 'enum') {
      out[key] = typeof v === 'string' && spec.values.has(v) ? v : OTHER
    }
  }
  return out
}

/**
 * Send one event. Unknown names are not sent (they would 400 anyway).
 * @returns the props actually sent, or null when nothing was sent
 */
export function trackNotebookEvent(event, props, { fetchImpl } = {}) {
  if (!KNOWN.has(event)) return null
  const clean = sanitizeProps(event, props)
  const f = fetchImpl || globalThis.fetch
  try {
    const p = f('/api/j2/telemetry', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, props: clean }),
    })
    if (p && typeof p.catch === 'function') p.catch(() => {})
  } catch { /* the action being measured already happened */ }
  return clean
}

/**
 * `note_open_ms` helper: start when the member asks for a note, stop when its
 * content is on screen. `stop()` fires at most once, so a re-render that calls
 * it again cannot double-count an open.
 */
export function startNoteOpenTimer({ now, fetchImpl } = {}) {
  const clock = now || (() => (globalThis.performance?.now ? globalThis.performance.now() : Date.now()))
  const t0 = clock()
  let done = false
  return function stop(props = {}) {
    if (done) return null
    done = true
    return trackNotebookEvent(NOTEBOOK_EVENTS.NOTE_OPEN_MS, { ...props, ms: clock() - t0 }, { fetchImpl })
  }
}
