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
 * `CORE_ACTION_EVENTS` below, railed by notebookTelemetry.test.js (the "R-16 —
 * every core action has an event that fires on its success" block).
 * ⚰️ `capture_used`, `search_used` and `switcher_used` were declared in wave 6
 * and fired from NO door until wave 10 — declared is not wired.
 *
 * P3a (the community style library, Task 11): `library_viewed` (TemplateGallery, once
 * per view change while the switch is on) and `style_adopted` (StyleLibraryCard, after
 * an adopt the server accepted). Neither carries an id, a title or a handle.
 *
 * P5 (starter packs, Task 6): `style_applied` (a note made from a style, or a style switched or updated on a note,
 * after the server's yes), `style_created` (a new style from the editor, a duplicate or a note) and `block_used`
 * (a trader block inserted into a note). Closed enums only: never a style id, a name, a note or a block's params.
 *
 * Audit 2026-11-05, S16 and S20 (the return metrics). `first_run_completed` (the 60-second first run's Build: how many
 * names, which pack, whether today's plan was written) and `first_run_skipped`; `first_live_widget` (once per browser:
 * the first time a widget shows the member's OWN tickers -- the "aha", read against the first `notebook_tab_visit`);
 * `recap_written` (today's recap landed in the daily note); `trust_incident` (a publish undone within 10 minutes, or a
 * widget deleted and then brought back by undo). Day-1 return, Day-7 return and the morning open rate need no new
 * event: they are read from `notebook_tab_visit`'s own timestamps. The admin read is
 * api/services/journal_two/notebook_return_metrics.py. Counts, enums and booleans only: never a ticker or a title.
 * Audit 2026-11-05, S15: `today_opened` (the Today home opened: the ET session it opened in, and whether that open
 * made the day's note) -- the morning open counted at the surface built for it, beside the visit timestamps.
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
  LIBRARY_VIEWED: 'library_viewed',
  STYLE_ADOPTED: 'style_adopted',
  STYLE_APPLIED: 'style_applied',
  STYLE_CREATED: 'style_created',
  BLOCK_USED: 'block_used',
  FIRST_RUN_COMPLETED: 'first_run_completed',
  FIRST_RUN_SKIPPED: 'first_run_skipped',
  FIRST_LIVE_WIDGET: 'first_live_widget',
  RECAP_WRITTEN: 'recap_written',
  TRUST_INCIDENT: 'trust_incident',
  TODAY_OPENED: 'today_opened',
  VIEW_USED: 'view_used',
  LIST_LAYOUT_USED: 'list_layout_used',
  MENU_ROW_USED: 'menu_row_used',
  TODAY_DOOR_USED: 'today_door_used',
  TEMPLATE_STARTED: 'template_started',
  BLOCK_INSERTED: 'block_inserted',
  PANEL_ROW_USED: 'panel_row_used',
  NOTEBOOK_ROUTE_OPENED: 'notebook_route_opened',
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
// ⛔ P3a's `library_viewed` and `style_adopted` are NOT rows above (Task 11). This table is R-16's NAMED list,
// and the parity scorecard's clause 15b derives its events from it against wave 10's committed run log
// (tools/parity_scorecard.py TELEMETRY_RAILS, tests/test_parity_scorecard.py): a row added here reds that rail
// until a new landing's log is tied in. Each event is still asserted at its door (StyleLibrary.test.jsx).

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
  library_viewed: {
    // 'all' + styleLibrary.js's LISTED_ITEM_TYPES keys (notebookTelemetry.test.js derives that list, and
    // tests/test_notebook_telemetry_events.py holds it equal to the server's, which reads the gallery's own list).
    // Literal here only because this file is eager and styleLibrary.js is lazy (R-P3-5).
    type: oneOf('all', 'outline', 'style', 'page_layout', 'widget_definition', 'routine', 'tracker'),
    view: oneOf('browse', 'following', 'author'),
  },
  style_adopted: {
    notify: bool,
  },
  style_applied: {
    via: oneOf('new_note', 'switch', 'update'),
  },
  style_created: {
    via: oneOf('editor', 'duplicate', 'from_note'),
  },
  // ⛔ ONE line (the server rail parses one line per prop): the BLOCK_KINDS ids, in BLOCK_KINDS order, railed
  // against lib/journalBlocks.js and journal_styles.BLOCK_KINDS. chart, marketcontext and reminder are not
  // `block: true` in the registry, so insertWidgetEmbed never sends them today; they stay so the enum is the catalog.
  block_used: {
    kind: oneOf('chart', 'preEntryChecklist', 'priceStamps', 'positionSizing', 'myRules', 'prepWire', 'prepEarnings', 'prepMovers', 'prepLevels', 'tradeReview', 'moodCheckIn', 'marketcontext', 'reminder'),
  },
  // S16: the first run's Build. `names` is a COUNT, never the tickers; `pack` is a starter pack key or 'none'.
  first_run_completed: {
    names: num,
    pack: oneOf('swing', 'day', 'prop', 'options', 'earnings', 'none'),
    plan: bool,
    ms: num,
  },
  first_run_skipped: {
    step: num,
  },
  // S20 "First aha": fired once per browser; the admin read takes each member's FIRST one.
  first_live_widget: {
    source: oneOf('watchlist', 'reporting', 'first_run'),
    names: num,
  },
  recap_written: {
    created: bool,
  },
  // S20 "Trust incidents": a publish undone within 10 minutes; a widget deleted then restored by undo.
  trust_incident: {
    kind: oneOf('publish_undone', 'widget_restored'),
    ms: num,
  },
  // S15 + S20 "Morning open rate": the Today home opened, in which ET session, and whether it made the day's note.
  today_opened: {
    session: oneOf('premarket', 'open', 'after_close', 'closed'),
    created: bool,
  },
  // Follow-up A (usage counting): which views, menu rows, doors, templates, blocks and panel rows members use. Every
  // value is a fixed id; each enum is railed against the place its ids are defined (notebookUsage.test.js).
  view_used: {
    mode: oneOf('list', 'table', 'board', 'calendar', 'tasks', 'graph', 'timeline'),
    via: oneOf('menu', 'saved_view', 'link'),
  },
  list_layout_used: {
    layout: oneOf('rows', 'cards'),
  },
  menu_row_used: {
    menu: oneOf('new', 'list_more', 'view', 'note_more', 'note_ai', 'format', 'plus_sheet'),
    row: oneOf('blank', 'template', 'voice', 'import', 'reviews', 'review_daily', 'review_weekly', 'review_monthly', 'today_note', 'ask_notebook', 'journal_tools', 'export', 'remove_sample', 'my_tools', 'manage_templates', 'list', 'table', 'board', 'calendar', 'tasks', 'graph', 'timeline', 'rows', 'cards', 'more_views', 'save_view', 'saved_view', 'starter_views', 'rename_view', 'delete_view', 'ask_note', 'writing_help', 'font', 'font_pick', 'size', 'size_pick', 'color', 'quote', 'code', 'attach', 'divider', 'find', 'outline', 'history', 'duplicate', 'make_thesis', 'lock', 'archive', 'save_template', 'open_beside', 'trash', 'export_png', 'export_print', 'export_md', 'export_html', 'export_json', 'export_docx', 'quick_note', 'photo', 'help'),
  },
  today_door_used: {
    door: oneOf('list_button', 'shortcut', 'phone_row', 'brief_start', 'brief_open', 'recap', 'journal_panel'),
    created: bool,
  },
  template_started: {
    source: oneOf('catalogue', 'note_type', 'own', 'library'),
    family: oneOf('rituals', 'research', 'trades', 'mind', 'trade_plan', 'daily_prep', 'weekend_prep', 'earnings', 'earnings_followup', 'post_trade_review', 'weekly_review', 'thesis', 'watchlist_note', 'custom'),
  },
  // `kind`: the widget registry's ids (src/widgets/registry.js WIDGET_IDS) less `builtWidget`, a member-built widget,
  // which is sent as 'custom'. Never a widget's name or params.
  block_inserted: {
    kind: oneOf('chart', 'watchlist', 'themes', 'scanner', 'fundamentals', 'breadth', 'indexes', 'marketcontext', 'aisearch', 'news', 'notebook', 'profile', 'alerts', 'calendar', 'optionsflow', 'periodsort', 'nhnl', 'nhnlPulse', 'volumescan', 'scatter', 'tradeExchangeNews', 'researchLibrary', 'screener', 'cot', 'modelbook', 'tradeExchangeHeadline', 'myWatchlistToday', 'myNamesReporting', 'tickerCard', 'myPnlStats', 'myPositionsRisk', 'myRulesCheck', 'myMistakes', 'marketOnMyNames', 'tickerFlow', 'tradeRecap', 'myPnlCalendar', 'mySetupEdge', 'myScreenToday', 'roomBuzzOnMyNames', 'myEarningsReactions', 'myTiltCheck', 'myRevengeClean', 'myPlanVsActual', 'myRiskLeftToday', 'myPropFirm', 'myGamePlan', 'myAlertsFired', 'preEntryChecklist', 'priceStamps', 'positionSizing', 'sizeCalc', 'myRules', 'prepWire', 'prepEarnings', 'prepMovers', 'prepLevels', 'tradeReview', 'moodCheckIn', 'routine', 'tracker', 'custom'),
    via: oneOf('slash', 'palette', 'phone_plus'),
  },
  panel_row_used: {
    row: oneOf('all_notes', 'daily_brief', 'favorites', 'recents', 'folder', 'tag', 'unfiled', 'archived', 'trash', 'playbook', 'search_tab'),
  },
  notebook_route_opened: {
    route: oneOf('setups_board', 'playbook', 'research_page'),
  },
})

/** Follow-up A: a menu row pressed. `row` is the id written where the row is defined (never its label). */
export const trackMenuRow = (menu, row) => (row ? trackNotebookEvent(NOTEBOOK_EVENTS.MENU_ROW_USED, { menu, row }) : null)

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

// The suites written before S20 pin "this widget renders without a fetch"; the "first live widget" mark is off there
// by default (src/test-setup.js), and on in the rails that measure it. Always on in the app. The mark itself is
// per ACCOUNT (lib/firstLiveWidget.js, Tier 3a fix round 1, review minor 9).
let firstLiveOn = true
/** Tests only. */
export function __setFirstLiveWidgetForTests(on) { firstLiveOn = on !== false }
/** Whether the first-live-widget mark may run (always, outside the older suites). */
export function firstLiveWidgetOn() { return firstLiveOn }

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
