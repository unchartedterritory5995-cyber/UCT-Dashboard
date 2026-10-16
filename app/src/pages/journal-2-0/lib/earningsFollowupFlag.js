/**
 * Tier 2 part B (R-T2B-5): the earnings follow-up card. An ENABLEMENT gate: unset means off. Latched
 * per tab like every Notebook capability (offline/notebookFlags.js).
 */
import { notebookFlag } from './offline/notebookFlags'

export const EARNINGS_FOLLOWUP_FLAG = 'notebook_earnings_followup_enabled'

export function earningsFollowupEnabled() {
  return notebookFlag(EARNINGS_FOLLOWUP_FLAG) === true
}
