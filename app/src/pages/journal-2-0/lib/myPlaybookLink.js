/**
 * Wave 13 lane 13B — where My Playbook lives and whether its door is open. Kept apart from the page
 * so a door (Insights > Playbook) can link to it without pulling the page into its own chunk.
 */
import { notebookFlag } from './offline/notebookFlags'

export const PLAYBOOK_FLAG = 'notebook_playbook_enabled'
export const PLAYBOOK_PATH = '/journal-2-0/playbook'
/** S13 (audit 2026-11-05, detail #67): the same page INSIDE the Journal shell, reached from the Notebook's sidebar,
 *  with the Journal tabs above it and "Back to Notebook". Its data is the same read; nothing moved. */
export const PLAYBOOK_IN_NOTEBOOK_PATH = '/journal/notebook/playbook'

/** The gate, as the auth payload latched it for this tab (absent = OFF). */
export function playbookEnabled() {
  return notebookFlag(PLAYBOOK_FLAG) === true
}
