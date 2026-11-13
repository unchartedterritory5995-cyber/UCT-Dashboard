/**
 * Where the active setups board lives and whether its door is open (wave 13 lane 13J's page;
 * the door was added by the finish program's NAV lane). Kept apart from the page, the same way
 * `myPlaybookLink.js` is, so the Daily brief and the command palette can link to the board without pulling the
 * board page (charts, the grid recipe) onto the Notebook's first-open path.
 */
import { notebookFlag } from './offline/notebookFlags'

export const SETUPS_BOARD_FLAG = 'notebook_setups_board_enabled'
export const SETUPS_BOARD_PATH = '/journal/notebook/setups'
/** The board's read (`GET`). One authority for the URL. (Research Home's Active setups box read it too, until
 *  go-live wave 1.) */
export const BOARD_URL = '/api/j2/setups-board'

/** The gate, as the auth payload latched it for this tab (absent = OFF). */
export function setupsBoardEnabled() {
  return notebookFlag(SETUPS_BOARD_FLAG) === true
}
