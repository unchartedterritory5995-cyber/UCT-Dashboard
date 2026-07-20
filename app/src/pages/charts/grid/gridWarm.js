// app/src/pages/charts/grid/gridWarm.js
//
// Container-driven warm decision for the Multi-Chart grid. Owns the FOUR guards
// that keep grid warming from regressing the fetch-herd protections:
//   1. content-keyed dedupe — a TF/Style/undo/layout change that leaves the sym
//      SET unchanged never re-warms (cells.map() returns a fresh array each time).
//   2. ready-gate — the caller only passes ready=true once hydrated AND the
//      initial mount-queue paint has settled (so warming can't steal server-pool
//      slots from the visible cold paint).
//   3/4 (read-only + bounded) live at the call site: `warm` is prefetchGridWarm,
//      which is read-only and rides the bounded idle-deferred IDB queue.
//
// Modeled on peerFill.js: a pure factory, injected `warm`, fully unit-testable.

export function makeGridWarmer({ warm }) {
  let lastKey = null
  return {
    // syms: the grid's current cell symbols. ready: hydrated && first-paint settled.
    // Returns true iff it warmed this call.
    maybeWarm(syms, ready) {
      if (!ready) return false
      const clean = [...new Set(
        (Array.isArray(syms) ? syms : [])
          .map(s => (typeof s === 'string' ? s.trim().toUpperCase() : ''))
          .filter(Boolean),
      )]
      if (!clean.length) return false
      const key = clean.slice().sort().join(',')   // set-content key (order-invariant)
      if (key === lastKey) return false
      lastKey = key
      warm(clean)                                   // read-only prefetch of the current set
      return true
    },
    reset() { lastKey = null },
  }
}
