/**
 * Wave Q1 — the reconnect. One tab spends the outbox; the others wait.
 *
 * ⛔ ONLY A LEADER DRAINS. Two tabs pushing the same account's queued notes is
 * exactly the last-write-wins this wave forbids, and it is decided by scheduling
 * luck — the worst kind of bug to reproduce. Web Locks is the primitive
 * (measured available AND granted on the production origin); where it is
 * missing the tab is READ-ONLY FOR SYNC and simply never drains. A degraded
 * mode that races is worse than one that waits: the race corrupts, the wait
 * only delays.
 *
 * ⛔ AND THE OPEN NOTE IS NOT THE SWEEP'S. The editor owns saving the note it
 * has open, with its own backoff; this drains everything else.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createNoteViaApi } from '../noteCreation'
import { listOutbox, offlineStorageAvailable } from './notebookDb'
import { offlineEnabled } from './offlineFlag'
import { NO_BASELINE, drainOutbox, summarize } from './outboxDrain'
import { postBlockedBaseline } from './blockedBaselineEvent'
import {
  FOLLOWER, LEADER, READ_ONLY_FOR_SYNC, awaitSyncLeadership, claimSyncLeadership,
} from './outboxLeader'
import { connectNotebookDb } from './useDurableNote'
import { usableBaseline, isUsableBaseline } from './baseline'
import { sameAuthoredContent } from './recoverLocalState'
import { liveSessionIds } from './inFlight'

/** How often a leader re-tries what is still queued. ⛔ The `online` event only
 *  fires on a NETWORK transition — a server that came back up produces no event
 *  at all, so something has to ask again. */
export const RETRY_INTERVAL_MS = 60000

/**
 * ⛔⛔ A 409 IS NOT PROOF SOMEBODY ELSE WROTE — ASK THE SERVER.
 *
 * It proves the server moved past this entry's baseline, and for a member with
 * ONE device the commonest cause is that this browser's own save landed while
 * the queue had not caught up. Forking on that manufactures a
 * `(conflicted copy)` of a note nobody else touched.
 *
 * ⛔ NARROW ON PURPOSE. Only two things make the server copy "ours":
 *   · its authored content is byte-identical to what this entry would send —
 *     then sending it again could not change anything, so there is nothing to
 *     preserve and nothing to fork; or
 *   · its `updatedAt` is a revision this browser has recorded as landed,
 *     which is the marker's `baseUpdatedAt` written before the PUT went out.
 * ⛔ Everything else forks. A genuine second writer MUST still produce a
 * conflicted copy, and widening this test to "any 409" would silently discard
 * their work — trading a visible duplicate for an invisible data loss, which is
 * the wrong direction on every axis.
 */
export async function serverCopyIsOursDefault(entry, { landedRevisions = null } = {}) {
  const res = await fetch(`/api/j2/notes/${entry.noteId}`, { credentials: 'include' })
  if (!res.ok) {
    const err = new Error(`${res.status}`)
    err.status = res.status
    throw err          // ⛔ never "not ours" by accident — the drain forks on a throw
  }
  const server = (await res.json()).note
  if (sameAuthoredContent(server, entry.patch)) {
    return { ours: true, why: 'the server copy is byte-identical to this entry' }
  }
  const landed = usableBaseline(server?.updatedAt)
  if (landed && landedRevisions instanceof Set && landedRevisions.has(landed)) {
    return { ours: true, why: `the server revision ${landed} is one this browser recorded as landed` }
  }
  return { ours: false, why: 'the server copy differs and is not one of ours' }
}

/** The same compare-and-set PUT the editor uses, byte for byte. */
export async function sendNoteUpdate(entry) {
  const patch = {
    title: entry.patch?.title ?? '',
    subtitle: entry.patch?.subtitle || null,
    ...(entry.patch?.bodyJson ? { bodyJson: entry.patch.bodyJson } : {}),
    ...(isUsableBaseline(entry.baseUpdatedAt) ? { baseUpdatedAt: entry.baseUpdatedAt } : {}),
  }
  const res = await fetch(`/api/j2/notes/${entry.noteId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const err = new Error(body.detail || `${res.status}`)
    err.status = res.status
    throw err
  }
  return (await res.json()).note
}

/**
 * Preserve BOTH versions: the server keeps its revision, the queued local work
 * becomes a real "(conflicted copy)" note tagged `sync-conflict` — the SAME
 * vocabulary the connectors already gave members, not a second offline-only
 * conflict system.
 *
 * ⛔ The sweep does NOT attempt the editor's append-only-embed merge. It has no
 * open document to merge into, and the trade is not close: an extra sibling is
 * recoverable in one click, an overwrite is not recoverable at all.
 */
export async function forkConflictedCopy(entry) {
  const res = await fetch(`/api/j2/notes/${entry.noteId}`, { credentials: 'include' })
  if (!res.ok) throw new Error(`could not read the server note (${res.status})`)
  const serverNote = (await res.json()).note
  const title = `${entry.patch?.title || 'Untitled note'} (conflicted copy)`.trim()
  await createNoteViaApi({
    title,
    bodyJson: entry.patch?.bodyJson,
    tags: ['sync-conflict'],
    folderId: serverNote?.folderId || undefined,
  })
  return serverNote
}

export function useOutboxDrain({
  accountId,
  excludeNoteId = null,
  enabled = true,
  send = sendNoteUpdate,
  fork = forkConflictedCopy,
  connect = connectNotebookDb,
  /** Wave Q1 — the null is INSTRUMENTED, not hunted. Injected so a rail can
   *  prove it fires on a baseline-less block and on nothing else. */
  report = postBlockedBaseline,
  /** Injected so a rail can drive the 409 self-supersede without a network. */
  serverCopyIsOurs = serverCopyIsOursDefault,
  intervalMs = RETRY_INTERVAL_MS,
} = {}) {
  // ⛔ The same gate. Nothing drains — and nothing even claims leadership —
  // until the §32 matrix has been reported.
  const supported = Boolean(offlineEnabled() && offlineStorageAvailable() && accountId && enabled)
  const [role, setRole] = useState(null)
  const [pending, setPending] = useState(0)
  // Also a ref: the retry interval must not be torn down and rebuilt (and
  // re-fire a drain) every time the count changes.
  const pendingRef = useRef(0)
  const [lastSummary, setLastSummary] = useState(null)
  const roleRef = useRef(null)
  const runningRef = useRef(false)
  const excludeRef = useRef(excludeNoteId)
  excludeRef.current = excludeNoteId
  // ⛔⛔ LATEST-CALLBACK REFS, AND THEY ARE LOAD-BEARING. A caller passing an
  // inline `send`/`fork`/`connect` (the natural way to write the call site)
  // hands this hook a NEW function identity every render. With those in a
  // `useCallback`'s deps, `drainNow` changes identity too, the trigger effect
  // re-runs, it drains, the drain sets state, and the render loop spins the
  // network as fast as the machine allows — which is exactly what happened the
  // first time this file's own rail ran: 84,415 sends in twenty seconds.
  const sendRef = useRef(send)
  sendRef.current = send
  const forkRef = useRef(fork)
  forkRef.current = fork
  const connectRef = useRef(connect)
  connectRef.current = connect
  const reportRef = useRef(report)
  reportRef.current = report
  const serverCopyIsOursRef = useRef(serverCopyIsOurs)
  serverCopyIsOursRef.current = serverCopyIsOurs

  // ── leadership ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!supported) { setRole(null); roleRef.current = null; return undefined }
    let cancelled = false
    let release = () => {}
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const take = (r) => { if (!cancelled) { roleRef.current = r; setRole(r) } }

    ;(async () => {
      const claim = await claimSyncLeadership(accountId)
      if (cancelled) { claim.release(); return }
      release = claim.release
      take(claim.role)
      if (claim.role !== FOLLOWER) return
      // ⛔ No polling. The browser queues this request and hands the lock over
      // when the leading tab goes away.
      try {
        const next = await awaitSyncLeadership(accountId, { signal: controller?.signal })
        if (cancelled) { next.release(); return }
        release = next.release
        take(next.role)
      } catch { /* aborted, or no Web Locks — either way we are not the leader */ }
    })()

    return () => {
      cancelled = true
      try { controller?.abort() } catch { /* nothing waiting */ }
      release()
    }
  }, [supported, accountId])

  const countPending = useCallback(async () => {
    if (!supported) return 0
    try {
      const db = await connectRef.current(accountId)
      const entries = await listOutbox(db)
      pendingRef.current = entries.length
      setPending(entries.length)
      return entries.length
    } catch {
      return 0
    }
  }, [supported, accountId])

  const drainNow = useCallback(async () => {
    // ⛔⛔ THE ONE GATE. A follower or a read-only tab returns here, and that
    // is the whole safety property — not a "best effort" attempt with a
    // comment. The triggers below deliberately do NOT re-check the role: a
    // second copy of this condition would make each one look load-bearing
    // while neither could be proved, and a mutation that deleted either would
    // leave every rail green.
    if (!supported || roleRef.current !== LEADER) return null
    if (runningRef.current) return null      // single-flight
    runningRef.current = true
    try {
      const db = await connectRef.current(accountId)
      const results = await drainOutbox(db, {
        send: sendRef.current, fork: forkRef.current, excludeNoteId: excludeRef.current,
        // ⛔ Who currently holds the sync lock, so a marker left by a tab that
        // is GONE expires immediately instead of waiting out its TTL. `null`
        // when the browser cannot answer — which means "the TTL decides
        // alone", never "nobody holds it" (that would expire every live marker
        // on the spot and hand every in-flight note straight to the drain).
        holders: await liveSessionIds(),
        serverCopyIsOurs: serverCopyIsOursRef.current,
      })
      // ⭐ One event per refusal, and only for the refusal nobody can explain.
      // The drain decides; this only carries. ⛔ Awaited-but-swallowed: a
      // telemetry POST must never change whether the queue advanced, and a
      // rejected promise here would surface as a failed drain.
      for (const r of results) {
        if (r?.report?.reason !== NO_BASELINE) continue
        try {
          // eslint-disable-next-line no-await-in-loop
          await reportRef.current(r.report)
        } catch { /* an instrument is not a guard */ }
      }
      const s = summarize(results)
      setLastSummary(s)
      await countPending()
      return s
    } catch {
      return null
    } finally {
      runningRef.current = false
    }
  }, [supported, accountId, countPending])

  // ── triggers ─────────────────────────────────────────────────────────────
  useEffect(() => { countPending() }, [countPending])

  useEffect(() => {
    if (!supported) return undefined
    // `role` is in the deps so this re-fires the moment leadership is acquired;
    // whether it may actually send is `drainNow`'s single decision.
    drainNow()
    const onOnline = () => { drainNow() }
    window.addEventListener('online', onOnline)
    // The safety net for a server that recovered without a network transition.
    const timer = setInterval(() => { if (pendingRef.current > 0) drainNow() }, intervalMs)
    return () => {
      window.removeEventListener('online', onOnline)
      clearInterval(timer)
    }
  }, [supported, role, drainNow, intervalMs])

  // Closing a note hands it back to the sweep — the editor is no longer the
  // writer for it, so anything it left queued can move now.
  useEffect(() => {
    drainNow()
  }, [excludeNoteId, role, drainNow])

  return {
    supported,
    role,
    isLeader: role === LEADER,
    readOnlyForSync: role === READ_ONLY_FOR_SYNC,
    pending,
    lastSummary,
    drainNow,
    refreshPending: countPending,
  }
}
