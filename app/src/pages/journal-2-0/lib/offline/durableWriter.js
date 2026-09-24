/**
 * Wave Q1 — the coalescing, order-safe writer that stands between a keystroke
 * and IndexedDB. Storage-agnostic on purpose: it owns TIMING and ORDER, the
 * adapter owns bytes.
 *
 * ⚰️⚰️ WHY IT EXISTS AT ALL, AND IT IS A MEASUREMENT NOT A PREFERENCE.
 * Measured in Chrome 152 on the production origin, a realistic 48 KB note
 * document, warm path, 40 writes:
 *
 *     IndexedDB     p50 282.6 ms   p95 800.7 ms   max 1,288.6 ms
 *     localStorage  p50   1.0 ms                  max    15.9 ms
 *
 * IndexedDB is ~280x slower at p50 and its p95 is as long as the ENTIRE 800 ms
 * server autosave debounce. A per-keystroke durable write would enqueue
 * transactions faster than they commit, and the queue would grow for as long as
 * the member kept typing. So writes are debounced (~200 ms) and COALESCED: the
 * durable goal is the member's LATEST state, never a transaction per edit.
 *
 * ⛔ CHROME-MEASURED INITIAL OPERATING POINT. Safari/iOS and Firefox are not
 * measured yet; the debounce is a starting value, not a universal fact.
 *
 * ⭐ QW-3 (competitive audit, 2026-09-22) asked the natural follow-up: does
 * that 282.6ms/800.7ms/1,288.6ms number hold at MAX_BODY_JSON_BYTES (1MB),
 * 20x the 48KB sample? Measured in a real Chrome tab (raw IndexedDB, same
 * two-store one-transaction shape as putNoteWithIntent, same 40-write/
 * warm-path methodology), isolating SIZE as the only variable by comparing
 * a trivial ~108-byte doc against a ~1,000,000-byte one on the SAME origin:
 *
 *     ~108 B    p50   0.5 ms   p95   0.7 ms   max   1.1 ms
 *     ~1 MB     p50   5.8 ms   p95  11.3 ms   max  17.8 ms
 *
 * ⛔ Size is NOT the dominant cost. Across ~9,300x more data, p50 grew by
 * only ~5.3ms -- negligible next to the 200ms debounce and nowhere near the
 * production-measured 282ms/800ms figures above. That means the original
 * 48KB number was never really testing "48KB of data"; the transaction/
 * commit round-trip is what costs hundreds of ms, and this measurement's
 * own environment (a fresh local origin with ~0 existing IndexedDB usage)
 * is NOT what produced it -- the production origin these 48KB numbers came
 * from already held **558MB in `uct_bars_v1` on the same origin** (Q0 Gate 3,
 * `docs/notebook/wave-q0-architecture.md`), which is the far more likely
 * driver of that 280x-slower-than-localStorage result than document size
 * ever was.
 *
 * ⛔ WHAT THIS DOES NOT SETTLE: a real 1MB write's cost on a production
 * origin under real storage pressure -- a low-pressure local sandbox
 * structurally cannot reproduce the thing that most plausibly dominates the
 * original number, so this is reported as a genuine gap rather than papered
 * over with a locally-clean re-run. If an absolute production figure is
 * needed, it needs the SAME rig/origin the 48KB number came from, not a
 * fresh local database.
 *
 * ⭐ Practical upshot: this WIDENS the debounce design's safety margin
 * rather than narrowing it. The risk this file's debounce/coalescing exists
 * to manage was never "a big note is slow to write" -- it is whatever the
 * production origin's own storage pressure costs, at any note size, and
 * that was already priced into the 48KB measurement above.
 *
 * ⛔ ORDER IS ENFORCED, NOT ASSUMED. Every scheduled state carries a monotonic
 * generation, and a completion may only ever advance the committed generation —
 * so a late callback for an older snapshot can never mark newer work durable,
 * and can never resurrect it either. Browser transaction timing is not an
 * application-intent guarantee.
 *
 * ⛔ NOTHING HERE DEPENDS ON `beforeunload` / `pagehide`. Those may accelerate a
 * flush; they may never be the reason work survives. The synchronous
 * localStorage draft owns the final crash window (see NoteEditorPage).
 */

/** What the member may truthfully be told about the local copy. */
export const IDLE = 'idle'          // nothing outstanding
export const PENDING = 'pending'    // scheduled, NOT yet durable — say nothing yet
export const WRITING = 'writing'    // in flight
export const DURABLE = 'durable'    // committed here; still not synced to UCT
export const FAILED = 'failed'      // ⛔ never claim "Saved on this device"

export const DEFAULT_DEBOUNCE_MS = 200

/**
 * @param persist  async ({ state, generation }) => void — the ATOMIC write
 *                 (working copy + its sync intent, one transaction)
 * @param debounceMs  the coalescing window
 * @param onStatus  (status, { generation, error }) => void
 * @param setTimer/clearTimer  injectable for deterministic rails
 */
export function createDurableWriter({
  persist,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  onStatus = null,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
} = {}) {
  if (typeof persist !== 'function') throw new Error('durableWriter: persist is required')

  let generation = 0            // every scheduled snapshot gets the next one
  let committed = 0             // only ever increases
  let desired = null            // { state, generation } — the newest intent
  // ⭐ D3b — snapshots a FLUSH promised to write, oldest first. A later
  // `schedule` never replaces one of these; see `flush`.
  const pinned = []
  let inFlight = null           // { generation }
  let timer = null
  let status = IDLE
  let destroyed = false

  const setStatus = (next, extra = {}) => {
    status = next
    if (onStatus) onStatus(next, { generation: committed, ...extra })
  }

  const startWrite = async () => {
    if (inFlight) return
    // ⛔ A destroyed writer starts no NEW work — but a snapshot a flush already
    // promised (the unmount flush, the fork fallback) is still written.
    if (destroyed && !pinned.length) return
    if (!pinned.length && !desired) return
    const fromPin = pinned.length > 0
    const job = fromPin ? pinned.shift() : desired
    if (!fromPin) desired = null
    inFlight = { generation: job.generation }
    setStatus(WRITING)
    try {
      await persist(job)
      // ⛔ MONOTONIC. A completion may only move `committed` forward. Two
      // in-flight writes are impossible by construction here, but a persist
      // implementation that resolves out of order must still not be able to
      // mark newer work durable — so this is a max(), not an assignment.
      committed = Math.max(committed, job.generation)
      inFlight = null
      if (pinned.length || desired) {
        // Edits arrived while we were writing: ONE follow-up for the newest
        // state, not a replay of every intermediate snapshot — after any
        // snapshot a flush pinned, which is written first, in order.
        startWrite()
      } else {
        setStatus(DURABLE)
      }
    } catch (e) {
      inFlight = null
      // ⛔ The snapshot is NOT dropped — it stays desired so a later schedule
      // or flush can retry it. Losing the intent because the write failed is
      // the failure mode this whole layer exists to prevent.
      if (fromPin) pinned.unshift(job)
      else if (!desired || desired.generation < job.generation) desired = job
      setStatus(FAILED, { error: e })
    }
  }

  return {
    /** Record the newest intent and arm the coalescing window. */
    schedule(state) {
      if (destroyed) return null
      generation += 1
      desired = { state, generation }
      if (status !== WRITING) setStatus(PENDING)
      if (timer) clearTimer(timer)
      timer = setTimer(() => { timer = null; startWrite() }, debounceMs)
      return generation
    },

    /** Write now — used by an explicit save, or as best-effort acceleration on
     *  a lifecycle signal. ⛔ Never the only durability mechanism.
     *
     * ⭐⭐ D3b (wave 6) — A FLUSH WRITES THE LATEST SNAPSHOT *AS OF THE FLUSH*,
     * EVEN WHEN A WRITE IS ALREADY IN FLIGHT.
     *
     * ⚰️ With a write in flight, `startWrite` returned early and the flushed
     * snapshot simply stayed `desired` — so the next `schedule` REPLACED it
     * before it was ever written. That is the residual the owner's refused-fork
     * fallback carried (`wave5-A-review.md`, re-review 2 (a); `f5-fixes` §D.4,
     * §E.3): it flushes the member's words typed during the fork, swaps the view
     * to the server copy, and the member's next keystroke on that copy — a
     * `schedule` — superseded the words before they reached the store. The
     * fix-6 guard then kept the OLDER record against the new view, and the
     * words were in no layer.
     * ⭐ So with a write in flight the snapshot is PINNED: written right after
     * that write, before anything scheduled later, which still follows it as
     * the one coalesced newest state. Never an older one, never dropped.
     */
    flush() {
      if (timer) { clearTimer(timer); timer = null }
      if (inFlight && desired) {
        pinned.push(desired)
        desired = null
        return undefined
      }
      return startWrite()
    },

    /** True once the newest scheduled state is actually on disk. */
    isDurable() {
      return !destroyed && desired === null && pinned.length === 0 && inFlight === null
        && committed === generation
    },

    status: () => status,
    committedGeneration: () => committed,
    latestGeneration: () => generation,

    destroy() {
      destroyed = true
      if (timer) { clearTimer(timer); timer = null }
    },
  }
}
