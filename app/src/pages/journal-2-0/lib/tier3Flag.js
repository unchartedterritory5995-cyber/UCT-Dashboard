/**
 * P2 Tier 3: the switch for the mood check-in block, the By check-in psychology view, Checklist
 * from my winners and the Your trading year door. An ENABLEMENT gate: unset means off. Latched per
 * tab like every Notebook capability (offline/notebookFlags.js).
 *
 * It gates CREATING, never rendering: a check-in block already in a note renders whatever this says.
 */
import { notebookFlag } from './offline/notebookFlags'

export const TIER3_FLAG = 'journal_tier3_enabled'

export function tier3Enabled() {
  return notebookFlag(TIER3_FLAG) === true
}

/**
 * The block ids this switch gates. ONE list, here: the style editor and the slash menu ask
 * `isTier3Block(id)` and never copy the ids, so a second Tier 3 block is added in one place.
 */
const TIER3_BLOCK_IDS = Object.freeze(['moodCheckIn'])

export function isTier3Block(id) {
  return typeof id === 'string' && TIER3_BLOCK_IDS.includes(id)
}
