/**
 * Wave Q1 — THE IN-FLIGHT MARKER. One authority over "a save for this note is
 * on the wire right now, and the drain must not touch it."
 *
 * ⚰️ WHY THIS EXISTS, AND WHY THE PREVIOUS FIX WAS NOT ENOUGH (2026-09-10).
 *
 * Deploy #4 added `settleLandedSave`, which settles the queue store-direct
 * whether or not the editor is still mounted. The self-fork reproduced on the
 * rig EIGHT MINUTES after it went live. Two reasons, and both matter:
 *
 *   1. ⛔ IT WAS WIRED TO ONE SAVE PATH, AND NOT THE ONE THAT FORKS.
 *      `settleLandedSave` was called from `restoreDraft` — the rare, deliberate
 *      draft-restore — and NOT from `commitSave`, the debounced autosave that
 *      every keystroke reaches and that the defect actually rides. Eleven rails
 *      and four mutations all exercised the FUNCTION; nothing exercised the
 *      WIRE. Built, tested, green, and not on the path.
 *
 *   2. ⛔ THE SECOND GUARD COULD NOT FIRE IN ITS OWN WINDOW.
 *      The drain's supersede refusal asks `landedBaseline(record)`, which
 *      returns null for a DIRTY record — correctly, because a dirty record's
 *      baseline is what its next send will CLAIM. But in the window that guard
 *      was written for, nothing has settled, so the record IS dirty, so the
 *      answer is always "not superseded" and the drain sends. Two guards that
 *      share a precondition are ONE guard, and what stood between a member and
 *      a duplicate of their own note was whether the settle beat the drain.
 *      A race is not a guard.
 *
 * ⭐ THE MARKER IS DIFFERENT IN KIND. It does not depend on knowing what the
 * server did — it records that we ASKED, before we ask. The drain can therefore
 * decline to claim a note whose answer has not come back yet, which is the one
 * thing it could never work out for itself: that knowledge used to live only in
 * an in-flight promise inside a component that may already be unmounted.
 *
 * ⛔ A MARKER IS NOT A LOCK ON THE MEMBER'S WORK. It suppresses the DRAIN for
 * one note, briefly. It never blocks a save, never blocks the editor, and never
 * causes an entry to be discarded — expiry hands the decision to the 409
 * self-supersede check, which asks the server rather than guessing.
 */
import { usableBaseline } from './baseline'

/**
 * ⭐ 10 s = max PUT latency 997.6 ms × 10, measured 2026-09-10 against
 * production from the rig: n=30 real CAS PUTs, min 81.3 · p50 111.2 ·
 * p95 526.0 · max 997.6 ms. (Guard 2's per-409 GET, same method: n=30,
 * p50 76.1 · max 769.8 ms.)
 *
 * ⛔ `max × 10`, NOT `p95 × 10` (which would be 5.26 s), and the reason is the
 * shape rather than the summary. 24 of the 30 samples sit in a tight
 * 81–127 ms band and six form a tail out to 997.6 ms — and at n=30 the
 * nearest-rank p95 IS one sample. A durable staleness threshold built on a
 * single observation reads as measured and behaves as arbitrary.
 *
 * ⛔ THE ASYMMETRY DECIDES IT. Too high: a genuinely dead marker lingers a few
 * seconds before the heal clears it, and the 409 check catches the outcome
 * anyway. Too low: the heal fires WHILE A PUT IS STILL IN FLIGHT, which
 * re-opens the exact window this guard exists to close. A guard that can
 * pre-empt the operation it is guarding is worse than no guard.
 *
 * ⛔ Payload size does NOT drive the distribution — the 997.6 ms sample was a
 * 238-byte body and the 22 KB tier had the tightest max. The tail is cold
 * path / contention, not throughput, so scaling this by note size is wrong.
 *
 * ⚠️ WHAT THIS NUMBER IS NOT: one machine, one network, one 15-minute
 * off-hours window. It is a latency floor for a HEALTHY origin. A member on
 * hotel wifi or hitting a cold pod will exceed it — and that is survivable
 * precisely because expiry routes to the server check rather than to a send.
 * ⛔ Treat a future breach as a reason to RE-MEASURE, never to shrink this.
 */
export const IN_FLIGHT_TTL_MS = 10_000

/**
 * How long a save will wait for its marker to reach the store before giving up
 * and going to the network anyway.
 *
 * ⛔ A FRACTION OF THE TTL, DELIBERATELY. A marker that took longer than this to
 * write is already useless to a drain that is reading records now — and the
 * alternative, waiting, puts the member's ability to save behind IndexedDB
 * being responsive. p50 for a put here is ~1 ms; this is three orders of
 * magnitude of headroom and still a tenth of the staleness threshold.
 */
export const MARKER_WRITE_BUDGET_MS = 1_000


/**
 * ⛔ THE SYNC LOCK CANNOT ANSWER "IS THAT TAB STILL ALIVE".
 *
 * `navigator.locks.query()` reports an opaque `clientId` per holder, not our
 * `SESSION_ID`, and the sync lock is a LEADER election — one holder for the
 * whole account, unrelated to which tab issued a given save. Asking it whether
 * a marker's session still holds it would answer a different question and be
 * wrong in both directions: a live non-leader tab would look dead, and a marker
 * left by a dead leader would look alive as soon as another tab took over.
 *
 * ⭐ So each tab holds a lock NAMED AFTER ITSELF, for exactly as long as it
 * exists. Web Locks are released by the browser when the holder goes away —
 * including a crash or a killed process, which is the case a heartbeat or an
 * unload handler cannot cover. The name IS the identity, so the query answers
 * the question we actually have.
 */
export const sessionLockNameFor = (sessionId) => `uct.nb.session.${sessionId}`
const SESSION_LOCK_RE = /^uct\.nb\.session\.(.+)$/

/**
 * Hold this tab's liveness lock until the tab dies. ⛔ Never resolves on
 * purpose — resolving would release it. Failure is non-fatal: without the lock
 * the TTL simply decides alone, which is the documented degraded mode.
 */
export function holdSessionLock(sessionId, locks = globalThis.navigator?.locks) {
  if (!locks?.request || !sessionId) return false
  try {
    locks.request(sessionLockNameFor(sessionId), () => new Promise(() => {}))
    return true
  } catch { return false }
}

/**
 * → Set of sessionIds whose tabs are still alive, or `null` when the browser
 * cannot tell us. ⛔ `null` IS NOT AN EMPTY SET. Empty means "every marker is
 * stale"; null means "the TTL decides alone". Collapsing them would hand every
 * in-flight note straight to the drain on any browser without Web Locks.
 */
export async function liveSessionIds(locks = globalThis.navigator?.locks) {
  if (!locks?.query) return null
  try {
    const { held = [] } = await locks.query()
    const out = new Set()
    for (const l of held) {
      const m = SESSION_LOCK_RE.exec(l?.name || '')
      if (m) out.add(m[1])
    }
    return out
  } catch { return null }
}

/**
 * ⛔⛔ THE MARKER LIVES IN THE `meta` STORE, NOT ON THE NOTE RECORD.
 *
 * ⚰️ It was on the record first, and the existing rails rejected that — again
 * correctly. Stamping it there meant a read-modify-write on `notes` ON THE SAVE
 * PATH, contending with the durable writer's own writes to that same store; the
 * durable copy stopped being written at all. It also forced an awkward guard so
 * the marker-clear could not clobber the settle's full-record write.
 *
 * ⭐ A DIFFERENT STORE REMOVES BOTH PROBLEMS BY CONSTRUCTION. No contention with
 * the writer, no merge, nothing to clobber, and the marker's lifetime stops
 * being tangled with the note's. The drain reads one key.
 */
export const markerKeyFor = (noteId) => `inflight:${noteId}`

/**
 * ⛔⛔ WHAT THIS BROWSER HAS ALREADY LANDED, PER NOTE — guard 2's second arm.
 *
 * ⚰️ That arm shipped DEAD. `serverCopyIsOursDefault` accepted a
 * `landedRevisions` set and the drain called it with one argument, so the
 * condition could never fire and guard 2 recognised only byte-identical
 * bodies. That is precisely the case that does NOT cover the defect: once the
 * member keeps typing after a save lands, the bodies differ by construction,
 * and the only thing left that can identify the server copy as ours is the
 * revision we recorded when it landed.
 *
 * ⛔ A BOUNDED RING, NEWEST FIRST. Unbounded, this would grow for the life of
 * the note; length one would miss the ordering where two saves land close
 * together and the drain reads after the second. Five is small enough to be
 * free and long enough to cover every ordering measured.
 */
export const LANDED_KEY_PREFIX = 'landed:'
export const landedKeyFor = (noteId) => `${LANDED_KEY_PREFIX}${noteId}`
export const LANDED_RING = 5

/** → the new ring, newest first, deduped and capped. Pure, so it is testable. */
export function withLanded(ring, revision) {
  const rev = usableBaseline(revision)
  if (!rev) return Array.isArray(ring) ? ring : []
  const prev = Array.isArray(ring) ? ring.filter((r) => r !== rev) : []
  return [rev, ...prev].slice(0, LANDED_RING)
}

/** The marker a save writes before it issues its PUT. */
export function markerFor({ sessionId, baseUpdatedAt, now = Date.now() }) {
  if (!sessionId) return null
  // ⛔ NOT `?? null`. The one-authority rail forbids nullish-coalescing over a
  // baseline anywhere under journal-2-0, and it is right: `??` keeps `''`,
  // which reads PRESENT to a producer and ABSENT to a consumer. The authority
  // decides what a usable baseline is, here as everywhere.
  return { sessionId, startedAt: now, baseUpdatedAt: usableBaseline(baseUpdatedAt) }
}

/**
 * Is this marker still worth respecting?
 *
 * ⛔ TWO INDEPENDENT WAYS TO BE STALE, and they catch different deaths:
 *   · the writing session no longer holds the Web Lock ⇒ that tab is GONE.
 *     This is the precise answer and it is available whenever the caller can
 *     enumerate lock holders.
 *   · the marker is older than the TTL ⇒ the fallback, for every environment
 *     and every failure where the lock answer is unavailable or itself stale.
 * Either one expires it. ⛔ Never require BOTH: a browser that cannot answer
 * the lock question would then keep a dead marker alive for ever.
 *
 * @param holders  the set/array of sessionIds currently holding the sync lock,
 *                 or null when that cannot be determined (⇒ TTL decides alone)
 */
export function isMarkerLive(marker, { now = Date.now(), holders = null, ttlMs = IN_FLIGHT_TTL_MS } = {}) {
  if (!marker || typeof marker !== 'object') return false
  const { sessionId, startedAt } = marker
  if (!sessionId || !Number.isFinite(startedAt)) return false
  // ⛔ A marker stamped in the FUTURE is not live. Clock skew between a restored
  // tab and this one would otherwise pin a note open indefinitely.
  if (startedAt > now) return false
  if (now - startedAt >= ttlMs) return false
  if (holders !== null) {
    const set = holders instanceof Set ? holders : new Set(holders || [])
    // ⛔ Only DEMOTE on the lock answer, never promote: if the holder set says
    // this session is gone, the marker is dead even inside its TTL.
    if (!set.has(sessionId)) return false
  }
  return true
}

/** Why a marker was disregarded — for the drain's own report, never guessed at the call site. */
export function markerExpiry(marker, opts = {}) {
  if (!marker) return 'none'
  return isMarkerLive(marker, opts) ? 'live' : 'expired'
}
