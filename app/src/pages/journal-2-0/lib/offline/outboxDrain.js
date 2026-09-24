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
import {
  clearOutboxEntry, getMeta, getNote, listOutbox, putNoteWithIntent, putNoteWithIntentIf,
} from './notebookDb'
import { usableBaseline, isUsableBaseline, landedBaseline, isSupersededBaseline } from './baseline'
import { isMarkerLive, markerKeyFor, landedKeyFor, IN_FLIGHT_TTL_MS } from './inFlight'
import { baseMayStandFor, sameAuthoredContent } from './recoverLocalState'
import {
  APPEND_ONLY, BODY_REWRITE, METADATA_ONLY, appendedServerNodes, classifyServerChange,
  lastKnownServerCopy, missingServerNodes, serverAppendedKeysIn, snapshotOfServerCopy,
} from './serverChange'

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
    // ⛔ AFTER the spread, never inside it: the record's own `serverBase` is
    // now stale — the server has just accepted these words at this revision.
    serverBase: caughtUp ? null : snapshotOfServerCopy(saved, baseUpdatedAt),
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
  return settleForkedNote(db, entry.noteId, serverNote)
}

/**
 * ⭐ D3 / F5P-1 — THE SAME SETTLE, FOR THE NOTE'S OWNER. Exported so the open
 * editor, which now sends its note's queued work itself, settles its fork with
 * THIS code rather than a second copy of it. ⛔ No behaviour change for the
 * sweep: `settleForked` above is this, by note id.
 *
 * ⚰️ Without it the owner's fork left the durable record dirty with a queued
 * entry the sibling already preserved, and the sweep forked it AGAIN once the
 * note closed — two `(conflicted copy)` notes for one conflict.
 */
export async function settleForkedNote(db, noteId, serverNote, { forked } = {}) {
  // ⛔⛔ A FORK MUST NEVER EMPTY THE WORKING COPY.
  //
  // ⚰️ Every field below falls back to `''` or `null`, so a `fork` that
  // resolved without a usable server note — a 200 with no `note` key, a shape
  // change, a caller returning the CREATED note instead of the server's —
  // wrote a record with no title and no body, marked it `dirty: 0`, and cleared
  // the intent. The member's words were safe in the `(conflicted copy)` sibling,
  // but the note they had open went BLANK, and a clean record is not a recovery
  // candidate, so the banner would never offer the local copy back either.
  //
  // ⛔ The queue is still settled — the fork DID happen and the entry is owed to
  // nobody now — but the content stays exactly as it was. An honest stale body
  // beats an empty one; the next open re-reads the server anyway.
  const usable = serverNote && (serverNote.bodyJson != null || serverNote.title != null)
  if (forked !== undefined) return settleForkedIfUnmoved(db, noteId, serverNote, usable, forked)
  if (!usable) {
    const rec = await getNote(db, noteId)
    if (rec) await putNoteWithIntent(db, forkSettledRecord(noteId, serverNote, usable, rec), null)
    return
  }
  await putNoteWithIntent(db, forkSettledRecord(noteId, serverNote, usable, null), null)
}

/** What a settled fork leaves in the durable record — ONE composition, used by
 *  the sweep's settle and the owner's. Null when there is nothing to write. */
function forkSettledRecord(noteId, serverNote, usable, rec) {
  if (!usable) return rec ? { ...rec, dirty: 0, serverBase: null } : null
  return {
    noteId,
    title: serverNote?.title ?? '',
    subtitle: serverNote?.subtitle ?? '',
    bodyJson: serverNote?.bodyJson ?? null,
    baseUpdatedAt: usableBaseline(serverNote?.updatedAt),
    generation: 0,
    sessionId: null,
    localSavedAt: Date.now(),
    dirty: 0,
    // ⛔ Clean ⇒ the record IS the base. Carrying a stale snapshot past a fork
    // would let the next conflict classify against a document nobody holds.
    serverBase: null,
  }
}

/**
 * ⭐⭐ D3b (wave 6) — THE OWNER'S FORK SETTLE, CHECKED AND WRITTEN IN ONE
 * TRANSACTION. Amendment D3b in `f5Freeze.test.js`; `f5-fixes-2026-09-23.md` §F.
 *
 * `forked` is exactly what the `(conflicted copy)` sibling holds. The settle is
 * only safe while the record, and every queued entry for the note, still hold
 * exactly that — anything else is a word the sibling does not have. Wave 5
 * checked it in `settleOwnerFork` and then called the settle above: two reads
 * and a write, three transactions, and a durable write landing after the last
 * read was overwritten and its entry deleted. `putNoteWithIntentIf` makes the
 * check and the write one readwrite transaction, so there is no "after the
 * check" for a write to land in.
 *
 * ⛔ The sweep never passes `forked` and keeps the path above, unchanged.
 * @returns true when settled · false when refused (the store moved on)
 */
function settleForkedIfUnmoved(db, noteId, serverNote, usable, forked) {
  if (!forked) return Promise.resolve(false)
  return putNoteWithIntentIf(db, noteId, (rec, queued) => {
    if (rec && !sameAuthoredContent(rec, forked)) return null
    if (queued.some((e) => !sameAuthoredContent(e?.patch, forked))) return null
    return { record: forkSettledRecord(noteId, serverNote, usable, rec), intent: null }
  })
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
 * ⛔⛔ ASK THE SERVER WHETHER THE COPY THAT BLOCKS US IS OUR OWN.
 *
 * ⭐ ONE IMPLEMENTATION, TWO CALL SITES, deliberately — a guard repeated is a
 * guard unproved, and two copies of this decision would drift the day the
 * definition of "ours" changes.
 *
 * ⛔ A THROW IS NOT "NOT OURS". The caller must treat a failure as unknown and
 * take the preserving branch: a spurious duplicate is recoverable by the
 * member, a dropped write is not.
 */
/**
 * The ring vouched for this revision — now what? Q1 fix 3, owner ruling 2026-09-13.
 *
 * ONE AUTHORITY, TWO CALL SITES. This decision is taken twice — once BEFORE
 * sending (an expired in-flight marker turned out to be ours) and once on a 409
 * — and both used to answer it the same wrong way: rebase and resend the queued
 * body. Two copies of a decision drift the day it changes, and this one just did.
 *
 * WHAT IT COST: "ours => rebase" ran before the diff was ever read, so when the
 * server's change was an APPEND (a widget sent to the journal, a saved price, a
 * PDF excerpt) the member's queued body was re-sent over it and the captured
 * block was gone. The append-only merge existed and was UNREACHABLE for any door
 * this browser fired, because a door we fired is always in the landed ring.
 * Measured across seven families x six orderings: 24/24 metadata green, 0/18
 * append.
 *
 * THE RING IS NOT WEAKENED. It still answers "we made this revision", which is
 * what stops the spurious fork; it simply stops DECIDING before the diff is read.
 *
 * @returns plan 'merge'  - the server's only change was blocks it appended itself
 *               'rebase' - metadata-only, or no evidence to classify with
 *               'fork'   - the body was rewritten and appends cannot be proven,
 *                          or the only base is NEWER than the entry (D3b, residual c)
 */
function ringVouchedPlan(mine, noteRec, entry) {
  const { base, poisoned } = classifiableBase(entry, noteRec)
  // ⛔⛔ D3b fix round 1, residual (c) — A POISONED BASE IS NOT "NO EVIDENCE".
  // With no base at all the ring's vouch still stands, and the rebase below is
  // what this code did before the classification was hoisted. A base NEWER than
  // the entry is different in kind: it is evidence that the record moved past
  // the revision the words were written on, and diffing against it hides exactly
  // the change between the two (a door's appended block reads as "no change").
  // Unknown, so preserve both: FORK.
  if (poisoned) return { plan: 'fork', base: null, shape: BODY_REWRITE }
  // NO EVIDENCE IS NOT BODY-REWRITE *HERE*. classifyServerChange answers
  // BODY_REWRITE with no base, because for an UNVOUCHED revision "missing
  // evidence is never a licence to merge". But the ring HAS vouched: we made
  // this revision, so forking on absent evidence would manufacture the very
  // "(conflicted copy)" the ring exists to prevent. With no base, behave exactly
  // as this code did before the classification was hoisted above it.
  if (!mine?.serverNote || !base) return { plan: 'rebase', base: null, shape: null }
  const shape = classifyServerChange(mine.serverNote, base)
  if (shape === APPEND_ONLY) return { plan: 'merge', base, shape }
  if (shape === BODY_REWRITE) return { plan: 'fork', base, shape }
  return { plan: 'rebase', base, shape }
}

/**
 * ⭐⭐ D3b fix round 1, residual (c) — THE ONE PLACE THE DRAIN READS THE BASE IT
 * CLASSIFIES AGAINST (controller ruling: amendment D3b, `f5Freeze.test.js`).
 *
 * ⚰️ THE DEFECT, pre-existing and reached by a closed note: a record settled
 * BEFORE A-1 carries `acked@landed` as its base — a copy that already holds a
 * door's appended block — while its queued entry still sits on the OLDER revision
 * the words were written on. The drain classified the server's copy against that
 * base, read METADATA_ONLY (the block is on both sides), rebased the queued body
 * onto the server's revision and sent it: a 200, and the block was gone. Recovery
 * has refused such a base since review N4 (`baseOfRecovered`); the drain had not.
 *
 * ⛔ SO A BASE THAT MAY NOT STAND FOR THE ENTRY IS NOT CLASSIFIED AGAINST — it is
 * UNKNOWN, and both call sites fork: the ring-vouched plan says so (`poisoned`),
 * and the diff branch classifies against `null`, which the frozen classifier
 * reads as BODY_REWRITE ("missing evidence is never a licence to merge").
 * ⭐ `baseMayStandFor` decides, and it is the SAME function `baseOfRecovered`
 * asks — so recovery and the sweep cannot disagree about which base is poison.
 * An equal base is the ordinary shape; an OLDER one is legitimate and can only
 * see MORE change (fix round 3, N4-b); a NEWER one, or one whose revision cannot
 * be ordered, is refused.
 * ⚠️ The legitimate drain-rebase shape (§E.1) is newer too and cannot be told
 * apart by direction, so it now forks where it rebased: a spurious duplicate,
 * never a loss — the same trade recovery made.
 */
function classifiableBase(entry, noteRec) {
  const base = lastKnownServerCopy(noteRec)
  if (!base) return { base: null, poisoned: false }
  if (baseMayStandFor(base.updatedAt, entry?.baseUpdatedAt)) return { base, poisoned: false }
  return { base: null, poisoned: true }
}


/**
 * Move a queued entry onto a newer baseline WITHOUT touching its content.
 *
 * ⛔⛔ THE ENTRY'S WORDS ARE NOT NEGOTIABLE. Only `baseUpdatedAt` moves. This is
 * the difference between "the member's edit will now succeed" and "the member's
 * edit is gone", and on 2026-09-10 the code took the second branch.
 *
 * ⛔ The note RECORD is written back unchanged — `putNoteWithIntent` needs one,
 * and inventing a record here would overwrite the durable working copy with a
 * reconstruction of the patch.
 */
async function rebaseEntry(db, entry, baseUpdatedAt, serverBase = undefined) {
  const rec = await getNote(db, entry.noteId)
  const next = { ...entry, baseUpdatedAt, queuedAt: Date.now() }
  // ⛔ `undefined` means "leave it alone" — the ring-based rebase learns a
  // revision but never sees the server's document, so it has nothing to record
  // and must not erase what the record already knew.
  const rec2 = rec && serverBase !== undefined ? { ...rec, serverBase } : rec
  if (rec2) await putNoteWithIntent(db, rec2, next)
  return next
}

/** Put the server's appended blocks at the end of a document, without touching
 *  a single one of the member's own.
 *
 * ⛔ Returns null when the document is not one this can safely extend. Null
 * means "cannot merge" and the caller forks — it never means "nothing to do".
 */
function withAppends(bodyJson, nodes) {
  if (!bodyJson || typeof bodyJson !== 'object' || !Array.isArray(bodyJson.content)) return null
  const missing = missingServerNodes(nodes, serverAppendedKeysIn(bodyJson))
  if (!missing.length) return bodyJson
  return { ...bodyJson, content: [...bodyJson.content, ...missing] }
}

/**
 * ⭐⭐ THE APPEND-ONLY MERGE. The server appended blocks of its own; the member
 * has words we still owe it. Both survive, and nothing here is a guess: the
 * classifier PROVED the server's only change was those appends.
 *
 * ⛔⛔ THE RECORD GETS THEM TOO, AND SEPARATELY. `settleSent` re-queues the
 * RECORD's words whenever they are ahead of what was just acknowledged — so a
 * merge that only touched the outbox entry would be undone by the very next
 * drain, which would send a body with the appends stripped back out. Each
 * document keeps its own words and gains the same blocks.
 */
async function mergeAppends(db, entry, appended, baseUpdatedAt, serverBase) {
  const patchBody = withAppends(entry.patch?.bodyJson, appended)
  if (!patchBody) return null
  const rec = await getNote(db, entry.noteId)
  const next = {
    ...entry,
    patch: { ...entry.patch, bodyJson: patchBody },
    baseUpdatedAt,
    queuedAt: Date.now(),
  }
  if (rec) {
    const recBody = withAppends(rec.bodyJson, appended)
    // ⛔ A record this cannot extend is not a reason to abandon the merge — the
    // entry is what goes on the wire. It IS a reason not to rewrite the record.
    await putNoteWithIntent(db, recBody ? { ...rec, bodyJson: recBody, serverBase } : { ...rec, serverBase }, next)
  }
  return next
}

/** D3b — the owner-lock answer, where "unknown" is never "owned": no predicate,
 *  a null, or a throw all leave the decision to `excludeNoteId`, as before. */
async function ownedByAnEditor(noteIsOwned, noteId) {
  if (typeof noteIsOwned !== 'function') return false
  try { return (await noteIsOwned(noteId)) === true } catch { return false }
}

const ownedSkip = (entry) => ({
  mutationId: entry.mutationId,
  noteId: entry.noteId,
  outcome: SKIPPED,
  reason: 'the note is open in an editor (its owner lock is held) — the owner sends it',
})

async function askServerIfOurs(db, entry, serverCopyIsOurs) {
  if (!serverCopyIsOurs) return null
  const landedRevisions = new Set(await getMeta(db, landedKeyFor(entry.noteId)) || [])
  return serverCopyIsOurs(entry, { landedRevisions })
}

/**
 * @param send  async (entry) => savedNote — the compare-and-set PUT
 * @param fork  async (entry) => serverNote — preserve BOTH versions and return
 *              the server's, so the durable copy can stop claiming to be unsent
 * @param excludeNoteId  the note the editor currently owns. ⛔ Two writers on
 *              one note is the last-write-wins this wave exists to forbid; the
 *              open note is the editor's to save, never the sweep's.
 */
export async function drainOutbox(db, {
  send, fork, excludeNoteId = null,
  // ⛔ The sessionIds currently holding the sync Web Lock, or null when the
  // caller cannot enumerate them. null means "the TTL decides alone" — never
  // "nobody holds it", which would expire every live marker instantly.
  holders = null,
  ttlMs = IN_FLIGHT_TTL_MS,
  // async (entry) => {ours: boolean, why: string}. Asks the SERVER whether the
  // copy that caused a 409 is this browser's own landed save. Absent ⇒ the
  // check is skipped and a 409 forks, which is the pre-existing behaviour.
  serverCopyIsOurs = null,
  // ⭐ D3b (wave 6) — async (noteId) => true | false | null: is this note OPEN
  // IN AN EDITOR in any tab (its per-note owner Web Lock is held)? The owner
  // sends its own queued work (F5P-1), so a sweep that sent it too would be the
  // second writer. Absent, or a null / throw ⇒ unknown ⇒ `excludeNoteId` alone
  // decides, exactly as before. Amendment D3b in `f5Freeze.test.js`.
  noteIsOwned = null,
} = {}) {
  const entries = await listOutbox(db)
  const results = []
  for (let entry of entries) {
    // Per-entry, reset every iteration: a rebase in one entry must not
    // suppress a rebase in the next.
    let rebased = null
    let retriedRebase = false
    // ⭐ Reported, so an operator reading the drain result can tell a plain
    // rebase from a merge that carried the server's appended blocks back.
    let appendMerged = false
    // ⭐ D3b fix round 1 (review N-5) — A BLOCKED ENTRY REPORTS BLOCKED, WHOEVER
    // HAS ITS NOTE OPEN. This branch only REPORTS: it sends nothing, asks nothing
    // and writes nothing, so it is safe ahead of both "the editor owns it" skips.
    // ⚰️ Behind them, a blocked entry read SKIPPED whenever its note was open —
    // in this tab (`excludeNoteId`) or, since D3b, in any tab (the owner lock) —
    // so the same entry's status depended on which tab happened to lead, and
    // `summarize().blocked` undercounted exactly while the member was looking.
    if (entry.permanent) {
      results.push({ mutationId: entry.mutationId, noteId: entry.noteId, outcome: BLOCKED })
      continue
    }
    if (excludeNoteId && entry.noteId === excludeNoteId) {
      results.push({ mutationId: entry.mutationId, noteId: entry.noteId, outcome: SKIPPED })
      continue
    }
    // ⛔⛔ D3b — `excludeNoteId` IS PER MOUNT, AND THE LEADER MAY BE ANOTHER TAB.
    // A note open in tab A while tab B leads was sent by B's sweep while A's
    // editor was still its writer: the owner's own send then 409'd against its
    // own words and forked the member's note. The owner lock is per NOTE, so
    // whichever tab leads can see it. SKIPPED, not blocked — nothing is wrong
    // with the entry; it is the owner's to send, and the sweep's once it closes.
    // eslint-disable-next-line no-await-in-loop
    if (await ownedByAnEditor(noteIsOwned, entry.noteId)) {
      results.push(ownedSkip(entry))
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

    // ⛔⛔ A SAVE IS ON THE WIRE FOR THIS NOTE — DO NOT CLAIM IT.
    //
    // ⚰️ This is the guard that had to exist, because the one below CANNOT do
    // this job. The supersede refusal asks `landedBaseline`, which refuses a
    // DIRTY record — correctly — and in the window between issuing a PUT and
    // its resolving, the record IS dirty. So the answer was always "not
    // superseded" and the drain sent on a baseline the server had already
    // passed: 409, fork, and a single-device member told their note "changed
    // elsewhere". Two guards that share a precondition are one guard.
    //
    // ⭐ THE MARKER IS DIFFERENT IN KIND: it records that we ASKED, before we
    // asked. That is the one fact the drain could never derive for itself,
    // because it lived in an in-flight promise inside a component that may
    // already be unmounted.
    //
    // ⛔ SKIPPED, NOT BLOCKED. Nothing is wrong with this entry — it is simply
    // not this sweep's turn. The next drain picks it up.
    // eslint-disable-next-line no-await-in-loop
    const marker = await getMeta(db, markerKeyFor(entry.noteId))
    if (isMarkerLive(marker, { holders, ttlMs })) {
      results.push({
        mutationId: entry.mutationId,
        noteId: entry.noteId,
        outcome: SKIPPED,
        reason: `a save started at ${new Date(marker.startedAt).toISOString()} is still in flight`,
      })
      continue
    }

    // ⛔⛔ AN EXPIRED MARKER IS NOT PERMISSION TO SEND — IT IS A QUESTION.
    //
    // A marker that exists but has aged out means a save WAS on the wire and we
    // cannot tell from here whether it landed. The local record cannot answer:
    // it is still dirty, so `landedBaseline` refuses it, which is the whole
    // reason the supersede check below cannot cover this case.
    //
    // ⚰️ THE ORDERING THIS CLOSES, which sending blind does not:
    //   the PUT is slower than the TTL → the marker expires → the drain sends →
    //   the slow PUT lands FIRST → the drain's send 409s → fork. One device, a
    //   duplicate of the member's own note, and a slow network was the only
    //   cause.
    // ⛔ The server is asked BEFORE the send, and asked AGAIN on a 409 — because
    // the answer can change in between, which is exactly what happens when the
    // slow PUT lands during our request.
    if (marker && serverCopyIsOurs) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const mine = await askServerIfOurs(db, entry, serverCopyIsOurs)
        if (mine?.ours && mine.identical) {
          // ⛔ REMOVED ONLY BECAUSE THE SERVER BODY IS PROVEN TO CONTAIN THESE
          // WORDS. Sending again could not change anything.
          // eslint-disable-next-line no-await-in-loop
          await clearOutboxEntry(db, entry.mutationId)
          results.push({
            mutationId: entry.mutationId,
            noteId: entry.noteId,
            outcome: SUPERSEDED,
            reason: `an expired in-flight save turned out to have landed (${mine.why}) — removed, not sent`,
          })
          continue
        }
        if (mine?.ours && mine.serverUpdatedAt) {
          // ⭐⭐ OURS, BUT THE SERVER DOES NOT HAVE THESE WORDS ⇒ BUILD ON IT.
          //
          // ⚰️ This branch is the fix for the door case, and its absence cost a
          // member their offline sentence: a folder change moved the revision,
          // the ring said "ours", and the entry was DELETED with its words
          // unsent. "Ours" tells us the revision is safe to build on — nobody
          // else wrote it — which is a reason to REBASE, never a reason to drop.
          //
          // ⛔⛔ AND *WHAT* TO BUILD DEPENDS ON THE DIFF, NOT ON THE RING.
          // Rebasing unconditionally re-sent the queued body over a server copy
          // that had grown its own appended block — the widget the member had
          // just captured — and this path never 409s, so nothing downstream
          // could catch it. `ringVouchedPlan` is the one authority; the 409
          // handler below asks it the same question.
          const ring = ringVouchedPlan(mine, noteRec, entry)
          if (ring.plan === 'merge') {
            // eslint-disable-next-line no-await-in-loop
            const mergedEntry = await mergeAppends(
              db, entry, appendedServerNodes(mine.serverNote, ring.base),
              mine.serverUpdatedAt, snapshotOfServerCopy(mine.serverNote, mine.serverUpdatedAt),
            )
            if (mergedEntry) {
              entry = mergedEntry
              rebased = mine.serverUpdatedAt
              appendMerged = true
            }
          } else if (ring.plan === 'rebase') {
            // eslint-disable-next-line no-await-in-loop
            entry = await rebaseEntry(db, entry, mine.serverUpdatedAt)
            rebased = mine.serverUpdatedAt
          }
          // ⛔ 'fork' rebases NOTHING and sends as it stands: the stale baseline
          // earns a 409, and the 409 path preserves both copies. Forking here
          // would duplicate that decision in a second place.
        }
      } catch {
        // ⛔ Unknown, not "not ours". Fall through and send; a 409 will ask again.
      }
    }

    const landed = landedBaseline(noteRec)
    // ⛔⛔ A CLOCK IS NOT PROOF THE WORDS ARRIVED. `isSupersededBaseline` is
    // `ta < tb` over two timestamps and nothing more, yet clearing here reports
    // "a save this browser landed is newer", which a reader takes to mean THE
    // SERVER ALREADY HAS THESE WORDS.
    //
    // ⚰️ MEASURED ON PRODUCTION, five cells, 2026-09-14 — and again on the same
    // route the day before. The member sends a widget embed to a note while
    // offline with words queued. The door's `settleNoteWrite` records the
    // server's new revision in the landed ring (correctly — it is ours), the
    // editor remounts from the server copy and the record reconciles CLEAN at
    // that newer revision, and this test then fires on a landed save whose body
    // is the SERVER's: the appended block, without the member's sentence. The
    // entry was cleared and the words were never sent. `appended node present:
    // True · offline sentence in the server body: False`.
    //
    // ⭐ WHAT NORMALLY PROTECTS THIS, AND WHY IT STOPPED. `landedBaseline`
    // refuses a DIRTY record, so while the editor is mounted the queued entry is
    // its own pending state and the invariant holds. Q1 fix 4 keeps a record
    // with unsent work dirty — but only where IT decides; a door that reconciles
    // the record clean by another path lands here with the protection already
    // gone.
    //
    // ⭐ THE QUESTION THE CONTENT CAN ANSWER: does the landed save actually hold
    // what this entry is carrying? `sameAuthoredContent` is the ONE authority on
    // that (recovery and the ack path both use it), and it is already imported.
    //
    // ⛔ STRICT EQUALITY IS THE CONSERVATIVE DIRECTION, deliberately. A landed
    // save that holds the words AND MORE compares false, so the entry is sent,
    // 409s, and the drain classifies — costing one redundant send. Superseding it
    // wrongly costs the member's words. The control case pins that a genuinely
    // superseded entry is still cleared, so this cannot become "never supersede".
    if (isSupersededBaseline(entry.baseUpdatedAt, landed)
        && sameAuthoredContent(noteRec, entry.patch)) {
      // eslint-disable-next-line no-await-in-loop
      await clearOutboxEntry(db, entry.mutationId)
      results.push({
        mutationId: entry.mutationId,
        noteId: entry.noteId,
        outcome: SUPERSEDED,
        reason: `a save this browser landed at ${landed} is newer than this entry's baseline ${entry.baseUpdatedAt}, and PROVABLY CONTAINS its content`,
      })
      continue
    }
    // ⛔ D3b — ASKED AGAIN, AT THE LAST MOMENT BEFORE THE SEND. The checks above
    // can include a network round trip (`askServerIfOurs`), and a note opened
    // during it is the owner's now. Whatever the pre-send path rebased stays
    // queued, as a rebased entry, for the owner to adopt.
    // eslint-disable-next-line no-await-in-loop
    if (await ownedByAnEditor(noteIsOwned, entry.noteId)) {
      results.push(ownedSkip(entry))
      continue
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const saved = await send(entry)
      // eslint-disable-next-line no-await-in-loop
      await settleSent(db, entry, saved)
      results.push({
        mutationId: entry.mutationId,
        noteId: entry.noteId,
        outcome: SENT,
        // ⭐ A merge and a rebase are different events and an operator reading a
        // drain result must be able to tell them apart: one carried the server's
        // own appended blocks back onto the queued body, the other did not.
        ...(appendMerged
          ? { shape: APPEND_ONLY, reason: `the server's change was append-only — merged onto ${rebased} and sent` }
          : {}),
      })
    } catch (e) {
      if (e?.status === 409) {
        // ⛔⛔ THE TERMINAL GUARD: A 409 IS NOT PROOF SOMEBODY ELSE WROTE.
        //
        // It proves only that the server has moved past this entry's baseline —
        // and the commonest way that happens, for a member with ONE device, is
        // that THIS BROWSER'S OWN SAVE LANDED and the queue had not caught up.
        // Forking on that produces a `(conflicted copy)` of a note nobody else
        // ever touched, and tells the member it "changed elsewhere". It did not.
        //
        // ⭐ SO ASK THE SERVER, RATHER THAN INFERRING FROM LOCAL STATE. This is
        // the guard that fires regardless of marker state, timing, dirtiness or
        // ordering — every other guard above is an optimisation that saves this
        // one a round trip.
        //
        // ⛔ AND IT MUST BE NARROW. Discarding on ANY 409 would silently drop a
        // genuine second-writer conflict, which is the one case that MUST fork.
        // The test for "ours" is byte-identical content, or a server revision
        // this browser has already recorded as landed. Anything else forks.
        try {
          // eslint-disable-next-line no-await-in-loop
          const mine = await askServerIfOurs(db, entry, serverCopyIsOurs)
          if (mine?.ours && mine.identical) {
            // ⛔ Removed ONLY because the server body provably holds these words.
            // eslint-disable-next-line no-await-in-loop
            await clearOutboxEntry(db, entry.mutationId)
            results.push({
              mutationId: entry.mutationId,
              noteId: entry.noteId,
              outcome: SUPERSEDED,
              reason: `409, but the server copy is this browser's own save (${mine.why}) — removed, not forked`,
            })
            continue
          }
          // ⭐⭐ CLASSIFY BEFORE CHOOSING — Q1 fix 3, owner ruling 2026-09-13.
          // The same question the pre-send path asks, asked through the same
          // authority: `ringVouchedPlan`. Two copies of it is how the pre-send
          // path and this one drifted into answering it identically wrong.
          const ring = (mine?.ours && !retriedRebase)
            ? ringVouchedPlan(mine, noteRec, entry)
            : { plan: null, base: null, shape: null }
          if (mine?.serverUpdatedAt && ring.plan === 'merge') {
            // ⭐ The server appended and we still owe it the member's words.
            // Both survive: `mergeAppends` puts the server's blocks back onto
            // the queued body before it goes out.
            // eslint-disable-next-line no-await-in-loop
            const mergedEntry = await mergeAppends(
              db, entry, appendedServerNodes(mine.serverNote, ring.base),
              mine.serverUpdatedAt, snapshotOfServerCopy(mine.serverNote, mine.serverUpdatedAt),
            )
            if (mergedEntry) {
              entry = mergedEntry
              retriedRebase = true
              rebased = mine.serverUpdatedAt
              try {
                // eslint-disable-next-line no-await-in-loop
                const saved = await send(entry)
                // eslint-disable-next-line no-await-in-loop
                await settleSent(db, entry, saved)
                results.push({
                  mutationId: entry.mutationId,
                  noteId: entry.noteId,
                  outcome: SENT,
                  reason: `409 on our own revision — the server's change was append-only, `
                    + `merged onto ${rebased} and resent`,
                })
                continue
              } catch (re) {
                if (re?.status !== 409) {
                  results.push({ mutationId: entry.mutationId, noteId: entry.noteId, outcome: KEPT, error: re })
                  continue
                }
                // a second 409 ⇒ fall through and fork, preserving both copies
              }
            }
          }
          if (mine?.serverUpdatedAt && ring.plan === 'rebase') {
            // ⭐⭐ OURS, AND THE SERVER'S CHANGE WAS NOT A BODY REWRITE ⇒ REBASE
            // AND RESEND ONCE. The 409 said the server moved; the ring says WE
            // moved it; so the words are still owed and now have a baseline that
            // can succeed. This is byte-for-byte what every metadata door did
            // before the classification was hoisted above it.
            // ⛔ ONCE. A rebase loop against a server that keeps moving would
            // spin the network; a second 409 falls through to the fork, which
            // preserves both copies.
            // eslint-disable-next-line no-await-in-loop
            entry = await rebaseEntry(db, entry, mine.serverUpdatedAt)
            retriedRebase = true
            rebased = mine.serverUpdatedAt
            try {
              // eslint-disable-next-line no-await-in-loop
              const saved = await send(entry)
              // eslint-disable-next-line no-await-in-loop
              await settleSent(db, entry, saved)
              results.push({
                mutationId: entry.mutationId,
                noteId: entry.noteId,
                outcome: SENT,
                reason: `409 on our own revision — rebased onto ${rebased} and resent`,
              })
              continue
            } catch (re) {
              if (re?.status !== 409) {
                results.push({ mutationId: entry.mutationId, noteId: entry.noteId, outcome: KEPT, error: re })
                continue
              }
              // a second 409 ⇒ fall through and fork, preserving both copies
            }
          }
          // ⭐⭐ THE RING COULD NOT VOUCH FOR THIS REVISION — SO ASK THE DIFF.
          //
          // ⚰️ 2026-09-12. The landed ring only knows revisions THIS browser
          // recorded. A door fired in another tab, a door that shipped before
          // the settle did, a door nobody has enumerated yet — every one of
          // them produces a revision the ring has never heard of, and the
          // answer was always "not ours ⇒ fork". A member who set a ticker in
          // one tab and typed in another got a `(conflicted copy)` of a note
          // only they had ever touched.
          //
          // ⛔⛔ AND THIS IS WHY THE CLASSIFICATION IS DERIVED FROM THE DIFF,
          // NOT FROM WHICH ENDPOINT WAS CALLED. The ring is an enumeration of
          // callers, and Wave Q1 proved twice that an enumeration of callers
          // goes stale silently. Two documents cannot lie about what is in them.
          //
          // ⛔ It runs ONLY when the ring had nothing to offer and no rebase has
          // been tried. After a rebase the fetched copy is a revision behind,
          // and classifying against a stale document is how you merge into a
          // note that has moved again.
          if (!retriedRebase && mine?.serverNote && isUsableBaseline(mine.serverUpdatedAt)) {
            // ⛔ D3b fix round 1, residual (c): never a base NEWER than the entry —
            // `classifiableBase` answers null for one, and null forks.
            const { base } = classifiableBase(entry, noteRec)
            const shape = classifyServerChange(mine.serverNote, base)
            const snapshot = snapshotOfServerCopy(mine.serverNote, mine.serverUpdatedAt)
            let merged = null
            if (shape === METADATA_ONLY) {
              // The body never moved. The member's queued body is still the
              // only authority on the body — rebase and send it.
              // eslint-disable-next-line no-await-in-loop
              merged = await rebaseEntry(db, entry, mine.serverUpdatedAt, snapshot)
            } else if (shape === APPEND_ONLY) {
              // eslint-disable-next-line no-await-in-loop
              merged = await mergeAppends(
                db, entry, appendedServerNodes(mine.serverNote, base), mine.serverUpdatedAt, snapshot,
              )
            }
            if (merged) {
              entry = merged
              retriedRebase = true
              rebased = mine.serverUpdatedAt
              try {
                // eslint-disable-next-line no-await-in-loop
                const saved = await send(entry)
                // eslint-disable-next-line no-await-in-loop
                await settleSent(db, entry, saved)
                results.push({
                  mutationId: entry.mutationId,
                  noteId: entry.noteId,
                  outcome: SENT,
                  shape,
                  reason: shape === APPEND_ONLY
                    ? `409, and the server's only change was blocks it appended itself — merged onto ${rebased} and sent`
                    : `409, but the server's body never moved (${shape}) — rebased onto ${rebased} and sent`,
                })
                continue
              } catch (re) {
                if (re?.status !== 409) {
                  results.push({ mutationId: entry.mutationId, noteId: entry.noteId, outcome: KEPT, error: re })
                  continue
                }
                // ⛔ A second 409 means the server moved AGAIN while we were
                // deciding. Fall through and fork — preserving both copies is
                // the answer whenever the ground will not hold still.
              }
            }
          }
        } catch {
          // ⛔ THE SERVER CHECK FAILING IS NOT PERMISSION TO DISCARD. Fall
          // through to the fork. Preserving both copies is the safe direction:
          // a spurious duplicate is recoverable by the member, a dropped write
          // is not. An error here must never read as "not ours".
        }
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
