/**
 * Wave Q1 — which of the three copies of a note is the member's newest work.
 *
 * On reopen there can be THREE:
 *
 *   SERVER          the canonical revision, identified by `updatedAt`
 *   IDB WORKING     the durable local copy, debounced ~200 ms behind the edit
 *   localStorage    the synchronous crash buffer, written on EVERY keystroke
 *
 * ⛔⛔ DO NOT SIMPLY PREFER INDEXEDDB BECAUSE IT IS "THE OFFLINE STORE".
 * localStorage is written synchronously on the keystroke and IndexedDB lags it
 * by the coalescing window, so within one session the draft can only ever be
 * EQUAL OR NEWER. Preferring IDB would silently regress a member's last ~200 ms
 * of typing — the exact window the crash buffer exists to hold.
 *
 * ⛔ ORDER COMES FROM AN EXPLICIT GENERATION, NOT A CLOCK. Wall-clock time moves
 * (NTP, timezone tools, a laptop resuming). A generation is only comparable
 * WITHIN a session, so the session id travels with it; across sessions we fall
 * back to timestamps and say so, rather than pretending the comparison is exact.
 */

/** A stable-enough id for "this page's editing session". */
export function newSessionId() {
  // ⛔ `crypto.randomUUID` is SECURE-CONTEXT ONLY — this repo has already been
  // bitten by that. Feature-detect and fall back rather than throw on http://.
  try {
    if (globalThis.crypto?.randomUUID && globalThis.isSecureContext !== false) {
      return globalThis.crypto.randomUUID()
    }
  } catch { /* fall through */ }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const authored = (o) => ({
  title: o?.title ?? '',
  subtitle: o?.subtitle ?? '',
  bodyJson: o?.bodyJson ?? null,
})

const sameAuthoredContent = (a, b) =>
  (a?.title ?? '') === (b?.title ?? '')
  && (a?.subtitle ?? '') === (b?.subtitle ?? '')
  && JSON.stringify(a?.bodyJson ?? null) === JSON.stringify(b?.bodyJson ?? null)

/**
 * @param server    the note as the server has it: {title, subtitle, bodyJson, updatedAt}
 * @param idbRecord the durable working copy, or null:
 *                  {title, subtitle, bodyJson, generation, sessionId, localSavedAt, baseUpdatedAt}
 * @param lsDraft   the synchronous draft, or null:
 *                  {title, subtitle, bodyJson, savedAt, generation?, sessionId?}
 *
 * @returns { source, state, baseUpdatedAt, unsynced, ambiguous, reason }
 */
export function chooseLocalRecovery({ server, idbRecord = null, lsDraft = null } = {}) {
  const serverState = authored(server)
  const serverBase = server?.updatedAt ?? null

  const candidates = []
  if (idbRecord) {
    candidates.push({
      source: 'idb',
      state: authored(idbRecord),
      baseUpdatedAt: idbRecord.baseUpdatedAt ?? serverBase,
      generation: Number.isFinite(idbRecord.generation) ? idbRecord.generation : null,
      sessionId: idbRecord.sessionId ?? null,
      at: Number.isFinite(idbRecord.localSavedAt) ? idbRecord.localSavedAt : null,
    })
  }
  if (lsDraft) {
    candidates.push({
      source: 'localStorage',
      state: authored(lsDraft),
      // ⛔ A legacy draft has no base of its own. It belongs to whatever the
      // server said when it was written, and the server is what we have now.
      baseUpdatedAt: lsDraft.baseUpdatedAt ?? serverBase,
      generation: Number.isFinite(lsDraft.generation) ? lsDraft.generation : null,
      sessionId: lsDraft.sessionId ?? null,
      at: Number.isFinite(lsDraft.savedAt) ? lsDraft.savedAt : null,
    })
  }

  const local = candidates.filter((c) => !sameAuthoredContent(c.state, serverState))
  if (!local.length) {
    return {
      source: 'server',
      state: serverState,
      baseUpdatedAt: serverBase,
      unsynced: false,
      ambiguous: false,
      reason: candidates.length
        ? 'every local copy matches the server — nothing to recover'
        : 'no local copy',
    }
  }
  if (local.length === 1) {
    return { ...local[0], unsynced: true, ambiguous: false, reason: 'the only local copy that differs from the server' }
  }

  const [a, b] = local
  // Same session → the generation is an exact answer.
  if (a.sessionId && a.sessionId === b.sessionId
      && a.generation != null && b.generation != null && a.generation !== b.generation) {
    const win = a.generation > b.generation ? a : b
    return { ...win, unsynced: true, ambiguous: false, reason: 'newer generation in the same session' }
  }
  // Same content in both — the choice does not matter, so do not dress it up.
  if (sameAuthoredContent(a.state, b.state)) {
    return { ...a, unsynced: true, ambiguous: false, reason: 'both local copies agree' }
  }
  // ⭐ STRUCTURAL TIE-BREAK. Within a session the synchronous draft is written
  // first and the durable copy lags it, so the draft can only be equal-or-newer.
  // Prefer it, and say the comparison was structural rather than exact.
  const draft = local.find((c) => c.source === 'localStorage')
  if (draft && a.sessionId && a.sessionId === b.sessionId) {
    return { ...draft, unsynced: true, ambiguous: false, reason: 'same session: the synchronous draft is written ahead of the durable copy' }
  }
  // Different sessions (or an unlabelled legacy draft): timestamps are all we
  // have, and they are a HINT. Take the newest and mark the answer ambiguous so
  // the surface can offer a choice instead of asserting one.
  const withTime = local.filter((c) => c.at != null)
  if (withTime.length === 2 && withTime[0].at !== withTime[1].at) {
    const win = withTime[0].at > withTime[1].at ? withTime[0] : withTime[1]
    return { ...win, unsynced: true, ambiguous: true, reason: 'different sessions — newest timestamp, which is a hint not a proof' }
  }
  return {
    ...(draft || a),
    unsynced: true,
    ambiguous: true,
    reason: 'two local copies that cannot be ordered — the member should choose',
  }
}
