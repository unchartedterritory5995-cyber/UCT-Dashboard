// app/src/components/chart/engine/computeLane.js
//
// ─── ⭐⭐ WHICH LANE COMPUTES A DEFINITION: ONE ROUTER ─────────────────────────────────────────
//
// A definition's lane is its `compute.kind`, read in ONE place. `nativeRegistry.computeFor` (the
// chart: every binder paint, the vendor harness, the object lane) dispatches on this answer, and so
// does the headless export (`headlessCompute.js`, the server bundle's and the library cards' door),
// so a definition can never be computed down one lane on a chart and another one headless.
//
//   'runtime' — the per-bar Pine VM (`runtime/runtimeColumns.js`)
//   'server'  — columns the server computes and the chart fetches (`serverCompute.js`)
//   'ast'     — the host / formula lane, `interpret` over trees (`astColumns.js`)
//   'native'  — a repo-authored JavaScript compute (`nativeRegistry.NATIVE_COMPUTE`); also every
//               definition that names no kind, as `computeFor` has always treated one (its native
//               lookup then throws, loudly, for a `compute.fn` it does not know)
//
// ⛔ A LEAF: it imports nothing, so both the chart's registry and the host-neutral server bundle
// reach it (`tools/pine_runtime_closure.mjs`).

/** The lanes, by name. */
export const COMPUTE_LANE = Object.freeze({
  RUNTIME: 'runtime',
  SERVER: 'server',
  AST: 'ast',
  NATIVE: 'native',
})

/** The lane that computes `def`. */
export function computeLaneOf(def) {
  const kind = def && def.compute ? def.compute.kind : undefined
  if (kind === COMPUTE_LANE.RUNTIME) return COMPUTE_LANE.RUNTIME
  if (kind === COMPUTE_LANE.SERVER) return COMPUTE_LANE.SERVER
  if (kind === COMPUTE_LANE.AST) return COMPUTE_LANE.AST
  return COMPUTE_LANE.NATIVE
}
