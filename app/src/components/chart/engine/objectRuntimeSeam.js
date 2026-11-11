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

/** ⭐ C18 — did the member leave every input at the author's default, and edit no
 *  folded parameter? The runtime lane runs the script AS WRITTEN; a knob the
 *  member moved is in the document's trees and not in that run.
 *  ⭐ DIV-4 — here, in the leaf, so the object reader (`objectColumns.js`) and a
 *  document's runtime-read colours (`nativeRegistry.js::withRuntimeColours`) ask
 *  ONE rule. */
export function inputsAtDefaults(definition, inputs) {
  const manifest = definition && definition.compute && definition.compute.paramManifest
  if (manifest && Object.keys(manifest).length) return false
  for (const input of (definition && definition.inputs) || []) {
    if (!input || typeof input.key !== 'string') continue
    const v = inputs ? inputs[input.key] : undefined
    if (v !== undefined && !Object.is(v, input.default)) return false
  }
  return true
}
