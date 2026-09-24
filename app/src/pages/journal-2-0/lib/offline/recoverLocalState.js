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

import { usableBaseline, isSupersededBaseline } from './baseline'
import { APPEND_ONLY, classifyServerChange, lastKnownServerCopy } from './serverChange'

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

/**
 * Do two copies hold the same authored content? ⛔ ONE authority for this
 * question: recovery uses it to decide whether there is anything to recover,
 * and the sync path uses it to decide whether a server ack actually caught up
 * with what the member has typed since. Two answers to that would let a note be
 * marked "synced" while the editor holds newer words.
 */
export const sameAuthoredContent = (a, b) =>
  (a?.title ?? '') === (b?.title ?? '')
  && (a?.subtitle ?? '') === (b?.subtitle ?? '')
  && JSON.stringify(a?.bodyJson ?? null) === JSON.stringify(b?.bodyJson ?? null)

/**
 * ⛔⛔ Q1 FIX 6 — WOULD RECONCILING THIS RECORD CLEAN DISCARD UNSENT WORK?
 *
 * `putNoteWithIntent` deletes every queued entry for a note when the record it
 * is handed is CLEAN and the intent is null. That is correct when the note
 * really has nothing left to say, and it is the whole defect when it does.
 *
 * ⚰️ MEASURED, not reasoned — `q1AppendWriterCensus.test.jsx`, spy call 1:
 * `persist` (in `useDurableNote.js`) wrote `dirty 1 -> 0` with a NULL intent on
 * the append route, taking `queued 1 -> 0` and `sentence-in-record true ->
 * false` with it. The words were not on the server, were not forked to a
 * sibling, and were not in the queue. They were gone.
 *
 * ⛔ Corroborated three ways before it was written down: the spy's stack, an
 * acorn parse (`node tools/q1_clean_write_sweep.mjs`) and `grep -n` all name
 * the same call site. No line number is repeated HERE, because a line number
 * in a comment drifts on the next edit — ask the sweep.
 *
 * ⛔⛔ ONE AUTHORITY, AND THAT IS THE POINT OF EXTRACTING IT.
 * `settleLandedSave` already enforced exactly this (Q1 fix 4) and `persist` did
 * not, so the SAME invariant had one implementation and one hole. Two copies
 * could not have been mutation-proved as one thing
 * (`lesson_a_guard_repeated_is_a_guard_unproved`), and the hole was invisible
 * precisely because the other copy looked like coverage. Both writers now ask
 * THIS function.
 *
 * ⛔ WHY IT IS NOT `putNoteWithIntent`'s GUARD. That guard reads the record it
 * is HANDED (`else if (noteRecord.dirty)`), so a writer that flips dirty 1 -> 0
 * in the same write walks straight past it. This one reads the record already
 * IN THE STORE, which is the only place the unsent work still exists at that
 * moment. The two are complementary and both stay.
 *
 * @param prev      the durable record as the store currently holds it, or null
 * @param incoming  the content about to be written over it
 * @returns true when `prev` is carrying words `incoming` does not have
 */
export function discardsUnsentWork(prev, incoming) {
  // ⛔ A CLEAN `prev` HAS NOTHING OWED. Treating an absent or clean record as
  // unsent work would keep every note dirty forever — the failure direction
  // that breaks sync rather than the one that loses words.
  if (!prev || !prev.dirty) return false
  if (sameAuthoredContent(incoming, prev)) return false
  // ⭐⭐ D3 (wave 5) — WHAT LANDED MAY HOLD `prev`'S WORDS *AND* THE SERVER'S OWN
  // APPENDS, AND THAT IS NOT A DISCARD.
  //
  // ⚰️ MEASURED (`offlineWordsSurvive.property.test.jsx`, "the editor merged it
  // and saved"). A door appended a block while the member held unsent words; the
  // editor merged the block in and saved, so the server now holds prev's words
  // PLUS the block. Strict equality answered "unsent work", the settle kept the
  // record dirty with a queued entry lacking the block, and the drain later
  // re-sent it — a spurious `(conflicted copy)` of a note only this member
  // touched (and, before this wave's `serverBase` fix, the block was dropped).
  //
  // ⛔ PROVEN, NEVER GUESSED — and proven by the DRAIN'S OWN CLASSIFIER, asked
  // rather than restated (review N2, fix round 1): "`incoming` is `prev` plus
  // blocks only the server appends, at the tail, with the title and subtitle
  // untouched" is exactly `classifyServerChange(incoming, prev) === APPEND_ONLY`.
  // A second spelling of that rule here had already drifted (`?? ''` against the
  // classifier's `str()`), and the day authored content gains a field the
  // classifier learns it and this would not. Anything else is still a discard:
  // a changed paragraph, a moved block, a member-typed tail, a title edit.
  return classifyServerChange(incoming, prev) !== APPEND_ONLY
}

/** Flatten a record to the words a member would recognise as theirs. */
const authoredText = (o) => {
  const walk = (n) => {
    if (!n || typeof n !== 'object') return ''
    let out = typeof n.text === 'string' ? n.text : ''
    if (Array.isArray(n.content)) out += n.content.map(walk).join('')
    return out
  }
  return `${o?.title ?? ''} ${o?.subtitle ?? ''} ${walk(o?.bodyJson)}`
}

/**
 * ⛔⛔ THE SAME INVARIANT, ASKED OF A WRITE WHOSE PROVENANCE IS THE EDITOR.
 *
 * ⚰️ WHY THERE ARE TWO OF THESE, WHICH LOOKS LIKE THE DEFECT THIS FILE EXISTS TO
 * PREVENT AND IS NOT.
 *
 * Fix 6 gave `persist` and `settleLandedSave` ONE predicate, on the grounds that
 * one invariant deserves one authority. That was right about the invariant and
 * wrong about the question, because the two callers are handed DIFFERENT KINDS OF
 * THING:
 *
 *   settleLandedSave   `incoming` is what the SERVER ACKED — a CLAIM, and a door
 *                      passing local state as `acked` is exactly the lie fix 4
 *                      was built to catch. Any divergence from `prev` must block.
 *   persist            `incoming` is the EDITOR'S OWN CONTENT. A member typing
 *                      MORE diverges from `prev` too — in the direction where
 *                      nothing is lost.
 *
 * ⚰️ MEASURED 2026-09-18 (`fix6KeepsTyping.test.js`). With one symmetric
 * predicate, `persist` computed `source = prev` on every keystroke after a note
 * went dirty, so a member with unsent work who kept typing had their newer words
 * written nowhere. The editor kept showing them; a reload did not.
 *
 * ⛔ AND THE OBVIOUS SINGLE FIX IS WRONG. Making the ONE predicate directional
 * fixes `persist` and breaks `settleLandedSave`: a door passing local state as
 * `acked` also carries `prev`'s words, so the queue clears and unsent work is
 * deleted. Measured, not predicted — `selfForkDoors.test.jsx` went 11 passed to
 * 1 failed, and running it against the parent commit proved the regression was
 * the change's and not master's.
 *
 * ⭐ So the split is BY PROVENANCE, not by convenience, and the two functions are
 * deliberately adjacent with this note between them so nobody "tidies" them back
 * into one. `lesson_a_guard_repeated_is_a_guard_unproved` warns against two
 * copies of ONE question; this is two DIFFERENT questions that share an invariant.
 *
 * ⚠️ A DELETION STILL READS AS A DISCARD, DELIBERATELY. A member who deletes text
 * offline produces content that no longer carries `prev`'s words, and this answers
 * true, keeping the longer copy. That is the pre-existing behaviour and the
 * correct failure direction for a system whose charter is never to lose words.
 * Narrowing it needs its own evidence.
 *
 * @param prev      the durable record as the store holds it, or null
 * @param incoming  content from the EDITOR about to be written over it
 * @returns true when `incoming` no longer carries what `prev` was holding
 */
export function editorStateDiscardsUnsentWork(prev, incoming) {
  if (!prev || !prev.dirty) return false
  if (sameAuthoredContent(incoming, prev)) return false
  // ⛔ CARRIES, not EQUALS. This one word is the whole difference between the
  // member typing more and something handing us a copy that never saw the words.
  return !authoredText(incoming).includes(authoredText(prev))
}

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
  const serverBase = usableBaseline(server?.updatedAt)

  const candidates = []
  if (idbRecord) {
    candidates.push({
      source: 'idb',
      state: authored(idbRecord),
      baseUpdatedAt: usableBaseline(idbRecord.baseUpdatedAt, serverBase),
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
      baseUpdatedAt: usableBaseline(lsDraft.baseUpdatedAt, serverBase),
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

/**
 * ⭐⭐ D3 / F5P-1 — QUEUED WORK IS SENT BY THE NOTE'S OWNER, NOT OFFERED.
 *
 * ⚰️ THE STATE THIS ENDS (`q1-product-followups.md`, F5P-1). A member queued
 * words offline, came back to the note, and sat on it. The sweep skips the note
 * the editor owns (`excludeNoteId` -- two writers on one note is what Wave Q1
 * forbids), and the editor reopened on the SERVER's copy and put the member's
 * words behind a Restore/Discard banner. Nobody sent them; measured on
 * production, nothing left for 120 s, and nothing would have.
 *
 * ⭐ WHY "OFFER" WAS THE WRONG VERB FOR THIS COPY. The banner exists for a crash
 * draft: words that never reached the queue, which silently preferring could
 * clobber. QUEUED words are different in kind: the member already committed them
 * to the server, the sweep sends them WITHOUT asking the moment the note closes,
 * and compare-and-set on their own baseline makes sending them unable to clobber
 * anything -- the server 409s and the classifier decides rebase / merge / fork.
 * So the owner does exactly what the sweep would, through its own save.
 *
 * ⛔ THIS ONLY DECIDES. It is a pure answer about what the durable store holds;
 * the editor applies it. Null means "not provably queued work -- offer it as
 * before", never "nothing to do".
 *
 * @param decision  what `chooseLocalRecovery` returned
 * @param record    the DIRTY durable record, or null
 * @param entry     that note's queued outbox entry, or null
 * @returns null, or { state, base }:
 *   state  the member's queued words -- what the editor must now hold
 *   base   the server copy those words were written ON, with its revision. ⛔ The
 *          editor's baseline becomes THIS, never the server's current revision:
 *          sending the queued body on the current revision would succeed without
 *          a 409 and silently drop whatever a door appended in between.
 */
export function queuedWorkToAdopt({ decision, record = null, entry = null } = {}) {
  if (!decision?.unsynced || decision.ambiguous) return null
  if (!record?.dirty || !entry) return null
  // ⛔ A BLOCKED entry is retired from sending on purpose; its badge asks the
  // member to act. Auto-sending it would be the retry it was retired from.
  if (entry.permanent || entry.noteId !== record.noteId) return null
  // ⛔ EXACTLY what is queued. A winning copy that differs from the record (a
  // crash draft ahead of it, two copies from different sessions) is the case the
  // banner is for: the member chooses. The entry and the record are written in
  // one transaction, so a disagreement between them is also a reason to ask.
  if (!sameAuthoredContent(decision.state, record)) return null
  if (!sameAuthoredContent(entry.patch, record)) return null
  // ⛔ The base must also not be NEWER than the entry's revision (review N4). That
  // check lives in `baseOfRecovered`, ONE place, so Restore asks it too — see there.
  const base = baseOfRecovered({ decision, record, entry })
  // ⛔ D3b: a base whose BODY is unknown (the fork-safe fallback) is for a
  // Restore the member chose, never for sending by ourselves: against it every
  // move of the server forks, and nobody asked for that fork. Offered instead.
  if (!base || base.bodyUnknown) return null
  return { state: authored(record), base }
}

/**
 * ⭐ D3b — a base known only by its REVISION. Restoring on it sends the words on
 * that revision, so a server that moved 409s; and the editor's reconcile then
 * classifies the server's copy against a base with no body, which can only read
 * BODY_REWRITE ("missing evidence is never a licence to merge",
 * `classifyServerChange`) — so it FORKS. Never a merge it cannot prove, never an
 * overwrite. The null body is what makes a Restore on it safe; `bodyUnknown` is
 * what lets `queuedWorkToAdopt` refuse to send on it by itself.
 */
function revisionOnlyBase(at) {
  return at ? { title: '', subtitle: '', bodyJson: null, updatedAt: at, bodyUnknown: true } : null
}

/** The OLDEST revision among the candidates, or null. Older is the safe
 *  direction here: a send on an older revision can only 409 more often.
 *  ⛔ Ordered PARSED; a lone usable candidate that does not parse is still the
 *  only revision known (it is what a direct PUT would have sent), but two that
 *  cannot be ordered are not guessed between. */
function oldestRevision(...candidates) {
  const usable = [...new Set(candidates.map((c) => usableBaseline(c)).filter(Boolean))]
  const parsed = usable.filter((at) => Number.isFinite(Date.parse(at)))
  if (!parsed.length) return usable.length === 1 ? usable[0] : null
  return parsed.reduce((oldest, at) => (isSupersededBaseline(at, oldest) ? at : oldest))
}

/**
 * ⭐ D3 — WHICH SERVER COPY WAS THE RECOVERED WORK WRITTEN ON? One authority,
 * asked by `queuedWorkToAdopt` and by the banner's Restore.
 *
 * ⚰️ MEASURED on the real editor, 2026-09-23 (wave 5): Restore sent the recovered
 * copy on its own baseline, the server had moved, the PUT 409'd — and the editor
 * was left holding the recovered words on the SERVER'S CURRENT revision. The
 * member's next keystroke autosaved them over the other device's words: 0 forks,
 * the other copy gone. With an append door instead, the captured block is gone.
 * The editor could not do better, because nothing told it what the recovered
 * words were written on. This does.
 *
 * ⛔⛔ AND IT MUST NOT BE NEWER THAN THE QUEUED ENTRY'S REVISION (review N4,
 * fix rounds 1-3). A record written by the settle BEFORE A-1 carries
 * `acked@landed` as its base — a copy that already holds a door's appended
 * block — while its entry still sits on the OLDER revision the words were really
 * written on. Adopting on that base sends the queued body at `landed`: a 200,
 * and the block is gone. So a base NEWER than the entry is refused, by EITHER
 * caller: `queuedWorkToAdopt` then offers the banner, and the banner's Restore
 * falls back to its path for a copy with no known base.
 * ⭐ A base OLDER than the entry is a legitimate shape and is used, exactly as
 * `fe4e278bc` did (fix round 3, controller ruling on N4-b). Diffing the server
 * against an OLDER copy can only see MORE change, so the 409 rebases, merges or
 * forks — it can never hide an append. It happens without anything being wrong:
 * the editor's 409 reconcile moves `lastSavedRef` forward and the retry does not
 * land, so the next durable write takes the newer baseline while the record
 * keeps its older last-known copy; and the drain's ring-vouched rebase moves the
 * entry but never sees the server's document, so it leaves the base alone.
 * ⚠️ A base NEWER than the entry is not always poison either: a drain rebase
 * that learned the server's copy moves the entry and the base together, and a
 * later unsent-work settle then re-derives the entry's baseline from the
 * record's older one. That shape cannot be told apart from the poisoned one by
 * direction, so its body is refused too.
 * ⭐⭐ D3b (wave 6) — REFUSING THE BODY IS NOT REFUSING THE REVISION. Until D3b a
 * refused base was null, Restore took its path for a copy with no known base (a
 * direct PUT that 409s into an error, leaving the editor on the server's current
 * revision), and the member's next keystroke overwrote the other device — the
 * crash-draft class (`f5-fixes-2026-09-23.md` §C.5, §E.1). Now, when the body
 * cannot be used but the revision the words were written on CAN be proved (the
 * entry's, or the record's own — the OLDEST of them, which can only 409 more
 * often), the answer is a REVISION-ONLY base (`revisionOnlyBase`): Restore sends
 * on it, a moved server 409s, and the reconcile forks. Never a clobber.
 * ⭐ D3b — AND A CRASH DRAFT THAT WON RECORDS ITS OWN BASE. The editor writes the
 * revision it was typed on into the draft (`baseUpdatedAt`); a copy of the server
 * at exactly that revision — the record's last-known copy, or the server's own
 * when it has not moved — gives the full base, otherwise it is revision-only. ⛔ A
 * draft written before D3b has no recorded base, and nothing is guessed for it:
 * null, and Restore keeps its old path.
 * ⛔ Compared PARSED, through the same authority the drain uses
 * (`isSupersededBaseline`), never as strings. Only an equal revision or a base
 * PROVABLY older is used as a full base; newer, unparseable, or an entry with no
 * baseline falls to the revision-only answer.
 * ⚠️ Without an entry there is nothing to compare against, and the record's own
 * base is returned as before.
 *
 * @param entry   that note's queued outbox entry, or null
 * @param draft   the crash draft as read from localStorage, or null (⛔ null
 *                whenever the wave is off — `recover()` decides that)
 * @param server  the server's current copy, or null — used ONLY when its
 *                revision is exactly the draft's recorded one
 * @returns { title, subtitle, bodyJson, updatedAt } — a server copy at the
 *          revision the recovered words were written on; or, when only that
 *          revision is provable, the same shape with a null body and
 *          `bodyUnknown: true`; or null when not even that is provable (no local
 *          winner, a record with no usable revision, a draft with no recorded
 *          base). ⛔ Null means "not known", and the caller must not invent one
 *          from the server's current copy.
 */
export function baseOfRecovered({
  decision, record = null, entry = null, draft = null, server = null,
} = {}) {
  if (!decision?.unsynced) return null
  if (record?.dirty && sameAuthoredContent(decision.state, record)) {
    const base = lastKnownServerCopy(record)
    const at = usableBaseline(base?.updatedAt)
    const entryAt = entry ? usableBaseline(entry.baseUpdatedAt) : null
    // "the base is older than the entry" is `isSupersededBaseline(base, entry)`.
    if (base && at && (!entry || at === entryAt || isSupersededBaseline(at, entryAt))) {
      return { ...authored(base), updatedAt: at }
    }
    return revisionOnlyBase(oldestRevision(entry?.baseUpdatedAt, record.baseUpdatedAt))
  }
  if (draft && sameAuthoredContent(decision.state, draft)) {
    const at = usableBaseline(draft.baseUpdatedAt)
    if (!at) return null
    for (const copy of [lastKnownServerCopy(record), server]) {
      if (copy && usableBaseline(copy.updatedAt) === at) return { ...authored(copy), updatedAt: at }
    }
    return revisionOnlyBase(at)
  }
  return null
}
