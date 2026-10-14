/**
 * Tier 2 part A (R-T2A-11): the alert chip and the screenshot chip. An ENABLEMENT gate:
 * unset means off. Latched per tab like every Notebook capability (offline/notebookFlags.js).
 */
import { notebookFlag } from './offline/notebookFlags'

export const SMART_CHIPS_FLAG = 'notebook_smart_chips_enabled'

export function smartChipsEnabled() {
  return notebookFlag(SMART_CHIPS_FLAG) === true
}
