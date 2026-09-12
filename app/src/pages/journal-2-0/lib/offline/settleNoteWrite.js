/**
 * ⛔⛔ THE ONE WAY A NOTE REVISION IS LANDED. Call this after ANY write that
 * advances a note's `updatedAt`.
 *
 * ⚰️ WHY IT EXISTS — measured 2026-09-12, and it was live on production.
 *
 * Q1's record named "the FOUR doors — every path that advances `updatedAt`":
 * body, folder, ticker, tags. That list was derived from **what the canary
 * drove**, not from what the product does. Enumerating from the other side —
 * every server-side `update_note`/`updated_at` writer and every client write to
 * `/api/j2/notes/*` — found **six** client doors in **two** endpoint families:
 *
 *   · `POST /notes/{id}/hero`    HeroImagePicker, GlobalAddPositionProvider
 *   · `DELETE /notes/{id}/hero`  HeroImagePicker
 *   · `POST /notes/{id}/embeds`  AddPositionModal, captureTargets (Send to
 *                                Journal), importer/enrichment
 *
 * ⛔ Exactly ONE of them recorded its landing. The other five advanced the
 * server revision and told the drain nothing, so guard 2's `serverCopyIsOurs`
 * answered "not ours" about this browser's own write and forked the note. The
 * member's words are preserved (the fork carries them, tagged `sync-conflict`),
 * but the original loses the last offline stretch and the working copy empties.
 *
 * ⭐ THE FIX IS RECORDING, NOT SETTLING. `settleLandedSave` is an editor-only
 * optimisation that needs local state; recording the revision is what stops the
 * fork, needs no editor, and is safe everywhere. A door that only records costs
 * one drain cycle; a door that records nothing costs the member a duplicate.
 */
import { usableBaseline } from './baseline'
import { getCurrentAccountId } from './currentAccount'

/**
 * ⛔⛔ LOADED ON USE, NEVER ON IMPORT.
 *
 * ⚰️ 2026-09-12: this file imported `recordLandedRevision` at the top, and
 * `useDurableNote` does two things at MODULE SCOPE — it mints a session id with
 * `crypto.randomUUID` and takes a Web Lock for the life of the tab. Fourteen
 * doors now import this helper, so a static import meant the Notebook's trade
 * modal, its importer and its capture targets all took a Web Lock the moment
 * they were parsed, and in a plain (non-jsdom) test environment
 * `crypto.randomUUID` is undefined — so `createNoteViaApi` threw at import and a
 * member's successful price capture reported "Capture failed — try again".
 *
 * ⛔ A door that lands nothing is a defect. A door that cannot be IMPORTED is a
 * broken feature, so the cheap half must stay cheap: nothing loads until a
 * revision is actually being landed, which is the moment the durable layer is
 * genuinely needed anyway.
 */
async function landedRecorder() {
  const mod = await import('./useDurableNote')
  return mod.recordLandedRevision
}

/**
 * @param noteId   the note whose revision moved
 * @param note     the note object the endpoint returned (must carry `updatedAt`)
 * @param accountId optional — defaults to the signed-in account
 * @returns the landed revision string, or null when nothing was recorded
 *
 * ⛔ IT NEVER THROWS. A door that fails to record must not also fail the
 * member's action: the write already succeeded server-side, and refusing to
 * record costs one drain cycle, while throwing here would surface an error for
 * an operation that worked. `recordLandedRevision` already swallows its own
 * storage errors; this guards the argument shape.
 */
export async function settleNoteWrite(
  noteId, note, accountId = getCurrentAccountId(), { connect } = {},
) {
  // ⛔⛔ READING THE BODY IS PART OF THE BOOKKEEPING, SO IT LIVES HERE.
  //
  // ⚰️ 2026-09-12: every call site spelled out `(await res.json().catch(() =>
  // ({}))).note`, which looks safe and is not — `.catch` only handles a REJECTED
  // promise, so a response object whose `json` is missing throws a TypeError
  // synchronously, straight past the guard and into the caller's try/catch. In
  // `capturePriceToNotebook` that turned a SUCCESSFUL price capture into
  // "Capture failed — try again": the fact was created, the node was placed, the
  // revision moved, and the member was told it had not worked.
  //
  // ⭐ So `note` may be the note, a `{note}` envelope, or the Response itself,
  // and reading it can never throw. One authority, one idiom at fourteen doors.
  const resolved = typeof note?.json === 'function'
    ? await (async () => { try { return await note.json() } catch { return null } })()
    : note
  // ⛔ THROUGH THE ONE AUTHORITY. `??` would keep `''` — a value that reads as
  // a baseline to a producer and as absent to a consumer, which is the defect
  // `baseline.js` exists to kill.
  const updatedAt = usableBaseline(resolved?.updatedAt, resolved?.note?.updatedAt)
  // ⛔ NO ACCOUNT ⇒ NO WRITE, AND NO DATABASE OPENED. A stale or absent id must
  // never reach `connectNotebookDb`, because the store is named per account and
  // the failure mode is a write landing in the PREVIOUS member's database. The
  // rail asserts the store name, not just that this returned null.
  if (!noteId || !updatedAt || !accountId) return null
  // ⭐ The `connect` seam is threaded through so a rail can DRIVE this against a
  // fake store. Without it the helper could only ever be asserted about, not
  // exercised — and a helper that cannot be driven is a helper whose rails prove
  // nothing (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
  const recordLandedRevision = await landedRecorder()
  return recordLandedRevision(connect
    ? { accountId, noteId, updatedAt, connect }
    : { accountId, noteId, updatedAt })
}

/**
 * ⛔⛔ THE BATCH DOORS — ONE CALL, MANY REVISIONS.
 *
 * Two of the seven advancing functions move MANY notes at once, and until
 * 2026-09-12 both were warn-listed exceptions on the grounds that "there is no
 * revision for this browser to land". That was true of the RESPONSE, not of the
 * world: the revisions existed, the browser was simply never told them. Both
 * endpoints now return them, so both are ordinary doors.
 *
 *   DELETE /note-folders/{id}   -> {ok, moved: [{noteId, updatedAt}]}
 *   POST   /notes/import/confirm -> {created|updated: [{id, updatedAt}]}
 *
 * ⭐ SEQUENTIAL, NOT `Promise.all`. Every one of these writes the SAME landed
 * ring, in the same IndexedDB, for the same account. Firing N concurrent
 * read-modify-write cycles at one key is how a ring silently loses entries —
 * and losing one is exactly the defect this whole mechanism exists to prevent.
 * A folder delete is a rare, member-initiated act; N sequential settles cost
 * nothing anyone can perceive.
 *
 * ⛔ It never throws, for the same reason the single-note form never throws:
 * the writes already succeeded server-side.
 *
 * @param revisions iterable of {noteId|id, updatedAt}
 * @returns the revisions actually landed
 */
export async function settleNoteWrites(
  revisions, accountId = getCurrentAccountId(), { connect } = {},
) {
  const landed = []
  for (const r of revisions || []) {
    const noteId = r?.noteId ?? r?.id ?? null
    // eslint-disable-next-line no-await-in-loop
    const got = await settleNoteWrite(noteId, r, accountId, { connect })
    if (got) landed.push({ noteId, updatedAt: got })
  }
  return landed
}
