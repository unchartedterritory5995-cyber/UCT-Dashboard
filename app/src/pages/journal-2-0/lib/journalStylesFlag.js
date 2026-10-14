// Journal styles (spec P1.6): the ONE client gate, latched per tab like every Notebook flag.
// Server: NOTEBOOK_JOURNAL_STYLES_ENABLED (api/routers/auth.py NOTEBOOK_FLAGS), payload key
// below. ⛔ It gates CREATING (doors, the manager, /style, save-as-style, the update banner),
// never RENDERING a note that already holds a style's blocks (spec P1.7c).
import { notebookFlag } from './offline/notebookFlags'

export const JOURNAL_STYLES_FLAG = 'notebook_journal_styles_enabled'
export const journalStylesEnabled = () => notebookFlag(JOURNAL_STYLES_FLAG) === true
/** `/style` dispatches this on the editor's own DOM root; NoteEditorPage opens the style sheet. */
export const STYLE_EVENT = 'uct:notebook-journal-style'
/** Tier 2 part A: the slash menu's /plan, dispatched on the editor's own DOM root (I5). */
export const PLAN_EVENT = 'uct:notebook-plan'
