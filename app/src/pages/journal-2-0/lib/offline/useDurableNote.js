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
  getNote, offlineStorageAvailable, openNotebookDb, putNoteWithIntent, storagePosture,
} from './notebookDb'
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
