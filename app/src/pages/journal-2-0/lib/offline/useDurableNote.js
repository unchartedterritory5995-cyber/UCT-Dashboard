/**
 * Wave Q1 — the durable working copy, bound to ONE note in the editor.
 *
 * This is the seam between the primitives and the product. The editor keeps its
 * existing pipeline and gains one stage:
 *
 *   KEYSTROKE
 *     → localStorage draft            synchronous, owns the crash window
 *     → in-memory editor state
 *     → THIS: coalesced IndexedDB durable working copy + its sync intent
 *     → when online: the existing ~800 ms server autosave / PUT
 *
 * ⛔ THE DURABLE WRITE IS DEBOUNCED, NEVER PER-KEYSTROKE. The measurement said
 * so (durableWriter's header carries the numbers), and the localStorage draft
 * is what covers the window the debounce opens.
 *
 * ⛔ "SAVED ON THIS DEVICE" IS NOT "SYNCED TO UCT". The status this hook
 * reports is about bytes on this disk and nothing else. It is only ever true
 * after a write COMMITS, never while one is pending, in flight, or failed.
 *
 * ⛔ A CLEAN RECORD IS NOT A RECOVERY CANDIDATE. `dirty: 0` means the server
 * already has this content; if the server's copy now differs, the server is
 * newer BY CONSTRUCTION (another device wrote it). Offering the local copy back
 * would invite a member to push yesterday's words over today's.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_DEBOUNCE_MS, DURABLE, FAILED, IDLE, createDurableWriter,
} from './durableWriter'
import {
  getMeta, getNote, listOutbox, offlineStorageAvailable, openNotebookDb, putMeta, putNoteWithIntent,
  storagePosture,
} from './notebookDb'
import {
  markerFor, holdSessionLock, markerKeyFor, landedKeyFor, withLanded,
} from './inFlight'
import { offlineEnabled } from './offlineFlag'
import {
  chooseLocalRecovery, newSessionId, sameAuthoredContent, discardsUnsentWork,
  editorStateDiscardsUnsentWork, queuedWorkToAdopt, baseOfRecovered,
} from './recoverLocalState'
import { settleForkedNote } from './outboxDrain'
import { lastKnownServerCopy, snapshotOfServerCopy } from './serverChange'
import { usableBaseline, isUsableBaseline } from './baseline'

/** No durable store here at all (a private window, an old browser). Reported,
 *  never papered over — the product degrades truthfully. */
export const UNAVAILABLE = 'unavailable'

/**
 * ONE editing session per tab. A generation is only comparable WITHIN a
 * session, so this travels with every record the tab writes.
 */
export const SESSION_ID = newSessionId()

// ⛔ Held for the life of the tab, so `liveSessionIds()` can tell a marker
// left by a LIVE save from one left by a tab that is gone. Web Locks are
// released by the browser on crash or kill, which no unload handler covers.
holdSessionLock(SESSION_ID)

/** One queued update per note, by construction: a newer edit REPLACES the
 *  pending intent instead of queuing a second one. The outbox holds what we
 *  still owe the server, not a history of what we typed. */
export const outboxIdFor = (noteId) => `note:${noteId}`

// ── one connection per account, shared by every editor mount ────────────────
const _conns = new Map()
const _blockedListeners = new Set()

/** A future version bump that cannot proceed because another tab holds an older
 *  connection. ⛔ Surfaced, never resolved by deleting anything. */
export function onUpgradeBlocked(fn) {
  _blockedListeners.add(fn)
  return () => _blockedListeners.delete(fn)
}

export function connectNotebookDb(accountId, { open = openNotebookDb } = {}) {
  const existing = _conns.get(accountId)
  if (existing) return existing
  const p = open(accountId, {
    // ⛔ A connection closed by a versionchange must NOT stay in the cache: the
    // next caller would await a promise for a database it can no longer use and
    // every write would throw InvalidStateError rather than reopen.
    onVersionChange: () => { _conns.delete(accountId) },
    onBlocked: (e) => { _blockedListeners.forEach((fn) => { try { fn(e) } catch { /* a listener is not the store */ } }) },
  }).catch((e) => { _conns.delete(accountId); throw e })
  _conns.set(accountId, p)
  return p
}

/** Rails only — the connection cache is module state and each test wants its own. */
export function __resetNotebookConnections() { _conns.clear() }

/**
 * Stamp "a PUT for this note is on the wire", BEFORE issuing it.
 *
 * ⛔ STORE-DIRECT AND MOUNT-INDEPENDENT, for the same reason `settleLandedSave`
 * is: the whole point is that this survives the component. It must be AWAITED
 * by the caller before the PUT goes out — a marker written after the request is
 * a marker the drain can miss, which is the entire defect in miniature.
 *
 * ⛔ Never throws into a save path. A save must not fail because bookkeeping
 * did; if the marker cannot be written the 409 self-supersede still covers the
 * outcome, which is why that guard is terminal and this one is an optimisation.
 */
export async function beginInFlightSave({
  accountId, noteId, baseUpdatedAt, connect = connectNotebookDb, now = Date.now(),
} = {}) {
  // ⛔⛔ §21 — SWITCHING THE WAVE OFF MUST WRITE NOTHING. The one-line rollback
  // is only real if every store-direct entry point honours it. These three are
  // mount-independent by design, so they are exactly the ones that would keep
  // writing after the flag went false, and the §21 rail caught it the moment
  // the settle was wired into the autosave path.
  // ⛔ OFF STOPS PROCESSING — it has never been permission to delete or alter
  // what a member already wrote, so this returns without touching the store.
  if (!offlineEnabled()) return null
  // ⛔ NO STORE, NO MARKER, AND NO WAITING FOR ONE. A private window or an old
  // browser has nowhere to write this, and without the check the save would pay
  // the full write budget on every keystroke-debounced attempt while waiting for
  // a connection that can never open. Cheap, and it is the honest answer: the
  // marker is an optimisation, and the 409 check still covers the outcome.
  if (!offlineStorageAvailable()) return null
  if (!accountId || !noteId) return null
  const marker = markerFor({ sessionId: SESSION_ID, baseUpdatedAt, now })
  if (!marker) return null
  // ⛔⛔ BOUNDED. THE MARKER MUST PRECEDE THE PUT — BUT A SAVE MUST NEVER WAIT
  // ON BOOKKEEPING, AND THIS IS THE ONE PLACE THOSE TWO RULES COLLIDE.
  //
  // ⚰️ Found by the existing rails, not by reading: awaiting this unbounded put
  // the member's ability to save behind IndexedDB being responsive. A blocked
  // upgrade, a stalled store, a browser under memory pressure — any of them
  // would have stopped saves outright, and the failure would have looked like
  // "the network is down" to a member whose network was fine.
  //
  // ⭐ SO THE MARKER IS BEST-EFFORT AND THE 409 CHECK IS TERMINAL. If the write
  // does not land inside the budget the save proceeds without it; the worst
  // case is that the drain claims the note and guard 2 recognises the server
  // copy as ours. That is exactly why guard 2 asks the SERVER rather than
  // trusting local state — it is the one guard that needs nothing to have
  // worked beforehand.
  //
  // ⛔ The budget is a fraction of IN_FLIGHT_TTL_MS on purpose: a marker that
  // took longer than this to write is already useless to a drain reading it.
  try {
    const db = await connect(accountId)
    await putMeta(db, markerKeyFor(noteId), marker)
    return marker
  } catch { return null }
}

/**
 * Clear the marker. ⛔ ON SUCCESS **AND** ON FAILURE — a save that 500s or is
 * abandoned must not leave the note unsweepable until the TTL expires. The
 * caller puts this in a `finally`, and this repo has already paid twice for a
 * cleanup that lived only on the success branch.
 */
export async function endInFlightSave({ accountId, noteId, connect = connectNotebookDb } = {}) {
  // ⛔⛔ §21 — SWITCHING THE WAVE OFF MUST WRITE NOTHING. The one-line rollback
  // is only real if every store-direct entry point honours it. These three are
  // mount-independent by design, so they are exactly the ones that would keep
  // writing after the flag went false, and the §21 rail caught it the moment
  // the settle was wired into the autosave path.
  // ⛔ OFF STOPS PROCESSING — it has never been permission to delete or alter
  // what a member already wrote, so this returns without touching the store.
  if (!offlineEnabled()) return false
  // ⛔ NO STORE, NO MARKER, AND NO WAITING FOR ONE. A private window or an old
  // browser has nowhere to write this, and without the check the save would pay
  // the full write budget on every keystroke-debounced attempt while waiting for
  // a connection that can never open. Cheap, and it is the honest answer: the
  // marker is an optimisation, and the 409 check still covers the outcome.
  if (!offlineStorageAvailable()) return false
  if (!accountId || !noteId) return false
  try {
    const db = await connect(accountId)
    const current = await getMeta(db, markerKeyFor(noteId))
    // ⛔ Only clear OUR OWN marker. Another session's in-flight save is not ours
    // to declare finished, and clearing it would hand its note to the drain.
    if (!current || current.sessionId !== SESSION_ID) return false
    await putMeta(db, markerKeyFor(noteId), null)
    return true
  } catch { return false }
}

/**
 * ⭐⭐ A LANDED SAVE SETTLES THE QUEUE — AND IT MUST WORK AFTER UNMOUNT.
 *
 * ⚰️ WHY THIS IS NOT `markSynced`. `markSynced` routes through
 * `writerRef.current` and returns null once the editor is gone. The editor's
 * save resolves *after* the member navigates away often enough to matter
 * (~1 offline session in 5, measured 2026-09-10) — and navigating away is
 * exactly when the note leaves `excludeNoteId` and becomes the sweep's. So the
 * one moment the queue most needs settling was the one moment it could not be.
 * The result was a member with ONE device finding a `(conflicted copy)` of their
 * own note, told it had "changed elsewhere".
 *
 * ⛔ THIS TALKS TO THE STORE DIRECTLY. No hook, no ref, no mount. It is safe to
 * call from a promise that outlives the component, which is the whole point.
 *
 * ⛔ AND IT STILL RESPECTS CAUGHT-UP-NESS. Clearing the outbox on the strength
 * of an ack for older words is how offline systems lose the newest ones:
 *   caught up      ⇒ intent `null` ⇒ every queued entry for the note is removed
 *   still ahead    ⇒ the entry is REBASED onto the landed revision, keeping the
 *                    member's newer words and giving them a baseline that can
 *                    actually succeed
 *
 * ⛔ `excludeNoteId` is untouched and is NOT the fix. It protects the note while
 * it is OPEN; this protects a queued entry whose baseline the editor invalidated
 * before handing the note back. Two different windows, two different guards.
 *
 * @returns the landed baseline it settled on, or null if it could not
 */
/**
 * ⛔⛔ RECORDING A REVISION AS OURS IS NOT THE SAME ACT AS SETTLING THE QUEUE.
 *
 * ⚰️ Found by the property rail, 2026-09-10, in 12 of 18 door × ordering cases
 * that every mechanism-level rail passed. When a door (folder/ticker/tags)
 * cannot settle -- because the editor could not report local state, and
 * refusing is the SAFE answer there -- the door's PUT has still moved the
 * server revision. Nothing recorded that revision, so guard 2 later answered
 * "not ours", and the drain forked the member's own note.
 *
 * ⭐ The two acts have different preconditions and must be callable separately:
 *   · settling the queue needs EVIDENCE about local content
 *   · recording a landing needs only that WE made the request
 * Conflating them meant the safe answer to the first silently withheld the
 * second.
 */
export async function recordLandedRevision({
  accountId, noteId, updatedAt, connect = connectNotebookDb,
} = {}) {
  if (!offlineEnabled()) return null
  if (!offlineStorageAvailable()) return null
  const landed = usableBaseline(updatedAt)
  if (!accountId || !noteId || !landed) return null
  try {
    const db = await connect(accountId)
    await putMeta(db, landedKeyFor(noteId), withLanded(await getMeta(db, landedKeyFor(noteId)), landed))
    return landed
  } catch { return null }
}

export async function settleLandedSave({
  accountId, noteId, acked, current, updatedAt, connect = connectNotebookDb,
} = {}) {
  // ⛔⛔ §21 — SWITCHING THE WAVE OFF MUST WRITE NOTHING. The one-line rollback
  // is only real if every store-direct entry point honours it. These three are
  // mount-independent by design, so they are exactly the ones that would keep
  // writing after the flag went false, and the §21 rail caught it the moment
  // the settle was wired into the autosave path.
  // ⛔ OFF STOPS PROCESSING — it has never been permission to delete or alter
  // what a member already wrote, so this returns without touching the store.
  if (!offlineEnabled()) return null
  // ⛔ NO STORE, NO MARKER, AND NO WAITING FOR ONE. A private window or an old
  // browser has nowhere to write this, and without the check the save would pay
  // the full write budget on every keystroke-debounced attempt while waiting for
  // a connection that can never open. Cheap, and it is the honest answer: the
  // marker is an optimisation, and the 409 check still covers the outcome.
  if (!offlineStorageAvailable()) return null
  const landed = usableBaseline(updatedAt)
  if (!accountId || !noteId || !landed) return null
  try {
    const db = await connect(accountId)
    const prev = await getNote(db, noteId)
    // ⛔⛔ A DIRTY DURABLE RECORD IS UNSENT MEMBER WORK, AND SERVER-DERIVED
    // STATE NEVER OVERWRITES IT.
    //
    // ⚰️ THE DEFECT THIS EXISTS FOR, measured on production 2026-09-13.
    // `caughtUp` asked `sameAuthoredContent(acked, current)` — the server's
    // accepted copy against the editor's current copy. On an ordinary save that
    // is a fair question. On a REMOUNT it is not: the editor was just rebuilt
    // FROM the server copy, so both sides of the comparison are the server, and
    // the answer is `true` for a reason that has nothing to do with the member.
    //
    // What followed was written in ONE transaction: the record went `dirty: 0`
    // at the server's newer baseline carrying the SERVER's body, and `intent`
    // was `null` — which deletes every queued entry for the note. The member's
    // offline words left the durable copy and the queue together, without one
    // byte of them reaching the server.
    //
    // ⭐ AND NOTHING COULD HAVE OFFERED THEM BACK. `recover()` admits only a
    // DIRTY record, and no recovery surface reads the outbox at all (the three
    // non-test readers are the drain, the pending count and the blocked badge).
    // So the same cheap flag that authorised the discard also suppressed the
    // offer-back. That is why this is not merely a lost-send.
    //
    // ⭐ THE QUESTION THE CONTENT COULD HAVE ANSWERED, and now does: is there
    // unsent work here, and does what landed contain it? Both were available in
    // this function the whole time — `prev.dirty`, and `prev`'s own body.
    // ⛔⛔ THE SAME AUTHORITY `persist` ASKS (Q1 fix 6). This condition was
    // written here first and lived ONLY here, so the identical invariant had one
    // implementation and one hole -- and the hole was invisible because this copy
    // read as coverage for both. Two copies cannot be mutation-proved as one
    // thing (`lesson_a_guard_repeated_is_a_guard_unproved`).
    const unsentWork = discardsUnsentWork(prev, acked)
    // ⛔ UNKNOWN IS NOT CAUGHT UP. A missing or unreadable `prev` answers
    // false to `unsentWork` and the old behaviour stands — that case is the
    // ordinary first save, not a remount, and treating it as unsent work would
    // keep every note dirty forever.
    const caughtUp = !unsentWork && sameAuthoredContent(acked, current)
    // ⛔ THE DURABLE COPY WINS. When there is unsent work the record keeps the
    // member's body, keeps `dirty`, and keeps its own baseline, so the entry
    // still 409s and the drain runs classify-then-rebase/merge/fork — the path
    // the one GREEN production cell actually measured.
    // ⛔⛔ AND IT KEEPS THE BASE THOSE WORDS WERE WRITTEN ON (D3, wave 5, A-1):
    // `serverBase` below is `prev`'s own last-known server copy, NOT `acked` —
    // the classifier must diff the server against what the queued words were
    // written on, or a door's appended block reads as "no change" and the
    // rebase drops it. `acked@landed` is the base only when the record settles
    // onto `landed` itself. (Frozen `serverChange.js:185-187` says `serverBase`
    // is "moved forward every time the server tells us something newer (an ack,
    // a successful drain send)". An ack while work is unsent is the one
    // deliberate exception, and `docs/notebook/f5-fixes-2026-09-23.md` §A.3
    // records it; that file cannot be edited under D3.)
    const state = unsentWork ? prev : (caughtUp ? (acked || current) : current)
    const record = {
      noteId,
      title: state?.title ?? '',
      subtitle: state?.subtitle ?? '',
      bodyJson: state?.bodyJson ?? null,
      // ⛔ The record's baseline only moves when the record is settling CLEAN.
      // Moving it while work is unsent is precisely what lets `landedBaseline`
      // hand the drain a "newer landed save" it never checked the contents of.
      baseUpdatedAt: unsentWork ? usableBaseline(prev?.baseUpdatedAt, landed) : landed,
      generation: prev?.generation ?? 0,
      sessionId: SESSION_ID,
      localSavedAt: Date.now(),
      dirty: caughtUp ? 0 : 1,
      // ⭐ The server has just spoken: `acked` is what it accepted, at `landed`.
      // When the record settles onto `landed` (it takes `current`, at `landed`),
      // that copy IS the base of what the record now holds.
      //
      // ⛔⛔ D3 (wave 5) — BUT NOT WHEN THE RECORD KEEPS ITS UNSENT WORK. Then it
      // keeps `prev`'s words AND `prev`'s baseline, and the base of THOSE words
      // is the server copy `prev` was already carrying — not `acked`.
      //
      // ⚰️ THE DEFECT, measured (`offlineWordsSurvive.property.test.jsx`, the two
      // wave-5 orderings, 6/6 append rows RED): this line always wrote
      // `acked@landed`. After a door appended a widget/fact/excerpt, `acked`
      // already contains that node, so the drain's classifier diffed the server
      // against a base that held it too, read "metadata-only", rebased the
      // member's queued body over the server's — and the captured node was gone.
      // The same shape as the Q1-F5 append-merge finding, reached through the
      // settle instead of the ring. Keeping the older base, the diff sees the
      // append for what it is and the drain MERGES it.
      // ⛔ `acked@landed` stays the fallback: a dirty `prev` with no base of its
      // own had nothing better, and that is the behaviour it had before.
      serverBase: caughtUp ? null
        : (unsentWork
          ? (lastKnownServerCopy(prev) || snapshotOfServerCopy(acked, landed))
          : snapshotOfServerCopy(acked, landed)),
    }
    const intent = caughtUp ? null : {
      mutationId: outboxIdFor(noteId),
      noteId,
      kind: 'note-update',
      patch: { title: record.title, subtitle: record.subtitle, bodyJson: record.bodyJson },
      // ⛔ The entry keeps ITS OWN baseline while work is unsent, so the send
      // 409s and the drain classifies. Jumping it to the server's newer revision
      // would skip the 409 - and with it the decision between rebase and fork.
      baseUpdatedAt: unsentWork ? usableBaseline(prev?.baseUpdatedAt, landed) : landed,
      generation: record.generation,
      sessionId: SESSION_ID,
      queuedAt: Date.now(),
    }
    await putNoteWithIntent(db, record, intent)
    // ⛔ The save this marker was raised for has landed, so the marker comes
    // down. A separate write, in a separate store — and the ordering is safe in
    // the only direction that matters: the record is settled FIRST, so a drain
    // reading in between sees a note that is still marked in-flight, declines,
    // and picks it up next pass. The reverse order would open a window where
    // the marker is down and the record not yet settled.
    // ⛔ Only ours, for the same reason endInFlightSave checks.
    const held = await getMeta(db, markerKeyFor(noteId))
    if (held && held.sessionId === SESSION_ID) await putMeta(db, markerKeyFor(noteId), null)
    // ⛔ RECORD THE LANDING. This is the only place that knows a revision came
    // back from the server as ours, and guard 2's second arm is unable to fire
    // without it — a member who kept typing after the save landed has a body
    // that no longer matches the server's, so the revision is the only remaining
    // evidence that nobody else wrote.
    await putMeta(db, landedKeyFor(noteId), withLanded(await getMeta(db, landedKeyFor(noteId)), landed))
    return landed
  } catch {
    // ⛔ Never throws into a save path. A queue that could not be settled is
    // caught by the drain's own supersede check, which is why that exists.
    return null
  }
}

/**
 * ⭐ D3 / F5P-1 — THE OWNER FORKED: SETTLE THE NOTE THE WAY THE SWEEP WOULD.
 *
 * The open editor resolves a conflict it cannot prove safe by preserving BOTH
 * copies: the member's words go into a `(conflicted copy)` sibling and the editor
 * shows the server's version. Nothing told the durable store. The record stayed
 * dirty with a queued entry the sibling had already preserved, and once the
 * note closed the sweep sent it, 409'd and forked AGAIN — two copies for one
 * conflict. That was rare while the editor only ever sent words the member had
 * just typed; now the owner also sends the words queued while away (F5P-1), so a
 * second writer's edit made during that time reaches exactly this branch.
 *
 * ⛔ ONLY AFTER THE SIBLING EXISTS. This clears the queue for the note, and the
 * sibling is the only reason that is not a loss. It is the drain's own
 * `settleForkedNote`, never a second copy of it — including its refusal to empty
 * the record when the server note is unusable.
 *
 * ⛔⛔ AND ONLY WHILE THE STORE STILL HOLDS EXACTLY WHAT WAS FORKED (review S1,
 * fix round 1). The sibling holds `forked` — what the editor had when it built
 * the copy. The create request takes a network round trip, and words typed
 * during it reach the durable record and the queue but NOT the sibling. Settling
 * then wrote the server copy CLEAN over them and cleared the queue: the words
 * were in no layer at all. So the record, and the queued entry if there is one,
 * must equal `forked`; anything else is refused and the note keeps the pre-E-3
 * behaviour — a second fork later, which preserves the words. A duplicate
 * beats a loss. No `forked`, no proof: refused.
 * ⚠️ The check and the settle are two transactions. What can land between them
 * is a durable write already scheduled before the editor's own check — content
 * the sibling holds — or a keystroke's write, which is debounced ≥200 ms and
 * whose draft and autosave the editor keeps whenever its view has moved.
 *
 * ⛔ Store-direct and mount-independent, like `settleLandedSave`; never throws;
 * and with the wave switched off it writes nothing (§21).
 *
 * @param forked  { title, subtitle, bodyJson } — exactly what the sibling holds
 * @returns true when settled · false when refused because the store has moved on
 *          from what was forked (or no `forked` was given) · null when it could
 *          not or may not write
 */
export async function settleOwnerFork({
  accountId, noteId, serverNote, forked = null, connect = connectNotebookDb,
} = {}) {
  if (!offlineEnabled()) return null
  if (!offlineStorageAvailable()) return null
  if (!accountId || !noteId) return null
  if (!forked) return false
  try {
    const db = await connect(accountId)
    const rec = await getNote(db, noteId)
    if (rec && !sameAuthoredContent(rec, forked)) return false
    const queued = (await listOutbox(db)).filter((e) => e?.noteId === noteId)
    if (queued.some((e) => !sameAuthoredContent(e.patch, forked))) return false
    await settleForkedNote(db, noteId, serverNote)
    return true
  } catch { return null }
}

/**
 * @param accountId  ⛔ part of the DATABASE NAME. Cross-account leakage is a
 *                   release blocker, so the isolation is structural.
 * @param noteId     one writer per note: generations are a per-note order.
 *
 * @returns {{
 *   supported: boolean, status: string, unsynced: boolean, error: Error|null,
 *   schedule: (state) => number|null,
 *   markSynced: ({acked, current, updatedAt}) => number|null,
 *   flush: () => void,
 *   recover: ({server, lsDraft}) => Promise<object>,
 * }}
 */
export function useDurableNote({
  accountId,
  noteId,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  connect = connectNotebookDb,
} = {}) {
  // ⛔ The Q1 certification gate first: with the flag off this whole layer is
  // inert and the Notebook behaves exactly as it did before Wave Q1.
  const supported = Boolean(offlineEnabled() && offlineStorageAvailable() && accountId && noteId)
  const [status, setStatus] = useState(supported ? IDLE : UNAVAILABLE)
  const [unsynced, setUnsynced] = useState(false)
  const [error, setError] = useState(null)
  // What the PLATFORM says about retention, read once. ⛔ It is a wording
  // input, never a gate: `null` and `false` both mean "not positively granted",
  // which is ALSO true of a brand-new ordinary profile. It does not mean private
  // browsing, and nothing here may treat it as a mode detector.
  const [persisted, setPersisted] = useState(null)
  const writerRef = useRef(null)
  // What the last COMMITTED write actually put on disk — read by the status
  // callback, which must never describe an intent that has not landed.
  const committedDirtyRef = useRef(false)

  useEffect(() => {
    if (!supported) { setPersisted(null); return undefined }
    let cancelled = false
    storagePosture()
      .then((p) => { if (!cancelled) setPersisted(p.persisted) })
      .catch(() => { if (!cancelled) setPersisted(null) })
    return () => { cancelled = true }
  }, [supported])

  useEffect(() => {
    if (!supported) {
      writerRef.current = null
      setStatus(UNAVAILABLE)
      setUnsynced(false)
      return undefined
    }

    const persist = async ({ state, generation }) => {
      const db = await connect(accountId)
      // ⛔ Read BEFORE writing: the base travels forward from whatever this
      // record already knew. A clean record is its own base, so the snapshot
      // is only ever taken at the clean→dirty transition — one extra body per
      // UNSYNCED note, never per note.
      const prev = await getNote(db, noteId)
      // ⛔⛔ Q1 FIX 6 — THIS WRITE MAY NOT RECONCILE AWAY WORDS THE SERVER HAS
      // NEVER SEEN.
      //
      // ⚰️ THE DEFECT, measured rather than reasoned (`q1AppendWriterCensus
      // .test.jsx`, spy call 1: `persist at useDurableNote.js:444`, intent NULL,
      // dirty 1 -> 0, queued 1 -> 0, sentence-in-record true -> false).
      // `markSynced` does NOT go through `settleLandedSave`, so Q1 fix 4's
      // identical guard was never on this path; and `caughtUp` there is
      // `sameAuthoredContent(acked, current)` — the ack against the EDITOR'S
      // OWN DOCUMENT, which cannot see words that live only in the durable
      // record and the queue. That is exactly what an offline session leaves
      // behind, and it is why the comparison has to be against `prev`.
      //
      // ⛔ THE DURABLE COPY WINS, the same way it does in `settleLandedSave`:
      // keep the member's body, keep `dirty`, keep the record's own baseline,
      // and keep an intent carrying it. The entry then 409s and the drain runs
      // classify-then-rebase/merge/fork — the path 2.8b measured GREEN on
      // production, and the path the control case in the reproduction exercises.
      // ⛔ THE EDITOR-PROVENANCE PREDICATE, NOT THE ACK ONE. `state` here is
      // the editor's own content, so a member typing MORE must not read as a
      // discard. `settleLandedSave` keeps the strict `discardsUnsentWork`
      // because what it is handed is the SERVER'S CLAIM. Same invariant, two
      // questions — see the note above `editorStateDiscardsUnsentWork`.
      const unsentWork = editorStateDiscardsUnsentWork(prev, {
        title: state?.title ?? '',
        subtitle: state?.subtitle ?? '',
        bodyJson: state?.bodyJson ?? null,
      })
      const source = unsentWork ? prev : state
      const record = {
        noteId,
        title: source?.title ?? '',
        subtitle: source?.subtitle ?? '',
        bodyJson: source?.bodyJson ?? null,
        // ⛔ The baseline does NOT move while work is unsent. Moving it is
        // precisely what lets `landedBaseline` hand the drain a "newer landed
        // save" whose contents nobody checked.
        baseUpdatedAt: usableBaseline(
          unsentWork ? prev?.baseUpdatedAt : state?.baseUpdatedAt,
        ),
        generation,
        sessionId: SESSION_ID,
        localSavedAt: Date.now(),
        // ⛔ 0/1, not a boolean — IndexedDB cannot index a boolean, and
        // `byDirty` exists so a reconnect can find unsynced work without
        // reading every note.
        dirty: (state?.synced && !unsentWork) ? 0 : 1,
      }
      // ⛔ `null` when clean — a clean record IS the base and a second copy of
      // one value is a second authority over it.
      record.serverBase = record.dirty
        ? (lastKnownServerCopy(prev) || snapshotOfServerCopy(state?.serverBase))
        : null
      const intent = record.dirty
        ? {
          mutationId: outboxIdFor(noteId),
          noteId,
          kind: 'note-update',
          patch: { title: record.title, subtitle: record.subtitle, bodyJson: record.bodyJson },
          baseUpdatedAt: record.baseUpdatedAt,
          generation,
          sessionId: SESSION_ID,
          queuedAt: Date.now(),
        }
        : null
      // ⛔⛔ ONE TRANSACTION. The working copy and what we still owe the server
      // move together or not at all.
      await putNoteWithIntent(db, record, intent)
      committedDirtyRef.current = Boolean(record.dirty)
    }

    const writer = createDurableWriter({
      persist,
      debounceMs,
      onStatus: (next, extra) => {
        setStatus(next)
        if (next === FAILED) {
          setError(extra?.error || new Error('the durable write failed'))
        } else if (next === DURABLE) {
          setError(null)
          setUnsynced(committedDirtyRef.current)
        }
      },
    })
    writerRef.current = writer
    return () => {
      // Navigating away in-app runs this while the page is still alive, so a
      // scheduled-but-unwritten snapshot can still land. ⛔ Acceleration, not
      // the mechanism: a real tab close runs no cleanup at all, which is
      // exactly why the synchronous localStorage draft owns that window.
      writer.flush()
      writer.destroy()
      if (writerRef.current === writer) writerRef.current = null
    }
  }, [supported, accountId, noteId, debounceMs, connect])

  /** Record the newest local state. Always dirty: if the member typed it and
   *  the server has not acknowledged it, we owe it to the server. */
  const schedule = useCallback((state) => {
    const w = writerRef.current
    if (!w) return null
    return w.schedule({ ...state, synced: false })
  }, [])

  /**
   * The server accepted a save.
   *
   * ⛔ `acked` is what the server was SENT; `current` is what the editor holds
   * NOW. They differ whenever the member kept typing during the PUT, and in
   * that case the note is NOT caught up — clearing the outbox on the strength
   * of an ack for older words is how offline systems lose the newest ones.
   */
  const markSynced = useCallback(({ acked, current, updatedAt }) => {
    const w = writerRef.current
    if (!w) return null
    const caughtUp = sameAuthoredContent(acked, current)
    const gen = w.schedule({
      ...current,
      baseUpdatedAt: usableBaseline(updatedAt, current?.baseUpdatedAt),
      synced: caughtUp,
    })
    // Acceleration, not the mechanism: a stale intent left queued would be
    // re-sent on the next drain and 409 against the revision we just created.
    w.flush()
    return gen
  }, [])

  const flush = useCallback(() => { writerRef.current?.flush() }, [])

  /**
   * Which of the three copies is the member's newest work, on reopen.
   * ⛔ Returns a DECISION; it never applies one. The banner offers, the member
   * chooses — silently preferring a local copy can clobber a real sync.
   */
  const recover = useCallback(async ({ server, lsDraft = null } = {}) => {
    let idbRecord = null
    let queued = null
    if (supported) {
      try {
        const db = await connect(accountId)
        const rec = await getNote(db, noteId)
        // ⛔ See the header: a clean record is not a candidate.
        idbRecord = rec && rec.dirty ? rec : null
        // ⭐ D3 / F5P-1: the queued entry is the evidence that these words were
        // already committed to the server — see `queuedWorkToAdopt`.
        if (idbRecord) queued = (await listOutbox(db)).find((e) => e?.noteId === noteId) || null
      } catch {
        idbRecord = null   // no durable copy is a fact, not an error to raise
        queued = null
      }
    }
    const decision = chooseLocalRecovery({ server, idbRecord, lsDraft })
    // ⭐ `adopt` is non-null ONLY for provably queued work: the owning editor
    // then holds those words and sends them through its own save, on the
    // baseline they were written on. Null keeps the banner exactly as before.
    // ⭐ `base` is what the recovered words were written on, when provable —
    // what Restore must save against so a moved server 409s into the editor's
    // reconcile instead of being overwritten (see `baseOfRecovered`).
    return {
      ...decision,
      adopt: queuedWorkToAdopt({ decision, record: idbRecord, entry: queued }),
      base: baseOfRecovered({ decision, record: idbRecord }),
    }
  }, [supported, accountId, noteId, connect])

  return { supported, status, unsynced, error, persisted, schedule, markSynced, flush, recover }
}
