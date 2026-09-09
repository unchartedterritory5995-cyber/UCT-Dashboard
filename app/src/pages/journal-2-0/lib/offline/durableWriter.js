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
  let inFlight = null           // { generation }
  let timer = null
  let status = IDLE
  let destroyed = false

  const setStatus = (next, extra = {}) => {
    status = next
    if (onStatus) onStatus(next, { generation: committed, ...extra })
  }

  const startWrite = async () => {
    if (destroyed || inFlight || !desired) return
    const job = desired
    desired = null
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
      if (desired) {
        // Edits arrived while we were writing: ONE follow-up for the newest
        // state, not a replay of every intermediate snapshot.
        startWrite()
      } else {
        setStatus(DURABLE)
      }
    } catch (e) {
      inFlight = null
      // ⛔ The snapshot is NOT dropped — it stays desired so a later schedule
      // or flush can retry it. Losing the intent because the write failed is
      // the failure mode this whole layer exists to prevent.
      if (!desired || desired.generation < job.generation) desired = job
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
     *  a lifecycle signal. ⛔ Never the only durability mechanism. */
    flush() {
      if (timer) { clearTimer(timer); timer = null }
      return startWrite()
    },

    /** True once the newest scheduled state is actually on disk. */
    isDurable() {
      return !destroyed && desired === null && inFlight === null && committed === generation
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
