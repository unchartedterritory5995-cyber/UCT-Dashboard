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
import { drainOutbox, summarize } from './outboxDrain'
import {
  FOLLOWER, LEADER, READ_ONLY_FOR_SYNC, awaitSyncLeadership, claimSyncLeadership,
} from './outboxLeader'
import { connectNotebookDb } from './useDurableNote'

/** How often a leader re-tries what is still queued. ⛔ The `online` event only
 *  fires on a NETWORK transition — a server that came back up produces no event
 *  at all, so something has to ask again. */
export const RETRY_INTERVAL_MS = 60000

/** The same compare-and-set PUT the editor uses, byte for byte. */
export async function sendNoteUpdate(entry) {
  const patch = {
    title: entry.patch?.title ?? '',
    subtitle: entry.patch?.subtitle || null,
    ...(entry.patch?.bodyJson ? { bodyJson: entry.patch.bodyJson } : {}),
    ...(entry.baseUpdatedAt ? { baseUpdatedAt: entry.baseUpdatedAt } : {}),
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
      })
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
