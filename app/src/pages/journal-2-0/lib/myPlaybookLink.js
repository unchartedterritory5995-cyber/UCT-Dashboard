/**
 * Wave 13 lane 13B — where My Playbook lives and whether its door is open. Kept apart from the page
 * so a door (Insights > Playbook) can link to it without pulling the page into its own chunk.
 */
import { notebookFlag } from './offline/notebookFlags'

export const PLAYBOOK_FLAG = 'notebook_playbook_enabled'
export const PLAYBOOK_PATH = '/journal-2-0/playbook'

/** The gate, as the auth payload latched it for this tab (absent = OFF). */
export function playbookEnabled() {
  return notebookFlag(PLAYBOOK_FLAG) === true
}
