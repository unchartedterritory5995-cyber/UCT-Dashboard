// Journal styles (spec P1.6): the ONE client gate, latched per tab like every Notebook flag.
// Server: always true (NOTEBOOK_JOURNAL_STYLES_ENABLED was retired as always on, 2026-11-04;
// auth.NOTEBOOK_ALWAYS_ON_KEYS), payload key below. ⛔ It gates CREATING (doors, the manager, /style, save-as-style, the update banner),
// never RENDERING a note that already holds a style's blocks (spec P1.7c).
import { notebookFlag } from './offline/notebookFlags'

export const JOURNAL_STYLES_FLAG = 'notebook_journal_styles_enabled'
export const journalStylesEnabled = () => notebookFlag(JOURNAL_STYLES_FLAG) === true
/** `/style` dispatches this on the editor's own DOM root; NoteEditorPage opens the style sheet. */
export const STYLE_EVENT = 'uct:notebook-journal-style'
/** Tier 2 part A: the slash menu's /plan, dispatched on the editor's own DOM root (I5). */
export const PLAN_EVENT = 'uct:notebook-plan'
