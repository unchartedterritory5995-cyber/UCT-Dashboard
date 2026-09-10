/**
 * Wave Q1 — THE READ BEHIND THE "edit it again to sync" SURFACE.
 *
 * Returns the set of note ids whose queued work the drain has retired from
 * retrying, plus the storage posture the copy needs to pick its noun.
 *
 * ⛔ THE SAME GATE AS THE DRAIN. With `OFFLINE_DEFAULT_ON` false this whole
 * layer is inert, so there is no per-account database to open and nothing could
 * have been blocked. Reading anyway would be the one place the dark wave
 * touched IndexedDB in production, which is exactly the property §21b exists to
 * hold. `supported` false ⇒ the empty set, no connection, no read.
 *
 * ⛔ `connect` is held in a LATEST-REF, not in the deps. A caller passing an
 * inline function hands this hook a new identity every render; with that in a
 * `useCallback`'s deps the refresh callback changes identity, the effect
 * re-runs, it reads, it sets state, and the loop spins as fast as the machine
 * allows. `useOutboxDrain` learned this the expensive way — 84,415 sends in
 * twenty seconds — and the shape of the mistake is identical here.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { offlineEnabled } from './offlineFlag'
import { offlineStorageAvailable, storagePosture } from './notebookDb'
import { connectNotebookDb } from './useDurableNote'
import { listBlockedNoteIds } from './blockedNotes'

/** One shared empty set: a fresh `new Set()` each render is a new identity and
 *  would re-render every consumer forever. */
const EMPTY = new Set()

export function useBlockedNotes({
  accountId,
  connect = connectNotebookDb,
  /** Any value that changes when a drain has just settled. Changing it re-reads.
   *  ⛔ It cannot be `pending`: a blocked entry is KEPT, so the queue length does
   *  not move when an entry becomes blocked. `lastSummary` is a new object per
   *  completed drain, which is the signal that actually fires. */
  refreshToken = null,
} = {}) {
  const supported = Boolean(offlineEnabled() && offlineStorageAvailable() && accountId)
  const [blocked, setBlocked] = useState(EMPTY)
  const [persisted, setPersisted] = useState(null)
  // ⛔ Synced in an EFFECT, not during render. `useOutboxDrain` writes its
  // latest-refs inline and predates the `react-hooks/refs` rule; new code that
  // copied that shape trips it. The ref already holds the mount-time value, and
  // this effect is declared BEFORE the one that calls `refresh`, so the first
  // read is never stale.
  const connectRef = useRef(connect)
  useEffect(() => { connectRef.current = connect }, [connect])

  const refresh = useCallback(async () => {
    // ⛔ Returns rather than clearing state. "Not supported ⇒ nothing is
    // blocked" is DERIVED at the return below, so there is no second copy of
    // that rule to fall out of step — and no synchronous setState inside an
    // effect, which is a real cascading-render hazard and not merely a lint
    // preference.
    if (!supported) return EMPTY
    try {
      const db = await connectRef.current(accountId)
      const ids = await listBlockedNoteIds(db)
      const next = ids.length ? new Set(ids) : EMPTY
      // Only publish a genuinely different set — a new Set with the same
      // members would re-render every card on every drain tick.
      setBlocked((prev) => (sameMembers(prev, next) ? prev : next))
      return next
    } catch {
      // A store we cannot read is not a store we make claims about.
      return EMPTY
    }
  }, [supported, accountId])

  // The read IS the "subscribe to an external system" shape the rule asks for:
  // `refresh` touches no state synchronously — every `setBlocked` happens in the
  // callback after `await connect(...)`, and it publishes only a genuinely
  // different set. The rule cannot see across the await, so this is a
  // conservative false positive, narrowed to the one line.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refresh() }, [refresh, refreshToken])

  useEffect(() => {
    if (!supported) return undefined
    let cancelled = false
    storagePosture()
      .then((p) => { if (!cancelled) setPersisted(p.persisted) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [supported])

  // ⛔ The gate is applied HERE, once, to what callers actually read. A member
  // who opts out mid-session must stop seeing the badge on the next render,
  // and that must not depend on a cleanup path having run.
  return { supported, blocked: supported ? blocked : EMPTY, persisted, refresh }
}

function sameMembers(a, b) {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}
