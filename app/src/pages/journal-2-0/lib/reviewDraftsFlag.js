// Wave 13 lane 13F's flag, on its own (wave 14 perf lane, docs/notebook/wave14-perf.md).
//
// Research Home asks "is the review-drafts box on?" on every render, and before this split
// the question pulled all of `reviewDrafts.js` (the doc builder, ~6.6 kB minified) into the
// Notebook's first open for every member, flag on or off. The ONE authority for the flag's
// name and its reading lives here; `reviewDrafts.js` re-exports both unchanged, so every
// existing import (and every `vi.mock('../lib/reviewDrafts')`) keeps working.
import { notebookFlag } from './offline/notebookFlags'

export const REVIEW_DRAFTS_FLAG = 'notebook_review_drafts_enabled'

export function reviewDraftsEnabled() {
  return notebookFlag(REVIEW_DRAFTS_FLAG) === true
}
