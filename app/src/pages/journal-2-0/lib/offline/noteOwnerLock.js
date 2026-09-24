/**
 * Wave 6 · D3b — THE PER-NOTE OWNER LOCK. "This note is open in an editor", in
 * a form EVERY tab of the origin can see.
 *
 * ⚰️ THE DEFECT (`wave5-A-report.md`, concern 2; `f5-fixes-2026-09-23.md` §B.5).
 * The sweep skips the note the editor owns — but `excludeNoteId` is PER MOUNT,
 * and only the leading tab sweeps. With the note open in tab A and tab B
 * leading, B's sweep sent A's queued words while A's editor, which adopts and
 * sends those same words itself (F5P-1), was still their writer. A's own send
 * then 409'd against its own words and forked the member's note. Two writers on
 * one note: a duplicate at best, which is exactly what Wave Q1 forbids.
 *
 * ⭐ A Web Lock per note, held for as long as the note is open in an editor, is
 * visible to `navigator.locks.query()` in every tab — so whichever tab leads can
 * skip it. The browser releases a lock when its document goes away (a crash, a
 * killed process, a closed tab), which is the whole reason it is a lock and not
 * a heartbeat: ⛔ there is no timeout on top of that, on purpose.
 *
 * ⛔⛔ WHERE WEB LOCKS ARE MISSING (an old engine, an insecure context) NOTHING
 * HERE THROWS AND NOTHING CHANGES: no lock is taken, `ownedNoteIds` answers
 * `null`, and a `null` means "unknown" — the sweep then decides exactly as it
 * did before D3b (`excludeNoteId` alone). An unknown is never read as "owned"
 * and never as "not owned". (Without Web Locks no tab leads, so no tab sweeps.)
 */

const PREFIX = 'uct-note-owner:'

/** `uct-note-owner:<accountId>:<noteId>` — the name IS the claim. */
export const noteOwnerLockName = (accountId, noteId) => `${PREFIX}${accountId}:${noteId}`

/**
 * Hold this note's owner lock while it is open in an editor.
 *
 * Exclusive, as ruled: a second tab opening the same note queues behind the
 * first — and a QUEUED request is reported by `query()` too, so the note reads
 * as owned either way.
 *
 * ⭐ Released on `pagehide` (a page going into the back-forward cache must not
 * keep claiming a note nobody can type into) and taken again on a `pageshow`
 * that restores it. Released for good by the returned function (unmount).
 *
 * @returns release() — idempotent, never throws
 */
export function holdNoteOwnerLock(accountId, noteId, {
  locks = globalThis.navigator?.locks,
  target = typeof window === 'undefined' ? null : window,
} = {}) {
  if (!accountId || !noteId || typeof locks?.request !== 'function') return () => {}
  const name = noteOwnerLockName(accountId, noteId)
  let current = null
  let closed = false

  const acquire = () => {
    if (closed || current) return
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    let releaseHeld = () => {}
    const held = new Promise((r) => { releaseHeld = r })
    current = {
      // ⛔ Both halves: an abort cancels a request still QUEUED behind another
      // tab; resolving `held` releases one already granted. Either alone leaves
      // the other state claiming the note after this editor has gone.
      release: () => {
        try { controller?.abort() } catch { /* nothing queued */ }
        releaseHeld()
      },
    }
    try {
      const p = locks.request(
        name,
        controller ? { mode: 'exclusive', signal: controller.signal } : { mode: 'exclusive' },
        () => held,
      )
      // ⛔ An aborted or refused request REJECTS; unhandled, that is noise in
      // every console and a crash in a strict harness. It is not an error here.
      if (p && typeof p.catch === 'function') p.catch(() => {})
    } catch {
      current = null   // a request that throws (SecurityError…) is no lock, and no crash
    }
  }
  const drop = () => {
    const h = current
    current = null
    if (h) h.release()
  }
  const onPageHide = () => drop()
  const onPageShow = (e) => { if (e?.persisted) acquire() }
  try {
    target?.addEventListener?.('pagehide', onPageHide)
    target?.addEventListener?.('pageshow', onPageShow)
  } catch { /* no lifecycle events here — the unmount release still runs */ }
  acquire()

  return () => {
    if (closed) return
    closed = true
    try {
      target?.removeEventListener?.('pagehide', onPageHide)
      target?.removeEventListener?.('pageshow', onPageShow)
    } catch { /* already gone */ }
    drop()
  }
}

/**
 * → the ids of this account's notes whose owner lock is HELD or QUEUED in any
 * tab of the origin, or `null` when the browser cannot say.
 *
 * ⛔ `null` IS NOT AN EMPTY SET. Empty means "no note is open anywhere"; null
 * means "unknown", and the sweep must then decide as it did before D3b. The
 * same distinction `liveSessionIds` draws, for the same reason.
 */
export async function ownedNoteIds(accountId, { locks = globalThis.navigator?.locks } = {}) {
  if (!accountId || typeof locks?.query !== 'function') return null
  try {
    const snapshot = await locks.query()
    const prefix = `${PREFIX}${accountId}:`
    const out = new Set()
    for (const l of [...(snapshot?.held || []), ...(snapshot?.pending || [])]) {
      const n = typeof l?.name === 'string' ? l.name : ''
      if (n.startsWith(prefix) && n.length > prefix.length) out.add(n.slice(prefix.length))
    }
    return out
  } catch { return null }
}

/** true / false, or `null` when unknown — the shape `drainOutbox`'s
 *  `noteIsOwned` takes. Asked FRESH on every call: a note can open mid-drain. */
export async function isNoteOwned(accountId, noteId, opts) {
  const owned = await ownedNoteIds(accountId, opts)
  return owned === null ? null : owned.has(String(noteId))
}
