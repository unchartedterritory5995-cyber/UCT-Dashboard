// rAF coalescer for the live-tick fan-out (Phase C prerequisite "A1").
//
// realtimeCandle._notify(sym) currently invokes every subscriber SYNCHRONOUSLY on
// each tick. At the current 4Hz SSE poll that is fine, but a real push feed
// (Phase C) can deliver many ticks per animation frame — applying each one
// synchronously (series.update) thrashes layout. This coalesces per-key marks so
// each key's action runs at most ONCE per frame, always with the latest state
// (the flush callback reads current state via getCandle, so no data is carried
// through — only the key). Coalescing to the latest is correct for a developing
// bar: you only ever need the newest value.
//
// PURE + injectable: `schedule` defaults to requestAnimationFrame, with a
// setTimeout(0) fallback for jsdom/SSR/tests. Nothing here is wired into shipped
// code yet — this module has zero call sites (grep-verifiable) so it is a no-op
// on runtime until Phase C Step 1 wires it into _notify (behind an instant kill).

/**
 * Create a per-key rAF coalescer.
 * @param {(key: any) => void} flushFn - invoked once per dirty key per frame.
 * @param {{ schedule?: (cb: () => void) => any, cancel?: (h: any) => void }} [opts]
 * @returns {{ mark(key): void, flushNow(): void, cancel(): void, pending(): number }}
 */
export function createRafCoalescer(flushFn, opts = {}) {
  if (typeof flushFn !== 'function') throw new TypeError('createRafCoalescer: flushFn required')
  const schedule = opts.schedule
    || (typeof requestAnimationFrame === 'function'
      ? (cb) => requestAnimationFrame(cb)
      : (cb) => setTimeout(cb, 0)) // jsdom / SSR / test fallback
  const cancelScheduled = opts.cancel
    || (typeof cancelAnimationFrame === 'function' ? (h) => cancelAnimationFrame(h) : (h) => clearTimeout(h))

  const dirty = new Set()
  let handle = null // non-null while a flush is scheduled

  function flush() {
    handle = null
    // Snapshot + clear FIRST so a flushFn that re-marks (re-entrancy) schedules a
    // fresh frame instead of being dropped or looping within this flush.
    const keys = [...dirty]
    dirty.clear()
    for (const k of keys) {
      try { flushFn(k) } catch { /* one bad subscriber must not kill the batch */ }
    }
  }

  return {
    // Mark a key dirty and ensure a single flush is scheduled for this frame.
    mark(key) {
      dirty.add(key)
      if (handle != null) return
      handle = schedule(flush)
    },
    // Run any pending flush immediately (tests, or a synchronous drain on unmount).
    flushNow() {
      if (handle == null) return
      try { cancelScheduled(handle) } catch { /* best effort */ }
      flush()
    },
    // Drop all pending work without running it.
    cancel() {
      dirty.clear()
      if (handle != null) {
        try { cancelScheduled(handle) } catch { /* best effort */ }
        handle = null
      }
    },
    pending() { return dirty.size },
  }
}
