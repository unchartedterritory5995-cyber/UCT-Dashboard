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
  getMeta, getNote, offlineStorageAvailable, openNotebookDb, putMeta, putNoteWithIntent, storagePosture,
} from './notebookDb'
import {
  markerFor, holdSessionLock, markerKeyFor, landedKeyFor, withLanded,
} from './inFlight'
import { offlineEnabled } from './offlineFlag'
import { chooseLocalRecovery, newSessionId, sameAuthoredContent } from './recoverLocalState'
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
    const caughtUp = sameAuthoredContent(acked, current)
    const state = caughtUp ? (acked || current) : current
    const record = {
      noteId,
      title: state?.title ?? '',
      subtitle: state?.subtitle ?? '',
      bodyJson: state?.bodyJson ?? null,
      baseUpdatedAt: landed,
      generation: prev?.generation ?? 0,
      sessionId: SESSION_ID,
      localSavedAt: Date.now(),
      dirty: caughtUp ? 0 : 1,
    }
    const intent = caughtUp ? null : {
      mutationId: outboxIdFor(noteId),
      noteId,
      kind: 'note-update',
      patch: { title: record.title, subtitle: record.subtitle, bodyJson: record.bodyJson },
      baseUpdatedAt: landed,
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
      const record = {
        noteId,
        title: state?.title ?? '',
        subtitle: state?.subtitle ?? '',
        bodyJson: state?.bodyJson ?? null,
        baseUpdatedAt: usableBaseline(state?.baseUpdatedAt),
        generation,
        sessionId: SESSION_ID,
        localSavedAt: Date.now(),
        // ⛔ 0/1, not a boolean — IndexedDB cannot index a boolean, and
        // `byDirty` exists so a reconnect can find unsynced work without
        // reading every note.
        dirty: state?.synced ? 0 : 1,
      }
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
    if (supported) {
      try {
        const db = await connect(accountId)
        const rec = await getNote(db, noteId)
        // ⛔ See the header: a clean record is not a candidate.
        idbRecord = rec && rec.dirty ? rec : null
      } catch {
        idbRecord = null   // no durable copy is a fact, not an error to raise
      }
    }
    return chooseLocalRecovery({ server, idbRecord, lsDraft })
  }, [supported, accountId, noteId, connect])

  return { supported, status, unsynced, error, persisted, schedule, markSynced, flush, recover }
}
