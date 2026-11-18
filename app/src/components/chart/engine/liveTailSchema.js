// app/src/components/chart/engine/liveTailSchema.js
//
// ─── THE `plots[].liveTail` GRAMMAR, A LEAF (RS split, fix lane F2) ──────────────
//
// `defSchema.js` validates a definition's `liveTail` declarations against these
// closed sets, and `defSchema.js` is in the runtime lane's compute closure
// (`runtime/runtimeColumns.js` → `runtimeInputs.js` → `defSchema.js`). The
// declarations' READER, `liveTail.js`, is also the benchmark tail STORE: a
// page-level cache with the door's request and its subscribers. Importing the
// grammar from the reader put that store, its request and its wall clocks into
// the closure (`tools/pine_runtime_closure.mjs --check`, six findings on
// 2026-11-10; docs/pine/SERVER-RUNTIME-DESIGN.md 2.2 H3/H4/H5).
//
// ⛔ SO THE GRAMMAR LIVES HERE, IN A MODULE THAT IMPORTS NOTHING, as the pane
// table's and the end label's do beside their readers. `defSchema.js` reads it
// from here; `liveTail.js` reads it from here and re-exports it, so every other
// importer keeps its one import. `liveTail.js` itself is now a forbidden module
// of the closure, and the walk fails if it comes back.

/** The closed set of `liveTail.kind` values. */
export const LIVE_TAIL_KINDS = Object.freeze(['ratio', 'ma'])

/** The closed set of fields per kind (`kind` included). */
export const LIVE_TAIL_FIELDS = Object.freeze({
  ratio: Object.freeze(['kind', 'benchmark', 'scale']),
  ma: Object.freeze(['kind', 'of', 'length', 'type']),
})

/** The averages whose last point can be continued exactly (both are linear in
 *  their newest term). Compared upper-cased: the server's `maType` row is
 *  `EMA` / `SMA`. */
export const LIVE_TAIL_MA_TYPES = Object.freeze(['EMA', 'SMA'])
