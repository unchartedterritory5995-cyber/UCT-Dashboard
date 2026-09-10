/**
 * Wave Q1 — spending the outbox: what the member wrote while the server was
 * unreachable, sent through the SAME compare-and-set note PUT everything else
 * uses.
 *
 * ⛔⛔ IT IS NOT A "SYNC ENGINE". Every entry is one note update carrying the
 * baseline it was written on. The server decides. There is no merge here, no
 * last-write-wins, and no clock comparison anywhere in this file.
 *
 * ⛔ AN ENTRY IS NEVER DISCARDED TO MAKE THE QUEUE DRAIN. A transient failure
 * leaves it queued. A 409 preserves BOTH versions — the server keeps its
 * revision and the local work becomes a real "(conflicted copy)" note, the same
 * vocabulary the connectors already gave members. A permanent 4xx (the note was
 * deleted, access was revoked) is recorded on the entry and RETIRED FROM
 * RETRYING, but the entry and its patch stay: unsynced member work outranks a
 * tidy queue.
 */
import { clearOutboxEntry, getNote, listOutbox, putNoteWithIntent } from './notebookDb'
import { usableBaseline, isUsableBaseline, landedBaseline, isSupersededBaseline } from './baseline'
import { sameAuthoredContent } from './recoverLocalState'

export const SENT = 'sent'
export const FORKED = 'forked'
export const KEPT = 'kept'          // transient — still queued, will be retried
export const BLOCKED = 'blocked'    // permanent — still stored, no longer retried
export const SKIPPED = 'skipped'    // the open editor owns this note right now
export const SUPERSEDED = 'superseded'  // a save this browser landed is newer; nothing left to send

/** Why a BLOCKED result carries a `report`. ⛔ The ONLY reason that does — the
 *  other two blocks (already-`permanent`, a non-transient server rejection) are
 *  understood failures with a `lastError` a human can read. This one is the
 *  unexplained defect the observation window is watching for. */
export const NO_BASELINE = 'no-baseline'

const isTransient = (e) => !e?.status || e.status >= 500

/**
 * The note caught up with the server — or did not, because it moved on while
 * the request was in flight. ⛔ Same rule as the editor's own ack path: an
 * acknowledgement of older words is not permission to forget newer ones.
 */
async function settleSent(db, entry, saved) {
  const rec = await getNote(db, entry.noteId)
  const caughtUp = !rec || sameAuthoredContent(rec, entry.patch)
  const baseUpdatedAt = usableBaseline(saved?.updatedAt, entry.baseUpdatedAt)
  const next = {
    noteId: entry.noteId,
    title: entry.patch?.title ?? '',
    subtitle: entry.patch?.subtitle ?? '',
    bodyJson: entry.patch?.bodyJson ?? null,
    generation: 0,
    sessionId: null,
    localSavedAt: Date.now(),
    ...(rec || {}),
    baseUpdatedAt,
    dirty: caughtUp ? 0 : 1,
  }
  // ⛔ The re-queued intent carries what the RECORD holds now, not the words
  // we just sent. Re-queuing `entry.patch` would make the next drain send the
  // stale version and lose whatever arrived while the request was in flight.
  const intent = caughtUp ? null : {
    ...entry,
    patch: { title: next.title, subtitle: next.subtitle, bodyJson: next.bodyJson },
    baseUpdatedAt,
    queuedAt: Date.now(),
  }
  await putNoteWithIntent(db, next, intent)
}

/** The fork landed: the local work is a real note now, and the durable copy
 *  should hold what the SERVER has rather than keep claiming to be an unsent
 *  edit of it. */
async function settleForked(db, entry, serverNote) {
  await putNoteWithIntent(db, {
    noteId: entry.noteId,
    title: serverNote?.title ?? '',
    subtitle: serverNote?.subtitle ?? '',
    bodyJson: serverNote?.bodyJson ?? null,
    baseUpdatedAt: usableBaseline(serverNote?.updatedAt),
    generation: 0,
    sessionId: null,
    localSavedAt: Date.now(),
    dirty: 0,
  }, null)
}

async function settleBlocked(db, entry, error) {
  const rec = await getNote(db, entry.noteId)
  await putNoteWithIntent(db, rec || {
    noteId: entry.noteId,
    title: entry.patch?.title ?? '',
    subtitle: entry.patch?.subtitle ?? '',
    bodyJson: entry.patch?.bodyJson ?? null,
    baseUpdatedAt: usableBaseline(entry.baseUpdatedAt),
    dirty: 1,
  }, {
    ...entry,
    // ⛔ Kept, not deleted. Retired from retrying, so the queue does not spin on
    // something that cannot succeed — and still holding every word.
    permanent: true,
    lastError: String(error?.message || error || 'rejected'),
    lastStatus: error?.status ?? null,
    attempts: (entry.attempts || 0) + 1,
  })
}

/**
 * @param send  async (entry) => savedNote — the compare-and-set PUT
 * @param fork  async (entry) => serverNote — preserve BOTH versions and return
 *              the server's, so the durable copy can stop claiming to be unsent
 * @param excludeNoteId  the note the editor currently owns. ⛔ Two writers on
 *              one note is the last-write-wins this wave exists to forbid; the
 *              open note is the editor's to save, never the sweep's.
 */
export async function drainOutbox(db, { send, fork, excludeNoteId = null } = {}) {
  const entries = await listOutbox(db)
  const results = []
  for (const entry of entries) {
    if (excludeNoteId && entry.noteId === excludeNoteId) {
      results.push({ mutationId: entry.mutationId, noteId: entry.noteId, outcome: SKIPPED })
      continue
    }
    if (entry.permanent) {
      results.push({ mutationId: entry.mutationId, noteId: entry.noteId, outcome: BLOCKED })
      continue
    }
    // ⛔⛔ A WRITE THAT CANNOT PROVE IT IS NOT CLOBBERING IS NEVER SENT.
    //
    // `baseUpdatedAt` IS the compare-and-set, and `sendNoteUpdate` omits the
    // field when it is falsy — so a queued entry with no baseline would go out
    // as a PUT with no CAS at all, and the server would apply it over whatever
    // is there. Every `note-update` targets a note that already has a server
    // revision, so there is no legitimate baseline-less entry to protect.
    //
    // ⛔ Blocked, not deleted, and not retried: the same posture as `permanent`.
    // The member's words stay on disk and stay visible; what stops is the one
    // action that could destroy someone else's. This is DEFENCE IN DEPTH — the
    // path that produced such an entry is fixed at its source in
    // `NoteEditorPage`'s `hydratedRef` — and it is here because the next
    // unforeseen path must fail this way too.
    if (!isUsableBaseline(entry.baseUpdatedAt)) {
      // ⭐ INSTRUMENTED, NOT HUNTED. Nine driven paths failed to reproduce this;
      // the production population is the only remaining witness. The DECISION is
      // made here, so the description of it is built here — a caller that
      // re-tested the baseline to decide whether to report would be a second
      // authority over one value and would disagree the day a third block
      // reason lands. The transport lives in the hook: this module has no
      // network and must not grow one.
      //
      // ⛔ It cannot double-report. An entry that is already `permanent` takes
      // the branch above and never reaches here, so `report` marks the
      // TRANSITION into blocked-for-no-baseline, exactly once per occurrence.
      // eslint-disable-next-line no-await-in-loop
      const rec = await getNote(db, entry.noteId)
      // eslint-disable-next-line no-await-in-loop
      await settleBlocked(db, entry, new Error('queued without a baseline — refusing to send a write with no compare-and-set'))
      results.push({
        mutationId: entry.mutationId,
        noteId: entry.noteId,
        outcome: BLOCKED,
        report: {
          reason: NO_BASELINE,
          noteId: entry.noteId,
          baseUpdatedAt: entry.baseUpdatedAt,
          generation: entry.generation ?? rec?.generation ?? null,
          sessionId: rec?.sessionId ?? entry.sessionId ?? null,
          queuedAt: entry.queuedAt ?? null,
          attempts: entry.attempts ?? 0,
        },
      })
      continue
    }
    // ⛔⛔ AN ENTRY OLDER THAN A SAVE THIS BROWSER ALREADY LANDED IS SUPERSEDED.
    //
    // Same posture as the baseline refusal above, for the same reason: a send
    // that cannot possibly succeed must not be attempted. The server has moved
    // past this baseline, so the PUT can only 409 — and a 409 forks, which is
    // how a member with ONE device gets a `(conflicted copy)` of their own note
    // and is told it "changed elsewhere" (measured 2026-09-10, ~1 offline
    // session in 5).
    //
    // ⭐ THIS IS DEFENCE IN DEPTH, NOT THE FIX. The fix is `settleLandedSave`,
    // which settles the queue the moment a save lands whether or not the editor
    // is still mounted. This closes the remaining ordering: the drain claims the
    // entry in the window between the unmount and the save resolving, so no
    // settle could have run yet. Both are needed; neither is redundant.
    //
    // ⛔ REMOVED, NOT KEPT. Unlike a blocked entry, there is nothing here to
    // recover: the record is clean and the server already holds this browser's
    // words. Keeping it would leave a permanent tombstone the drain re-examines
    // for ever.
    // eslint-disable-next-line no-await-in-loop
    const noteRec = await getNote(db, entry.noteId)
    const landed = landedBaseline(noteRec)
    if (isSupersededBaseline(entry.baseUpdatedAt, landed)) {
      // eslint-disable-next-line no-await-in-loop
      await clearOutboxEntry(db, entry.mutationId)
      results.push({
        mutationId: entry.mutationId,
        noteId: entry.noteId,
        outcome: SUPERSEDED,
        reason: `a save this browser landed at ${landed} is newer than this entry's baseline ${entry.baseUpdatedAt}`,
      })
      continue
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const saved = await send(entry)
      // eslint-disable-next-line no-await-in-loop
      await settleSent(db, entry, saved)
      results.push({ mutationId: entry.mutationId, noteId: entry.noteId, outcome: SENT })
    } catch (e) {
      if (e?.status === 409) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const serverNote = await fork(entry)
          // eslint-disable-next-line no-await-in-loop
          await settleForked(db, entry, serverNote)
          results.push({ mutationId: entry.mutationId, noteId: entry.noteId, outcome: FORKED })
        } catch (fe) {
          // The fork itself failed. ⛔ Leave the entry exactly where it was —
          // half a conflict resolution is worse than none.
          results.push({ mutationId: entry.mutationId, noteId: entry.noteId, outcome: KEPT, error: fe })
        }
        continue
      }
      if (isTransient(e)) {
        results.push({ mutationId: entry.mutationId, noteId: entry.noteId, outcome: KEPT, error: e })
        continue
      }
      // eslint-disable-next-line no-await-in-loop
      await settleBlocked(db, entry, e)
      results.push({ mutationId: entry.mutationId, noteId: entry.noteId, outcome: BLOCKED, error: e })
    }
  }
  return results
}

/** How much unsynced work is still queued, and how much of it can still move. */
export function summarize(results) {
  const count = (o) => results.filter((r) => r.outcome === o).length
  return {
    sent: count(SENT),
    superseded: count(SUPERSEDED),
    forked: count(FORKED),
    kept: count(KEPT),
    blocked: count(BLOCKED),
    skipped: count(SKIPPED),
  }
}
