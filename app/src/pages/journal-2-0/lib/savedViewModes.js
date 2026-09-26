/**
 * ⛔⛔ THE VIEW MODES A SAVED VIEW MAY CARRY — THE CLIENT HALF OF ONE FACT.
 *
 * The server half is `SAVEABLE_VIEW_TYPES` in
 * `api/services/journal_two/note_properties.py`, and `create_saved_view`
 * REFUSES anything outside it. Two lists over one fact is the second-authority
 * defect this repo keeps paying for, so they are pinned against each other by
 * `tests/test_journal_two_properties_router.py` — which reads THIS file rather
 * than restating its contents.
 *
 * ⛔ ADDING A MODE HERE IS NOT ENOUGH. `NotebookTab.handleSelectView` needs a
 * branch that restores it, or the view saves happily and then opens as a list —
 * silently, because an unrecognised type falls back rather than throwing. That
 * fallback is deliberate (a view saved by a newer client must not break an
 * older one), which is exactly why the failure is quiet and needs a rail.
 */
/**
 * ⛔ THE ONE LIST. Order is the toolbar order; `id` is the PERSISTED viewType,
 * written into saved views, so renaming one orphans every saved view using it.
 * `icon` and `label` live here rather than in the tab because a mode that the
 * toolbar cannot render is not a mode the member has.
 */
export const VIEW_MODES = [
  { id: 'list', icon: 'rows', label: 'List view' },
  { id: 'table', icon: 'columns', label: 'Table view' },
  { id: 'board', icon: 'board', label: 'Board view' },
  { id: 'calendar', icon: 'calendar', label: 'Calendar view' },
  { id: 'graph', icon: 'graph', label: 'Graph view' },
  // Wave 6: notes on a time axis, in lanes by folder or tag. Read-only in v1.
  { id: 'timeline', icon: 'clock', label: 'Timeline view' },
  // Wave 6: every checklist item across the notebook (NoteTasksView). ⛔ NOT
  // SAVEABLE: it lists tasks, not the notes a folder/tag/filter selects, so a
  // saved "tasks view" would store nothing — and the server's
  // SAVEABLE_VIEW_TYPES refuses it. `?view=tasks` (the task reminder's link) is
  // its door; NotebookTab handles that param beside `?view=all`.
  { id: 'tasks', icon: 'check', label: 'Tasks view', saveable: false },
]

// ⛔ DERIVED, NOT RESTATED. A hand-written second copy of these ids is the
// second-authority defect this file's own header warns about — it went in as a
// third list once (the toolbar), which is why the toolbar now reads from here.
// A mode marked `saveable: false` is offered in the toolbar and never saved.
export const SAVEABLE_VIEW_MODES = new Set(VIEW_MODES.filter((m) => m.saveable !== false).map((m) => m.id))

/** The default a saved view opens as when its type is unrecognised. */
export const FALLBACK_VIEW_MODE = 'list'

export default SAVEABLE_VIEW_MODES
