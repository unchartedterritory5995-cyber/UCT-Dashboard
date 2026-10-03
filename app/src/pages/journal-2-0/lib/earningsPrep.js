/**
 * Wave 13 lane 13C -- earnings prep that writes itself (WAVE-13-PLAN.md, A.13C).
 *
 * Phase 1 (13C-1) built this whole file: the facts (`requestPrepDraft`), the body
 * (`buildPrepDoc`) and the ONE click that turns the two into a note (`createEarningsPrepNote`).
 *
 * Phase 2 (13C-2) moved everything EXCEPT the click into `earningsPrepShared.js`, so the
 * catalog's manually-started "Earnings Prep" template (`lib/notebookTemplates.js`) can read the
 * same facts and the same body -- never a second, hand-typed scaffold. This file re-exports that
 * shared module whole, so every existing caller (`ReportingSoon.jsx`,
 * `TickerResearchWorkspace.jsx`, `earningsPrep.test.js`) keeps importing from here unchanged.
 *
 * ⛔ NEVER CREATES A NOTE ON ITS OWN (decision R5). The only caller of
 * `createEarningsPrepNote` is a button a member pressed; nothing here runs on a schedule, a
 * mount or a poll. The note goes through `createNoteViaApi`, the door every creation uses, and
 * its answer is landed with `settleNoteWrite` before the editor that opens it can meet it.
 */
import { createNoteViaApi } from './noteCreation'
import { settleNoteWrite } from './offline/settleNoteWrite'
import { PREP_TAGS, prepTitle, buildPrepDoc, requestPrepDraft } from './earningsPrepShared'

export * from './earningsPrepShared'

/**
 * ⛔ THE CLICK. Draft (one of the member's daily drafts), build, create through the one
 * create door, land the revision. Throws with the server's own sentence on a refusal (the
 * daily cap answers 429 with a sentence written for the member).
 */
export async function createEarningsPrepNote({ symbol, folderId } = {}) {
  const draft = await requestPrepDraft(symbol)
  const created = await createNoteViaApi({
    title: prepTitle(draft),
    bodyJson: buildPrepDoc(draft),
    tags: [...PREP_TAGS],
    ticker: draft.symbol,
    ...(folderId ? { folderId } : {}),
  })
  await settleNoteWrite(created?.id ?? null, created)
  return created
}
