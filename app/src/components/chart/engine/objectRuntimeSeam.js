// app/src/components/chart/engine/objectRuntimeSeam.js
//
// ─── ⭐⭐ W5-T2 — THE C18 REGISTRATION SEAM, A LEAF ───────────────────────────────
//
// The object reader (`objectColumns.js`) reads its placeholders' columns from the
// runtime lane's `runtimeObjectValues`, REGISTERED, never imported
// (`memberPaneGate.test.js`). The runtime lane used to register by importing
// `objectColumns.js` itself, and that one import put the whole chart door into the
// compute closure: `objectColumns` → `nativeRegistry` → `serverCompute` (`fetch`),
// `runtimeKill` (`fetch`), `runtimePaneGate` (`import.meta.env`)
// (docs/pine/SERVER-RUNTIME-DESIGN.md 2.2 H3/H4).
//
// ⛔ SO THE SLOT LIVES HERE, IN A MODULE THAT IMPORTS NOTHING. The runtime lane
// writes it (`runtime/runtimeColumns.js`, on import, exactly as before) and the
// object reader reads it. One slot, two sides, no edge between them.
// `tools/pine_runtime_closure.mjs --check` fails if `objectColumns.js` comes back
// into the closure.
let _runtimeObjectValues = null

/** The runtime lane's C18 values function, or `null` before it is loaded
 *  (every placeholder then reads `runtime:not-loaded`: withheld, never guessed). */
export function registerObjectRuntimeValues(fn) {
  _runtimeObjectValues = typeof fn === 'function' ? fn : null
}

export function registeredObjectRuntimeValues() {
  return _runtimeObjectValues
}
