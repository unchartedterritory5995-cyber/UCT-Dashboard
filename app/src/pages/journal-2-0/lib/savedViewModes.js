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
export const SAVEABLE_VIEW_MODES = new Set([
  'list',
  'table',
  'board',
  'calendar',
  'graph',
])

/** The default a saved view opens as when its type is unrecognised. */
export const FALLBACK_VIEW_MODE = 'list'

export default SAVEABLE_VIEW_MODES
